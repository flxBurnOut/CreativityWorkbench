import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter, once } from 'node:events';
import { Writable } from 'node:stream';
import http from 'node:http';
import { sourcePreviewMiddleware } from '../lib/workbench/preview-dev.mjs';

const path='/api/workbench/data/source-preview/'+'a'.repeat(64)+'.zip/asset.bin';
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};
function request(patch={}) {return Object.assign(new EventEmitter(),{method:'GET',url:path,headers:{host:'localhost:3001'},...patch});}
function sink(write=(_chunk,_encoding,callback)=>callback()) {
  const response=new Writable({highWaterMark:1024,write});
  response.writeHead=(status,headers)=>{assert.ok(!response.headersSent);response.status=status;response.headers=headers;response.headersSent=true;};
  return response;
}

test('preview forwards Range and headers and sends the first chunk before the file completes',{timeout:5000},async t=>{
  const release=deferred(),started=deferred();let options;
  const body=new ReadableStream({async start(controller){controller.enqueue(new TextEncoder().encode('first'));started.resolve();await release.promise;controller.enqueue(new TextEncoder().encode('last'));controller.close();}});
  const middleware=sourcePreviewMiddleware('http://127.0.0.1:8791',async(url,input)=>{
    assert.equal(url,'http://127.0.0.1:8791/v1/source-preview/'+'a'.repeat(64)+'.zip/asset.bin');options=input;
    const result=new Response(body,{status:206,headers:{'Content-Type':'video/mp4','Content-Length':'9','Content-Range':'bytes 2-10/20','Accept-Ranges':'bytes','Content-Security-Policy':"default-src 'none'",'Cache-Control':'private, max-age=3600'}});
    result.arrayBuffer=()=>assert.fail('preview must not buffer the response');return result;
  });
  const server=http.createServer((req,res)=>void middleware(req,res,()=>assert.fail('preview route skipped')));
  server.listen(0,'127.0.0.1');await once(server,'listening');
  t.after(async()=>{release.resolve();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));});
  const req=http.get({hostname:'127.0.0.1',port:server.address().port,path,headers:{Range:'bytes=2-10'}});
  const [response]=await once(req,'response');const chunks=[];response.on('data',chunk=>chunks.push(chunk));
  await started.promise;while(!chunks.length)await tick();
  assert.equal(Buffer.concat(chunks).toString(),'first');assert.equal(response.complete,false);
  assert.equal(response.statusCode,206);assert.equal(options.headers.Range,'bytes=2-10');
  assert.equal(response.headers['content-range'],'bytes 2-10/20');assert.equal(response.headers['accept-ranges'],'bytes');
  assert.equal(response.headers['content-security-policy'],"default-src 'none'");assert.equal(response.headers['cache-control'],'private, max-age=3600');
  release.resolve();await once(response,'end');assert.equal(Buffer.concat(chunks).toString(),'firstlast');
});

test('slow preview consumer applies backpressure without pulling the whole file',{timeout:5000},async()=>{
  let pulls=0,writeCallback;const started=deferred();
  const response=sink((_chunk,_encoding,callback)=>{writeCallback=callback;started.resolve();});
  const body=new ReadableStream({pull(controller){pulls++;controller.enqueue(new Uint8Array(16*1024));if(pulls===128)controller.close();}},{highWaterMark:1});
  const req=request();const operation=sourcePreviewMiddleware('http://127.0.0.1:8791',async()=>new Response(body))(req,response,()=>assert.fail());
  try{
    await started.promise;await tick();await tick();
    assert.ok(pulls<16,'only bounded stream buffers may be pulled while the browser is stalled');
  }finally{response.destroy();writeCallback?.();await operation;}
  assert.equal(body.locked,false);assert.equal(req.listenerCount('aborted'),0);
});

test('leaving a preview cancels a pending upstream fetch and releases listeners',{timeout:5000},async()=>{
  const started=deferred();let aborted=false;
  const req=request(),response=sink();
  const operation=sourcePreviewMiddleware('http://127.0.0.1:8791',async(_url,{signal})=>{
    started.resolve();await new Promise((_,reject)=>signal.addEventListener('abort',()=>{aborted=true;reject(signal.reason);},{once:true}));
  })(req,response,()=>assert.fail());
  await started.promise;response.destroy();await operation;
  assert.ok(aborted);assert.equal(req.listenerCount('aborted'),0);assert.equal(response.listenerCount('close'),0);assert.equal(response.headersSent,undefined);
});

test('leaving a streaming preview cancels its reader and aborts the Runtime request',{timeout:5000},async()=>{
  const started=deferred();let cancelled=false,signal;
  const body=new ReadableStream({start(controller){controller.enqueue(new Uint8Array([1]));},cancel(){cancelled=true;}});
  const req=request(),response=sink((_chunk,_encoding,callback)=>{callback();started.resolve();});
  const operation=sourcePreviewMiddleware('http://127.0.0.1:8791',async(_url,input)=>{signal=input.signal;return new Response(body);})(req,response,()=>assert.fail());
  await started.promise;response.destroy();await operation;
  assert.ok(cancelled);assert.ok(signal.aborted);assert.equal(body.locked,false);assert.equal(req.listenerCount('aborted'),0);
});

test('preview errors report 503 before headers and stop a failed body after headers',async()=>{
  let data='';const response=sink((chunk,_encoding,callback)=>{data+=chunk.toString();callback();});
  await sourcePreviewMiddleware('http://127.0.0.1:8791',async()=>{throw Error('offline');})(request(),response,()=>assert.fail());
  assert.equal(response.status,503);assert.equal(data,'静态预览暂时无法读取。');
  const body=new ReadableStream({pull(controller){controller.error(Error('broken stream'));}}),broken=sink();
  await sourcePreviewMiddleware('http://127.0.0.1:8791',async()=>new Response(body))(request(),broken,()=>assert.fail());
  assert.equal(broken.status,200);assert.ok(broken.destroyed);assert.equal(body.locked,false);
});

test('preview proxy retains the read-only route, origin and path boundaries',async()=>{
  let calls=0,next=0;const middleware=sourcePreviewMiddleware('http://127.0.0.1:8791',async()=>{calls++;return new Response('ok');});
  for(const req of [request({method:'POST'}),request({url:'/api/workbench/data/workspace'}),request({url:path.replace('asset.bin','%2e%2e/secret')}),request({headers:{host:'unrelated.example'}}),request({headers:{host:'localhost:3001',origin:'https://unrelated.example'}})])await middleware(req,sink(),()=>{next++;});
  assert.equal(calls,0);assert.equal(next,5);
  await middleware(request({headers:{host:'localhost:3001',origin:'null'}}),sink(),()=>assert.fail());assert.equal(calls,1);
});
