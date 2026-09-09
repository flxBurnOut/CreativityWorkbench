'use client';
import { knowledgeText } from '../../lib/workbench/knowledge.mjs';

import { useEffect, useRef, useState } from 'react';
import { Button, Field } from '@/components/workbench/ui';
import type { Project } from '@/features/projects/model';
import type { EditProject, Notice } from './stages';

export type CreativeAction = 'improve' | 'redirect' | 'revise';
type Result = { title: string; brief: string; culture: string; model: string };
function record(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === 'object'; }
function validResult(value: unknown): value is Result { return record(value) && ['title', 'brief', 'culture', 'model'].every(key => typeof value[key] === 'string'); }
export type CreativeControls = { run: (action: CreativeAction) => void; busy: boolean };
function fingerprint(p: Project) { return JSON.stringify([p.id, p.type, p.idea, p.brief, p.culture, knowledgeText(p), p.requests[0], p.title]); }

export function useCreativeGeneration(project: Project | null, demo: boolean, edit: EditProject, notice: Notice) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<{ output: Result; source: string } | null>(null);
  const [useTitle, setUseTitle] = useState(false);
  const controller = useRef<AbortController | null>(null);
  const latest = useRef(project); latest.current = project;
  useEffect(() => {
    controller.current?.abort(); controller.current = null;
    setBusy(false); setError(''); setResult(null); setUseTitle(false);
    return () => { controller.current?.abort(); controller.current = null; };
  }, [project?.id, project?.stage]);

  async function run(action: CreativeAction) {
    if (!project || controller.current) return;
    if (demo) { notice('演示项目不调用 AI，请新建自己的创意后使用。'); return; }
    if (!project.idea.trim()) { setError('请先写下最初的想法。'); return; }
    if (action === 'revise' && !project.requests[0].trim()) { setError('请先填写下方的修改要求。'); return; }
    const request = new AbortController(); controller.current = request;
    const source = fingerprint(project);
    setBusy(true); setError(''); setResult(null); setUseTitle(false);
    try {
      const response = await fetch('/api/workbench/creative', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: request.signal,
        body: JSON.stringify({ action, type: project.type, idea: project.idea, brief: project.brief, culture: project.culture, themeKnowledge:knowledgeText(project), instruction: project.requests[0] }),
      });
      const output = await response.json();
      if (!response.ok) throw new Error(record(output) && typeof output.error === 'string' ? output.error : '创意生成未完成，请重试。');
      if (!validResult(output)) throw new Error('返回的方案格式无效，请重试。');
      if (controller.current === request) setResult({ output, source });
    } catch (reason) {
      if (controller.current === request && !request.signal.aborted) setError(reason instanceof Error ? reason.message : '网络连接中断，请重试。');
    } finally {
      if (controller.current === request) { controller.current = null; setBusy(false); }
    }
  }

  function apply() {
    if (!result || !latest.current) return;
    if (fingerprint(latest.current) !== result.source) { setError('生成期间原稿已修改。请先复制需要保留的结果，再基于最新原稿重新生成。'); return; }
    const before = latest.current;
    const { output } = result;
    edit(p => ({ ...p, brief: output.brief, culture: output.culture, title: useTitle ? output.title : p.title, upstreamChanged: p.upstreamChanged || p.concepts.some(c => c.savedAssetId) }));
    setResult(null); setError('');
    notice('已采用新方案', () => {
      if (latest.current?.id !== before.id || latest.current.brief !== output.brief || latest.current.culture !== output.culture) { notice('原稿已继续修改，未覆盖后续内容。'); return; }
      edit(p => ({ ...p, brief: before.brief, culture: before.culture, title: useTitle && p.title === output.title ? before.title : p.title, upstreamChanged: before.upstreamChanged }));
    });
  }

  const stale = Boolean(result && project && result.source !== fingerprint(project));
  const panel = <>
    {busy && <div className="creative-feedback" role="status"><span>正在整理创意，原稿仍然保留…</span><Button variant="ghost" onClick={() => { controller.current?.abort(); controller.current = null; setBusy(false); setError('已停止等待，原稿保持不变。已发送的请求可能仍产生服务费用。'); }}>取消</Button></div>}
    {error && <div className="creative-feedback creative-error" role="alert">{error}</div>}
    {result && <section className="surface creative-result"><div className="section-heading"><div><h3>新的创意方案</h3><p>采用后更新当前方案；不满意可以保留原稿。</p></div></div><Field label="方案预览"><textarea readOnly rows={12} value={result.output.brief} /></Field><details className="quiet-details"><summary>文化语境与待核实点</summary><p className="creative-text">{result.output.culture}</p></details><label className="creative-title-choice"><input type="checkbox" checked={useTitle} onChange={event => setUseTitle(event.target.checked)} />同时采用建议名称：{result.output.title}</label>{stale && <p role="status">原稿已发生变化，请复制需要的文字或基于新原稿重新生成。</p>}<div className="modal-actions"><Button variant="ghost" onClick={() => { setResult(null); setError(''); }}>保留原稿</Button><Button disabled={stale} onClick={apply}>采用方案</Button></div></section>}
  </>;
  return { controls: { run, busy }, panel };
}

export function CreativeServiceStatus() {
  const [status, setStatus] = useState('正在检查配置…');
  const [checking, setChecking] = useState(false);
  async function check() {
    setChecking(true);
    try {
      const response = await fetch('/api/workbench/creative', { cache: 'no-store', signal: AbortSignal.timeout(5000) });
      const data = await response.json();
      setStatus(response.ok && record(data) ? data.configured ? '已配置密钥 · 可发起创意请求' : '待配置服务端密钥' : '创意服务未连接');
    } catch { setStatus('创意服务未连接'); }
    finally { setChecking(false); }
  }
  useEffect(() => { void check(); }, []);
  return <div className="settings-section"><h3>第一阶段 · 创意</h3><p>DeepSeek V4 Flash · {status}</p><p className="settings-note">完善、换方向与按要求修改。密钥在项目 .env.local 中通过 DEEPSEEK_API_KEY 配置，修改后重启开发服务。配置状态不代表余额或连通性已经验证。</p><Button variant="secondary" disabled={checking} onClick={check}>刷新服务状态</Button></div>;
}
