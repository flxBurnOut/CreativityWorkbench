import { randomUUID } from 'node:crypto';
import { digest, identifier } from './repository.mjs';
import { validateGeneration, runGeneration } from './generation.mjs';
import { ServiceError } from './errors.mjs';
import { refreshOutputTask } from './output-generation.mjs';

export function createTaskManager(repository, { env = process.env, fetchImpl = fetch, onError = () => {} } = {}) {
  let queue = Promise.resolve(); const controllers = new Map(); let active = 0;
  const refreshing = new Map(); let stopped = false;
  const serial = fn => { const next = queue.then(fn); queue = next.catch(() => {}); return next; };
  let initialized;
  const ready = () => initialized ??= serial(async () => {
    for (const task of await repository.listTasks()) {
      if (['queued','running'].includes(task.status) || (task.status === 'waiting_external' && task.dispatch === 'pending')) await repository.saveTask({ ...task, status: 'uncertain', error: '服务中断，供应商处理结果待核实；不会自动重发。', updatedAt: Date.now() });
    }
  });
  const publicTask = task => {
    if (!task) return null;
    const { snapshot: _snapshot, requestHash: _requestHash, ...value } = task;
    const targetName=task.snapshot?.video?.shots.find(s=>s.id===task.args?.objectId)?.title;
    return targetName?{...value,targetName}:value;
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
        if (!previous || previous.projectId !== input.projectId || previous.kind !== input.kind || !(['failed','cancelled'].includes(previous.status) || previous.status === 'uncertain' && previous.dismissed)) throw new ServiceError(409, 'invalid_retry', '只能重新生成失败、已取消或已核实并收起的待核实任务。');
      }
      const saved = await repository.loadWorkspace();
      const project = saved.workspace.projects.find(p => p.id === input.projectId);
      validateGeneration(input, project);
      const unfinished = (await repository.listTasks()).filter(t => !t.dismissed && ['queued','running','waiting_external','waiting_provider','uncertain'].includes(t.status));
      if (unfinished.some(t => t.projectId === input.projectId && (t.kind === input.kind) && (t.args.objectId ?? '') === (input.args.objectId ?? ''))) throw new ServiceError(409, 'pending_task', '此对象或阶段已有未结束请求，请先查看任务结果或取消等待。');
      if (active >= 2 || unfinished.filter(t => ['queued','running'].includes(t.status)).length >= 2) throw new ServiceError(429, 'busy', '当前有两项生成正在处理，请稍后提交。');
      const task = { ...input, snapshot: project, requestHash: hash, status: 'queued', createdAt: Date.now(), updatedAt: Date.now(), dismissed: false };
      await repository.saveTask(task);
      // Start after leaving the persistence lock; no paid request is made before durable recording.
      setTimeout(() => { void execute(task).catch(onError); }, 0);
      return publicTask(task);
    });
  }
  async function refreshExternal(task) {
    if (task.recoveryClosed) return task;
    if (['video-shot','video-audio'].includes(task.kind)) {
      if (!stopped && active+refreshing.size<2 && ['waiting_external','waiting_provider','uncertain','cancelled'].includes(task.status) && !(task.status==='waiting_external'&&task.dispatch==='pending') && (task.handoff || task.providerJob) && !refreshing.has(task.id) && (!task.providerJob || Date.now()-(task.lastPolledAt||0)>=5000)) {
        // Downloads / transcoding may take minutes; task queries must return promptly.
        const controller=new AbortController();controllers.set(task.id,controller);
        const operation=(async()=>{
          if (task.providerJob) await update(task.id,{lastPolledAt:Date.now()});
          try { await refreshOutputTask(task,{repository,env,fetchImpl,signal:controller.signal,update:patch=>update(task.id,patch)}); }
          catch(e) {onError(e);await update(task.id,{note:e instanceof ServiceError?e.message:'等待媒体文件写入完成或供应商恢复查询。',lastPolledAt:Date.now()});}
          finally {if(controllers.get(task.id)===controller)controllers.delete(task.id);}
        })();
        refreshing.set(task.id,operation);void operation.finally(()=>refreshing.delete(task.id)).catch(onError);
      }
      return task;
    }
    if (!['waiting_external','uncertain','cancelled'].includes(task.status) || !task.handoff) return task;
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
      return { ...task, note: e instanceof ServiceError ? e.message : '等待图片文件写入完成。' };
    }
  }
  async function list(projectId) {
    await ready();
    const selected = (await repository.listTasks()).filter(t => !projectId || t.projectId === projectId).sort((a,b) => b.createdAt-a.createdAt);
    const result = [];
    for (const task of selected) result.push(publicTask(await refreshExternal(task)));
    return result;
  }
  async function get(id) { await ready(); const task = await repository.task(id); return publicTask(task && await refreshExternal(task)); }
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
  async function dismiss(id) {
    await ready();
    return serial(async () => {
      const task = await repository.task(id);
      if (!task) throw new ServiceError(404, 'not_found', '任务不存在。');
      if (!['succeeded','failed','cancelled','uncertain'].includes(task.status)) throw new ServiceError(409, 'pending_task', '任务仍在处理，请先取消等待再收起。');
      return publicTask(await repository.saveTask({ ...task, dismissed: true, updatedAt: Date.now() }));
    });
  }
  return { ready, submit, list, get, cancel, dismiss, stop: () => { stopped=true;for (const c of controllers.values()) c.abort(); } };
}
