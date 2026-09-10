'use client';
import {useState} from 'react';
import {Button,Field} from '@/components/workbench/ui';
import {sameTaskTarget} from '@/lib/workbench/retry-relations.mjs';
import type {GenerationTask} from './task-results';
export function RetryRecovery({task,tasks,onReplace}:{task:GenerationTask;tasks:GenerationTask[];onReplace:(id:string)=>Promise<void>}) {
  const [choice,setChoice]=useState(''),[busy,setBusy]=useState(false);
  if(task.supersededBy||!['waiting_external','waiting_provider','uncertain'].includes(task.status))return null;
  const options=tasks.filter(t=>sameTaskTarget(task,t)&&t.createdAt>=task.createdAt&&t.status==='succeeded'&&!t.supersededBy);
  if(!options.length)return null;const selected=options.some(t=>t.id===choice)?choice:options[0].id;
  return <details><summary>这个等待已有后续结果？</summary><p>仅在确认属于同一次重试时关联。旧文件保留，远端作业不会因此被取消。</p><Field label="接替此等待的成功任务"><select value={selected} onChange={e=>setChoice(e.target.value)}>{options.map(t=><option key={t.id} value={t.id}>{new Date(t.createdAt).toLocaleString('zh-CN')} · {t.targetName||'同一对象'} · {t.id}</option>)}</select></Field><Button variant="secondary" disabled={busy} onClick={async()=>{setBusy(true);try{await onReplace(selected);}finally{setBusy(false);}}}>确认接替，移入历史</Button></details>;
}
