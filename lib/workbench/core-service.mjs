import { websiteVerification } from './website-verification.mjs';
import { join } from 'node:path';
import { cleanupStorage } from './storage-maintenance.mjs';
import { coreTools } from './core-contract.mjs';
import { createProject, applyTaskResult } from './project-core.mjs';
import { digest, record } from './repository.mjs';
import { taskSource } from './task-contract.mjs';
import { shotSource, audioSource, composeSource } from './output-contract.mjs';
import { importMedia } from './video-media.mjs';
import { generationStatus } from './generation.mjs';
import { ServiceError } from './errors.mjs';
import { buildVideoPrompt, videoPromptBasis, buildWebsitePrompt, websitePromptBasis, websiteAssetIds, assetRoles, imagePrompt, framePrompt, websiteRequestSource, PROMPT_VERSION } from './prompts.mjs';
import { switchWorkType,inheritWorkType,restoreRecord,workflowInputs,flowWarnings,latestRecord,changedDependencies,fingerprint } from './workflow.mjs';
import { importWebsiteSource } from './workflow-delivery.mjs';
import { searchKnowledge, applyKnowledge, knowledgeText } from './knowledge.mjs';
import { fitVideoFrame, inspectVideoFrame } from './video-frame.mjs';
import { videoSpec } from './media-validation.mjs';
import { formatNovel } from './novel-export.mjs';

export { CORE_PROTOCOL } from './protocol.mjs';
import { CORE_PROTOCOL } from './protocol.mjs';
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
const operationHash = input => { const { expectedVersion: _version, ...operation } = input; return digest(operation); };
const publicTask = task => {
  if (!task) fail(404, 'not_found', '任务不存在。');
  const { source: _source, clientRequestHash: _clientRequestHash, ...value } = task;
  return { ...value, next: task.result?.videoClip?.validation?.status==='failed' ? '文件已收到但规格不符：可下载检查，先修正首帧或生成要求，不能按合格视频采用。' : task.status === 'succeeded' ? 'task_adopt' : task.status === 'waiting_external' ? '完成 handoff 文件交接，再调用 task_get。' : task.status === 'uncertain' ? '先查询供应商或完成 handoff；确认需要放弃原请求后 task_dismiss，再用新 requestId 和 retryOf 明确重新生成。不要自动重发。' : ['failed','cancelled'].includes(task.status) ? '修正配置或输入后，可用新 requestId 和 retryOf 明确重新生成；同 ID 仅查询原任务。' : 'task_get' };
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
    const files = []; const missing = [];
    async function available(item, read) { try { await read(); files.push(item); } catch (e) { if (!(e instanceof ServiceError) || e.status !== 404) throw e; missing.push({ role: item.role, fileId: item.fileId, error: e.message }); } }
    if (p.novel?.text.trim()) {
      for (const ext of input.format === 'all' ? ['txt', 'md'] : [input.format]) {
        const text = formatNovel(p.novel,ext);
        files.push({ role: 'novel', stale: changedDependencies(p,latestRecord(p,'novel')).length>0, ...await repository.exportText(text, ext) });
      }
    }
    if (input.format !== 'all' && !files.length) fail(400, 'missing_text', '尚未保存小说正文，请先通过 project_update 或正文任务保存。');
    if (input.format === 'all') {
      if(p.knowledge?.length)files.push({role:'theme-knowledge',...await repository.exportText(knowledgeText(p),'md')});
      for (const a of p.assets) {
        const reviews=p.concepts.filter(c=>c.savedAssetId===a.id&&c.imageReview?.assetId===a.id).map(c=>({conceptId:c.id,...c.imageReview}));
        await available({ role: 'image', name: a.name, assetId: a.id, fileId: a.fileId, path: join(repository.root, 'media', a.fileId + '.png'), url: '/v1/media/' + a.fileId, ...(a.source?.parentAssetId?{visualReview:{origin:'external-report',status:reviews.some(r=>r.changesVisible&&r.preserved&&r.notes.trim())?'reported-pass':'unverified',reviews}}:{}) }, () => repository.media(a.fileId));
      }
      for (const s of p.video?.shots || []) {
        if (s.clip) files.push({...file(s.clip.fileId, 'clip:' + s.id, s.clip.source !== shotSource(s, p.video.ratio,p)),specification:videoSpec(s.clip,p.video.ratio,s.duration)});
        if (s.audio) files.push(file(s.audio.fileId, 'audio:' + s.id, s.audio.source !== audioSource(s,p)));
      }
      if (p.video?.music) files.push(file(p.video.music.fileId, 'music'));
      if (p.video?.final) {
        const stale = p.video.final.source !== composeSource(p.video,p);
        files.push(file(p.video.final.fileId, 'video', stale), file(p.video.final.subtitleFileId, 'subtitles', stale));
      }
      const staleSite = p.website && JSON.stringify(p.website.spec) !== JSON.stringify(p.website.builtSpec);
      if (p.website?.previewFileId) files.push(file(p.website.previewFileId, 'website-preview', staleSite));
      if (p.website?.zipFileId) files.push(file(p.website.zipFileId, 'website-zip', staleSite));
      if (p.websiteRequest) {
        files.push({role:'website-prompt',stale:p.websiteRequest.basis!==websitePromptBasis(p),...await repository.exportText(p.websiteRequest.prompt,'md')});
        if (p.websiteRequest.bundleFileId) files.push(file(p.websiteRequest.bundleFileId,'website-request-bundle',p.websiteRequest.source!==websiteRequestSource(p)));
      }
      if(p.websiteSource)files.push({...file(p.websiteSource.fileId,'website-source'),verification:websiteVerification(p.websiteSource)});
      if(p.websiteSourceCandidate)files.push({...file(p.websiteSourceCandidate.fileId,'website-source-candidate'),verification:websiteVerification(p.websiteSourceCandidate)});
      if(p.designPackage)files.push(file(p.designPackage.fileId,'design-package',p.designPackage.source!==fingerprint(workflowInputs(p,'design-package'))));
      const outputs = files.filter(f => f.url.startsWith('/v1/files/'));
      for (const item of outputs) { files.splice(files.indexOf(item), 1); await available(item, () => repository.output(item.fileId)); }
    }
    return { projectId: p.id, projectVersion, files, missing, guidance:p.type==='novel'&&!p.novel?.text?.trim()&&p.content.novel.story?'content.novel.story 是故事方案，不是可交付正文；请把完整正文写入 novel.title 与 novel.text，再导出。':undefined, partial: missing.length > 0 || files.some(f=>f.specification?.status==='failed'||f.verification?.result==='failed'), limitations: p.website?.spec.limitations || [], note: missing.length ? '部分文件缺失，可交付文件仍可下载；请按 missing 列表恢复备份或重新生成。' : files.length ? '文件已可读取。stale 仅表示依据是否变化；specification 单独记录媒体规格，文件存在不等于规格或交互通过。' : '还没有可交付文件。' };
  }
  async function call(name, raw) {
    const tool = coreTools[name];
    if (!tool) fail(404, 'not_found', '核心工具不存在。');
    const parsed = tool.schema.safeParse(raw);
    if (!parsed.success) fail(400, 'invalid_input', parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).slice(0, 8).join('; '));
    const input = parsed.data;
    if(name==='workbench_call_json') {
      let args;try { args=JSON.parse(input.argumentsJson); } catch { fail(400,'invalid_input','argumentsJson 必须是有效 JSON 对象，不是代码或转义两次的字符串。'); }
      if(!record(args))fail(400,'invalid_input','argumentsJson 顶层必须是 JSON 对象。');
      return call(input.tool,args);
    }
    if (name === 'knowledge_search') return searchKnowledge(input.query, input.region);
    if(name==='workflow_get') {const current=await getProject(input.projectId);const p=current.project;const kind=input.kind||['creative','content','art','objects',p.type==='novel'?'novel':p.type==='website'?'website':p.type==='video'?'video-shot':'design-package'][p.stage];return {...current,inputManifest:workflowInputs(p,kind,input.args),warnings:flowWarnings(p),versions:p.flow?.records||[]};}
    if (name === 'workbench_status') return { ...runtimeIdentity(repository), providers: generationStatus(env), tools: Object.keys(coreTools), localConversation: true, scope: '项目、文字、美术、概念图、单镜头视频、网站生成提示词与素材交接；网站实现由当前 agent 完成；3D 未实现' };
    if (name === 'prompt_prepare') {
      const current=await getProject(input.projectId); const p=current.project;
      if(input.kind==='website') {
        if(p.type!=='website')fail(400,'invalid_input','请选择网站项目。');
        return {prompt:buildWebsitePrompt(p),basis:websitePromptBasis(p),assetIds:websiteAssetIds(p),assets:assetRoles(p,websiteAssetIds(p)),projectVersion:current.projectVersion,promptVersion:PROMPT_VERSION,scope:'网站生成提示词；由执行 agent 完整实现'};
      }
      if(input.kind==='video-shot') {
        const s=p.video?.shots.find(s=>s.id===input.args.objectId);
        if(p.type!=='video'||!s)fail(400,'invalid_input','先保存一个镜头；无需生成分镜。');
        return {prompt:buildVideoPrompt(p,s),basis:videoPromptBasis(p,s),projectVersion:current.projectVersion,promptVersion:PROMPT_VERSION,frameCheck:await inspectVideoFrame(p,s,repository),parameters:{duration:s.duration,ratio:p.video.ratio,referenceAssetId:s.referenceAssetId,referenceRole:s.referenceAssetId?'first-frame':undefined},assets:assetRoles(p,s.referenceAssetId?[s.referenceAssetId]:[]).filter(a=>a.role==='output')};
      }
      if(input.kind==='video-frame') {if(p.type!=='video'||!p.video?.shots.some(s=>s.id===input.args.objectId))fail(400,'invalid_input','请先保存本镜头。');const result=framePrompt(p,{action:'generate',ratio:'3:2',...input.args});return {prompt:result.prompt,inputImages:result.imageIds,projectVersion:current.projectVersion,promptVersion:PROMPT_VERSION};}
      if(input.kind==='image'&&!p.concepts.some(c=>c.id===input.args.objectId))fail(400,'invalid_input','请选择概念对象。');
      const prepared=imagePrompt(p,{action:'generate',ratio:'1:1',...input.args},input.kind);
      return {prompt:prepared.prompt,projectVersion:current.projectVersion,promptVersion:PROMPT_VERSION,inputImages:prepared.imageIds.map(id=>({assetId:id,url:'/v1/media/'+p.assets.find(a=>a.id===id)?.fileId}))};
    }
    if (name === 'project_list') {
      const saved = await repository.loadWorkspace();
      return { revision: saved.revision, total: saved.workspace.projects.length, nextOffset: input.offset + input.limit < saved.workspace.projects.length ? input.offset + input.limit : null, projects: saved.workspace.projects.slice(input.offset, input.offset + input.limit).map(p => ({ id: p.id, title: p.title, type: p.type, stage: p.stage, updatedAt: p.updatedAt, projectVersion: digest(p) })) };
    }
    if (name === 'storage_cleanup') return cleanupStorage(repository, input);
    if (name === 'workspace_recover') return repository.recoverWorkspace(input);
    if (name === 'project_get') { const current=await getProject(input.projectId); return { ...current, knowledgeContext:knowledgeText(current.project), inbox: await repository.inbox(input.projectId) }; }
    if (name === 'task_list') {
      await getProject(input.projectId);
      return { tasks: (await tasks.list(input.projectId)).map(t => ({ id: t.id, projectId: t.projectId, kind: t.kind, status: t.status, dismissed: Boolean(t.dismissed), retryOf: t.retryOf, recoveredAfterCancel: t.recoveredAfterCancel, createdAt: t.createdAt, updatedAt: t.updatedAt, targetName: t.targetName, error: t.error, note: t.note, dispatch: t.dispatch })) };
    }
    if (name === 'task_get') return publicTask(await tasks.get(input.taskId));
    if (name === 'task_dismiss') return publicTask(await tasks.dismiss(input.taskId));
    if (name === 'task_cancel') return publicTask(await tasks.cancel(input.taskId));
    if (name === 'project_deliver') return deliver(input);
    if (name === 'task_start') {
      const hash = operationHash(input);
      const prior = await repository.task(input.requestId);
      if (prior) {
        if (prior.clientRequestHash !== hash && prior.clientRequestHash !== digest(input)) fail(409, 'conflict', '此任务 requestId 已用于另一请求。重试时保留原参数。');
        return publicTask(await tasks.get(input.requestId));
      }
      const current = await getProject(input.projectId); requireVersion(current, input.expectedVersion);
      const args = { ...input.args };
      if (input.kind === 'creative') args.action ??= 'improve';
      if (['content', 'novel', 'video-plan', 'website', 'image','video-frame'].includes(input.kind)) args.action ??= 'generate';
      if (input.kind === 'website') args.handoffOnly = true;
      if (['image', 'cover','video-frame', 'video-shot', 'video-audio'].includes(input.kind)) {
        args.provider ??= input.kind === 'video-audio' ? 'workbuddy' : ['image','cover','video-frame'].includes(input.kind) ? generationStatus(env).images.provider : generationStatus(env).video.provider;
        if (args.provider === 'workbuddy' || input.kind === 'video-audio') args.handoffOnly = true;
      }
      if (['image', 'cover','video-frame'].includes(input.kind)) args.ratio ??= input.kind==='video-frame'?'3:2':'1:1';
      return publicTask(await tasks.submit({ id: input.requestId, projectId: input.projectId, kind: input.kind, args, source: taskSource(current.project, input.kind, args), clientRequestHash: hash, ...(input.retryOf ? { retryOf: input.retryOf } : {}) }));
    }
    // Mutation receipts are committed atomically with the project. Adoption is keyed by task.
    const operationId = name + ':' + (input.requestId || input.taskId);
    const hash = name === 'task_adopt' ? digest({ taskId: input.taskId,...(input.objectIds?{objectIds:input.objectIds}:{}),...(input.sectionKeys?{sectionKeys:input.sectionKeys}:{}) }) : operationHash(input);
    const prior = await repository.coreReceipt(operationId, hash, digest(input));
    if (prior) { if (name === 'task_adopt') await tasks.dismiss(input.taskId); return { ...prior, replayed: true }; }
    if (name === 'project_create') {
      const project = createProject(input.idea, input.type, input.title, 'p-' + digest(input.requestId).slice(0, 32));
      return repository.mutateProject({ operationId, requestHash: hash, legacyHash: digest(input), projectId: project.id, create: true }, () => ({ project }));
    }
    if (name === 'task_adopt') {
      const task = await tasks.get(input.taskId);
      if (!task) fail(404, 'not_found', '任务不存在。');
      if (task.status !== 'succeeded') fail(409, 'not_ready', '任务尚未成功，不能采用。');
      const adopted = await repository.mutateProject({ operationId, requestHash: hash, legacyHash: digest(input), projectId: task.projectId, expectedVersion: input.expectedVersion }, project => {
        const shot=project.video?.shots.find(s=>s.id===task.args.objectId);
        const spec=task.result?.videoClip&&shot&&videoSpec(task.result.videoClip,project.video.ratio,shot.duration);
        if(spec?.status==='failed')fail(409,'nonconforming_media','视频规格未通过，文件保留。'+spec.issues.join(' '));
        try { return { project: applyTaskResult(project, task,input), taskId: task.id }; }
        catch (e) { fail(409, 'stale_result', e.message); }
      });
      await tasks.dismiss(input.taskId);
      return adopted;
    }
    const options = { operationId, requestHash: hash, legacyHash: digest(input), projectId: input.projectId, expectedVersion: input.expectedVersion };
    if(name==='video_frame_fit') {
      const current=await getProject(input.projectId);requireVersion(current,input.expectedVersion);
      const shot=current.project.video?.shots.find(s=>s.id===input.objectId);
      if(current.project.type!=='video'||!shot)fail(400,'invalid_input','请先保存并选择一个视频镜头。');
      const next=await fitVideoFrame(current.project,shot,input.fit,repository,input.requestId);
      return repository.mutateProject(options,()=>({project:next,frameAssetId:next.video.shots.find(s=>s.id===shot.id).referenceAssetId}));
    }
    if(name==='workflow_update')return repository.mutateProject(options,p=>{
      try {
        if(input.action==='inherit')return {project:inheritWorkType(p,input.from,input)};
        if(input.action==='restore')return {project:restoreRecord(p,input.recordId)};
        if(!p.websiteSourceCandidate)fail(400,'missing_source','没有待采用的网站源码。');
        if(p.websiteSourceCandidate.requestSource&&p.websiteSourceCandidate.requestSource!==websiteRequestSource(p))fail(409,'stale_result','网站依据已变化，源码候选保留；请核对并生成新任务。');
        return {project:{...p,websiteSource:p.websiteSourceCandidate,websiteSourceCandidate:undefined}};
      }catch(e){if(e instanceof ServiceError)throw e;fail(400,'invalid_input',e.message);}
    });
    if(name==='website_source_import') {
      const current=await getProject(input.projectId);requireVersion(current,input.expectedVersion);if(current.project.type!=='website')fail(400,'invalid_input','请选择网站项目。');
      const task=input.taskId?await tasks.get(input.taskId):null;
      if(input.taskId&&(!task||task.projectId!==input.projectId||task.kind!=='website'||task.status!=='succeeded'))fail(400,'invalid_input','请选择本项目已准备的网站任务。');
      const bytes=await repository.readInbox(input.projectId,input.filename);
      const candidate=await importWebsiteSource(bytes,repository,{...input,requestSource:task?.result?.websiteRequest?.source});
      return repository.mutateProject(options,p=>({project:{...p,websiteSourceCandidate:candidate},fileId:candidate.fileId}));
    }
    if (name === 'knowledge_apply') return repository.mutateProject(options, project => {
      try { return { project:applyKnowledge(project,input.entryIds,input.mode) }; }
      catch(e) { fail(400,'invalid_input',e.message); }
    });
    if (name === 'project_update') return repository.mutateProject(options, project => {
      const base=input.patch.type?switchWorkType(project,input.patch.type):project;
      const next = merge(base, input.patch);
      if (['idea', 'brief', 'culture', 'content', 'art'].some(k => Object.hasOwn(input.patch, k))) next.upstreamChanged = project.upstreamChanged || project.concepts.some(c => c.savedAssetId);
      return { project: next };
    });
    if (name === 'media_import') {
      const current = await getProject(input.projectId); requireVersion(current, input.expectedVersion);
      const p = current.project;
      const isImage = /\.(png|jpg|jpeg|webp)$/.test(input.filename);
      if (input.role === 'image' ? !isImage : isImage || (input.role === 'clip' ? !input.filename.endsWith('.mp4') : !/\.(wav|mp3|m4a)$/.test(input.filename))) fail(400, 'invalid_file', '文件扩展名与导入用途不符。');
      const shot = p.video?.shots.find(s => s.id === input.objectId);
      if (input.role !== 'image' && (p.type !== 'video' || !p.video || (input.role !== 'music' && !shot))) fail(400, 'invalid_input', '请先保存视频镜头，并指定存在的镜头 ID；无需先生成分镜。');
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
            s[input.role] = { ...stored,...(input.role==='clip'?{validation:videoSpec(stored,next.video.ratio,s.duration)}:{}), source: input.role === 'clip' ? shotSource(s, next.video.ratio,next) : audioSource(s,next) };
          }
          return { project: next, fileId: stored.fileId, importedSource: { projectId: p.id, filename: input.filename, hash: digest(bytes) }, ...(assetId ? { assetId } : {}) };
        });
      } finally { imports--; }
    }
    fail(404, 'not_found', '核心工具不存在。');
  }
  return { call };
}
