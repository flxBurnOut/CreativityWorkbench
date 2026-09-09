'use client';

import { useRef, useState, type ReactNode } from 'react';
import { Button } from '@/components/workbench/ui';
import { CONTENT_SECTIONS, TYPE_LABELS, type Project } from '@/features/projects/model';
import type { EditProject } from './stages';
import type { GenerationControls } from './generation-api';

export function ContentEditor({ project, edit, generation, results }: { project: Project; edit: EditProject; generation?: GenerationControls; results?: ReactNode }) {
  const sections = CONTENT_SECTIONS[project.type];
  const [activeKey, setActiveKey] = useState(sections[0].key);
  const [requestedScope, setScope] = useState('section');
  const [storedSelection, setSelection] = useState<{ key: string; start: number; end: number; selectedText: string } | null>(null);
  const [validation, setValidation] = useState('');
  const input = useRef<HTMLTextAreaElement>(null);
  const active = sections.find(s => s.key === activeKey) ?? sections[0];
  const value = project.content[project.type][active.key] ?? '';
  const selection = storedSelection?.key === active.key && value.slice(storedSelection.start, storedSelection.end) === storedSelection.selectedText ? storedSelection : null;
  const scope = requestedScope === 'selection' && !selection ? 'section' : requestedScope;
  const filled = sections.filter(s => project.content[project.type][s.key]?.trim()).length;
  const hasContent = filled > 0;
  const busy = generation?.contentBusy || generation?.busy;
  function submit(action?: string) {
    if (!action && hasContent && !project.requests[1].trim()) {
      setValidation('写下希望怎样修改，再生成建议。'); input.current?.focus(); return;
    }
    setValidation('');
    const args = action ? { action } : !hasContent ? { action: 'generate' } : scope === 'selection' && selection ? { action: 'selection', ...selection } : scope === 'all' ? { action: 'revise' } : { action: 'section', key: active.key };
    generation?.run('content', args);
  }
  return <div className="content-workspace">
    <section className="surface content-editor">
      <div className="section-heading"><div><h3>{TYPE_LABELS[project.type]}内容方案</h3><p>先写内容，再比较修改建议；采用后用于下一阶段。</p></div><span className="content-progress">{filled} / {sections.length} 小节已有内容</span></div>
      {!hasContent&&<div className="content-quick-start"><div><strong>还没有内容？先生成一份方案</strong><p>使用已保存的创意；也可以直接在下方填写已有文字。</p></div><Button icon="spark" disabled={busy||!generation} onClick={()=>submit()}>{busy?'正在生成…':'生成完整初稿'}</Button><details><summary>补充要求（选填）</summary><textarea rows={2} aria-label="初稿补充要求" value={project.requests[1]} placeholder="例如：保留开放式结局。" onChange={event=>{const value=event.target.value;edit(p=>({...p,requests:p.requests.map((v,i)=>i===1?value:v)}));}}/></details></div>}
      <div className="content-layout">
        <nav className="content-nav" aria-label="内容小节">{sections.map((section, index) => <button type="button" key={section.key} aria-current={active.key === section.key ? 'true' : undefined} onClick={() => { setActiveKey(section.key); setSelection(null); if (scope === 'selection') setScope('section'); setValidation(''); }}><span className="content-nav-number">{String(index + 1).padStart(2, '0')}</span><span>{section.label}<small>{project.content[project.type][section.key]?.trim() ? '已有内容' : '待补充'}</small></span></button>)}</nav>
        <div className="content-writing">
          <div className="content-editor-heading"><label htmlFor="content-draft">{active.label}</label><span>当前稿 · 修改自动保存</span></div>
          <p className="muted">{active.hint}</p>
          <textarea id="content-draft" className="document-editor" rows={8} value={value} placeholder={active.hint} onSelect={event => { const t = event.currentTarget; if (t.selectionEnd > t.selectionStart) setSelection({ key: active.key, start: t.selectionStart, end: t.selectionEnd, selectedText: t.value.slice(t.selectionStart, t.selectionEnd) }); else { setSelection(null); if (scope === 'selection') setScope('section'); } }} onChange={event => { const text = event.target.value; setSelection(null); if (scope === 'selection') setScope('section'); edit(p => ({ ...p, upstreamChanged: p.upstreamChanged || p.concepts.some(c => c.savedAssetId), content: { ...p.content, [p.type]: { ...p.content[p.type], [active.key]: text } } })); }} />
          <div className="content-wordcount">{value.length} 字 · 可直接输入或粘贴</div>
          {hasContent&&<div className="content-assistant">
            <div className="content-assistant-heading"><h4>{hasContent ? '让 AI 帮你修改' : '从创意生成初稿'}</h4>{hasContent && <label>修改范围 <select aria-label="修改范围" value={scope} onChange={e => setScope(e.target.value)}><option value="section">当前小节 · {active.label}</option><option value="selection" disabled={!selection}>选中文字{selection ? ` · ${selection.selectedText.length} 字` : ''}</option><option value="all">整份内容方案</option></select></label>}</div>
            {scope === 'selection' && selection && <blockquote className="content-selection">{selection.selectedText}</blockquote>}
            <label htmlFor="content-instruction">{hasContent ? '希望怎样修改？' : '补充要求（选填）'}</label>
            <textarea ref={input} id="content-instruction" rows={3} aria-describedby={validation ? 'content-validation' : 'content-scope-hint'} value={project.requests[1]} placeholder={hasContent ? '例如：保留人物动机，让这一段的冲突更清楚。' : '例如：围绕渡口展开，保留开放式结局。'} onChange={e => { setValidation(''); const text = e.target.value; edit(p => ({ ...p, requests: p.requests.map((v, i) => i === 1 ? text : v) })); }} />
            {validation && <p id="content-validation" role="alert" className="content-validation">{validation}</p>}
            <div className="content-submit"><p id="content-scope-hint">{!hasContent || scope === 'all' ? '将生成整份方案供比较。' : scope === 'selection' ? '只为选中文字生成替换建议。' : `只为「${active.label}」生成修改建议。`}采用前保留当前稿。</p><Button icon="spark" disabled={busy || !generation} onClick={() => submit()}>{busy ? '正在生成…' : hasContent ? '生成修改建议' : '生成完整初稿'}</Button></div>
            {hasContent && <details className="content-more"><summary>其他操作</summary><div className="inline-actions"><Button variant="ghost" disabled={busy} onClick={() => submit('check')}>检查整份方案的遗漏</Button><Button variant="ghost" disabled={busy} onClick={() => submit('alternative')}>另作完整方案候选</Button></div><p className="muted">沿用上方要求。检查只提供建议；另作方案会保留当前稿供比较。</p></details>}
          </div>}
        </div>
      </div>
    </section>
    {results}
    <p className="content-next-note">下一阶段使用当前已保存的内容。若有待采用建议，请先比较并决定是否采用。</p>
  </div>;
}
