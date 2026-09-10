import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {createServer,request} from 'node:http';
import fs,{writeFile,readFile,readdir} from 'node:fs/promises';
import {syncBuiltinESMExports} from 'node:module';
import {join} from 'node:path';
import {createRuntimeServer} from '../lib/workbench/http-server.mjs';
import {createRuntimeClient,openRuntimeLog} from '../lib/workbench/mcp-runtime.mjs';
import {createTestDirectory,closeTestServer,stopTestProcess} from './helpers/test-directory.mjs';

test('shutdown waits for an aborted generation adapter before fixture removal',async t=>{
  const scope=await createTestDirectory(t,'shutdown');let finishStarted,finished=false;
  const started=new Promise(resolve=>{finishStarted=resolve;});
  const server=createRuntimeServer({dataDirectory:scope.directory,env:{WORKBUDDY_ACCESS_TOKEN:'test-only'},fetchImpl:async(_url,{signal})=>{
    finishStarted();return new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>setTimeout(()=>{finished=true;reject(Error('stopped'));},20),{once:true}));
  }});
  scope.defer(()=>closeTestServer(server));server.listen(0,'127.0.0.1');await once(server,'listening');
  const call=async(name,args)=>{const r=await fetch('http://127.0.0.1:'+server.address().port+'/v1/core/'+name,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(args)});assert.equal(r.status,200);return r.json();};
  const p=await call('project_create',{requestId:crypto.randomUUID(),idea:'关闭验证网站',type:'website'});
  await call('website_run',{projectId:p.projectId,expectedVersion:p.projectVersion,requestId:crypto.randomUUID(),goal:'关闭验证',autoAssets:false,dispatch:'auto'});
  await started;const shuttingDown=server.shutdown();assert.equal(server.shutdown(),shuttingDown);
  await shuttingDown;assert.equal(finished,true);assert.equal(server.listening,false);
});

test('a disconnected direct media import finishes before shutdown allows its fixture to be removed',async t=>{
  const scope=await createTestDirectory(t,'disconnected-import');
  const server=createRuntimeServer({dataDirectory:scope.directory,env:{}});
  scope.defer(()=>closeTestServer(server));
  let entered,release,finished=false,socketClosed,disposed=false;
  const started=new Promise(resolve=>{entered=resolve;});
  const pending=new Promise(resolve=>{release=resolve;});
  const originalWrite=fs.writeFile;
  // Exercise the actual HTTP import and render-file path, pausing its disk
  // write before any decoder is launched. No real provider or large media.
  fs.writeFile=async(path,data,...options)=>{
    if(String(path).startsWith(join(scope.directory,'render'))&&String(path).endsWith('input.bin')) {
      await originalWrite(path,data,...options);entered();await pending;
      await originalWrite(join(scope.directory,'handler-finished.txt'),'finished');finished=true;
      throw Error('controlled stop before decoding');
    }
    return originalWrite(path,data,...options);
  };
  syncBuiltinESMExports();
  let disposal,client;
  try {
    server.once('connection',socket=>{socketClosed=new Promise(resolve=>socket.once('close',resolve));});
    server.listen(0,'127.0.0.1');await once(server,'listening');
    client=request({hostname:'127.0.0.1',port:server.address().port,path:'/v1/files/mp4',method:'POST',headers:{'content-type':'video/mp4'}});
    client.on('error',()=>{});client.end(Buffer.from('0000ftyp0000'));
    let deadline;
    try {await Promise.race([started,new Promise((_,reject)=>{deadline=setTimeout(()=>reject(Error('direct import did not start')),3000);})]);}
    finally {clearTimeout(deadline);}
    client.destroy();await socketClosed;
    disposal=scope.dispose().then(()=>{disposed=true;});
    await new Promise(resolve=>setTimeout(resolve,30));
    assert.equal(disposed,false,'closed sockets do not mean a direct import has finished');
    assert.ok((await readdir(scope.directory)).includes('render'),'the fixture must remain until its handler drains');
  } finally {
    client?.destroy();release();fs.writeFile=originalWrite;syncBuiltinESMExports();
    await (disposal||closeTestServer(server));
  }
  assert.equal(finished,true);
  await assert.rejects(readdir(scope.directory),error=>error.code==='ENOENT');
});

test('launch log rotation preserves the newest three archives and starts an empty log',async t=>{
  const scope=await createTestDirectory(t,'runtime-log');const path=join(scope.directory,'runtime.log');
  await writeFile(path,Buffer.alloc(5*1024*1024,65));await writeFile(path+'.1','previous');await writeFile(path+'.2','older');await writeFile(path+'.3','expired');
  const handle=await openRuntimeLog(scope.directory);await handle.writeFile('new');await handle.close();
  assert.equal(await readFile(path,'utf8'),'new');assert.equal((await readFile(path+'.1')).length,5*1024*1024);
  assert.equal(await readFile(path+'.2','utf8'),'previous');assert.equal(await readFile(path+'.3','utf8'),'older');
  assert.equal((await readdir(scope.directory)).length,4);
});

test('failed startup stops only its newly launched Runtime',async t=>{
  const scope=await createTestDirectory(t,'failed-runtime');let checks=0;
  const reservation=createServer();scope.defer(()=>closeTestServer(reservation));reservation.listen(0,'127.0.0.1');await once(reservation,'listening');
  const port=reservation.address().port;await closeTestServer(reservation);
  const runtime=createRuntimeClient({env:{WORKBENCH_RUNTIME_URL:'http://127.0.0.1:'+port,WORKBENCH_DATA_DIR:scope.directory},autoStart:true,fetchImpl:async()=>{
    if(++checks===1)throw Error('not listening');return Response.json({workbench:'unexpected'});
  }});
  scope.defer(()=>stopTestProcess(runtime.startedPid));
  await assert.rejects(runtime.ensure(),e=>e.code==='runtime_mismatch');assert.ok(runtime.startedPid);
  let gone=false;for(let i=0;i<100;i++){try{process.kill(runtime.startedPid,0);}catch(e){if(e.code==='ESRCH'){gone=true;break;}throw e;}await new Promise(resolve=>setTimeout(resolve,10));}
  assert.equal(gone,true,'a failed startup must not leave a detached server');
});
