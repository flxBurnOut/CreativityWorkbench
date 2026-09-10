// A dedicated immutable-file route: sandbox subresources cannot pass vinext's
// development-only page-origin guard. No page, workspace or mutation is proxied here.
import { once } from 'node:events';
import { finished } from 'node:stream/promises';

export function sourcePreviewMiddleware(runtimeUrl,fetchImpl=fetch) {
  return async (request,response,next)=>{
    if(request.method!=='GET'||!/^\/api\/workbench\/data\/source-preview\/[a-f0-9]{64}\.zip\/[^?#]+$/.test(request.url||''))return next();
    try{if(request.url.split('/').slice(6).some(part=>{const decoded=decodeURIComponent(part);return !decoded||decoded==='.'||decoded==='..'||/[\\/]/.test(decoded);}))return next();}catch{return next();}
    const host=request.headers.host||'';const origin=request.headers.origin;
    if(!/^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/.test(host)||(origin&&origin!=='null'&&origin!==`http://${host}`))return next();
    const controller=new AbortController();
    const signal=AbortSignal.any([controller.signal,AbortSignal.timeout(30000)]);
    const abort=()=>controller.abort();
    const closed=()=>{if(!response.writableFinished)abort();};
    let reader;
    const cancelReader=()=>{void reader?.cancel(signal.reason).catch(()=>{});};
    signal.addEventListener('abort',cancelReader,{once:true});
    request.once('aborted',abort);response.once('close',closed);response.once('error',abort);
    if(request.aborted||response.destroyed)abort();
    try {
      const path=request.url.replace('/api/workbench/data/','/v1/');
      const result=await fetchImpl(runtimeUrl+path,{redirect:'error',headers:request.headers.range?{Range:request.headers.range}:{},signal});
      reader=result.body?.getReader();signal.throwIfAborted();
      const headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'};
      for(const key of ['Content-Type','Content-Length','Content-Range','Accept-Ranges','Content-Security-Policy','Referrer-Policy','Access-Control-Allow-Origin','Cache-Control']){const value=result.headers.get(key);if(value)headers[key]=value;}
      response.writeHead(result.status,headers);
      // Keep only the stream's bounded queue. A slow or closed browser must not
      // retain an entire image/video or keep the Runtime decoding an abandoned ZIP.
      if(reader)while(true){
        const {done,value}=await reader.read();signal.throwIfAborted();if(done)break;
        if(!response.write(value))await once(response,'drain',{signal});
      }
      response.end();await finished(response,{signal,cleanup:true});
    }catch{
      if(!response.destroyed&&!response.writableEnded){
        if(response.headersSent)response.destroy();
        else if(!controller.signal.aborted){response.writeHead(503,{'Content-Type':'text/plain; charset=utf-8'});response.end('静态预览暂时无法读取。');}
      }
    }finally{
      signal.removeEventListener('abort',cancelReader);
      if(reader){try{await reader.cancel();}catch{}finally{reader.releaseLock();}}
      request.off('aborted',abort);response.off('close',closed);response.off('error',abort);
    }
  };
}
