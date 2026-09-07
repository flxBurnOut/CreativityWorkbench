import http from 'node:http';
import { listCapabilities } from './runtime.mjs';

export function createRuntimeServer() {
  return http.createServer(async (request, response) => {
    const send = (status, body) => {
      response.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
      response.end(JSON.stringify(body));
    };
    try {
      const pathname = new URL(request.url || '/', 'http://localhost').pathname;
      if (request.method === 'GET' && pathname === '/health') {
        send(200, { ok: true, service: 'app-scaffold-runtime' });
      } else if (request.method === 'GET' && pathname === '/v1/capabilities') {
        send(200, { capabilities: await listCapabilities() });
      } else {
        send(404, { error: 'Not found' });
      }
    } catch {
      send(500, { error: 'Runtime unavailable' });
    }
  });
}
