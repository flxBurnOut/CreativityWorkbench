import { ServiceError } from '../errors.mjs';
import { readJsonResponse } from './text.mjs';

export function imageConfig(env) {
  return { provider: env.WORKBENCH_IMAGE_PROVIDER || 'workbuddy', model: env.IMAGE_API_MODEL || 'gpt-image-2',
    workbuddyConfigured: Boolean(env.WORKBUDDY_ACCESS_TOKEN?.trim()), externalConfigured: Boolean(env.IMAGE_API_KEY?.trim()),
    externalBaseUrl: env.IMAGE_API_BASE_URL || 'https://api.openai.com/v1' };
}

export async function externalImage(prompt, images, { env, fetchImpl, signal, ratio = '1:1' }) {
  if (!env.IMAGE_API_KEY?.trim()) throw new ServiceError(503, 'not_configured', '请配置外部图像接口的地址、密钥与模型。');
  const config = imageConfig(env);
  const base = new URL(config.externalBaseUrl.endsWith('/') ? config.externalBaseUrl : config.externalBaseUrl + '/');
  if (base.username || base.password || base.search || base.hash || (base.protocol !== 'https:' && !(base.protocol === 'http:' && ['localhost','127.0.0.1','[::1]'].includes(base.hostname)))) throw new ServiceError(503, 'invalid_config', '图像接口地址须为 HTTPS，或本机 HTTP 地址。');
  const size = { '1:1': '1024x1024', '3:2': '1536x1024', '2:3': '1024x1536' }[ratio];
  const fields = { model: config.model, prompt, n: 1, size, quality: 'medium', output_format: 'png' };
  const headers = { Authorization: `Bearer ${env.IMAGE_API_KEY.trim()}` };
  let body;
  if (images.length) {
    body = new FormData();
    for (const [key, value] of Object.entries(fields)) body.set(key, String(value));
    images.forEach((bytes, i) => body.append('image[]', new Blob([bytes], { type: 'image/png' }), `input-${i + 1}.png`));
  } else { headers['Content-Type'] = 'application/json'; body = JSON.stringify(fields); }
  let response;
  try { response = await fetchImpl(new URL(images.length ? 'images/edits' : 'images/generations', base), { method: 'POST', redirect: 'error', headers, body, signal }); }
  catch { throw new ServiceError(504, 'uncertain', '图像请求中断，结果待核实；不会自动再次计费生成。'); }
  if (!response.ok) { await response.body?.cancel(); throw new ServiceError(response.status === 429 ? 429 : 502, 'provider_error', [401,403].includes(response.status) ? '图像接口授权失败，请检查配置。' : '图像服务未完成请求，请查看账户状态和接口支持范围。'); }
  const data = await readJsonResponse(response, 32 * 1024 * 1024);
  const encoded = data.data?.[0]?.b64_json;
  if (typeof encoded !== 'string' || !/^[A-Za-z0-9+/\r\n]+={0,2}$/.test(encoded)) throw new ServiceError(502, 'invalid_response', '图像接口须返回 data[0].b64_json 图片内容，当前返回不兼容。');
  return { bytes: Buffer.from(encoded, 'base64'), provider: 'external', model: config.model };
}

// Official WorkBuddy Local Assistant API; credentials are supplied explicitly by the application owner.
export async function sendWorkBuddy(content, { env, fetchImpl, signal }) {
  if (!env.WORKBUDDY_ACCESS_TOKEN?.trim()) return null;
  let response;
  try {
    response = await fetchImpl('https://www.workbuddy.cn/openapi/v2/localassistant/message', { method: 'POST', redirect: 'error', signal,
      headers: { Authorization: `Bearer ${env.WORKBUDDY_ACCESS_TOKEN.trim()}`, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ content, msg_type: 'text' }) });
  } catch { throw new ServiceError(504, 'uncertain', 'WorkBuddy 请求是否送达待核实，请查看本地助理；不会自动重发。'); }
  if (response.status >= 500) { await response.body?.cancel(); throw new ServiceError(502, 'uncertain', 'WorkBuddy 服务异常，消息是否已处理待核实；不会自动重发。'); }
  if (!response.ok) { await response.body?.cancel(); throw new ServiceError(502, 'workbuddy_error', 'WorkBuddy 未接收请求，请检查授权范围、令牌有效期和本地助理状态。'); }
  const result = await readJsonResponse(response);
  if (result.code !== 0) throw new ServiceError(502, 'workbuddy_error', 'WorkBuddy 未确认消息接收，请检查授权与本地助理状态。');
  if (typeof result.data?.message_id !== 'string') throw new ServiceError(502, 'uncertain', 'WorkBuddy 返回内容缺少消息标识，送达情况待核实。');
  return result.data.message_id;
}
