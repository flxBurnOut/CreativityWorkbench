import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { unzipSync, strFromU8 } from 'fflate';
import { createRepository } from '../lib/workbench/repository.mjs';
import { createCoreService } from '../lib/workbench/core-service.mjs';
import { createTaskManager } from '../lib/workbench/tasks.mjs';
import { createProject, applyTaskResult } from '../lib/workbench/project-core.mjs';
import { parseStoredWorkspace } from '../features/projects/model.ts';
import { currentKnowledge, searchKnowledge, selectedKnowledge, applyKnowledge, knowledgeText, validateKnowledge } from '../lib/workbench/knowledge.mjs';
import { switchWorkType, workflowInputs, dependencySnapshot, changedDependencies } from '../lib/workbench/workflow.mjs';
import { buildVideoPrompt, videoPromptBasis, websitePromptBasis, buildWebsitePrompt, imagePrompt } from '../lib/workbench/prompts.mjs';
import { taskSource } from '../lib/workbench/task-contract.mjs';
const uid=()=>randomUUID();
async function setup(t,type='novel') {
  const directory=await mkdtemp(join(tmpdir(),'culture-knowledge-'));
  const repo=createRepository(directory); const bodies=[];
  const env={DEEPSEEK_API_KEY:'fixture'};const fetchImpl=async(_url,init)=>{bodies.push(JSON.parse(init.body));return Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify({title:'核查',brief:'固定模拟方案',culture:'虚构场景，知识引用独立保存',notes:'固定检查意见'})}}]});};
  const tasks=createTaskManager(repo,{env,fetchImpl}); const core=createCoreService(repo,tasks,{env,fetchImpl});
  const p=await core.call('project_create',{requestId:uid(),type,idea:'文化知识进入实际创作'});
  t.after(async()=>{await tasks.stop();await rm(directory,{recursive:true,force:true});});
  return {repo,tasks,core,bodies,p};
}
async function until(tasks,id,status='succeeded') {
  for(let i=0;i<300;i++){const t=await tasks.get(id);if(t.status===status)return t;if(['failed','uncertain'].includes(t.status))throw new Error(JSON.stringify(t));await new Promise(r=>setTimeout(r,10));}
  throw new Error('task timeout');
}
test('curated facts have resolvable source attribution; search respects region and empty results',()=>{
  assert.equal(currentKnowledge.entries.length,10);
  for(const e of currentKnowledge.entries) {
    assert.ok(e.creativeUses.length&&e.avoid.length&&e.mediaRights);
    for(const f of e.facts){const source=e.sources.find(s=>s.id===f.sourceId);assert.ok(source?.publisher&&source.evidence&&source.accessedAt);assert.equal(new URL(source.url).protocol,'https:');}
  }
  assert.deepEqual(searchKnowledge('木雕','潮汕').entries.map(e=>e.id),['chaozhou-wood']);
  assert.equal(searchKnowledge('木雕','客家').entries.length,0);
  assert.throws(()=>validateKnowledge([{id:'invented',version:currentKnowledge.version}]));
});
test('knowledge selection survives type switches and backups without changing fiction or silently upgrading versions',()=>{
  const base=createProject('虚构角色','novel');base.culture='我自定的虚构世界';
  const p=applyKnowledge(base,['guangcai','weilong-house']);
  const restored=parseStoredWorkspace({version:1,revision:1,workspace:{projects:[switchWorkType(p,'website')],activeProjectId:p.id}}).workspace.projects[0];
  assert.deepEqual(restored.knowledge,p.knowledge);assert.equal(restored.culture,base.culture);
  assert.equal(selectedKnowledge(restored).length,2);
  assert.throws(()=>parseStoredWorkspace({version:1,revision:1,workspace:{projects:[{...p,knowledge:[{id:'guangcai',version:'missing-version'}]}],activeProjectId:p.id}}),/版本不可用/);
  assert.equal(knowledgeText(applyKnowledge(p,['guangcai','weilong-house'],'remove')),'');
});
test('MCP knowledge writes use current versions, keep user context and make repeated requests idempotent',async t=>{
  const {core,p}=await setup(t);
  const input={...p,requestId:uid(),expectedVersion:p.projectVersion,entryIds:['guangcai']};delete input.projectVersion;delete input.revision;
  const saved=await core.call('knowledge_apply',input);
  assert.equal((await core.call('knowledge_apply',input)).replayed,true);
  const current=await core.call('project_get',{projectId:p.projectId});assert.match(current.knowledgeContext,/釉上/);assert.equal(current.project.culture,'');
  await assert.rejects(core.call('knowledge_apply',{...input,requestId:uid(),entryIds:['hakka-song']}),e=>e.code==='conflict');
  await assert.rejects(core.call('knowledge_apply',{...input,requestId:uid(),expectedVersion:saved.projectVersion,entryIds:['invented']}),e=>e.code==='invalid_input');
  assert.equal((await core.call('project_get',{projectId:p.projectId})).projectVersion,current.projectVersion);
  assert.equal((await core.call('knowledge_search',{query:'釉上'})).entries[0].id,'guangcai');
});
test('selected evidence reaches actual text-provider input and remains independent after creative adoption',async t=>{
  const {core,tasks,bodies,p}=await setup(t);
  const saved=await core.call('knowledge_apply',{requestId:uid(),projectId:p.projectId,expectedVersion:p.projectVersion,entryIds:['guangcai']});
  const job=await core.call('task_start',{requestId:uid(),projectId:p.projectId,expectedVersion:saved.projectVersion,kind:'creative'});
  const done=await until(tasks,job.id);
  const input=JSON.parse(bodies[0].messages[1].content);assert.match(input.themeKnowledge,/https:\/\/www.ihchina.cn\/project_details\/14453/);assert.equal(input.cultureContext,'');
  assert.ok(done.inputManifest.some(i=>i.key==='knowledge'&&i.role==='text'));
  await core.call('task_adopt',{taskId:job.id,expectedVersion:saved.projectVersion});
  assert.equal((await core.call('project_get',{projectId:p.projectId})).project.knowledge[0].id,'guangcai');
});
test('adding and removing evidence invalidates prepared prompts, tasks and recorded dependencies',()=>{
  const p=createProject('原想法','video');p.video={ratio:'16:9',shots:[{id:'s',title:'场景',visual:'瓷面画笔',camera:'固定',duration:5,narration:'',subtitle:'',revision:''}],burnSubtitles:false,keepAudio:false};
  p.concepts=[{id:'c',category:'object',name:'器皿',description:'原创',prompt:'',revisionRequest:''}];
  const added=applyKnowledge(p,['guangcai']);const s=p.video.shots[0];
  assert.notEqual(videoPromptBasis(p,s),videoPromptBasis(added,s));assert.match(buildVideoPrompt(added,s),/釉上/);
  assert.ok(buildVideoPrompt(added,s).length<1000);
  assert.match(imagePrompt(added,{objectId:'c',action:'generate',ratio:'1:1'}).prompt,/釉上/);
  assert.notEqual(websitePromptBasis(p),websitePromptBasis(added));assert.match(buildWebsitePrompt(added),/釉上/);
  assert.notEqual(taskSource(p,'creative',{}),taskSource(added,'creative',{}));
  const old={dependencies:dependencySnapshot(p,workflowInputs(p,'novel').map(i=>i.key))};
  assert.ok(changedDependencies(added,old).some(d=>d.key==='knowledge'));
  assert.throws(()=>applyTaskResult(added,{id:'task',projectId:p.id,kind:'creative',args:{},source:taskSource(p,'creative',{}),status:'succeeded',result:{brief:'旧',culture:'旧'}}));
});
for(const type of ['website','craft'])test(`${type}: actual ZIP delivery includes only selected cultural evidence`,async t=>{
  const {core,tasks,repo,p}=await setup(t,type);
  const saved=await core.call('knowledge_apply',{requestId:uid(),projectId:p.projectId,expectedVersion:p.projectVersion,entryIds:['chaozhou-wood']});
  const job=await core.call('task_start',{requestId:uid(),projectId:p.projectId,expectedVersion:saved.projectVersion,kind:type==='website'?'website':'design-package'});
  const done=await until(tasks,job.id);const id=type==='website'?done.result.websiteRequest.bundleFileId:done.result.designPackage.fileId;
  const files=unzipSync(await repo.output(id));assert.match(strFromU8(files['KNOWLEDGE.md']),/潮州木雕/);assert.doesNotMatch(strFromU8(files['KNOWLEDGE.md']),/梅州客家山歌/);
  const delivery=await core.call('project_deliver',{projectId:p.projectId});const evidence=delivery.files.find(f=>f.role==='theme-knowledge');assert.match(await readFile(evidence.path,'utf8'),/14020/);
});
