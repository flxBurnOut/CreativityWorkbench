'use client';
import { WorkspaceRecovery } from './service-settings';

import { useCallback, useEffect, useRef, useState } from 'react';
import { AssetImage, Button, Empty, Field, Icon, Modal, type IconName } from '@/components/workbench/ui';
import { createDemoProject, createProject, pruneAssets, STAGES, TYPE_LABELS, updateProject, type ImageAsset, type Project, type WorkType } from '@/features/projects/model';
import { useProjectStore } from '@/features/projects/use-project-store';
import { ArtStage, ConceptsStage, ContentStage, CreativeStage, FinalStage, RequestComposer, TypePicker, UploadButton, type DemoState, type EditProject, type Notice } from './stages';

import { GenerationServiceStatus, useGeneration } from './generation-api';
import { WorkflowPanel } from './workflow-panel';
import { switchWorkType } from '@/lib/workbench/workflow.mjs';
import { StorageActions } from '@/features/projects/storage-actions';

type DialogState = { kind: 'new' | 'help' | 'settings' | 'demo' } | { kind: 'manage' | 'rename' | 'cover'; projectId: string } | { kind: 'unavailable'; action: string } | null;
const typeIcons: Record<WorkType, IconName> = { undecided: 'leaf', novel: 'book', video: 'film', craft: 'gift', website: 'globe' };
const introductions = [
  ['从一句想法，慢慢展开', '先记录你真正想表达的内容，细节可以在创作中逐步生长。'],
  ['把故事与细节，落在纸上', '让内容成为作品的依据。已有文字可以直接粘贴，无需重新开始。'],
  ['让想法，拥有自己的色彩', '用文字整理视觉方向，也可以用图片说明你喜欢的色彩与材质。'],
  ['让想象中的细节，逐渐清晰', '角色、地图、物件，按需要逐一准备。满意的图片才进入选定参考集。'],
  ['准备好，迎接作品的样子', '带上当前内容与已保存参考，生成、预览并交付你的作品。'],
];

export default function Workbench() {
  const store = useProjectStore();
  const [dialog, setDialog] = useState<DialogState>(null);
  const [demoProject, setDemoProject] = useState<Project | null>(null);
  const [demoState, setDemoState] = useState<DemoState>('ready');
  const [query, setQuery] = useState('');
  const [toast, setToast] = useState<{ message: string; undo?: () => void } | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const workspaceRef = useRef(store.workspace);
  workspaceRef.current = store.workspace;
  const project = demoProject ?? store.workspace.projects.find(p => p.id === store.workspace.activeProjectId) ?? null;
  const isDemo = Boolean(demoProject);
  const notice: Notice = useCallback((message, undo) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast({ message, undo }); toastTimer.current = setTimeout(() => setToast(null), undo ? 10000 : 6000);
  }, []);
  useEffect(() => () => { if (toastTimer.current) clearTimeout(toastTimer.current); }, []);

  useEffect(() => {
    if (!store.ready) return;
    function readRoute() {
      const route = window.location.hash.slice(1);
      if (route.startsWith('demo/')) {
        const type = route.slice(5) as Exclude<WorkType, 'undecided'>;
        if (['novel', 'video', 'craft', 'website'].includes(type)) { setDemoProject(createDemoProject(type)); setDemoState('ready'); return; }
      }
      setDemoProject(null);
      const id = route.startsWith('project/') ? route.slice(8) : null;
      const validId = workspaceRef.current.projects.some(p => p.id === id) ? id : null;
      if (id && !validId) notice('这个项目已不在当前保存记录中。');
      if (workspaceRef.current.activeProjectId !== validId) store.change(ws => ({ ...ws, activeProjectId: validId }));
      window.scrollTo(0, 0);
    }
    if (!window.location.hash) window.history.replaceState(null, '', store.workspace.activeProjectId ? '#project/' + store.workspace.activeProjectId : '#projects');
    readRoute();
    window.addEventListener('popstate', readRoute);
    window.addEventListener('hashchange', readRoute);
    return () => { window.removeEventListener('popstate', readRoute); window.removeEventListener('hashchange', readRoute); };
    // The loaded route is initialized once; subsequent edits are read through workspaceRef.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store.ready, store.change, notice]);

  useEffect(() => { document.title = project ? `${project.title} · 创意工作台` : '创意工作台 · 岭南文化创作'; }, [project?.title]);

  function goHome() {
    setDemoProject(null); setDialog(null);
    store.change(ws => ({ ...ws, activeProjectId: null }));
    if (window.location.hash !== '#projects') window.history.pushState(null, '', '#projects');
    window.scrollTo(0, 0);
  }
  function openProject(id: string) {
    setDemoProject(null); store.change(ws => ({ ...ws, activeProjectId: id }));
    window.history.pushState(null, '', '#project/' + id); window.scrollTo(0, 0);
  }
  function openDemo(type: Exclude<WorkType, 'undecided'>) {
    setDialog(null); setDemoProject(createDemoProject(type)); setDemoState('ready');
    window.history.pushState(null, '', '#demo/' + type); window.scrollTo(0, 0);
  }
  const edit: EditProject = update => {
    if (!project) return;
    if (demoProject) setDemoProject(p => p && p.id === project.id ? { ...update(p), updatedAt: Date.now() } : p);
    else store.change(ws => updateProject(ws, project.id, update));
  };
  const generation = useGeneration(project,isDemo,edit,notice,store.flush);
  const creative = { controls: {run:(action:'improve'|'redirect'|'revise')=>generation.controls.run('creative',{action}),busy:generation.controls.busy} };
  const unavailable = (action: string) => setDialog({ kind: 'unavailable', action });
  const saveLabels = { loading: '正在读取项目', saved: '已保存到本机服务', saving: '正在保存…', error: '保存未完成', temporary: '临时体验 · 关闭后不保留' };
  const modalProject = dialog && 'projectId' in dialog ? (demoProject?.id === dialog.projectId ? demoProject : store.workspace.projects.find(p => p.id === dialog.projectId)) : null;
  function editModalProject(update: (p: Project) => Project) {
    if (!modalProject) return;
    if (modalProject.id === demoProject?.id) setDemoProject(p => p ? update(p) : p);
    else store.change(ws => updateProject(ws, modalProject.id, update));
  }
  function deleteProject(deleted: Project) {
    store.change(ws => ({ ...ws, projects: ws.projects.filter(p => p.id !== deleted.id), activeProjectId: ws.activeProjectId === deleted.id ? null : ws.activeProjectId }));
    if (project?.id === deleted.id) { setDemoProject(null); window.history.pushState(null, '', '#projects'); }
    setDialog(null);
    notice('项目已删除', () => store.change(ws => ({ ...ws, projects: ws.projects.some(p => p.id === deleted.id) ? ws.projects : [...ws.projects, deleted] })));
  }
  const sortedProjects = [...store.workspace.projects].sort((a, b) => b.updatedAt - a.updatedAt);
  const filtered = sortedProjects.filter(p => p.title.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  const stageProps = project ? { project, edit, notice, unavailable, demo: isDemo, demoState, creative: creative.controls, generation: generation.controls } : null;

  return <div className={`workbench ${project ? 'workbench-project' : ''}`}><a className="skip-link" href="#main-content" onClick={event => { event.preventDefault(); document.getElementById('main-content')?.focus(); }}>跳到主要内容</a>
    <header className="site-header"><div className="header-inner"><button type="button" className="wordmark" onClick={goHome} aria-label="创意工作台，返回项目列表"><span className="brand-leaf"><Icon name="leaf" size={23} /></span><span>创意工作台</span></button><nav aria-label="主导航"><button type="button" className={`header-link ${!project ? 'active' : ''}`} onClick={goHome}>我的创意</button><button type="button" className="header-link help-link" aria-label="使用说明" onClick={() => setDialog({ kind: 'help' })}><span className="help-icon"><Icon name="help" /></span><span className="help-text">使用说明</span></button><button type="button" className="icon-button settings-button" aria-label="打开设置" onClick={() => setDialog({ kind: 'settings' })}><Icon name="settings" /></button></nav></div></header>
    {store.error && <div className="storage-error" role="alert"><Icon name="alert" /><div><strong>{store.ready ? '项目保存尚未完成' : '暂时无法读取草稿'}</strong><p>{store.error}</p></div><Button variant="secondary" onClick={() => void store.retry().catch(() => {})}>重试</Button>{!store.ready && <Button variant="ghost" onClick={store.useTemporary}>仅临时体验</Button>}</div>}
    {!store.ready ? <main id="main-content" tabIndex={-1} className="loading-page"><span className="loading-leaf"><Icon name="leaf" size={32} /></span><h1>{store.error ? '你的原有草稿保持不变' : '推开门，等灵感进来'}</h1><p>{store.error ? '可以重试读取，或进入不保存的临时体验。' : '正在读取本机服务的创作记录…'}</p></main> : !project ? <main id="main-content" tabIndex={-1} className="home-main">
      <section className="welcome-scene"><div className="welcome-copy"><p className="eyebrow"><span />岭南文化 · 创作之间</p><h1>让灵感，<br />在岭南慢慢生长<span className="title-dot">。</span></h1><p className="welcome-description">从一念想法，到一件作品。<br />在骑楼的光影与手作的温度里，展开你的创意。</p><div className="welcome-actions"><Button icon="plus" onClick={() => setDialog({ kind: 'new' })}>新建创意</Button><Button variant="ghost" onClick={() => setDialog({ kind: 'demo' })}>沿着示例走一遍<Icon name="arrow" size={16} /></Button></div><span className="scene-caption">骑楼光影　·　广彩花色　·　葵扇清风</span></div><div className="welcome-art"><img src="/art/courtyard.svg" alt="岭南骑楼与院落旁，葵扇和彩瓷静置在手作台上的原创插画" /><span className="art-note">一方庭院，容得下许多想象。</span></div></section>
      <section className="projects-section" aria-labelledby="projects-heading"><div className="projects-toolbar"><div><div className="heading-with-count"><h2 id="projects-heading">我的创意</h2><span>{store.workspace.projects.length}</span></div><p>每一个想法，都有自己的去处。</p></div><div className="search-box"><Icon name="search" /><input aria-label="搜索项目名称" type="search" placeholder="找一个创意…" value={query} onChange={event => setQuery(event.target.value)} /></div></div>
      {filtered.length ? <div className="project-grid">{filtered.map(item => <article className="project-card" key={item.id}><button type="button" className="project-open" aria-label={`打开项目 ${item.title}`} onClick={() => openProject(item.id)}><div className={`project-cover cover-${item.type}`}><AssetImage asset={item.assets.find(asset => asset.id === item.coverAssetId) ?? { id: 'default', name: '默认封面', demoSrc: item.type === 'craft' ? '/art/craft.svg' : '/art/courtyard.svg' }} alt={item.coverAssetId ? item.title + '的项目封面' : '默认插画封面'} />{!item.coverAssetId && <span className="cover-caption">默认封面</span>}<span className="project-stage">{STAGES[item.stage]}</span></div><div className="project-card-copy"><span className="project-kind"><Icon name={typeIcons[item.type]} size={14} />{TYPE_LABELS[item.type]}</span><h3>{item.title}</h3><p>{item.idea || '等待下一笔灵感'}</p><span className="project-date">{new Date(item.updatedAt).toLocaleDateString('zh-CN', { month: 'long', day: 'numeric' })} 编辑</span></div></button><button type="button" className="icon-button project-more" aria-label={`管理项目 ${item.title}`} onClick={() => setDialog({ kind: 'manage', projectId: item.id })}><Icon name="more" /></button></article>)}<button type="button" className="new-project-card" onClick={() => setDialog({ kind: 'new' })}><span><Icon name="plus" size={25} /></span><strong>再种下一点灵感</strong><small>从一句想法开始</small></button></div> : query.trim() ? <Empty title="还没找到这个创意" description="试试更短的名称，或清空搜索查看所有项目。" icon="search"><Button variant="secondary" onClick={() => setQuery('')}>清空搜索</Button></Empty> : <div className="first-project"><div className="first-project-art" aria-hidden="true"><img src="/art/craft.svg" alt="" /></div><div><span className="eyebrow">留一页空白，给新的想法</span><h3>你的第一件作品，从这里开始</h3><p>一句话就能创建项目，灵感和草稿会保存到本机服务。</p></div><Button variant="secondary" icon="plus" onClick={() => setDialog({ kind: 'new' })}>新建创意</Button></div>}</section>
      <section className="demo-invitation"><span className="demo-invitation-icon"><Icon name="book" size={24} /></span><div><h3>还没有具体想法？先逛一逛。</h3><p>从小说、视频、文创或网站示例出发，走过完整的创作流程。</p></div><Button variant="ghost" onClick={() => setDialog({ kind: 'demo' })}>体验示例<Icon name="arrow" /></Button></section><footer className="site-footer"><span>在岭南，给创意一点生长的时间。</span><span><span className="status-dot" />{saveLabels[store.status]}</span></footer>
    </main> : <main id="main-content" tabIndex={-1} className="project-main">
      <div className="project-breadcrumb"><Button variant="ghost" icon="back" onClick={goHome}>所有创意</Button><span>/</span><span>{isDemo ? '独立演示项目' : TYPE_LABELS[project.type]}</span></div>
      <div className="project-heading"><div><button type="button" className="editable-title" aria-label="修改项目名称" onClick={() => setDialog({ kind: 'rename', projectId: project.id })}><h1>{project.title}</h1><Icon name="edit" size={17} /></button><div className="project-heading-meta"><TypePicker type={project.type} onChange={type => { edit(p => switchWorkType(p,type)); notice('已切换作品类型；各类型的内容、美术、对象和交付草稿分别保留，可选择沿用其他类型资料。'); }} /><span className="cultural-label"><Icon name="leaf" size={14} />岭南文化创作</span></div></div><span className={`save-status ${store.status === 'error' && !isDemo ? 'save-error' : ''}`} aria-live="polite"><span className="status-dot" />{isDemo ? '演示修改不保存' : saveLabels[store.status]}</span></div>
      {isDemo && <div className="demo-banner"><div><span className="tag tag-demo">演示项目</span><span>示例内容独立于你的项目；没有调用 AI。</span></div>{project.stage >= 3 && <label>结果状态演示<select aria-label="演示结果状态" value={demoState} onChange={event => setDemoState(event.target.value as DemoState)}><option value="ready">已有示例</option><option value="empty">空状态</option><option value="loading">生成中</option><option value="error">生成失败</option></select></label>}<Button variant="ghost" onClick={() => setDialog({ kind: 'demo' })}>更换示例</Button></div>}
      <nav className="stage-navigation" aria-label="创作阶段">{STAGES.map((label, index) => <button type="button" key={label} className={project.stage === index ? 'current' : ''} aria-current={project.stage === index ? 'step' : undefined} onClick={() => { edit(p => ({ ...p, stage: index })); }}><span className="step-number">{String(index + 1).padStart(2, '0')}</span><span>{label}</span></button>)}</nav>
      <div className="stage-intro"><div><span className="eyebrow">{String(project.stage + 1).padStart(2, '0')} / {STAGES[project.stage]}</span><h2>{introductions[project.stage][0]}</h2><p>{introductions[project.stage][1]}</p></div><span className="stage-flower" aria-hidden="true">✳</span></div>
      {!isDemo&&<WorkflowPanel key={'workflow-'+project.id+project.type} project={project} edit={edit} notice={notice}/>}
      <div key={project.id+project.type} className="stage-body">{stageProps && <>{project.stage === 0 && <><CreativeStage {...stageProps} /></>}{project.stage === 1 && <ContentStage {...stageProps} results={generation.panel} />}{project.stage === 2 && <ArtStage {...stageProps} />}{project.stage === 3 && <ConceptsStage {...stageProps} />}{project.stage === 4 && <FinalStage {...stageProps} />}{project.stage !== 1 && generation.panel}<RequestComposer generation={generation.controls} creative={creative.controls} project={project} edit={edit} unavailable={unavailable} goToStage={stage => { edit(p => ({ ...p, stage })); window.scrollTo(0, 0); }} /></>}</div><footer className="project-footer"><Icon name="leaf" size={14} />让作品慢慢成形，也让每一步都留得住。</footer>
    </main>}

    {dialog?.kind === 'new' && <NewProjectDialog onClose={() => setDialog(null)} onCreate={(idea, type, title) => { const created = createProject(idea, type, title); store.change(ws => ({ ...ws, projects: [...ws.projects, created], activeProjectId: created.id })); setDemoProject(null); setDialog(null); window.history.pushState(null, '', '#project/' + created.id); window.scrollTo(0, 0); }} />}
    {dialog?.kind === 'demo' && <DemoDialog onClose={() => setDialog(null)} onChoose={openDemo} />}
    {dialog?.kind === 'rename' && modalProject && <RenameDialog project={modalProject} onClose={() => setDialog(null)} onSave={title => { editModalProject(p => ({ ...p, title })); setDialog(null); }} />}
    {dialog?.kind === 'manage' && modalProject && <Modal title={modalProject.title} subtitle="整理这个创意，随时回来继续。" onClose={() => setDialog(null)}><div className="manage-actions"><button type="button" onClick={() => setDialog({ kind: 'rename', projectId: modalProject.id })}><Icon name="edit" /><span>修改项目名称</span><Icon name="arrow" size={16} /></button><button type="button" onClick={() => setDialog({ kind: 'cover', projectId: modalProject.id })}><Icon name="image" /><span>更换封面</span><Icon name="arrow" size={16} /></button><button type="button" className="subtle-danger" onClick={() => deleteProject(modalProject)}><Icon name="trash" /><span>删除项目</span><small>删除后可短暂撤销</small></button></div></Modal>}
    {dialog?.kind === 'cover' && modalProject && <CoverDialog project={modalProject} edit={editModalProject} onClose={() => setDialog(null)} notice={notice} flush={store.flush} />}
    {dialog?.kind === 'unavailable' && <Modal title={`${dialog.action}尚未接入`} subtitle="此操作的生成服务将在后续接入；文字、图像、视频和网站流程已提供服务入口。" onClose={() => setDialog(null)}><div className="service-placeholder"><span className="empty-symbol"><Icon name="spark" size={28} /></span><p>你可以继续编辑文字、整理参考图片和暂存项目。此操作没有发起生成请求，也没有产生费用。</p></div><div className="modal-actions"><Button variant="secondary" onClick={() => setDialog({ kind: 'settings' })}>查看服务状态</Button><Button onClick={() => setDialog(null)}>继续创作</Button></div></Modal>}
    {dialog?.kind === 'settings' && <Modal title="工作台设置" subtitle="把技术细节留在这里，让创作过程保持简单。" onClose={()=>setDialog(null)}><GenerationServiceStatus/><div className="settings-section"><h3>项目与文件</h3><p>项目、图片、视频、音频及网站文件保存到本机服务的数据目录。同一服务下可以换浏览器继续；旧浏览器草稿保留原副本。</p>{store.note&&<p>{store.note}</p>}<WorkspaceRecovery/><StorageActions workspace={store.workspace} change={store.change} notice={notice}/></div><div className="modal-actions"><Button onClick={()=>setDialog(null)}>返回工作台</Button></div></Modal>}
    {dialog?.kind === 'help' && <Modal title="从想法，到作品" subtitle="只需要说出想法、提出修改、留下满意的结果。" onClose={() => setDialog(null)}><ol className="help-steps">{STAGES.map((stage, index) => <li key={stage}><span>{index + 1}</span><div><h3>{stage}</h3><p>{['把一句想法展开成清楚的创意，建立与岭南文化的联系。', '整理故事、脚本、图案或网页内容，可以直接粘贴已有文稿。', '用文字确定色彩、造型和材质，参考图片按需添加。', '为角色、地图和物件整理图片；点击保存后进入选定参考集。', '检查生成依据与交付要求；接入服务后预览、下载完整作品。'][index]}</p></div></li>)}</ol><div className="help-note">随时切换阶段，纯文字作品可以跳过美术和概念图。文字生成需配置服务端密钥；图片优先通过 WorkBuddy，也可切换外部 API。任务结果保留到你采用或收起；视频、网站和 3D 文创交付按后续顺序接入。</div><div className="modal-actions"><Button variant="secondary" onClick={() => setDialog({ kind: 'demo' })}>先体验一个示例</Button><Button onClick={() => setDialog(null)}>开始创作</Button></div></Modal>}
    {toast && <div className="toast" role="status"><Icon name="check" /><span>{toast.message}</span>{toast.undo && <button type="button" onClick={() => { toast.undo?.(); setToast(null); }}>撤销</button>}<button type="button" className="icon-button" aria-label="关闭提示" onClick={() => setToast(null)}><Icon name="close" size={15} /></button></div>}
  </div>;
}

function NewProjectDialog({ onClose, onCreate }: { onClose: () => void; onCreate: (idea: string, type: WorkType, title: string) => void }) {
  const [idea, setIdea] = useState(''); const [title, setTitle] = useState(''); const [type, setType] = useState<WorkType>('undecided');
  return <Modal title="种下一点新灵感" subtitle="围绕岭南文化展开你的创意，一句话就足够开始。" onClose={onClose}><form onSubmit={event => { event.preventDefault(); if (idea.trim()) onCreate(idea, type, title); }}><Field label="你想创作什么？"><textarea autoFocus required rows={4} maxLength={4000} value={idea} placeholder="例如：写一个发生在岭南街巷的故事，让一把旧葵扇串起两代人的回忆……" onChange={event => setIdea(event.target.value)} /></Field><Field label="作品类型" group hint="还没想好也没关系，之后可以调整。"><div className="type-options">{Object.entries(TYPE_LABELS).map(([key, value]) => <button type="button" key={key} aria-pressed={type === key} onClick={() => setType(key as WorkType)}><Icon name={typeIcons[key as WorkType]} size={17} />{value}</button>)}</div></Field><Field label="项目名称 · 可选"><input value={title} maxLength={80} placeholder="留空时使用想法的前几个字，可随时改名" onChange={event => setTitle(event.target.value)} /></Field><div className="modal-actions"><Button variant="ghost" onClick={onClose}>再想一想</Button><Button type="submit" disabled={!idea.trim()}>创建项目<Icon name="arrow" /></Button></div></form></Modal>;
}

function RenameDialog({ project, onClose, onSave }: { project: Project; onClose: () => void; onSave: (title: string) => void }) {
  const [name, setName] = useState(project.title);
  return <Modal title="给创意一个名字" onClose={onClose}><form onSubmit={event => { event.preventDefault(); if (name.trim()) onSave(name.trim()); }}><Field label="项目名称"><input autoFocus required maxLength={80} value={name} onChange={event => setName(event.target.value)} /></Field><div className="modal-actions"><Button variant="secondary" onClick={onClose}>取消</Button><Button type="submit" disabled={!name.trim()}>保存名称</Button></div></form></Modal>;
}

function DemoDialog({ onClose, onChoose }: { onClose: () => void; onChoose: (type: Exclude<WorkType, 'undecided'>) => void }) {
  const entries: { type: Exclude<WorkType, 'undecided'>; name: string; description: string }[] = [{ type: 'novel', name: '雨落西关', description: '一封迟到的信，一段廊下的故事。' }, { type: 'video', name: '骑楼下的午后', description: '沿着光影，整理一分钟的视频脚本。' }, { type: 'craft', name: '一扇清风', description: '从葵扇与彩瓷中寻找数字设计的灵感。' }, { type: 'website', name: '巷里有间小店', description: '为虚构的手作小店整理页面与文案。' }];
  return <Modal title="先走进一个小小的创意" subtitle="独立演示，不会添加到你的项目，也不会调用生成服务。" onClose={onClose} wide><div className="demo-grid">{entries.map(item => <button type="button" className={`demo-card demo-${item.type}`} key={item.type} onClick={() => onChoose(item.type)}><img src={item.type === 'craft' || item.type === 'website' ? '/art/craft.svg' : '/art/courtyard.svg'} alt="原创示例封面插画" /><span className="project-kind"><Icon name={typeIcons[item.type]} size={14} />{TYPE_LABELS[item.type]}</span><h3>{item.name}</h3><p>{item.description}</p><span className="demo-card-action">进入示例 <Icon name="arrow" size={16} /></span></button>)}</div></Modal>;
}

function CoverDialog({ project, edit, onClose, notice, flush }: { project: Project; edit: EditProject; onClose: () => void; notice: Notice; flush: () => Promise<void> }) {
  const generation = useGeneration(project,project.id.startsWith("demo-"),edit,notice,flush);
  function select(asset: ImageAsset) { edit(p => pruneAssets({ ...p, assets: p.assets.some(a => a.id === asset.id) ? p.assets : [...p.assets, asset], coverAssetId: asset.id, manualCover: true })); onClose(); notice('项目封面已更新'); }
  return <Modal title="给创意换一扇窗" subtitle="封面帮助你认出这个项目，不会自动加入概念参考集。" onClose={onClose}><AssetImage asset={project.assets.find(asset => asset.id === project.coverAssetId) ?? { id: 'placeholder', name: '默认封面', demoSrc: '/art/courtyard.svg' }} alt="当前项目封面" className="cover-preview" /><div className="cover-upload-actions"><UploadButton children="上传封面" onUpload={select} notice={notice} /><label>图像服务 <select value={generation.controls.provider} onChange={e=>generation.controls.setProvider(e.target.value)}><option value="workbuddy">WorkBuddy</option><option value="external">外部图像 API</option></select></label><Button variant="ghost" icon="spark" disabled={generation.controls.busy} onClick={() => generation.controls.run('cover')}>AI 生成</Button></div>{generation.panel}{project.assets.length > 0 && <><h3 className="small-heading">项目内图片</h3><div className="cover-choices">{project.assets.map(asset => <button type="button" key={asset.id} aria-label={`选择封面 ${asset.name}`} aria-pressed={project.coverAssetId === asset.id} onClick={() => select(asset)}><AssetImage asset={asset} alt={asset.name} /></button>)}</div></>}<div className="modal-actions"><Button variant="ghost" onClick={() => { edit(p => pruneAssets({ ...p, coverAssetId: undefined, manualCover: false })); onClose(); }}>使用默认封面</Button><Button variant="secondary" onClick={onClose}>关闭</Button></div></Modal>;
}
