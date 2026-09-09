'use client';

import { useRef, useState } from 'react';
import { AssetImage, Button, Empty, Field, Icon, Modal } from '@/components/workbench/ui';
import { imageFromFile } from '@/features/projects/local-store';
import { CATEGORIES, TYPE_LABELS, pruneAssets, removeConcept, type Category, type Concept, type ImageAsset, type Project, type WorkType } from '@/features/projects/model';

import type { CreativeControls } from './creative-api';
import type { GenerationControls } from './generation-api';
import { imageUrl } from '@/features/projects/server-store';
import { VideoOutput, WebsiteOutput } from './delivery-stages';
import {ObjectBindings,NovelReferences,DesignDelivery,InputSummary} from './workflow-panel';
import { FLOW_LABELS, nextStage, optionalStage } from './flow-guide';
import { KnowledgePanel } from './knowledge-panel';
import { formatNovel } from '@/lib/workbench/novel-export.mjs';
import { ImageComparison } from './image-comparison';

export type Notice = (message: string, undo?: () => void) => void;
export type EditProject = (update: (project: Project) => Project) => void;
export type DemoState = 'ready' | 'empty' | 'loading' | 'error';
interface StageProps { project: Project; edit: EditProject; notice: Notice; unavailable: (action: string) => void; demo: boolean; demoState: DemoState; creative?: CreativeControls; generation?: GenerationControls }

export function UploadButton({ children = '上传图片', onUpload, notice, secondary = true }: { children?: string; onUpload: (asset: ImageAsset) => void; notice: Notice; secondary?: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  return <><Button variant={secondary ? 'secondary' : 'ghost'} icon="upload" disabled={busy} onClick={() => input.current?.click()}>{busy ? '正在读取…' : children}</Button><input ref={input} type="file" accept="image/png,image/jpeg,image/webp" hidden aria-label={children} onChange={async event => {
    const file = event.target.files?.[0]; event.target.value = ''; if (!file) return;
    setBusy(true);
    try { const blob = await imageFromFile(file); onUpload({ id: crypto.randomUUID(), name: file.name, blob }); }
    catch (error) { notice(error instanceof Error ? error.message : '图片读取失败。'); }
    finally { setBusy(false); }
  }} /></>;
}

function AiNote({ children }: { children?: string }) { return <span className="ai-note"><Icon name="spark" size={14} />{children ?? 'AI 服务暂未接入，当前可直接编辑'}</span>; }

function changeUpstream(edit: EditProject, update: (project: Project) => Project) {
  edit(p => ({ ...update(p), upstreamChanged: p.upstreamChanged || p.concepts.some(c => c.savedAssetId) }));
}

export function CreativeStage({ project, edit, creative, demo }: StageProps) {
  const hasBrief=Boolean(project.brief.trim());
  return <div className="stage-stack">
    <section className="surface writing-surface creative-start"><div className="section-heading"><h3>从你的想法开始</h3><AiNote>{demo ? '演示不调用 AI' : '填写后展开方案，也可直接粘贴已有方案'}</AiNote></div>
      <Field label="你最初的想法"><textarea className="idea-input" rows={2} value={project.idea} placeholder="围绕岭南文化，写下一句想法……" onChange={event => changeUpstream(edit,p=>({...p,idea:event.target.value}))}/></Field>
      <div className="creative-start-actions"><Button icon="spark" disabled={creative?.busy||!project.idea.trim()} onClick={()=>creative?.run('improve')}>{hasBrief?'继续完善方案':'展开创意方案'}</Button>{hasBrief&&<Button variant="ghost" icon="refresh" disabled={creative?.busy} onClick={()=>creative?.run('redirect')}>另想一个方向</Button>}<span className="muted">生成后在本页预览，采用满意的方案。</span></div>
      <details className="creative-current" open={hasBrief||undefined}><summary>{hasBrief?'当前创意方案 · '+project.brief.length+' 字':'已有方案？直接填写或粘贴'}</summary><textarea aria-label="当前创意方案" className="document-editor" rows={6} value={project.brief} placeholder="写清要创作什么、面向谁，以及一定要保留的内容。" onChange={event=>changeUpstream(edit,p=>({...p,brief:event.target.value}))}/></details>
      {hasBrief&&<details className="creative-current"><summary>提出修改要求</summary><Field label="创意方案修改要求"><textarea rows={2} value={project.requests[0]} placeholder="例如：保留人物关系，把主题改成邻里互助。" onChange={event=>edit(p=>({...p,requests:p.requests.map((value,i)=>i===0?event.target.value:value)}))}/></Field><Button variant="secondary" disabled={creative?.busy||!project.requests[0].trim()} onClick={()=>creative?.run('revise')}>生成修改建议</Button></details>}
    </section>
    <KnowledgePanel project={project} edit={edit}/>
  </div>;
}

export { ContentEditor as ContentStage } from './content-editor';

export function ArtStage({ project, edit, notice, generation }: StageProps) {
  const [preview, setPreview] = useState<ImageAsset | null>(null);
  const fields: { key: keyof Project['art']; label: string; hint: string }[] = [
    { key: 'direction', label: '整体视觉方向', hint: '希望作品给人怎样的第一印象？例如温暖、轻盈的当代生活插画。' },
    { key: 'material', label: '造型与材质', hint: '写下线条、形体、笔触和材质的偏好。' },
    { key: 'palette', label: '色彩与光线', hint: '主色、点缀色、光线和氛围。' },
    { key: 'constraints', label: '保持与排除', hint: '明确保留的细节，以及不要出现的内容。' },
  ];
  return <div className="stage-stack"><section className="surface"><div className="section-heading"><div><h3>当前美术方案</h3><p>表达方式可以变化，岭南文化背景贯穿其中。</p></div><div className="inline-actions"><Button variant="secondary" disabled={generation?.busy} onClick={()=>generation?.run('art',{action:'generate'})}>{project.art.direction||project.art.fullPrompt?'继续完善美术方案':'生成美术方案'}</Button><Button variant="ghost" disabled={generation?.busy} onClick={()=>generation?.run('art',{action:'alternative'})}>另作美术候选</Button></div></div><div className="art-fields">{fields.map(field => <Field key={field.key} label={field.label}><textarea rows={3} value={project.art[field.key]} placeholder={field.hint} onChange={event => edit(p => ({ ...p, art: { ...p.art, [field.key]: event.target.value } }))} /></Field>)}</div></section>
    <section className="surface"><div className="section-heading"><div><h3>参考图片 <span className="muted optional">可选</span></h3><p>说清楚想参考什么，图片不会替你决定整个风格。</p></div><UploadButton notice={notice} onUpload={asset => edit(p => ({ ...p, assets: [...p.assets, asset], references: [...p.references, { id: crypto.randomUUID(), assetId: asset.id, purpose: '' }] }))} /></div>{project.references.length ? <div className="style-reference-list">{project.references.map(reference => <div className="style-reference" key={reference.id}><button type="button" className="image-button" aria-label="放大参考图片" onClick={() => setPreview(project.assets.find(asset => asset.id === reference.assetId) ?? null)}><AssetImage asset={project.assets.find(asset => asset.id === reference.assetId)} alt="上传的美术参考" /></button><Field label="这张图只参考什么？"><input value={reference.purpose} placeholder="例如：只参考配色，不复制人物与背景" onChange={event => edit(p => ({ ...p, references: p.references.map(ref => ref.id === reference.id ? { ...ref, purpose: event.target.value } : ref) }))} /></Field><button type="button" className="icon-button" aria-label="移除参考图片" onClick={() => {
      const removedAsset = project.assets.find(asset => asset.id === reference.assetId);
      edit(p => pruneAssets({ ...p, references: p.references.filter(ref => ref.id !== reference.id) }));
      notice('已移除参考图片', () => edit(p => ({ ...p, references: p.references.some(ref => ref.id === reference.id) ? p.references : [...p.references, reference], assets: removedAsset && !p.assets.some(a => a.id === removedAsset.id) ? [...p.assets, removedAsset] : p.assets })));
    }}><Icon name="close" /></button></div>)}</div> : <div className="upload-hint"><Icon name="image" size={25} /><span>没有图片也能继续。支持 PNG、JPG、WebP，单张不超过 8 MB。</span></div>}</section>
    <details className="surface quiet-details"><summary><span><Icon name="book" />完整美术提示词</span><span className="summary-tail">可编辑、可复制 <Icon name="chevron" /></span></summary><p className="muted">保留你实际想使用的完整文字，后续生成会同时读取当前独立美术字段和这里的综合表达。</p><textarea rows={7} aria-label="完整美术提示词" value={project.art.fullPrompt} placeholder="可以在这里粘贴或编写完整提示词……" onChange={event => edit(p => ({ ...p, art: { ...p.art, fullPrompt: event.target.value } }))} /><div className="align-end"><Button variant="secondary" icon="copy" disabled={!project.art.fullPrompt.trim()} onClick={async () => { try { await navigator.clipboard.writeText(project.art.fullPrompt); notice('完整提示词已复制'); } catch { notice('复制未完成，请选中文字后手动复制。'); } }}>复制提示词</Button></div></details>
    {preview && <ImagePreview asset={preview} onClose={() => setPreview(null)} />}
  </div>;
}

export function ImagePreview({ asset, onClose }: { asset: ImageAsset; onClose: () => void }) { return <Modal title={asset.name} subtitle="按原图显示，不叠加界面色彩或纹理。" onClose={onClose} wide><AssetImage asset={asset} alt={asset.name} className="lightbox-image" />{asset.fileId&&<a href={imageUrl(asset)} download={asset.name+'.png'}>下载原图</a>}{asset.source?.prompt&&<details><summary>实际出图提示词</summary><p className="creative-text">{asset.source.prompt}</p></details>}</Modal>; }

export function DemoFeedback({ state }: { state: DemoState }) {
  if (state === 'ready' || state === 'empty') return null;
  return <div className={`demo-feedback ${state === 'error' ? 'feedback-error' : ''}`} role="status"><Icon name={state === 'loading' ? 'refresh' : 'alert'} /><div><strong>{state === 'loading' ? '正在生成 · 状态演示' : '生成未完成 · 状态演示'}</strong><p>{state === 'loading' ? '这里展示任务等待时的布局，没有发起实际请求。' : '原稿、原图与修改要求仍然保留。这里没有实际生成失败的任务。'}</p></div></div>;
}

export function ConceptsStage({ project, edit, notice, generation, demo, demoState }: StageProps) {
  const [comparison,setComparison]=useState<{conceptId:string;asset:ImageAsset}|null>(null);
  const [category, setCategory] = useState<Category | 'all'>('all');
  const [objectForm, setObjectForm] = useState<{ id?: string; name: string; description: string; category: Category } | null>(null);
  const [reworkId, setReworkId] = useState<string | null>(null);
  const [newStyle, setNewStyle] = useState(false);
  const [preview, setPreview] = useState<ImageAsset | null>(null);
  const concepts = demo && demoState === 'empty' ? [] : project.concepts;
  const shown = concepts.filter(concept => category === 'all' || concept.category === category);
  const saved = concepts.filter(concept => concept.savedAssetId);
  const rework = project.concepts.find(concept => concept.id === reworkId);
  const uploadCandidate = (id: string, asset: ImageAsset) => {
    edit(p => pruneAssets({ ...p, assets: [...p.assets, asset], concepts: p.concepts.map(concept => concept.id === id ? { ...concept, candidateAssetId: asset.id } : concept) }));
    notice('图片已作为候选加入；点击“选用此图”可选入参考集。');
  };
  function saveConcept(concept: Concept,review?:Concept['imageReview']) {
    if (!concept.candidateAssetId || concept.candidateAssetId === concept.savedAssetId) return;
    edit(p => pruneAssets({ ...p, concepts: p.concepts.map(item => item.id === concept.id ? { ...item, savedAssetId: item.candidateAssetId,...(review?{imageReview:review}:{}) } : item), coverAssetId: !p.manualCover && (!p.coverAssetId || p.coverAssetId === concept.savedAssetId) ? concept.candidateAssetId : p.coverAssetId }));
    notice('已加入选定参考集');
  }
  function deleteImage(concept: Concept) {
    const separateCandidate = concept.candidateAssetId && concept.candidateAssetId !== concept.savedAssetId;
    const previousAssets = project.assets;
    const previousCover = project.coverAssetId;
    edit(p => {
      const next = { ...p, concepts: p.concepts.map(item => item.id !== concept.id ? item : { ...item, candidateAssetId: undefined, savedAssetId: separateCandidate ? item.savedAssetId : undefined }) };
      if (!separateCandidate && !p.manualCover && p.coverAssetId === concept.savedAssetId) next.coverAssetId = next.concepts.find(item => item.savedAssetId)?.savedAssetId;
      return pruneAssets(next);
    });
    notice(separateCandidate ? '已删除新候选，原有参考仍保留' : '图片已从候选与参考集中移除', () => edit(p => ({ ...p, assets: [...p.assets, ...previousAssets.filter(a => !p.assets.some(item => item.id === a.id))], concepts: p.concepts.map(item => item.id === concept.id ? { ...item, candidateAssetId: concept.candidateAssetId, savedAssetId: concept.savedAssetId } : item), coverAssetId: !p.manualCover && !p.coverAssetId ? previousCover : p.coverAssetId })));
  }
  return <div className="stage-stack"><div className="surface generation-options"><Field label="图片生成方式"><select value={generation?.provider} onChange={e=>generation?.setProvider(e.target.value)}><option value="workbuddy">WorkBuddy</option><option value="external">外部 API</option></select></Field><Field label="图片比例"><select value={generation?.ratio} onChange={e=>generation?.setRatio(e.target.value)}><option value="1:1">方图</option><option value="3:2">横图</option><option value="2:3">竖图</option></select></Field><Button variant="secondary" disabled={generation?.busy} onClick={()=>generation?.run('objects')}>{concepts.length?'检查并更新对象设定':'从内容提取对象'}</Button></div>{demo && <DemoFeedback state={demoState} />}<section className="surface"><div className="section-heading"><div><h3>人物、场景与物件图片</h3><p>{project.type==='website'?'按页面内容准备需要的图像素材，每张图注明实际用途。':project.type==='craft'?'按主体、局部与材质需要准备概念参考，延续已采用的设计。':'只整理需要的人物、场景与物件。每张图与对象设定保持关联。'}</p></div><Button icon="plus" variant="secondary" onClick={() => setObjectForm({ name: '', description: '', category: category === 'all' ? 'object' : category })}>添加对象</Button></div><div className="category-tabs" aria-label="概念图类别">{(['all', 'character', 'map', 'object'] as const).map(key => <button type="button" key={key} aria-pressed={category === key} onClick={() => setCategory(key)}>{key === 'all' ? '全部' : CATEGORIES[key]}<span>{key === 'all' ? concepts.length : concepts.filter(c => c.category === key).length}</span></button>)}</div>
    {shown.length ? <div className="concept-grid">{shown.map(concept => {
      const assetId = concept.candidateAssetId ?? concept.savedAssetId;
      const asset = project.assets.find(image => image.id === assetId);
      const isSaved = Boolean(concept.savedAssetId && (!concept.candidateAssetId || concept.savedAssetId === concept.candidateAssetId));
      return <article className="concept-card" key={concept.id}><div className="concept-image">{asset ? <button type="button" className="image-button" aria-label={`放大${concept.name}`} onClick={() => setPreview(asset)}><AssetImage asset={asset} alt={concept.name} /></button> : <div className="concept-placeholder"><Icon name={concept.category === 'object' ? 'gift' : concept.category === 'map' ? 'globe' : 'image'} size={33} /><span>等待第一张参考图</span><Button variant="ghost" icon="spark" disabled={generation?.busy} onClick={() => generation?.run('image',{action:'generate',objectId:concept.id})}>生成参考图</Button></div>}<span className={`image-status ${isSaved ? 'is-saved' : ''}`}>{isSaved ? '已选用图片' : asset ? '待选候选' : CATEGORIES[concept.category]}</span></div><div className="concept-info"><div className="section-heading"><h4>{concept.name}</h4><button type="button" className="icon-button" aria-label={`编辑${concept.name}`} onClick={() => setObjectForm({ id: concept.id, name: concept.name, description: concept.description, category: concept.category })}><Icon name="edit" size={16} /></button></div><p>{concept.description || '还没有对象描述'}</p><ObjectBindings project={project} concept={concept} edit={edit}/>{asset ? <div className="concept-actions"><Button variant="secondary" icon="check" disabled={isSaved} onClick={() => asset.source?.parentAssetId?setComparison({conceptId:concept.id,asset}):saveConcept(concept)}>{isSaved ? '已选用' : '选用此图'}</Button><Button variant="ghost" onClick={() => {setNewStyle(false);setReworkId(concept.id);}}>修改图片</Button>{asset.source?.parentAssetId&&<Button variant="ghost" onClick={()=>setComparison({conceptId:concept.id,asset})}>与原图对比</Button>}<Button variant="ghost" disabled={generation?.busy} onClick={()=>generation?.run('image',{action:'generate',objectId:concept.id})}>另作候选</Button><button type="button" className="icon-button subtle-danger" aria-label={`删除${concept.name}图片`} onClick={() => deleteImage(concept)}><Icon name="trash" size={16} /></button></div> : <UploadButton children="上传已有图片" notice={notice} secondary={false} onUpload={image => uploadCandidate(concept.id, image)} />}</div></article>;
    })}</div> : <Empty title={category === 'all' ? '先为想象中的对象起个名字' : `还没有${CATEGORIES[category]}参考`} description="添加名称与一句描述，再上传已有图片，或选择图像服务生成候选。" icon="image" small><Button variant="secondary" icon="plus" onClick={() => setObjectForm({ name: '', description: '', category: category === 'all' ? 'object' : category })}>添加对象</Button></Empty>}</section>
    <section className="surface saved-references"><div className="section-heading"><div><h3>已选用图片 <span className="count-badge">{saved.length}</span></h3><p>这里的图片会作为后续成品的选定参考；未保存候选不会加入。</p></div><Icon name="check" /></div>{saved.length ? <div className="saved-strip">{saved.map(concept => <button type="button" className="saved-item" key={concept.id} onClick={() => setPreview(project.assets.find(asset => asset.id === concept.savedAssetId) ?? null)}><AssetImage asset={project.assets.find(asset => asset.id === concept.savedAssetId)} alt={concept.name} /><span>{concept.name}<small>{CATEGORIES[concept.category]}</small></span><Icon name="expand" size={15} /></button>)}</div> : <p className="empty-inline">遇到满意的图片时，点击“选用此图”，它就会来到这里。</p>}</section>
    {objectForm && <Modal title={objectForm.id ? '编辑对象' : '添加一个对象'} subtitle="只需要名称和一句描述，具体细节可以以后补充。" onClose={() => setObjectForm(null)}><form onSubmit={event => {
      event.preventDefault(); if (!objectForm.name.trim()) return;
      const form = objectForm;
      edit(p => ({ ...p, concepts: form.id ? p.concepts.map(concept => concept.id === form.id ? { ...concept, name: form.name.trim(), category: form.category, description: form.description } : concept) : [...p.concepts, { id: crypto.randomUUID(), name: form.name.trim(), category: form.category, description: form.description, prompt: p.art.fullPrompt, revisionRequest: '' }] })); setObjectForm(null);
    }}><Field label="类别"><select value={objectForm.category} onChange={event => setObjectForm({ ...objectForm, category: event.target.value as Category })}>{Object.entries(CATEGORIES).map(([key, value]) => <option value={key} key={key}>{value}</option>)}</select></Field><Field label="对象名称"><input autoFocus required maxLength={60} value={objectForm.name} placeholder="例如：街区邮差、雨后小巷、一把葵扇" onChange={event => setObjectForm({ ...objectForm, name: event.target.value })} /></Field><Field label="一句描述"><textarea rows={3} value={objectForm.description} onChange={event => setObjectForm({ ...objectForm, description: event.target.value })} placeholder="写下已经确定的特征，不必一次填完。" /></Field><div className="modal-actions">{objectForm.id && <Button variant="danger" icon="trash" onClick={() => {
      const removed = project.concepts.find(c => c.id === objectForm.id); if (!removed) return;
      const assets = project.assets;
      edit(p => removeConcept(p, removed.id)); setObjectForm(null);
      notice('对象已移除', () => edit(p => ({ ...p, concepts: p.concepts.some(c => c.id === removed.id) ? p.concepts : [...p.concepts, removed], assets: [...p.assets, ...assets.filter(asset => !p.assets.some(a => a.id === asset.id))] })));
    }}>移除对象</Button>}<Button type="submit">{objectForm.id ? '保存修改' : '添加对象'}</Button></div></form></Modal>}
    {comparison&&<Modal wide title="原图与返工效果对比" onClose={()=>setComparison(null)}><ImageComparison key={comparison.asset.id} original={project.assets.find(a=>a.id===comparison.asset.source?.parentAssetId)} revised={comparison.asset} onConfirm={project.concepts.find(c=>c.id===comparison.conceptId)?.savedAssetId===comparison.asset.id?undefined:review=>{
      const c=project.concepts.find(c=>c.id===comparison.conceptId);
      if(!c||c.candidateAssetId!==comparison.asset.id){notice('候选已改变，请关闭后重新核对当前图片。');return;}
      saveConcept(c,review);setComparison(null);
    }}/></Modal>}
    {rework && <Modal title={`返工 · ${rework.name}`} subtitle="新候选保存前，原有已选用图片始终保留。" onClose={() => setReworkId(null)}><AssetImage asset={project.assets.find(asset => asset.id === (rework.candidateAssetId ?? rework.savedAssetId))} alt={rework.name} className="rework-image" /><Field label="你想如何修改？"><textarea autoFocus rows={3} value={rework.revisionRequest} placeholder="写清位置、变化与程度。例如：伞缘磨损清晰可见，其他部分保持原样。" onChange={event => edit(p => ({ ...p, concepts: p.concepts.map(c => c.id === rework.id ? { ...c, revisionRequest: event.target.value } : c) }))} /></Field><label><input type="checkbox" checked={newStyle} onChange={e=>setNewStyle(e.target.checked)}/>本次明确更换为当前美术风格</label><details className="prompt-details"><summary>查看这张图的提示词</summary><p>{rework.prompt || '这张上传图片尚未记录出图提示词。'}</p></details><div className="modal-actions"><UploadButton children="上传新候选" notice={notice} onUpload={asset => { uploadCandidate(rework.id, asset); setReworkId(null); }} /><Button icon="spark" disabled={generation?.busy} onClick={() => { generation?.run('image',{action:'edit',objectId:rework.id,newStyle});setReworkId(null); }}>生成修改版</Button></div></Modal>}
    {preview && <ImagePreview asset={preview} onClose={() => setPreview(null)} />}
  </div>;
}

const sampleStory = '雨落西关\n\n雨停的时候，廊下还在滴水。阿禾把最后一把伞收进铺子，门口的石阶上留着一小片淡淡的天光。\n\n隔壁的老人递来一封信，说是整理旧柜时找到的。信封没有邮票，只有一个被反复描过的名字。\n\n阿禾没有急着拆开。她沿着骑楼走了一段，在街角的小店停下来，问了一声。午后的街巷，就这样慢慢有了回音。\n\n这是一段用于检查阅读排版的虚构示例，并非 AI 生成成品。';

export function FinalStage({ project, edit, demo, demoState, notice, generation }: StageProps) {
  const [expanded, setExpanded] = useState(false);
  const savedCount = project.concepts.filter(concept => concept.savedAssetId).length;
  const contentCount = Object.values(project.content[project.type]).filter(text => text.trim()).length;
  const ready = demo && demoState === 'ready';
  if(!demo && project.type==='novel') return <NovelOutput project={project} edit={edit} generation={generation}/>;
  if(!demo && project.type==='video') return <VideoOutput project={project} edit={edit} generation={generation} notice={notice}/>;
  if(!demo && project.type==='website') return <WebsiteOutput project={project} edit={edit} generation={generation} notice={notice}/>;
  if(!demo && ['craft','undecided'].includes(project.type))return <DesignDelivery project={project} edit={edit} generation={generation}/>;
  function downloadText() {
    const url = URL.createObjectURL(new Blob([sampleStory], { type: 'text/plain;charset=utf-8' }));
    const link = document.createElement('a'); link.href = url; link.download = '雨落西关-排版示例.txt'; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000); notice('已下载排版示例，不是生成成品。');
  }
  return <div className="stage-stack"><section className="surface final-brief"><div className="section-heading"><div><h3>把准备好的灵感，交给下一步</h3><p>这里将汇集你的内容、视觉方向和选定参考。</p></div><span className="tag tag-soft">{TYPE_LABELS[project.type]}</span></div><div className="brief-summary"><div><span>当前创意</span><strong>{project.title}</strong></div><div><span>内容方案</span><strong>{contentCount ? `${contentCount} 个小节已有内容` : '尚未填写'}</strong></div><div><span>选定参考</span><strong>{savedCount} 张图片</strong></div></div><details className="prompt-details"><summary>查看生成依据摘要</summary><dl className="summary-list"><dt>想法</dt><dd>{project.idea || '尚未填写'}</dd><dt>岭南文化语境</dt><dd>{project.culture || '尚未补充，后续生成前需要形成具体语境。'}</dd><dt>视觉方向</dt><dd>{project.art.direction || '尚未填写'}</dd></dl></details><div className="delivery-fields">{project.type === 'novel' && <Field label="文本交付格式"><select value={project.delivery.textFormat} onChange={event => edit(p => ({ ...p, delivery: { ...p.delivery, textFormat: event.target.value } }))}><option value="md">Markdown · 可编辑文本</option><option value="txt">TXT · 纯文本</option><option value="docx">Word · 待接入</option></select></Field>}{project.type === 'video' && <><Field label="画幅"><select value={project.delivery.ratio} onChange={event => edit(p => ({ ...p, delivery: { ...p.delivery, ratio: event.target.value } }))}><option>16:9</option><option>9:16</option><option>1:1</option></select></Field><Field label="目标时长"><input value={project.delivery.duration} placeholder="例如：约 60 秒，实际能力待接入验证" onChange={event => edit(p => ({ ...p, delivery: { ...p.delivery, duration: event.target.value } }))} /></Field></>}{project.type === 'craft' && <div className="delivery-note"><Icon name="gift" /><span>3D 文创资产列为最后阶段；当前可整理文化依据与概念参考，尚未接入模型生成。</span></div>}{project.type === 'website' && <div className="delivery-note"><Icon name="globe" /><span>计划交付网站预览、源码与运行说明，实际交互需逐项验证。</span></div>}{project.type === 'undecided' && <div className="delivery-note"><Icon name="leaf" /><span>可在项目名称旁选择作品类型，再规划对应交付。</span></div>}</div><NovelReferences project={project} edit={edit}/><InputSummary project={project} edit={edit} kind="novel"/><Field label="补充交付要求"><textarea rows={2} value={project.delivery.notes} placeholder="写下你希望保留的文字、文件要求或其他限制……" onChange={event => edit(p => ({ ...p, delivery: { ...p.delivery, notes: event.target.value } }))} /></Field><div className="generation-row"><AiNote children="此处为界面示例；请新建项目使用真实生成入口" /><Button disabled icon="spark">生成完整作品</Button></div></section>
    <section className="surface output-surface"><div className="section-heading"><h3>作品预览</h3>{ready && <span className="tag tag-demo">演示内容 · 非生成结果</span>}</div>{demo && <DemoFeedback state={demoState} />}{ready ? <>
      {project.type === 'novel' && <div className={`reading-preview ${expanded ? 'reading-expanded' : ''}`}><span className="eyebrow">阅读排版示例</span><h4>雨落西关</h4>{sampleStory.split('\n\n').slice(1, expanded ? undefined : 3).map(paragraph => <p key={paragraph}>{paragraph}</p>)}<Button variant="ghost" onClick={() => setExpanded(!expanded)}>{expanded ? '收起正文' : '展开完整示例'}<Icon name="chevron" /></Button></div>}
      {project.type === 'craft' && <div className="craft-preview"><img src="/art/craft.svg" alt="葵扇与彩瓷的原创展示示意图" /><div><span className="eyebrow">数字设计展示示例</span><h4>一扇清风</h4><p>用于检查展示区的构图、留白和图片比例，尚未生成设计交付文件。</p></div></div>}
      {project.type === 'video' && <div className="video-preview"><img src="/art/courtyard.svg" alt="播放器区域的插画占位图" /><div><Icon name="film" size={35} /><strong>视频播放器区域</strong><span>演示没有视频文件，不提供虚假播放</span></div></div>}
      {project.type === 'website' && <div className="website-preview"><div className="browser-chrome"><span>● ● ●</span><span>虚构小店 · 静态页面示例</span></div><div className="sample-site"><span>巷里手作</span><h4>把日常的手艺，<br />带回生活里。</h4><p>一把葵扇，一件小物。<br />在廊下，遇见慢慢做成的东西。</p><img src="/art/craft.svg" alt="虚构手作小店的展示插画" /></div><p className="preview-caption">仅示意网站预览容器，不代表已生成可运行网站。</p></div>}
      <div className="output-actions">{project.type === 'novel' ? <Button variant="secondary" icon="download" onClick={downloadText}>下载演示文本</Button> : <Button variant="secondary" disabled icon="download">交付文件尚未生成</Button>}</div></> : !(demo && (demoState === 'loading' || demoState === 'error')) && <Empty title="本示例还没有展示结果" description="真实项目会在这里显示已采用的成果和下载入口。" icon="gift" small />}</section></div>;
}

export function RequestComposer({ project, edit, goToStage, generation }: Pick<StageProps, 'project' | 'edit' | 'unavailable' | 'creative' | 'generation'> & { goToStage: (stage: number) => void }) {
  const isArt=project.stage===2;
  const canRevise=(isArt&&Object.values(project.art).some(value=>value.trim())) || (project.stage===4&&project.type==='novel'&&project.novel);
  return <>{canRevise&&<div className="request-composer"><span className="composer-symbol"><Icon name="spark" size={22}/></span><label className="composer-field"><span>{isArt?'美术方案修改要求':'正文修改要求'}</span><textarea rows={2} value={project.requests[project.stage]} placeholder="说清需要改变的部分，其余内容保持。" onChange={event=>edit(p=>({...p,requests:p.requests.map((value,index)=>index===p.stage?event.target.value:value)}))}/><span className="muted">生成修改建议，采用前保留当前稿。</span></label><Button variant="secondary" disabled={generation?.busy||!project.requests[project.stage].trim()} onClick={()=>isArt?generation?.run('art'):generation?.run('novel',{action:'revise'})}>{isArt?'按要求修改画风':'按要求修改正文'}</Button></div>}<footer className="flow-footer"><div>{project.stage > 0 && <Button variant="ghost" icon="back" onClick={() => goToStage(project.stage === 4 && project.type === 'novel' ? 1 : project.stage - 1)}>返回{FLOW_LABELS[project.stage === 4 && project.type === 'novel' ? 1 : project.stage - 1]}</Button>}{project.type === 'novel' && project.stage === 1 && <Button variant="ghost" onClick={() => goToStage(2)}>我也需要配图</Button>}</div>{project.stage < 4 && <div className="flow-next"><span>{optionalStage(project.type,project.stage) ? '这一步可选，没有图片也能继续。' : '当前稿自动保存；生成建议请先预览并采用。'}</span><Button onClick={() => goToStage(nextStage(project))}>{project.type === 'novel' && project.stage === 1 ? '下一步：创作正文' : '下一步：'+FLOW_LABELS[nextStage(project)]}<Icon name="arrow" /></Button></div>}</footer></>;
}

export function TypePicker({ type, onChange }: { type: WorkType; onChange: (type: WorkType) => void }) { return <label className="type-picker"><span className="visually-hidden">作品类型</span><select value={type} onChange={event => onChange(event.target.value as WorkType)}>{Object.entries(TYPE_LABELS).map(([key, value]) => <option key={key} value={key}>{value}</option>)}</select></label>; }

function NovelOutput({project,edit,generation}:{project:Project;edit:EditProject;generation?:GenerationControls}) {
  function download(format:'md'|'txt') {
    if(!project.novel)return;
    const content=formatNovel(project.novel,format);
    const url=URL.createObjectURL(new Blob([content],{type:'text/plain;charset=utf-8'}));
    const a=document.createElement('a');a.href=url;a.download=project.novel.title.replace(/[<>:"/\\|?*]/g,'_')+'.'+format;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  return <section className="surface writing-surface"><div className="section-heading"><div><h3>短篇正文与交付</h3><p>根据当前方案生成完整短篇；长篇章节任务尚未接入。新结果采用前保留原稿。</p></div><Button disabled={generation?.busy} onClick={()=>generation?.run('novel',{action:'generate'})}>{project.novel?'基于当前正文继续完善':'生成完整短篇'}</Button></div><NovelReferences project={project} edit={edit}/><InputSummary project={project} edit={edit} kind="novel"/><Field label="补充交付要求"><textarea rows={2} value={project.delivery.notes} onChange={e=>edit(p=>({...p,delivery:{...p.delivery,notes:e.target.value}}))}/></Field>{project.novel?<><Field label="作品标题"><input value={project.novel.title} onChange={e=>edit(p=>({...p,novel:{...p.novel!,title:e.target.value}}))}/></Field><Field label="实际正文"><textarea rows={18} value={project.novel.text} onChange={e=>edit(p=>({...p,novel:{...p.novel!,text:e.target.value}}))}/></Field><div className="inline-actions"><Button variant="ghost" disabled={generation?.busy} onClick={()=>generation?.run('novel',{action:'alternative'})}>另作正文候选</Button><Button variant="secondary" onClick={()=>download('md')}>下载 Markdown</Button><Button variant="secondary" onClick={()=>download('txt')}>下载 TXT</Button><Button variant="ghost" disabled={generation?.busy} onClick={()=>generation?.run('content',{action:'generate',fromNovel:true})}>从正文整理设定更新建议</Button></div></>:<Empty title="正文生成后会出现在这里" description="先完善故事与章节方案，也可以跳过图片阶段直接创作短篇。" small/>}</section>;
}
