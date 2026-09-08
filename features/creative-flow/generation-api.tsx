'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AssetImage, Button, Field } from '@/components/workbench/ui';
import type { Project } from '@/features/projects/model';
import { CONTENT_SECTIONS } from '@/features/projects/model';
import { api, imageUrl } from '@/features/projects/server-store';
import { taskSource } from '@/lib/workbench/task-contract.mjs';
import { applyTaskResult, type GenerationTask } from './task-results';
import type { EditProject, Notice } from './stages';
import { OutputTaskPreview } from './delivery-stages';

export type GenerationControls = {
  run:(kind:string,args?:Record<string,unknown>)=>void; busy:boolean; provider:string; ratio:string;
  setProvider:(value:string)=>void; setRatio:(value:string)=>void;
};
const names:Record<string,string> = {creative:'创意方案',content:'内容方案',art:'美术提示词',objects:'对象清单',novel:'短篇正文',image:'概念图',cover:'项目封面','video-plan':'视频分镜','video-shot':'视频镜头','video-audio':'旁白配音','video-compose':'完整视频',website:'网站成品','website-build':'网站更新'};
const statuses:Record<string,string> = {queued:'请求已记录',running:'正在生成',waiting_external:'等待 WorkBuddy 文件',waiting_provider:'视频服务处理中',uncertain:'结果待核实',succeeded:'生成完成',failed:'生成失败',cancelled:'已取消等待'};
const sectionNames=Object.fromEntries(Object.values(CONTENT_SECTIONS).flat().map(s=>[s.key,s.label]));
type ServiceStatus={text:{configured:boolean;model:string};images:{provider:string;workbuddyConfigured:boolean;externalConfigured:boolean;model:string};video:{provider:string;externalConfigured:boolean;model:string;scope:string}};

export function useGeneration(project:Project|null,demo:boolean,edit:EditProject,notice:Notice,flush:()=>Promise<void>) {
  const [tasks,setTasks] = useState<GenerationTask[]>([]); const [error,setError] = useState('');
  const [submitting,setSubmitting] = useState(false); const [provider,setProvider] = useState('workbuddy'); const [ratio,setRatio] = useState('1:1');
  const [showHistory,setShowHistory] = useState(false);
  const current = useRef(project); current.current = project;
  const busy = useRef(false); const uncertain = useRef<Record<string,unknown>|null>(null);
  const refresh = useCallback(async () => {
    const id = current.current?.id; if (!id || id.startsWith('demo-')) return;
    try { const data = await api<{tasks:GenerationTask[]}>('tasks?projectId='+encodeURIComponent(id)); if (current.current?.id === id) setTasks(data.tasks); }
    catch (e) { if (current.current?.id === id) setError(e instanceof Error ? e.message : '任务状态读取失败。'); }
  },[]);
  useEffect(() => {
    setTasks([]);setError('');setShowHistory(false); uncertain.current = null;
    if (!project || demo) return;
    let live = true; let timeout:ReturnType<typeof setTimeout>;
    const poll = async () => { await refresh(); if (live) timeout = setTimeout(poll,2500); };
    void poll(); return () => { live=false;clearTimeout(timeout); };
  },[project?.id,demo,refresh]);
  useEffect(() => { api<ServiceStatus>('status').then(data => setProvider(data.images.provider)).catch(() => {}); },[]);
  async function run(kind:string,args:Record<string,unknown>={}) {
    if (!current.current || busy.current) return;
    if (demo) { notice('演示项目不调用生成服务，请新建真实项目。'); return; }
    busy.current=true;setSubmitting(true);setError(''); const id=current.current.id;
    try {
      if (uncertain.current) throw new Error('上次提交结果尚未确认，请先查询该请求，避免重复生成。');
      await flush();
      const p=current.current; if (!p || p.id!==id) return;
      const options=['image','cover'].includes(kind)?{...args,provider,ratio}:args;
      const request={id:crypto.randomUUID(),projectId:id,kind,args:options,source:taskSource(p,kind,options)};
      uncertain.current=request;
      const task=await api<GenerationTask>('tasks','POST',request); uncertain.current=null;
      if (current.current?.id===id) setTasks(previous=>[task,...previous.filter(t=>t.id!==task.id)]);
    } catch(e) {
      if (uncertain.current) {
        try { const found=await api('tasks/'+uncertain.current.id);if(found?.id){uncertain.current=null;await refresh();} }
        catch(reason){if(reason instanceof Error&&reason.message==='任务不存在。')uncertain.current=null;}
      }
      if(current.current?.id===id)setError(e instanceof Error?e.message:'请求未完成。');
    } finally {busy.current=false;setSubmitting(false);}
  }
  async function dismiss(id:string){try{await api('tasks/'+id+'/dismiss','POST',{});await refresh();}catch(e){setError(String(e));}}
  async function adopt(task:GenerationTask,useSuggestedTitle=false){
    const p=current.current;if(!p)return;
    try{
      const next=applyTaskResult(p,task);if(useSuggestedTitle&&task.result?.title)next.title=task.result.title;edit(()=>next);await flush();await dismiss(task.id);
      notice(task.result?.asset&&task.kind!=='cover'?'已加入候选图；满意后点击保存，加入选定参考。':'已采用生成结果',()=>{
        const latest=current.current;
        if(!latest||latest.id!==p.id||JSON.stringify({...latest,updatedAt:0,stage:0})!==JSON.stringify({...next,updatedAt:0,stage:0})){notice('内容已继续修改，未覆盖后续内容。');return;}
        edit(now=>({...p,stage:now.stage}));
      });
    }catch(e){setError(e instanceof Error?e.message:'结果未采用。');}
  }
  const visible=tasks.filter(t=>showHistory||!t.dismissed).slice(0,showHistory?100:50);
  const panel=!demo&&project&&<section className="generation-tasks" aria-label="生成任务与结果">
    {error&&<div className="creative-feedback creative-error" role="alert">{error}<Button variant="ghost" onClick={()=>{setError('');void refresh();}}>刷新状态</Button>{uncertain.current&&<Button onClick={async()=>{try{await api('tasks','POST',uncertain.current);uncertain.current=null;setError('');await refresh();}catch(e){setError(String(e));}}}>核对上次提交</Button>}</div>}
    {visible.map(task=>{
      const stale=taskSource(project,task.kind,task.args)!==task.source;const r=task.result;
      const preview=r?.brief||r?.notes||r?.replacement||(r?.sections&&Object.entries(r.sections).map(([k,v])=>(sectionNames[k]||k)+'\n'+v).join('\n\n'))||r?.art?.fullPrompt||(r?.objects&&r.objects.map(o=>o.name+'：'+o.description).join('\n\n'))||r?.novel?.text||'';
      return <article className="surface task-card" key={task.id}><div className="section-heading"><div><h3>{names[task.kind]}{task.targetName ? ` · ${task.targetName}` : ""} · {statuses[task.status]}</h3><p>{new Date(task.createdAt).toLocaleString('zh-CN')}{task.dismissed?' · 已收起／采用':''}</p></div>{!['succeeded','failed','cancelled'].includes(task.status)&&<Button variant="ghost" onClick={async()=>{try{await api('tasks/'+task.id+'/cancel','POST',{});await refresh();}catch(e){setError(String(e));}}}>取消等待</Button>}</div>
        {['queued','running'].includes(task.status)&&<p role="status">可以继续编辑或离开页面，任务记录会保留。返回结果不会自动覆盖当前内容。</p>}
        {task.status==='waiting_external'&&<p role="status">{task.dispatch==='manual'?'请复制请求到同一台电脑的 WorkBuddy，由它生成并保存结果。':task.dispatch==='pending'?'正在向 WorkBuddy 发送请求。':'已向 WorkBuddy 发送请求，等待它生成媒体文件并保存回任务目录。'}若 WorkBuddy 提出授权问题，请在该应用处理。</p>}
        {task.status==='waiting_provider'&&<p role="status">任务编号已保存，刷新只查询进度。媒体下载和处理期间可继续编辑。</p>}
        {task.handoffMessage&&['waiting_external','uncertain','failed'].includes(task.status)&&<details><summary>WorkBuddy 请求与交接</summary><textarea readOnly aria-label="WorkBuddy 图片请求" rows={5} value={task.handoffMessage}/><Button variant="secondary" onClick={()=>void navigator.clipboard.writeText(task.handoffMessage!).then(()=>notice('已复制 WorkBuddy 请求')).catch(()=>notice('复制失败，请选中文字手动复制。'))}>复制请求</Button></details>}
        {task.error&&<p role="status">{task.error}</p>}{task.note&&<p>{task.note}</p>}
        {r?.asset&&<><AssetImage asset={r.asset} alt="生成图片预览" className="generated-image"/><a href={imageUrl(r.asset)} download={r.asset.name+'.png'}>下载原图</a><details><summary>实际出图提示词</summary><p className="creative-text">{r.asset.source?.prompt}</p></details></>}
        <OutputTaskPreview task={task}/>
        {preview&&<Field label="结果预览"><textarea readOnly rows={7} value={preview}/></Field>}
        {r?.culture&&<p className="creative-text">文化语境：{r.culture}</p>}
        {r?.title&&<p>建议名称：{r.title}</p>}
        {r?.art&&<p className="muted">参考图片用途作为文字约束使用；当前美术方案不包含自动看图分析。</p>}
        {task.status==='succeeded'&&!task.dismissed&&!r?.notes&&<>{stale&&<p className="muted">生成依据已更新，结果保留供复制或下载，不能覆盖当前内容。</p>}<Button disabled={stale} onClick={()=>void adopt(task)}>{r?.asset?(task.kind==='cover'?'采用封面':'加入候选图'):'采用结果'}</Button></>}
        {task.status==='succeeded'&&!task.dismissed&&r?.title&&<Button variant="secondary" disabled={stale} onClick={()=>void adopt(task,true)}>采用并使用建议名称</Button>}
        {['succeeded','failed','cancelled'].includes(task.status)&&!task.dismissed&&<Button variant="ghost" onClick={()=>void dismiss(task.id)}>收起结果</Button>}
      </article>;
    })}
    {tasks.length>0&&<Button variant="ghost" onClick={()=>setShowHistory(!showHistory)}>{showHistory?'收起历史':'查看历史结果'}</Button>}
  </section>;
  return {controls:{run,busy:submitting,provider,ratio,setProvider,setRatio},panel};
}

export function GenerationServiceStatus(){
  const[data,setData]=useState<ServiceStatus|null>(null);
  const[error,setError]=useState('');
  async function refresh(){try{setData(await api<ServiceStatus>('status'));setError('');}catch(e){setError(String(e));}}
  useEffect(()=>{void refresh();},[]);
  return <div className="settings-section"><h3>多媒体生成服务</h3>{error&&<p role="alert">{error}</p>}{data&&<><p>文字与网站：{data.text.model} · {data.text.configured?'已配置':'待配置服务端密钥'}</p><p>WorkBuddy 媒体交接：{data.images.workbuddyConfigured?'已配置自动发送授权':'可手动交接，自动发送待授权'}</p><p>外部图像 API：{data.images.model} · {data.images.externalConfigured?'已配置':'待配置'}</p><p>外部视频 API：{data.video?.model} · {data.video?.externalConfigured?'已配置':'待配置'}</p><p className="settings-note">配置状态不等于真实调用成功。地址与密钥在服务端配置。WorkBuddy 的视频与配音能力取决于该应用实际可用服务；视频在本机合成。3D 文创最后实施。</p></>}<Button variant="secondary" onClick={()=>void refresh()}>刷新服务状态</Button></div>;
}
