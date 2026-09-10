import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,readdir,open,stat} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {createHash} from 'node:crypto';
import {join} from 'node:path';
import {createTestDirectory} from './helpers/test-directory.mjs';
import {createRepository,digest,validateWorkspace} from '../lib/workbench/repository.mjs';
import {createProject} from '../lib/workbench/project-core.mjs';
import {normalizeCraftPlan} from '../lib/workbench/craft-contract.mjs';
import {validateCraftState} from '../lib/workbench/craft-asset-contract.mjs';
import {recordChanges,switchWorkType,restoreRecord} from '../lib/workbench/workflow.mjs';
import {projectOutputIds} from '../lib/workbench/output-contract.mjs';
import {taskSource} from '../lib/workbench/task-contract.mjs';
import {coreTools} from '../lib/workbench/core-contract.mjs';
import {createCoreService} from '../lib/workbench/core-service.mjs';
import {currentKnowledge} from '../lib/workbench/knowledge.mjs';
import {validCraftFileHeader,CRAFT_HEADER_BYTES} from '../lib/workbench/craft-file-format.mjs';
import {buildCraftAsset} from '../lib/workbench/craft-engine.mjs';

// These tiny headers test storage boundaries only, not real Blender validity.
const blend=()=>Buffer.concat([Buffer.from('BLENDER-v403'),Buffer.alloc(32)]);
const modernBlend=()=>Buffer.concat([Buffer.from('BLENDER17-01v0500'),Buffer.alloc(32)]);
const glb=()=>{const bytes=Buffer.alloc(32);bytes.write('glTF');bytes.writeUInt32LE(2,4);bytes.writeUInt32LE(bytes.length,8);return bytes;};
const pieces=function*(bytes){for(let i=0;i<bytes.length;i++)yield bytes.subarray(i,i+1);};
async function setup(t){const {directory}=await createTestDirectory(t,'craft-storage');const repo=createRepository(directory);await repo.initialize();return {repo,directory};}
function asset(taskId='model-a',salt='a') {
  return {taskId,title:'原创碗',kind:'bowl',prompt:'一个碗',createdAt:1,blendFileId:digest(salt)+'.blend',glbFileId:digest(salt)+'.glb',plan:normalizeCraftPlan({kind:'bowl'}),stats:{vertices:20,triangles:24,objects:1,materials:1,dimensions:[0.16,0.16,0.08],unit:'m'},warnings:['原创建模示意'],knowledge:[]};
}

test('craft output streams validate split headers, preserve content IDs and deduplicate',async t=>{
  const {repo,directory}=await setup(t);
  for(const [bytes,ext] of [[blend(),'blend'],[modernBlend(),'blend'],[glb(),'glb']]) {
    const first=await repo.putOutputStream(pieces(bytes),ext);
    assert.equal(first.fileId,digest(bytes)+'.'+ext);
    assert.deepEqual(await repo.output(first.fileId),bytes);
    assert.deepEqual(await repo.putOutputStream(pieces(bytes),ext),first);
  }
  assert.equal((await readdir(join(directory,'files'))).length,3);
});

test('Blender format-1 requires the complete 17-byte header and rejects unsupported layouts',()=>{
  assert.equal(validCraftFileHeader(modernBlend(),'blend',modernBlend().length),true);
  assert.equal(validCraftFileHeader(modernBlend().subarray(0,12),'blend',modernBlend().length),false);
  for(const value of ['BLENDER18-01v0500','BLENDER17-02v0500','BLENDER17_01v0500','BLENDER17-01V0500','BLENDER17-01v05xx','BLENDER17-01v050']) {
    const bytes=Buffer.from(value);assert.equal(validCraftFileHeader(bytes,'blend',bytes.length),false,value);
  }
  const nonAscii=modernBlend();nonAscii[0]|=0x80;
  assert.equal(validCraftFileHeader(nonAscii,'blend',nonAscii.length),false,'high-bit bytes cannot be stripped into a valid signature');
});

test('invalid craft header, truncated GLB and stream failure leave no published or temporary files',async t=>{
  const {repo,directory}=await setup(t);
  await assert.rejects(repo.putOutputStream([Buffer.from('not a Blender file')],'blend'),e=>e.code==='invalid_file');
  const truncated=glb();truncated.writeUInt32LE(truncated.length+10,8);
  await assert.rejects(repo.putOutputStream(pieces(truncated),'glb'),e=>e.code==='invalid_file');
  await assert.rejects(repo.putOutput(truncated,'glb'),e=>e.code==='invalid_file');
  async function* broken(){yield blend();throw new Error('stream interrupted');}
  await assert.rejects(repo.putOutputStream(broken(),'blend'),/stream interrupted/);
  assert.deepEqual(await readdir(join(directory,'files')),[]);
});

test('craft branch switches and history restoration retain every Blender and GLB file reference',()=>{
  const initial={...createProject('一只碗','craft','测试','project-a'),craftGoal:'一只碗',craftRequest:{goal:'一只碗',taskId:'model-a',requestedAt:1}};
  const first=recordChanges(initial,{...initial,craftAsset:asset()},{origin:'generated',taskId:'model-a'});
  const changed=recordChanges(first,{...first,craftAsset:asset('model-b','b')},{origin:'generated',taskId:'model-b'});
  const website=switchWorkType(changed,'website');
  assert.equal(website.craftAsset,undefined);assert.equal(website.variants.craft.craftAsset.taskId,'model-b');
  assert.deepEqual(new Set(projectOutputIds(website)),new Set([asset().blendFileId,asset().glbFileId,asset('model-b','b').blendFileId,asset('model-b','b').glbFileId]));
  const restored=restoreRecord(switchWorkType(website,'craft'),first.flow.records.find(r=>r.target==='craftAsset').id);
  assert.equal(restored.craftAsset.taskId,'model-a');assert.equal(projectOutputIds(restored).length,4);
  validateWorkspace({projects:[restored],activeProjectId:restored.id});
});

test('editing the next craft goal does not invalidate a running request; unsupported metadata is rejected',()=>{
  const p={...createProject('一个碗','craft','测试','project-a'),craftGoal:'一个碗',craftRequest:{goal:'一个碗',taskId:'model-a',requestedAt:1}};
  const args={prompt:'一个碗'},source=taskSource(p,'craft-model',args);
  assert.equal(taskSource({...p,craftGoal:'下一次改成花瓶'},'craft-model',args),source);
  assert.notEqual(taskSource({...p,craftRequest:{...p.craftRequest,taskId:'model-b'}},'craft-model',args),source);
  assert.throws(()=>validateCraftState({...p,craftGoal:'x'.repeat(4001)}),/4000/);
  assert.throws(()=>validateCraftState({...p,craftAsset:{...asset(),plan:{kind:'bowl',script:'arbitrary code'}}}),/script/);
  assert.throws(()=>validateCraftState({...p,craftAsset:{...asset(),stats:{...asset().stats,dimensions:[1,Infinity,1]}}}),/规格/);
});

test('core craft operations accept bounded JSON handoff strings and reject raw scripts or file records',()=>{
  const input={requestId:'model-a',projectId:'project-a',expectedVersion:'a'.repeat(64),goal:'一个碗',planJson:'{"kind":"bowl"}'};
  assert.ok(coreTools.craft_generate.schema.safeParse(input).success);
  assert.ok(coreTools.craft_complete_plan.schema.safeParse({taskId:'model-a',planJson:input.planJson}).success);
  assert.equal(coreTools.craft_generate.schema.safeParse({...input,goal:'x'.repeat(4001)}).success,false);
  assert.equal(coreTools.craft_complete_plan.schema.safeParse({taskId:'model-a',script:'print(1)'}).success,false);
  assert.equal(coreTools.project_update.schema.safeParse({requestId:input.requestId,projectId:input.projectId,expectedVersion:input.expectedVersion,patch:{craftAsset:asset()}}).success,false);
});

async function racingCore(t,edit) {
  const {repo}=await setup(t),project=createProject('一个碗','craft','测试','project-a');
  await repo.saveWorkspace({projects:[project],activeProjectId:project.id},0,'initial');
  let submissions=0;
  const tasks={list:async()=>[],get:id=>repo.task(id),submit:async input=>{submissions++;const task={...input,status:'queued',createdAt:1};await repo.saveTask(task);return task;}};
  const original=repo.mutateProject;
  repo.mutateProject=async(options,transform)=>{
    const receipt=await original(options,transform);
    if(options.operationId.startsWith('craft_generate:')) {
      const latest=(await repo.loadWorkspace()).workspace.projects[0];
      await original({operationId:'user-edit-during-submit',requestHash:'edit',projectId:project.id,expectedVersion:digest(latest)},p=>({project:edit(p)}));
    }
    return receipt;
  };
  // Probe only checks that this owned test executable exists; fake tasks never
  // run it as Blender or present their response as a generated asset.
  const core=createCoreService(repo,tasks,{env:{WORKBENCH_BLENDER_PATH:process.execPath},fetchImpl:()=>{throw new Error('No provider expected');}});
  return {repo,core,input:{requestId:'model-a',projectId:project.id,expectedVersion:digest(project),goal:'一个碗',planJson:'{"kind":"bowl"}'},submissions:()=>submissions};
}

test('craft_generate tolerates a concurrent next-goal draft save and preserves request idempotency',async t=>{
  const h=await racingCore(t,p=>({...p,craftGoal:'下一轮做一个花瓶'}));
  const queued=await h.core.call('craft_generate',h.input);
  assert.equal(queued.id,'model-a');assert.equal(h.submissions(),1);
  const saved=(await h.repo.loadWorkspace()).workspace.projects[0];
  assert.equal(saved.craftGoal,'下一轮做一个花瓶');assert.equal(saved.craftRequest.goal,'一个碗');
  assert.equal((await h.core.call('craft_generate',h.input)).id,queued.id);assert.equal(h.submissions(),1);
  await assert.rejects(h.core.call('craft_generate',{...h.input,goal:'偷偷替换原目标'}),e=>e.code==='conflict');
});

test('craft_generate refuses a concurrent change of fixed cultural inputs before scheduling',async t=>{
  const h=await racingCore(t,p=>({...p,knowledge:[{id:currentKnowledge.entries[0].id,version:currentKnowledge.version}]}));
  await assert.rejects(h.core.call('craft_generate',h.input),e=>e.code==='conflict');
  assert.equal(h.submissions(),0);assert.equal(await h.repo.task('model-a'),null);
});

test('real Blender files survive streamed repository publication and retain identical bytes',{
  skip:process.env.WORKBENCH_TEST_BLENDER!=='1',timeout:200000,
},async t=>{
  const fixture=await createTestDirectory(t,'craft-real-publication');
  const buildDirectory=join(fixture.directory,'build');await mkdir(buildDirectory);
  const result=await buildCraftAsset({kind:'bowl',decoration:{style:'floral'}},{directory:buildDirectory});
  const repo=createRepository(join(fixture.directory,'data'));
  async function hash(chunks){const hash=createHash('sha256');for await(const chunk of chunks)hash.update(chunk);return hash.digest('hex');}
  for(const [path,extension] of [[result.blendPath,'blend'],[result.glbPath,'glb']]) {
    const info=await stat(path),file=await open(path,'r');
    try{const header=Buffer.alloc(CRAFT_HEADER_BYTES);await file.read(header,0,header.length,0);assert.equal(validCraftFileHeader(header,extension,info.size),true);if(extension==='blend')t.diagnostic('Real .blend header: '+header.toString('latin1'));}
    finally{await file.close();}
    const expected=await hash(createReadStream(path,{highWaterMark:65536}));
    const saved=await repo.putOutputStream(createReadStream(path,{highWaterMark:65536}),extension);
    assert.equal(saved.fileId,expected+'.'+extension);
    assert.equal(await hash(repo.fileChunks(saved.fileId)),expected);
    assert.deepEqual(await repo.putOutputStream(createReadStream(path,{highWaterMark:65536}),extension),saved);
  }
  assert.equal((await readdir(join(repo.root,'files'))).length,2);
});
