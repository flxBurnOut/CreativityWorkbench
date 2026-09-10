'use client';
import { useEffect, useRef, useState } from 'react';
import { Button, Field, AssetImage } from '@/components/workbench/ui';
import type { Project, VideoDraft, VideoShot, MediaFile } from '@/features/projects/model';
import { api, outputUrl, uploadOutput, imageUrl } from '@/features/projects/server-store';
import { audioSource, composeSource, shotSource } from '@/lib/workbench/output-contract.mjs';
import { finalVideoPrompt, buildVideoPrompt, videoPromptBasis, videoPromptStale, finalWebsitePrompt, buildWebsitePrompt, websitePromptBasis, websitePromptStale, websiteAssetIds, assetRoles, websiteRequestSource } from '@/lib/workbench/prompts.mjs';
import type { EditProject, Notice } from './stages';
import type { GenerationControls } from './generation-api';
import type { GenerationTask } from './task-results';
import {ReferencePicker,InputSummary,WebsiteSourcePanel} from './workflow-panel';
import {CONTENT_SECTIONS} from '@/features/projects/model';
import {videoSpec} from '@/lib/workbench/media-validation.mjs';
import {ThemeAssetsPanel} from './theme-assets-panel';
import {assetChanges,selectedTransfers,transferredMedia} from '@/lib/workbench/workflow.mjs';

type Props={project:Project;edit:EditProject;generation?:GenerationControls;notice:Notice};
const emptyVideo=():VideoDraft=>({ratio:'16:9',shots:[],keepAudio:false,burnSubtitles:true});
function DownloadFile({fileId,name,children}:{fileId:string;name:string;children:React.ReactNode}) {
  // Let the browser stream downloads to disk instead of retaining a full video Blob.
  return <a href={outputUrl(fileId)} download={name}>{children}</a>;
}
function MediaUpload({label,kind,onUpload,notice}:{label:string;kind:'mp4'|'wav';onUpload:(file:MediaFile)=>void;notice:Notice}) {
  const input=useRef<HTMLInputElement>(null);const[busy,setBusy]=useState(false);
  return <><Button variant="secondary" disabled={busy} onClick={()=>input.current?.click()}>{busy?'正在处理文件…':label}</Button><input hidden ref={input} type="file" accept={kind==='mp4'?'.mp4,video/mp4':'.wav,.mp3,.m4a,audio/*'} aria-label={label} onChange={async e=>{const file=e.target.files?.[0];e.target.value='';if(!file)return;setBusy(true);try{onUpload(await uploadOutput(file,kind));notice('文件已解码并保存。');}catch(error){notice(error instanceof Error?error.message:'文件未能保存。');}finally{setBusy(false);}}}/></>;
}
export function WebsitePreview({fileId}:{fileId:string}) {
  const[mobile,setMobile]=useState(false);
  return <div className="site-output"><div className="inline-actions"><Button variant={!mobile?'secondary':'ghost'} onClick={()=>setMobile(false)}>桌面预览</Button><Button variant={mobile?'secondary':'ghost'} onClick={()=>setMobile(true)}>手机预览</Button><span className="muted">可点击导航、搜索和展开内容</span></div><div className={'site-frame '+(mobile?'is-mobile':'')}><iframe title="生成网站交互预览" src={outputUrl(fileId)} sandbox="allow-scripts" referrerPolicy="no-referrer" /></div></div>;
}
export function OutputTaskPreview({task}:{task:GenerationTask}) {
  const r=task.result;if(!r)return null;
  const file=r.videoClip||r.videoFinal;
  return <>
    {r.warnings?.map((warning,index)=><p key={index} role="status">{warning}</p>)}
    {r.videoPlan&&<Field label="分镜结果预览"><textarea readOnly rows={8} value={r.videoPlan.shots.map((s,i)=>`${i+1}. ${s.title} · ${s.duration} 秒\n画面：${s.visual}\n运镜：${s.camera}\n旁白：${s.narration||'无'}\n字幕：${s.subtitle||'无'}`).join('\n\n')}/></Field>}
    {file?.validation&&<p role="status">规格检查：{file.validation.status==='passed'?'通过':file.validation.status==='failed'?'未通过':'未验证'} · 实际 {file.width}×{file.height} / {file.duration.toFixed(2)} 秒。{file.validation.issues.join(' ')}</p>}
    {file&&<div className="media-result"><video controls preload="none" src={outputUrl(file.fileId)} aria-label="生成视频预览"/><DownloadFile fileId={file.fileId} name="创意视频.mp4">下载 MP4</DownloadFile>{r.videoFinal&&<DownloadFile fileId={r.videoFinal.subtitleFileId} name="字幕.srt">下载字幕 SRT</DownloadFile>}</div>}
    {r.videoAudio&&<div className="media-result"><audio controls src={outputUrl(r.videoAudio.fileId)}/><DownloadFile fileId={r.videoAudio.fileId} name="旁白.wav">下载旁白</DownloadFile></div>}
    {r.website&&<><p>网站包含 {r.website.spec.pages.map(p=>p.title).join('、')}。</p>{r.website.spec.limitations.length>0&&<p role="status">尚未实现的要求：{r.website.spec.limitations.join('；')}</p>}<details><summary>预览新网站</summary>{r.website.previewFileId&&<WebsitePreview fileId={r.website.previewFileId}/>}</details>{r.website.zipFileId&&<DownloadFile fileId={r.website.zipFileId} name="网站源码.zip">下载网站源码与素材 ZIP</DownloadFile>}</>}
    {r.websiteRequest&&<><p>网站提示词与素材包已准备；网站实现与功能验证由执行模型完成。</p><details><summary>任务包中的实际提示词</summary><textarea readOnly rows={8} aria-label="已准备的网站提示词" value={r.websiteRequest.prompt}/></details>{r.websiteRequest.bundleFileId&&<DownloadFile fileId={r.websiteRequest.bundleFileId} name="网站生成任务与素材.zip">下载网站生成任务包</DownloadFile>}</>}
    {r.designPackage&&<><p>当前创意、设计设定和实际参考文件已打包；资料包不代表已生成 3D 模型。</p><DownloadFile fileId={r.designPackage.fileId} name="设计资料.zip">下载设计资料包</DownloadFile></>}
  </>;
}
export function VideoOutput({project,edit,generation,notice}:Props) {
  const video=project.video||emptyVideo();
  const [initialShot]=useState<VideoShot>(()=>({id:crypto.randomUUID(),title:'镜头 1',visual:'',camera:'',duration:5,narration:'',subtitle:'',revision:''}));
  const [provider,setProvider]=useState('workbuddy');
  useEffect(()=>{const refresh=()=>{void api<{video:{provider:string}}>('status').then(s=>setProvider(s.video.provider)).catch(()=>{});};refresh();window.addEventListener('workbench-settings-saved',refresh);return()=>window.removeEventListener('workbench-settings-saved',refresh);},[]);
  const shown=video.shots.length?video.shots:[initialShot];
  const update=(fn:(v:VideoDraft)=>VideoDraft)=>edit(p=>p.id===project.id?{...p,video:fn(p.video||emptyVideo())}:p);
  const shotEdit=(id:string,fn:(s:VideoShot)=>VideoShot)=>update(v=>({...v,shots:(v.shots.length?v.shots:[initialShot]).map(s=>s.id===id?fn(s):s)}));
  const changePrompt=(id:string,text?:string,confirm=false)=>edit(p=>{
    const v=p.video||emptyVideo();const shots=v.shots.length?v.shots:[initialShot];
    const context={...p,video:v};
    return {...p,video:{...v,shots:shots.map(s=>s.id!==id?s:{...s,prompt:confirm?finalVideoPrompt(context,s):text??buildVideoPrompt(context,s),promptBasis:videoPromptBasis(context,s)})}};
  });
  return <div className="stage-stack">
    <section className="surface">
      <div className="section-heading"><div><h3>生成一个视频镜头</h3><p>写清主体、场景和动作，沿用项目的文化背景与美术设定。直接生成一个连续镜头，无需先生成分镜。</p></div><span className="tag tag-soft">视频</span></div>
      <div className="delivery-fields">
        <Field label="视频生成服务"><select value={provider} onChange={e=>setProvider(e.target.value)}><option value="workbuddy">WorkBuddy</option><option value="external">外部 API · Runway</option></select></Field>
        <Field label="画幅"><select value={video.ratio} onChange={e=>{const ratio=e.target.value as VideoDraft['ratio'];edit(p=>({...p,delivery:{...p.delivery,ratio},video:{...(p.video||emptyVideo()),ratio}}));}}><option>16:9</option><option>9:16</option></select></Field>
      </div>
    </section>
    <section className="surface"><div className="shot-list">{shown.map((s,i)=>{
      const prompt=finalVideoPrompt(project,s);const stale=videoPromptStale(project,s);const tooLong=prompt.length>(provider==='external'?1000:100000);
      const reference=project.assets.find(a=>a.id===s.referenceAssetId);
      const frame=project.assets.find(a=>a.id===s.frameCandidate);
      const updatedConcept=project.concepts.find(c=>c.id===s.referenceConceptId&&c.savedAssetId&&c.savedAssetId!==s.referenceAssetId);
      const frameChanges=assetChanges(project,frame);
      return <article className="shot-editor" key={s.id}>
        <div className="section-heading"><h4>{s.title||'镜头 '+(i+1)}</h4>{video.shots.length>0&&<Button variant="ghost" onClick={()=>{const old=video;update(v=>({...v,shots:v.shots.filter(x=>x.id!==s.id)}));notice('已移除镜头，文件仍保留在任务历史',()=>update(()=>old));}}>移除镜头</Button>}</div>
        <Field label={'单镜头要求 · '+(i+1)}><textarea rows={4} value={s.visual} placeholder={reference?'这张图中的主体如何运动，环境和镜头如何变化？':'这个镜头里，谁在什么环境中做什么？只描述本镜头需要发生的动作。'} onChange={e=>shotEdit(s.id,current=>({...current,visual:e.target.value}))}/></Field>
        <details className="video-reference-options"><summary>选一张首帧图片（可选）{reference?' · 已选择 '+reference.name:''}</summary>
        <ReferencePicker project={project} selected={s.referenceAssetId?[s.referenceAssetId]:[]} onSelect={ids=>shotEdit(s.id,current=>({...current,referenceAssetId:ids[0],referenceConceptId:project.concepts.find(c=>c.savedAssetId===ids[0])?.id,conceptIds:[...new Set([...(current.conceptIds||[]),...project.concepts.filter(c=>c.savedAssetId===ids[0]).map(c=>c.id)])]}))} label="上一阶段概念图 · 选一张作为本镜头首帧"/>
        <div className="inline-actions"><Button variant="ghost" onClick={()=>edit(p=>({...p,stage:3}))}>返回概念图阶段</Button><Button variant="ghost" onClick={()=>shotEdit(s.id,current=>({...current,referenceAssetId:undefined,referenceConceptId:undefined}))}>仅文字生成</Button></div>
        </details>

        <div className="delivery-fields">
          <Field label={'镜头 '+(i+1)+' 秒数'}><input type="number" min={2} max={10} value={s.duration} onChange={e=>shotEdit(s.id,current=>({...current,duration:Math.min(10,Math.max(2,Math.round(Number(e.target.value)||2)))}))}/></Field>
          <p className="muted">实际输入：{reference?reference.name+' · 起始画面':'未附图片 · 文生视频'}</p>
        </div>
        {reference&&<div><AssetImage asset={reference} alt="本次实际首帧" className="generated-image"/><p className="muted">首帧需与目标画幅一致。补边保留完整画面；居中裁切会移除部分边缘，生成的新图需先预览。</p></div>}
        {reference&&<div className="inline-actions"><Button variant="secondary" disabled={generation?.busy} onClick={()=>void generation?.fitFrame?.(s.id,'pad')}>补边为 {video.ratio}</Button><Button variant="ghost" disabled={generation?.busy} onClick={()=>void generation?.fitFrame?.(s.id,'crop')}>居中裁切为 {video.ratio}</Button></div>}
        <>{updatedConcept&&<p role="status">{updatedConcept.name} 的概念图已有新版，当前首帧仍保留。<Button variant="secondary" onClick={()=>shotEdit(s.id,current=>({...current,referenceAssetId:updatedConcept.savedAssetId}))}>更新为已保存新版</Button></p>}</><details><summary>沿用相关内容与对象设定</summary><p className="muted">只选择本镜头需要的部分；不会自动将整篇脚本加入一个镜头。</p>{CONTENT_SECTIONS.video.filter(section=>project.content.video[section.key]).map(section=><label className="workflow-check" key={section.key}><input type="checkbox" checked={s.contentKeys?.includes(section.key)||false} onChange={e=>shotEdit(s.id,current=>({...current,contentKeys:e.target.checked?[...(current.contentKeys||[]),section.key]:(current.contentKeys||[]).filter(k=>k!==section.key)}))}/>{section.label}</label>)}{project.concepts.map(c=><label className="workflow-check" key={c.id}><input type="checkbox" checked={s.conceptIds?.includes(c.id)||false} onChange={e=>shotEdit(s.id,current=>({...current,conceptIds:e.target.checked?[...(current.conceptIds||[]),c.id]:(current.conceptIds||[]).filter(id=>id!==c.id)}))}/><span>{c.name}<small>{c.description}</small></span></label>)}</details>
        <details><summary>用概念参考准备本镜头首帧 · 可选</summary><p className="muted">人物、场景、器物分别成图时，可先组合为一个起始画面。先生成图片候选，采用后再生成视频。</p><ReferencePicker project={project} multiple selected={s.frameReferenceIds||[]} onSelect={ids=>shotEdit(s.id,current=>({...current,frameReferenceIds:ids,conceptIds:[...new Set([...(current.conceptIds||[]),...project.concepts.filter(c=>ids.includes(c.savedAssetId||'')).map(c=>c.id)])]}))} label="首帧准备时实际附带的概念图"/><Field label={'镜头 '+(i+1)+' 首帧构图与修改要求'}><textarea rows={3} value={s.frameInstruction||''} onChange={e=>shotEdit(s.id,current=>({...current,frameInstruction:e.target.value}))}/></Field><div className="delivery-fields"><Field label="首帧图像服务"><select value={generation?.provider} onChange={e=>generation?.setProvider(e.target.value)}><option value="workbuddy">WorkBuddy</option><option value="external">外部 Images API</option></select></Field><Field label="首帧图片比例"><select value={generation?.ratio} onChange={e=>generation?.setRatio(e.target.value)}><option value="1:1">1:1</option><option value="3:2">3:2</option><option value="2:3">2:3</option></select></Field></div><p className="muted">此处显示图像适配器的比例选项；选作首帧后，可用补边或裁切按钮生成目标画幅的新图，原图保留。多图能力取决于实际图像服务。</p><div className="inline-actions"><Button variant="secondary" disabled={generation?.busy||!s.visual.trim()} onClick={()=>generation?.run('video-frame',{action:'generate',objectId:s.id})}>准备首帧候选</Button>{reference&&<Button variant="ghost" disabled={generation?.busy||!s.frameInstruction?.trim()} onClick={()=>generation?.run('video-frame',{action:'edit',objectId:s.id})}>基于当前首帧修改</Button>}</div>{frame&&<div><AssetImage asset={frame} alt="镜头首帧候选" className="generated-image"/>{frameChanges.length>0&&<p>首帧依据已变化：{frameChanges.map(c=>c.label).join('、')}。旧候选保留，请重新准备。</p>}<Button disabled={frameChanges.length>0} onClick={()=>shotEdit(s.id,current=>({...current,referenceAssetId:current.frameCandidate,referenceConceptId:undefined,frameCandidate:undefined}))}>采用此首帧</Button><a href={imageUrl(frame)} download="首帧.png">下载首帧 PNG</a></div>}</details>
        <InputSummary project={project} edit={edit} kind="video-shot" args={{objectId:s.id}}/>
        <details><summary>运镜与修改要求</summary>
          <Field label={'镜头 '+(i+1)+' 名称'}><input value={s.title} onChange={e=>shotEdit(s.id,current=>({...current,title:e.target.value}))}/></Field>
          <Field label={'镜头 '+(i+1)+' 运镜与保持项'}><textarea rows={2} value={s.camera} onChange={e=>shotEdit(s.id,current=>({...current,camera:e.target.value}))}/></Field>
          <Field label={'镜头 '+(i+1)+' 本次修改'}><textarea rows={2} value={s.revision} onChange={e=>shotEdit(s.id,current=>({...current,revision:e.target.value}))}/></Field>
        </details>
        <details open={stale||undefined}><summary>查看或编辑最终提交提示词</summary>
          <Field label={'镜头 '+(i+1)+' 最终提示词'}><textarea rows={9} value={prompt} onChange={e=>changePrompt(s.id,e.target.value)}/></Field>
          <p className="muted">{prompt.length} 字符{provider==='external'?' / 最多 1000 字符':''}。提交时原样使用此文本，同时传入上方时长、画幅和首帧。</p>
          <Button variant="secondary" onClick={()=>changePrompt(s.id)}>按当前设定重新整理</Button>
          <Button variant="ghost" onClick={()=>void navigator.clipboard.writeText(prompt).then(()=>notice('已复制最终提示词')).catch(()=>notice('复制失败，请选中文字复制。'))}>复制提示词</Button>
        </details>
        {stale&&<div role="status"><p>镜头背景、要求或参数已变化，编辑稿仍保留。请重新整理，或核对后确认保留编辑稿。</p><Button variant="secondary" onClick={()=>changePrompt(s.id,undefined,true)}>已核对，保留编辑稿</Button></div>}
        {tooLong&&<p role="status">提示词超过当前服务上限，请精简重复背景和美术描述；不会自动截断。</p>}
        <div className="inline-actions">
          <Button disabled={generation?.busy||!s.visual.trim()||!prompt.trim()||stale||tooLong} onClick={()=>generation?.run('video-shot',{objectId:s.id,provider})}>{s.clip?'重新生成此镜头':'生成此镜头'}</Button>
          <MediaUpload label="导入这个镜头的 MP4" kind="mp4" notice={notice} onUpload={file=>shotEdit(s.id,current=>({...current,clip:{...file,source:shotSource(s,video.ratio,{...project,video})}}))}/>
        </div>
        {s.clip&&<><video className="shot-player" controls preload="none" src={outputUrl(s.clip.fileId)} aria-label={'镜头 '+(i+1)+' 预览'}/><p className="muted">实际 {s.clip.width||'?'}×{s.clip.height||'?'} · {s.clip.duration.toFixed(2)} 秒 · 规格{videoSpec(s.clip,video.ratio,s.duration).status==='passed'?'通过':videoSpec(s.clip,video.ratio,s.duration).status==='failed'?'未通过':'未验证'}{s.clip.source!==shotSource(s,video.ratio,project)?' · 依据已改变或属于旧版记录；旧文件保留，请核对后重生成或重新导入。':''}</p><DownloadFile fileId={s.clip.fileId} name="视频镜头.mp4">下载这个镜头</DownloadFile></>}
        <details><summary>声音与字幕（已有工具）</summary>
          <Field label={'镜头 '+(i+1)+' 旁白'}><textarea rows={2} value={s.narration} onChange={e=>shotEdit(s.id,current=>({...current,narration:e.target.value}))}/></Field>
          <Field label={'镜头 '+(i+1)+' 字幕'}><textarea rows={2} value={s.subtitle} onChange={e=>shotEdit(s.id,current=>({...current,subtitle:e.target.value}))}/></Field>
          {s.narration.trim()&&<><Button variant="secondary" disabled={generation?.busy} onClick={()=>generation?.run('video-audio',{objectId:s.id})}>生成旁白</Button><MediaUpload label="导入配音" kind="wav" notice={notice} onUpload={file=>shotEdit(s.id,current=>({...current,audio:{...file,source:audioSource(s,project)}}))}/></>}
          {s.audio&&<><audio controls src={outputUrl(s.audio.fileId)}/>{s.audio.source!==audioSource(s,project)&&<p role="status">配音依据已改变，请核对声音要求与时长。</p>}</>}
        </details>
      </article>;
    })}</div>
    {video.shots.length>0&&<Button variant="secondary" disabled={video.shots.length>=12} onClick={()=>update(v=>({...v,shots:[...v.shots,{id:crypto.randomUUID(),title:'新镜头',visual:'',camera:'',duration:5,narration:'',subtitle:'',revision:''}]}))}>添加另一个镜头</Button>}
    </section>
    <details className="surface"><summary>已有分镜与合成工具</summary><p className="muted">独立镜头生成不依赖这些工具；旧项目可继续使用。</p>
      <Field label="原视频目标时长"><input value={project.delivery.duration} onChange={e=>edit(p=>({...p,delivery:{...p.delivery,duration:e.target.value}}))}/></Field>
      <Field label="原视频补充要求"><textarea value={project.delivery.notes} onChange={e=>edit(p=>({...p,delivery:{...p.delivery,notes:e.target.value}}))}/></Field>
      <Button variant="secondary" disabled={generation?.busy} onClick={()=>generation?.run('video-plan',{action:'generate'})}>生成分镜方案</Button>
      {video.shots.length>0&&<>
        <label><input type="checkbox" checked={video.burnSubtitles} onChange={e=>update(v=>({...v,burnSubtitles:e.target.checked}))}/>烧录字幕</label>
        <label><input type="checkbox" checked={video.keepAudio} onChange={e=>update(v=>({...v,keepAudio:e.target.checked}))}/>保留镜头原声</label>
        <MediaUpload label="添加背景音乐" kind="wav" notice={notice} onUpload={file=>update(v=>({...v,music:file}))}/>
        {video.music&&<><audio controls src={outputUrl(video.music.fileId)}/><Button variant="ghost" onClick={()=>update(v=>({...v,music:undefined}))}>移除配乐</Button></>}
        <p className="muted">按镜头时长合成；过长片段从开头截取，过短片段或过长旁白会提示调整。原文件保留。</p>
        <Button disabled={generation?.busy} onClick={()=>generation?.run('video-compose')}>合成已有镜头</Button>
      </>}
    </details>
    {video.final&&<section className="surface"><h3>{video.final.source===composeSource(video,project)?'已采用的视频成品':'已保留的旧版视频成品'}</h3><OutputTaskPreview task={{result:{videoFinal:video.final}} as GenerationTask}/></section>}
  </div>;
}

function downloadPrompt(prompt:string) {
  const url=URL.createObjectURL(new Blob([prompt],{type:'text/markdown;charset=utf-8'}));
  const a=document.createElement('a');a.href=url;a.download='网站生成提示词.md';a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);
}
export function WebsiteOutput({project,edit,generation,notice}:Props) {
  const request=project.websiteRequest;const prompt=finalWebsitePrompt(project);const stale=websitePromptStale(project);const selected=websiteAssetIds(project);
  const roles=assetRoles(project,selected);
  const change=(text?:string,confirm=false)=>edit(p=>({...p,websiteRequest:{...p.websiteRequest,prompt:confirm?finalWebsitePrompt(p):text??buildWebsitePrompt(p),basis:websitePromptBasis(p),assetIds:websiteAssetIds(p)}}));
  const select=(id:string,checked:boolean)=>edit(p=>{
    const assetIds=checked?[...new Set([...websiteAssetIds(p),id])]:websiteAssetIds(p).filter((value:string)=>value!==id);
    const draft={...p,websiteRequest:{...p.websiteRequest,prompt:finalWebsitePrompt(p),basis:websitePromptBasis(p),assetIds}};
    // Auto-derived prompts follow selection; explicit edits remain for review.
    return p.websiteRequest?draft:{...draft,websiteRequest:{...draft.websiteRequest,prompt:buildWebsitePrompt(draft),basis:websitePromptBasis(draft)}};
  });
  return <div className="stage-stack">
    <ol className="delivery-route" aria-label="网站制作的三个步骤">
      <li className={!request?.bundleFileId?'is-active':''}><button type="button" onClick={()=>document.getElementById('website-step-1')?.scrollIntoView({behavior:'smooth',block:'start'})}><strong>1. 准备需求</strong><span>确认内容与素材</span></button></li>
      <li className={request?.bundleFileId&&!project.websiteSource?'is-active':''}><button type="button" onClick={()=>document.getElementById('website-step-2')?.scrollIntoView({behavior:'smooth',block:'start'})}><strong>2. WorkBuddy 制作</strong><span>生成真正的网站源码</span></button></li>
      <li className={project.websiteSource?'is-active':''}><button type="button" onClick={()=>document.getElementById('website-step-3')?.scrollIntoView({behavior:'smooth',block:'start'})}><strong>3. 导入与预览</strong><span>采用源码，继续修改</span></button></li>
    </ol>
    <section className="surface website-preparation" id="website-step-1"><div className="section-heading"><div><h3>1. 确认网站需求</h3><p>已有内容与画风会带入任务，只需补充这次要做什么。</p></div><span className="tag tag-soft">网站</span></div>
      <Field label="网站生成要求"><textarea rows={4} value={project.delivery.notes} placeholder="例如：做一个岭南手作专题站，包含作品展示与文化依据，支持类别筛选。" onChange={e=>edit(p=>({...p,delivery:{...p.delivery,notes:e.target.value}}))}/></Field>
      {(project.websiteSource||project.website||project.requests[4])&&<Field label="本次网站修改要求"><textarea rows={2} value={project.requests[4]} placeholder="写下这次需要改变的部分，其余内容保持。" onChange={e=>edit(p=>({...p,requests:p.requests.map((v,i)=>i===4?e.target.value:v)}))}/></Field>}
      <ThemeAssetsPanel project={project} edit={edit} notice={notice}/><details><summary>网站图片 · 已选择 {selected.length} 张（可选）</summary><p className="muted">默认使用已选用的概念图。风格参考不会自动作为网站内容；勾选后才允许使用。</p>
        {project.assets.length?<div className="inline-actions">{project.assets.map(a=><label key={a.id}><input type="checkbox" checked={selected.includes(a.id)} onChange={e=>select(a.id,e.target.checked)}/>{a.name}</label>)}</div>:<p>没有图片也能制作网站。</p>}
        {roles.some(r=>r.role==='style-reference')&&<p className="muted">仅作风格参考：{roles.filter(r=>r.role==='style-reference').map(r=>r.name+'（'+r.purpose+'）').join('；')}</p>}
      </details>
      {selectedTransfers(project).length>0&&<details><summary>跨媒介资料 · {selectedTransfers(project).length} 类内容 / {transferredMedia(project).length} 个媒体文件</summary><p>完整正文、选中媒体与来源记录会随任务包交付，可直接开始网站制作。</p>{selectedTransfers(project).map(t=><p key={t.from}>{t.from}：{t.novel?'完整正文 '+t.novel.text.length+' 字；':''}{t.media?.length||0} 个媒体文件</p>)}</details>}
      <details open={stale||undefined}><summary>查看或调整完整任务说明</summary><Field label="网站最终生成提示词"><textarea rows={10} value={prompt} onChange={e=>change(e.target.value)}/></Field><p className="muted">将原样交给 WorkBuddy，并附带选定的实际素材。</p><div className="inline-actions"><Button variant="secondary" onClick={()=>change()}>按当前资料重新整理</Button><Button variant="ghost" disabled={stale||!prompt.trim()} onClick={()=>void navigator.clipboard.writeText(prompt).then(()=>notice('已复制提示词；如有图片，请同时提供实际素材包。')).catch(()=>notice('复制失败，请选中文字复制。'))}>复制提示词</Button><Button variant="ghost" disabled={stale||!prompt.trim()} onClick={()=>downloadPrompt(prompt)}>下载提示词 Markdown</Button></div></details>
      {stale&&<div role="status"><p>资料已更新，已有编辑稿保留。请重新整理任务说明，或核对后保留。</p><div className="inline-actions"><Button variant="secondary" onClick={()=>change()}>更新任务说明</Button><Button variant="ghost" onClick={()=>change(undefined,true)}>已核对，保留编辑稿</Button></div></div>}
    </section>
    <section className="surface" id="website-step-2"><div className="section-heading"><div><h3>2. 交给 WorkBuddy 制作网站</h3><p>先准备任务包。下方结果卡会提供交接请求；在 WorkBuddy 中完成制作后，取得网站源码 ZIP。</p></div></div>
      <div className="inline-actions"><Button disabled={generation?.busy||stale||!prompt.trim()||prompt.length>100000} onClick={()=>generation?.run('website',{action:'generate',provider:'workbuddy'})}>准备任务并交给 WorkBuddy</Button><Button variant="secondary" disabled={generation?.busy||stale||!prompt.trim()||prompt.length>100000} onClick={()=>generation?.run('website',{action:'generate'})}>仅保存任务包</Button></div>
      <p className="muted">有发送授权时自动交接；否则复制结果卡中的请求。任务包不是完成的网站。</p>
      {request?.bundleFileId&&<div><p>{request.source===websiteRequestSource(project)?'任务包已保存，可以交给 WorkBuddy 执行。':'旧任务包已保留；当前资料变化后需重新准备。'}</p><DownloadFile fileId={request.bundleFileId} name="网站生成任务与素材.zip">下载任务与素材 ZIP</DownloadFile></div>}
    </section>
    <WebsiteSourcePanel project={project} edit={edit} notice={notice}/>
    {project.website&&<details className="surface"><summary>旧版网站与交付文件</summary><p>历史成果继续保留，新网站通过上面的流程制作。</p>{project.website.previewFileId&&<WebsitePreview fileId={project.website.previewFileId}/>} {project.website.zipFileId&&<DownloadFile fileId={project.website.zipFileId} name="旧网站源码.zip">下载旧网站 ZIP</DownloadFile>}</details>}
  </div>;
}
