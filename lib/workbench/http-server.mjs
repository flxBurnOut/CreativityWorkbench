import http from 'node:http';
import { listCapabilities, generateCreativeBrief, creativeStatus } from './runtime.mjs';
import { ServiceError } from './errors.mjs';

export function createRuntimeServer({ env = process.env, fetchImpl = fetch } = {}) {
  let active = 0;
  return http.createServer(async (request, response) => {
    const send = (status, body) => {
      if (response.destroyed) return;
      response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
      response.end(JSON.stringify(body));
    };
    try {
      // Only the local web server/CLI may use the runtime; browser calls use the same-origin web route.
      const host = new URL('http://' + request.headers.host).hostname;
      if (!['localhost', '127.0.0.1', '[::1]'].includes(host) || request.headers.origin) throw new ServiceError(403, 'forbidden', '请通过工作台页面访问。');
      const pathname = new URL(request.url || '/', 'http://localhost').pathname;
      if (request.method === 'GET' && pathname === '/health') {
        send(200, { ok: true, service: 'app-scaffold-runtime' });
      } else if (request.method === 'GET' && pathname === '/v1/capabilities') {
        send(200, { capabilities: await listCapabilities() });
      } else if (request.method === 'GET' && pathname === '/v1/creative/status') {
        send(200, creativeStatus(env));
      } else if (request.method === 'POST' && pathname === '/v1/creative/brief') {
        if (!request.headers['content-type']?.startsWith('application/json')) throw new ServiceError(415, 'invalid_input', '请提交 JSON 格式的创意。');
        if (active >= 2) throw new ServiceError(429, 'busy', '当前有创意正在生成，请稍后重试。');
        const controller = new AbortController();
        const onClose = () => { if (!response.writableEnded) controller.abort(); };
        response.on('close', onClose);
        active++;
        try {
          const chunks = []; let bytes = 0;
          for await (const chunk of request) {
            bytes += chunk.length;
            if (bytes > 128 * 1024) throw new ServiceError(413, 'too_large', '创意内容过长，请精简后重试。');
            chunks.push(chunk);
          }
          let input;
          try { input = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
          catch { throw new ServiceError(400, 'invalid_input', '创意请求格式无效。'); }
          send(200, await generateCreativeBrief(input, { env, fetchImpl, signal: controller.signal }));
        } finally { active--; response.off('close', onClose); }
      } else {
        send(404, { error: 'Not found' });
      }
    } catch (error) {
      send(error instanceof ServiceError ? error.status : 500, { error: error instanceof ServiceError ? error.message : 'Runtime unavailable', code: error instanceof ServiceError ? error.code : 'runtime_error' });
    }
  });
}
