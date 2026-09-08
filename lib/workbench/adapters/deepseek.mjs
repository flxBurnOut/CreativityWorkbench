import { ServiceError } from '../errors.mjs';
import { readJsonResponse } from './json-response.mjs';

export const MODEL = 'deepseek-v4-flash';
export const ENDPOINT = 'https://api.deepseek.com/chat/completions';

export async function requestDeepSeekJson(messages, { apiKey, signal, fetchImpl = fetch }) {
  if (!apiKey?.trim()) throw new ServiceError(503, 'not_configured', '请先在设置中配置 DeepSeek API 密钥。');
  let response;
  try {
    response = await fetchImpl(ENDPOINT, {
      method: 'POST', redirect: 'error', signal,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey.trim()}` },
      body: JSON.stringify({ model: MODEL, messages, stream: false, thinking: { type: 'disabled' }, response_format: { type: 'json_object' }, max_tokens: 8192 }),
    });
  } catch {
    throw new ServiceError(504, signal?.aborted ? 'interrupted' : 'uncertain', '文字请求中断，供应商处理结果待核实；不会自动重发，原稿保持不变。');
  }
  if (!response.ok) {
    const errors = {
      401: [503, 'invalid_key', 'DeepSeek 密钥无效，请检查配置。'],
      403: [503, 'invalid_key', 'DeepSeek 授权被拒绝，请检查配置。'],
      402: [503, 'insufficient_balance', 'DeepSeek 账户余额不足，请充值后重试。'],
      429: [429, 'rate_limited', 'DeepSeek 请求较多，请稍后手动重试。'],
    };
    const [status, code, message] = errors[response.status] ?? [502, 'provider_error', 'DeepSeek 暂时无法完成请求，请稍后重试。'];
    await response.body?.cancel();
    throw new ServiceError(status, code, message);
  }
  const data = await readJsonResponse(response);
  const choice = data.choices?.[0];
  if (choice?.finish_reason !== 'stop') throw new ServiceError(502, 'incomplete_response', '文字生成被截断或未完整结束，原稿保持不变。');
  try { return { value: JSON.parse(choice.message.content), model: MODEL }; }
  catch { throw new ServiceError(502, 'invalid_response', '模型未返回有效的结构化结果。'); }
}

export async function completeCreativeBrief(messages, options) {
  const { value: result, model } = await requestDeepSeekJson(messages, options);
  if (!result || !['title', 'brief', 'culture'].every(key => typeof result[key] === 'string' && result[key].trim()) || result.title.length > 80 || result.brief.length > 20000 || result.culture.length > 4000) {
    throw new ServiceError(502, 'invalid_response', '模型返回的方案格式不完整，请重试。');
  }
  return { title: result.title.trim(), brief: result.brief.trim(), culture: result.culture.trim(), model };
}
