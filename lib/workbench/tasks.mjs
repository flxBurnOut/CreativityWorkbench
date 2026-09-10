import { randomUUID } from 'node:crypto';
import { digest, identifier } from './repository.mjs';
import { validateGeneration, runGeneration } from './generation.mjs';
import { ServiceError } from './errors.mjs';
import { refreshOutputTask } from './output-generation.mjs';
import { existingImageHandoff, imageHandoffKinds } from './handoff-contract.mjs';
import {withRetryRelations,sameTaskTarget} from './retry-relations.mjs';
import {imageResultState,taskWorkType} from './image-results.mjs';
import {projectForType,FLOW_TYPES} from './workflow.mjs';
import {receiveWebsiteResult,attachWebsiteResult} from './website-handoff.mjs';
import {inspectWebsiteZip} from './workflow-delivery.mjs';
import {validateWebsiteVerification} from './website-verification.mjs';

export function createTaskManager(repository, { env = process.env, fetchImpl = fetch, onError = () => {} } = {}) {
  let queue = Promise.resolve(); const controllers = new Map(); let active = 0;
  const refreshing = new Map(); let stopped = false;
  const executions = new Set(); const scheduled = new Set();
  const serial = fn => { const next = queue.then(fn); queue = next.catch(() => {}); return next; };
  let initialized;
  const ready = () => initialized ??= serial(async () => {
    const saved=await repository.listTasks({summary:true});
    for (const task of withRetryRelations(saved)) {
      const interrupted=['queued','running'].includes(task.status)||(task.status==='waiting_external'&&task.dispatch==='pending');
      const linked=task.supersededBy!==saved.find(t=>t.id===task.id)?.supersededBy;
      if(interrupted||linked)await repository.saveTask({...await repository.task(task.id),supersededBy:task.supersededBy,...(interrupted?{status:'uncertain',error:'服务中断，供应商处理结果待核实；不会自动重发。'}:{}),updatedAt:Date.now()});
    }
  });
  const publicTask = (task,project) => {
    if (!task) return null;
    const { snapshot: _snapshot, requestHash: _requestHash, ...value } = task;
    const targetName=task.snapshot?.video?.shots.find(s=>s.id===task.args?.objectId)?.title;
    const type=taskWorkType(task),branch=project&&FLOW_TYPES.includes(type)?projectForType(project,type):project;
    return {...value,...(targetName?{targetName}:{}),...existingImageHandoff(task),
      ...(task.supersededBy?{executionStatus:task.status,status:['queued','running','waiting_external','waiting_provider','uncertain'].includes(task.status)?'superseded':task.status}:{}),
      ...(branch&&task.kind==='image'?{imageState:imageResultState(branch,task)}:{})};
  };
  async function update(id, patch) {
    return serial(async () => {
      const current = await repository.task(id);
      if (!current) return current;
      if (current.status === 'cancelled') {
        if (patch.status === 'succeeded') patch = { ...patch, recoveredAfterCancel: true, dismissed: false, error: undefined, code: undefined };
        else patch = { ...patch, ...(patch.status === 'failed' ? { recoveryClosed: true } : {}), status: 'cancelled', error: current.error, code: current.code };
      }
      return repository.saveTask({ ...current, ...patch, updatedAt: Date.now() });
    });
  }
  async function execute(task) {
    const controller = new AbortController(); controllers.set(task.id, controller); active++;
    try {
      const running = await update(task.id, { status: 'running' });
      if (running?.status === 'cancelled') return;
      const timeout = task.kind === 'image' || task.kind === 'cover' || task.kind.startsWith('video') ? 600000 : 180000;
      const result = await runGeneration(task, { repository, env, fetchImpl, signal: AbortSignal.any([controller.signal, AbortSignal.timeout(timeout)]), update: patch => update(task.id, patch) });
      if (result) await update(task.id, { status: 'succeeded', result });
    } catch (e) {
      onError(e);
      await update(task.id, { status: e instanceof ServiceError && ['uncertain','interrupted'].includes(e.code) ? 'uncertain' : 'failed', error: e instanceof ServiceError ? e.message : '生成未完成，原稿保持不变。', code: e instanceof ServiceError ? e.code : 'generation_error' });
    } finally { if(controllers.get(task.id)===controller)controllers.delete(task.id); active--; }
  }
  async function submit(input) {
    await ready();
    return serial(async () => {
      if (stopped) throw new ServiceError(503, 'stopped', '服务正在停止，请重新连接后查询原请求。');
      if (!input || !identifier(input.id)) throw new ServiceError(400, 'invalid_input', '请求 ID 无效。');
      const hash = digest(input);
      const prior = await repository.task(input.id);
      if (prior) {
        if (prior.requestHash !== hash) throw new ServiceError(409, 'conflict', '此请求 ID 已用于另一项操作。');
        return publicTask(prior);
      }
      if (input.retryOf) {
        if (!identifier(input.retryOf) || input.retryOf === input.id) throw new ServiceError(400, 'invalid_retry', '重新生成须使用新的请求 ID，并保留 retryOf 指向原任务。');
        const previous = await repository.task(input.retryOf);
        if (!previous || previous.projectId !== input.projectId || previous.kind !== input.kind || (previous.args?.objectId||'')!==(input.args?.objectId||'') || !(['failed','cancelled'].includes(previous.status) || previous.status === 'uncertain' && previous.dismissed)) throw new ServiceError(409, 'invalid_retry', '只能重新生成同一对象失败、已取消或已核实并收起的任务。');
      }
      const saved = await repository.loadWorkspace();
      const project = saved.workspace.projects.find(p => p.id === input.projectId);
      validateGeneration(input, project);
      if(input.retryOf&&taskWorkType(await repository.task(input.retryOf))!==project.type)throw new ServiceError(409,'invalid_retry','重试必须属于同一作品类型。');
      const unfinished = withRetryRelations(await repository.listTasks({summary:true})).filter(t => !t.dismissed && !t.supersededBy && ['queued','running','waiting_external','waiting_provider','uncertain'].includes(t.status));
      const pending=unfinished.find(t => t.projectId === input.projectId && (t.workType||t.snapshot?.type) === project.type && (t.kind === input.kind) && (t.args.objectId ?? '') === (input.args.objectId ?? ''));
      if (pending) throw new ServiceError(409, 'pending_task', `此对象或阶段已有未结束任务 ${pending.id}。先 task_get({taskId:"${pending.id}"}) 接续原交接；不要另建任务代替。`);
      if (active + refreshing.size >= 2 || unfinished.filter(t => ['queued','running'].includes(t.status)).length + refreshing.size >= 2) throw new ServiceError(429, 'busy', '当前有两项生成或媒体处理正在进行，请稍后提交。');
      // The project history remains on disk; generation needs the current draft,
      // not copies of every old body and prompt inside each new task snapshot.
      const {flow:_history,...snapshot}=project;
      const task = { ...input, snapshot, workType: project.type, requestHash: hash, status: 'queued', createdAt: Date.now(), updatedAt: Date.now(), dismissed: false };
      await repository.saveTask(task);
      if(input.retryOf){const previous=await repository.task(input.retryOf);await repository.saveTask({...previous,supersededBy:task.id,updatedAt:Date.now()});}
      // Start after leaving the persistence lock; no paid request is made before durable recording.
      const timer = setTimeout(() => {
        scheduled.delete(timer); if (stopped) return;
        const operation = execute(task); executions.add(operation);
        void operation.finally(() => executions.delete(operation)).catch(onError);
      }, 0);
      scheduled.add(timer);
      return publicTask(task);
    });
  }
  async function refreshExternal(task,explicit=false,project) {
    if(task.supersededBy&&!explicit)return task;
    if(task.kind==='website'&&task.args.guided) {
      if(task.status==='succeeded'){await attachWebsiteResult(task,repository,project);return task;}
      if(!stopped&&task.handoff&&['waiting_external','uncertain','cancelled'].includes(task.status)&&!refreshing.has(task.id)&&active+scheduled.size+refreshing.size<2) {
        const operation=receiveWebsiteResult(task,{repository,update}).catch(e=>update(task.id,{status:e instanceof ServiceError&&['invalid_source','too_large'].includes(e.code)?'failed':task.status,error:e instanceof ServiceError?e.message:'网站接收暂未完成，请刷新原任务。'}));
        refreshing.set(task.id,operation);void operation.finally(()=>refreshing.delete(task.id)).catch(onError);
      }
      return task;
    }
    if (task.recoveryClosed) return task;
    if (['video-shot','video-audio'].includes(task.kind)) {
      if (!stopped && active+scheduled.size+refreshing.size<2 && ['waiting_external','waiting_provider','uncertain','cancelled'].includes(task.status) && !(task.status==='waiting_external'&&task.dispatch==='pending') && (task.handoff || task.providerJob) && !refreshing.has(task.id) && (!task.providerJob || Date.now()-(task.lastPolledAt||0)>=5000)) {
        // Downloads / transcoding may take minutes; task queries must return promptly.
        const controller=new AbortController();controllers.set(task.id,controller);
        const operation=(async()=>{
          if (task.providerJob) await update(task.id,{lastPolledAt:Date.now()});
          try { await refreshOutputTask(task,{repository,env,fetchImpl,signal:controller.signal,update:patch=>update(task.id,patch)}); }
          catch(e) {
            onError(e);
            if(stopped&&controller.signal.aborted) {
              await update(task.id,{note:'服务停止时中断了媒体接收；已保留原任务，下次启动后继续接收，不重新生成。',lastPolledAt:0});
              return;
            }
            // A resource/launcher failure must not start FFmpeg again on every
            // status poll. Keep the received file; require an explicit retry.
            if (e instanceof ServiceError && ['media_processing_failed','media_guard_unavailable'].includes(e.code)) await update(task.id,{status:'failed',error:e.message,code:e.code,recoveryClosed:true,lastPolledAt:Date.now()});
            else await update(task.id,{note:e instanceof ServiceError?e.message:'等待媒体文件写入完成或供应商恢复查询。',lastPolledAt:Date.now()});
          }
          finally {if(controllers.get(task.id)===controller)controllers.delete(task.id);}
        })();
        refreshing.set(task.id,operation);void operation.finally(()=>refreshing.delete(task.id)).catch(onError);
      }
      return task;
    }
    if (!['waiting_external','uncertain','cancelled'].includes(task.status) || !task.handoff) return task;
    if (stopped || refreshing.has(task.id) || active + scheduled.size + refreshing.size >= 2 || (task.status === 'waiting_external' && task.dispatch === 'pending') || Date.now() - (task.lastPolledAt || 0) < 5000) return task;
    // Queries only schedule work. Multiple tabs must not decode the same image
    // concurrently, or hold HTTP responses open while a large PNG is processed.
    const operation = (async () => {
      try { await importImage(task); }
      catch (e) { onError(e); }
    })();
    refreshing.set(task.id, operation);
    void operation.finally(() => refreshing.delete(task.id)).catch(onError);
    return task;
  }
  async function importImage(task) {
    try {
      const output = await repository.readHandoff(task.id);
      if (!output) return task;
      if (output.failed) return update(task.id, { status: 'failed', error: 'WorkBuddy 未完成图片生成，请在本地助理查看原因。' });
      const stored = await repository.putImage(output.bytes);
      const c = task.snapshot.concepts.find(c => c.id === task.args.objectId);
      return serial(async () => {
        const current = await repository.task(task.id);
        if (!['waiting_external','uncertain','cancelled'].includes(current.status)) return current;
        return repository.saveTask({ ...current, ...(current.status === 'cancelled' ? { recoveredAfterCancel: true, dismissed: false } : {}), status: 'succeeded', error: undefined, code: undefined, note: undefined, updatedAt: Date.now(), result: { asset: { id: randomUUID(), name: task.kind === 'cover' ? task.snapshot.title + '封面' : task.kind==='video-frame'?'镜头首帧候选':c.name, fileId: stored.fileId, source: { ...task.provenance, model: 'WorkBuddy 实际使用的生图能力' } } } });
      });
    } catch (e) {
      // A file may still be being written. Leave it waiting; never adopt undecodable output.
      return update(task.id, { note: e instanceof ServiceError ? e.message : '等待图片文件写入完成。', lastPolledAt: Date.now() });
    }
  }
  async function list(projectId) {
    await ready();
    const selected = withRetryRelations(await repository.listTasks({summary:true,projectId})).filter(t => !projectId || t.projectId === projectId).sort((a,b) => b.createdAt-a.createdAt);
    const projects=repository.loadWorkspace?(await repository.loadWorkspace()).workspace.projects:[];
    const result = [];
    for (const task of selected) {
      const needsSnapshot=!task.supersededBy&&!task.snapshot&&!task.recoveryClosed&&(task.handoff||task.providerJob)&&['waiting_external','waiting_provider','uncertain','cancelled'].includes(task.status);
      const full=needsSnapshot?{...await repository.task(task.id),supersededBy:task.supersededBy}:task;
      const project=projects.find(p=>p.id===task.projectId)||null;
      result.push(publicTask(await refreshExternal(full,false,project),project));
    }
    return result;
  }
  async function get(id) {
    await ready();const task=await repository.task(id);if(!task)return null;
    const project=repository.loadWorkspace?(await repository.loadWorkspace()).workspace.projects.find(p=>p.id===task.projectId):undefined;
    return publicTask(await refreshExternal(task,true,project||null),project);
  }
  async function completeHandoff(id, source) {
    await ready();
    const receipt=await serial(async()=>{
      const task=await repository.task(id);
      if(!task)throw new ServiceError(404,'not_found','原任务不存在，请核对网页交接中的任务 ID 和工作台连接。');
      if(!task.handoff||task.args.provider!=='workbuddy'||!imageHandoffKinds.includes(task.kind))throw new ServiceError(400,'invalid_handoff','仅支持已有 WorkBuddy 图片交接任务。');
      if(!['waiting_external','uncertain','cancelled','succeeded'].includes(task.status))throw new ServiceError(409,'invalid_task_state','原任务尚未准备好交接，或已经失败；请先查询原任务，不另建任务绕行。');
      if(stopped||active+scheduled.size+refreshing.size>=2)throw new ServiceError(429,'busy','媒体正在处理，请稍后用同一原任务和图片重试。');
      const project=(await repository.loadWorkspace()).workspace.projects.find(p=>p.id===task.projectId);
      if(!project)throw new ServiceError(404,'not_found','原任务的项目不存在。');
      active++;
      try {
        let bytes;
        if(source.assetId) {
          const asset=project.assets.find(a=>a.id===source.assetId);
          if(!asset)throw new ServiceError(400,'invalid_asset','请选择原任务所属项目中已经生成的图片；不能引用其他项目素材。');
          bytes=await repository.media(asset.fileId);
        } else bytes=await repository.readInbox(task.projectId,source.filename);
        if(!bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))throw new ServiceError(400,'invalid_image','请提供实际 PNG 图片，不接受改后缀的文件。');
        const stored=await repository.putImage(bytes);
        if(task.status==='succeeded') {
          if(task.result?.asset?.fileId!==stored.fileId)throw new ServiceError(409,'handoff_conflict','原任务已完成且结果不同，未覆盖原结果。');
          return {fileId:stored.fileId,alreadyWritten:true};
        }
        const result=await repository.completeImageHandoff(id,await repository.media(stored.fileId));
        await repository.saveTask({...task,handoffReceipt:{fileId:stored.fileId,...source},lastPolledAt:0,updatedAt:Date.now()});
        return {fileId:stored.fileId,...result};
      } finally {active--;}
    });
    // Only the normal importer sets succeeded and creates the candidate.
    return {...await get(id),handoffCompletion:receipt};
  }
  async function cancel(id) {
    await ready();
    return serial(async () => {
      const task = await repository.task(id);
      if (!task) throw new ServiceError(404, 'not_found', '任务不存在。');
      if (['succeeded','failed','cancelled'].includes(task.status)) return publicTask(task);
      const result = await repository.saveTask({ ...task, status: 'cancelled', cancelledAt: Date.now(), updatedAt: Date.now(), error: '已取消等待。已发送请求可能仍产生费用；后续查询仍可找回已完成结果。WorkBuddy 中的作业需在当地取消。' });
      // Do not abort an already-paid request: keep its result recoverable without adopting it.
      return publicTask(result);
    });
  }
  async function completeWebsite(id,source,report={}) {
    await ready();
    await serial(async()=>{
      const task=await repository.task(id);
      if(!task?.handoff||task.kind!=='website'||!task.args.guided)throw new ServiceError(400,'invalid_handoff','请使用网页本次网站制作任务，不要另建任务替代。');
      if(!['waiting_external','uncertain','cancelled','succeeded'].includes(task.status))throw new ServiceError(409,'not_ready','网站任务尚未准备好接收，或已经失败。请核对原任务。');
      if(stopped||active+scheduled.size+refreshing.size>=2)throw new ServiceError(429,'busy','已有文件正在处理，请稍后重试原任务。');
      active++;
      try {
        const bytes=source.bytes||await repository.readInbox(task.projectId,source.filename);
        validateWebsiteVerification(report);
        // Validate once before publishing the handoff. The normal receiver is
        // the only place that stores the finished ZIP and attaches its result.
        const candidate=repository.inspectWebsiteSource?repository.inspectWebsiteSource(bytes):{...inspectWebsiteZip(bytes),fileId:digest(bytes)+'.zip'};
        if(!candidate.previewPath)throw new ServiceError(400,'invalid_source','网站 ZIP 缺少 index.html 入口，未完成交接。');
        if(task.status==='succeeded'){
          if(task.result.websiteSource?.fileId!==candidate.fileId)throw new ServiceError(409,'handoff_conflict','本次任务已有不同网站结果，请通过新修改任务更新。');return;
        }
        await repository.completeHandoffFile(id,bytes,'zip');
        await repository.saveTask({...task,websiteCompletionReport:report,updatedAt:Date.now()});
      }finally{active--;}
    });
    return get(id);
  }
  async function dismiss(id,replacementTaskId) {
    await ready();
    return serial(async () => {
      const task = await repository.task(id);
      if (!task) throw new ServiceError(404, 'not_found', '任务不存在。');
      if(replacementTaskId) {
        const replacement=await repository.task(replacementTaskId);
        if(!sameTaskTarget(task,replacement)||(replacement.createdAt||0)<(task.createdAt||0))throw new ServiceError(400,'invalid_replacement','请选择同一项目、类型和对象的后续任务，不能关联其他操作。');
        if(replacement.supersededBy)throw new ServiceError(400,'invalid_replacement','请选择尚未被其他任务接替的后续任务，不能建立循环关系。');
        return publicTask(await repository.saveTask({...task,supersededBy:replacement.id,dismissed:true,updatedAt:Date.now()}));
      }
      if (!['succeeded','failed','cancelled','uncertain'].includes(task.status)) throw new ServiceError(409, 'pending_task', '任务仍在处理，请先取消等待再收起。');
      return publicTask(await repository.saveTask({ ...task, dismissed: true, updatedAt: Date.now() }));
    });
  }
  async function stop() {
    stopped = true;
    for (const timer of scheduled) clearTimeout(timer);
    scheduled.clear();
    for (const c of controllers.values()) c.abort();
    await Promise.allSettled([...executions, ...refreshing.values()]);
    await queue;
  }
  return { ready, submit, list, get, cancel, dismiss, stop, completeHandoff, completeWebsite };
}
