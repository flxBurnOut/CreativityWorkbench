import http from 'node:http';
import { listCapabilities, generateCreativeBrief, creativeStatus } from './runtime.mjs';
import { ServiceError } from './errors.mjs';
import { fileURLToPath } from 'node:url';
import { createRepository, digest } from './repository.mjs';
import { createTaskManager } from './tasks.mjs';
import { generationStatus } from './generation.mjs';
import { importMedia } from './video-media.mjs';
import { SITE_CSP } from './website.mjs';
import { createCoreService, runtimeIdentity } from './core-service.mjs';

const fileMime = {mp4:'video/mp4',wav:'audio/wav',html:'text/html; charset=utf-8',zip:'application/zip',srt:'text/plain; charset=utf-8'};
export function byteRange(header,size) {
  if(!header)return null;
  const match=/^bytes=(\d*)-(\d*)$/.exec(header);if(!match||!size||(!match[1]&&!match[2]))return false;
  const start=match[1]?Number(match[1]):Math.max(0,size-Number(match[2]));
  const end=match[1]?(match[2]?Math.min(Number(match[2]),size-1):size-1):size-1;
  return Number.isSafeInteger(start)&&Number.isSafeInteger(end)&&start<=end&&start<size&&(!(!match[1]&&Number(match[2])===0))?{start,end}:false;
}

async function readBody(request, limit) {
  const chunks = []; let bytes = 0;
  for await (const chunk of request) {
    bytes += chunk.length;
    if (bytes > limit) throw new ServiceError(413, 'too_large', '请求内容过大，请减少文件或文字后重试。');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
async function readJson(request) {
  if (!request.headers['content-type']?.startsWith('application/json')) throw new ServiceError(415, 'invalid_input', '请使用 JSON 请求。');
  try { return JSON.parse((await readBody(request, 16 * 1024 * 1024)).toString('utf8')); }
  catch (e) { if (e instanceof ServiceError) throw e; throw new ServiceError(400, 'invalid_input', '请求格式无效。'); }
}

export function createRuntimeServer({ env = process.env, fetchImpl = fetch, dataDirectory } = {}) {
  const repository = createRepository(dataDirectory || env.WORKBENCH_DATA_DIR || fileURLToPath(new URL('../../work/data', import.meta.url)));
  const tasks = createTaskManager(repository, { env, fetchImpl });
  const core = createCoreService(repository, tasks, { env, fetchImpl });
  let active = 0;
  const server = http.createServer(async (request, response) => {
    const send = (status, body) => {
      if (response.destroyed) return;
      response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
      response.end(JSON.stringify(body));
    };
    try {
      // Only the local web server/CLI may use the runtime; browser calls use the same-origin web route.
      const host = new URL('http://' + request.headers.host).hostname;
      if (!['localhost', '127.0.0.1', '[::1]'].includes(host) || request.headers.origin) throw new ServiceError(403, 'forbidden', '请通过工作台页面访问。');
      const url = new URL(request.url || '/', 'http://localhost');
      const pathname = url.pathname;
      if (request.method === 'GET' && pathname === '/health') {
        send(200, { ok: true, service: 'app-scaffold-runtime', ...runtimeIdentity(repository) });
      } else if (request.method === 'POST' && /^\/v1\/core\/[a-z_]+$/.test(pathname)) {
        send(200, await core.call(pathname.split('/').pop(), await readJson(request)));
      } else if (request.method === 'GET' && /^\/v1\/exports\/[a-f0-9]{64}\.(md|txt)$/.test(pathname)) {
        const id = pathname.split('/').pop(); const bytes = await repository.readExport(id);
        response.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Content-Length': bytes.length, 'X-Content-Type-Options': 'nosniff', 'Content-Disposition': `attachment; filename="novel.${id.split('.').pop()}"` });
        response.end(bytes);
      } else if (request.method === 'GET' && pathname === '/v1/capabilities') {
        send(200, { capabilities: await listCapabilities() });
      } else if (request.method === 'GET' && pathname === '/v1/creative/status') {
        send(200, creativeStatus(env));
      } else if (request.method === 'GET' && pathname === '/v1/status') {
        send(200, generationStatus(env));
      } else if (request.method === 'GET' && pathname === '/v1/workspace') {
        const saved = await repository.loadWorkspace();
        send(200, { version: 1, revision: saved.revision, workspace: saved.workspace });
      } else if (request.method === 'PUT' && pathname === '/v1/workspace') {
        const input = await readJson(request);
        send(200, { revision: await repository.saveWorkspace(input.workspace, input.expectedRevision, input.writeId) });
      } else if (request.method === 'POST' && pathname === '/v1/media') {
        if (!['image/png','image/jpeg','image/webp'].includes(request.headers['content-type'])) throw new ServiceError(415, 'invalid_image', '仅支持 PNG、JPG、WebP 图片。');
        send(201, await repository.putImage(await readBody(request, 20 * 1024 * 1024)));
      } else if (request.method === 'POST' && /^\/v1\/files\/(mp4|wav|restore\/[a-f0-9]{64}\.(mp4|wav|html|zip|srt))$/.test(pathname)) {
        if(active>=2)throw new ServiceError(429,'busy','当前正在处理媒体，请稍后上传。');active++;
        try {
          const parts=pathname.split('/');const restoring=parts[3]==='restore';const extension=restoring?parts[4].split('.').pop():parts[3];
          const bytes=await readBody(request,128*1024*1024);
          if(restoring && digest(bytes)+'.'+extension!==parts[4])throw new ServiceError(400,'invalid_backup','备份文件校验不一致。');
          if(['mp4','wav'].includes(extension)) {
            const stored=await importMedia(bytes,extension,repository,{env,signal:AbortSignal.timeout(180000)});
            send(201,restoring?await repository.putOutput(bytes,extension):stored);
          } else {
            if(!restoring || (extension==='html'&&(!/^<!doctype html>/i.test(bytes.toString('utf8',0,30))||bytes.length>32*1024*1024)) || (extension==='zip'&&bytes.readUInt32LE(0)!==0x04034b50) || (extension==='srt'&&bytes.length>1024*1024))throw new ServiceError(400,'invalid_backup','备份成品格式无效。');
            send(201,await repository.putOutput(bytes,extension));
          }
        } finally {active--;}
      } else if (request.method === 'GET' && /^\/v1\/files\/[a-f0-9]{64}\.(mp4|wav|html|zip|srt)$/.test(pathname)) {
        const id=pathname.split('/').pop();const bytes=await repository.output(id);const ext=id.split('.').pop();const range=byteRange(request.headers.range,bytes.length);
        const headers={'Content-Type':fileMime[ext],'Cache-Control':'private, max-age=3600','X-Content-Type-Options':'nosniff','Accept-Ranges':'bytes',...(ext==='html'?{'Content-Security-Policy':SITE_CSP,'Referrer-Policy':'no-referrer'}:{}),...(['zip','srt'].includes(ext)?{'Content-Disposition':`attachment; filename="${ext==='zip'?'website':'captions'}.${ext}"`}:{})};
        if(range===false){response.writeHead(416,{...headers,'Content-Range':`bytes */${bytes.length}`});response.end();}
        else if(range){response.writeHead(206,{...headers,'Content-Range':`bytes ${range.start}-${range.end}/${bytes.length}`,'Content-Length':range.end-range.start+1});response.end(bytes.subarray(range.start,range.end+1));}
        else {response.writeHead(200,{...headers,'Content-Length':bytes.length});response.end(bytes);}
      } else if (request.method === 'GET' && /^\/v1\/media\/[a-f0-9]{64}$/.test(pathname)) {
        const bytes = await repository.media(pathname.split('/').pop());
        response.writeHead(200, { 'Content-Type': 'image/png', 'Content-Length': bytes.length, 'Cache-Control': 'private, max-age=3600', 'X-Content-Type-Options': 'nosniff' }); response.end(bytes);
      } else if (request.method === 'POST' && pathname === '/v1/tasks') {
        send(202, await tasks.submit(await readJson(request)));
      } else if (request.method === 'GET' && pathname === '/v1/tasks') {
        send(200, { tasks: await tasks.list(url.searchParams.get('projectId')) });
      } else if (/^\/v1\/tasks\/[a-zA-Z0-9_-]{1,80}(\/(cancel|dismiss))?$/.test(pathname)) {
        const parts = pathname.split('/');
        if (request.method === 'GET' && parts.length === 4) {
          const task = await tasks.get(parts[3]); send(task ? 200 : 404, task || { error: '任务不存在。' });
        } else if (request.method === 'POST' && parts[4] === 'cancel') send(200, await tasks.cancel(parts[3]));
        else if (request.method === 'POST' && parts[4] === 'dismiss') send(200, await tasks.dismiss(parts[3]));
        else send(405, { error: '请求方法无效。' });
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
  server.on('close', () => tasks.stop());
  return server;
}
