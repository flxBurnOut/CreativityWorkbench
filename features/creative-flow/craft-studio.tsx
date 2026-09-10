'use client';
import {useEffect, useRef, useState} from 'react';
import {Button, Field} from '@/components/workbench/ui';
import type {CraftAsset, Project} from '@/features/projects/model';
import {api, imageUrl, outputUrl} from '@/features/projects/server-store';
import {knowledgeText} from '@/lib/workbench/knowledge.mjs';
import {craftKindLabel} from '@/lib/workbench/craft-contract.mjs';
import type {GenerationControls} from './generation-api';
import type {GenerationTask} from './task-results';
import type {EditProject, Notice} from './stages';
import {CraftViewer} from './craft-viewer';
import {craftStudioState} from './craft-state.mjs';

type Props = {project: Project; edit: EditProject; notice: Notice; generation: GenerationControls; flush: () => Promise<void>; synchronize: (force?: boolean) => Promise<void>; autoStart?: boolean; onStarted: () => void};
type CraftService = {available: boolean; message: string; planner: 'deepseek' | 'workbuddy'; texture?: {ready:boolean;message:string}; pattern?: {ready:boolean;message:string;provider:'workbuddy'|'external';supportedKinds:string[]}};
type Request = {projectId: string; expectedVersion: string; requestId: string; goal: string; retryOf?: string;textureOf?:string;textureMode?:'image'};

export function CraftStudio({project, edit, notice, generation, flush, synchronize, autoStart, onStarted}: Props) {
  const [receipt, setReceipt] = useState<GenerationTask | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [service, setService] = useState<CraftService | null>(null);
  const [pendingShown, setPendingShown] = useState(false), [selected, setSelected] = useState<string | null>(null), [requestOpen, setRequestOpen] = useState(false);
  const active = useRef(false), mounted = useRef(true), controller = useRef<AbortController | null>(null), pending = useRef<Request | null>(null);
  const state = craftStudioState(project, generation.tasks || [], receipt);
  const task = state.task as GenerationTask | null, assets = state.assets as CraftAsset[];
  const preview = assets.find(asset => asset.taskId === selected) || state.latest as CraftAsset | null;
  const goal = project.craftGoal ?? project.craftRequest?.goal ?? project.idea;
  const sessionKey = 'workbench-craft-pending:' + project.id;
  const setPending = (request: Request | null) => {
    pending.current = request;
    if (mounted.current) setPendingShown(Boolean(request));
    try { if (request) sessionStorage.setItem(sessionKey, JSON.stringify(request)); else sessionStorage.removeItem(sessionKey); } catch { /* In-memory idempotency still protects this open page. */ }
  };
  useEffect(() => {
    mounted.current = true; controller.current = new AbortController();
    try {
      const raw = sessionStorage.getItem(sessionKey);
      const saved = raw ? JSON.parse(raw) as Request : null;
      if (saved?.projectId === project.id && typeof saved.requestId === 'string' && typeof saved.expectedVersion === 'string' && typeof saved.goal === 'string') { pending.current = saved; setPendingShown(true); }
    } catch { /* A broken local receipt must not prevent reading saved results. */ }
    return () => { mounted.current = false; controller.current?.abort(); };
  }, [project.id, sessionKey]);
  useEffect(() => {
    const abort = new AbortController();
    const refresh = () => { void api<{craft?: CraftService}>('status', 'GET', undefined, abort.signal).then(data => { if (!abort.signal.aborted) setService(data.craft || {available: false, message: '当前运行服务尚未启用 3D 资产生成，请更新并重启工作台服务。', planner: 'workbuddy'}); }).catch(() => { if (!abort.signal.aborted) setService(null); }); };
    const settingsSaved = () => { setError(''); refresh(); };
    refresh(); window.addEventListener('workbench-settings-saved', settingsSaved);
    return () => { abort.abort(); window.removeEventListener('workbench-settings-saved', settingsSaved); };
  }, []);
  useEffect(() => {
    if (receipt && generation.tasks?.some(item => item.id === receipt.id && (item.updatedAt || 0) >= (receipt.updatedAt || 0))) setReceipt(null);
  }, [receipt, generation.tasks]);
  useEffect(() => { setSelected(null); }, [state.latest?.taskId]);
  const sync = async () => { await synchronize(true); await generation.refresh?.(true); };
  async function perform(operation: () => Promise<void>) {
    if (active.current) return;
    active.current = true; setBusy(true); setError('');
    try { await operation(); }
    catch (reason) { if (mounted.current) setError(reason instanceof Error ? reason.message : '操作尚未确认，请核对进度。'); }
    finally { active.current = false; if (mounted.current) setBusy(false); }
  }
  async function submitPending() {
    if (!pending.current) return;
    try {
      const result = await api<GenerationTask>('core/craft_generate', 'POST', pending.current, controller.current?.signal);
      setPending(null);
      if (mounted.current) { setReceipt(result); setSelected(null); setRequestOpen(false); }
    } catch (reason) {
      if (reason && typeof reason === 'object' && 'status' in reason && [400, 404, 409, 422].includes(Number(reason.status))) { setPending(null); await sync(); }
      throw reason;
    }
    await sync();
  }
  async function start() {
    await perform(async () => {
      if (pending.current) throw new Error('上次提交还未确认，请先核对原请求，避免重复生成。');
      if (state.active) throw new Error('本轮仍在进行，可以先修改下一轮要求，或取消本轮后再生成。');
      if (!goal.trim()) throw new Error('先描述你想生成的资产。');
      await flush();
      const saved = await api<{projectVersion: string}>('core/project_get', 'POST', {projectId: project.id}, controller.current?.signal);
      setPending({projectId: project.id, expectedVersion: saved.projectVersion, requestId: crypto.randomUUID(), goal: goal.trim(), ...(task && ['failed', 'cancelled'].includes(task.status) ? {retryOf: task.id} : {})});
      await submitPending();
    });
  }
  const launch = useRef(start); launch.current = start;
  useEffect(() => { if (autoStart) { onStarted(); if (!pending.current) void launch.current(); } }, [autoStart, onStarted]);
  async function cancel() {
    if (!task) return;
    await perform(async () => {
      await flush();
      const result = await api<GenerationTask>('tasks/' + task.id + '/cancel', 'POST', {}, controller.current?.signal);
      if (mounted.current) setReceipt(result);
      await sync();
    });
  }
  async function generatePattern() {
    if (!preview) return;
    await perform(async () => {
      if (pending.current || state.active) throw new Error('请先核对或结束当前任务，再为这一版生成图案。');
      if (!service?.pattern?.ready || !service.pattern.supportedKinds.includes(preview.kind)) throw new Error('当前模型或生图服务尚不能生成文化图案，请查看模型下方的说明。');
      await flush();
      const saved = await api<{projectVersion:string}>('core/project_get','POST',{projectId:project.id},controller.current?.signal);
      setPending({projectId:project.id,expectedVersion:saved.projectVersion,requestId:crypto.randomUUID(),goal:preview.prompt,textureOf:preview.taskId,textureMode:'image',...(task && ['failed','cancelled'].includes(task.status)?{retryOf:task.id}:{})});
      await submitPending();
    });
  }
  const instructions = task?.handoffInstructions || task?.handoffMessage || '';
  async function copyRequest() {
    setRequestOpen(true);
    try { await navigator.clipboard.writeText(instructions); notice('已复制本次任务的交接请求，粘贴到 WorkBuddy 后继续原任务。'); }
    catch { notice('浏览器未允许复制，请选择下方完整交接文字手动复制。'); }
  }
  const phase = task?.phase;
  const patternTask = task?.args.textureMode === 'image';
  const title = (() => {
    if (task?.status === 'failed') return '本轮生成未完成';
    if (task?.status === 'cancelled') return '本轮已取消';
    if (task?.status === 'waiting_external') return patternTask ? '需要 WorkBuddy 生成本轮图案' : '需要 WorkBuddy 整理本次造型';
    if (task?.status === 'uncertain') return '本轮进度需要核对';
    if (state.active) {
      if (patternTask) return phase === 'pattern-applying' ? '正在贴合图案并核对器形' : phase === 'pattern-generating' ? '正在生成文化图案' : '正在准备这一版的文化图案';
      if (task?.args.textureSource) return phase === 'texture-checking' ? '正在打包纹理并核对器形' : phase === 'texturing' ? '腾讯云正在制作文化纹理' : '正在准备文化纹理增强';
      return phase === 'building' ? '正在生成三维网格' : phase === 'checking' ? '正在检查模型与导出文件' : '正在理解要求与确定造型';
    }
    return state.historicalResult ? '本轮结果已保留到历史版本' : preview ? '模型已保存，可查看和下载' : '用一句话描述你的 3D 资产';
  })();
  return <div className="website-studio craft-studio">
    <ol className="studio-progress" aria-label="3D 资产制作进度"><li aria-current={!task && !preview ? 'step' : undefined}>1 描述资产</li><li aria-current={state.active ? 'step' : undefined}>2 生成与检查</li><li aria-current={!state.active && preview ? 'step' : undefined}>3 查看与下载</li></ol>
    <section className="surface studio-brief">
      <div className="section-heading"><div><h2>{preview ? '想再生成怎样的一版？' : '这次想做什么 3D 资产？'}</h2><p>写清物件、形状和材质即可。工作台会补齐造型参数，生成可下载的网格资产。</p></div></div>
      <Field label="资产要求"><textarea rows={4} maxLength={4000} value={goal} placeholder="生成一只岭南凉茶陶碗，宽口浅腹、收窄底部，深褐色釉面，保留碗内空间，适合文旅网站展示。" onChange={event => edit(value => ({...value, craftGoal: event.target.value}))}/></Field>
      <div className="studio-facts"><span>交付：Blender 文件 + GLB 模型</span><span>网页旋转、缩放与查看</span><span>旧版本自动保留</span></div>
      <div className="inline-actions"><Button disabled={busy || state.active || pendingShown || !goal.trim() || service?.available === false} onClick={() => void start()}>{busy ? '正在提交…' : state.active ? '本轮进行中，可先编辑下一轮要求' : preview ? '生成新版本' : '开始生成资产'}</Button>{state.active && <Button variant="ghost" disabled={busy} onClick={() => void cancel()}>取消本轮</Button>}</div>
      {service && <p className="muted" role={service.available ? undefined : 'status'}>{service.message}{service.available && (service.planner === 'deepseek' ? ' 需求由已配置的文字服务自动解析。' : ' 首次提交后，按页面提示将原任务交给 WorkBuddy。')}</p>}
      <details className="studio-materials"><summary>适合生成什么，结果包含什么？</summary><p>先支持可用规则形体组合表达的器具、锅碗瓢盆、盘罐瓶，以及特色建筑外观。颜色和常见材质随文件保存；复杂雕刻、写实文物复原与任意照片建模不在本次能力范围内。</p><p>网页提供查看与下载。修改通过重新描述要求生成新版本，不提供顶点、材质或对象编辑器。导出的 Blender 文件可在 Blender 中继续使用。</p><p>文化内容作为创作参考，不把生成模型标称为真实文物或测绘复原。已选文化资料会随任务传递。</p></details>
    </section>
    {(task || busy || error || pendingShown) && <section className="surface studio-status" aria-label="3D 资产任务状态">
      <div className="section-heading"><div><h3 role="status">{title}</h3>{task && <p>{new Date(task.createdAt).toLocaleString('zh-CN')} · 本轮任务已记录</p>}</div><Button variant="ghost" disabled={busy} onClick={() => void perform(sync)}>刷新进度</Button></div>
      {error && <div className="creative-feedback creative-error" role="alert"><strong>本次操作未完成</strong><p>{error}</p></div>}
      {pendingShown && <div className="creative-feedback"><p>上次提交的结果尚未确认。核对会使用同一个请求编号，不会另建重复任务。</p><Button disabled={busy} onClick={() => void perform(submitPending)}>核对上次提交</Button></div>}
      {task?.error && <div><p>这条任务保存的失败原因：{task.error}</p>{task.code === 'invalid_key' && <p className="muted">这是该任务生成时的验证结果。若已更换密钥，{patternTask ? '请在设置中确认图片服务保存成功，再点击“生成文化图案”' : '请在设置中确认保存成功，再点击“开始生成资产”'}；刷新进度不会重新生成或验证新密钥。</p>}</div>}
      {task?.note && <p className="muted">{task.note}</p>}
      {Boolean(task?.args.textureSource) && task?.texturePrompt && <details className="studio-submitted"><summary>{patternTask ? '本轮图案描述' : '本轮纹理描述'}</summary><p>{task.texturePrompt}</p></details>}
      {state.historicalResult && <p className="muted">这份结果与当前请求或文化依据尚未确认一致，因此没有替换当前模型。可在下方历史版本中查看、下载；刷新进度会核对最新项目状态。</p>}
      {task?.status === 'waiting_external' && <div className="studio-handoff"><p>{patternTask ? '将这份交接请求粘贴到已连接工作台的 WorkBuddy。它会生成平面图案并写回本轮原任务，工作台接着把图案贴到器物外壁，完成后本页自动显示新版本。' : '将这份交接请求粘贴到已连接工作台的 WorkBuddy。它会回传本轮造型方案，工作台接着生成真实模型，完成后本页自动显示。'}</p>{instructions ? <><div className="inline-actions"><Button onClick={() => void copyRequest()}>复制请求到 WorkBuddy</Button><Button variant="ghost" aria-expanded={requestOpen} onClick={() => setRequestOpen(value => !value)}>{requestOpen ? '收起交接内容' : '查看交接内容'}</Button></div>{requestOpen && <Field label="本次完整交接请求"><textarea rows={7} readOnly value={instructions}/></Field>}</> : <p role="status">正在读取本轮交接内容，请点击刷新进度；输入要求仍可编辑。</p>}</div>}
      {state.active && <p className="muted">可离开页面，返回后继续查看同一任务。上方输入只用于下一轮，不会改变本轮已提交的要求。</p>}
      {project.craftRequest?.goal && <details className="studio-submitted"><summary>本轮已提交的要求</summary><p className="studio-goal">{project.craftRequest.goal}</p></details>}
    </section>}
    {preview && <section className="surface studio-result craft-result" aria-label="3D 资产结果">
      <div className="section-heading"><div><p className="eyebrow">{preview.taskId === state.latest?.taskId ? '最新版本' : '历史版本'}</p><h2>{preview.title}</h2><p>{craftKindLabel(preview.kind)} · {new Date(preview.createdAt).toLocaleString('zh-CN')}</p></div><a className="button button-primary" href={outputUrl(preview.blendFileId)} download={preview.title + '.blend'}>下载 Blender 文件</a></div>
      {state.active && <p className="muted">这里仍是已完成的版本；本轮完成后会自动显示新模型。</p>}
      <CraftViewer fileId={preview.glbFileId} title={preview.title}/>
      <div className="creative-feedback">
        <strong>让文化特征出现在模型表面</strong>
        <p>沿用这一版的原需求与文化资料，用现有生图功能生成平面纹样，再自动贴合器物外壁。内壁与器形保持不变，结果另存新版本。</p>
        {!service?.pattern ? <p className="muted">正在读取文化图案服务状态；若长时间没有更新，请更新并重启工作台服务。</p> : !service.pattern.supportedKinds.includes(preview.kind) ? <p className="muted">图案贴合先支持碗、盘、盆、花瓶、罐、锅、瓢勺和茶壶；建筑构件暂不支持。</p> : service.pattern.ready ? <><Button disabled={busy || state.active || pendingShown} onClick={() => void generatePattern()}>生成文化图案</Button><p className="muted">{service.pattern.provider === 'workbuddy' ? '点击后按页面提示交给 WorkBuddy 生图，图案返回后自动贴合并导出。' : '使用已配置的图片服务生成图案，按该服务计费。'} 无需配置混元 3D 或 COS。</p></> : <><p>{service.pattern.message}</p><Button variant="secondary" onClick={() => window.dispatchEvent(new CustomEvent('workbench-open-settings'))}>配置图片服务</Button></>}
        {preview.texture && <p className="muted">{preview.texture.method === 'image-wrap' ? '当前版本包含生图图案，已贴合器物外壁' : '当前版本包含混元颜色贴图'} · {preview.texture.size} 像素 · 已核对器形一致。{preview.texture.imageFileId && <> <a href={imageUrl({id:preview.texture.imageFileId,fileId:preview.texture.imageFileId,name:preview.title + '-文化图案'})} download={preview.title + '-文化图案.png'}>下载图案 PNG</a></>}</p>}
      </div>
      <div className="craft-result-meta"><span>{preview.stats.vertices.toLocaleString()} 个顶点</span><span>{preview.stats.triangles.toLocaleString()} 个三角面</span><span>{preview.stats.objects} 个对象</span><span>{preview.stats.dimensions.map(value => Number(value.toFixed(3))).join(' × ')} 米</span><a href={outputUrl(preview.glbFileId)} download={preview.title + '.glb'}>下载 GLB</a></div>
      {preview.warnings?.length > 0 && <div className="creative-feedback"><strong>本版说明</strong><ul>{preview.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul></div>}
      <details className="studio-submitted"><summary>查看这版模型的生成要求</summary><p className="studio-goal">{preview.prompt}</p></details>
      {preview.knowledge?.length ? <details className="studio-submitted"><summary>本版文化依据与出处 · {preview.knowledge.length} 条</summary><pre className="workflow-text">{knowledgeText({knowledge: preview.knowledge})}</pre><p className="muted">资料用于文化语境与创作参考，模型造型是本次生成的设计表达。</p></details> : null}
    </section>}
    {(assets.length > 1 || assets.length > 0 && !state.latest) && <details className="surface craft-history"><summary>历史模型 · 共 {assets.length} 个版本</summary><p className="muted">选择后在上方查看，每次只加载一个模型。切换历史预览不改变当前成果。</p><ol>{assets.map(asset => <li key={asset.taskId}><div><strong>{asset.title}</strong><span>{new Date(asset.createdAt).toLocaleString('zh-CN')}</span></div><div className="inline-actions"><Button variant="ghost" aria-pressed={preview?.taskId === asset.taskId} onClick={() => setSelected(asset.taskId)}>{preview?.taskId === asset.taskId ? '正在查看' : '查看这一版'}</Button><a href={outputUrl(asset.blendFileId)} download={asset.title + '.blend'}>下载 Blender</a></div></li>)}</ol></details>}
    {project.designPackage && <details className="surface craft-history"><summary>原有设计资料</summary><p>此前整理的设计说明与参考图片保留，可继续下载。</p><a href={outputUrl(project.designPackage.fileId)} download="原有设计资料.zip">下载原有资料 ZIP</a></details>}
  </div>;
}
