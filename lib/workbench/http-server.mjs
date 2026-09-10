import http from 'node:http';
import { join } from 'node:path';
import { createServiceSettings } from './service-settings.mjs';
import { listCapabilities, generateCreativeBrief, creativeStatus } from './runtime.mjs';
import { ServiceError } from './errors.mjs';
import { fileURLToPath } from 'node:url';
import { createRepository, digest } from './repository.mjs';
import { createTaskManager } from './tasks.mjs';
import { generationStatus } from './generation.mjs';
import { importMedia } from './video-media.mjs';
import { SITE_CSP } from './website.mjs';
import { createCoreService, runtimeIdentity } from './core-service.mjs';
import {importWebsiteSource,SOURCE_PREVIEW_CSP,sourceMime} from './workflow-delivery.mjs';
import {readZipMember} from './zip-stream.mjs';
import {pipeline} from 'node:stream/promises';

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

export function createRuntimeServer({ env = process.env, fetchImpl = fetch, dataDirectory, settingsPath = dataDirectory ? join(dataDirectory, 'service-settings.json') : fileURLToPath(new URL('../../work/service-settings.json', import.meta.url)) } = {}) {
  env = { ...env };
  const settings = createServiceSettings(env, settingsPath);
  const repository = createRepository(dataDirectory || env.WORKBENCH_DATA_DIR || fileURLToPath(new URL('../../work/data', import.meta.url)));
  const tasks = createTaskManager(repository, { env, fetchImpl });
  const core = createCoreService(repository, tasks, { env, fetchImpl });
  let active = 0; let mediaActive = 0;
  let previewQueue=Promise.resolve(),previewPending=0;
  const inFlight=new Set(),shutdownController=new AbortController();
  const server = http.createServer((request,response) => {
    // HTTP connection lifetime can end before an asynchronous import finishes.
    // Keep its work tracked even after the client disconnects.
    const operation=handleRequest(request,response);inFlight.add(operation);
    void operation.finally(()=>inFlight.delete(operation)).catch(()=>{});
  });
  async function handleRequest(request, response) {
    const send = (status, body) => {
      if (response.destroyed) return;
      if(response.headersSent){response.destroy();return;}
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
      } else if (request.method === 'GET' && pathname === '/v1/settings') {
        send(200, settings.status());
      } else if (request.method === 'PUT' && pathname === '/v1/settings') {
        send(200, settings.save(await readJson(request)));
      } else if (request.method === 'POST' && pathname === '/v1/recovery') {
        send(200, await core.call('workspace_recover', await readJson(request)));
      } else if (request.method === 'GET' && pathname === '/v1/workspace') {
        const saved = await repository.loadWorkspace();
        send(200, { version: 1, revision: saved.revision, workspace: saved.workspace });
      } else if (request.method === 'PUT' && pathname === '/v1/workspace') {
        const input = await readJson(request);
        const revision=await repository.saveWorkspace(input.workspace, input.expectedRevision, input.writeId);
        const saved=await repository.loadWorkspace();
        send(200, { revision, flows:saved.workspace.projects.map(p=>({id:p.id,flow:p.flow,assets:p.assets})) });
      } else if (request.method === 'POST' && pathname === '/v1/media') {
        if (!['image/png','image/jpeg','image/webp'].includes(request.headers['content-type'])) throw new ServiceError(415, 'invalid_image', '仅支持 PNG、JPG、WebP 图片。');
        if(mediaActive>=2)throw new ServiceError(429,'busy','正在接收素材，请稍后重试。');mediaActive++;
        try{send(201, await repository.putImage(await readBody(request, 20 * 1024 * 1024)));}finally{mediaActive--;}
      } else if(request.method==='POST'&&pathname==='/v1/files/website-source') {
        if(mediaActive>=2)throw new ServiceError(429,'busy','当前正在导入文件，请稍后。');mediaActive++;
        try{send(201,await importWebsiteSource(await readBody(request,128*1024*1024),repository));}finally{mediaActive--;}
      } else if(request.method==='GET'&&/^\/v1\/source-preview\/[a-f0-9]{64}\.zip\/.+/.test(pathname)) {
        const parts=pathname.split('/');const id=parts[3];const path=decodeURIComponent(parts.slice(4).join('/'));
        if(previewPending>=16)throw new ServiceError(429,'busy','预览请求较多，请稍后重试。');previewPending++;
        const controller=new AbortController();const close=()=>controller.abort();response.once('close',close);
        let bytes;
        try {
          const operation=previewQueue.then(()=>readZipMember(repository.fileChunks(id),path,{signal:controller.signal}));
          previewQueue=operation.then(()=>{},()=>{});bytes=await operation;
        }finally{previewPending--;response.off('close',close);}
        const range=byteRange(request.headers.range,bytes.length);
        const headers={'Content-Type':sourceMime(path),'Content-Security-Policy':SOURCE_PREVIEW_CSP,'X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Access-Control-Allow-Origin':'*','Accept-Ranges':'bytes','Cache-Control':'private, max-age=3600'};
        if(range===false){response.writeHead(416,{...headers,'Content-Range':`bytes */${bytes.length}`});response.end();}
        else{response.writeHead(range?206:200,{...headers,...(range?{'Content-Range':`bytes ${range.start}-${range.end}/${bytes.length}`}:{ }),'Content-Length':range?range.end-range.start+1:bytes.length});response.end(range?bytes.subarray(range.start,range.end+1):bytes);}
      } else if (request.method === 'POST' && /^\/v1\/files\/(mp4|wav|restore\/[a-f0-9]{64}\.(mp4|wav|html|zip|srt))$/.test(pathname)) {
        if(mediaActive>=2)throw new ServiceError(429,'busy','当前正在处理媒体，请稍后上传。');mediaActive++;
        try {
          const parts=pathname.split('/');const restoring=parts[3]==='restore';const extension=restoring?parts[4].split('.').pop():parts[3];
          const bytes=await readBody(request,128*1024*1024);
          if(restoring && digest(bytes)+'.'+extension!==parts[4])throw new ServiceError(400,'invalid_backup','备份文件校验不一致。');
          if(['mp4','wav'].includes(extension)) {
            const stored=await importMedia(bytes,extension,repository,{env,signal:AbortSignal.any([shutdownController.signal,AbortSignal.timeout(180000)])});
            send(201,restoring?await repository.putOutput(bytes,extension):stored);
          } else {
            if(!restoring || (extension==='html'&&(!/^<!doctype html>/i.test(bytes.toString('utf8',0,30))||bytes.length>32*1024*1024)) || (extension==='zip'&&bytes.readUInt32LE(0)!==0x04034b50) || (extension==='srt'&&bytes.length>1024*1024))throw new ServiceError(400,'invalid_backup','备份成品格式无效。');
            send(201,await repository.putOutput(bytes,extension));
          }
        } finally {mediaActive--;}
      } else if (request.method === 'GET' && /^\/v1\/files\/[a-f0-9]{64}\.(mp4|wav|html|zip|srt)$/.test(pathname)) {
        const id=pathname.split('/').pop();const {handle,size}=await repository.openStored(id);const ext=id.split('.').pop();const range=byteRange(request.headers.range,size);
        const headers={'Content-Type':fileMime[ext],'Cache-Control':'private, max-age=3600','X-Content-Type-Options':'nosniff','Accept-Ranges':'bytes',...(ext==='html'?{'Content-Security-Policy':SITE_CSP,'Referrer-Policy':'no-referrer'}:{}),...(['zip','srt'].includes(ext)?{'Content-Disposition':`attachment; filename="${ext==='zip'?'website':'captions'}.${ext}"`}:{})};
        try {
          if(range===false){response.writeHead(416,{...headers,'Content-Range':`bytes */${size}`});response.end();}
          else{response.writeHead(range?206:200,{...headers,...(range?{'Content-Range':`bytes ${range.start}-${range.end}/${size}`}:{ }),'Content-Length':range?range.end-range.start+1:size});await pipeline(handle.createReadStream({...range,highWaterMark:64*1024,autoClose:false}),response);}
        }finally{await handle.close();}
      } else if (request.method === 'GET' && /^\/v1\/media\/[a-f0-9]{64}$/.test(pathname)) {
        const bytes = await repository.media(pathname.split('/').pop());
        response.writeHead(200, { 'Content-Type': 'image/png', 'Content-Length': bytes.length, 'Cache-Control': 'private, max-age=3600', 'X-Content-Type-Options': 'nosniff' }); response.end(bytes);
      } else if (request.method === 'POST' && pathname === '/v1/tasks') {
        send(202, await tasks.submit(await readJson(request)));
      } else if (request.method === 'GET' && pathname === '/v1/tasks') {
        send(200, { tasks: await tasks.list(url.searchParams.get('projectId')) });
      } else if (request.method==='POST'&&/^\/v1\/tasks\/[a-zA-Z0-9_-]{1,80}\/website-result$/.test(pathname)) {
        if(mediaActive>=2)throw new ServiceError(429,'busy','已有文件正在处理，请稍后再试。');
        mediaActive++;try{send(200,await tasks.completeWebsite(pathname.split('/')[3],{bytes:await readBody(request,128*1024*1024)}));}finally{mediaActive--;}
      } else if (/^\/v1\/tasks\/[a-zA-Z0-9_-]{1,80}(\/(cancel|dismiss))?$/.test(pathname)) {
        const parts = pathname.split('/');
        if (request.method === 'GET' && parts.length === 4) {
          const task = await tasks.get(parts[3]); send(task ? 200 : 404, task || { error: '任务不存在。' });
        } else if (request.method === 'POST' && parts[4] === 'cancel') send(200, await tasks.cancel(parts[3]));
        else if (request.method === 'POST' && parts[4] === 'dismiss') send(200, await tasks.dismiss(parts[3],(await readJson(request)).replacementTaskId));
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
          send(200, await generateCreativeBrief(input, { env, fetchImpl, signal: AbortSignal.any([controller.signal,shutdownController.signal]) }));
        } finally { active--; response.off('close', onClose); }
      } else {
        send(404, { error: 'Not found' });
      }
    } catch (error) {
      send(error instanceof ServiceError ? error.status : 500, { error: error instanceof ServiceError ? error.message : 'Runtime unavailable', code: error instanceof ServiceError ? error.code : 'runtime_error' });
    }
  }
  let stoppingTasks,shutdown;
  const stopTasks=()=>stoppingTasks??=tasks.stop();
  server.on('close', () => { void stopTasks().catch(()=>{}); });
  // Closing the HTTP listener alone does not await generation/receive workers.
  // Callers that remove a test directory or stop the app need the full lifecycle.
  server.shutdown=()=>shutdown??=(async()=>{
    shutdownController.abort();
    const closed=new Promise((resolve,reject)=>server.close(error=>error&&error.code!=='ERR_SERVER_NOT_RUNNING'?reject(error):resolve()));
    server.closeIdleConnections?.();
    const results=await Promise.allSettled([closed,stopTasks()]);
    // Direct HTTP/core imports are separate from task-manager workers. Drain
    // them after all sockets close, including work left by disconnected clients.
    while(inFlight.size)results.push(...await Promise.allSettled(inFlight));
    for(const result of results)if(result.status==='rejected')throw result.reason;
  })();
  return server;
}
