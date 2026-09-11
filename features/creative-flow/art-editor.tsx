'use client';
import { useRef, useState, type ReactNode } from 'react';
import { Button, Field, Icon } from '@/components/workbench/ui';
import { activeArtPrompt, artFromPrompt, hasLegacyArt, ART_FIELDS } from '@/lib/workbench/art-prompt.mjs';
import type { Project } from '@/features/projects/model';
import type { EditProject, Notice } from './stages';
import type { GenerationControls } from './generation-api';

export function ArtEditor({ project, edit, notice, generation, results }: { project: Project; edit: EditProject; notice: Notice; generation?: GenerationControls; results?: ReactNode }) {
  const prompt = activeArtPrompt(project.art);
  const legacy = hasLegacyArt(project.art);
  const instruction = project.requests[2];
  const [validation, setValidation] = useState('');
  const input = useRef<HTMLTextAreaElement>(null);
  const waiting = generation?.tasks?.some(t => t.kind === 'art' && (!t.workType || t.workType === project.type) && !t.dismissed && !t.supersededBy && !['succeeded', 'failed', 'cancelled', 'superseded'].includes(t.status));
  const busy = generation?.busy || waiting;
  function generate() {
    if (prompt.trim() && !instruction.trim()) { setValidation('写下希望整理或修改的内容。'); input.current?.focus(); return; }
    setValidation('');
    generation?.run('art', { action: 'generate' });
  }
  return <div className="stage-stack art-prompt-editor">
    <section className="surface">
      <div className="section-heading"><div><h3>当前生效的美术风格提示词</h3><p>直接编写或粘贴。修改自动保存，后续新图使用这里的文字。</p></div><Button variant="ghost" icon="copy" disabled={!prompt.trim()} onClick={async () => { try { await navigator.clipboard.writeText(prompt); notice('美术风格提示词已复制'); } catch { notice('复制失败，请选中文字后复制。'); } }}>复制</Button></div>
      {legacy && <details className="art-legacy"><summary>已合并显示旧版画风记录，编辑后统一使用这段文字</summary><p>旧分项和综合描述全部保留在下方。如有重复或矛盾，可以直接修改，或让 AI 整理。原版本保留在历史中。</p><dl>{Object.entries(ART_FIELDS).map(([key, label]) => project.art[key as keyof Project['art']] && <div key={key}><dt>{label}</dt><dd>{project.art[key as keyof Project['art']]}</dd></div>)}</dl></details>}
      <Field label="美术风格提示词"><textarea className="document-editor" rows={9} value={prompt} placeholder="例如：当代岭南生活插画，轻微纸张肌理，青绿与米白配色，柔和自然光。人物造型简洁，保留已确定的时代与服饰，不加文字水印。" onChange={event => { const text = event.target.value; edit(p => ({ ...p, art: artFromPrompt(text), upstreamChanged: p.upstreamChanged || p.concepts.some(c => c.savedAssetId) })); }} /></Field>
      <div className="art-prompt-footer"><span>{prompt.length} 字</span><span>用于后续新图；已有图片不会自动改变。</span></div>
      <details className="art-writing-help"><summary><Icon name="book" size={15} /> 不知道怎么写？</summary><p>可以说明表现方式、造型与材质、色彩与光线，以及必须保留或排除的细节。只写你在意的部分即可。</p><p>例如：“保留当代服饰，改为低饱和水彩；柔和侧光，不加复古滤镜。”</p></details>
    </section>
    <section className="surface art-ai-assistant">
      <div className="section-heading"><div><h3>{prompt.trim() ? '让 AI 帮你整理或修改' : '让 AI 帮你起草'}</h3><p>结合当前创意、内容与文化资料，生成一段候选提示词。</p></div><span className="tag tag-soft">可选</span></div>
      <Field label={prompt.trim() ? '希望怎样整理或修改？' : '补充要求（选填）'}><textarea ref={input} rows={3} maxLength={8000} value={instruction} placeholder={prompt.trim() ? '例如：合并重复要求，保留青绿配色，改成更简洁的插画风格。' : '例如：温暖、轻盈的手绘风格；也可以留空，让 AI 根据当前内容起草。'} aria-describedby={validation ? 'art-instruction-error' : undefined} onChange={e => { setValidation(''); const text = e.target.value; edit(p => ({ ...p, requests: p.requests.map((v, i) => i === 2 ? text : v) })); }} /></Field>
      {validation && <p className="content-validation" id="art-instruction-error" role="alert">{validation}</p>}
      <div className="art-ai-actions"><p>候选采用后才会替换当前提示词。</p><Button icon="spark" disabled={busy || !generation} onClick={generate}>{busy ? '正在生成候选…' : '生成候选提示词'}</Button></div>
    </section>
    {results}
    <p className="muted art-next-note">参考图片在下一步“准备图片”中添加，并注明只参考哪些方面。修改旧图时可选择是否采用新的画风。</p>
  </div>;
}
