const tokenHubCodes = {
  '400001': '请求格式不合法，请检查当前模型的接口协议。',
  '400002': '请求参数无效或缺失，请核对下列参数。',
  '400003': '输入内容超过模型上下文限制，请缩短本次要求或参考内容。',
  '400004': '模型或服务 ID 不存在，请从腾讯云控制台复制准确的模型 ID。',
  '400005': '当前模型不支持所请求的协议或能力，请核对控制台调用示例。',
  '400006': '当前模型不支持所请求的 JSON 输出格式，请选用支持 JSON 输出的文字模型。',
  '401006': '服务 ID 不存在或与模型不匹配，请核对控制台调用示例。',
};
const parameters = ['model', 'messages', 'response_format', 'thinking', 'max_tokens', 'max_completion_tokens', 'stream', 'temperature', 'top_p', 'prompt', 'file_3d', 'enable_keep_uv', 'texture_size', 'enable_pbr'];

// Error bodies may echo keys or whole prompts. Read a bounded body, but only
// retain documented error codes, known parameter names and a UUID request ID.
export async function textErrorDiagnostic(response, {provider, apiKey, texture = false}) {
  const reader = response.body?.getReader();
  if (!reader) return '';
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; void reader.cancel().catch(() => {}); }, 2000);
  const chunks = []; let bytes = 0;
  try {
    for (;;) {
      const {done, value} = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 16384) { void reader.cancel().catch(() => {}); return ''; }
      chunks.push(value);
    }
    if (timedOut) return '';
    const data = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    const error = data?.error;
    if (!error || typeof error !== 'object' || Array.isArray(error)) return '';
    const code = String(error.code ?? '');
    const knownCode = provider === '腾讯云 Token Hub' && Object.hasOwn(tokenHubCodes, code) ? code : '';
    const detail = [error.param, error.message, error.message_zh].filter(value => typeof value === 'string').join(' ');
    const mentioned = parameters.filter(name => new RegExp('(^|[^a-zA-Z0-9_])' + name + '([^a-zA-Z0-9_]|$)').test(detail));
    const id = error.request_id ?? data.request_id;
    const requestId = typeof id === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id) ? id : '';
    const reason = texture && knownCode === '400006' ? '模型不支持指定的文件或输出格式，请核对纹理接口要求。' : tokenHubCodes[knownCode];
    const result = [knownCode && `供应商错误码 ${knownCode}：${reason}`, mentioned.length && `供应商提到的参数：${mentioned.join('、')}。`, requestId && `请求编号：${requestId}。`].filter(Boolean).join(' ');
    return apiKey?.trim() && result.includes(apiKey.trim()) ? '' : result;
  } catch { return ''; }
  finally { clearTimeout(timer); reader.releaseLock(); }
}
