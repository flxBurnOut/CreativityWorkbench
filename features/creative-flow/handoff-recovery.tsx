'use client';
import {useState} from 'react';
import {AssetImage,Button,Field} from '@/components/workbench/ui';
import type {Project} from '@/features/projects/model';
import {api} from '@/features/projects/server-store';
import type {GenerationTask} from './task-results';

export function HandoffRecovery({project,task,onComplete}:{project:Project;task:GenerationTask;onComplete:()=>Promise<void>}) {
  const [assetId,setAssetId]=useState('');const [busy,setBusy]=useState(false);const [message,setMessage]=useState('');
  const asset=project.assets.find(a=>a.id===assetId);
  if(!task.handoffContract||!['waiting_external','uncertain'].includes(task.status))return null;
  async function complete() {
    if(!asset||busy)return;setBusy(true);setMessage('');
    try {
      await api('core/task_complete_handoff','POST',{taskId:task.id,assetId:asset.id});
      setMessage('图片已交回原任务，正在校验。等待显示生成完成后再采用。');await onComplete();
    } catch(e) {setMessage(e instanceof Error?e.message:'交接未完成，请查询原任务后重试。');}
    finally {setBusy(false);}
  }
  return <details className="task-handoff"><summary>图片已生成，但这里仍在等待？</summary><p>出图或入库后，还需交回这个任务。请在 WorkBuddy 接续上方原请求；如果图片已经在本项目素材库中，也可以在这里选中并交回。不会重新生成图片。</p><Field label="选择本次已经生成的图片"><select value={assetId} disabled={busy} onChange={e=>{setAssetId(e.target.value);setMessage('');}}><option value="">请选择对应图片</option>{project.assets.map(a=><option key={a.id} value={a.id}>{a.name}</option>)}</select></Field>{asset&&<AssetImage asset={asset} alt="待交回原任务的图片" className="generated-image"/>}<Button variant="secondary" disabled={!asset||busy} onClick={()=>void complete()}>{busy?'正在交回原任务…':'用这张图片完成原交接'}</Button>{message&&<p role="status">{message}</p>}</details>;
}
