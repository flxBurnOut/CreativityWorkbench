'use client';
import {useEffect,useRef,useState} from 'react';
import {Button,Field} from '@/components/workbench/ui';
import type {Project,WebsiteBrief,WebsiteSource} from '@/features/projects/model';
import {api,outputUrl} from '@/features/projects/server-store';
import {studioGoal,suggestWebsiteMaterials,websiteStudioState,websiteDispatchMessage,WEBSITE_SCOPES} from '@/lib/workbench/website-studio.mjs';
import {knowledgeText} from '@/lib/workbench/knowledge.mjs';
import type {GenerationControls} from './generation-api';
import type {GenerationTask} from './task-results';
import type {EditProject,Notice} from './stages';
import {ThemeAssetsPanel} from './theme-assets-panel';
import {WebsiteVerification} from './website-verification';

type Props={project:Project;edit:EditProject;notice:Notice;generation:GenerationControls;flush:()=>Promise<void>;synchronize:(force?:boolean)=>Promise<void>;autoStart?:boolean;onStarted:()=>void;onDetails:()=>void};
const impact:Record<string,string>={all:'按本轮要求更新网站，保留未涉及部分。',appearance:'调整配色与排版，保留正文、图片及交互。',content:'修改指定文案，保留事实出处、布局和交互。',images:'更新指定配图，保留其他文案和功能。',interaction:'修改指定功能，保留其他页面内容。'};
export function WebsiteStudio({project,edit,notice,generation,flush,synchronize,autoStart,onStarted,onDetails}:Props) {
  const [receipt,setReceipt]=useState<GenerationTask|null>(null);
  const state=websiteStudioState(project,generation.tasks||[],receipt);
  const goal=studioGoal(project),suggestions=suggestWebsiteMaterials(goal);
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[editing,setEditing]=useState(false);
  const change=project.websiteEdit?.change??(['failed','cancelled'].includes(state.task?.status||'')?project.websiteBrief?.change||'':'');
  const scope:WebsiteBrief['scope']=project.websiteEdit?.scope||project.websiteBrief?.scope||'all';
  const setChange=(value:string)=>edit(p=>({...p,websiteEdit:{change:value,scope}}));
  const setScope=(value:WebsiteBrief['scope'])=>edit(p=>({...p,websiteEdit:{change,scope:value}}));
  const [mobile,setMobile]=useState(false),[showCurrent,setShowCurrent]=useState(false);
  const [requestView,setRequestView]=useState<{taskId:string;open:boolean}|null>(null),[feedbackFocus,setFeedbackFocus]=useState(0);
  const pending=useRef<Record<string,unknown>|null>(null),active=useRef(false),mounted=useRef(true),upload=useRef<HTMLInputElement>(null);
  const feedback=useRef<HTMLDivElement>(null),controller=useRef<AbortController|null>(null);
  useEffect(()=>{mounted.current=true;controller.current=new AbortController();return()=>{mounted.current=false;controller.current?.abort();};},[]);
  useEffect(()=>{
    if(receipt&&project.websiteRequest?.taskId===receipt.id&&generation.tasks?.some(t=>t.id===receipt.id&&(t.updatedAt||0)>=(receipt.updatedAt||0)))setReceipt(null);
  },[receipt,project.websiteRequest?.taskId,generation.tasks]);
  useEffect(()=>{
    if(!feedbackFocus)return;
    // Wait for layout after replacing the previous task controls. Keep only one
    // frame and cancel it on unmount; background polls never steal editing focus.
    const frame=requestAnimationFrame(()=>{feedback.current?.focus({preventScroll:true});feedback.current?.scrollIntoView({behavior:'instant',block:'start'});});
    return()=>cancelAnimationFrame(frame);
  },[feedbackFocus]);
  const focusFeedback=()=>setFeedbackFocus(n=>n+1);
  const requestOpen=state.task&&(requestView&&requestView.taskId===state.task.id?requestView.open:state.needsHandoff);
  const showRequest=(open:boolean)=>{if(state.task)setRequestView({taskId:state.task.id,open});};
  const sync=async()=>{await synchronize(true);await generation.refresh?.(true);};
  async function perform(operation:()=>Promise<void>) {
    if(active.current)return;active.current=true;setBusy(true);setError('');focusFeedback();
    try{await operation();}
    catch(e){if(mounted.current){setError(e instanceof Error?e.message:'操作尚未完成，请刷新后核对。');focusFeedback();}}
    finally{active.current=false;if(mounted.current)setBusy(false);}
  }
  async function submitPending() {
    try {
      const task=await api<GenerationTask>('core/website_run','POST',pending.current,controller.current?.signal);
      pending.current=null;
      if(mounted.current){setReceipt(task);setEditing(false);setShowCurrent(false);}
    } catch(e) {
      if(e&&typeof e==='object'&&'status' in e&&[400,404,409].includes(Number(e.status))){pending.current=null;await sync();}
      throw e;
    }
    await sync();
    if(mounted.current)focusFeedback();
  }
  async function start(retryOf?:string) {
    await perform(async()=>{
      if(pending.current)throw Error('上次提交尚未确认，请先核对，避免重复制作。');
      await flush();const saved=await api<{projectVersion:string}>('core/project_get','POST',{projectId:project.id},controller.current?.signal);
      const request={projectId:project.id,expectedVersion:saved.projectVersion,requestId:crypto.randomUUID(),goal,change,scope,autoAssets:project.websiteBrief?.autoAssets??true,dispatch:'auto',base:change.trim()&&project.websiteSourceCandidate&&!showCurrent?'draft':'current',...(retryOf?{retryOf}:{})};
      pending.current=request;
      await submitPending();
    });
  }
  const launch=useRef(start);launch.current=start;
  useEffect(()=>{if(autoStart){onStarted();void launch.current();}},[autoStart,onStarted]);
  const draft=state.candidate as WebsiteSource|undefined;
  const preview=(showCurrent?project.websiteSource:state.preview) as WebsiteSource|undefined;
  const hasRun=Boolean(state.task||project.websiteSource||project.websiteSourceCandidate);
  const goalOpen=!hasRun||editing;
  const phase=state.phase;
  const title=state.task?.status==='failed'?'本轮制作未完成':state.task?.status==='cancelled'?'已结束本轮等待':state.needsHandoff?'需要交给 WorkBuddy 继续制作':state.task?.status==='uncertain'?'制作进度需要核对':state.busy?(state.task?.result?.websiteRequest?'等待 WorkBuddy 回传网站':'正在整理资料与准备网站任务'):draft&&!state.selected?'网站初稿已收到':project.websiteSource?'当前网站已保存':'描述你想要的网站';
  async function copyRequest(){
    showRequest(true);
    try{await navigator.clipboard.writeText(state.task?.handoffMessage||'');notice('已复制完整交接请求，在 WorkBuddy 粘贴后继续同一任务。');}
    catch{notice('浏览器未允许复制，请选中下方完整交接内容手动复制。');}
  }
  async function cancelWaiting(){await perform(async()=>{
    await flush();
    const task=await api<GenerationTask>('tasks/'+state.task!.id+'/cancel','POST',{});
    if(mounted.current)setReceipt(task);
    await sync();
  });}
  async function choose(){await perform(async()=>{await flush();const current=await api<{projectVersion:string}>('core/project_get','POST',{projectId:project.id});await api('core/workflow_update','POST',{projectId:project.id,expectedVersion:current.projectVersion,requestId:crypto.randomUUID(),action:'adopt-website-source'});setShowCurrent(true);await sync();notice('已使用这个网站版本，之前版本保留。');});}
  async function uploadResult(file:File){await perform(async()=>{
    if(!state.task)throw Error('先开始本次网站制作，再导入它的结果。');if(file.size>128*1024*1024)throw Error('网站 ZIP 请小于 128 MB。');
    const response=await fetch('/api/workbench/data/tasks/'+state.task.id+'/website-result',{method:'POST',headers:{'Content-Type':'application/octet-stream'},body:file,signal:AbortSignal.timeout(120000)});
    const data=await response.json() as {error?:string};if(!response.ok)throw Error(data.error||'网站文件未能接收。');await sync();
  });}
  const taskFeedback=(<div ref={feedback} tabIndex={-1} className="studio-feedback" aria-label="本轮请求与交接">
    {error&&<div role="alert" className="creative-feedback creative-error"><p>{error}</p><Button variant="ghost" disabled={busy} onClick={()=>void perform(sync)}>刷新进度</Button></div>}
    {pending.current&&<div className="creative-feedback"><p>原请求结果尚未确认，请先核对再提交新的修改。下一轮要求会保留。</p><Button disabled={busy} onClick={()=>void perform(submitPending)}>核对上次提交</Button></div>}
    {busy&&!state.busy&&<p role="status">正在处理本次操作，请稍候…</p>}
    {state.task&&<>
      <p role="status" className="studio-feedback-title">{title}</p>
      {state.task.error&&state.task.status!=='cancelled'&&<p>{state.task.error}</p>}
      {state.canHandoff&&<div className="studio-handoff">
        <p>{websiteDispatchMessage(state.task)}</p>
        <div className="inline-actions"><Button disabled={busy} onClick={()=>void copyRequest()}>复制请求到 WorkBuddy</Button><Button variant="ghost" aria-expanded={Boolean(requestOpen)} onClick={()=>showRequest(!requestOpen)}>{requestOpen?'收起交接内容':'查看交接内容'}</Button></div>
        {requestOpen&&<Field label="完整交接请求"><textarea readOnly rows={6} value={state.task.handoffMessage||''}/></Field>}
      </div>}
      {state.busy&&project.websiteBrief?.change&&<details className="studio-submitted"><summary>查看本轮已提交的修改要求</summary><p className="studio-goal">{project.websiteBrief.change}</p></details>}
      <div className="inline-actions studio-recovery">
        {!error&&<Button variant="ghost" disabled={busy} onClick={()=>void perform(sync)}>刷新进度</Button>}
        {state.canHandoff&&<Button variant="secondary" disabled={busy} onClick={()=>upload.current?.click()}>导入本次网站结果</Button>}
        {state.busy&&<Button variant="ghost" disabled={busy} onClick={()=>void cancelWaiting()}>结束本次等待</Button>}
      </div>
      {state.busy&&<p className="muted">{preview?'可继续编辑下一轮要求。先完成或结束本轮等待，再提交下一轮；':'收到网站初稿后即可预览和修改。'}结束网页等待不会取消 WorkBuddy 中的工作。</p>}
      {!preview&&['failed','cancelled'].includes(state.task.status)&&<Button disabled={busy||Boolean(pending.current)} onClick={()=>void start(state.task!.id)}>重新制作一版</Button>}
    </>}
    <input hidden ref={upload} type="file" accept=".zip" aria-label="导入本次网站结果" onChange={e=>{const f=e.target.files?.[0];e.target.value='';if(f)void uploadResult(f);}}/>
  </div>);
  const brief=(<section className="surface studio-brief">
      <div className="section-heading"><div><h2>{goalOpen?'这次想做什么网站？':'本次制作目标'}</h2><p>描述一次目标，资料、文案与素材会随任务传递；收到初稿后直接修改结果。</p></div>{hasRun&&!goalOpen&&<Button variant="ghost" disabled={state.busy||busy} onClick={()=>setEditing(true)}>修改目标</Button>}</div>
      {goalOpen?<Field label="网站目标与要求"><textarea rows={5} maxLength={100000} value={goal} disabled={busy||state.busy} placeholder="例如：做一个温暖的岭南文化网站，有文化介绍、街巷故事和个人探索清单。" onChange={e=>edit(p=>({...p,websiteBrief:{goal:e.target.value,change:p.websiteBrief?.change||'',scope:p.websiteBrief?.scope||'all',autoAssets:p.websiteBrief?.autoAssets??true}}))}/></Field>:<p className="studio-goal">{goal}</p>}
      <div className="studio-facts"><span>交付：可操作的网站预览 + 源码 ZIP</span><span>{project.knowledge?.length?`已沿用 ${project.knowledge.length} 条文化资料`:suggestions.knowledgeIds.length?`将匹配 ${suggestions.knowledgeIds.length} 条文化资料`:'根据目标整理内容'}</span><span>{project.assets.length?`已保留 ${project.assets.length} 张项目图片`:suggestions.assets.length?`将加入 ${suggestions.assets.length} 张原创主题插画`:'可直接制作文字与版式'}</span></div>
      <details className="studio-materials"><summary>查看资料与默认选择</summary><p>已有资料和图片保持可用；新项目自动匹配本机主题库，尚未生成的图片不会被当作已有素材。</p>{!project.assets.length&&suggestions.assets.length>0&&<div className="studio-thumbnails">{suggestions.assets.map(a=><figure key={a.id}><img src={a.thumbnail} alt={a.alt} loading="lazy"/><figcaption>{a.name}</figcaption></figure>)}</div>}<label className="workflow-check"><input type="checkbox" checked={project.websiteBrief?.autoAssets??true} disabled={busy||state.busy} onChange={e=>edit(p=>({...p,websiteBrief:{goal:studioGoal(p),change:p.websiteBrief?.change||'',scope:p.websiteBrief?.scope||'all',autoAssets:e.target.checked}}))}/>为新项目自动匹配内置文化资料与素材</label>{!busy&&!state.busy&&<ThemeAssetsPanel project={project} edit={edit} notice={notice}/>}{project.knowledge?.length? <details><summary>事实与出处</summary><pre className="workflow-text">{knowledgeText(project)}</pre></details>:null}<p>未指定的栏目、文案与排版由 WorkBuddy 补齐。默认交付无需安装依赖的静态网站；真实业务后台与发布另行接入。</p></details>
      {!hasRun&&<Button disabled={!goal.trim()||busy||Boolean(pending.current)} onClick={()=>void start()}>{busy?'正在准备…':'开始制作网站'}</Button>}
      {editing&&hasRun&&<div className="inline-actions"><Button disabled={!goal.trim()||busy||state.busy} onClick={()=>void start()}>按新目标制作一版</Button><Button variant="ghost" onClick={()=>setEditing(false)}>收起目标</Button></div>}
    </section>);
  return <div className="website-studio">
    <ol className="studio-progress" aria-label="网站制作进度"><li aria-current={phase==='describe'?'step':undefined}>1 描述目标</li><li aria-current={phase==='making'?'step':undefined}>2 制作网站</li><li aria-current={['review','complete'].includes(phase)?'step':undefined}>3 查看与交付</li></ol>
    {!hasRun&&brief}
    {hasRun&&<section className="surface studio-status" aria-label="当前制作状态"><div className="section-heading"><div><h3>{title}</h3><p>{state.busy?(preview?'本轮进度和交接入口在修改区，收到新版后会自动显示。':'交接入口在下方，收到网站初稿后会自动显示。'):draft?'已检查源码包结构；请实际操作网站，再决定是否使用。':'可直接预览、下载，或提出一条修改要求。'}</p></div>{preview&&<Button variant="ghost" onClick={focusFeedback}>查看本轮进度与交接</Button>}</div>{!preview&&taskFeedback}</section>}
    {!hasRun&&taskFeedback}
    {preview&&<section className="surface studio-result" aria-label="网站结果"><div className="section-heading"><h2>{preview.fileId===project.websiteSource?.fileId?'当前使用的版本':'新版本预览'}</h2><div className="inline-actions"><Button variant={!mobile?'secondary':'ghost'} onClick={()=>setMobile(false)}>电脑</Button><Button variant={mobile?'secondary':'ghost'} onClick={()=>setMobile(true)}>手机</Button>{draft&&project.websiteSource&&draft.fileId!==project.websiteSource.fileId&&<Button variant="ghost" onClick={()=>setShowCurrent(!showCurrent)}>{showCurrent?'查看新版本':'对照当前版本'}</Button>}</div></div>
      {state.busy&&<p className="muted">下方仍是修改前的版本。新结果回传后会自动更新预览。</p>}
      {preview.previewPath?<div className={'site-frame studio-frame '+(mobile?'is-mobile':'')}><iframe key={preview.fileId} title="网站初稿预览" src={'/api/workbench/data/source-preview/'+preview.fileId+'/'+preview.previewPath.split('/').map(encodeURIComponent).join('/')} sandbox="allow-scripts" referrerPolicy="no-referrer"/></div>:<p>这份源码需要在执行端运行，请查看运行说明。</p>}
      {draft&&!state.selected&&!showCurrent&&<div className="studio-use"><p>{state.stale?'制作依据已有变化。结果保留，请核对目标和资料后制作新版。':'先在上方操作网站；满意后使用这个版本，原版本保留。'}</p><Button disabled={busy||state.stale||state.busy} onClick={()=>void choose()}>使用这个版本</Button></div>}
      <div className="inline-actions"><a href={outputUrl(preview.fileId)} download="网站源码.zip">下载网站源码 ZIP</a></div>
      <details><summary>运行说明与实际检查记录</summary><p>{preview.instructions}</p><WebsiteVerification source={preview}/><p>{preview.verification}</p></details>
      <div className="studio-revision"><h3>哪里需要调整？</h3><div className="studio-scope" aria-label="修改范围">{Object.entries(WEBSITE_SCOPES).map(([key,label])=><button key={key} type="button" aria-pressed={scope===key} disabled={busy} onClick={()=>setScope(key as WebsiteBrief['scope'])}>{label}</button>)}</div><p className="muted">{impact[scope]}</p><Field label="这次的修改要求"><textarea rows={3} maxLength={4000} value={change} disabled={busy} placeholder={state.busy?'可先记下下一轮要求，本轮已提交的内容保持不变。':'例如：首页背景暖一些，保留现有文字和功能。'} onChange={e=>setChange(e.target.value)}/></Field><Button disabled={busy||state.busy||Boolean(pending.current)||!change.trim()||state.stale&&!showCurrent} onClick={()=>void start(state.task&&['failed','cancelled'].includes(state.task.status)?state.task.id:undefined)}>{busy?'正在处理…':state.busy?'本轮进行中，可先编辑下一轮要求':'按此要求修改'}</Button>{taskFeedback}</div>
    </section>}
    {hasRun&&<details className="surface studio-goal-details" open={editing||undefined}><summary>本次目标与资料 · {project.knowledge?.length||0} 条资料 / {project.assets.length} 张项目图片</summary>{brief}</details>}
    <div className="studio-secondary"><Button variant="ghost" onClick={onDetails}>查看制作细节与历史版本</Button><span>资料、图片和旧阶段编辑按需打开。</span></div>
  </div>;
}
