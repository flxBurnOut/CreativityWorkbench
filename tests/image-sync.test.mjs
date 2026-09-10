import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {once} from 'node:events';
import sharp from 'sharp';
import {createProject} from '../lib/workbench/project-core.mjs';
import {createRepository} from '../lib/workbench/repository.mjs';
import {createRuntimeServer} from '../lib/workbench/http-server.mjs';
import {imageBinding,imageInputsMatch,latestImageResults} from '../lib/workbench/image-results.mjs';
import {createTaskPoller} from '../features/creative-flow/task-poller.mjs';

const uid=()=>crypto.randomUUID();
const png=color=>sharp({create:{width:160,height:120,channels:3,background:color}}).png().toBuffer();
async function setup(t) {
  const directory=await mkdtemp(join(tmpdir(),'image-state-sync-')),repo=createRepository(directory);
  const original=await repo.putImage(await png('#1d5a72'));
  const p=createProject('原图改图的实际文件状态验收','website','图片状态同步','image-project');p.stage=3;
  p.assets=[{id:'original',name:'原图',fileId:original.fileId,source:{style:'原始风格'}}];
  p.concepts=[{id:'object-a',name:'骑楼插画',category:'object',description:'已确定的对象',prompt:'旧的出图提示词',revisionRequest:'改为清晰的暖色',savedAssetId:'original'}];
  await repo.saveWorkspace({projects:[p],activeProjectId:p.id},0,uid());let server,base,remoteCalls=0;
  const start=async()=>{server=createRuntimeServer({dataDirectory:directory,env:{},fetchImpl:async()=>{remoteCalls++;throw Error('No provider calls permitted');}});server.listen(0,'127.0.0.1');await once(server,'listening');base='http://127.0.0.1:'+server.address().port;};await start();
  t.after(async()=>{await new Promise(r=>server.close(r));await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:20});assert.equal(remoteCalls,0);});
  const call=async(name,args,expected=200)=>{const r=await fetch(base+'/v1/core/'+name,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(args)});const data=await r.json();assert.equal(r.status,expected,JSON.stringify(data));return data;};
  const get=()=>call('project_get',{projectId:p.id});
  const readTask=async id=>(await fetch(base+'/v1/tasks/'+id)).json();
  const webTasks=async()=>(await (await fetch(base+'/v1/tasks?projectId='+p.id)).json()).tasks;
  const startImage=async(retryOf)=>{const current=await get();return call('task_start',{projectId:p.id,expectedVersion:current.projectVersion,requestId:uid(),kind:'image',args:{action:'edit',objectId:'object-a',provider:'workbuddy',ratio:'1:1'},...(retryOf?{retryOf}:{})});};
  const until=async(id,status)=>{for(let i=0;i<200;i++){const task=await readTask(id);if(task.status===status)return task;if(task.status==='failed')throw Error(task.error);await new Promise(r=>setTimeout(r,10));}throw Error('Did not reach '+status);};
  const finish=async(id,color='#c95a32')=>{const waiting=await until(id,'waiting_external');await writeFile(waiting.handoff.output,await png(color));return until(id,'succeeded');};
  const review=task=>({assetId:task.result.asset.id,parentAssetId:'original',changesVisible:true,preserved:true,notes:'测试图由冷色改为暖色，文件与原图均可见；仅验证交互记录，不证明真实生成质量。',checkedAt:Date.now()});
  return {repo,p,call,get,readTask,webTasks,startImage,until,finish,review,restart:async()=>{await new Promise(r=>server.close(r));await start();}};
}
test('succeeded file appears as an object result before adoption; one selection commits the file and selected state',async t=>{
  const h=await setup(t),started=await h.startImage(),done=await h.finish(started.id);
  let current=await h.get();assert.equal(current.project.concepts[0].savedAssetId,'original');assert.equal(current.project.concepts[0].candidateAssetId,undefined);
  const listed=await h.webTasks();const visible=latestImageResults(current.project,listed)['object-a'];
  assert.equal(visible.asset.id,done.result.asset.id);assert.equal(visible.stale,false);assert.equal(listed[0].imageState.binding,'unbound');
  // WorkBuddy may also have imported these bytes separately into the library.
  await writeFile(join(current.inbox,'generated.png'),await readFile(done.handoff.output));
  await h.call('media_import',{projectId:h.p.id,expectedVersion:current.projectVersion,requestId:uid(),filename:'generated.png',role:'image',name:'单独入库的修改图'});
  current=await h.get();assert.equal(current.project.concepts[0].savedAssetId,'original');assert.equal(latestImageResults(current.project,listed)['object-a'].asset.id,done.result.asset.id);
  const input={projectId:h.p.id,expectedVersion:current.projectVersion,requestId:uid(),objectId:'object-a',taskId:done.id,review:h.review(done)};
  await h.call('image_select',input);assert.equal((await h.call('image_select',input)).replayed,true);
  current=await h.get();assert.equal(current.project.concepts[0].savedAssetId,done.result.asset.id);assert.ok(current.project.assets.some(a=>a.id==='original'));
  const task=await h.call('task_get',{taskId:done.id});assert.equal(task.imageState.binding,'selected');assert.match(task.next,/无需重复采用/);assert.equal(imageBinding(current.project,task),'selected');assert.equal(imageInputsMatch(current.project,await h.readTask(task.id)),true);
});
test('canonical field ordering and own candidate writes do not invalidate results, but real edits and missing review do',async t=>{
  const h=await setup(t),task=await h.finish((await h.startImage()).id);let current=await h.get();
  const reordered=Object.fromEntries(Object.entries(current.project.concepts[0]).reverse());
  await h.call('project_update',{projectId:h.p.id,expectedVersion:current.projectVersion,requestId:uid(),patch:{concepts:[reordered]}});current=await h.get();assert.equal(imageInputsMatch(current.project,task),true);
  await h.call('image_select',{projectId:h.p.id,expectedVersion:current.projectVersion,requestId:uid(),objectId:'object-a',taskId:task.id},409);
  await h.call('task_adopt',{taskId:task.id,expectedVersion:current.projectVersion});current=await h.get();
  const adopted=await h.readTask(task.id);assert.equal(adopted.dismissed,true);assert.equal(adopted.imageState.binding,'candidate');assert.equal(adopted.imageState.stale,false);assert.equal(latestImageResults(current.project,[adopted])['object-a'].task.id,task.id);
  const changed={...current.project.concepts[0],description:'用户后来确定的新对象描述'};
  await h.call('project_update',{projectId:h.p.id,expectedVersion:current.projectVersion,requestId:uid(),patch:{concepts:[changed]}});current=await h.get();
  assert.equal((await h.call('task_get',{taskId:task.id})).imageState.stale,true);
  await h.call('image_select',{projectId:h.p.id,expectedVersion:current.projectVersion,requestId:uid(),objectId:'object-a',taskId:task.id,review:h.review(task)},409);
  assert.equal((await h.get()).project.concepts[0].savedAssetId,'original');
});
test('a candidate adopted through WorkBuddy can be selected without a second candidate adoption',async t=>{
  const h=await setup(t),task=await h.finish((await h.startImage()).id);let current=await h.get();await h.call('task_adopt',{taskId:task.id,expectedVersion:current.projectVersion});current=await h.get();
  await h.call('image_select',{projectId:h.p.id,expectedVersion:current.projectVersion,requestId:uid(),objectId:'object-a',taskId:task.id,review:h.review(task)});
  assert.equal((await h.get()).project.concepts[0].savedAssetId,task.result.asset.id);
});

test('choosing the newest image does not make an older unused result replace its object card',async t=>{
  const h=await setup(t),old=await h.finish((await h.startImage()).id,'#b28922'),latest=await h.finish((await h.startImage()).id);
  let current=await h.get();assert.equal(latestImageResults(current.project,await h.webTasks())['object-a'].task.id,latest.id);
  await h.call('image_select',{projectId:h.p.id,expectedVersion:current.projectVersion,requestId:uid(),objectId:'object-a',taskId:latest.id,review:h.review(latest)});
  current=await h.get();assert.equal(latestImageResults(current.project,await h.webTasks())['object-a'],undefined);
  assert.equal((await h.readTask(old.id)).status,'succeeded');assert.equal(current.project.concepts[0].savedAssetId,latest.result.asset.id);
});
test('explicit retries archive stale waits across restart; late old results never replace the chosen new image',async t=>{
  const h=await setup(t),old=await h.startImage();const waiting=await h.until(old.id,'waiting_external');await h.call('task_cancel',{taskId:old.id});
  const retry=await h.startImage(old.id);await h.until(retry.id,'waiting_external');
  // Simulate an older persisted retry record whose parent was left waiting.
  await h.repo.saveTask({...await h.repo.task(old.id),status:'waiting_external',supersededBy:undefined});await h.restart();
  const previous=await h.call('task_get',{taskId:old.id});assert.equal(previous.status,'superseded');assert.equal(previous.executionStatus,'waiting_external');assert.equal(previous.supersededBy,retry.id);
  const done=await h.finish(retry.id);const current=await h.get();await h.call('image_select',{projectId:h.p.id,expectedVersion:current.projectVersion,requestId:uid(),objectId:'object-a',taskId:done.id,review:h.review(done)});
  await writeFile(waiting.handoff.output,await png('#b28922'));const late=await h.until(old.id,'succeeded');assert.equal(late.supersededBy,retry.id);assert.ok(late.result.asset.fileId);
  const after=await h.get();assert.equal(after.project.concepts[0].savedAssetId,done.result.asset.id);assert.equal(latestImageResults(after.project,(await h.call('task_list',{projectId:h.p.id})).tasks)['object-a'],undefined);
});
test('unlinked tasks are not guessed to be retries; explicit recovery refuses other objects',async t=>{
  const h=await setup(t),old=await h.startImage();await h.until(old.id,'waiting_external');const original=await h.repo.task(old.id);
  await h.repo.saveTask({...original,id:'other-success',status:'succeeded',handoff:undefined,createdAt:original.createdAt+1,result:{asset:{id:'existing',name:'另一任务的文件',fileId:'b'.repeat(64)}}});
  let list=(await h.call('task_list',{projectId:h.p.id})).tasks;assert.equal(list.find(t=>t.id===old.id).status,'waiting_external');
  await h.repo.saveTask({...original,id:'wrong-object',args:{...original.args,objectId:'other'},createdAt:original.createdAt+2,status:'succeeded'});
  await h.call('task_dismiss',{taskId:old.id,replacementTaskId:'wrong-object'},400);
  await h.call('task_dismiss',{taskId:old.id,replacementTaskId:'other-success'});
  list=(await h.call('task_list',{projectId:h.p.id})).tasks;assert.equal(list.find(t=>t.id===old.id).status,'superseded');assert.equal(list.find(t=>t.id===old.id).supersededBy,'other-success');
});
test('task polling deduplicates, cancels hidden/stale requests and ignores out-of-order results',async()=>{
  const requests=[],seen=[],errors=[];
  const poller=createTaskPoller({load:(id,signal)=>new Promise((resolve,reject)=>requests.push({id,signal,resolve,reject})),onData:(data,id)=>seen.push({data,id}),onError:e=>errors.push(e)});
  const first=poller.refresh('a');assert.equal(poller.refresh('a'),first);assert.equal(requests.length,1);
  const fresh=poller.refresh('a',{force:true});assert.equal(requests[0].signal.aborted,true);requests[1].resolve('succeeded');await fresh;requests[0].resolve('waiting_external');await first;assert.deepEqual(seen,[{id:'a',data:'succeeded'}]);
  await poller.refresh('a',{visible:false});assert.equal(requests.length,2);
  const b=poller.refresh('b');poller.cancel();requests[2].resolve('old project');await b;assert.equal(seen.length,1);assert.equal(errors.length,0);
  const manual=poller.refresh('b',{visible:false,force:true});requests[3].resolve('manual');await manual;assert.deepEqual(seen.at(-1),{id:'b',data:'manual'});
});
test('synchronous polling failure releases its slot for the next refresh',async()=>{
  let calls=0;const values=[];const poller=createTaskPoller({load:()=>{if(++calls===1)throw Error('offline');return Promise.resolve('online');},onData:v=>values.push(v),onError:()=>{}});
  await poller.refresh('a');await poller.refresh('a');assert.equal(calls,2);assert.deepEqual(values,['online']);poller.cancel();
});
