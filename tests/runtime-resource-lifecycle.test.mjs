import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,readdir,rm} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import {zipSync,strToU8} from 'fflate';
import {createRepository} from '../lib/workbench/repository.mjs';
import {createProject} from '../lib/workbench/project-core.mjs';
import {createTaskManager} from '../lib/workbench/tasks.mjs';
import {createCoreService} from '../lib/workbench/core-service.mjs';
import {attachWebsiteResult} from '../lib/workbench/website-handoff.mjs';
import {websiteRequestSource} from '../lib/workbench/prompts.mjs';
import {ServiceError} from '../lib/workbench/errors.mjs';

const uid=()=>crypto.randomUUID();
const site=(title='网站')=>Buffer.from(zipSync({'index.html':strToU8('<!doctype html><h1>'+title+'</h1>')}));

async function setup(t) {
  const base=fileURLToPath(new URL('../work/runtime-resource-tests/',import.meta.url));
  await mkdir(base,{recursive:true});
  const directory=await mkdtemp(join(base,'case-'));
  const repo=createRepository(directory);
  const tasks=createTaskManager(repo,{env:{},fetchImpl:async()=>{throw Error('Unexpected provider request');}});
  const core=createCoreService(repo,tasks,{env:{}});
  t.after(async()=>{await tasks.stop();await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:30});});
  return {repo,tasks,core,directory};
}

test('polling completed website history reads the workspace once, including deleted projects',async t=>{
  let reads=0;
  const project={...createProject('网站','website','','project'),websiteRequest:{taskId:'latest'}};
  const history=Array.from({length:30},(_,i)=>({id:'past-'+i,projectId:i%2?'project':'deleted-project',kind:'website',workType:'website',args:{guided:true},status:'succeeded',createdAt:i,result:{websiteSource:{fileId:'old-'+i}}}));
  const tasks=createTaskManager({listTasks:async()=>history,loadWorkspace:async()=>{reads++;return {workspace:{projects:[project]}};}});
  t.after(()=>tasks.stop());
  assert.equal((await tasks.list()).length,30);
  assert.equal(reads,1,'historical website tasks must not reload the complete workspace');
  await tasks.list();
  assert.equal(reads,2);
});

test('a reused project snapshot still reloads on conflict and never overwrites a changed request',async()=>{
  const project={...createProject('骑楼网站','website','','project'),websiteRequest:{taskId:'current',prompt:'保留骑楼',basis:'basis',assetIds:[]}};
  const task={id:'current',projectId:project.id,result:{websiteSource:{fileId:'a'.repeat(64)+'.zip',requestSource:websiteRequestSource(project)},websiteRequest:project.websiteRequest}};
  let reads=0,writes=0;
  await attachWebsiteResult(task,{
    mutateProject:async()=>{writes++;throw new ServiceError(409,'conflict','Changed');},
    loadWorkspace:async()=>{reads++;return {workspace:{projects:[{...project,websiteRequest:{...project.websiteRequest,taskId:'newer'}}]}};},
  },project);
  assert.equal(writes,1);
  assert.equal(reads,1);
});

test('website completion validates identical bytes once and stores only the accepted result',async t=>{
  const {repo,tasks,core,directory}=await setup(t);
  const created=await core.call('project_create',{requestId:uid(),idea:'文化资料网站',type:'website'});
  const task=await core.call('website_run',{projectId:created.projectId,expectedVersion:created.projectVersion,requestId:uid(),goal:'文化资料网站',autoAssets:false,dispatch:'conversation'});
  async function until(status) {
    for(let i=0;i<100;i++) {
      const current=await tasks.get(task.id);
      if(current.status===status)return current;
      assert.notEqual(current.status,'failed',current.error);
      await new Promise(resolve=>setTimeout(resolve,10));
    }
    assert.fail('Task did not reach '+status);
  }
  await until('waiting_external');
  const beforeFiles=await readdir(join(directory,'files'));
  const noEntry=Buffer.from(zipSync({'app.js':strToU8('document.body.textContent="入口缺失"')}));
  await assert.rejects(tasks.completeWebsite(task.id,{bytes:noEntry}),e=>e.code==='invalid_source');
  assert.deepEqual(await readdir(join(directory,'files')),beforeFiles,'rejected handoffs must not leave unused output archives');
  const baseline=repo.cacheStats().sources.validations;
  let writes=0;
  const put=repo.putOutput;
  repo.putOutput=async(...args)=>{writes++;return put(...args);};
  const bytes=site();
  await tasks.completeWebsite(task.id,{bytes});
  const done=await until('succeeded');
  await tasks.list(created.projectId);
  const project=(await repo.loadWorkspace()).workspace.projects[0];
  assert.equal(project.websiteSourceCandidate.fileId,done.result.websiteSource.fileId);
  assert.equal(repo.cacheStats().sources.validations-baseline,1,'completion, receiver and candidate attachment must reuse one strict byte validation');
  assert.equal(writes,1,'only the normal handoff receiver stores the finished ZIP');
  await tasks.completeWebsite(task.id,{bytes});
  assert.equal(writes,1,'a same-file retry must not write another result');
  await assert.rejects(tasks.completeWebsite(task.id,{bytes:site('不同的网站')}),e=>e.code==='handoff_conflict');
  assert.equal(writes,1,'a conflicting result must not create an orphaned output');
  assert.equal((await readdir(join(directory,'files'))).length,beforeFiles.length+1);
});

test('source validation caches metadata, rechecks changed bytes and rejects unsafe ZIP paths',async t=>{
  const {repo}=await setup(t);
  const bytes=site('一');
  const first=repo.inspectWebsiteSource(bytes);
  assert.equal(first.entries,undefined,'decoded archive members must not be retained in the cache');
  first.previewPath='tampered.html';
  assert.equal(repo.inspectWebsiteSource(bytes).previewPath,'index.html');
  assert.equal(repo.cacheStats().sources.validations,1);
  const second=repo.inspectWebsiteSource(site('二'));
  assert.notEqual(first.fileId,second.fileId);
  assert.equal(repo.cacheStats().sources.validations,2);
  assert.throws(()=>repo.inspectWebsiteSource(Buffer.from(zipSync({'../index.html':strToU8('invalid')}))),e=>e.code==='invalid_source');
  assert.equal(repo.cacheStats().sources.entries,2,'failed validation must not become trusted');
});
