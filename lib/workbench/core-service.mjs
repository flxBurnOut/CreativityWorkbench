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
import { switchWorkType,inheritWorkType,removeInherited,restoreRecord,workflowInputs,flowWarnings,latestRecord,changedDependencies,fingerprint } from './workflow.mjs';
import { importWebsiteSource } from './workflow-delivery.mjs';
import { searchKnowledge, applyKnowledge, knowledgeText } from './knowledge.mjs';
import { fitVideoFrame, inspectVideoFrame } from './video-frame.mjs';
import { videoSpec } from './media-validation.mjs';
import { formatNovel } from './novel-export.mjs';
import { existingImageHandoff } from './handoff-contract.mjs';
import {selectImageResult} from './image-results.mjs';
import {prepareWebsiteStudio} from './website-studio-runtime.mjs';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {themeAssets,searchThemeAssets,themeAssetRecord,applyThemeAssets} from './theme-assets.mjs';
import {craftGenerationStatus} from './craft-runtime.mjs';
import {normalizeCraftPlan} from './craft-contract.mjs';
import {requireTextureConfig} from './craft-texture-config.mjs';
import {defaultTexturePrompt} from './craft-texture-runtime.mjs';
import {requirePatternConfig,existingPatternHandoff,defaultPatternBrief} from './craft-pattern-runtime.mjs';
import {imageConfig} from './adapters/images.mjs';

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
  if(task.kind==='craft-model')return {...value,...existingPatternHandoff(task),next:task.status==='waiting_external'?(task.args?.textureMode==='image'?'读取本任务交接指令，生成平面图案并用 task_complete_handoff 回传同一任务 PNG；Runtime 自动贴图，查询到 result.craftAsset 才完成，不调用 craft_complete_plan。':'读取 handoffInstructions 并调用 craft_complete_plan 接续原任务；不新建任务、不执行脚本。'):task.status==='succeeded'?'实际 Blender 与 GLB 文件已保存，匹配当前需求的结果会自动显示；调用 project_deliver 交付，无需 task_adopt。':['failed','cancelled'].includes(task.status)?'保留旧成品；明确重试时用 craft_generate、新 requestId 和 retryOf。':'task_get 查询原任务，不重复生成。'};
  return { ...value, next: task.supersededBy?`这是已由 ${task.supersededBy} 接替的历史请求；查询后续任务。旧结果仍保留，不代表远端作业已取消。`:task.kind==='website'&&task.args?.guided?(task.status==='succeeded'?'网站源码已接收，网页会显示初稿；用户确认后使用 workflow_update adopt-website-source。无需 task_adopt。':'沿用本次任务读取需求和素材，实现实际网站，再用 website_complete 或原 handoff 输出路径回传 ZIP。不要另建任务。'):task.imageState?.binding==='selected'?'图片已经选用，无需重复采用；网页应显示同一图片。':task.imageState?.ready?(task.imageState.stale?'图片已保存但生成依据有变化，核对后处理；不要自动重做。':'新结果可直接在网页对应对象处对比和选用；对话选用可用 image_select，修改图需实际对比记录。不必先 task_adopt。'):task.result?.videoClip?.validation?.status==='failed' ? '文件已收到但规格不符：可下载检查，先修正首帧或生成要求，不能按合格视频采用。' : task.status === 'succeeded' ? 'task_adopt' : task.status === 'waiting_external' ? '完成 handoff 文件交接，再调用 task_get。' : task.status === 'uncertain' ? '先查询供应商或完成 handoff；确认需要放弃原请求后 task_dismiss，再用新 requestId 和 retryOf 明确重新生成。不要自动重发。' : ['failed','cancelled'].includes(task.status) ? '修正配置或输入后，可用新 requestId 和 retryOf 明确重新生成；同 ID 仅查询原任务。' : 'task_get' };
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
        await available({ role: 'image', name: a.name, assetId: a.id, fileId: a.fileId, path: join(repository.root, 'media', a.fileId + '.png'), url: '/v1/media/' + a.fileId, ...(a.source?.parentAssetId?{visualReview:{origin:'external-report',status:reviews.some(r=>r.changesVisible&&r.preserved&&r.notes.trim())?'reported-pass':'unverified',reviews}}:{}) }, async () => {const {handle}=await repository.openStored(a.fileId,true);await handle.close();});
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
      if(p.craftAsset){
        const stale=changedDependencies(p,latestRecord(p,'craftAsset')).length>0;
        files.push({...file(p.craftAsset.blendFileId,'craft-blender',stale),name:p.craftAsset.title+'.blend',stats:p.craftAsset.stats},
          {...file(p.craftAsset.glbFileId,'craft-preview',stale),name:p.craftAsset.title+'.glb'});
        const patternId=p.craftAsset.texture?.imageFileId;
        if(patternId)await available({role:'craft-pattern',name:p.craftAsset.title+'-图案.png',fileId:patternId,path:join(repository.root,'media',patternId+'.png'),url:'/v1/media/'+patternId,stale},async()=>{const {handle}=await repository.openStored(patternId,true);await handle.close();});
      }
      const outputs = files.filter(f => f.url.startsWith('/v1/files/'));
      for (const item of outputs) { files.splice(files.indexOf(item), 1); await available(item, async () => {const {handle}=await repository.openStored(item.fileId);await handle.close();}); }
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
    if(name==='theme_asset_list'){const result=searchThemeAssets(input.query);return {...result,entries:result.entries.map(e=>({...e,pngPath:fileURLToPath(new URL('../../public'+e.png,import.meta.url)),svgPath:fileURLToPath(new URL('../../public'+e.svg,import.meta.url))}))};}
    if(name==='workflow_get') {const current=await getProject(input.projectId);const p=current.project;const kind=input.kind||['creative','content','art','objects',p.type==='novel'?'novel':p.type==='website'?'website':p.type==='video'?'video-shot':'design-package'][p.stage];return {...current,inputManifest:workflowInputs(p,kind,input.args),warnings:flowWarnings(p),versions:p.flow?.records||[]};}
    if (name === 'workbench_status') return { ...runtimeIdentity(repository), providers: {...generationStatus(env),craft:await craftGenerationStatus(env)}, tools: Object.keys(coreTools),resources:{memory:process.memoryUsage(),caches:repository.cacheStats?.(),mediaProcessLimitMiB:1024},localConversation: true, scope: '项目、文字、主题视觉资产、概念图、单镜头视频、完整正文与媒体向网站交接；网站实现由当前 agent 完成；三维器具与建筑构件由本机 Blender 生成并自动同步，不支持直接编辑或任意雕塑' };
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
      return { tasks: (await tasks.list(input.projectId)).map(t => ({ id: t.id, projectId: t.projectId, kind: t.kind, objectId:t.args?.objectId, guided:Boolean(t.args?.guided),websiteResultFileId:t.result?.websiteSource?.fileId,craftResultFileId:t.result?.craftAsset?.blendFileId,craftPreviewFileId:t.result?.craftAsset?.glbFileId,phase:t.phase, workType:t.workType, status: t.status, dismissed: Boolean(t.dismissed), retryOf: t.retryOf, supersededBy:t.supersededBy,executionStatus:t.executionStatus,imageState:t.imageState,resultAssetId:t.result?.asset?.id,resultFileId:t.result?.asset?.fileId, recoveredAfterCancel: t.recoveredAfterCancel, createdAt: t.createdAt, updatedAt: t.updatedAt, targetName: t.targetName, error: t.error, note: t.note, dispatch: t.dispatch, handoffContract:(existingPatternHandoff(t).handoffContract||existingImageHandoff(t).handoffContract) })) };
    }
    if (name === 'task_get') return publicTask(await tasks.get(input.taskId));
    if(name==='craft_complete_plan')return publicTask(await tasks.completeCraft(input.taskId,input.planJson));
    if(name==='craft_generate') {
      const hash=operationHash(input),priorTask=await repository.task(input.requestId);
      if(priorTask){if(priorTask.clientRequestHash!==hash)fail(409,'conflict','此请求编号已用于另一项制作，请查询原任务。');return publicTask(await tasks.get(input.requestId));}
      if(input.planJson){try{normalizeCraftPlan(JSON.parse(input.planJson));}catch(e){fail(400,'invalid_plan',e.message||'建模方案无效。');}}
      const args={prompt:input.goal,...(input.planJson?{planJson:input.planJson}:{})};
      if(input.textureOf) {
        if(input.planJson)fail(400,'invalid_input','纹理增强不能同时重新建模。');
        const {project}=await getProject(input.projectId);
        const source=[project.craftAsset,...(project.flow?.records||[]).filter(r=>r.type==='craft'&&r.target==='craftAsset').map(r=>r.value)].find(a=>a?.taskId===input.textureOf);
        if(!source)fail(404,'not_found','所选模型版本不属于当前项目，或已不在历史中。');
        if(input.goal!==source.prompt)fail(400,'invalid_input','纹理增强须沿用所选模型的原始需求；只改表面描述请填写 texturePrompt。');
        if(input.textureMode==='image') {
          requirePatternConfig(env,source);
          args.textureMode='image';args.provider=imageConfig(env).provider;
          if(input.dispatch==='conversation')args.handoffOnly=true;
        } else {
          requireTextureConfig(env);
          if(input.textureMode)args.textureMode=input.textureMode;
          if(input.dispatch!==undefined)fail(400,'invalid_input','对话交接仅用于平面图案模式。');
        }
        args.textureSource={...source,warnings:[]};
        args.texturePrompt=input.texturePrompt||(input.textureMode==='image'?defaultPatternBrief(source):defaultTexturePrompt(source));
      } else if(input.texturePrompt||input.textureMode||input.dispatch)fail(400,'invalid_input','纹理选项需要同时指定已有模型 textureOf。');
      const engine=await craftGenerationStatus(env);
      if(!engine.available)fail(503,'craft_engine_unavailable',engine.message||'本机尚未配置 Blender，暂时不能生成真实三维资产。');
      const operationId='craft_generate:'+input.requestId;
      let receipt=await repository.coreReceipt(operationId,hash);
      if(!receipt) {
        const current=await getProject(input.projectId);requireVersion(current,input.expectedVersion);
        if(current.project.type!=='craft')fail(400,'invalid_input','请选择三维文创项目。');
        if(input.textureOf&&input.textureMode!=='image') {
          const pendingTexture=(await repository.listTasks({summary:true})).find(t=>t.args?.textureSource&&t.args.textureMode!=='image'&&!t.dismissed&&!t.textureRemoteDone&&Date.now()-(t.textureSubmittedAt||t.createdAt)<3600000&&(['queued','running','waiting_provider','uncertain'].includes(t.status)||t.status==='cancelled'&&t.textureSubmittedAt));
          if(pendingTexture)fail(429,'texture_busy','已有纹理任务 '+pendingTexture.id+' 尚未结束，请先查询原任务。');
        }
        const pending=(await tasks.list(input.projectId)).find(t=>t.kind==='craft-model'&&!t.dismissed&&!t.supersededBy&&['queued','running','waiting_external','waiting_provider','uncertain'].includes(t.status));
        if(pending)fail(409,'pending_task',`本项目已有三维任务 ${pending.id}，请接续原任务或取消后明确重试。`);
        if(input.retryOf){const old=await repository.task(input.retryOf);if(!old||old.projectId!==input.projectId||old.kind!=='craft-model'||!(['failed','cancelled'].includes(old.status)||old.status==='uncertain'&&old.dismissed))fail(409,'invalid_retry','请重试同项目已失败、取消或核实后的原三维任务。');}
        receipt=await repository.mutateProject({operationId,requestHash:hash,projectId:input.projectId,expectedVersion:input.expectedVersion},p=>{
          const project={...p,craftGoal:input.textureOf?p.craftGoal:input.goal,craftRequest:{goal:input.goal,taskId:input.requestId,requestedAt:Date.now()}};
          return {project,craftSourceHash:digest(taskSource(project,'craft-model',args))};
        });
      }
      const current=await getProject(input.projectId),source=taskSource(current.project,'craft-model',args);
      // The user may already be writing the next goal after this request was
      // recorded. Only fixed generation inputs must match, not unrelated drafts.
      if(receipt.craftSourceHash) {
        if(current.project.craftRequest?.taskId!==input.requestId||current.project.craftRequest.goal!==input.goal||digest(source)!==receipt.craftSourceHash)fail(409,'conflict','本次建模依据已改变，未覆盖新的需求；请核对原任务。');
      } else requireVersion(current,receipt.projectVersion);
      return publicTask(await tasks.submit({id:input.requestId,projectId:input.projectId,kind:'craft-model',args,source,clientRequestHash:hash,...(input.retryOf?{retryOf:input.retryOf}:{})}));
    }
    if(name==='website_complete'){const {taskId,filename,...report}=input;return publicTask(await tasks.completeWebsite(taskId,{filename},report));}
    if(name==='website_run') {
      const hash=operationHash(input),priorTask=await repository.task(input.requestId);
      if(priorTask){if(priorTask.clientRequestHash!==hash)fail(409,'conflict','此请求编号已用于另一项制作，请查询原任务。');return publicTask(await tasks.get(input.requestId));}
      const operationId='website_run:'+input.requestId;
      let receipt=await repository.coreReceipt(operationId,hash);
      if(!receipt){
        const current=await getProject(input.projectId);requireVersion(current,input.expectedVersion);
        if(current.project.type!=='website')fail(400,'invalid_input','请选择网站作品。');
        const pending=(await tasks.list(input.projectId)).find(t=>t.kind==='website'&&!t.dismissed&&!t.supersededBy&&['queued','running','waiting_external','uncertain'].includes(t.status));
        if(pending)fail(409,'pending_task',`本网站已有进行中的任务 ${pending.id}，请接续原任务或先结束等待。`);
        if(input.retryOf){const old=await repository.task(input.retryOf);if(!old||old.projectId!==input.projectId||old.kind!=='website'||!(['failed','cancelled'].includes(old.status)||old.status==='uncertain'&&old.dismissed))fail(409,'invalid_retry','请接续同一项目已失败、取消或已核实的原网站任务。');}
        const prepared=await prepareWebsiteStudio(current.project,input,repository);
        receipt=await repository.mutateProject({operationId,requestHash:hash,projectId:input.projectId,expectedVersion:input.expectedVersion},()=>({project:prepared}));
      }
      const current=await getProject(input.projectId);requireVersion(current,receipt.projectVersion);
      const args={action:'generate',provider:'workbuddy',guided:true,handoffOnly:input.dispatch==='conversation'};
      return publicTask(await tasks.submit({id:input.requestId,projectId:input.projectId,kind:'website',args,source:taskSource(current.project,'website',args),clientRequestHash:hash,...(input.retryOf?{retryOf:input.retryOf}:{})}));
    }
    if (name === 'task_complete_handoff') return publicTask(await tasks.completeHandoff(input.taskId,input.filename?{filename:input.filename}:{assetId:input.assetId}));
    if (name === 'task_dismiss') return publicTask(await tasks.dismiss(input.taskId,input.replacementTaskId));
    if (name === 'task_cancel') return publicTask(await tasks.cancel(input.taskId));
    if (name === 'project_deliver') return deliver(input);
    if (name === 'task_start') {
      if(input.kind==='craft-model')fail(400,'use_craft_generate','三维资产请使用 craft_generate，任务与页面结果由该操作统一关联。');
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
    if (prior) { if (name === 'task_adopt'||name==='image_select'&&input.taskId) await tasks.dismiss(input.taskId); return { ...prior, replayed: true }; }
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
    if(name==='image_select') {
      const task=input.taskId?await tasks.get(input.taskId):undefined;
      if(input.taskId&&!task)fail(404,'not_found','图片任务不存在，请先刷新状态。');
      const result=await repository.mutateProject(options,p=>{
        try{return {project:selectImageResult(p,{...input,task}),selectedAssetId:task?.result?.asset?.id||input.assetId};}
        catch(e){fail(409,'image_selection_conflict',e.message);}
      });
      if(task)await tasks.dismiss(task.id);
      return result;
    }
    if(name==='theme_asset_apply') {
      const current=await getProject(input.projectId);requireVersion(current,input.expectedVersion);
      const entries=input.entryIds.map(id=>themeAssets.find(e=>e.id===id));
      if(entries.some(e=>!e)||new Set(input.entryIds).size!==input.entryIds.length)fail(400,'invalid_input','主题素材不存在或选择重复，请先 theme_asset_list。');
      const assets=[];
      for(const entry of entries){const stored=await repository.putImage(await readFile(new URL('../../public'+entry.png,import.meta.url)));assets.push(themeAssetRecord(entry,{fileId:stored.fileId}));}
      return repository.mutateProject(options,p=>({project:applyThemeAssets(p,assets),assetIds:assets.map(a=>a.id)}));
    }
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
        if(input.action==='remove-inherited')return {project:removeInherited(p,input.from)};
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
