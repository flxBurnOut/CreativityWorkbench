import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {once} from 'node:events';
import sharp from 'sharp';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {createRuntimeServer} from '../lib/workbench/http-server.mjs';
import {createRepository} from '../lib/workbench/repository.mjs';
import {taskSource} from '../lib/workbench/task-contract.mjs';

const uid=()=>crypto.randomUUID();
const png=color=>sharp({create:{width:40,height:40,channels:3,background:color}}).png().toBuffer();
async function setup(t) {
  const directory=await mkdtemp(join(tmpdir(),'handoff-continuation-'));let remoteCalls=0;
  const runtime=createRuntimeServer({dataDirectory:directory,env:{},fetchImpl:async()=>{remoteCalls++;throw Error('No provider call expected');}});
  runtime.listen(0,'127.0.0.1');await once(runtime,'listening');const base='http://127.0.0.1:'+runtime.address().port;
  const transport=new StdioClientTransport({command:process.execPath,args:[fileURLToPath(new URL('../scripts/workbench-mcp.mjs',import.meta.url))],cwd:directory,env:{WORKBENCH_RUNTIME_URL:base,WORKBENCH_DATA_DIR:directory},stderr:'pipe'});
  const client=new Client({name:'handoff-continuation-test',version:'1'});await client.connect(transport);
  t.after(async()=>{await client.close();await new Promise(r=>runtime.close(r));await rm(directory,{recursive:true,force:true,maxRetries:5});assert.equal(remoteCalls,0);});
  const call=async(name,args,code)=>{
    const result=await client.callTool({name,arguments:args});let data=result.structuredContent;
    if(!data){try{data=JSON.parse(result.content[0].text);}catch{assert.equal(code,'invalid_input');assert.equal(result.isError,true);assert.match(result.content[0].text,/Input validation error|MCP error -32602/);return {error:result.content[0].text};}}
    assert.equal(Boolean(result.isError),Boolean(code),JSON.stringify(data));if(code)assert.equal(data.code,code);return data;
  };
  const wait=async(id,status)=>{const end=Date.now()+10000;while(Date.now()<end){const value=await call('task_get',{taskId:id});if(value.status===status)return value;await new Promise(r=>setTimeout(r,30));}throw Error('Task timeout: '+id);};
  const created=await call('project_create',{requestId:uid(),idea:'网页既有任务与 WorkBuddy 图片回传',type:'novel'});
  await call('project_update',{requestId:uid(),projectId:created.projectId,expectedVersion:created.projectVersion,patch:{concepts:[{id:'item',category:'object',name:'伞',description:'测试物件',prompt:'',revisionRequest:''}]}});
  const original=await call('project_get',{projectId:created.projectId});
  const input={id:uid(),projectId:original.project.id,kind:'image',args:{objectId:'item',action:'generate',provider:'workbuddy',ratio:'1:1'}};input.source=taskSource(original.project,input.kind,input.args);
  const response=await fetch(base+'/v1/tasks',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(input)});assert.ok(response.ok,await response.text());
  const waiting=await wait(input.id,'waiting_external');
  return {call,wait,waiting,original,directory,base};
}

test('Web task -> real MCP -> already imported PNG completes the original handoff with no new task or generation',async t=>{
  const h=await setup(t);const {call,waiting,original,wait}=h;const taskId=waiting.id;const projectId=original.project.id;
  assert.equal(waiting.handoffContract.mode,'complete-existing-task');assert.equal(waiting.handoffContract.taskId,taskId);
  const request=JSON.parse(await readFile(waiting.handoff.requestPath,'utf8'));assert.equal(request.taskId,taskId);assert.equal(request.projectId,projectId);assert.equal(request.objectId,'item');
  const summary=(await call('task_list',{projectId})).tasks[0];assert.equal(summary.objectId,'item');assert.equal(summary.handoffContract.output,waiting.handoff.output);
  const duplicate=await call('task_start',{requestId:uid(),projectId,expectedVersion:original.projectVersion,kind:'image',args:waiting.args},'pending_task');assert.ok(duplicate.error.includes(taskId));
  await writeFile(join(original.inbox,'generated.png'),await png('green'));
  const imported=await call('media_import',{requestId:uid(),projectId,expectedVersion:original.projectVersion,role:'image',filename:'generated.png'});
  assert.equal((await call('task_get',{taskId})).status,'waiting_external','library import alone cannot finish the original task');
  const before=await call('project_get',{projectId});
  await call('task_complete_handoff',{taskId,assetId:imported.assetId});
  const done=await wait(taskId,'succeeded');assert.equal(done.id,taskId);assert.equal(done.result.asset.source.taskId,taskId);
  assert.deepEqual(await readFile(waiting.handoff.output),await readFile(join(h.directory,'media',done.result.asset.fileId+'.png')));
  assert.equal((await call('project_get',{projectId})).projectVersion,before.projectVersion,'completion does not mutate or adopt into the project');
  const replay=await call('task_complete_handoff',{taskId,assetId:imported.assetId});assert.equal(replay.handoffCompletion.alreadyWritten,true);assert.equal(replay.result.asset.id,done.result.asset.id);
  const adopted=await call('task_adopt',{taskId,expectedVersion:before.projectVersion});assert.equal((await call('project_get',{projectId})).project.concepts[0].candidateAssetId,done.result.asset.id);
  assert.equal((await call('task_adopt',{taskId,expectedVersion:adopted.projectVersion})).replayed,true);
  assert.equal((await call('task_list',{projectId})).tasks.length,1);
  const web=await(await fetch(h.base+'/v1/tasks?projectId='+projectId)).json();assert.equal(web.tasks[0].status,'succeeded');assert.equal(web.tasks[0].id,taskId);
});

test('completion validates PNG and project ownership; repeated calls do not overwrite results or bypass stale adoption',async t=>{
  const {call,wait,waiting,original,directory}=await setup(t);const taskId=waiting.id;const projectId=original.project.id;
  await call('task_complete_handoff',{taskId},'invalid_input');
  await call('task_complete_handoff',{taskId,filename:'../escape.png'},'invalid_input');
  await call('task_complete_handoff',{taskId,filename:'one.png',assetId:'two'},'invalid_input');
  await call('task_complete_handoff',{taskId,filename:'absent.png'},'missing_file');
  await call('task_complete_handoff',{taskId,assetId:'another-project-asset'},'invalid_asset');
  const foreign=await call('project_create',{requestId:uid(),idea:'另一个项目',type:'novel'});
  const other=await call('project_get',{projectId:foreign.projectId});await writeFile(join(other.inbox,'foreign.png'),await png('orange'));
  const foreignImage=await call('media_import',{requestId:uid(),projectId:other.project.id,expectedVersion:other.projectVersion,filename:'foreign.png',role:'image'});
  await call('task_complete_handoff',{taskId,assetId:foreignImage.assetId},'invalid_asset');
  await writeFile(join(original.inbox,'broken.png'),Buffer.from([137,80,78,71,13,10,26,10,1]));
  await call('task_complete_handoff',{taskId,filename:'broken.png'},'invalid_image');
  await assert.rejects(readFile(waiting.handoff.output),{code:'ENOENT'});
  await writeFile(join(original.inbox,'valid.png'),await png('blue'));
  await call('project_update',{requestId:uid(),projectId,expectedVersion:original.projectVersion,patch:{culture:'已经改变的创作语境'}});
  await call('task_complete_handoff',{taskId,filename:'valid.png'});const done=await wait(taskId,'succeeded');
  const bytes=await readFile(waiting.handoff.output);const version=(await call('project_get',{projectId})).projectVersion;
  await call('task_adopt',{taskId,expectedVersion:version},'stale_result');
  await writeFile(join(original.inbox,'valid.png'),await png('red'));
  await call('task_complete_handoff',{taskId,filename:'valid.png'},'handoff_conflict');
  assert.deepEqual(await readFile(waiting.handoff.output),bytes);assert.equal((await call('task_get',{taskId})).result.asset.id,done.result.asset.id);
  assert.equal((await call('project_get',{projectId})).project.concepts[0].candidateAssetId,undefined);
  // Old persisted messages are upgraded when read without mutating the task.
  const path=join(directory,'tasks',taskId+'.json');const saved=JSON.parse(await readFile(path,'utf8'));saved.handoffMessage='旧版消息';await writeFile(path,JSON.stringify(saved));
  const fresh=await call('task_get',{taskId});assert.equal(fresh.handoffContract.taskId,taskId);assert.ok(fresh.handoffMessage.includes('不新建任务'));
});

test('atomic handoff publication never replaces another result, even under concurrent completion',async t=>{
  const directory=await mkdtemp(join(tmpdir(),'handoff-publish-'));t.after(()=>rm(directory,{recursive:true,force:true}));
  const repo=createRepository(directory);const handoff=await repo.handoff('original','test',[]);const blue=await png('blue');const red=await png('red');
  const result=await Promise.allSettled([repo.completeImageHandoff('original',blue),repo.completeImageHandoff('original',red)]);
  assert.equal(result.filter(r=>r.status==='fulfilled').length,1);assert.equal(result.find(r=>r.status==='rejected').reason.code,'handoff_conflict');
  const winner=[blue,red][result.findIndex(r=>r.status==='fulfilled')];
  assert.deepEqual(await readFile(handoff.output),winner);assert.equal((await repo.completeImageHandoff('original',winner)).alreadyWritten,true);
});
