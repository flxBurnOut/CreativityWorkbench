import test from 'node:test';
import assert from 'node:assert/strict';
import fs,{mkdir,mkdtemp,readdir,readFile,writeFile,rm,utimes} from 'node:fs/promises';
import {syncBuiltinESMExports} from 'node:module';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import {zipSync,strToU8} from 'fflate';
import {createRepository,digest} from '../lib/workbench/repository.mjs';
import {cleanupStorage} from '../lib/workbench/storage-maintenance.mjs';

const site=title=>Buffer.from(zipSync({'index.html':strToU8('<!doctype html><h1>'+title+'</h1>')}));
async function setup(t) {
  const base=fileURLToPath(new URL('../work/storage-cleanup-tests/',import.meta.url));
  await mkdir(base,{recursive:true});const directory=await mkdtemp(join(base,'case-'));
  const repo=createRepository(directory);await repo.initialize();
  t.after(()=>rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:30}));
  return {repo,directory};
}
async function completed(repo,id='done',projectId='project') {
  const bytes=site(id),stored=await repo.putOutput(bytes,'zip');
  const handoff=await repo.handoff(id,'保留完整原请求',[],'zip',{projectId,kind:'website'});
  await writeFile(handoff.output,bytes);
  await repo.saveTask({id,projectId,kind:'website',args:{guided:true},status:'succeeded',handoff,result:{websiteSource:stored}});
  const inbox=await repo.inbox(projectId);await writeFile(join(inbox,'website.zip'),bytes);
  return {bytes,stored,handoff,inbox};
}

test('website cleanup removes proven source copies while preserving manifests, inputs, outputs and task history',async t=>{
  const {repo,directory}=await setup(t),done=await completed(repo);
  const request=await readFile(done.handoff.requestPath);
  await writeFile(join(done.handoff.directory,'input-1.png'),Buffer.from('keep original input'));
  await writeFile(join(done.inbox,'unknown.zip'),site('not imported'));
  const active=await repo.handoff('active','仍在等待',[],'zip',{projectId:'active-project',kind:'website'});
  await repo.saveTask({id:'active',projectId:'active-project',kind:'website',status:'waiting_external',handoff:active});
  await writeFile(active.output,site('not received'));
  await writeFile(join(active.directory,'input-1.png'),Buffer.from('active input'));
  assert.equal((await cleanupStorage(repo)).entries.length,0,'the default retention period applies');
  const preview=await cleanupStorage(repo,{minimumAgeDays:0});
  assert.deepEqual(preview.entries.map(entry=>entry.path),['handoff/done/result.zip','inbox/project/website.zip']);
  assert.equal(preview.bytes,done.bytes.length*2);
  await cleanupStorage(repo,{minimumAgeDays:0,execute:true,confirmationToken:preview.confirmationToken});
  await assert.rejects(readFile(done.handoff.output),e=>e.code==='ENOENT');
  await assert.rejects(readFile(join(done.inbox,'website.zip')),e=>e.code==='ENOENT');
  assert.deepEqual(await readFile(done.handoff.requestPath),request);
  assert.equal((await readFile(join(done.handoff.directory,'input-1.png'))).toString(),'keep original input');
  assert.deepEqual(await repo.output(done.stored.fileId),done.bytes);
  assert.equal((await repo.task('done')).status,'succeeded');
  assert.ok(await readFile(join(done.inbox,'unknown.zip')));
  assert.ok(await readFile(active.output));assert.ok(await readFile(join(active.directory,'input-1.png')));
  assert.ok(await readFile(join(directory,'tasks','active.json')));
});

test('replaced website sources, damaged durable copies and newly active tasks invalidate a cleanup plan',async t=>{
  const {repo,directory}=await setup(t),done=await completed(repo);
  const preview=await cleanupStorage(repo,{minimumAgeDays:0});
  await writeFile(done.handoff.output,site('new unimported output'));
  await assert.rejects(cleanupStorage(repo,{minimumAgeDays:0,execute:true,confirmationToken:preview.confirmationToken}),e=>e.code==='cleanup_changed');
  assert.ok(await readFile(done.handoff.output));assert.ok(await readFile(join(done.inbox,'website.zip')));
  await writeFile(join(directory,'files',done.stored.fileId),Buffer.from('corrupt durable file'));
  assert.equal((await cleanupStorage(repo,{minimumAgeDays:0})).entries.length,0,'a hash-looking filename alone does not prove a durable copy');
  await writeFile(join(directory,'files',done.stored.fileId),done.bytes);
  const fresh=await cleanupStorage(repo,{minimumAgeDays:0});
  await repo.saveTask({id:'new-task',projectId:'project',kind:'website',status:'waiting_external'});
  await assert.rejects(cleanupStorage(repo,{minimumAgeDays:0,execute:true,confirmationToken:fresh.confirmationToken}),e=>e.code==='cleanup_changed');
  assert.equal((await cleanupStorage(repo,{minimumAgeDays:0})).entries.length,0);
});

test('old website inbox copies can be matched to retained history, without deleting the historical result',async t=>{
  const {repo}=await setup(t),bytes=site('historical website'),stored=await repo.putOutput(bytes,'zip');
  const inbox=await repo.inbox('history-project');await writeFile(join(inbox,'old.zip'),bytes);
  const originalLoad=repo.loadWorkspace;
  repo.loadWorkspace=async()=>({workspace:{projects:[{id:'history-project',flow:{records:[{target:'websiteSource',value:stored}]}}]}});
  const old=new Date(Date.now()-10*86400000);await utimes(join(inbox,'old.zip'),old,old);
  const preview=await cleanupStorage(repo);
  assert.deepEqual(preview.entries.map(entry=>entry.path),['inbox/history-project/old.zip']);
  await cleanupStorage(repo,{execute:true,confirmationToken:preview.confirmationToken});
  assert.deepEqual(await repo.output(stored.fileId),bytes);
  repo.loadWorkspace=originalLoad;
});

test('partial temporary writes are removed for atomic outputs and original-task handoff, leaving unrelated files intact',async t=>{
  const {repo,directory}=await setup(t),bytes=site('partial write');
  const handoff=await repo.handoff('handoff','original request',[],'zip');
  const unrelated=join(directory,'files','another-writer.tmp');await writeFile(unrelated,'untouched');
  const originalOpen=fs.open;let failures=0;
  fs.open=async(path,flags,...rest)=>{
    const handle=await originalOpen(path,flags,...rest);
    if(flags!=='wx'||!String(path).endsWith('.tmp'))return handle;
    return {
      writeFile:async data=>{await handle.writeFile(data.subarray(0,4));failures++;throw Object.assign(Error('simulated disk full'),{code:'ENOSPC'});},
      close:()=>handle.close(),
    };
  };
  syncBuiltinESMExports();
  try {
    await assert.rejects(repo.putOutput(bytes,'zip'),e=>e.code==='ENOSPC');
    await assert.rejects(repo.completeHandoffFile('handoff',bytes,'zip'),e=>e.code==='ENOSPC');
  } finally {fs.open=originalOpen;syncBuiltinESMExports();}
  assert.equal(failures,2);
  assert.deepEqual(await readdir(join(directory,'files')),['another-writer.tmp']);
  assert.deepEqual(await readdir(handoff.directory),['request.json']);
  assert.equal((await readFile(unrelated)).toString(),'untouched');
});

test('a failed final rename removes only its owned temporary file',async t=>{
  const {repo,directory}=await setup(t),bytes=site('rename failure');
  const destination=join(directory,'files',digest(bytes)+'.zip');await mkdir(destination);
  const unrelated=join(directory,'files','keep.tmp');await writeFile(unrelated,'keep');
  await assert.rejects(repo.putOutput(bytes,'zip'));
  assert.deepEqual((await readdir(join(directory,'files'))).sort(),[digest(bytes)+'.zip','keep.tmp'].sort());
  assert.equal((await readFile(unrelated)).toString(),'keep');
});
