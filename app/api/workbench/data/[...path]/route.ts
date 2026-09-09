// Small same-origin proxy. Runtime owns files, tasks and credentials.
async function proxy(request: Request, context: { params: Promise<{ path: string[] }> }) {
  const { path } = await context.params;
  const route = path.join('/');
  if(path[0]==='source-preview'&&path.slice(2).some(part=>!part||part==='.'||part==='..'||/[\\/]/.test(part)))return Response.json({error:'预览路径无效。'},{status:400});
  if (!/^(source-preview\/[a-f0-9]{64}\.zip\/[^?#]+|workspace|status|settings|recovery|media|media\/[a-f0-9]{64}|files\/(website-source|mp4|wav|[a-f0-9]{64}\.(mp4|wav|html|zip|srt)|restore\/[a-f0-9]{64}\.(mp4|wav|html|zip|srt))|tasks|tasks\/[a-zA-Z0-9_-]{1,80}(\/(cancel|dismiss))?)$/.test(route)) return Response.json({ error: '接口不存在。' }, { status: 404 });
  if (route === 'settings' && !['localhost', '127.0.0.1', '[::1]'].includes(new URL(request.url).hostname)) return Response.json({ error: 'API 配置仅限本机访问。' }, { status: 403 });
  const origin = request.headers.get('origin');
  // Opaque sandbox documents load classic scripts/styles without an Origin header.
  // Only immutable preview files are readable here; all workspace and write routes keep origin checks.
  const sandboxResource=request.method==='GET'&&route.startsWith('source-preview/')&&(!origin||origin==='null');
  if (!sandboxResource && ((origin && origin !== new URL(request.url).origin) || request.headers.get('sec-fetch-site') === 'cross-site')) return Response.json({ error: '请从当前工作台访问。' }, { status: 403 });
  try {
    const headers: Record<string,string> = {};
    if(request.headers.has('range'))headers.Range=request.headers.get('range')!;
    let body: Uint8Array<ArrayBuffer> | undefined;
    if (!['GET','HEAD'].includes(request.method)) {
      const type = request.headers.get('content-type') || '';
      if (route.startsWith('files/') ? !['application/octet-stream','video/mp4','audio/wav','audio/x-wav','audio/mpeg','audio/mp4'].includes(type) : route === 'media' ? !['image/png','image/jpeg','image/webp'].includes(type) : !type.startsWith('application/json')) return Response.json({ error: '请求格式无效。' }, { status: 415 });
      headers['Content-Type'] = type;
      const reader = request.body?.getReader();
      const chunks: Uint8Array[] = []; let size = 0;
      if (reader) {
        try {
          for (;;) { const { done, value } = await reader.read(); if (done) break; size += value.length; if (size > (route.startsWith('files/')?128:20) * 1024 * 1024) { await reader.cancel(); return Response.json({ error: '请求内容过大。' }, { status: 413 }); } chunks.push(value); }
        } finally { reader.releaseLock(); }
      }
      body = new Uint8Array(size); let offset = 0;
      for (const chunk of chunks) { body.set(chunk,offset); offset += chunk.length; }
    }
    const base = process.env.WORKBENCH_RUNTIME_URL || 'http://127.0.0.1:8791';
    const query = route === 'tasks' ? new URL(request.url).search : '';
    const response = await fetch(`${base}/v1/${route}${query}`, { method: request.method, headers, body, cache: 'no-store', signal: AbortSignal.timeout(route.startsWith('files/')?240000:30000) });
    const responseHeaders:Record<string,string>={'Content-Type':response.headers.get('content-type')||'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'};
    for(const key of ['Content-Length','Content-Range','Accept-Ranges','Content-Disposition','Content-Security-Policy','Referrer-Policy','Access-Control-Allow-Origin']){const value=response.headers.get(key);if(value)responseHeaders[key]=value;}
    return new Response(response.body, { status: response.status, headers: responseHeaders });
  } catch { return Response.json({ error: '工作台服务暂时无法连接，当前内容仍然保留。' }, { status: 503 }); }
}
export { proxy as GET, proxy as POST, proxy as PUT };
