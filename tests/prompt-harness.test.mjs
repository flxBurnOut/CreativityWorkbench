import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { unzipSync, strFromU8 } from 'fflate';
import { createProject, applyTaskResult } from '../lib/workbench/project-core.mjs';
import { createRepository, digest } from '../lib/workbench/repository.mjs';
import { createTaskManager } from '../lib/workbench/tasks.mjs';
import { createCoreService } from '../lib/workbench/core-service.mjs';
import { taskSource } from '../lib/workbench/task-contract.mjs';
import { shotSource, audioSource, composeSource, projectOutputIds } from '../lib/workbench/output-contract.mjs';
import { normalizeSavedAssets, parseStoredWorkspace } from '../features/projects/model.ts';
import { assetRoles, buildVideoPrompt, videoPromptBasis, buildWebsitePrompt, websitePromptBasis, websiteRequestSource, CULTURAL_RULES, TYPE_RULES } from '../lib/workbench/prompts.mjs';

const uid = () => randomUUID();
const ws = p => ({ projects:[p],activeProjectId:p.id });
const shot = () => ({id:'shot-a',title:'修伞人',visual:'阿澄打开一把旧伞，水珠落下',camera:'固定中景',duration:5,narration:'',subtitle:'',revision:''});
const request = (p,kind,args={}) => ({id:uid(),projectId:p.id,kind,args,source:taskSource(p,kind,args)});
async function setup(t,type='video',options={}) {
  const directory=await mkdtemp(join(tmpdir(),'prompt-harness-'));const repo=createRepository(directory);
  const p=createProject('当代岭南街区的修伞人',type,'提示词测试');
  p.culture='已确定：当代潮汕生活环境。虚构：人物阿澄。待核实：具体旧伞工艺年代，不宣称真实历史。';
  p.art={direction:'现代写实',material:'棉布与竹柄',palette:'雨后自然冷光',constraints:'无灯笼，无古装',fullPrompt:'旧综合稿：暖金光'};
  if(type==='video')p.video={ratio:'16:9',shots:[shot()],burnSubtitles:false,keepAudio:false};
  await repo.saveWorkspace(ws(p),0,uid());
  const tasks=createTaskManager(repo,{env:{},...options});const core=createCoreService(repo,tasks,{env:{},...options});
  t.after(async()=>{await tasks.stop();await rm(directory,{recursive:true,force:true});});
  return {p,repo,tasks,core,directory};
}
async function until(tasks,id,status='succeeded') {
  for(let i=0;i<300;i++) {const task=await tasks.get(id);if(task.status===status)return task;if(['failed','uncertain'].includes(task.status))throw new Error(JSON.stringify(task));await new Promise(r=>setTimeout(r,10));}
  throw new Error('task timeout');
}
async function addImages(p,repo) {
  const image=await repo.putImage(await sharp({create:{width:12,height:12,channels:3,background:'red'}}).png().toBuffer());
  p.assets=[{id:'style',name:'只参考光线',fileId:image.fileId},{id:'selected',name:'阿澄概念图',fileId:image.fileId},{id:'candidate',name:'未采用候选',fileId:image.fileId}];
  p.references=[{id:'ref',assetId:'style',purpose:'只参考雨后光线，不复制人物和地域'}];
  p.concepts=[{id:'person',name:'阿澄',category:'character',description:'现代衬衫，保留旧伞竹柄',savedAssetId:'selected',candidateAssetId:'candidate',prompt:'',revisionRequest:''}];
}

test('text stages submit the same cultural contract with type-specific instructions and unchanged source facts',async t=>{
  const bodies=[];
  const {p,repo,tasks}=await setup(t,'novel',{env:{DEEPSEEK_API_KEY:'test'},fetchImpl:async(_url,options)=>{
    const body=JSON.parse(options.body);bodies.push(body);
    return Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify({notes:'只核实工艺年代，保留阿澄与当代背景。'})}}]});
  }});
  p.content.novel.story='阿澄收到编号 Q-027 的旧伞，编号不得修改。';await repo.saveWorkspace(ws(p),1,uid());
  const input=request(p,'content',{action:'check'});await tasks.submit(input);const task=await until(tasks,input.id);
  const messages=bodies[0].messages;
  assert.ok(messages[0].content.includes(CULTURAL_RULES));assert.ok(messages[0].content.includes(TYPE_RULES.novel));
  const data=JSON.parse(messages[1].content);assert.equal(data.culture,p.culture);assert.equal(data.content.story,p.content.novel.story);
  assert.deepEqual(task.submittedPrompt,messages);assert.equal((await repo.loadWorkspace()).workspace.projects[0].content.novel.story,p.content.novel.story);
});

test('concept handoff carries independent art constraints and actual image roles without changing the original',async t=>{
  let calls=0;const {p,repo,tasks}=await setup(t,'video',{fetchImpl:async()=>{calls++;throw new Error('No dispatch');}});
  await addImages(p,repo);p.concepts[0].revisionRequest='只改伞面为深蓝';p.assets[2].source={style:'原图铅笔风格'};
  await repo.saveWorkspace(ws(p),1,uid());
  const input=request(p,'image',{objectId:'person',action:'edit',provider:'workbuddy',ratio:'3:2',handoffOnly:true});await tasks.submit(input);
  const task=await until(tasks,input.id,'waiting_external');const handoff=JSON.parse(await readFile(task.handoff.requestPath,'utf8'));
  assert.equal(handoff.prompt,task.submittedPrompt);assert.ok(handoff.prompt.includes(p.art.palette));assert.ok(handoff.prompt.includes(p.art.constraints));
  assert.ok(handoff.prompt.includes(p.references[0].purpose));assert.ok(handoff.prompt.includes(p.concepts[0].revisionRequest));assert.ok(handoff.prompt.includes('原图铅笔风格'));
  assert.equal(handoff.inputImages.length,2);assert.deepEqual(await readFile(handoff.inputImages[0]),await repo.media(p.assets[2].fileId));
  assert.deepEqual((await repo.loadWorkspace()).workspace.projects[0].concepts,p.concepts);assert.equal(calls,0);
});

test('single-shot edited prompt is sent byte-for-byte; unrelated edits remain adoptable and cultural/image changes invalidate it',async t=>{
  const sent=[];const {p,repo,tasks}=await setup(t,'video',{env:{VIDEO_API_KEY:'test'},fetchImpl:async(_url,options)=>{sent.push(JSON.parse(options.body));return Response.json({id:'shot-job'});}});
  await addImages(p,repo);const s=p.video.shots[0];s.referenceAssetId='selected';
  const prepared=buildVideoPrompt(p,s);assert.ok(prepared.includes(p.culture));assert.ok(prepared.includes(p.art.palette));assert.ok(prepared.includes(p.concepts[0].description));
  s.prompt='当代潮汕虚构人物阿澄，保持参考首帧的现代衬衫与竹柄旧伞。固定中景中缓缓开伞，5秒，雨后冷光，不加古装。';s.promptBasis=videoPromptBasis(p,s);
  await repo.saveWorkspace(ws(p),1,uid());const input=request(p,'video-shot',{objectId:s.id,provider:'external'});
  await tasks.submit(input);const task=await until(tasks,input.id,'waiting_provider');assert.equal(sent.length,1);assert.equal(sent[0].promptText,s.prompt);assert.equal(task.submittedPrompt,s.prompt);assert.equal(sent[0].duration,5);assert.ok(sent[0].promptImage.startsWith('data:image/png;base64,'));
  const changed=structuredClone(p);changed.title='仅改项目导航名称';changed.content.website.goal='与本镜头无关';changed.video.shots.push({...shot(),id:'other'});
  assert.equal(taskSource(changed,'video-shot',input.args),input.source);
  changed.culture='未来客家虚构空间';assert.notEqual(taskSource(changed,'video-shot',input.args),input.source);
  const newer=structuredClone(p);newer.assets[1].fileId='f'.repeat(64);assert.notEqual(shotSource(newer.video.shots[0],newer.video.ratio,newer),shotSource(s,p.video.ratio,p));
  const audio=audioSource(s,p);const differentVoice=structuredClone(p);differentVoice.content.video.voiceover='轻声叙述';assert.notEqual(audioSource(s,differentVoice),audio);
  assert.notEqual(composeSource(p.video,newer),composeSource(p.video,p));
  assert.throws(()=>applyTaskResult(changed,{...task,status:'succeeded',result:{videoClip:{fileId:'a'.repeat(64)+'.mp4',duration:5,source:shotSource(s,p.video.ratio,p)}}}),/生成依据已改变/);
});

test('stale or oversized single-shot prompt is rejected before any provider request',async t=>{
  let calls=0;const {p,repo,tasks}=await setup(t,'video',{fetchImpl:async()=>{calls++;throw new Error('must not call');}});const s=p.video.shots[0];
  s.prompt='编辑稿';s.promptBasis=videoPromptBasis(p,s);p.art.palette='新的冷光要求';await repo.saveWorkspace(ws(p),1,uid());
  await assert.rejects(tasks.submit(request(p,'video-shot',{objectId:s.id,provider:'external'})),e=>e.code==='stale_prompt');
  s.promptBasis=videoPromptBasis(p,s);s.prompt='字'.repeat(1001);await repo.saveWorkspace(ws(p),2,uid());
  await assert.rejects(tasks.submit(request(p,'video-shot',{objectId:s.id,provider:'external'})),e=>e.code==='prompt_too_long');assert.equal(calls,0);
});

test('website bundle preserves custom prompt, separates reference-only assets, avoids template generation and survives backup',async t=>{
  let calls=0;const {p,repo,tasks,core}=await setup(t,'website',{fetchImpl:async()=>{calls++;throw new Error('must not call');}});
  await addImages(p,repo);p.content.website.behavior='作品拖拽排序，键盘可操作；完整实现代码，不限工作台模板。';
  const roles=assetRoles(p);assert.deepEqual(roles.map(r=>[r.id,r.role]),[['style','style-reference'],['selected','output']]);
  const prompt=buildWebsitePrompt(p)+'\n\n本次额外要求：保留编号 Q-027。';p.websiteRequest={prompt,basis:websitePromptBasis(p),assetIds:['selected']};
  await repo.saveWorkspace(ws(p),1,uid());const input=request(p,'website',{action:'generate'});await tasks.submit(input);const task=await until(tasks,input.id);
  assert.equal(calls,0);assert.equal(task.submittedPrompt,prompt);assert.equal(task.result.website,undefined);
  const bundle=unzipSync(await repo.output(task.result.websiteRequest.bundleFileId));assert.equal(strFromU8(bundle['PROMPT.md']),prompt);assert.equal(bundle['index.html'],undefined);
  assert.ok(bundle['asset-selected.png']);assert.ok(bundle['reference-style.png']);assert.equal(bundle['asset-style.png'],undefined);assert.equal(bundle['asset-candidate.png'],undefined);
  assert.deepEqual(Buffer.from(bundle['asset-selected.png']),await repo.media(p.assets[1].fileId));
  const adopted=applyTaskResult(p,task);assert.equal(websiteRequestSource(adopted),task.result.websiteRequest.source);await repo.saveWorkspace(ws(adopted),2,uid());
  const persisted=await repo.loadWorkspace();assert.deepEqual(parseStoredWorkspace(persisted).workspace.projects[0].websiteRequest,adopted.websiteRequest);assert.ok(projectOutputIds(adopted).includes(adopted.websiteRequest.bundleFileId));
  const files=(await core.call('project_deliver',{projectId:p.id})).files;assert.equal(await readFile(files.find(f=>f.role==='website-prompt').path,'utf8'),prompt);assert.equal(files.find(f=>f.role==='website-request-bundle').stale,false);
  const revised=structuredClone(adopted);revised.art.palette='新配色';await repo.saveWorkspace(ws(revised),3,uid());
  await assert.rejects(tasks.submit(request(revised,'website',{action:'generate'})),e=>e.code==='stale_prompt');
  assert.equal((await core.call('project_deliver',{projectId:p.id})).files.find(f=>f.role==='website-request-bundle').stale,true);
});

test('prompt_prepare is read-only and MCP website handoff never sends a message to its own conversation',async t=>{
  let calls=0;const {p,repo,tasks,core}=await setup(t,'website',{env:{WORKBUDDY_ACCESS_TOKEN:'test'},fetchImpl:async()=>{calls++;throw new Error('must not dispatch');}});
  const before=await repo.loadWorkspace();const preview=await core.call('prompt_prepare',{projectId:p.id,kind:'website'});
  assert.equal(preview.prompt,buildWebsitePrompt(p));assert.equal(preview.basis,websitePromptBasis(p));assert.deepEqual(await repo.loadWorkspace(),before);
  const saved=await core.call('project_update',{requestId:uid(),projectId:p.id,expectedVersion:preview.projectVersion,patch:{websiteRequest:{prompt:preview.prompt+'\n保留所有已确定事实。',basis:preview.basis,assetIds:preview.assetIds}}});
  const input={requestId:uid(),projectId:p.id,expectedVersion:saved.projectVersion,kind:'website',args:{provider:'workbuddy'}};
  const submitted=await core.call('task_start',input);const task=await until(tasks,submitted.id);assert.equal(task.dispatch,'conversation');assert.equal(calls,0);
  const adopted=await core.call('task_adopt',{taskId:task.id,expectedVersion:saved.projectVersion});
  assert.equal((await core.call('task_start',input)).id,task.id);assert.equal(calls,0);const current=await core.call('project_get',{projectId:p.id});assert.equal(current.projectVersion,adopted.projectVersion);assert.equal(current.project.websiteRequest.prompt,task.submittedPrompt);
  assert.equal((await repo.listTasks()).length,1);
});

test('asset hashes join saved drafts without losing edits made during upload',()=>{
  const p=createProject('测试','video');const original=new Blob(['one']);p.assets=[{id:'a',name:'原名',blob:original}];
  const snapshot=ws(p);const current={...p,title:'新标题',assets:[{...p.assets[0],name:'新名称'}]};
  const wire=ws({...p,assets:[{id:'a',name:'原名',fileId:digest('one')}]});
  const saved=normalizeSavedAssets(ws(current),snapshot,wire).projects[0];assert.equal(saved.title,'新标题');assert.equal(saved.assets[0].name,'新名称');assert.equal(saved.assets[0].fileId,digest('one'));
  const replaced={...current,assets:[{id:'a',name:'替换图',blob:new Blob(['two'])}]};assert.equal(normalizeSavedAssets(ws(replaced),snapshot,wire).projects[0].assets[0].fileId,undefined);
});
