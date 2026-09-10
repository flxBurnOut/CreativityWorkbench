'use client';
import {useState} from 'react';
import {Button,Field,Modal} from '@/components/workbench/ui';
import type {Project} from '@/features/projects/model';
import {applyThemeAssets,searchThemeAssets,themeAssetRecord} from '@/lib/workbench/theme-assets.mjs';
import type {EditProject,Notice} from './stages';

export function ThemeAssetsPanel({project,edit,notice}:{project:Project;edit:EditProject;notice?:Notice}) {
  const [open,setOpen]=useState(false),[query,setQuery]=useState(''),[busy,setBusy]=useState(''),[error,setError]=useState('');
  const found=searchThemeAssets(query).entries;
  return <div className="theme-assets-panel"><Button variant="secondary" onClick={()=>setOpen(true)}>选择主题视觉素材</Button>
    {open&&<Modal wide title="岭南主题视觉素材" subtitle="原创设计示意，可用于文创文旅网站。加入时同步文化依据，保留你的项目设定。" onClose={()=>{if(!busy)setOpen(false);}}>
      <Field label="搜索主题视觉素材"><input type="search" value={query} onChange={e=>setQuery(e.target.value)} placeholder="骑楼、园林、广州、佛山…"/></Field>
      {error&&<p role="alert">{error}</p>}<p className="muted">{found.length} 组 · 每组包含 PNG、可编辑 SVG 和出处说明。不是实景照片或文物复原。</p>
      <div className="knowledge-grid">{found.map(entry=>{const added=project.concepts.some(c=>c.savedAssetId==='theme-'+entry.id)&&(project.type!=='website'||!project.websiteRequest||project.websiteRequest.assetIds.includes('theme-'+entry.id));return <article className="knowledge-card" key={entry.id}>
        <img src={entry.thumbnail} alt={entry.alt} width="360" height={Math.round(360*entry.height/entry.width)} loading="lazy" decoding="async" style={{width:'100%',height:180,objectFit:'cover',borderRadius:8}}/>
        <h4>{entry.name}</h4><p className="muted">{entry.region} · {entry.width} × {entry.height}</p><p>{entry.usage}</p>
        <details><summary>文化依据与使用说明</summary><p>{entry.description}</p><p>{entry.rights}</p>{entry.sources.map(s=><p key={s.url}><a href={s.url} target="_blank" rel="noreferrer">{s.title} ↗</a></p>)}<a href={entry.svg} download>下载可编辑 SVG</a></details>
        <Button variant="secondary" disabled={Boolean(busy)||added} onClick={async()=>{setBusy(entry.id);setError('');try{const response=await fetch(entry.png,{signal:AbortSignal.timeout(15000)});if(!response.ok)throw new Error('主题原图读取失败，请检查工作台安装文件。');const asset=themeAssetRecord(entry,{blob:await response.blob()});edit(p=>applyThemeAssets(p,[asset]));notice?.('素材与文化依据已加入，网站交接时会附上实际文件。');}catch(e){setError(e instanceof Error?e.message:'素材加入失败');}finally{setBusy('');}}}>{added?'已加入作品':busy===entry.id?'正在加入…':'加入并用于作品'}</Button>
      </article>;})}</div>
      {!found.length&&<p>没有匹配素材，请换一个关键词。</p>}
      <div className="modal-actions"><Button disabled={Boolean(busy)} onClick={()=>setOpen(false)}>完成选择</Button></div>
    </Modal>}
  </div>;
}
