'use client';
import { useRef } from 'react';
import { Button } from '@/components/workbench/ui';
import { backupWorkspace,legacyProjects,restoreOutputFiles } from './server-store';
import { parseStoredWorkspace,type Project,type Workspace } from './model';
import { projectOutputIds } from '../../lib/workbench/output-contract.mjs';
export function StorageActions({workspace,change,notice}:{workspace:Workspace;change:(update:(p:Workspace)=>Workspace)=>void;notice:(message:string)=>void}){
  const upload=useRef<HTMLInputElement>(null);
  function merge(projects:Project[]){
    change(ws=>({...ws,projects:[...ws.projects,...projects.map(p=>({...p,id:crypto.randomUUID(),title:p.title+'（导入）',updatedAt:Date.now()}))]}));notice('已导入为独立项目，原项目未覆盖。');
  }
  return <div className="inline-actions"><Button variant="secondary" onClick={async()=>{try{const backup=await backupWorkspace(workspace);const blob=new Blob([JSON.stringify(backup)],{type:'application/json'});if(blob.size>200*1024*1024)throw new Error('备份超过 200 MB，请停服务后复制整个 work/data 文件夹。');const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download='创意工作台备份.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}catch(e){notice(e instanceof Error?e.message:'备份未完成。');}}}>导出全部项目备份</Button><Button variant="ghost" onClick={()=>upload.current?.click()}>导入备份</Button><Button variant="ghost" onClick={async()=>{try{const projects=await legacyProjects();if(!projects.length)notice('此浏览器没有旧草稿。');else merge(projects);}catch(e){notice(String(e));}}}>导入旧浏览器草稿</Button><input ref={upload} type="file" accept="application/json,.json" hidden aria-label="导入项目备份" onChange={async e=>{
    const file=e.target.files?.[0];e.target.value='';if(!file)return;
    try{
      if(file.size>200*1024*1024)throw new Error('备份文件请小于 200 MB。');
      const value=JSON.parse(await file.text());if(value.format!=='lingnan-workbench-backup'||![1,2].includes(value.version)||!Array.isArray(value.workspace?.projects))throw new Error('不是有效的工作台备份。');
      for(const p of value.workspace.projects)for(const asset of p.assets){if(typeof asset.data!=='string'||!/^data:image\/(png|jpeg|webp);base64,/.test(asset.data))throw new Error('备份图片格式无效。');const response=await fetch(asset.data);asset.blob=await response.blob();delete asset.data;}
      const parsed=parseStoredWorkspace({version:1,revision:1,workspace:value.workspace});const required=parsed.workspace.projects.flatMap(projectOutputIds);if(required.length&&value.version!==2)throw new Error('该备份缺少成品文件部分。');if(value.version===2)await restoreOutputFiles(value.files,required);merge(parsed.workspace.projects);
    }catch(reason){notice(reason instanceof Error?reason.message:'备份无法导入。');}
  }}/></div>;
}
