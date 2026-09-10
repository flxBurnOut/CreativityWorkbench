'use client';
import { useEffect, useRef, useState } from 'react';
import { Button, Field } from '@/components/workbench/ui';
import { api } from '@/features/projects/server-store';
import { TEXT_PRESETS } from '@/lib/workbench/text-config.mjs';
import { textureStoragePolicy } from '@/lib/workbench/craft-texture-config.mjs';

type Settings = { savedAt?: string | null; texture?: {credentialSource:string;ready:boolean}; secrets: Record<string, boolean>; values: Record<string, string> };
const services = [
  { title: '文字生成', detail: '用于创意、内容、美术提示词、短篇正文与 3D 造型方案；支持 DeepSeek 官方及兼容接口。', key: 'DEEPSEEK_API_KEY', base: 'TEXT_API_BASE_URL', model: 'TEXT_API_MODEL' },
  { title: '图像生成', detail: '兼容 Images API 的外部服务', key: 'IMAGE_API_KEY', provider: 'WORKBENCH_IMAGE_PROVIDER', base: 'IMAGE_API_BASE_URL', model: 'IMAGE_API_MODEL' },
  { title: '视频生成', detail: 'Runway Gen-4.5', key: 'VIDEO_API_KEY', provider: 'VIDEO_PROVIDER', base: 'VIDEO_API_BASE_URL' },
  { title: 'WorkBuddy', detail: '本地助理自动发送授权；手动交接无需填写', key: 'WORKBUDDY_ACCESS_TOKEN' },
  { title: '混元云端纹理（旧接口，可选）', detail: '仅供明确选择混元的旧纹理任务使用。网页“生成文化图案”使用图片服务，无需填写本项。默认复用同一 Token Hub 地址下的文字密钥；单独填写则使用独立密钥。', key: 'CRAFT_TEXTURE_API_KEY', base: 'CRAFT_TEXTURE_API_BASE_URL' },
];
const secretKeys = [...services.map(service => service.key), 'COS_SECRET_ID', 'COS_SECRET_KEY'];

export function ServiceSettings({ onSaved, focusTexture = false }: { onSaved: () => void; focusTexture?: boolean }) {
  const [data, setData] = useState<Settings | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [cleared, setCleared] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const settingsElement = useRef<HTMLDetailsElement>(null), textureSection = useRef<HTMLElement>(null);
  useEffect(() => {if(focusTexture){if(settingsElement.current)settingsElement.current.open=true;textureSection.current?.scrollIntoView({block:'start'});}},[focusTexture,data]);
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
    const input = Object.fromEntries(Object.entries(draft).filter(([key, value]) => !secretKeys.includes(key) || value.trim()));
    for (const key of cleared) input[key] = '';
    try {
      setData(await api<Settings>('settings', 'PUT', input));
      setDraft({}); setCleared([]); setMessage('配置已保存，将用于下一次生成。密钥是否有效以服务返回结果为准；历史失败记录不会被改写。'); window.dispatchEvent(new Event('workbench-settings-saved')); onSaved();
    } catch (e) { setError(e instanceof Error ? e.message : '保存失败，请重试。'); }
    finally { setBusy(false); }
  }
  const dirty = cleared.length > 0 || Object.entries(draft).some(([key, value]) => secretKeys.includes(key) ? Boolean(value.trim()) : value !== data?.values[key]);
  const cosPolicy = textureStoragePolicy(draft.COS_BUCKET ?? data?.values.COS_BUCKET ?? '', draft.COS_REGION ?? data?.values.COS_REGION ?? 'ap-guangzhou');
  return <details className="settings-section api-settings" ref={settingsElement}><summary>API 配置 <span>添加或更换密钥</span></summary>
    <p className="settings-note">密钥仅保存于本机服务，不回显、不写入浏览器存储。留空保留已有密钥；保存不会发起付费调用。</p>
    {data && <p className="settings-note">{data.savedAt ? `最近保存：${new Date(data.savedAt).toLocaleString('zh-CN')}。` : '尚无网页配置保存记录。'}已配置表示本机存在密钥，不代表已通过服务验证。</p>}
    {error && <p className="creative-feedback creative-error" role="alert">{error}</p>}
    {!data ? <Button variant="secondary" onClick={() => void load()}>重新读取配置</Button> : <form onSubmit={event => { event.preventDefault(); void save(); }}>
      <fieldset disabled={busy} className="api-settings-fields">
        {services.map(service => <section className="api-service" key={service.key}>
          <div className="api-service-heading"><h4>{service.title}</h4><span className={`api-status ${data.secrets[service.key] ? 'configured' : ''}`}>{cleared.includes(service.key) ? '待清除' : draft[service.key]?.trim() ? '新密钥待保存' : data.secrets[service.key] ? '已配置' : service.key==='CRAFT_TEXTURE_API_KEY'&&data.texture?.credentialSource==='text'&&data.secrets.DEEPSEEK_API_KEY ? '复用文字密钥' : '未配置'}</span></div>
          <p className="settings-note">{service.detail}</p>
          {service.key === 'DEEPSEEK_API_KEY' && <><div className="inline-actions">{Object.entries(TEXT_PRESETS).map(([key, preset]) => <Button key={key} variant="secondary" onClick={() => { setDraft(previous => ({...previous, TEXT_API_BASE_URL: preset.baseUrl, TEXT_API_MODEL: preset.model})); setMessage(''); }}>填入{preset.label}配置</Button>)}</div><p className="settings-note">密钥、API 地址和模型须来自同一服务。腾讯云预设为广州按量接口；其他地域按控制台地址填写。预设保留已有密钥，点击保存后生效。</p></>}
          {service.provider && <Field label="默认生成服务"><select value={draft[service.provider] ?? data.values[service.provider]} onChange={event => change(service.provider!, event.target.value)}><option value="workbuddy">WorkBuddy</option><option value="external">外部 API</option></select></Field>}
          <Field label={service.key === 'WORKBUDDY_ACCESS_TOKEN' ? 'Access Token' : 'API Key'}>
            <input type="password" autoComplete="new-password" spellCheck={false} value={draft[service.key] || ''} disabled={busy || cleared.includes(service.key)} placeholder={data.secrets[service.key] ? '已保存密钥，输入新值即可更换' : service.key==='CRAFT_TEXTURE_API_KEY'&&data.texture?.credentialSource==='text'&&data.secrets.DEEPSEEK_API_KEY ? '正在复用文字密钥，留空即可' : '粘贴你的密钥'} onChange={event => change(service.key, event.target.value)} />
          </Field>
          {data.secrets[service.key] && <Button variant="ghost" onClick={() => { setCleared(previous => previous.includes(service.key) ? previous.filter(key => key !== service.key) : [...previous, service.key]); setMessage(''); }}>{cleared.includes(service.key) ? '撤销清除' : '清除已保存密钥'}</Button>}
          {service.base && <Field label="API 地址"><input type="url" value={draft[service.base] ?? data.values[service.base]} onChange={event => change(service.base!, event.target.value)} required /></Field>}
          {service.model && <Field label="模型名称"><input value={draft[service.model] ?? data.values[service.model]} onChange={event => change(service.model!, event.target.value)} required /></Field>}
          {service.key === 'DEEPSEEK_API_KEY' && <p className="settings-note">填写平台的准确模型 ID，所选文字模型需支持 JSON 输出。此配置不会自动开通图片、视频或云端 3D 生成。</p>}
        </section>)}
        <section className="api-service" aria-label="文化纹理临时存储配置" ref={textureSection}>
          <h4>旧混元接口：临时模型存储（可选）</h4>
          <p className="settings-note">网页“生成文化图案”不需要 COS。只有明确使用混元云端纹理时，才需临时上传模型供腾讯云读取；原作品仍保存在本机。Token Hub 密钥与 COS 访问凭据是两套不同的配置。</p>
          <details open={focusTexture || undefined}><summary>我没有用过 COS，查看一次性设置步骤</summary>
            <ol>
              <li>进入腾讯云 COS 控制台，新建一个专用存储桶，地域选广州，访问权限选“私有读写”。记下包含末尾数字的完整桶名。</li>
              <li>在腾讯云访问管理中，为专用子用户配置该桶 <code>workbench-texture/*</code> 范围的 PutObject、GetObject、DeleteObject 权限，然后在本机填写它的 SecretId 和 SecretKey。</li>
              <li>在该桶配置生命周期：仅对 <code>workbench-texture/</code> 前缀内的对象，在创建一天后删除。工作台会尝试主动清理，这条规则用于中断时兜底。这个临时桶无需开启版本控制或静态网站。</li>
              <li>填好下方配置并保存，供明确选择混元的纹理任务使用。实际发起任务时会上传本轮模型并调用付费纹理服务。</li>
            </ol>
            <p className="settings-note"><a href="https://cloud.tencent.com/document/product/436/14106" target="_blank" rel="noreferrer">腾讯云创建存储桶说明</a> · <a href="https://cloud.tencent.com/document/product/436/17031" target="_blank" rel="noreferrer">生命周期设置说明</a></p>
            {cosPolicy ? <><Field label="此临时目录的访问权限策略"><textarea readOnly rows={8} value={cosPolicy}/></Field><Button variant="secondary" onClick={() => void navigator.clipboard.writeText(cosPolicy).then(() => setMessage('已复制权限策略，在腾讯云访问管理中创建自定义策略并绑定专用子用户。')).catch(() => setError('复制失败，请手动复制上方策略。'))}>复制权限策略</Button></> : <p className="settings-note">在下方填好存储桶完整名称和地域后，这里会生成可复制的权限策略。</p>}
          </details>
          <Field label="COS 存储桶完整名称"><input value={draft.COS_BUCKET ?? data.values.COS_BUCKET ?? ''} placeholder="在 COS 控制台复制完整桶名（含末尾 APPID）" onChange={event => change('COS_BUCKET', event.target.value)} /></Field>
          <Field label="COS 所属地域"><input value={draft.COS_REGION ?? data.values.COS_REGION ?? 'ap-guangzhou'} onChange={event => change('COS_REGION', event.target.value)} /></Field>
          {['COS_SECRET_ID','COS_SECRET_KEY'].map(key => <div key={key}><Field label={key === 'COS_SECRET_ID' ? 'COS SecretId' : 'COS SecretKey'}><input type="password" autoComplete="new-password" spellCheck={false} value={draft[key] || ''} disabled={cleared.includes(key)} placeholder={data.secrets[key] ? '已保存；留空保留，输入新值可更换' : '仅填在本机，不发送到聊天'} onChange={event => change(key, event.target.value)} /></Field>{data.secrets[key] && <Button variant="ghost" onClick={() => setCleared(previous => previous.includes(key) ? previous.filter(item => item !== key) : [...previous, key])}>{cleared.includes(key) ? '撤销清除' : '清除已保存的 '+(key === 'COS_SECRET_ID' ? 'SecretId' : 'SecretKey')}</Button>}</div>)}
          <p className="settings-note">纹理调用约 3.6 元/次（以腾讯云实际计费为准），COS 另有少量存储与流量费用。保存配置不会发起生成或验证云端权限。</p>
        </section>
        <p className="settings-note">页面保存的配置优先于环境文件。清除密钥会停用对应授权；默认生成服务同时用于网页和 MCP，新任务也可单独选择。</p>
        <Button type="submit" disabled={busy || !dirty}>{busy ? '正在保存…' : '保存 API 配置'}</Button>
        {dirty && <p className="settings-note" role="status">修改尚未保存，请点击“保存 API 配置”并等待成功提示。</p>}
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
