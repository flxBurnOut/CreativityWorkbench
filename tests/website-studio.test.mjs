import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {once} from 'node:events';
import {zipSync,strToU8,unzipSync} from 'fflate';
import {createRuntimeServer} from '../lib/workbench/http-server.mjs';
import {websiteStudioState,websiteDispatchMessage,suggestWebsiteMaterials} from '../lib/workbench/website-studio.mjs';
import {projectOutputIds} from '../lib/workbench/output-contract.mjs';
import {videoGoalSpecs,setVideoGoalSpec} from '../lib/workbench/direct-video.mjs';
const uid=()=>crypto.randomUUID();
const site=(title='实际初稿')=>zipSync({'index.html':strToU8('<!doctype html><meta charset="UTF-8"><h1>'+title+'</h1><details><summary>问题</summary>答案</details>'),'style.css':strToU8('body{color:#345}')});
async function setup(t,options={}){
  const directory=await mkdtemp(join(tmpdir(),'website-studio-'));let server,base;let calls=0;
  const start=async()=>{server=createRuntimeServer({dataDirectory:directory,env:options.env||{},fetchImpl:async(...args)=>{calls++;if(options.fetchImpl)return options.fetchImpl(...args);throw Error('No provider');}});server.listen(0,'127.0.0.1');await once(server,'listening');base='http://127.0.0.1:'+server.address().port;};await start();
  t.after(async()=>{await new Promise(r=>server.close(r));await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:30});assert.equal(calls,options.expectedCalls||0);});
  const call=async(name,args,expected=200)=>{const r=await fetch(base+'/v1/core/'+name,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(args)});const data=await r.json();assert.equal(r.status,expected,JSON.stringify(data));return data;};
  const created=await call('project_create',{requestId:uid(),idea:'做一个岭南文化网站',type:'website'}),projectId=created.projectId;
  const get=()=>call('project_get',{projectId});
  const begin=async(extra={})=>{const p=await get();return call('website_run',{projectId,requestId:uid(),expectedVersion:p.projectVersion,goal:'骑楼与满洲窗文化网站，带探索清单',...extra});};
  const until=async(id,status,predicate=()=>true)=>{for(let i=0;i<300;i++){const task=await call('task_get',{taskId:id});if(task.status===status&&predicate(task))return task;if(task.status==='failed')throw Error(task.error);await new Promise(r=>setTimeout(r,20));}throw Error('Timed out '+status);};
  const webTasks=async()=>(await (await fetch(base+'/v1/tasks?projectId='+projectId)).json()).tasks;
  return {directory,call,projectId,get,begin,until,webTasks,url:()=>base,restart:async()=>{await new Promise(r=>server.close(r));await start();}};
}
test('one goal prepares real materials, waits for actual code and returns a preview without intermediate adoption',async t=>{
  const h=await setup(t),before=await h.get();const input={projectId:h.projectId,requestId:uid(),expectedVersion:before.projectVersion,goal:'骑楼与满洲窗文化网站，带探索清单'};
  const started=await h.call('website_run',input),waiting=await h.until(started.id,'waiting_external');assert.equal((await h.call('website_run',input)).id,started.id);
  assert.match(waiting.handoff.output,/result\.zip$/);assert.match(waiting.handoffMessage,/website_complete/);
  let current=await h.get();assert.ok(current.project.assets.length>0);assert.ok(current.project.knowledge.length>0);assert.equal(current.project.websiteSource,undefined);
  assert.equal(websiteStudioState(current.project,await h.webTasks()).phase,'making');
  const taskBundle=unzipSync(await readFile(join(h.directory,'files',waiting.result.websiteRequest.bundleFileId)));assert.ok(taskBundle['KNOWLEDGE.md']);assert.ok(Object.keys(taskBundle).some(n=>n.endsWith('.png')));
  await writeFile(waiting.handoff.output,site());const done=await h.until(started.id,'succeeded');
  for(let i=0;i<50;i++){current=await h.get();if(current.project.websiteSourceCandidate)break;await new Promise(r=>setTimeout(r,10));}
  assert.equal(current.project.websiteSourceCandidate.fileId,done.result.websiteSource.fileId);assert.equal(current.project.websiteSource,undefined);assert.equal(websiteStudioState(current.project,await h.webTasks()).phase,'review');
  await h.call('workflow_update',{projectId:h.projectId,expectedVersion:current.projectVersion,requestId:uid(),action:'adopt-website-source'});
  current=await h.get();assert.equal(current.project.websiteSource.fileId,done.result.websiteSource.fileId);assert.equal(websiteStudioState(current.project,await h.webTasks()).phase,'complete');
});
test('an unselected draft can be revised using its exact ZIP without replacing the current version',async t=>{
  const h=await setup(t),first=await h.begin();const waiting=await h.until(first.id,'waiting_external');await writeFile(waiting.handoff.output,site('第一稿'));await h.until(first.id,'succeeded');
  await h.webTasks();let current=await h.get();const draft=current.project.websiteSourceCandidate;
  const second=await h.begin({change:'把背景改暖一些',scope:'appearance',base:'draft'}),next=await h.until(second.id,'waiting_external');current=await h.get();
  assert.equal(current.project.websiteSource,undefined);assert.equal(current.project.websiteRequest.baseFileId,draft.fileId);
  const entries=unzipSync(await readFile(join(h.directory,'files',next.result.websiteRequest.bundleFileId)));assert.deepEqual(Buffer.from(entries['existing-website.zip']),await readFile(join(h.directory,'files',draft.fileId)));assert.match(next.result.websiteRequest.prompt,/appearance/);assert.ok(projectOutputIds(current.project).includes(draft.fileId));
});
test('manual upload and MCP completion share the original website task and reject conflicting files',async t=>{
  const h=await setup(t),task=await h.begin();await h.until(task.id,'waiting_external');const r=await fetch(h.url()+'/v1/tasks/'+task.id+'/website-result',{method:'POST',headers:{'content-type':'application/octet-stream'},body:site()});assert.equal(r.status,200);const done=await h.until(task.id,'succeeded');
  const current=await h.get();await writeFile(join(current.inbox,'site.zip'),site());assert.equal((await h.call('website_complete',{taskId:task.id,filename:'site.zip'})).result.websiteSource.fileId,done.result.websiteSource.fileId);
  await writeFile(join(current.inbox,'different.zip'),site('另一份'));await h.call('website_complete',{taskId:task.id,filename:'different.zip'},409);
  await h.call('website_complete',{taskId:task.id,filename:'../site.zip'},400);
});
test('late website result survives a restart but never overwrites changed goals or another run',async t=>{
  const h=await setup(t),task=await h.begin();const waiting=await h.until(task.id,'waiting_external');let current=await h.get();
  await h.call('project_update',{projectId:h.projectId,expectedVersion:current.projectVersion,requestId:uid(),patch:{websiteBrief:{...current.project.websiteBrief,goal:'用户刚刚改变了网站主题'}}});await h.restart();await writeFile(waiting.handoff.output,site());const done=await h.until(task.id,'succeeded');await h.webTasks();current=await h.get();
  assert.equal(current.project.websiteSourceCandidate,undefined);assert.ok(done.result.websiteSource.fileId);assert.equal(websiteStudioState(current.project,await h.webTasks()).stale,true);
});
test('unknown themes do not acquire unrelated Lingnan images and failed files never claim a usable website',async t=>{
  assert.equal(suggestWebsiteMaterials('天文观测记录网站').assets.length,0);assert.equal(suggestWebsiteMaterials('客家围屋文化').assets.length,0);
  assert.ok(!suggestWebsiteMaterials('岭南文化网站，不要骑楼。').knowledgeIds.includes('guangzhou-qilou'));
  assert.ok(suggestWebsiteMaterials('骑楼、满洲窗与广彩').assetIds.includes('guangcai-floral'));
  const h=await setup(t),task=await h.begin();await h.until(task.id,'waiting_external');let current=await h.get();await writeFile(join(current.inbox,'invalid.zip'),zipSync({'README.md':strToU8('没有网站')}));await h.call('website_complete',{taskId:task.id,filename:'invalid.zip'},400);assert.equal((await h.call('task_get',{taskId:task.id})).status,'waiting_external');
});
test('run replay after restart finds the original task even after later project edits',async t=>{
  const h=await setup(t),before=await h.get();const input={projectId:h.projectId,requestId:uid(),expectedVersion:before.projectVersion,goal:'岭南文化网站'};const task=await h.call('website_run',input);await h.until(task.id,'waiting_external');
  // Receipt replay must find the same persistent task even after later edits.
  const current=await h.get();await h.call('project_update',{projectId:h.projectId,expectedVersion:current.projectVersion,requestId:uid(),patch:{title:'用户改名'}});await h.restart();assert.equal((await h.call('website_run',input)).id,task.id);assert.equal((await h.webTasks()).length,1);
});

test('restoring a used website version does not resurrect a later accepted result as a new draft',async t=>{
  const h=await setup(t);
  const make=async(title)=>{const task=await h.begin();const waiting=await h.until(task.id,'waiting_external');await writeFile(waiting.handoff.output,site(title));const done=await h.until(task.id,'succeeded');await h.webTasks();const current=await h.get();await h.call('workflow_update',{projectId:h.projectId,expectedVersion:current.projectVersion,requestId:uid(),action:'adopt-website-source'});return done.result.websiteSource;};
  const old=await make('旧版');await make('新版');const current=await h.get();const record=current.project.flow.records.find(r=>r.target==='websiteSource'&&r.value.fileId===old.fileId);
  await h.call('workflow_update',{projectId:h.projectId,expectedVersion:current.projectVersion,requestId:uid(),action:'restore',recordId:record.id});
  const restored=await h.get(),state=websiteStudioState(restored.project,await h.webTasks());assert.equal(state.candidate,undefined);assert.equal(state.preview.fileId,old.fileId);assert.equal(state.phase,'complete');
});

test('a single video description and its visible controls agree on duration and aspect ratio',()=>{
  assert.deepEqual(videoGoalSpecs('一个 2 秒竖屏镜头，固定机位。'),{duration:2,ratio:'9:16',issue:''});
  const changed=setVideoGoalSpec('一个 2 秒横屏镜头：雨后的骑楼。',{duration:8,ratio:'9:16'});
  assert.deepEqual(videoGoalSpecs(changed),{duration:8,ratio:'9:16',issue:''});assert.match(changed,/雨后的骑楼/);
  assert.equal(videoGoalSpecs('前 2 秒抬头，再 3 秒转身。').duration,undefined);
  assert.equal(videoGoalSpecs(setVideoGoalSpec('前 2 秒抬头，再 3 秒转身。',{duration:5})).duration,5);
  assert.match(videoGoalSpecs('一个 30 秒横屏镜头').issue,/2–10/);assert.match(videoGoalSpecs('横屏 9:16').issue,/同时包含/);
});

test('guided retry keeps the old request in history and preserves an unbundled manual prompt',async t=>{
  const h=await setup(t);let current=await h.get();await h.call('project_update',{projectId:h.projectId,expectedVersion:current.projectVersion,requestId:uid(),patch:{websiteRequest:{prompt:'人工写下的完整要求，必须保留。',basis:'legacy-basis',assetIds:[]}}});
  const first=await h.begin();await h.until(first.id,'waiting_external');await h.call('task_cancel',{taskId:first.id});
  const next=await h.begin({retryOf:first.id});await h.until(next.id,'waiting_external');const old=await h.call('task_get',{taskId:first.id});assert.equal(old.supersededBy,next.id);assert.match(old.next,new RegExp(next.id));
  current=await h.get();assert.ok(current.project.flow.records.some(r=>r.target==='websiteRequest'&&r.value.prompt==='人工写下的完整要求，必须保留。'));
});

test('pending modification text survives reload and type switches without invalidating the received draft',async t=>{
  const h=await setup(t),task=await h.begin(),waiting=await h.until(task.id,'waiting_external');await writeFile(waiting.handoff.output,site());await h.until(task.id,'succeeded');await h.webTasks();let current=await h.get();
  await h.call('project_update',{projectId:h.projectId,expectedVersion:current.projectVersion,requestId:uid(),patch:{websiteEdit:{change:'把首页背景调暖',scope:'appearance'}}});
  await h.restart();current=await h.get();assert.equal(current.project.websiteEdit.change,'把首页背景调暖');assert.equal(websiteStudioState(current.project,await h.webTasks()).stale,false);
  let saved=await h.call('project_update',{projectId:h.projectId,expectedVersion:current.projectVersion,requestId:uid(),patch:{type:'novel',studioRevision:'保留人物关系'}});
  await h.call('project_update',{projectId:h.projectId,expectedVersion:saved.projectVersion,requestId:uid(),patch:{type:'website'}});current=await h.get();assert.equal(current.project.websiteEdit.change,'把首页背景调暖');assert.equal(current.project.studioRevision,undefined);
});

test('revision receipt is visible before project sync and a stale poll cannot undo cancellation',()=>{
  const p={id:'p',type:'website',websiteRequest:{taskId:'old'}};
  const old={id:'old',projectId:'p',kind:'website',args:{guided:true},status:'succeeded',updatedAt:1};
  const receipt={...old,id:'new',status:'queued',updatedAt:2};
  assert.equal(websiteStudioState(p,[old],receipt).task.id,'new');
  const waiting={...receipt,status:'waiting_external',dispatch:'manual',handoffMessage:'原任务交接',updatedAt:3};
  const state=websiteStudioState(p,[old,waiting],receipt);
  assert.equal(state.needsHandoff,true);assert.equal(state.canHandoff,true);
  const cancelled={...waiting,status:'cancelled',updatedAt:4};
  assert.equal(websiteStudioState(p,[waiting],cancelled).busy,false);
  assert.equal(websiteStudioState(p,[old],{...receipt,projectId:'someone-else'}).task.id,'old');
});

test('manual, sending, sent and uncertain website requests all expose same-task handoff recovery',()=>{
  const p={id:'p',type:'website',websiteRequest:{taskId:'t'}};
  const task={id:'t',projectId:'p',kind:'website',args:{guided:true},status:'waiting_external',handoffMessage:'继续原任务 t'};
  for(const dispatch of ['manual','conversation','pending','sent']){
    const state=websiteStudioState(p,[{...task,dispatch}]);
    assert.equal(state.canHandoff,true,dispatch);assert.equal(state.busy,true,dispatch);
    assert.ok(websiteDispatchMessage(state.task).length>10);
  }
  const uncertain=websiteStudioState(p,[{...task,status:'uncertain',dispatch:'pending'}]);
  assert.equal(uncertain.canHandoff,true);assert.match(websiteDispatchMessage(uncertain.task),/先在 WorkBuddy 核对原任务/);
  assert.equal(websiteStudioState(p,[{...task,status:'succeeded',dispatch:'sent'}]).canHandoff,false);
});

test('whole-site revision stays editable while waiting and preserves its original request and ZIP',async t=>{
  const h=await setup(t),first=await h.begin(),initial=await h.until(first.id,'waiting_external');await writeFile(initial.handoff.output,site());await h.until(first.id,'succeeded');await h.webTasks();
  let current=await h.get();const original=current.project.websiteSourceCandidate.fileId;
  const task=await h.begin({change:'整站改成温暖的岭南街巷风格',scope:'all',base:'draft',dispatch:'auto'});
  const waiting=await h.until(task.id,'waiting_external',value=>value.dispatch==='manual');current=await h.get();
  assert.equal(waiting.dispatch,'manual');assert.equal(websiteStudioState(current.project,await h.webTasks()).canHandoff,true);
  const bundle=unzipSync(await readFile(join(h.directory,'files',waiting.result.websiteRequest.bundleFileId)));
  assert.deepEqual(Buffer.from(bundle['existing-website.zip']),await readFile(join(h.directory,'files',original)));
  assert.match(waiting.submittedPrompt,/整站改成温暖的岭南街巷风格/);
  await h.call('project_update',{projectId:h.projectId,expectedVersion:current.projectVersion,requestId:uid(),patch:{websiteEdit:{scope:'content',change:'下一轮修改标题'}}});
  await h.restart();await writeFile(waiting.handoff.output,site('修改版'));await h.until(task.id,'succeeded');await h.webTasks();current=await h.get();
  assert.equal(current.project.websiteEdit.change,'下一轮修改标题');assert.equal(current.project.websiteSourceCandidate.taskId,task.id);
  assert.equal(websiteStudioState(current.project,await h.webTasks()).stale,false);
  assert.equal((await h.webTasks()).length,2);
});

test('an uncertain automatic send keeps a recoverable handoff and replays without resending',async t=>{
  const h=await setup(t,{env:{WORKBUDDY_ACCESS_TOKEN:'controlled-test-token'},expectedCalls:1,fetchImpl:async()=>{throw Error('controlled connection interrupted');}});
  const current=await h.get(),input={projectId:h.projectId,requestId:uid(),expectedVersion:current.projectVersion,goal:'岭南文旅网站',dispatch:'auto'};
  const task=await h.call('website_run',input),uncertain=await h.until(task.id,'uncertain');
  assert.ok(uncertain.handoffMessage);assert.equal(websiteStudioState((await h.get()).project,await h.webTasks()).canHandoff,true);
  assert.equal((await h.call('website_run',input)).id,task.id);assert.equal((await h.webTasks()).length,1);
});
