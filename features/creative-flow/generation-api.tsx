'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AssetImage, Button, Field } from '@/components/workbench/ui';
import type { Project } from '@/features/projects/model';
import { CONTENT_SECTIONS } from '@/features/projects/model';
import { api, imageUrl, serializeWorkspace } from '@/features/projects/server-store';
import { taskSource } from '@/lib/workbench/task-contract.mjs';
import { applyTaskResult, type GenerationTask } from './task-results';
import type { EditProject, Notice } from './stages';
import { ServiceSettings } from './service-settings';
import { OutputTaskPreview } from './delivery-stages';
import { FLOW_LABELS, taskStage, taskMatchesStep } from './flow-guide';

export type GenerationControls = {
  run:(kind:string,args?:Record<string,unknown>)=>void; busy:boolean; contentBusy?:boolean; provider:string; ratio:string;
  fitFrame?:(objectId:string,fit:'pad'|'crop')=>Promise<void>;
  setProvider:(value:string)=>void; setRatio:(value:string)=>void;
};
const names:Record<string,string> = {creative:'创意方案',content:'内容方案',art:'美术提示词',objects:'对象清单',novel:'短篇正文',image:'概念图',cover:'项目封面','video-frame':'镜头首帧候选','design-package':'设计资料包','video-plan':'视频分镜','video-shot':'视频镜头','video-audio':'旁白配音','video-compose':'完整视频',website:'网站生成任务包','website-build':'旧模板网站更新'};
const statuses:Record<string,string> = {queued:'请求已记录',running:'正在生成',waiting_external:'等待 WorkBuddy 文件',waiting_provider:'视频服务处理中',uncertain:'结果待核实',succeeded:'生成完成',failed:'生成失败',cancelled:'已取消等待'};
const sectionNames=Object.fromEntries(Object.values(CONTENT_SECTIONS).flat().map(s=>[s.key,s.label]));
type ServiceStatus={text:{configured:boolean;model:string};images:{provider:string;workbuddyConfigured:boolean;externalConfigured:boolean;model:string};video:{provider:string;externalConfigured:boolean;model:string;scope:string}};

export function useGeneration(project:Project|null,demo:boolean,edit:EditProject,notice:Notice,flush:()=>Promise<void>) {
  const [tasks,setTasks] = useState<GenerationTask[]>([]);
  const [serviceStatus,setServiceStatus] = useState<ServiceStatus|null>(null); const [error,setError] = useState('');
  const [pollError,setPollError] = useState('');
  const [submitting,setSubmitting] = useState(false); const [provider,setProvider] = useState('workbuddy'); const [ratio,setRatio] = useState('1:1');
  const [showHistory,setShowHistory] = useState(false);
  useEffect(() => setShowHistory(false), [project?.stage,project?.type]);
  useEffect(() => { if(error) document.querySelector('.generation-tasks .creative-error')?.scrollIntoView({behavior:'smooth',block:'center'}); }, [error]);
  const [focusTask,setFocusTask] = useState<string|null>(null);
  useEffect(() => {
    if (!focusTask) return;
    const target = document.getElementById('generation-task-'+focusTask);
    if (target) { target.scrollIntoView({behavior:'smooth',block:'center'}); setFocusTask(null); }
  }, [focusTask,tasks]);
  const [chosen,setChosen]=useState<Record<string,{objectIds?:string[];sectionKeys?:string[]}>>({});
  const current = useRef(project); current.current = project;
  const busy = useRef(false); const uncertain = useRef<Record<string,unknown>|null>(null);
  const polling = useRef<Promise<void>|null>(null);
  const refresh = useCallback(async () => {
    if (polling.current) return polling.current;
    const id = current.current?.id; if (!id || id.startsWith('demo-') || document.visibilityState === 'hidden') return;
    const operation = (async () => {
      try {
        const data = await api<{tasks:GenerationTask[]}>('tasks?projectId='+encodeURIComponent(id));
        if (current.current?.id === id) { setTasks(previous=>JSON.stringify(previous)===JSON.stringify(data.tasks)?previous:data.tasks); setPollError(''); }
      } catch (e) { if (current.current?.id === id) setPollError(e instanceof Error ? e.message : '任务状态读取失败。'); }
    })();
    polling.current = operation;
    try { await operation; } finally { if (polling.current === operation) polling.current = null; }
  },[]);
  useEffect(() => {
    setTasks([]);setError('');setPollError('');setShowHistory(false); uncertain.current = null;
    if (!project || demo) return;
    let live = true; let timeout:ReturnType<typeof setTimeout>;
    const poll = async () => { await refresh(); if (live) timeout = setTimeout(poll,2500); };
    void poll(); return () => { live=false;clearTimeout(timeout); };
  },[project?.id,demo,refresh]);
  useEffect(() => { const refreshProvider=()=>{void api<ServiceStatus>('status').then(data => {setProvider(data.images.provider);setServiceStatus(data);}).catch(() => {});}; refreshProvider(); window.addEventListener('workbench-settings-saved',refreshProvider); return ()=>window.removeEventListener('workbench-settings-saved',refreshProvider); },[]);
  async function fitFrame(objectId:string,fit:'pad'|'crop') {
    const id=current.current?.id;if(!id||busy.current||demo)return;
    busy.current=true;setSubmitting(true);setError('');
    try {
      await flush();const before=current.current;if(!before||before.id!==id)return;
      const stamp=JSON.stringify(before);
      const saved=await api<{projectVersion:string}>('core/project_get','POST',{projectId:id});
      await api('core/video_frame_fit','POST',{projectId:id,expectedVersion:saved.projectVersion,requestId:crypto.randomUUID(),objectId,fit});
      const after=await api<{project:Project}>('core/project_get','POST',{projectId:id});
      if(current.current?.id===id&&JSON.stringify(current.current)===stamp)edit(p=>({...after.project,stage:p.stage}));
      notice('已生成独立首帧并保留原图；请预览边缘与主体，再核对视频提示词。');
    }catch(e){setError(e instanceof Error?e.message:'首帧调整失败。');}
    finally{busy.current=false;setSubmitting(false);}
  }
  async function run(kind:string,args:Record<string,unknown>={},retryOf?:string) {
    if (!current.current || busy.current) return;
    if (demo) { notice('演示项目不调用生成服务，请新建真实项目。'); return; }
    busy.current=true;setSubmitting(true);setError(''); const id=current.current.id;
    try {
      if (uncertain.current) throw new Error('上次提交结果尚未确认，请先查询该请求，避免重复生成。');
      await flush();
      const p=current.current; if (!p || p.id!==id) return;
      const options=['image','cover','video-frame'].includes(kind)?{provider,ratio,...args}:kind==='content'?{instruction:p.requests[1],...args}:args;
      const wire=await serializeWorkspace({projects:[p],activeProjectId:p.id});
      const request={id:crypto.randomUUID(),projectId:id,kind,args:options,source:taskSource(wire.projects[0],kind,options),...(retryOf?{retryOf}:{})};
      uncertain.current=request;
      const task=await api<GenerationTask>('tasks','POST',request); uncertain.current=null;
      if (current.current?.id===id) { setTasks(previous=>[task,...previous.filter(t=>t.id!==task.id)]); setFocusTask(task.id); }
    } catch(e) {
      if (uncertain.current) {
        try { const found=await api('tasks/'+uncertain.current.id);if(found?.id){uncertain.current=null;await refresh();} }
        catch(reason){if(reason instanceof Error&&reason.message==='任务不存在。')uncertain.current=null;}
      }
      if(current.current?.id===id)setError(e instanceof Error?e.message:'请求未完成。');
    } finally {busy.current=false;setSubmitting(false);}
  }
  async function dismiss(id:string){try{await api('tasks/'+id+'/dismiss','POST',{});await refresh();}catch(e){setError(String(e));}}
  async function adopt(task:GenerationTask,useSuggestedTitle=false,advance=false){
    const p=current.current;if(!p)return;
    try{
      const next=applyTaskResult(p,task,chosen[task.id]||{});if(useSuggestedTitle&&task.result?.title)next.title=task.result.title;if(advance)next.stage=Math.min(4,p.stage+1);edit(()=>next);await flush();await dismiss(task.id);
      notice(task.result?.websiteRequest?'已保存网站生成任务包，待执行模型实现网站':task.kind==='video-frame'?'首帧候选已保存，核对后选择“采用此首帧”':task.result?.asset&&task.kind!=='cover'?'已放入对象卡片；点击“选用此图”带入下一步。':'已采用生成结果',()=>{
        const latest=current.current;
        if(!latest||latest.id!==p.id||JSON.stringify({...latest,updatedAt:0,stage:0})!==JSON.stringify({...next,updatedAt:0,stage:0})){notice('内容已继续修改，未覆盖后续内容。');return;}
        edit(now=>({...p,stage:now.stage}));
      });
    }catch(e){setError(e instanceof Error?e.message:'结果未采用。');}
  }
  const contentMode=project?.stage===1;
  const matchesContent=(t:GenerationTask)=>{if(t.kind!=='content')return false;if(t.workType)return t.workType===project?.type;try{return JSON.parse(t.source)[1]===project?.type;}catch{return false;}};
  const contentBusy=tasks.some(t=>matchesContent(t)&&!['succeeded','failed','cancelled'].includes(t.status)&&!t.dismissed);
  const matchesStep=(t:GenerationTask)=>Boolean(project && taskMatchesStep(project,t));
  const visible=tasks.filter(t=>(showHistory || matchesStep(t))&&(showHistory||!t.dismissed)).slice(0,showHistory?100:50);
  const elsewhere=tasks.filter(t=>(!t.workType||t.workType===project?.type)&&!t.dismissed&&!matchesStep(t)&&!['failed','cancelled'].includes(t.status));
  const panel=!demo&&project&&<section className="generation-tasks" aria-label="生成任务与结果">
    {pollError&&<div className="creative-feedback creative-error" role="alert">{pollError}<Button variant="ghost" onClick={()=>void refresh()}>刷新状态</Button></div>}
    {(contentMode || visible.length>0) && <div className="section-heading"><div><h3>{showHistory?'项目历史结果':'本步生成结果'}</h3><p>预览后采用，当前稿才会更新；未采用的版本会保留。</p></div></div>}
    {error&&<div className="creative-feedback creative-error" role="alert">{error}<Button variant="secondary" onClick={()=>window.dispatchEvent(new Event('workbench-open-settings'))}>查看生成服务设置</Button><Button variant="ghost" onClick={()=>{setError('');void refresh();}}>刷新状态</Button>{uncertain.current&&<Button onClick={async()=>{try{await api('tasks','POST',uncertain.current);uncertain.current=null;setError('');await refresh();}catch(e){setError(String(e));}}}>核对上次提交</Button>}</div>}
    {visible.map(task=>{
      const stale=taskSource(project,task.kind,task.args)!==task.source;const r=task.result;
      const preview=r?.brief||r?.notes||r?.replacement||(r?.sections&&Object.entries(r.sections).map(([k,v])=>(sectionNames[k]||k)+'\n'+v).join('\n\n'))||r?.art?.fullPrompt||(r?.objects&&r.objects.map(o=>o.name+'：'+o.description).join('\n\n'))||r?.novel?.text||'';
      return <article className="surface task-card" id={'generation-task-'+task.id} key={task.id}><div className="section-heading"><div><h3>{names[task.kind]}{task.targetName ? ` · ${task.targetName}` : ""} · {task.kind==='website'&&task.status==='succeeded'?'任务包已准备':r?.videoClip?.validation?.status==='failed'?'文件已收到 · 规格未通过':statuses[task.status]}</h3><p>{new Date(task.createdAt).toLocaleString('zh-CN')}{task.dismissed?' · 已收起／采用':''}</p></div>{!['succeeded','failed','cancelled'].includes(task.status)&&<Button variant="ghost" onClick={async()=>{try{await api('tasks/'+task.id+'/cancel','POST',{});await refresh();}catch(e){setError(String(e));}}}>取消等待</Button>}</div>
        {['queued','running'].includes(task.status)&&<p role="status">可以继续编辑或离开页面，任务记录会保留。返回结果不会自动覆盖当前内容。</p>}
        {task.status==='waiting_external'&&<p role="status">{task.dispatch==='manual'?'请复制请求到同一台电脑的 WorkBuddy，由它生成并保存结果。':task.dispatch==='pending'?'正在向 WorkBuddy 发送请求。':task.dispatch==='conversation'?'请在发起任务的 WorkBuddy 对话中完成媒体生成并写回文件。':'已向 WorkBuddy 发送请求，等待它生成媒体文件并保存回任务目录。'}若 WorkBuddy 提出授权问题，请在该应用处理。</p>}
        {task.status==='waiting_provider'&&<p role="status">任务编号已保存，刷新只查询进度。媒体下载和处理期间可继续编辑。</p>}
        {task.handoffMessage&&(task.kind==='website'||['waiting_external','uncertain','failed'].includes(task.status))&&<details className="task-handoff" open={task.dispatch==='manual'||task.dispatch==='conversation'||undefined}><summary>下一步：复制请求到 WorkBuddy</summary><textarea readOnly aria-label="WorkBuddy 交接请求" rows={5} value={task.handoffMessage}/><Button variant="secondary" onClick={()=>void navigator.clipboard.writeText(task.handoffMessage!).then(()=>notice('已复制 WorkBuddy 请求')).catch(()=>notice('复制失败，请选中文字手动复制。'))}>复制请求</Button></details>}
        {task.submittedPrompt&&<details><summary>实际提交的提示词与输入</summary><textarea readOnly rows={8} aria-label="实际提交提示词" value={typeof task.submittedPrompt==='string'?task.submittedPrompt:task.submittedPrompt.map(m=>m.role+'\n'+m.content).join('\n\n')}/></details>}
        {task.inputManifest&&<details><summary>这一轮实际沿用的成果</summary>{task.inputManifest.map(input=><details key={input.key}><summary>{input.label} · {input.role==='attached-image'?'实际图片附件':'文字依据'}</summary>{input.role==='attached-image'&&typeof input.value==='string'?<AssetImage asset={{id:input.key,name:input.label,fileId:input.value}} alt={input.label} className="generated-image"/>:<pre className="workflow-text">{typeof input.value==='string'?input.value:JSON.stringify(input.value,null,2)}</pre>}</details>)}</details>}
        {task.recoveredAfterCancel&&<p role="status">已找回取消等待后完成的结果，可预览后决定是否采用。</p>}{task.error&&<p role="status">{task.error}</p>}{task.note&&<p>{task.note}</p>}
        {r?.asset&&<><AssetImage asset={r.asset} alt="生成图片预览" className="generated-image"/><a href={imageUrl(r.asset)} download={r.asset.name+'.png'}>下载原图</a><details><summary>实际出图提示词</summary><p className="creative-text">{r.asset.source?.prompt}</p></details></>}
        <OutputTaskPreview task={task}/>
        {contentMode&&task.kind==='content'&&<p className="content-task-scope">{task.args.action==='check'?'检查遗漏 · 整份方案':task.args.action==='selection'?`选区修改 · ${sectionNames[String(task.args.key)]||'当前小节'}`:task.args.action==='section'?`小节修改 · ${sectionNames[String(task.args.key)]||'当前小节'}`:task.args.action==='alternative'?'另作候选 · 整份方案':'整份内容方案'}{typeof task.args.selectedText==='string'&&` · ${task.args.selectedText.length} 字`}</p>}
        {contentMode&&r?.sections?<div className="content-comparisons">{Object.entries(r.sections).map(([key,text])=>{const selected=chosen[task.id]?.sectionKeys??Object.keys(r.sections!);return <section key={key} className="content-comparison">{!task.dismissed&&<label className="workflow-check"><input type="checkbox" checked={selected.includes(key)} onChange={e=>setChosen(state=>({...state,[task.id]:{...state[task.id],sectionKeys:e.target.checked?[...selected,key]:selected.filter(k=>k!==key)}}))}/>采用「{sectionNames[key]||key}」</label>}<details open={Object.keys(r.sections!).length===1}><summary>{sectionNames[key]||key} · {text===project.content[project.type][key]?'内容未变':'查看对照'}</summary><div className="content-compare-grid"><Field label="当前稿"><textarea readOnly rows={8} value={project.content[project.type][key]||''}/></Field><Field label="修改建议"><textarea readOnly rows={8} value={text}/></Field></div></details></section>;})}</div>:contentMode&&r?.replacement!==undefined?<div className="content-compare-grid"><Field label="原选中文字"><textarea readOnly rows={6} value={String(task.args.selectedText||'')}/></Field><Field label="建议替换为"><textarea readOnly rows={6} value={r.replacement}/></Field></div>:preview&&<Field label={r?.notes?'检查建议':'结果预览'}><textarea readOnly rows={7} value={preview}/></Field>}
        {r?.culture&&<p className="creative-text">文化语境：{r.culture}</p>}
        {r?.title&&<p>建议名称：{r.title}</p>}
        {r?.art&&<p className="muted">参考图片用途作为文字约束使用；当前美术方案不包含自动看图分析。</p>}
        {r?.objects&&!task.dismissed&&<div><h4>选择要采用的对象更新</h4>{r.objects.map(o=>{const selected=chosen[task.id]?.objectIds??r.objects!.map(o=>o.id);const existing=project.concepts.find(c=>c.id===o.id);return <label className="workflow-check" key={o.id}><input type="checkbox" checked={selected.includes(o.id)} onChange={e=>setChosen(state=>({...state,[task.id]:{...state[task.id],objectIds:e.target.checked?[...selected,o.id]:selected.filter(id=>id!==o.id)}}))}/><span>{existing?'更新':'新增'} · {o.name}{existing&&<small>当前：{existing.description}</small>}<small>建议：{o.description}</small></span></label>;})}</div>}
        {!contentMode&&Boolean(task.args.fromNovel)&&r?.sections&&!task.dismissed&&<div><p>正文中的设定仅作为更新建议，选择后采用。</p>{Object.keys(r.sections).map(key=>{const selected=chosen[task.id]?.sectionKeys??Object.keys(r.sections!);return <label key={key} className="workflow-check"><input type="checkbox" checked={selected.includes(key)} onChange={e=>setChosen(state=>({...state,[task.id]:{...state[task.id],sectionKeys:e.target.checked?[...selected,key]:selected.filter(k=>k!==key)}}))}/>{sectionNames[key]}</label>;})}</div>}
        {task.status==='succeeded'&&!task.dismissed&&!r?.notes&&<>{stale&&<p className="muted">生成依据已更新，结果保留供复制或下载，不能覆盖当前内容。</p>}<Button disabled={stale||r?.videoClip?.validation?.status==='failed'||chosen[task.id]?.sectionKeys?.length===0||chosen[task.id]?.objectIds?.length===0} onClick={()=>void adopt(task)}>{contentMode?(r?.sections?`采用选中的 ${chosen[task.id]?.sectionKeys?.length ?? Object.keys(r.sections).length} 个小节`:'采用此处修改'):r?.asset?(task.kind==='cover'?'采用封面':'放入图片候选'):'采用结果'}</Button></>}
        {task.status==='succeeded'&&!task.dismissed&&r?.title&&<Button variant="secondary" disabled={stale} onClick={()=>void adopt(task,true)}>采用并使用建议名称</Button>}
        {task.status==='succeeded'&&!task.dismissed&&!task.args.fromNovel&&!r?.notes&&!contentMode&&['creative','art'].includes(task.kind)&&project.stage<4&&<Button variant="secondary" disabled={stale} onClick={()=>void adopt(task,false,true)}>采用并进入下一阶段</Button>}
        {['failed','cancelled'].includes(task.status)&&!task.dismissed&&<Button variant="secondary" disabled={submitting} onClick={()=>void run(task.kind,task.args,task.id)}>重新生成（新请求）</Button>}
        {task.status==='uncertain'&&!task.dismissed&&<Button variant="ghost" onClick={()=>void dismiss(task.id)}>已核实，收起并释放占位</Button>}
        {['succeeded','failed','cancelled'].includes(task.status)&&!task.dismissed&&<Button variant="ghost" onClick={()=>void dismiss(task.id)}>收起结果</Button>}
      </article>;
    })}
    {!showHistory && elsewhere.length>0 && <div className="other-stage-tasks"><span>其他步骤有 {elsewhere.length} 项结果或进行中的任务</span>{[...new Set(elsewhere.map(t=>taskStage(t.kind,t.args)))].map(stage=><Button key={stage} variant="ghost" onClick={()=>edit(p=>({...p,stage}))}>查看{FLOW_LABELS[stage]}结果</Button>)}</div>}
    {tasks.length>0&&<Button variant="ghost" onClick={()=>setShowHistory(!showHistory)}>{showHistory?'收起历史':'查看历史结果'}</Button>}
  </section>;
  const readiness=!demo && project && serviceStatus && !serviceStatus.text.configured && (project.stage<3 || (project.stage===4&&project.type==='novel')) && <div className="generation-readiness"><div><strong>网页 AI 文字生成还需配置</strong><p>可以先直接编辑；也可以在 WorkBuddy 对话中创作并保存到这个项目。</p></div><Button variant="secondary" onClick={()=>window.dispatchEvent(new Event('workbench-open-settings'))}>配置文字服务</Button></div>;
  return {controls:{run,fitFrame,busy:submitting,contentBusy,provider,ratio,setProvider,setRatio},panel,readiness};
}

export function GenerationServiceStatus(){
  const[data,setData]=useState<ServiceStatus|null>(null);
  const[error,setError]=useState('');
  async function refresh(){try{setData(await api<ServiceStatus>('status'));setError('');}catch(e){setError(String(e));}}
  useEffect(()=>{void refresh();},[]);
  return <><ServiceSettings onSaved={()=>void refresh()}/><div className="settings-section"><h3>多媒体生成服务</h3>{error&&<p role="alert">{error}</p>}{data&&<><p>文字：{data.text.model} · {data.text.configured?'已配置':'待配置服务端密钥'}</p><p>网站：提示词与素材包准备无需文字 API；执行模型负责完整实现。</p><p>WorkBuddy 任务交接：{data.images.workbuddyConfigured?'已配置自动发送授权':'可手动交接，自动发送待授权'}</p><p>外部图像 API：{data.images.model} · {data.images.externalConfigured?'已配置':'待配置'}</p><p>外部视频 API：{data.video?.model} · {data.video?.externalConfigured?'已配置':'待配置'}</p><p className="settings-note">配置状态不等于真实调用成功。可在上方 API 配置中保存地址与密钥。WorkBuddy 的视频与配音能力取决于该应用实际可用服务；视频在本机合成。3D 文创最后实施。</p></>}<Button variant="secondary" onClick={()=>void refresh()}>刷新服务状态</Button></div></>;
}
