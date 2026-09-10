import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile, writeFile, readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {once} from 'node:events';
import sharp from 'sharp';
import {createRepository, digest} from '../lib/workbench/repository.mjs';
import {createProject} from '../lib/workbench/project-core.mjs';
import {normalizeCraftPlan} from '../lib/workbench/craft-contract.mjs';
import {recordChanges, switchWorkType} from '../lib/workbench/workflow.mjs';
import {projectOutputIds} from '../lib/workbench/output-contract.mjs';
import {projectPatternMediaIds, projectMediaIds} from '../lib/workbench/media-references.mjs';
import {cleanupStorage} from '../lib/workbench/storage-maintenance.mjs';
import {createRuntimeServer} from '../lib/workbench/http-server.mjs';
import {createTestDirectory, closeTestServer} from './helpers/test-directory.mjs';

const image = () => sharp({create:{width:16,height:16,channels:3,background:'#684c32'}}).png().toBuffer();
async function fixture(t) {
  const scope=await createTestDirectory(t,'pattern-media'),repo=createRepository(scope.directory);
  await repo.initialize();
  // Header-only fixtures prove storage/backup behavior, not real 3D output.
  const blend=await repo.putOutput(Buffer.concat([Buffer.from('BLENDER-v403'),Buffer.alloc(24)]),'blend');
  const glbBytes=Buffer.alloc(32);glbBytes.write('glTF');glbBytes.writeUInt32LE(2,4);glbBytes.writeUInt32LE(32,8);
  const glb=await repo.putOutput(glbBytes,'glb');
  const asset=(imageFileId,taskId='pattern-one')=>({taskId,title:'文化图案碗',kind:'bowl',prompt:'凉茶碗',createdAt:1,blendFileId:blend.fileId,glbFileId:glb.fileId,plan:normalizeCraftPlan({kind:'bowl'}),stats:{vertices:12,triangles:16,objects:1,materials:1,dimensions:[0.16,0.16,0.08],unit:'m'},warnings:[],knowledge:[],texture:{sourceTaskId:'original',sourceBlendFileId:blend.fileId,sourceGlbFileId:glb.fileId,prompt:'原创花叶图案',model:'test-image',size:1024,geometryHash:'f'.repeat(64),method:'image-wrap',imageFileId}});
  return {scope,repo,asset};
}

test('pattern PNG references survive branch switches and history without becoming output IDs',async t=>{
  const {asset}=await fixture(t),a='a'.repeat(64),b='b'.repeat(64),c='c'.repeat(64);
  const base=createProject('凉茶碗','craft','测试','pattern-project');base.assets=[{id:'library',name:'图案库',fileId:c}];
  const first=recordChanges(base,{...base,craftAsset:asset(a)},{origin:'generated'});
  const second=recordChanges(first,{...first,craftAsset:asset(b,'pattern-two')},{origin:'generated'});
  const website=switchWorkType(second,'website');
  assert.equal(website.craftAsset,undefined);
  assert.deepEqual(new Set(projectPatternMediaIds(website)),new Set([a,b]));
  assert.deepEqual(new Set(projectMediaIds(website)),new Set([a,b,c]));
  assert.ok(projectOutputIds(website).every(id=>id.includes('.')));
  assert.deepEqual(projectPatternMediaIds({...base,flow:{records:[]}}),[]);
});

test('workspace and core saves reject missing pattern media before replacing a confirmed project',async t=>{
  const {repo,asset}=await fixture(t),bytes=await image(),fileId=digest(bytes);
  const project=createProject('凉茶碗','craft','测试','pattern-project');
  const workspace={projects:[project],activeProjectId:project.id};
  await repo.saveWorkspace(workspace,0,'initial');
  const changed={...project,craftAsset:asset(fileId)};
  await assert.rejects(repo.saveWorkspace({...workspace,projects:[changed]},1,'missing-pattern'),error=>error.code==='missing_image');
  const mutation={projectId:project.id,operationId:'pattern-result',requestHash:'pattern',expectedVersion:digest(project)};
  await assert.rejects(repo.mutateProject(mutation,()=>({project:changed})),error=>error.code==='missing_image');
  assert.equal((await repo.loadWorkspace()).revision,1);
  await repo.restoreImage(bytes,fileId);
  await repo.mutateProject(mutation,()=>({project:changed}));
  assert.equal((await repo.loadWorkspace()).workspace.projects[0].craftAsset.texture.imageFileId,fileId);
});

test('backup PNG restoration keeps exact bytes and hash, rejects corruption, and never overwrites another image',async t=>{
  const {repo,scope}=await fixture(t);
  const bytes=await sharp({create:{width:12,height:8,channels:3,background:'#224466'}}).withMetadata().png({compressionLevel:0}).toBuffer();
  const id=digest(bytes),normalized=await repo.putImage(bytes);
  assert.notEqual(normalized.fileId,id,'fixture demonstrates that normal upload would change a saved hash');
  assert.equal((await repo.restoreImage(bytes,id)).fileId,id);
  assert.deepEqual(await repo.media(id),bytes);
  await assert.rejects(repo.restoreImage(await image(),id),error=>error.code==='invalid_backup');
  const corrupt=Buffer.from('PNG suffix is not validation');
  await assert.rejects(repo.restoreImage(corrupt,digest(corrupt)),error=>error.code==='invalid_backup');
  assert.deepEqual(await repo.media(id),bytes);
  assert.equal((await readdir(join(scope.directory,'media'))).length,2);
});

test('media restore HTTP endpoint validates a portable backup and serves the same PNG bytes',async t=>{
  const scope=await createTestDirectory(t,'pattern-media-http');
  const server=createRuntimeServer({env:{},dataDirectory:scope.directory,fetchImpl:()=>{throw Error('No cloud call permitted');}});
  scope.defer(()=>closeTestServer(server));
  server.listen(0,'127.0.0.1');await once(server,'listening');
  const base='http://127.0.0.1:'+server.address().port,bytes=await image(),id=digest(bytes);
  const restored=await fetch(base+'/v1/media/restore/'+id,{method:'POST',headers:{'Content-Type':'image/png'},body:bytes});
  assert.equal(restored.status,201);assert.equal((await restored.json()).fileId,id);
  const read=await fetch(base+'/v1/media/'+id);assert.equal(read.status,200);assert.deepEqual(Buffer.from(await read.arrayBuffer()),bytes);
  const wrong=await fetch(base+'/v1/media/restore/'+'a'.repeat(64),{method:'POST',headers:{'Content-Type':'image/png'},body:bytes});
  assert.equal(wrong.status,400);assert.equal((await wrong.json()).code,'invalid_backup');
});

test('pattern cleanup only removes a successful identical handoff copy and keeps source, requests and failed work',async t=>{
  const {repo,asset}=await fixture(t),bytes=await image(),stored=await repo.putImage(bytes),canonical=await repo.media(stored.fileId);
  const records=[];
  for(const [id,status,content] of [['done','succeeded',canonical],['cancelled','cancelled',canonical],['failed','failed',canonical],['changed','succeeded',Buffer.from('new unimported image')]]) {
    const handoff=await repo.handoff(id,'保留本轮图案创作要求',[],'png',{projectId:'pattern-project',kind:'craft-model'});
    await writeFile(handoff.output,content);
    await repo.saveTask({id,projectId:'pattern-project',kind:'craft-model',args:{textureMode:'image'},status,handoff,patternImage:{fileId:stored.fileId,originalFileId:stored.fileId,model:'test'},result:{craftAsset:asset(stored.fileId,id)}});
    records.push({id,handoff});
  }
  assert.deepEqual((await cleanupStorage(repo)).entries,[],'retention age still applies');
  const preview=await cleanupStorage(repo,{minimumAgeDays:0});
  assert.deepEqual(preview.entries.map(entry=>entry.path),['handoff/done/result.png']);
  await cleanupStorage(repo,{minimumAgeDays:0,execute:true,confirmationToken:preview.confirmationToken});
  await assert.rejects(readFile(records[0].handoff.output),error=>error.code==='ENOENT');
  for(const record of records){assert.ok(await readFile(record.handoff.requestPath));assert.ok(await repo.task(record.id));}
  for(const record of records.slice(1))assert.ok(await readFile(record.handoff.output));
  assert.deepEqual(await repo.media(stored.fileId),canonical);
});
