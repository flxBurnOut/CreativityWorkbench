import { ServiceError } from '../errors.mjs';

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

