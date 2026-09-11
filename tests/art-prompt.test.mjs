import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFile} from 'node:fs/promises';
import sharp from 'sharp';
import {createTestDirectory,trackTestManager} from './helpers/test-directory.mjs';
import {createProject,applyTaskResult} from '../lib/workbench/project-core.mjs';
import {createRepository} from '../lib/workbench/repository.mjs';
import {createTaskManager} from '../lib/workbench/tasks.mjs';
import {createCoreService} from '../lib/workbench/core-service.mjs';
import {taskSource} from '../lib/workbench/task-contract.mjs';
import {activeArtPrompt,artFromPrompt} from '../lib/workbench/art-prompt.mjs';
import {imagePrompt,buildVideoPrompt,buildWebsitePrompt} from '../lib/workbench/prompts.mjs';
import {switchWorkType,restoreRecord} from '../lib/workbench/workflow.mjs';
import {parseStoredWorkspace} from '../features/projects/model.ts';

const uid=()=>crypto.randomUUID();
const legacy={direction:'旧写实',material:'旧纸感',palette:'旧暖金光',constraints:'保留当代服饰',fullPrompt:'旧综合稿：青绿冷光'};
const finalPrompt='当代岭南生活插画。青绿冷光，棉布与竹柄；保留当代服饰，不加水印。';
async function setup(t,fetchImpl=async()=>{throw Error('Unexpected external request');}) {
  const {directory}=await createTestDirectory(t,'art-prompt');
  const repo=createRepository(directory),options={env:{DEEPSEEK_API_KEY:'mock'},fetchImpl};
  const tasks=trackTestManager(repo,createTaskManager(repo,options)),core=createCoreService(repo,tasks,options);
  const p=createProject('当代岭南街区的修伞人','novel','画风回归');p.stage=2;p.art={...legacy};
  p.culture='当代岭南；阿澄为虚构人物。';p.content.novel={story:'阿澄修好旧伞。'};
  await repo.saveWorkspace({projects:[p],activeProjectId:p.id},0,uid());
  const get=()=>core.call('project_get',{projectId:p.id});
  const save=async project=>{const ws=await repo.loadWorkspace();await repo.saveWorkspace({projects:[project],activeProjectId:p.id},ws.revision,uid());return (await get()).project;};
  const until=async(id,status='succeeded')=>{for(let i=0;i<300;i++){const task=await tasks.get(id);if(task.status===status)return task;if(['failed','uncertain'].includes(task.status))throw Error(JSON.stringify(task));await new Promise(r=>setTimeout(r,10));}throw Error('task timeout');};
  return {p,repo,tasks,core,get,save,until};
}

test('legacy art survives replacement, persistence, type switching and history restore',async t=>{
  const h=await setup(t),current=await h.get();
  for(const value of Object.values(legacy))assert.ok(activeArtPrompt(current.project.art).includes(value));
  const input={projectId:h.p.id,requestId:uid(),expectedVersion:current.projectVersion,patch:{art:{fullPrompt:finalPrompt}}};
  const updated=await h.core.call('project_update',input);
  const saved=parseStoredWorkspace(await h.repo.loadWorkspace()).workspace.projects[0];
  assert.deepEqual(saved.art,artFromPrompt(finalPrompt));
  const original=saved.flow.records.find(r=>r.target==='art'&&r.value.palette==='旧暖金光');assert.ok(original);
  assert.deepEqual(restoreRecord(saved,original.id).art,legacy);
  assert.equal(activeArtPrompt(switchWorkType(switchWorkType(saved,'video'),'novel').art),finalPrompt);
  await h.core.call('project_update',input);assert.equal((await h.get()).projectVersion,updated.projectVersion);
  assert.deepEqual((await h.get()).project.flow.records,saved.flow.records);
});

test('legacy structured client writes are folded into the visible prompt without losing text',async t=>{
  const h=await setup(t),current=await h.get();
  await h.core.call('project_update',{projectId:h.p.id,requestId:uid(),expectedVersion:current.projectVersion,patch:{art:{palette:'用户改为蓝灰色'}}});
  const p=(await h.get()).project;
  assert.equal(p.art.palette,'');assert.ok(p.art.fullPrompt.includes('用户改为蓝灰色'));
  for(const key of ['direction','material','constraints','fullPrompt'])assert.ok(p.art.fullPrompt.includes(legacy[key]));
  assert.ok(!p.art.fullPrompt.includes(legacy.palette));
});

test('art AI returns a single prompt, freezes instructions and requires explicit adoption',async t=>{
  const calls=[];const h=await setup(t,async(_url,options)=>{const body=JSON.parse(options.body);calls.push(body);return Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify({fullPrompt:finalPrompt})}}]});});
  const current=await h.get(),args={action:'generate',instruction:'只整理重复文字，保留当代服饰。'};
  const started=await h.core.call('task_start',{requestId:uid(),projectId:h.p.id,expectedVersion:current.projectVersion,kind:'art',args});
  const task=await h.until(started.id),context=JSON.parse(calls[0].messages[1].content);
  assert.equal(context.instruction,args.instruction);assert.deepEqual(context.art,{fullPrompt:activeArtPrompt(legacy)});
  assert.equal(context.referenceNotes,undefined);assert.match(calls[0].messages[0].content,/不生成图片/);
  assert.deepEqual(task.result.art,artFromPrompt(finalPrompt));assert.deepEqual((await h.get()).project.art,legacy);
  const p=(await h.get()).project;p.requests[2]='下一轮改为水彩';p.references=[{id:'next-ref',assetId:'later',purpose:'下一轮参考'}];
  // Reference files are not part of this text-only request.
  assert.equal(taskSource(p,'art',task.args),task.source);p.references=[];await h.save(p);
  const next=await h.get();await h.core.call('task_adopt',{taskId:task.id,expectedVersion:next.projectVersion});
  const adopted=(await h.get()).project;assert.deepEqual(adopted.art,artFromPrompt(finalPrompt));assert.equal(adopted.stage,2);assert.equal(adopted.requests[2],'下一轮改为水彩');
  assert.equal(calls.length,1);
});

test('manual changes reject stale art candidates and old task results retain their fields',()=>{
  const p=createProject('当代岭南街巷','novel');p.art={...legacy};
  const args={action:'generate',instruction:'整理画风'},task={projectId:p.id,kind:'art',args,status:'succeeded',source:taskSource(p,'art',args),result:{art:artFromPrompt(finalPrompt)}};
  assert.throws(()=>applyTaskResult({...p,art:artFromPrompt('用户新写的水彩稿')},task),/生成依据已改变/);
  const oldArgs={},oldTask={...task,args:oldArgs,source:taskSource(p,'art',oldArgs),result:{art:{...legacy}}};
  assert.equal(applyTaskResult(p,oldTask).art.fullPrompt,activeArtPrompt(legacy));
});

test('adopted prompt and exact reference files reach the original image handoff',async t=>{
  const h=await setup(t);const bytes=await sharp({create:{width:32,height:32,channels:3,background:'teal'}}).png().toBuffer();
  const stored=await h.repo.putImage(bytes);let p=(await h.get()).project;p.art=artFromPrompt(finalPrompt);
  p.assets=[{id:'style',name:'配色参考',fileId:stored.fileId},{id:'original',name:'原图',fileId:stored.fileId,source:{style:'原图铅笔风格'}}];
  p.references=[{id:'style-ref',assetId:'style',purpose:'只参考配色，不复制人物'}];p.concepts=[{id:'person',name:'阿澄',category:'character',description:'当代衬衫',prompt:'旧图提示词',revisionRequest:'只改伞面为蓝色',savedAssetId:'original'}];p=await h.save(p);
  const current=await h.get();const started=await h.core.call('task_start',{requestId:uid(),projectId:p.id,expectedVersion:current.projectVersion,kind:'image',args:{action:'generate',objectId:'person',provider:'workbuddy',ratio:'1:1'}});
  const task=await h.until(started.id,'waiting_external');const handoff=JSON.parse(await readFile(task.handoff.requestPath,'utf8'));
  assert.ok(handoff.prompt.includes(finalPrompt));assert.ok(!handoff.prompt.includes('旧暖金光'));assert.ok(!handoff.prompt.includes('旧图提示词'));
  assert.ok(handoff.prompt.includes(p.references[0].purpose));assert.equal(handoff.inputImages.length,1);assert.deepEqual(await readFile(handoff.inputImages[0]),await h.repo.media(stored.fileId));
  assert.equal(imagePrompt(p,{action:'edit',objectId:'person'}).style,'原图铅笔风格');
  assert.equal(imagePrompt(p,{action:'edit',objectId:'person',newStyle:true}).style,finalPrompt);
  assert.deepEqual((await h.get()).project.references,p.references);assert.deepEqual((await h.get()).project.assets,p.assets);
  p.type='video';p.video={ratio:'16:9',shots:[]};assert.ok(buildVideoPrompt(p,{id:'shot',title:'开伞',visual:'阿澄开伞',camera:'中景',duration:5}).includes(finalPrompt));
  p.type='website';assert.ok(buildWebsitePrompt(p).includes(finalPrompt));
});
