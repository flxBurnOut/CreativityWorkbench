import { ServiceError } from '../errors.mjs';
import { ENDPOINT, MODEL } from './deepseek.mjs';

export async function readJsonResponse(response, limit = 1024 * 1024) {
  const reader = response.body?.getReader();
  if (!reader) throw new ServiceError(502, 'invalid_response', '服务未返回有效内容。');
  const chunks = []; let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > limit) { await reader.cancel(); throw new ServiceError(502, 'invalid_response', '服务返回内容过大。'); }
      chunks.push(value);
    }
  } catch (e) { if (e instanceof ServiceError) throw e; throw new ServiceError(504, 'uncertain', '接收服务结果时连接中断，完成情况待核实；不会自动重发。'); }
  finally { reader.releaseLock(); }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new ServiceError(502, 'invalid_response', '服务返回内容无法解析。'); }
}

export async function generateJson(system, input, { env, fetchImpl, signal }) {
  if (!env.DEEPSEEK_API_KEY?.trim()) throw new ServiceError(503, 'not_configured', '请在服务端配置 DEEPSEEK_API_KEY，再发起文字生成。');
  let response;
  try {
    response = await fetchImpl(ENDPOINT, { method: 'POST', redirect: 'error', signal,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.DEEPSEEK_API_KEY.trim()}` },
      body: JSON.stringify({ model: MODEL, messages: [{ role: 'system', content: system }, { role: 'user', content: JSON.stringify(input) }], stream: false, thinking: { type: 'disabled' }, response_format: { type: 'json_object' }, max_tokens: 8192 }),
    });
  } catch { throw new ServiceError(504, 'uncertain', '文字请求中断，供应商是否完成待核实；不会自动重发。'); }
  if (!response.ok) {
    await response.body?.cancel();
    throw new ServiceError(response.status === 429 ? 429 : 502, 'provider_error', [401,403].includes(response.status) ? '文字服务授权无效，请检查配置。' : response.status === 402 ? '文字服务余额不足。' : '文字服务未完成请求，请检查服务状态。');
  }
  const data = await readJsonResponse(response);
  const choice = data.choices?.[0];
  if (choice?.finish_reason !== 'stop') throw new ServiceError(502, 'incomplete_response', '文字生成被截断或未完整结束，原稿保持不变。');
  try { return { value: JSON.parse(choice.message.content), model: MODEL }; }
  catch { throw new ServiceError(502, 'invalid_response', '模型未返回有效的结构化结果。'); }
}
