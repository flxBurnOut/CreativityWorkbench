import test from 'node:test';
import assert from 'node:assert/strict';
import {GET,POST} from '../app/api/workbench/data/[...path]/route.ts';

test('frame, image selection and handoff UI reach only required core routes and keep cross-origin protection',async t=>{
  const fetchBefore=globalThis.fetch;const calls=[];t.after(()=>{globalThis.fetch=fetchBefore;});
  globalThis.fetch=async(url,options)=>{calls.push({url,body:await new Response(options.body).json()});return Response.json({frameAssetId:'derived'});};
  const payload={projectId:'p',requestId:'r',expectedVersion:'a'.repeat(64),objectId:'s',fit:'pad'};
  const invoke=(tool,origin='http://localhost:3002')=>POST(new Request('http://localhost:3002/api/workbench/data/core/'+tool,{method:'POST',headers:{'content-type':'application/json',origin},body:JSON.stringify(payload)}),{params:Promise.resolve({path:['core',tool]})});
  const allowed=['project_get','video_frame_fit','task_complete_handoff','image_select','task_adopt','website_run','workflow_update','craft_generate'];
  for(const tool of allowed)assert.equal((await invoke(tool)).status,200);
  assert.deepEqual(calls[1].body,payload);assert.ok(calls[1].url.endsWith('/v1/core/video_frame_fit'));
  for(const tool of allowed)assert.equal((await invoke(tool,'https://unrelated.example')).status,403);
  assert.equal((await invoke('workbench_call_json')).status,404);assert.equal(calls.length,allowed.length);
});

test('3D downloads and restores traverse the actual page proxy with range and origin protection', async t => {
  const before=globalThis.fetch;t.after(()=>{globalThis.fetch=before;});const id='a'.repeat(64);let calls=0;
  globalThis.fetch=async(url,options)=>{calls++;assert.ok(url.includes('/v1/files/'));if(options.method==='GET')assert.equal(options.headers.Range,'bytes=0-11');return new Response(new Uint8Array(12),{status:206,headers:{'content-type':'application/octet-stream','content-range':'bytes 0-11/20','content-disposition':'attachment; filename="asset.blend"'}});};
  for(const extension of ['blend','glb']) {
    const path=['files',id+'.'+extension];
    const response=await GET(new Request('http://localhost:3001/api/workbench/data/'+path.join('/'),{headers:{range:'bytes=0-11'}}),{params:Promise.resolve({path})});
    assert.equal(response.status,206);assert.equal(response.headers.get('content-range'),'bytes 0-11/20');assert.equal((await response.arrayBuffer()).byteLength,12);
    const restore=['files','restore',id+'.'+extension];
    const request=origin=>new Request('http://localhost:3001/api/workbench/data/'+restore.join('/'),{method:'POST',headers:{origin,'content-type':'application/octet-stream'},body:new Uint8Array(20)});
    assert.equal((await POST(request('http://localhost:3001'),{params:Promise.resolve({path:restore})})).status,206);
    assert.equal((await POST(request('https://unrelated.example'),{params:Promise.resolve({path:restore})})).status,403);
  }
  assert.equal(calls,4);
  assert.equal((await GET(new Request('http://localhost:3001/api/workbench/data/files/script.py'),{params:Promise.resolve({path:['files','script.py']})})).status,404);
});

test('website result uploads stream to the original task and reject cross-origin writes',async t=>{
  const before=globalThis.fetch;t.after(()=>{globalThis.fetch=before;});const payload=new Uint8Array([80,75,3,4]);let calls=0;
  globalThis.fetch=async(url,options)=>{calls++;assert.ok(url.endsWith('/v1/tasks/original/website-result'));assert.deepEqual(new Uint8Array(await new Response(options.body).arrayBuffer()),payload);return Response.json({status:'waiting_external'});};
  const invoke=origin=>POST(new Request('http://localhost:3001/api/workbench/data/tasks/original/website-result',{method:'POST',headers:{origin,'content-type':'application/octet-stream'},body:payload}),{params:Promise.resolve({path:['tasks','original','website-result']})});
  assert.equal((await invoke('http://localhost:3001')).status,200);assert.equal((await invoke('https://elsewhere.example')).status,403);assert.equal(calls,1);
});
