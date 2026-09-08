// Browser -> same-origin Web -> local Runtime -> DeepSeek adapter.
export async function GET() {
  try {
    const base = process.env.WORKBENCH_RUNTIME_URL || 'http://127.0.0.1:8791';
    const response = await fetch(base + '/v1/creative/status', { cache: 'no-store', signal: AbortSignal.timeout(3000) });
    return Response.json(await response.json(), { status: response.status, headers: { 'Cache-Control': 'no-store' } });
  } catch { return Response.json({ error: '创意服务无法连接，请启动 Runtime。' }, { status: 503 }); }
}

export async function POST(request: Request) {
  const origin = request.headers.get('origin');
  if ((origin && origin !== new URL(request.url).origin) || request.headers.get('sec-fetch-site') === 'cross-site') return Response.json({ error: '请在当前工作台内发起请求。' }, { status: 403 });
  if (!request.headers.get('content-type')?.startsWith('application/json')) return Response.json({ error: '请求格式无效。' }, { status: 415 });
  try {
    const reader = request.body?.getReader();
    if (!reader) return Response.json({ error: '缺少创意内容。' }, { status: 400 });
    const chunks: Uint8Array[] = []; let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 128 * 1024) { await reader.cancel(); return Response.json({ error: '创意内容过长，请精简后重试。' }, { status: 413 }); }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
    const body = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
    const base = process.env.WORKBENCH_RUNTIME_URL || 'http://127.0.0.1:8791';
    const response = await fetch(base + '/v1/creative/brief', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body,
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(125000)]),
    });
    return Response.json(await response.json(), { status: response.status, headers: { 'Cache-Control': 'no-store' } });
  } catch { return Response.json({ error: '创意服务连接中断或超时，原稿保持不变，请手动重试。' }, { status: 503 }); }
}
