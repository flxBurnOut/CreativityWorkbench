import { ServiceError } from '../errors.mjs';
import { readJsonResponse } from './json-response.mjs';
import { textServiceConfig } from '../text-config.mjs';
import { textErrorDiagnostic } from './text-error.mjs';

export const MODEL = 'deepseek-v4-flash';
export const ENDPOINT = 'https://api.deepseek.com/chat/completions';

export async function requestDeepSeekJson(messages, { apiKey, baseUrl, model, signal, fetchImpl = fetch }) {
  const config = textServiceConfig({DEEPSEEK_API_KEY: apiKey, TEXT_API_BASE_URL: baseUrl, TEXT_API_MODEL: model});
  if (!apiKey?.trim()) throw new ServiceError(503, 'not_configured', '请先在设置中配置文字服务的 API 地址、密钥与模型。');
  const thinking = /(^|\/)deepseek(?:-|$)/i.test(config.model) ? {thinking: {type: 'disabled'}} : {};
  let response;
  try {
    response = await fetchImpl(config.endpoint, {
      method: 'POST', redirect: 'error', signal,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey.trim()}` },
      body: JSON.stringify({ model: config.model, messages, stream: false, ...thinking, response_format: { type: 'json_object' }, max_tokens: 8192 }),
    });
  } catch {
    throw new ServiceError(504, signal?.aborted ? 'interrupted' : 'uncertain', '文字请求中断，供应商处理结果待核实；不会自动重发，原稿保持不变。');
  }
  if (!response.ok) {
    const diagnostic = response.status === 400 ? await textErrorDiagnostic(response, config) : '';
    const errors = {
      401: [503, 'invalid_key', `${config.provider}鉴权失败（401）。请确认 API 地址与密钥来自同一平台；腾讯云密钥不能直接用于 DeepSeek 官方接口。`],
      403: [503, 'access_denied', `${config.provider}拒绝访问（403）。请检查密钥权限、所选模型及服务地域。`],
      402: [503, 'insufficient_balance', `${config.provider}额度不足，请检查余额与计费配置。`],
      404: [503, 'model_unavailable', `${config.provider}未找到接口或模型（404），请检查 API 地址与准确的模型 ID。`],
      400: [400, 'provider_parameters', `${config.provider}未接受调用参数（400）。${diagnostic || '供应商未提供可识别的参数原因，请核对平台调用示例中的模型 ID 与参数。'}`],
      429: [429, 'rate_limited', `${config.provider}请求较多，请稍后手动重试。`],
    };
    const [status, code, message] = errors[response.status] ?? [502, 'provider_error', `${config.provider}暂时无法完成请求，请稍后重试。`];
    try { await response.body?.cancel(); } catch { /* Keep the original HTTP error if the error stream broke. */ }
    throw new ServiceError(status, code, message);
  }
  const data = await readJsonResponse(response);
  const choice = data.choices?.[0];
  if (choice?.finish_reason !== 'stop') throw new ServiceError(502, 'incomplete_response', '文字生成被截断或未完整结束，原稿保持不变。');
  try { return { value: JSON.parse(choice.message.content), model: config.model }; }
  catch { throw new ServiceError(502, 'invalid_response', '模型未返回有效的结构化结果。'); }
}

export async function completeCreativeBrief(messages, options) {
  const { value: result, model } = await requestDeepSeekJson(messages, options);
  if (!result || !['title', 'brief', 'culture'].every(key => typeof result[key] === 'string' && result[key].trim()) || result.title.length > 80 || result.brief.length > 20000 || result.culture.length > 4000) {
    throw new ServiceError(502, 'invalid_response', '模型返回的方案格式不完整，请重试。');
  }
  return { title: result.title.trim(), brief: result.brief.trim(), culture: result.culture.trim(), model };
}
