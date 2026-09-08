import { ServiceError } from '../errors.mjs';

export const MODEL = 'deepseek-v4-flash';
export const ENDPOINT = 'https://api.deepseek.com/chat/completions';

export async function completeCreativeBrief(messages, { apiKey, signal, fetchImpl = fetch }) {
  if (!apiKey?.trim()) throw new ServiceError(503, 'not_configured', '请先在服务端配置 DeepSeek API 密钥。');
  try {
    const response = await fetchImpl(ENDPOINT, {
      method: 'POST', redirect: 'error', signal,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey.trim()}` },
      body: JSON.stringify({ model: MODEL, messages, stream: false, thinking: { type: 'disabled' }, response_format: { type: 'json_object' }, max_tokens: 4096 }),
    });
    if (!response.ok) {
      const errors = {
        401: [503, 'invalid_key', 'DeepSeek 密钥无效，请检查服务端配置。'],
        402: [503, 'insufficient_balance', 'DeepSeek 账户余额不足，请充值后重试。'],
        429: [429, 'rate_limited', 'DeepSeek 请求较多，请稍后手动重试。'],
      };
      const [status, code, message] = errors[response.status] ?? [502, 'provider_error', 'DeepSeek 暂时无法完成请求，请稍后重试。'];
      await response.body?.cancel();
      throw new ServiceError(status, code, message);
    }
    const reader = response.body?.getReader();
    if (!reader) throw new ServiceError(502, 'invalid_response', '模型未返回内容，请重试。');
    let raw = ''; let bytes = 0;
    const decoder = new TextDecoder();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > 256 * 1024) { await reader.cancel(); throw new ServiceError(502, 'invalid_response', '模型返回内容过长，请缩小要求后重试。'); }
        raw += decoder.decode(value, { stream: true });
      }
    } finally { reader.releaseLock(); }
    raw += decoder.decode();
    const choice = JSON.parse(raw).choices?.[0];
    if (choice?.finish_reason !== 'stop') throw new ServiceError(502, 'incomplete_response', '模型未完整返回方案，原稿保持不变，请重试。');
    const result = JSON.parse(choice.message?.content);
    if (!result || !['title', 'brief', 'culture'].every(key => typeof result[key] === 'string' && result[key].trim()) || result.title.length > 80 || result.brief.length > 20000 || result.culture.length > 4000) {
      throw new ServiceError(502, 'invalid_response', '模型返回的方案格式不完整，请重试。');
    }
    return { title: result.title.trim(), brief: result.brief.trim(), culture: result.culture.trim(), model: MODEL };
  } catch (error) {
    if (error instanceof ServiceError) throw error;
    if (signal?.aborted) throw new ServiceError(504, 'interrupted', '请求已取消或等待超时，原稿保持不变。');
    throw new ServiceError(502, 'invalid_response', '暂时无法读取 DeepSeek 的结果，请检查网络后重试。');
  }
}
