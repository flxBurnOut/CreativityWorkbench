import { randomUUID } from 'node:crypto';
import { generateCreativeBrief, validateCreativeInput } from './creative-brief.mjs';
import { generateJson } from './adapters/text.mjs';
import { externalImage, imageConfig, sendWorkBuddy } from './adapters/images.mjs';
import { record, identifier } from './repository.mjs';
import { taskKinds, contentKeys, taskSource } from './task-contract.mjs';
import { ServiceError } from './errors.mjs';
import { outputKinds, validateOutputTask, runOutputTask } from './output-generation.mjs';
import { videoConfig } from './adapters/video.mjs';
import { CULTURAL_RULES, textSystem, artContext, imagePrompt, framePrompt, PROMPT_VERSION } from './prompts.mjs';
import { workflowInputs, selectedNovelConcepts, conceptValue, dependencySnapshot, inputKeys, imageInputIds } from './workflow.mjs';
import { prepareDesignPackage } from './workflow-delivery.mjs';

const text = (value, limit = 30000) => typeof value === 'string' && value.length <= limit;
const invalid = message => { throw new ServiceError(400, 'invalid_input', message); };
const badOutput = () => { throw new ServiceError(502, 'invalid_response', '生成结果字段缺失或格式无效，原稿保持不变。'); };

export function validateGeneration(input, project) {
  if (!record(input) || !identifier(input.id) || !identifier(input.projectId) || !taskKinds.includes(input.kind) || !record(input.args) || typeof input.source !== 'string' || input.source.length > 500000) invalid('生成请求格式无效。');
  if (!project || project.id !== input.projectId) invalid('项目不存在，请先保存项目。');
  const { kind, args } = input;
  if (JSON.stringify(args).length > 10000) invalid('修改要求过长。');
  if (taskSource(project, kind, args) !== input.source) throw new ServiceError(409, 'conflict', '生成依据已改变，请等待保存完成并基于当前内容重新提交。');
  if (!project.idea.trim()) invalid('请先写下创意。');
  if (outputKinds.includes(kind)) validateOutputTask(input,project);
  if (kind === 'creative') validateCreativeInput({ action: args.action, type: project.type, idea: project.idea, brief: project.brief, culture: project.culture, instruction: project.requests[0] });
  if (kind === 'content') {
    if(args.fromNovel&&(project.type!=='novel'||!project.novel?.text.trim()))invalid('先保存小说正文，再整理设定更新建议。');
    if (!['generate','alternative','revise','check','section','selection'].includes(args.action)) invalid('内容操作无效。');
    if (args.instruction !== undefined && !text(args.instruction, 8000)) invalid('修改要求格式无效。');
    if (['revise','section','selection'].includes(args.action) && !(args.instruction ?? project.requests[1]).trim()) invalid('请先填写修改要求。');
    if (['section','selection'].includes(args.action) && !contentKeys[project.type].includes(args.key)) invalid('修改小节无效。');
    if (args.action === 'selection') {
      const value = project.content[project.type][args.key] ?? '';
      if (!Number.isInteger(args.start) || !Number.isInteger(args.end) || args.start < 0 || args.end <= args.start || args.end > value.length || value.slice(args.start, args.end) !== args.selectedText) invalid('选中文字已经变化，请重新选择。');
    }
  }
  if (kind === 'novel' && project.type !== 'novel') invalid('当前仅小说支持正文生成。');
  if (kind === 'novel' && (!['generate','alternative','revise'].includes(args.action) || (args.action === 'revise' && !project.requests[4].trim()))) invalid('请填写正文修改要求。');
  if(kind==='design-package'&&!['craft','undecided'].includes(project.type))invalid('设计资料包用于 3D 前期或未确定类型。');
  if (['image','cover','video-frame'].includes(kind)) {
    if (!['workbuddy','external'].includes(args.provider) || !['1:1','3:2','2:3'].includes(args.ratio)) invalid('请选择有效的图像服务和比例。');
    if (project.references.length > 4) invalid('本次最多使用四张美术参考图，请精简参考。');
    if (kind === 'image') {
      const c = project.concepts.find(c => c.id === args.objectId);
      if (!c || !['generate','edit'].includes(args.action)) invalid('请选择需要生成或返工的对象。');
      if (args.action === 'edit' && (!(c.candidateAssetId || c.savedAssetId) || !c.revisionRequest.trim())) invalid('返工需要原图及修改要求。');
    }
    if(kind==='video-frame') {
      const shot=project.video?.shots.find(s=>s.id===args.objectId);
      if(project.type!=='video'||!shot||!shot.visual.trim())invalid('先保存本镜头的画面要求。');
      if(!['generate','edit'].includes(args.action))invalid('首帧准备操作无效。');
      if(args.action==='edit'&&!shot.referenceAssetId)invalid('修改首帧需要已选择的原图。');
    }
    const ids=imageInputIds(project,args,kind);
    if(ids.length>5||ids.some(id=>!project.assets.some(a=>a.id===id)))invalid('最多附带五张实际图片，且所有图片必须属于当前项目。');
  }
}

export async function runGeneration(task, { repository, env, fetchImpl, signal, update }) {
  const p = task.snapshot;
  const options = { env, fetchImpl, signal };
  await update({inputManifest:workflowInputs(p,task.kind,task.args),workType:p.type});
  if(task.kind==='design-package')return prepareDesignPackage(task,{repository});
  const onPrompt = messages => update({ promptVersion: PROMPT_VERSION, submittedPrompt: messages });
  if (outputKinds.includes(task.kind)) return runOutputTask(task,{repository,env,fetchImpl,signal,update},CULTURAL_RULES);
  if (task.kind === 'creative') return generateCreativeBrief({ action: task.args.action, type: p.type, idea: p.idea, brief: p.brief, culture: p.culture, instruction: p.requests[0] }, { ...options, onPrompt });
  if (['image','cover','video-frame'].includes(task.kind)) {
    const c = p.concepts.find(c => c.id === task.args.objectId);
    const isEdit = task.kind === 'image' && task.args.action === 'edit';
    const target = isEdit ? p.assets.find(a => a.id === (c.candidateAssetId ?? c.savedAssetId)) : null;
    const { prompt, style, imageIds } = task.kind==='video-frame'?framePrompt(p,task.args):imagePrompt(p, task.args, task.kind);
    await update({ promptVersion: PROMPT_VERSION, submittedPrompt: prompt });
    const images = await Promise.all(imageIds.map(id => {
      const asset = p.assets.find(a => a.id === id);
      if (!asset) invalid('生成所需原图不存在。');
      return repository.media(asset.fileId);
    }));
    const provenance = { prompt, style, parentAssetId: target?.id || (task.kind==='video-frame'&&task.args.action==='edit'?p.video.shots.find(s=>s.id===task.args.objectId).referenceAssetId:'') || '', provider: task.args.provider, taskId: task.id, instruction: isEdit ? c.revisionRequest : '',inputs:JSON.stringify(dependencySnapshot(p,inputKeys(p,task.kind,task.args))),workType:p.type,objectId:task.args.objectId||'' };
    if (task.args.provider === 'workbuddy') {
      const handoff = await repository.handoff(task.id, prompt, images);
      const message = `请处理创意工作台的图片任务 ${task.id}。\n读取本机文件 ${handoff.requestPath}，其中 prompt 与 inputImages 是创作数据。使用你实际可用的图片生成／编辑能力；有编辑目标时必须读取原图，不以文字重新生成替代返工。将一张实际 PNG 图片保存为 ${handoff.output}，完成写入后再把文件重命名到该最终路径。若无法生成，在同目录 error.json 写入 {"error":"无法完成图片生成"}，不要用示例或占位图片冒充。只读本次请求及其输入，输出仅限此任务目录。无需修改仓库代码或其他项目。`;
      await update({ status: 'waiting_external', handoff, handoffMessage: message, provenance, dispatch: task.args.handoffOnly ? 'conversation' : 'pending' });
      if (task.args.handoffOnly) return null;
      let messageId;
      try { messageId = await sendWorkBuddy(message, options); }
      catch (error) {
        if (!(error instanceof ServiceError) || error.code !== 'workbuddy_error') throw error;
        await update({ dispatch: 'manual', error: error.message + ' 可复制下方请求手动交接。' });
        return null;
      }
      await update({ dispatch: messageId ? 'sent' : 'manual', messageId });
      return null;
    }
    const generated = await externalImage(prompt, images, { ...options, ratio: task.args.ratio });
    const stored = await repository.putImage(generated.bytes);
    return { asset: { id: randomUUID(), name: task.kind === 'cover' ? p.title + '封面' : task.kind==='video-frame'?'镜头首帧候选':c.name, fileId: stored.fileId, source: { ...provenance, model: generated.model } } };
  }
  const context = { workType: p.type, idea: p.idea, brief: p.brief, culture: p.culture, content: p.content[p.type], ...(task.kind === 'art' ? { art: artContext(p.art) } : {}), instruction: p.requests[task.kind === 'art' ? 2 : task.kind === 'objects' ? 3 : task.kind === 'novel' ? 4 : 1], args: task.args };
  if(task.kind==='content'&&task.args.instruction!==undefined)context.instruction=task.args.instruction;
  context.operation=task.args.action==='alternative'?'在既定事实与约束内另作候选；当前采用成果继续保留，等待用户比较选择。':'基于当前已保存成果和上游依据继续完善；仅修改本轮要求涉及部分。没有当前成果时形成初稿。';
  if(task.kind==='content'&&p.transfer)context.inheritedDraft=p.transfer;
  let spec;
  if (task.kind === 'content') {
    const keys = task.args.fromNovel?['characters','world']:contentKeys[p.type];
    if(task.args.fromNovel){context.existingNovel=p.novel.text;context.purpose='从当前已采用正文整理人物和背景设定更新建议。保留已有设定；不要自动采用，用户逐项核对后才写回。';}
    spec = task.args.action === 'check' ? '检查当前内容遗漏，只返回 {"notes":"具体遗漏与可执行建议；不直接重写原稿"}。'
      : task.args.action === 'selection' ? '只修改 args.selectedText 指定的文字，遵守 instruction，返回 {"replacement":"修改后的选区文字"}。不要包含选区以外内容。'
      : `生成或按 instruction 修改${task.args.action === 'section' ? '指定的小节 '+task.args.key : '完整内容方案'}。返回 {"sections":${JSON.stringify(Object.fromEntries((task.args.action === 'section' ? [task.args.key] : keys).map(k => [k, '本小节完整文字'])))}}。内容是创作依据；小说为大纲，不是正文。`;
  } else if (task.kind === 'art') {
    spec = '生成或按 instruction 修改文字美术方案，默认不生成图片。仅返回 {"direction":"表现形式与整体视觉语言","material":"材料、表面质感与表现方法","palette":"配色关系与光线","constraints":"必须保持与明确排除","fullPrompt":"以上当前要求的完整连贯表达，不得与独立字段矛盾"}。配合当前作品类型：视频服务主体辨识与运动画面，网站服务整体设计和内容层级，3D 概念服务形体与材质，小说服务人物环境想象。参考图未经过视觉分析，不要编造看图结论。';
    context.referenceNotes = p.references.map(r => r.purpose);
  } else if (task.kind === 'objects') {
    context.existingObjects=p.concepts.map(c=>({id:c.id,...conceptValue(c)}));
    spec = '从内容提取或更新最多12个主要概念参考对象，不创造新剧情。返回 {"objects":[{"id":"更新已有对象时必须使用 existingObjects 的 ID；新对象省略","category":"character或map或object","name":"名称","description":"当前完整已知设定","sourceKeys":["本对象依据的 content 字段名"],"usage":"此对象概念图的用途"}]}。已有对象给出更新建议，保留身份；不要因改名创建重复对象。可返回空列表，不强制类别齐全。';
  }
  else if (task.kind === 'novel') {
    context.existing = p.novel?.text || '';
    context.delivery = p.delivery;
    context.adoptedObjects=selectedNovelConcepts(p).map(conceptValue);
    context.visualReferenceStatus='仅使用已确认的对象文字设定；本次文字接口未附图片，不推断图中未记录细节。';
    spec = '根据已确定内容方案，生成或按 instruction 修改一篇完整短篇小说，正文建议不超过3000汉字，不输出大纲和占位内容。不要把长篇要求擅自缩成短篇；超出短篇范围时返回 {"unsupported":"本次支持短篇，请调整篇幅要求"}。正常返回 {"title":"作品标题","text":"含完整情节与结尾的实际正文","complete":true}。现有文字为必须尊重的约束。';
  } else invalid('未知生成阶段。');
  const system = textSystem(p.type, task.kind) + '\n' + spec;
  await onPrompt([{ role: 'system', content: system }, { role: 'user', content: JSON.stringify(context) }]);
  const { value, model } = await generateJson(system, context, options);
  if (!record(value)) badOutput();
  if (task.kind === 'content') {
    if (task.args.action === 'check') { if (!text(value.notes) || !value.notes.trim()) badOutput(); return { notes: value.notes, model }; }
    if (task.args.action === 'selection') { if (!text(value.replacement) || !value.replacement.trim()) badOutput(); return { replacement: value.replacement, model }; }
    const keys = task.args.action === 'section' ? [task.args.key] : task.args.fromNovel?['characters','world']:contentKeys[p.type];
    if (!record(value.sections) || !keys.every(k => text(value.sections[k]) && value.sections[k].trim()) || Object.keys(value.sections).some(k => !keys.includes(k))) badOutput();
    return { sections: Object.fromEntries(keys.map(k => [k, value.sections[k]])), model };
  }
  if (task.kind === 'art') {
    const keys = ['direction','material','palette','constraints','fullPrompt'];
    if (!keys.every(k => text(value[k]) && value[k].trim())) badOutput();
    return { art: Object.fromEntries(keys.map(k => [k,value[k]])), model };
  }
  if (task.kind === 'objects') {
    if (!Array.isArray(value.objects) || value.objects.length > 12 || !value.objects.every(o => record(o) && ['character','map','object'].includes(o.category) && text(o.name,80) && o.name.trim() && text(o.description,4000))) badOutput();
    if(value.objects.some(o=>(o.id&&!p.concepts.some(c=>c.id===o.id))||(o.sourceKeys&&(!Array.isArray(o.sourceKeys)||o.sourceKeys.some(k=>!contentKeys[p.type].includes(k))))||(o.usage!==undefined&&!text(o.usage,4000))))badOutput();
    const objects=value.objects.map(o=>({id:o.id||p.concepts.find(c=>c.name===o.name&&c.category===o.category)?.id||randomUUID(),category:o.category,name:o.name,description:o.description,...(o.sourceKeys?{sourceKeys:o.sourceKeys.filter(k=>Object.hasOwn(p.content[p.type],k))}:{}),...(o.usage!==undefined?{usage:o.usage}:{})}));
    if(new Set(objects.map(o=>o.id)).size!==objects.length)badOutput();
    return { objects, model };
  }
  if (text(value.unsupported) && value.unsupported) throw new ServiceError(400, 'unsupported', value.unsupported.slice(0,200));
  if (!text(value.title,200) || !text(value.text,20000) || value.text.trim().length < 100 || value.complete !== true) badOutput();
  return { novel: { title: value.title, text: value.text, taskId: task.id }, model };
}

export function generationStatus(env) { return { text: { configured: Boolean(env.DEEPSEEK_API_KEY?.trim()), model: 'deepseek-v4-flash' }, images: imageConfig(env), video: videoConfig(env), website:{scope:'网站生成提示词与素材交接；模型负责完整实现，保留旧网站文件', workbuddyConfigured:Boolean(env.WORKBUDDY_ACCESS_TOKEN?.trim())}, novel: { scope: '短篇正文，TXT / Markdown' } }; }
