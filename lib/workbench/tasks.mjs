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
import {attachCraftResult} from './craft-runtime.mjs';
import {normalizeCraftPlan} from './craft-contract.mjs';
import {refreshCraftTexture,cleanupTexture} from './craft-texture-runtime.mjs';
import {receiveCraftPattern,existingPatternHandoff,cleanupPatternWork} from './craft-pattern-runtime.mjs';

const isPatternTask=task=>task?.kind==='craft-model'&&task.args?.textureMode==='image'&&Boolean(task.args.textureSource);

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
      if(interrupted||linked)await repository.saveTask({...await repository.task(task.id),supersededBy:task.supersededBy,...(interrupted?{status:'uncertain',error:task.kind==='craft-model'?'服务中断，本次三维任务已暂停；核对原方案后接续或取消，不自动重新建模。':'服务中断，供应商处理结果待核实；不会自动重发。'}:{}),updatedAt:Date.now()});
    }
  });
  const publicTask = (task,project) => {
    if (!task) return null;
    const { snapshot: _snapshot, requestHash: _requestHash, ...value } = task;
    const targetName=task.snapshot?.video?.shots.find(s=>s.id===task.args?.objectId)?.title;
    const type=taskWorkType(task),branch=project&&FLOW_TYPES.includes(type)?projectForType(project,type):project;
    return {...value,...(targetName?{targetName}:{}),...existingImageHandoff(task),...existingPatternHandoff(task),
      ...(task.supersededBy?{executionStatus:task.status,status:['queued','running','waiting_external','waiting_provider','uncertain'].includes(task.status)?'superseded':task.status}:{}),
      ...(branch&&task.kind==='image'?{imageState:imageResultState(branch,task)}:{})};
  };
  async function update(id, patch) {
    return serial(async () => {
      const current = await repository.task(id);
      if (!current) return current;
      if (current.status === 'cancelled') {
        if (current.kind==='craft-model') patch={...patch,status:'cancelled',recoveryClosed:true,error:current.error,code:current.code};
        else if (patch.status === 'succeeded') patch = { ...patch, recoveredAfterCancel: true, dismissed: false, error: undefined, code: undefined };
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
      const timeout = task.kind === 'image' || task.kind === 'cover' || task.kind.startsWith('video') || task.kind==='craft-model' ? 600000 : 180000;
      const result = await runGeneration(task, { repository, env, fetchImpl, signal: AbortSignal.any([controller.signal, AbortSignal.timeout(timeout)]), update: patch => update(task.id, patch) });
      if (result) {
        const completed=await update(task.id,{status:'succeeded',result,error:undefined,code:undefined,note:undefined});
        if(task.kind==='craft-model'&&completed?.status==='succeeded') {
          try{await attachCraftResult(completed,repository);}
          catch(e){onError(e);await update(task.id,{note:'三维文件已保存，项目状态暂未同步；查询原任务会再次同步，不需重新生成。'});}
        }
      }
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
      let reusedPattern;
      if (input.retryOf) {
        if (!identifier(input.retryOf) || input.retryOf === input.id) throw new ServiceError(400, 'invalid_retry', '重新生成须使用新的请求 ID，并保留 retryOf 指向原任务。');
        const previous = await repository.task(input.retryOf);
        if (!previous || previous.projectId !== input.projectId || previous.kind !== input.kind || (previous.args?.objectId||'')!==(input.args?.objectId||'') || !(['failed','cancelled'].includes(previous.status) || previous.status === 'uncertain' && previous.dismissed)) throw new ServiceError(409, 'invalid_retry', '只能重新生成同一对象失败、已取消或已核实并收起的任务。');
        if(isPatternTask(input)&&isPatternTask(previous)&&previous.status==='failed'&&previous.patternImage&&previous.args.textureSource.blendFileId===input.args.textureSource.blendFileId&&previous.args.textureSource.glbFileId===input.args.textureSource.glbFileId&&previous.args.texturePrompt===input.args.texturePrompt)reusedPattern={...previous.patternImage};
      }
      const saved = await repository.loadWorkspace();
      const project = saved.workspace.projects.find(p => p.id === input.projectId);
      validateGeneration(input, project);
      if(input.retryOf&&taskWorkType(await repository.task(input.retryOf))!==project.type)throw new ServiceError(409,'invalid_retry','重试必须属于同一作品类型。');
      const unfinished = withRetryRelations(await repository.listTasks({summary:true})).filter(t => !t.dismissed && !t.supersededBy && ['queued','running','waiting_external','waiting_provider','uncertain'].includes(t.status));
      if(input.args.textureSource&&input.args.textureMode!=='image') {
        const texturePending=(await repository.listTasks({summary:true})).find(t=>t.args?.textureSource&&t.args.textureMode!=='image'&&!t.dismissed&&!t.textureRemoteDone&&Date.now()-(t.textureSubmittedAt||t.createdAt)<3600000&&(['queued','running','waiting_provider','uncertain'].includes(t.status)||t.status==='cancelled'&&t.textureSubmittedAt));
        if(texturePending)throw new ServiceError(429,'texture_busy','已有一个纹理任务尚未结束，请先查询原任务 '+texturePending.id+'；同一时间只处理一份云端纹理。');
      }
      const pending=unfinished.find(t => t.projectId === input.projectId && (t.workType||t.snapshot?.type) === project.type && (t.kind === input.kind) && (t.args.objectId ?? '') === (input.args.objectId ?? ''));
      if (pending) throw new ServiceError(409, 'pending_task', `此对象或阶段已有未结束任务 ${pending.id}。先 task_get({taskId:"${pending.id}"}) 接续原交接；不要另建任务代替。`);
      if (active + refreshing.size >= 2 || unfinished.filter(t => ['queued','running'].includes(t.status)).length + refreshing.size >= 2) throw new ServiceError(429, 'busy', '当前有两项生成或媒体处理正在进行，请稍后提交。');
      // The project history remains on disk; generation needs the current draft,
      // not copies of every old body and prompt inside each new task snapshot.
      const {flow:_history,...snapshot}=project;
      const task = { ...input, snapshot, workType: project.type, requestHash: hash, status: 'queued', createdAt: Date.now(), updatedAt: Date.now(), dismissed: false,...(reusedPattern?{patternImage:reusedPattern}:{} ) };
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
    if(task.kind==='craft-model') {
      if(task.status==='succeeded') {
        try{await attachCraftResult(task,repository,project);}
        catch(e){onError(e);return {...task,note:'三维文件已保存，项目状态暂未同步；请稍后查询原任务。'};}
      }
      if(isPatternTask(task)) {
        // Receive the original image task, then do bounded local mapping once.
        // Querying after a restart can reapply a saved image, never regenerate it.
        if(!task.supersededBy&&!task.recoveryClosed&&!stopped&&(task.handoff||task.patternImage)&&['waiting_external','uncertain'].includes(task.status)&&!(task.status==='waiting_external'&&task.dispatch==='pending')&&!refreshing.has(task.id)&&!controllers.has(task.id)&&active+scheduled.size+refreshing.size<2&&Date.now()-(task.lastPolledAt||0)>=5000) {
          const controller=new AbortController();controllers.set(task.id,controller);
          const operation=(async()=>{
            await update(task.id,{lastPolledAt:Date.now()});
            try {
              const result=await receiveCraftPattern(task,{repository,env,fetchImpl,signal:AbortSignal.any([controller.signal,AbortSignal.timeout(240000)]),update:patch=>update(task.id,patch)});
              if(result) {
                const completed=await update(task.id,{status:'succeeded',result,error:undefined,code:undefined,note:undefined});
                if(completed.status==='succeeded')await attachCraftResult(completed,repository);
              }
            } catch(e) {
              onError(e);
              if(stopped&&controller.signal.aborted) {
                await update(task.id,{status:'uncertain',note:'本地贴图已暂停；已收到的图案保留，重启后接续原任务，不重新生图。',lastPolledAt:0});
              } else {
                const latest=await repository.task(task.id);
                if(latest?.status!=='cancelled'&&latest?.status!=='succeeded')await update(task.id,{status:'failed',code:e instanceof ServiceError?e.code:'pattern_apply_failed',error:e instanceof ServiceError?e.message:'本轮图案贴合或文件校验未通过，原模型仍可使用。'});
                else if(latest?.status==='succeeded')await update(task.id,{note:'带图案的三维文件已保存，项目状态稍后会再次同步，不需重新生成。'});
              }
            } finally {if(controllers.get(task.id)===controller)controllers.delete(task.id);}
          })();
          refreshing.set(task.id,operation);void operation.finally(()=>refreshing.delete(task.id)).catch(onError);
        }
        else if(explicit&&task.patternWork&&['failed','cancelled','succeeded'].includes(task.status)&&!stopped&&!refreshing.has(task.id)&&!controllers.has(task.id)) {
          const operation=cleanupPatternWork(task,{repository,update:patch=>update(task.id,patch)}).catch(e=>{onError(e);});
          refreshing.set(task.id,operation);void operation.finally(()=>refreshing.delete(task.id)).catch(onError);
        }
        return task;
      }
      if(task.args?.textureSource&&task.textureJob&&(!task.textureRemoteDone||task.status!=='cancelled')&&['waiting_provider','uncertain','cancelled'].includes(task.status)&&!stopped&&!refreshing.has(task.id)&&!controllers.has(task.id)&&active+scheduled.size+refreshing.size<2&&Date.now()-(task.lastPolledAt||0)>=Math.min(60000,5000*2**Math.min(task.texturePollFailures||0,4))) {
        const controller=new AbortController();controllers.set(task.id,controller);
        const operation=(async()=>{
          await update(task.id,{lastPolledAt:Date.now()});
          try {
            await refreshCraftTexture(task,{repository,env,fetchImpl,signal:AbortSignal.any([controller.signal,AbortSignal.timeout(240000)]),update:patch=>update(task.id,patch)});
            const latest=await repository.task(task.id);
            if(latest.status==='succeeded')await attachCraftResult(latest,repository);
            await update(task.id,{texturePollFailures:0});
          } catch(e) {
            if(stopped&&controller.signal.aborted)return;
            const latest=await repository.task(task.id);
            if(latest.status==='cancelled')return;
            if(e instanceof ServiceError&&['texture_poll_error','texture_download_error','texture_provider_changed'].includes(e.code))await update(task.id,{note:e.message,texturePollFailures:(task.texturePollFailures||0)+1});
            else {
              await update(task.id,{status:'failed',code:e instanceof ServiceError?e.code:'texture_apply_failed',error:e instanceof ServiceError?e.message:'纹理打包或器形校验未通过，原模型仍可使用。'});
              await cleanupTexture(latest,{repository,env,fetchImpl,update:patch=>update(task.id,patch)});
            }
          } finally {
            if(controllers.get(task.id)===controller)controllers.delete(task.id);
            const latest=await repository.task(task.id);
            if(latest?.status==='cancelled'&&latest.textureRemoteDone&&!latest.textureCleaned)await cleanupTexture(latest,{repository,env,fetchImpl,update:patch=>update(task.id,patch)});
          }
        })();
        refreshing.set(task.id,operation);void operation.finally(()=>refreshing.delete(task.id)).catch(onError);
      } else if(task.args?.textureSource&&task.textureWork&&!task.textureCleaned&&(explicit||Date.now()-(task.textureSubmittedAt||task.createdAt)>3600000)&&!refreshing.has(task.id)&&!controllers.has(task.id)&&['failed','cancelled','succeeded'].includes(task.status)&&(!task.textureSubmittedAt||task.textureRemoteDone||Date.now()-task.textureSubmittedAt>3600000)) {
        const operation=cleanupTexture(task,{repository,env,fetchImpl,update:patch=>update(task.id,patch)});
        refreshing.set(task.id,operation);void operation.finally(()=>refreshing.delete(task.id)).catch(onError);
      }
      return task;
    }
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
      const needsSnapshot=!task.supersededBy&&!task.snapshot&&(!task.recoveryClosed||task.textureJob)&&(task.handoff||task.providerJob||task.textureJob||task.patternImage)&&['waiting_external','waiting_provider','uncertain','cancelled'].includes(task.status);
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
      if(!task.handoff||task.args.provider!=='workbuddy'||!(imageHandoffKinds.includes(task.kind)||isPatternTask(task)))throw new ServiceError(400,'invalid_handoff','仅支持已有 WorkBuddy 图片或器皿图案交接任务。');
      if(isPatternTask(task)&&(task.status==='cancelled'||task.supersededBy))throw new ServiceError(409,'invalid_task_state','本轮图案任务已取消或被接替，不再接收晚到结果；原模型保持不变。');
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
          const completedFileId=isPatternTask(task)?task.patternImage?.originalFileId:task.result?.asset?.fileId;
          if(completedFileId!==stored.fileId)throw new ServiceError(409,'handoff_conflict','原任务已完成且结果不同，未覆盖原结果。');
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
      const craft=task.kind==='craft-model';
      const result = await repository.saveTask({ ...task, status: 'cancelled', cancelledAt: Date.now(), updatedAt: Date.now(),...(craft?{recoveryClosed:true}:{}), error: isPatternTask(task)?'已取消本轮图案贴合并保留原模型。已发送的生图请求可能仍运行并计费；WorkBuddy 中的生成需在那里停止，晚到图片不会自动采用。':task.args?.textureSource?'已取消本次采用与本地处理。已提交的腾讯云纹理可能仍运行并计费；后台只核对结束状态并清理临时文件，保留原模型。':craft?'已取消本次三维生成，本地建模进程正在停止；保留原成品。':'已取消等待。已发送请求可能仍产生费用；后续查询仍可找回已完成结果。WorkBuddy 中的作业需在当地取消。' });
      if(craft)controllers.get(id)?.abort();
      // Do not abort an already-paid request: keep its result recoverable without adopting it.
      return publicTask(result);
    });
  }
  async function completeCraft(id,planJson) {
    await ready();
    let plan;
    try {
      if(typeof planJson!=='string'||!planJson.trim()||planJson.length>16000)throw new Error('建模方案须为不超过 16000 字的 JSON 对象。');
      plan=normalizeCraftPlan(JSON.parse(planJson));
    } catch(e){throw new ServiceError(400,'invalid_plan',e.message||'建模方案格式无效。');}
    await serial(async()=>{
      const task=await repository.task(id);
      if(!task||task.kind!=='craft-model')throw new ServiceError(404,'not_found','请使用原三维任务 ID 接续生成。');
      if(task.args.textureSource)throw new ServiceError(400,'invalid_task_state','纹理增强无需重新提交造型方案，请查询原纹理任务。');
      if(task.status==='cancelled'||task.supersededBy)throw new ServiceError(409,'invalid_task_state','原任务已取消或被后续任务接替，未重新启动。');
      const prior=task.craftPlan||(task.args.planJson?normalizeCraftPlan(JSON.parse(task.args.planJson)):null);
      if(prior&&digest(normalizeCraftPlan(prior))!==digest(plan))throw new ServiceError(409,'plan_conflict','原任务已有不同方案，未覆盖；需要新设计时请明确重新生成。');
      if(['queued','running','succeeded'].includes(task.status)) {
        if(prior)return;
        throw new ServiceError(409,'not_ready','原任务正在解析需求，请查询状态，不重复提交方案。');
      }
      if(!['waiting_external','uncertain'].includes(task.status))throw new ServiceError(409,'invalid_task_state','原任务已失败，请按原需求明确重试，不重复启动失败任务。');
      if(stopped||active+scheduled.size+refreshing.size>=2)throw new ServiceError(429,'busy','当前生成任务正在处理，请稍后使用原任务和同一方案重试。');
      const saved=await repository.saveTask({...task,craftPlan:plan,status:'queued',error:undefined,code:undefined,note:undefined,updatedAt:Date.now()});
      const timer=setTimeout(()=>{
        scheduled.delete(timer);if(stopped)return;
        const operation=execute(saved);executions.add(operation);
        void operation.finally(()=>executions.delete(operation)).catch(onError);
      },0);
      scheduled.add(timer);
    });
    return get(id);
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
  return { ready, submit, list, get, cancel, dismiss, stop, completeHandoff, completeWebsite,completeCraft };
}
