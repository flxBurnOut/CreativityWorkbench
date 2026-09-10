import test from 'node:test';
import assert from 'node:assert/strict';
import {POST} from '../app/api/workbench/data/[...path]/route.ts';

test('frame, image selection and handoff UI reach only required core routes and keep cross-origin protection',async t=>{
  const fetchBefore=globalThis.fetch;const calls=[];t.after(()=>{globalThis.fetch=fetchBefore;});
  globalThis.fetch=async(url,options)=>{calls.push({url,body:await new Response(options.body).json()});return Response.json({frameAssetId:'derived'});};
  const payload={projectId:'p',requestId:'r',expectedVersion:'a'.repeat(64),objectId:'s',fit:'pad'};
  const invoke=(tool,origin='http://localhost:3002')=>POST(new Request('http://localhost:3002/api/workbench/data/core/'+tool,{method:'POST',headers:{'content-type':'application/json',origin},body:JSON.stringify(payload)}),{params:Promise.resolve({path:['core',tool]})});
  const allowed=['project_get','video_frame_fit','task_complete_handoff','image_select','task_adopt'];
  for(const tool of allowed)assert.equal((await invoke(tool)).status,200);
  assert.deepEqual(calls[1].body,payload);assert.ok(calls[1].url.endsWith('/v1/core/video_frame_fit'));
  for(const tool of allowed)assert.equal((await invoke(tool,'https://unrelated.example')).status,403);
  assert.equal((await invoke('workbench_call_json')).status,404);assert.equal(calls.length,allowed.length);
});
