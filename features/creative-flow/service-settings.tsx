'use client';
import { useEffect, useState } from 'react';
import { Button, Field } from '@/components/workbench/ui';
import { api } from '@/features/projects/server-store';

type Settings = { secrets: Record<string, boolean>; values: Record<string, string> };
const services = [
  { title: '文字与网站', detail: 'DeepSeek V4 Flash · 创意、正文与网站生成', key: 'DEEPSEEK_API_KEY' },
  { title: '图像生成', detail: '兼容 Images API 的外部服务', key: 'IMAGE_API_KEY', provider: 'WORKBENCH_IMAGE_PROVIDER', base: 'IMAGE_API_BASE_URL', model: 'IMAGE_API_MODEL' },
  { title: '视频生成', detail: 'Runway Gen-4.5', key: 'VIDEO_API_KEY', provider: 'VIDEO_PROVIDER', base: 'VIDEO_API_BASE_URL' },
  { title: 'WorkBuddy', detail: '本地助理自动发送授权；手动交接无需填写', key: 'WORKBUDDY_ACCESS_TOKEN' },
];

export function ServiceSettings({ onSaved }: { onSaved: () => void }) {
  const [data, setData] = useState<Settings | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [cleared, setCleared] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  async function load() {
    setError('');
    try { setData(await api<Settings>('settings')); }
    catch (e) { setError(e instanceof Error ? e.message : '配置读取失败。'); }
  }
  useEffect(() => { void load(); }, []);
  function change(key: string, value: string) {
    setDraft(previous => ({ ...previous, [key]: value }));
    setMessage('');
  }
  async function save() {
    setBusy(true); setError(''); setMessage('');
    const input = Object.fromEntries(Object.entries(draft).filter(([key, value]) => !services.some(s => s.key === key) || value.trim()));
    for (const key of cleared) input[key] = '';
    try {
      setData(await api<Settings>('settings', 'PUT', input));
      setDraft({}); setCleared([]); setMessage('配置已保存，后续生成立即生效。'); window.dispatchEvent(new Event('workbench-settings-saved')); onSaved();
    } catch (e) { setError(e instanceof Error ? e.message : '保存失败，请重试。'); }
    finally { setBusy(false); }
  }
  const dirty = cleared.length > 0 || Object.entries(draft).some(([key, value]) => services.some(s => s.key === key) ? Boolean(value.trim()) : value !== data?.values[key]);
  return <details className="settings-section api-settings"><summary>API 配置 <span>添加或更换密钥</span></summary>
    <p className="settings-note">密钥仅保存于本机服务，不回显、不写入浏览器存储。留空保留已有密钥；保存不会发起付费调用。</p>
    {error && <p className="creative-feedback creative-error" role="alert">{error}</p>}
    {!data ? <Button variant="secondary" onClick={() => void load()}>重新读取配置</Button> : <form onSubmit={event => { event.preventDefault(); void save(); }}>
      <fieldset disabled={busy} className="api-settings-fields">
        {services.map(service => <section className="api-service" key={service.key}>
          <div className="api-service-heading"><h4>{service.title}</h4><span className={`api-status ${data.secrets[service.key] ? 'configured' : ''}`}>{cleared.includes(service.key) ? '待清除' : data.secrets[service.key] ? '已配置' : '未配置'}</span></div>
          <p className="settings-note">{service.detail}</p>
          {service.provider && <Field label="默认生成服务"><select value={draft[service.provider] ?? data.values[service.provider]} onChange={event => change(service.provider!, event.target.value)}><option value="workbuddy">WorkBuddy</option><option value="external">外部 API</option></select></Field>}
          <Field label={service.key === 'WORKBUDDY_ACCESS_TOKEN' ? 'Access Token' : 'API Key'}>
            <input type="password" autoComplete="new-password" spellCheck={false} value={draft[service.key] || ''} disabled={busy || cleared.includes(service.key)} placeholder={data.secrets[service.key] ? '已保存密钥，输入新值即可更换' : '粘贴你的密钥'} onChange={event => change(service.key, event.target.value)} />
          </Field>
          {data.secrets[service.key] && <Button variant="ghost" onClick={() => { setCleared(previous => previous.includes(service.key) ? previous.filter(key => key !== service.key) : [...previous, service.key]); setMessage(''); }}>{cleared.includes(service.key) ? '撤销清除' : '清除已保存密钥'}</Button>}
          {service.base && <Field label="API 地址"><input type="url" value={draft[service.base] ?? data.values[service.base]} onChange={event => change(service.base!, event.target.value)} required /></Field>}
          {service.model && <Field label="模型名称"><input value={draft[service.model] ?? data.values[service.model]} onChange={event => change(service.model!, event.target.value)} required /></Field>}
        </section>)}
        <p className="settings-note">页面保存的配置优先于环境文件。清除密钥会停用对应授权；默认生成服务同时用于网页和 MCP，新任务也可单独选择。</p>
        <Button type="submit" disabled={busy || !dirty}>{busy ? '正在保存…' : '保存 API 配置'}</Button>
      </fieldset>
      {message && <p role="status" className="settings-note">{message}</p>}
    </form>}
  </details>;
}

export function WorkspaceRecovery() {
  const [state, setState] = useState<{ recoverable?: boolean; recoveryToken?: string; projectCount?: number; note?: string; restored?: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function run(action: 'inspect' | 'restore') {
    setBusy(true); setError('');
    try { setState(await api('recovery', 'POST', { action, ...(action === 'restore' ? { recoveryToken: state?.recoveryToken } : {}) })); }
    catch (e) { setError(e instanceof Error ? e.message : '恢复检查失败。'); }
    finally { setBusy(false); }
  }
  return <details className="workspace-recovery"><summary>项目记录无法读取时恢复上一版</summary><p className="settings-note">仅在当前快照损坏或丢失时恢复。原损坏文件会保留，最近一次修改可能需要重新补充。</p><Button variant="secondary" disabled={busy} onClick={() => void run('inspect')}>检查恢复快照</Button>{state?.note && <p role="status">{state.note}</p>}{state?.recoverable && <Button disabled={busy} onClick={() => void run('restore')}>恢复上一版（{state.projectCount} 个项目）</Button>}{state?.restored && <Button onClick={() => window.location.reload()}>刷新并读取恢复项目</Button>}{error && <p role="alert">{error}</p>}</details>;
}
