import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir, writeFile, readFile, readdir, copyFile, rm} from 'node:fs/promises';
import {join} from 'node:path';
import sharp from 'sharp';
import {createTestDirectory} from './helpers/test-directory.mjs';
import {createRepository, digest} from '../lib/workbench/repository.mjs';
import {createProject} from '../lib/workbench/project-core.mjs';
import {normalizeCraftPlan} from '../lib/workbench/craft-contract.mjs';
import {createServiceSettings} from '../lib/workbench/service-settings.mjs';
import {craftTextureStatus, craftTextureConfig} from '../lib/workbench/craft-texture-config.mjs';
import {cosAuthorization, signedTextureUrl, downloadTexture, validateTextureObjectKey} from '../lib/workbench/adapters/craft-texture.mjs';
import {defaultTexturePrompt, startCraftTexture, refreshCraftTexture, cleanupTexture} from '../lib/workbench/craft-texture-runtime.mjs';
import {attachCraftResult} from '../lib/workbench/craft-runtime.mjs';
import {taskSource} from '../lib/workbench/task-contract.mjs';
import {projectOutputIds} from '../lib/workbench/output-contract.mjs';
import {buildCraftAsset} from '../lib/workbench/craft-engine.mjs';
import {textureBlender} from '../lib/workbench/craft-texture-engine.mjs';
import {createCoreService} from '../lib/workbench/core-service.mjs';
import {createTaskManager} from '../lib/workbench/tasks.mjs';

const env = {TEXT_API_BASE_URL: 'https://tokenhub.tencentmaas.com/v1', DEEPSEEK_API_KEY: 'test-tokenhub-secret', COS_BUCKET: 'texture-test-1250000000', COS_REGION: 'ap-guangzhou', COS_SECRET_ID: 'AKIDtestonly', COS_SECRET_KEY: 'test-cos-secret'};
const png = () => sharp({create:{width:32,height:32,channels:3,background:'#316b57'}}).png().toBuffer();
function files(suffix = '') {
  const blend = Buffer.from('BLENDER-v500' + 'fixture-data-only' + suffix);
  const json = JSON.stringify({asset:{version:'2.0'},extras:{fixture:suffix}});
  const padded = json.padEnd(Math.ceil(json.length / 4) * 4,' '), glb=Buffer.alloc(20+padded.length);
  glb.write('glTF');glb.writeUInt32LE(2,4);glb.writeUInt32LE(glb.length,8);glb.writeUInt32LE(padded.length,12);glb.writeUInt32LE(0x4e4f534a,16);glb.write(padded,20);
  return {blend,glb};
}
const stats = {vertices:64,triangles:120,objects:1,materials:1,dimensions:[.16,.16,.08],unit:'m'};
async function setup(t) {
  const scope=await createTestDirectory(t,'craft-texture'),repo=createRepository(scope.directory),sourceFiles=files();
  const source={taskId:'source-task',title:'凉茶碗',kind:'bowl',prompt:'岭南凉茶褐釉陶碗',createdAt:1,blendFileId:(await repo.putOutput(sourceFiles.blend,'blend')).fileId,glbFileId:(await repo.putOutput(sourceFiles.glb,'glb')).fileId,plan:normalizeCraftPlan({kind:'bowl'}),stats,warnings:[],knowledge:[]};
  const id=crypto.randomUUID(),project={...createProject(source.prompt,'craft'),craftAsset:source,craftGoal:'下一版的草稿保持',craftRequest:{goal:source.prompt,taskId:id,requestedAt:Date.now()}};
  await repo.mutateProject({projectId:project.id,create:true,operationId:'create',requestHash:'create'},()=>({project}));
  let task={id,projectId:project.id,kind:'craft-model',createdAt:Date.now(),status:'running',snapshot:project,args:{prompt:source.prompt,textureSource:source,texturePrompt:defaultTexturePrompt(source)}};
  task.source=taskSource(project,task.kind,task.args);
  const update=async patch=>{task={...task,...patch};await repo.saveTask(task);return task;};
  await update({});
  const calls=[];
  const fetchImpl=async(url,options)=>{
    calls.push({url,method:options.method});
    if(url.includes('.cos.ap-guangzhou.myqcloud.com/')) {
      assert.ok(options.headers.Authorization.startsWith('q-sign-algorithm=sha1'));
      assert.ok(!options.headers.Authorization.includes(env.COS_SECRET_KEY));
      if(options.body)for await(const chunk of options.body)assert.ok(chunk.length<=65536);
      return new Response(null,{status:200});
    }
    if(url.endsWith('/submit')) {
      const saved=await repo.task(id);assert.equal(saved.phase,'texture-submitting');
      const body=JSON.parse(options.body);assert.equal(body.model,'hy-3d-texture');assert.equal(body.texture_size,1024);assert.equal(body.enable_keep_uv,true);assert.equal(body.enable_pbr,false);
      assert.ok(body.file_3d.url.includes('q-signature='));assert.ok(Array.from(body.prompt).length<=200);
      return Response.json({id:'remote-job'});
    }
    if(url.endsWith('/query')) {assert.equal(JSON.parse(options.body).id,'remote-job');return Response.json({status:'completed',data:[{type:'image',url:'https://invalid.example/thumbnail.png'},{type:'texture_image',url:'https://result-1250000000.cos.ap-guangzhou.tencentcos.cn/atlas.png'}]});}
    assert.equal(options.headers,undefined,'never send account keys to the result CDN');
    return new Response(await png());
  };
  const blenderImpl=async(mode,directory)=>{
    const data=files(mode);
    for(const name of mode==='prepare'?['prepared.blend','input.glb']:['asset.blend','asset.glb'])await writeFile(join(directory,name),name.endsWith('.blend')?data.blend:data.glb);
    return {geometryHash:'a'.repeat(64),stats};
  };
  return {scope,repo,source,project,getTask:()=>task,update,fetchImpl,blenderImpl,calls};
}

test('texture config reuses only a matching Token Hub key, validates COS, and redacts all saved secrets',async t=>{
  const scope=await createTestDirectory(t,'texture-settings'), settings=createServiceSettings({},join(scope.directory,'settings.json'));
  assert.equal(craftTextureStatus(env).ready,true);
  assert.equal(craftTextureStatus({...env,TEXT_API_BASE_URL:'https://api.deepseek.com'}).ready,false);
  assert.equal(craftTextureStatus({...env,CRAFT_TEXTURE_API_KEY:''}).ready,false);
  assert.equal(craftTextureStatus({...env,COS_BUCKET:'../escape'}).ready,false);
  const saved=settings.save({...env});
  for(const key of ['DEEPSEEK_API_KEY','COS_SECRET_ID','COS_SECRET_KEY'])assert.ok(!JSON.stringify(saved).includes(env[key]));
  assert.throws(()=>settings.save({CRAFT_TEXTURE_API_BASE_URL:'https://evil.example/v1'}));
});

test('COS signatures bind method, host, object and expiry; temporary keys cannot address other task files',()=>{
  const c=craftTextureConfig(env),host=env.COS_BUCKET+'.cos.ap-guangzhou.myqcloud.com',key='workbench-texture/task-a/uuid.glb';
  const signed=cosAuthorization('GET',host,key,c,600,1700000000);
  assert.equal(signed,cosAuthorization('GET',host,key,c,600,1700000000));
  assert.notEqual(signed,cosAuthorization('DELETE',host,key,c,600,1700000000));
  assert.notEqual(signed,cosAuthorization('GET',host,key+'x',c,600,1700000000));
  assert.ok(signedTextureUrl(c,key,'task-a').startsWith('https://'+host+'/'+key+'?'));
  for(const bad of ['other/task-a/a.glb','workbench-texture/task-b/a.glb','workbench-texture/task-a/../../a.glb','workbench-texture/task-a/a.glb?key=bad'])assert.equal(validateTextureObjectKey(bad,'task-a'),false);
});

test('core texture requests select only an existing project version, preserve next-goal drafts and replay the same request',async t=>{
  const s=await setup(t), submitted=[];
  const tasks={list:async()=>[],submit:async input=>{submitted.push(input);const task={...input,status:'queued'};await s.repo.saveTask(task);return task;},get:id=>s.repo.task(id)};
  const core=createCoreService(s.repo,tasks,{env});
  const current=(await s.repo.loadWorkspace()).workspace.projects[0];
  const input={requestId:crypto.randomUUID(),projectId:current.id,expectedVersion:digest(current),goal:s.source.prompt,textureOf:s.source.taskId};
  await assert.rejects(core.call('craft_generate',input),e=>e.code==='texture_busy');
  assert.equal(digest((await s.repo.loadWorkspace()).workspace.projects[0]),digest(current),'busy checks must not change the request pointer');
  await s.update({status:'cancelled'});
  const receipt=await core.call('craft_generate',input);
  assert.equal(receipt.id,input.requestId);assert.equal(submitted[0].args.textureSource.blendFileId,s.source.blendFileId);
  assert.equal((await s.repo.loadWorkspace()).workspace.projects[0].craftGoal,'下一版的草稿保持');
  await core.call('craft_generate',input);assert.equal(submitted.length,1);
  await assert.rejects(core.call('craft_generate',{...input,requestId:crypto.randomUUID(),textureOf:'foreign-version'}),e=>e.code==='not_found');
});

test('task manager resumes only cancelled-job status checks, deduplicates queries and never adopts the late texture',async t=>{
  const s=await setup(t),options={repository:s.repo,env,fetchImpl:s.fetchImpl,update:s.update,blenderImpl:s.blenderImpl};
  await startCraftTexture(s.getTask(),options);
  const manager=createTaskManager(s.repo,{env,fetchImpl:s.fetchImpl});s.scope.defer(()=>manager.stop());
  await manager.cancel(s.getTask().id);
  await Promise.all([manager.get(s.getTask().id),manager.get(s.getTask().id)]);
  for(let i=0;i<100;i++){const current=await s.repo.task(s.getTask().id);if(current.textureCleaned)break;await new Promise(resolve=>setTimeout(resolve,10));}
  const finished=await s.repo.task(s.getTask().id);
  assert.equal(finished.status,'cancelled');assert.equal(finished.result,undefined);assert.equal(finished.textureCleaned,true);
  assert.equal(s.calls.filter(call=>call.url.endsWith('/query')).length,1);
  assert.equal((await s.repo.loadWorkspace()).workspace.projects[0].craftAsset.taskId,s.source.taskId);
});

test('cloud texture resumes the original job, packages a new version and cleans intermediates without replacing source files',async t=>{
  const s=await setup(t),options={repository:s.repo,env,fetchImpl:s.fetchImpl,update:s.update,blenderImpl:s.blenderImpl};
  await startCraftTexture(s.getTask(),options);
  assert.equal(s.getTask().status,'waiting_provider');
  const stored=JSON.stringify(await s.repo.task(s.getTask().id));
  for(const privateText of [env.DEEPSEEK_API_KEY,env.COS_SECRET_KEY,'q-signature='])assert.ok(!stored.includes(privateText));
  await startCraftTexture(s.getTask(),options);
  assert.equal(s.calls.filter(call=>call.url.endsWith('/submit')).length,1);
  await refreshCraftTexture(s.getTask(),options);
  assert.equal(s.getTask().status,'succeeded');assert.equal(s.getTask().textureCleaned,true);
  await attachCraftResult(s.getTask(),s.repo);
  const project=(await s.repo.loadWorkspace()).workspace.projects[0];
  assert.equal(project.craftGoal,'下一版的草稿保持');
  assert.equal(project.craftAsset.texture.sourceTaskId,s.source.taskId);
  assert.ok(projectOutputIds(project).includes(s.source.blendFileId));
  assert.ok(projectOutputIds(project).includes(s.source.glbFileId));
  assert.deepEqual(await readdir(join(s.scope.directory,'render')),[]);
  assert.equal(s.calls.filter(call=>call.method==='DELETE').length,1);
});

test('cancelled remote completion only cleans up and cannot create or adopt a texture asset',async t=>{
  const s=await setup(t),options={repository:s.repo,env,fetchImpl:s.fetchImpl,update:s.update,blenderImpl:s.blenderImpl};
  await startCraftTexture(s.getTask(),options);await s.update({status:'cancelled'});
  await refreshCraftTexture(s.getTask(),options);
  assert.equal(s.getTask().result,undefined);assert.equal(s.getTask().textureRemoteDone,true);
  assert.equal((await s.repo.loadWorkspace()).workspace.projects[0].craftAsset.taskId,s.source.taskId);
  assert.deepEqual(await readdir(join(s.scope.directory,'render')),[]);
});

test('an unknown billable submission stays uncertain and cannot be automatically submitted again',async t=>{
  const s=await setup(t);let submits=0;
  const fetchImpl=async(url,options)=>{if(url.endsWith('/submit')){submits++;throw new TypeError('connection lost');}return s.fetchImpl(url,options);};
  const options={repository:s.repo,env,fetchImpl,update:s.update,blenderImpl:s.blenderImpl};
  await assert.rejects(startCraftTexture(s.getTask(),options),e=>e.code==='uncertain');
  assert.ok(s.getTask().textureSubmittedAt);assert.equal(s.getTask().textureJob,undefined);
  await assert.rejects(startCraftTexture(s.getTask(),options),e=>e.code==='uncertain');
  assert.equal(submits,1);
  await cleanupTexture(s.getTask(),options);
});

test('a changed temp-directory ownership marker is retained instead of recursively deleted',async t=>{
  const s=await setup(t),options={repository:s.repo,env,fetchImpl:s.fetchImpl,update:s.update,blenderImpl:s.blenderImpl};
  await startCraftTexture(s.getTask(),options);
  const directory=join(s.scope.directory,'render',s.getTask().textureWork.directory);
  await writeFile(join(directory,'owner.json'),JSON.stringify({nonce:'other',taskId:'another',source:'another'}));
  assert.ok((await cleanupTexture(s.getTask(),options)).includes('本地'));
  assert.ok((await readdir(directory)).includes('owner.json'));
});

test('cleanup failure preserves success and reports pending cleanup instead of retrying cloud generation',async t=>{
  const s=await setup(t),options={repository:s.repo,env,fetchImpl:s.fetchImpl,update:s.update,blenderImpl:s.blenderImpl};
  await startCraftTexture(s.getTask(),options);
  await refreshCraftTexture(s.getTask(),{...options,fetchImpl:(url,input)=>input.method==='DELETE'?Promise.resolve(new Response(null,{status:403})):s.fetchImpl(url,input)});
  assert.equal(s.getTask().status,'succeeded');assert.equal(s.getTask().textureCleanupPending,true);
  await cleanupTexture(s.getTask(),options);
  assert.equal(s.getTask().textureCleaned,true);assert.equal(s.getTask().note,undefined);
});

test('texture downloads reject redirects, foreign hosts, oversized rasters and thumbnails instead of silently accepting them',async()=>{
  await assert.rejects(downloadTexture('https://localhost/private',{fetchImpl:()=>assert.fail('must not fetch')}),e=>e.code==='texture_output_invalid');
  const big=await sharp({create:{width:2048,height:2048,channels:3,background:'white'}}).png().toBuffer();
  await assert.rejects(downloadTexture('https://result-1250000000.cos.ap-guangzhou.tencentcos.cn/atlas.png',{fetchImpl:async()=>new Response(big)}),e=>e.code==='texture_output_invalid');
});

test('real Blender preserves geometry, applies a color atlas and reopens after the sidecar is removed',{skip:process.env.WORKBENCH_TEST_BLENDER!=='1',timeout:240000},async t=>{
  const scope=await createTestDirectory(t,'texture-real'),base=join(scope.directory,'base'),stage=join(scope.directory,'stage');await mkdir(base);await mkdir(stage);
  const source=await buildCraftAsset(normalizeCraftPlan({kind:'bowl',material:{color:'#4a2f1b'}}),{directory:base});
  const original=await readFile(source.blendPath);
  await copyFile(source.blendPath,join(stage,'source.blend'));
  await textureBlender('prepare',stage);
  const before=JSON.parse(await readFile(join(stage,'geometry.json'),'utf8'));
  const svg='<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024"><rect width="1024" height="1024" fill="#4a2f1b"/><path d="M0 160H1024M0 860H1024" stroke="#e4c78f" stroke-width="32"/><g fill="#6ea377"><ellipse cx="250" cy="420" rx="105" ry="55" transform="rotate(-30 250 420)"/><ellipse cx="590" cy="600" rx="130" ry="70" transform="rotate(25 590 600)"/></g></svg>';
  await writeFile(join(stage,'texture.png'),await sharp(Buffer.from(svg)).png().toBuffer());
  const result=await textureBlender('apply',stage);
  assert.equal(result.geometryHash,before.geometryHash);assert.equal(result.stats.triangles,source.stats.triangles);
  assert.deepEqual(await readFile(source.blendPath),original);
  await rm(join(stage,'texture.png'));
  assert.equal((await textureBlender('verify',stage)).packedTextures,true);
});
