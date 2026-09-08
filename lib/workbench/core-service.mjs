import { join } from 'node:path';
import { coreTools } from './core-contract.mjs';
import { createProject, applyTaskResult } from './project-core.mjs';
import { digest, record } from './repository.mjs';
import { taskSource } from './task-contract.mjs';
import { shotSource, audioSource, composeSource } from './output-contract.mjs';
import { importMedia } from './video-media.mjs';
import { generationStatus } from './generation.mjs';
import { ServiceError } from './errors.mjs';

export const CORE_PROTOCOL = 1;
export function runtimeIdentity(repository) {
  return { workbench: 'creativity-workbench', coreProtocol: CORE_PROTOCOL, dataId: digest(repository.root) };
}
const fail = (status, code, message) => { throw new ServiceError(status, code, message); };
function merge(current, patch) {
  const next = { ...current };
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) delete next[key];
    else next[key] = record(value) ? merge(record(current?.[key]) ? current[key] : {}, value) : value;
  }
  return next;
}
const publicTask = task => {
  if (!task) fail(404, 'not_found', '任务不存在。');
  const { source: _source, clientRequestHash: _clientRequestHash, ...value } = task;
  return { ...value, next: task.status === 'succeeded' ? 'task_adopt' : task.status === 'waiting_external' ? '完成 handoff 文件交接，再调用 task_get。' : task.status === 'uncertain' ? '核实原请求；不要更换 ID 自动重试。' : 'task_get' };
};

export function createCoreService(repository, tasks, { env, fetchImpl }) {
  let imports = 0;
  async function getProject(projectId) {
    const saved = await repository.loadWorkspace();
    const project = saved.workspace.projects.find(p => p.id === projectId);
    if (!project) fail(404, 'not_found', '项目不存在，请先读取项目列表。');
    return { project, projectVersion: digest(project), revision: saved.revision };
  }
  function requireVersion(value, expected) {
    if (value.projectVersion !== expected) fail(409, 'conflict', '项目已更新，请重新读取后合并修改。');
  }
  const file = (fileId, role, stale = false) => ({ role, fileId, stale, path: join(repository.root, 'files', fileId), url: '/v1/files/' + fileId });
  async function deliver(input) {
    const { project: p, projectVersion } = await getProject(input.projectId);
    const files = [];
    if (p.novel?.text.trim()) {
      for (const ext of input.format === 'all' ? ['txt', 'md'] : [input.format]) {
        const text = (ext === 'md' ? '# ' : '') + p.novel.title + '\n\n' + p.novel.text + '\n';
        files.push({ role: 'novel', stale: false, ...await repository.exportText(text, ext) });
      }
    }
    if (input.format !== 'all' && !files.length) fail(400, 'missing_text', '尚未保存小说正文，请先通过 project_update 或正文任务保存。');
    if (input.format === 'all') {
      for (const a of p.assets) {
        await repository.media(a.fileId);
        files.push({ role: 'image', name: a.name, assetId: a.id, fileId: a.fileId, path: join(repository.root, 'media', a.fileId + '.png'), url: '/v1/media/' + a.fileId });
      }
      for (const s of p.video?.shots || []) {
        if (s.clip) files.push(file(s.clip.fileId, 'clip:' + s.id, s.clip.source !== shotSource(s, p.video.ratio)));
        if (s.audio) files.push(file(s.audio.fileId, 'audio:' + s.id, s.audio.source !== audioSource(s)));
      }
      if (p.video?.music) files.push(file(p.video.music.fileId, 'music'));
      if (p.video?.final) {
        const stale = p.video.final.source !== composeSource(p.video);
        files.push(file(p.video.final.fileId, 'video', stale), file(p.video.final.subtitleFileId, 'subtitles', stale));
      }
      const staleSite = p.website && JSON.stringify(p.website.spec) !== JSON.stringify(p.website.builtSpec);
      if (p.website?.previewFileId) files.push(file(p.website.previewFileId, 'website-preview', staleSite));
      if (p.website?.zipFileId) files.push(file(p.website.zipFileId, 'website-zip', staleSite));
      for (const item of files.filter(f => f.url.startsWith('/v1/files/'))) await repository.output(item.fileId);
    }
    return { projectId: p.id, projectVersion, files, limitations: p.website?.spec.limitations || [], note: files.length ? '实际文件已可读取；stale=true 表示依据已改变，需重新生成。' : '还没有可交付文件。' };
  }
  async function call(name, raw) {
    const tool = coreTools[name];
    if (!tool) fail(404, 'not_found', '核心工具不存在。');
    const parsed = tool.schema.safeParse(raw);
    if (!parsed.success) fail(400, 'invalid_input', parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).slice(0, 8).join('; '));
    const input = parsed.data;
    if (name === 'workbench_status') return { ...runtimeIdentity(repository), providers: generationStatus(env), tools: Object.keys(coreTools), localConversation: true, scope: '项目、文字、美术、图像、视频、静态网站；3D 未实现', workbuddyClientTest: 'pending-manual' };
    if (name === 'project_list') {
      const saved = await repository.loadWorkspace();
      return { revision: saved.revision, projects: saved.workspace.projects.map(p => ({ id: p.id, title: p.title, type: p.type, stage: p.stage, updatedAt: p.updatedAt, projectVersion: digest(p) })) };
    }
    if (name === 'project_get') return { ...await getProject(input.projectId), inbox: await repository.inbox(input.projectId) };
    if (name === 'task_list') {
      await getProject(input.projectId);
      return { tasks: (await tasks.list(input.projectId)).map(t => ({ id: t.id, projectId: t.projectId, kind: t.kind, status: t.status, createdAt: t.createdAt, updatedAt: t.updatedAt, targetName: t.targetName, error: t.error, note: t.note, dispatch: t.dispatch })) };
    }
    if (name === 'task_get') return publicTask(await tasks.get(input.taskId));
    if (name === 'task_cancel') return publicTask(await tasks.cancel(input.taskId));
    if (name === 'project_deliver') return deliver(input);
    if (name === 'task_start') {
      const hash = digest(input);
      const prior = await repository.task(input.requestId);
      if (prior) {
        if (prior.clientRequestHash !== hash) fail(409, 'conflict', '此任务 requestId 已用于另一请求。重试时保留原参数。');
        return publicTask(await tasks.get(input.requestId));
      }
      const current = await getProject(input.projectId); requireVersion(current, input.expectedVersion);
      const args = { ...input.args };
      if (['creative', 'content', 'novel', 'video-plan', 'website', 'image'].includes(input.kind)) args.action ??= 'generate';
      if (['image', 'cover', 'video-shot', 'video-audio'].includes(input.kind)) {
        args.provider ??= 'workbuddy';
        if (args.provider === 'workbuddy' || input.kind === 'video-audio') args.handoffOnly = true;
      }
      if (['image', 'cover'].includes(input.kind)) args.ratio ??= '1:1';
      return publicTask(await tasks.submit({ id: input.requestId, projectId: input.projectId, kind: input.kind, args, source: taskSource(current.project, input.kind, args), clientRequestHash: hash }));
    }
    // Mutation receipts are committed atomically with the project. Adoption is keyed by task.
    const operationId = name + ':' + (input.requestId || input.taskId);
    const hash = digest(name === 'task_adopt' ? { taskId: input.taskId } : input);
    const prior = await repository.coreReceipt(operationId, hash);
    if (prior) return { ...prior, replayed: true };
    if (name === 'project_create') {
      const project = createProject(input.idea, input.type, input.title, 'p-' + digest(input.requestId).slice(0, 32));
      return repository.mutateProject({ operationId, requestHash: hash, projectId: project.id, create: true }, () => ({ project }));
    }
    if (name === 'task_adopt') {
      const task = await tasks.get(input.taskId);
      if (!task) fail(404, 'not_found', '任务不存在。');
      if (task.status !== 'succeeded') fail(409, 'not_ready', '任务尚未成功，不能采用。');
      return repository.mutateProject({ operationId, requestHash: hash, projectId: task.projectId, expectedVersion: input.expectedVersion }, project => {
        try { return { project: applyTaskResult(project, task), taskId: task.id }; }
        catch (e) { fail(409, 'stale_result', e.message); }
      });
    }
    const options = { operationId, requestHash: hash, projectId: input.projectId, expectedVersion: input.expectedVersion };
    if (name === 'project_update') return repository.mutateProject(options, project => {
      const next = merge(project, input.patch);
      if (['idea', 'brief', 'culture', 'content', 'art'].some(k => Object.hasOwn(input.patch, k))) next.upstreamChanged = project.upstreamChanged || project.concepts.some(c => c.savedAssetId);
      return { project: next };
    });
    if (name === 'media_import') {
      const current = await getProject(input.projectId); requireVersion(current, input.expectedVersion);
      const p = current.project;
      const isImage = /\.(png|jpg|jpeg|webp)$/.test(input.filename);
      if (input.role === 'image' ? !isImage : isImage || (input.role === 'clip' ? !input.filename.endsWith('.mp4') : !/\.(wav|mp3|m4a)$/.test(input.filename))) fail(400, 'invalid_file', '文件扩展名与导入用途不符。');
      const shot = p.video?.shots.find(s => s.id === input.objectId);
      if (input.role !== 'image' && (p.type !== 'video' || !p.video || (input.role !== 'music' && !shot))) fail(400, 'invalid_input', '请先保存视频分镜，并指定存在的镜头 ID。');
      if (imports >= 2) fail(429, 'busy', '当前正在导入两项文件，请稍后再试。');
      imports++;
      try {
        const bytes = await repository.readInbox(p.id, input.filename);
        const stored = isImage ? await repository.putImage(bytes) : await importMedia(bytes, input.role === 'clip' ? 'mp4' : 'wav', repository, { env, fetchImpl, signal: AbortSignal.timeout(180000) });
        return await repository.mutateProject(options, project => {
          const next = structuredClone(project);
          let assetId;
          if (isImage) {
            assetId = 'a-' + digest(input.requestId).slice(0, 32);
            next.assets.push({ id: assetId, name: input.name, fileId: stored.fileId, source: { provider: 'workbuddy-inbox', originalName: input.filename } });
          } else if (input.role === 'music') next.video.music = { fileId: stored.fileId, duration: stored.duration, source: 'WorkBuddy 对话导入' };
          else {
            const s = next.video.shots.find(s => s.id === input.objectId);
            s[input.role] = { fileId: stored.fileId, duration: stored.duration, source: input.role === 'clip' ? shotSource(s, next.video.ratio) : audioSource(s) };
          }
          return { project: next, fileId: stored.fileId, ...(assetId ? { assetId } : {}) };
        });
      } finally { imports--; }
    }
    fail(404, 'not_found', '核心工具不存在。');
  }
  return { call };
}
