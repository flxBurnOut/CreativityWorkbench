// Bounded local regression experiment. Not a proof that every provider or
// browser is leak-free. Never recreate the reported multi-gigabyte exhaustion.
import '../lib/workbench/temp-env.mjs';
import {mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {once} from 'node:events';
import {createRepository} from '../lib/workbench/repository.mjs';
import {createRuntimeServer} from '../lib/workbench/http-server.mjs';
import {createProject} from '../lib/workbench/project-core.mjs';
import {taskSource} from '../lib/workbench/task-contract.mjs';
import {createTaskPoller} from '../features/creative-flow/task-poller.mjs';
import {streamZip,textEntry,readZipMember} from '../lib/workbench/zip-stream.mjs';
import {createTestDirectory,closeTestServer} from '../tests/helpers/test-directory.mjs';
if(!global.gc)throw Error('请用 npm run test:memory（启用 GC 采样）。');
const keep=process.argv.includes('--keep-fixtures');
if(process.argv.slice(2).some(arg=>arg!=='--keep-fixtures'))throw Error('仅支持 --keep-fixtures 调试选项；默认清理测试数据，只保留报告。');
const root=fileURLToPath(new URL('../work/',import.meta.url));
const fixture=await createTestDirectory(null,'memory-check',{keep}),directory=fixture.directory;
if(keep)console.log('调试模式：保留测试数据 '+directory);
try {
const repo=createRepository(directory);await repo.initialize();
for(let i=0;i<96;i++)await repo.saveTask({id:'history-'+i,projectId:'memory-fixture',kind:'novel',status:'succeeded',snapshot:{type:'novel',flow:{records:[{value:'文化原文'.repeat(15000)}]}}});
const imageProject=createProject('图片状态内存采样','website','图片状态采样','image-memory-fixture');
imageProject.concepts=[{id:'object-a',category:'object',name:'测试对象',description:'只验证状态投影',prompt:'',revisionRequest:''}];
await repo.saveWorkspace({projects:[imageProject],activeProjectId:imageProject.id},0,crypto.randomUUID());
const imageArgs={objectId:'object-a',action:'generate',provider:'workbuddy',ratio:'1:1'};
for(let i=0;i<48;i++)await repo.saveTask({id:'image-history-'+i,projectId:imageProject.id,workType:'website',kind:'image',status:'succeeded',args:imageArgs,source:taskSource(imageProject,'image',imageArgs),snapshot:imageProject,createdAt:i,result:{asset:{id:'image-result-'+i,name:'状态测试图片',fileId:'a'.repeat(64)}}});
const entries=[{name:'unused.bin',chunks:async function*(){for(let i=0;i<256;i++)yield Buffer.alloc(64*1024,29);}},textEntry('index.html','<!doctype html><title>内存验证</title>')];
const output=await repo.putOutputStream(streamZip(entries));
let large=Buffer.alloc(16*1024*1024,17);const media=await repo.putOutput(large,'mp4');large=null;
const server=createRuntimeServer({dataDirectory:directory,env:{}});fixture.defer(()=>closeTestServer(server));server.listen(0,'127.0.0.1');await once(server,'listening');const base='http://127.0.0.1:'+server.address().port;
const samples=[];let maxSampledRss=0;
const call=async(name,args)=>{const response=await fetch(base+'/v1/core/'+name,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(args)});const data=await response.json();if(!response.ok)throw Error(JSON.stringify(data));return data;};
const websiteProject=await call('project_create',{requestId:crypto.randomUUID(),idea:'内存测试网站',type:'website'});let websiteRuns=0;
let imagePolls=0;const poller=createTaskPoller({load:async(_id,signal)=>{const response=await fetch(base+'/v1/tasks?projectId='+imageProject.id,{signal});if(!response.ok)throw Error('Task projection failed');return response.json();},onData:data=>{if(data.tasks.length!==48||!data.tasks.every(t=>t.imageState?.binding==='unbound'&&!t.imageState.stale))throw Error('Image state projection failed');imagePolls++;},onError:error=>{throw error;}});
fixture.defer(()=>poller.cancel());
const collect=async cycle=>{global.gc();await new Promise(r=>setImmediate(r));global.gc();const memory=process.memoryUsage();samples.push({cycle,...memory,cache:repo.cacheStats().tasks});maxSampledRss=Math.max(maxSampledRss,memory.rss);console.log(JSON.stringify({cycle,heapMiB:+(memory.heapUsed/1048576).toFixed(2),rssMiB:+(memory.rss/1048576).toFixed(2),externalMiB:+(memory.external/1048576).toFixed(2),cacheMiB:+(repo.cacheStats().tasks.weight/1048576).toFixed(2)}));};
  for(let cycle=1;cycle<=30;cycle++) {
    await repo.listTasks({summary:true});await repo.putOutputStream(streamZip(entries));await readZipMember(repo.fileChunks(output.fileId),'index.html');
    for(let n=0;n<4;n++){const response=await fetch(base+'/v1/files/'+media.fileId,{headers:{Range:'bytes=0-1023'}});if(response.status!==206||(await response.arrayBuffer()).byteLength!==1024)throw Error('Range response failed');}
    for(let n=0;n<10;n++)await poller.refresh(imageProject.id);poller.cancel();
    const current=await call('project_get',{projectId:websiteProject.projectId}),id=crypto.randomUUID();
    await call('website_run',{projectId:websiteProject.projectId,requestId:id,expectedVersion:current.projectVersion,goal:'内存测试页面 '+cycle,autoAssets:false});
    let waiting;for(let n=0;n<100;n++){waiting=await call('task_get',{taskId:id});if(waiting.status==='waiting_external')break;await new Promise(r=>setTimeout(r,10));}
    if(waiting.status!=='waiting_external')throw Error('Website handoff not prepared');
    await writeFile(join(current.inbox,'result.zip'),await repo.output(output.fileId));await call('website_complete',{taskId:id,filename:'result.zip'});
    for(let n=0;n<100;n++){const done=await call('task_get',{taskId:id});const received=await call('project_get',{projectId:websiteProject.projectId});if(done.status==='succeeded'&&received.project.websiteSourceCandidate?.taskId===id){websiteRuns++;break;}await new Promise(r=>setTimeout(r,10));}
    if(cycle%5===0)await collect(cycle);
  }
  const warm=samples.find(s=>s.cycle===10),last=samples.at(-1);
  const report={...(keep?{retainedFixtureDirectory:directory}:{}),recordedAt:new Date().toISOString(),node:process.version,platform:process.platform,cycles:30,fixtures:{historicalTasks:96,imageTasks:48,imagePolls,websiteRuns,zipMiB:16,rangeFileMiB:16,rangeRequests:120},samples,postWarmupHeapGrowthBytes:last.heapUsed-warm.heapUsed,maxSampledRss,
    acceptance:{cacheBounded:samples.every(s=>s.cache.weight<=8*1048576&&s.cache.entries<=64),postWarmupHeapGrowthBelow16MiB:last.heapUsed-warm.heapUsed<16*1048576,imagePollingCompleted:imagePolls===300,websiteRoundtripsCompleted:websiteRuns===30},scope:'同一 Node 进程反复列任务、投影图片状态、复用/取消轮询器、30 次网站准备与真实 ZIP 接收、打包/预览与 Range；GC 后采样不是瞬时峰值，不覆盖 WorkBuddy、浏览器或真实供应商的长时运行。'};
  await mkdir(join(root,'deliverables'),{recursive:true});await writeFile(join(root,'deliverables/memory-check.json'),JSON.stringify(report,null,2));
  if(!Object.values(report.acceptance).every(Boolean))process.exitCode=1;
}finally{await fixture.dispose();}
