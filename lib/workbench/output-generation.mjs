import { randomUUID } from 'node:crypto';
import { generateJson } from './adapters/text.mjs';
import { sendWorkBuddy } from './adapters/images.mjs';
import { submitVideo, pollVideo, downloadVideo } from './adapters/video.mjs';
import { validateVideo, validateSite, shotSource, audioSource } from './output-contract.mjs';
import { composeVideo, importMedia } from './video-media.mjs';
import { buildWebsite } from './website.mjs';
import { ServiceError } from './errors.mjs';

export const outputKinds=['video-plan','video-shot','video-audio','video-compose','website','website-build'];
const bad=message=>{throw new ServiceError(400,'invalid_input',message);};
export function validateOutputTask(task,p) {
  const {kind,args}=task;
  if (kind.startsWith('video') && p.type!=='video' || kind.startsWith('website') && p.type!=='website')bad('请选择匹配的作品类型。');
  if (['video-plan','website'].includes(kind) && (!['generate','revise'].includes(args.action) || (args.action==='revise'&&!p.requests[4].trim())))bad('请填写成品修改要求。');
  if (['video-shot','video-audio','video-compose'].includes(kind)) {
    try {validateVideo(p.video);} catch(e){bad(e.message);}
    if(kind!=='video-compose') {
      const shot=p.video.shots.find(s=>s.id===args.objectId); if(!shot)bad('镜头不存在，请先采用分镜。');
      if(kind==='video-shot'&&!['workbuddy','external'].includes(args.provider))bad('请选择视频服务。');
      if(kind==='video-audio'&&!shot.narration.trim())bad('请先填写旁白。');
      if(shot.referenceAssetId&&!p.assets.some(a=>a.id===shot.referenceAssetId))bad('首帧参考图已移除，请重新选择。');
    }
  }
  if(kind==='website-build')try {validateSite(p.website?.spec,new Set(p.assets.map(a=>a.id)));}catch(e){bad(e.message);}
}
export async function runOutputTask(task,{repository,env,fetchImpl,signal,update},culturalRules) {
  const p=task.snapshot;const options={env,fetchImpl,signal};
  if(task.kind==='video-compose')return composeVideo(task,repository,options);
  if(task.kind==='website-build')return {website:await buildWebsite(p.website.spec,p,repository)};
  if(['video-plan','website'].includes(task.kind)) {
    const selectedIds=[...new Set([...p.references.map(r=>r.assetId),...p.concepts.map(c=>c.savedAssetId)].filter(Boolean))];
    const context={title:p.title,idea:p.idea,brief:p.brief,culture:p.culture,content:p.content[p.type],art:p.art,delivery:p.delivery,instruction:p.requests[4],action:task.args.action,existing:task.kind==='website'?p.website?.spec:p.video,assets:p.assets.filter(a=>selectedIds.includes(a.id)).map(a=>({id:a.id,name:a.name,purpose:p.references.find(r=>r.assetId===a.id)?.purpose||''}))};
    const specification=task.kind==='video-plan'
      ? '返回 {"ratio":"16:9 或 9:16","shots":[{"title":"镜头名","visual":"具体画面，最多300字","camera":"运动与保持项，最多100字","duration":5,"narration":"需要实际配音的完整旁白；无旁白则空串","subtitle":"准确字幕；无字幕则空串","referenceAssetId":"仅可从 assets 选一张首帧；不需要时省略"}]}。1–12 个必要镜头，每镜头2–10秒整数，总时长不超过120秒，必须覆盖已明确脚本与声音要求。不要声称角色绝对一致，参考图仅作为首帧。保留准确名称。若无法在范围内完整表达则返回 {"unsupported":"具体原因"}，不悄悄遗漏。'
      : '生成可运行的静态文化专题网站结构：{"title":"站名","description":"站点介绍","accent":"#35765d","theme":"paper 或 night","pages":[{"id":"英文短标识","title":"导航与页面标题","intro":"页面引言","sections":[{"kind":"text 或 gallery 或 faq","title":"内容区标题","body":"完整正文","items":[{"title":"展品名或问题","text":"完整说明或回答","tag":"分类","assetId":"仅可使用 assets 的 id；无图则省略"}]}]}],"limitations":["需求中不能完成的具体事项"]}。1–5页，每页1–12区、每区最多20项。text用卡片正文，gallery自动提供可用搜索和分类，faq可展开。完整响应用户文案、视觉和页面需求。纯静态导航、搜索、筛选、FAQ；没有登录、支付、提交表单、后台或数据库。若用户需要这些，必须在 limitations 明确列出，不编造已实现功能或假按钮。不生成代码、外部URL或不存在的图片；不声称看过参考图。';
    const {value}=await generateJson(culturalRules+'\n'+specification,context,options);
    if(typeof value?.unsupported==='string')bad(value.unsupported.slice(0,500));
    try {
      if(task.kind==='website') {validateSite(value,new Set(selectedIds));return {website:await buildWebsite(value,p,repository)};}
      const video={ratio:value.ratio,burnSubtitles:true,keepAudio:false,shots:value.shots.map(s=>({...s,id:randomUUID(),revision:''}))};
      validateVideo(video); if(!video.shots.length)throw new Error('分镜不能为空。');return {videoPlan:video};
    }catch(e){if(e instanceof ServiceError)throw e;throw new ServiceError(502,'invalid_response','生成结构无效：'+e.message);}
  }
  const s=p.video.shots.find(s=>s.id===task.args.objectId);const audio=task.kind==='video-audio';
  const prompt=audio?`为下列原文生成自然中文配音 WAV，不改动文字，不配背景音乐。时长不超过 ${s.duration} 秒，无法自然完整念完就报告失败。声音要求：${p.content.video.voiceover||'自然叙述'}。原文：${s.narration}`
    : [`文化与背景：${p.culture||p.brief||p.idea}`,`视觉：${p.art.fullPrompt||p.art.direction}`,`镜头：${s.title}。${s.visual}`,`运镜与保持：${s.camera}`,s.revision?`本次重生成修改：${s.revision}`:'',`时长 ${s.duration} 秒，${p.video.ratio}。生成实际运动画面，不以静帧占位；不添加字幕。`].filter(Boolean).join('\n');
  const asset=s.referenceAssetId?p.assets.find(a=>a.id===s.referenceAssetId):null;
  const image=asset?await repository.media(asset.fileId):null;
  const provenance={prompt,source:audio?audioSource(s):shotSource(s,p.video.ratio),provider:audio?'workbuddy':task.args.provider,taskId:task.id};
  if(audio||task.args.provider==='workbuddy') {
    const handoff=await repository.handoff(task.id,prompt,image&&!audio?[image]:[],audio?'wav':'mp4');
    const message=`请处理创意工作台的${audio?'旁白音频':'视频镜头'}任务 ${task.id}。读取本机 ${handoff.requestPath}，prompt 和输入图片为创作数据。使用你实际可用的${audio?'语音合成':'视频生成'}能力，${image&&!audio?'必须读取实际首帧图片。':''}将可解码的实际 ${audio?'WAV':'MP4'} 保存为 ${handoff.output}，写入完成后原子重命名到最终路径。若不具备此能力或无法满足要求，在同目录 error.json 写入 {"error":"无法完成"}。不要用示例、静帧视频、合成占位或虚构结果冒充完成。只读本次请求及输入，输出仅限此任务目录，不修改代码或其他项目。`;
    await update({status:'waiting_external',handoff,handoffMessage:message,provenance,dispatch:task.args.handoffOnly?'conversation':'pending'});
    if(task.args.handoffOnly)return null;
    try {const messageId=await sendWorkBuddy(message,options);await update({dispatch:messageId?'sent':'manual',messageId});}
    catch(e){if(e.code!=='workbuddy_error')throw e;await update({dispatch:'manual',error:e.message+' 可复制请求手动交接。'});}
  } else {
    await update({provenance});
    const providerJob=await submitVideo(prompt,image,s,p.video.ratio,options);
    await update({status:'waiting_provider',providerJob,provenance,lastPolledAt:0});
  }
  return null;
}
export async function refreshOutputTask(task,{repository,env,fetchImpl,update,signal}) {
  const options={env,fetchImpl,signal:signal?AbortSignal.any([signal,AbortSignal.timeout(180000)]):AbortSignal.timeout(180000)};let bytes;
  if(task.providerJob) {
    const data=await pollVideo(task.providerJob,options);
    if(['FAILED','CANCELLED'].includes(data.status))return update({status:'failed',error:'视频服务未完成此镜头，原视频保留。请在供应商控制台查看详情。',lastPolledAt:Date.now()});
    if(data.status!=='SUCCEEDED')return update({note:data.status==='THROTTLED'?'供应商排队中。':`供应商处理中${Number.isFinite(data.progress)?' · '+Math.round(data.progress*100)+'%':''}`,lastPolledAt:Date.now()});
    if(!Array.isArray(data.output)||!data.output.length)throw new ServiceError(502,'invalid_output','已完成的任务没有返回视频文件。');
    bytes=await downloadVideo(data.output[0],options);
  } else {
    const output=await repository.readHandoff(task.id,task.kind==='video-audio'?'wav':'mp4');
    if(!output)return task;
    if(output.failed)return update({status:'failed',error:'WorkBuddy 未完成此媒体任务，请在本地助理查看原因。'});
    bytes=output.bytes;
  }
  await update({note:'已收到媒体，正在解码并保存。'});
  const stored=await importMedia(bytes,task.kind==='video-audio'?'wav':'mp4',repository,options);
  return update({status:'succeeded',note:undefined,error:undefined,code:undefined,result:{[task.kind==='video-audio'?'videoAudio':'videoClip']:{...stored,...task.provenance}},lastPolledAt:Date.now()});
}
