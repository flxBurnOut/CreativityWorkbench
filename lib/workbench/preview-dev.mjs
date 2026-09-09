// A dedicated immutable-file route: sandbox subresources cannot pass vinext's
// development-only page-origin guard. No page, workspace or mutation is proxied here.
export function sourcePreviewMiddleware(runtimeUrl,fetchImpl=fetch) {
  return async (request,response,next)=>{
    if(request.method!=='GET'||!/^\/api\/workbench\/data\/source-preview\/[a-f0-9]{64}\.zip\/[^?#]+$/.test(request.url||''))return next();
    try{if(request.url.split('/').slice(6).some(part=>{const decoded=decodeURIComponent(part);return !decoded||decoded==='.'||decoded==='..'||/[\\/]/.test(decoded);}))return next();}catch{return next();}
    const host=request.headers.host||'';const origin=request.headers.origin;
    if(!/^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/.test(host)||(origin&&origin!=='null'&&origin!==`http://${host}`))return next();
    try {
      const path=request.url.replace('/api/workbench/data/','/v1/');
      const result=await fetchImpl(runtimeUrl+path,{redirect:'error',signal:AbortSignal.timeout(30000)});
      const headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'};
      for(const key of ['Content-Type','Content-Security-Policy','Referrer-Policy','Access-Control-Allow-Origin']){const value=result.headers.get(key);if(value)headers[key]=value;}
      response.writeHead(result.status,headers);response.end(Buffer.from(await result.arrayBuffer()));
    }catch{response.writeHead(503,{'Content-Type':'text/plain; charset=utf-8'});response.end('静态预览暂时无法读取。');}
  };
}
