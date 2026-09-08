import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp,readFile,writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import sharp from 'sharp';
import { createRepository } from '../lib/workbench/repository.mjs';
import { createTaskManager } from '../lib/workbench/tasks.mjs';
import { taskSource } from '../lib/workbench/task-contract.mjs';
import { createProject } from '../features/projects/model.ts';
import { applyTaskResult } from '../features/creative-flow/task-results.ts';
import { createRuntimeServer } from '../lib/workbench/http-server.mjs';
import { POST as proxyPost } from '../app/api/workbench/data/[...path]/route.ts';

const project = () => createProject('当代岭南街区的一封信，写一个有结尾的短篇。','novel','岭南短篇');
const workspace = p => ({projects:[p],activeProjectId:p.id});
const request = (p,kind,args={}) => ({id:randomUUID(),projectId:p.id,kind,args,source:taskSource(p,kind,args)});
const response = value => Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify(value)}}]});
async function setup(){const directory=await mkdtemp(join(tmpdir(),'creative-workbench-test-'));const repo=createRepository(directory);return {directory,repo};}
async function until(manager,id,status='succeeded'){
  for(let i=0;i<200;i++){const task=await manager.get(id);if(task.status===status)return task;if(task.status==='failed'&&status!=='failed')throw new Error(task.error);await new Promise(r=>setTimeout(r,10));}
  throw new Error('task timeout');
}
async function png(color='green'){return sharp({create:{width:16,height:16,channels:4,background:color}}).png().toBuffer();}

test('workspace commits are durable, idempotent and reject stale tabs and corrupt snapshots',async()=>{
  const{repo,directory}=await setup();const p=project();const ws=workspace(p);const id=randomUUID();
  assert.equal(await repo.saveWorkspace(ws,0,id),1);assert.equal(await repo.saveWorkspace(ws,0,id),1);
  assert.equal((await createRepository(directory).loadWorkspace()).workspace.projects[0].idea,p.idea);
  await assert.rejects(repo.saveWorkspace({...ws,activeProjectId:null},0,randomUUID()),e=>e.status===409);
  await assert.rejects(repo.saveWorkspace({...ws,activeProjectId:null},1,id),e=>e.status===409);
  p.brief='新稿';assert.equal(await repo.saveWorkspace(workspace(p),1,randomUUID()),2);
  assert.equal(JSON.parse(await readFile(join(directory,'workspace.previous.json'),'utf8')).revision,1);
  await writeFile(join(directory,'workspace.json'),'{bad');await assert.rejects(repo.loadWorkspace(),e=>e.code==='storage_error');
});

test('real images are decoded, immutable by hash and retained across reference removal',async()=>{
  const{repo}=await setup();const first=await repo.putImage(await png());
  assert.equal((await sharp(await repo.media(first.fileId)).metadata()).width,16);
  assert.equal((await repo.putImage(await png())).fileId,first.fileId);
  await assert.rejects(repo.putImage(Buffer.from('not an image')),e=>e.code==='invalid_image');
  await assert.rejects(repo.media('../secret'),e=>e.status===400);
  const p=project();p.assets=[{id:'asset-1',name:'原图',fileId:first.fileId}];p.coverAssetId='asset-1';
  await repo.saveWorkspace(workspace(p),0,randomUUID());p.coverAssetId=undefined;p.assets=[];
  await repo.saveWorkspace(workspace(p),1,randomUUID());assert.ok((await repo.media(first.fileId)).length);
});

test('concurrent readers see complete task files while status is replaced',async()=>{
  const{repo}=await setup();const id=randomUUID();await repo.saveTask({id,step:0});
  await Promise.all([
    (async()=>{for(let i=1;i<=20;i++)await repo.saveTask({id,step:i});})(),
    (async()=>{for(let i=0;i<40;i++)assert.ok(Number.isInteger((await repo.task(id)).step));})(),
    (async()=>{for(let i=0;i<40;i++)assert.equal((await repo.listTasks())[0].id,id);})(),
  ]);
  assert.equal((await repo.task(id)).step,20);
});

test('a rejected WorkBuddy dispatch can finish through explicit manual handoff',async()=>{
  const{repo}=await setup();const p=project();await repo.saveWorkspace(workspace(p),0,randomUUID());
  const manager=createTaskManager(repo,{env:{WORKBUDDY_ACCESS_TOKEN:'test'},fetchImpl:async()=>new Response('',{status:401})});
  const input=request(p,'cover',{provider:'workbuddy',ratio:'1:1'});await manager.submit(input);
  let task;
  for(let i=0;i<100;i++){task=await manager.get(input.id);if(task.dispatch==='manual')break;await new Promise(r=>setTimeout(r,10));}
  assert.equal(task.status,'waiting_external');assert.equal(task.dispatch,'manual');assert.match(task.error,/手动交接/);
  await writeFile(task.handoff.output,await png());const done=await manager.get(input.id);assert.equal(done.status,'succeeded');assert.equal(done.error,undefined);
});

test('short story generation respects delivery notes and exports editable content',async()=>{
  const{repo}=await setup();const p=project();p.delivery.notes='结尾保留归还旧信的场景。';await repo.saveWorkspace(workspace(p),0,randomUUID());
  const body='固定模拟正文，不是模型实测作品。'.repeat(15);
  const manager=createTaskManager(repo,{env:{DEEPSEEK_API_KEY:'test'},fetchImpl:async(_url,init)=>{
    assert.match(JSON.parse(init.body).messages[1].content,/结尾保留归还旧信的场景/);
    return response({title:'模拟短篇',text:body,complete:true});
  }});
  const input=request(p,'novel',{action:'generate'});await manager.submit(input);const next=applyTaskResult(p,await until(manager,input.id));
  assert.equal(next.novel.text,body);assert.equal(next.novel.taskId,input.id);assert.equal(p.novel,undefined);
});

test('text tasks persist before generation, deduplicate, and refuse stale adoption',async()=>{
  const{repo,directory}=await setup();const p=project();await repo.saveWorkspace(workspace(p),0,randomUUID());let calls=0;
  const manager=createTaskManager(repo,{env:{DEEPSEEK_API_KEY:'test'},fetchImpl:async(_url,init)=>{calls++;const body=JSON.parse(init.body);assert.equal(body.response_format.type,'json_object');return response({sections:{story:'完整梗概',characters:'人物',world:'当代广府',chapters:'开头与结尾',voice:'平实'}});}});
  const input=request(p,'content',{action:'generate'});await manager.submit(input);await manager.submit(input);
  const task=await until(manager,input.id);assert.equal(calls,1);assert.equal((await createRepository(directory).task(input.id)).status,'succeeded');
  assert.equal(applyTaskResult(p,task).content.novel.story,'完整梗概');
  assert.throws(()=>applyTaskResult({...p,brief:'后来修改的内容'},task),/生成依据已改变/);
  await assert.rejects(manager.submit({...input,args:{action:'check'}}),e=>e.status===409);
});

test('section and selection edits only replace their targets, art and objects have validated outputs',async()=>{
  const{repo}=await setup();let p=project();p.content.novel.story='保留开头。修改中间。保留结尾。';p.requests[1]='温柔一点';
  let rev=await repo.saveWorkspace(workspace(p),0,randomUUID());let value={replacement:'温柔中间。'};
  const manager=createTaskManager(repo,{env:{DEEPSEEK_API_KEY:'test'},fetchImpl:async()=>response(value)});
  const input=request(p,'content',{action:'selection',key:'story',start:5,end:10,selectedText:'修改中间。'});
  await manager.submit(input);let task=await until(manager,input.id);p=applyTaskResult(p,task);assert.equal(p.content.novel.story,'保留开头。温柔中间。保留结尾。');
  rev=await repo.saveWorkspace(workspace(p),rev,randomUUID());value={direction:'柔和',material:'纸感',palette:'青绿',constraints:'保留地域',fullPrompt:'完整的岭南概念图提示词'};
  const art=request(p,'art');await manager.submit(art);task=await until(manager,art.id);p=applyTaskResult(p,task);assert.equal(p.art.fullPrompt,value.fullPrompt);
  await repo.saveWorkspace(workspace(p),rev,randomUUID());value={objects:[{category:'object',name:'旧信',description:'故事中的旧信'}]};
  const objects=request(p,'objects');await manager.submit(objects);task=await until(manager,objects.id);assert.equal(applyTaskResult(p,task).concepts[0].name,'旧信');
});

test('missing keys and malformed model output fail honestly without fabricated results',async()=>{
  const{repo}=await setup();const p=project();await repo.saveWorkspace(workspace(p),0,randomUUID());let calls=0;
  const manager=createTaskManager(repo,{env:{},fetchImpl:async()=>{calls++;return response({});}});
  const input=request(p,'art');await manager.submit(input);const task=await until(manager,input.id,'failed');assert.equal(calls,0);assert.equal(task.code,'not_configured');assert.equal(task.result,undefined);
  const other=createTaskManager(repo,{env:{DEEPSEEK_API_KEY:'test'},fetchImpl:async()=>Response.json({choices:[{finish_reason:'length',message:{content:'{}'}}]})});
  const novel=request(p,'novel',{action:'generate'});await other.submit(novel);assert.equal((await until(other,novel.id,'failed')).code,'incomplete_response');
});

test('uncertain delivery never triggers an automatic replacement request',async()=>{
  const{repo}=await setup();const p=project();await repo.saveWorkspace(workspace(p),0,randomUUID());let calls=0;
  const manager=createTaskManager(repo,{env:{DEEPSEEK_API_KEY:'test',WORKBUDDY_ACCESS_TOKEN:'test'},fetchImpl:async(url)=>{
    calls++;if(String(url).includes('workbuddy.cn'))return new Response('',{status:503});throw new TypeError('simulated connection reset');
  }});
  const creative=request(p,'creative',{action:'improve'});await manager.submit(creative);assert.equal((await until(manager,creative.id,'uncertain')).code,'uncertain');
  await manager.submit(creative);assert.equal(calls,1);
  const cover=request(p,'cover',{provider:'workbuddy',ratio:'1:1'});await manager.submit(cover);const task=await until(manager,cover.id,'uncertain');
  assert.notEqual(task.dispatch,'manual');assert.equal(calls,2);
});

test('external edits upload the actual original image and carry the original style',async()=>{
  const{repo}=await setup();const image=await repo.putImage(await png());const p=project();p.art.fullPrompt='新的风格';p.assets=[{id:'original',name:'原图',fileId:image.fileId,source:{style:'原来的手绘风格'}}];
  p.concepts=[{id:'object-1',category:'object',name:'信封',description:'米色信封',candidateAssetId:'original',savedAssetId:'original',prompt:'旧提示词',revisionRequest:'变成蓝色'}];
  await repo.saveWorkspace(workspace(p),0,randomUUID());let calls=0;
  const manager=createTaskManager(repo,{env:{IMAGE_API_KEY:'test'},fetchImpl:async(url,init)=>{calls++;assert.ok(String(url).endsWith('/images/edits'));assert.ok(init.body instanceof FormData);const image=init.body.getAll('image[]')[0];assert.ok((await image.arrayBuffer()).byteLength);assert.match(init.body.get('prompt'),/原来的手绘风格/);assert.match(init.body.get('prompt'),/变成蓝色/);return Response.json({data:[{b64_json:(await png('blue')).toString('base64')}]});}});
  const input=request(p,'image',{action:'edit',objectId:'object-1',provider:'external',ratio:'1:1'});await manager.submit(input);const task=await until(manager,input.id);assert.equal(calls,1);
  const next=applyTaskResult(p,task);assert.equal(next.concepts[0].savedAssetId,'original');assert.notEqual(next.concepts[0].candidateAssetId,'original');assert.equal(next.assets.length,2);
});

test('WorkBuddy sends the documented message, imports assigned output, and resumes after restart',async()=>{
  const{repo,directory}=await setup();const p=project();p.concepts=[{id:'object-1',category:'object',name:'葵扇',description:'用户提供的参考物件',prompt:'',revisionRequest:''}];await repo.saveWorkspace(workspace(p),0,randomUUID());let calls=0;
  const manager=createTaskManager(repo,{env:{WORKBUDDY_ACCESS_TOKEN:'test'},fetchImpl:async(url,init)=>{calls++;assert.equal(url,'https://www.workbuddy.cn/openapi/v2/localassistant/message');const body=JSON.parse(init.body);assert.equal(body.msg_type,'text');assert.match(body.content,/request.json/);return Response.json({code:0,data:{message_id:'msg-test'}});}});
  const input=request(p,'image',{action:'generate',objectId:'object-1',provider:'workbuddy',ratio:'1:1'});await manager.submit(input);let task;
  for(let i=0;i<100;i++){task=await manager.get(input.id);if(task.dispatch==='sent')break;await new Promise(r=>setTimeout(r,10));}
  assert.equal(task.dispatch,'sent');assert.equal(calls,1);
  const reopened=createTaskManager(createRepository(directory));await writeFile(task.handoff.output,await png());
  const done=await reopened.get(input.id);assert.equal(done.status,'succeeded');assert.ok(done.result.asset.fileId);
});

test('manual WorkBuddy handoff is explicit and cancelled tasks ignore late pictures',async()=>{
  const{repo}=await setup();const p=project();await repo.saveWorkspace(workspace(p),0,randomUUID());const manager=createTaskManager(repo,{env:{}});
  const input=request(p,'cover',{provider:'workbuddy',ratio:'1:1'});await manager.submit(input);let task=await until(manager,input.id,'waiting_external');
  for(let i=0;i<100&&task.dispatch!=='manual';i++){await new Promise(r=>setTimeout(r,10));task=await manager.get(input.id);}
  assert.equal(task.dispatch,'manual');assert.equal(task.result,undefined);await manager.cancel(input.id);await writeFile(task.handoff.output,await png());assert.equal((await manager.get(input.id)).status,'cancelled');
  await manager.dismiss(input.id);assert.equal((await manager.get(input.id)).dismissed,true);
});

test('interrupted tasks become uncertain on restart and are not automatically resubmitted',async()=>{
  const{repo}=await setup();const p=project();await repo.saveWorkspace(workspace(p),0,randomUUID());const input=request(p,'art');
  await repo.saveTask({...input,snapshot:p,status:'running',createdAt:Date.now()});let calls=0;
  const manager=createTaskManager(repo,{fetchImpl:async()=>{calls++;return response({});}});
  assert.equal((await manager.get(input.id)).status,'uncertain');assert.equal(calls,0);
  await assert.rejects(manager.submit(request(p,'art')),e=>e.code==='pending_task');
});

test('HTTP saves projects and media, and both server layers reject cross-origin writes',async()=>{
  const{directory}=await setup();const server=createRuntimeServer({dataDirectory:directory,env:{}});server.listen(0,'127.0.0.1');await once(server,'listening');
  try{
    const base='http://127.0.0.1:'+server.address().port;
    const p=project();let r=await fetch(base+'/v1/workspace',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({workspace:workspace(p),expectedRevision:0,writeId:randomUUID()})});assert.equal(r.status,200);
    r=await fetch(base+'/v1/workspace');assert.equal((await r.json()).workspace.projects[0].id,p.id);
    r=await fetch(base+'/v1/media',{method:'POST',headers:{'Content-Type':'image/png'},body:await png()});assert.equal(r.status,201);
    r=await fetch(base+'/v1/workspace',{headers:{Origin:'https://evil.example'}});assert.equal(r.status,403);
    const denied=await proxyPost(new Request('http://localhost/api/workbench/data/workspace',{method:'PUT',headers:{Origin:'https://evil.example','Content-Type':'application/json'},body:'{}'}),{params:Promise.resolve({path:['workspace']})});assert.equal(denied.status,403);
  }finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
});
