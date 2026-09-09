'use client';
import { useState } from 'react';
import { Button, Field, Modal } from '@/components/workbench/ui';
import type { Project } from '@/features/projects/model';
import { applyKnowledge, currentKnowledge, knowledgeText, searchKnowledge, selectedKnowledge } from '@/lib/workbench/knowledge.mjs';
import type { EditProject } from './stages';

export function KnowledgePanel({project,edit}:{project:Project;edit:EditProject}) {
  const [open,setOpen]=useState(false); const [query,setQuery]=useState(''); const [region,setRegion]=useState('');
  const selected=selectedKnowledge(project);
  const found=searchKnowledge(query,region).entries;
  const choose=(id:string,checked:boolean)=>edit(p=>applyKnowledge(p,[id],checked?'add':'remove'));
  const download=()=>{const url=URL.createObjectURL(new Blob([knowledgeText(project)],{type:'text/markdown;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download='岭南文化依据.md';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
  return <section className="surface knowledge-panel" aria-label="岭南文化依据">
    <div className="section-heading"><div><h3>让创意有具体的文化依据</h3><p>从 {currentKnowledge.entries.length} 条已核对资料中选取。选中内容会用于后续生成，保留事实出处与地域差异。</p></div><Button variant="secondary" onClick={()=>setOpen(true)}>选择文化资料</Button></div>
    <div className="knowledge-selected" aria-live="polite">{selected.length ? selected.map(e=><span className="tag tag-soft" key={e.id}>{e.title}<button type="button" aria-label={'移除资料 '+e.title} onClick={()=>choose(e.id,false)}>×</button></span>) : <span className="muted">尚未选择。也可以直接填写自己的文化语境。</span>}</div>
    {selected.length>0&&<details className="quiet-details"><summary>查看本次使用的事实与出处（{selected.length} 条）</summary><pre className="knowledge-context">{knowledgeText(project)}</pre><Button variant="ghost" onClick={download}>下载文化依据</Button></details>}
    <Field label="当前项目的文化语境" hint="填写地域、时代、虚构设定与待核实细节；资料选择不会覆盖这里的文字。"><textarea rows={3} value={project.culture} placeholder="例如：当代广州街区的虚构故事；具体店铺与人物为原创。" onChange={event=>edit(p=>({...p,culture:event.target.value}))}/></Field>
    {open&&<Modal wide title="选择岭南文化资料" subtitle="勾选后随项目自动保存；只加入与作品有关的条目。取消勾选不会删除已生成作品。" onClose={()=>setOpen(false)}>
      <div className="knowledge-filters"><Field label="搜索文化元素"><input type="search" value={query} onChange={e=>setQuery(e.target.value)} placeholder="如：骑楼、彩瓷、客家"/></Field><Field label="文化语境筛选"><select value={region} onChange={e=>setRegion(e.target.value)}><option value="">全部语境</option>{['广府','潮汕','客家','跨区域'].map(r=><option key={r}>{r}</option>)}</select></Field></div>
      <p className="muted">{currentKnowledge.scope} 当前为文字知识资产，未附可直接使用的原站图片或录音。</p>
      <p role="status">找到 {found.length} 条 · 当前选择 {selected.length} 条</p>
      <div className="knowledge-grid">{found.map(e=><article className="knowledge-card" key={e.id}>
        <label className="knowledge-choice"><input type="checkbox" checked={selected.some(s=>s.id===e.id)} onChange={event=>choose(e.id,event.target.checked)}/><strong>{e.title}</strong></label>
        <p className="muted">{e.region} · {e.category}</p>
        <ul>{e.facts.map(f=><li key={f.text}>{f.text}</li>)}</ul>
        <details><summary>出处、创作建议与使用边界</summary><h4>来源</h4>{e.sources.map(s=><p key={s.id}><a href={s.url} target="_blank" rel="noreferrer">{s.title} ↗</a><br/>{s.publisher}<br/>核对：{s.accessedAt}<br/>{s.evidence}</p>)}<h4>创作建议（项目整理）</h4><ul>{e.creativeUses.map(u=><li key={u}>{u}</li>)}</ul><h4>使用边界</h4><ul>{e.avoid.map(u=><li key={u}>{u}</li>)}</ul><p>{e.mediaRights}</p></details>
      </article>)}</div>
      {!found.length&&<p>没有匹配资料。换一个关键词，或清除筛选查看已有条目。</p>}
      <div className="modal-actions"><Button onClick={()=>setOpen(false)}>完成选择，返回创意</Button></div>
    </Modal>}
  </section>;
}
