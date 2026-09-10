import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import sharp from 'sharp';
import ffmpeg from 'ffmpeg-static';
import {unzipSync,strFromU8,zipSync,strToU8} from 'fflate';
import {createRepository} from '../lib/workbench/repository.mjs';
import {createTaskManager} from '../lib/workbench/tasks.mjs';
import {createCoreService} from '../lib/workbench/core-service.mjs';
import {CORE_PROTOCOL} from '../lib/workbench/protocol.mjs';
import {coreTools} from '../lib/workbench/core-contract.mjs';
import {createProject} from '../lib/workbench/project-core.mjs';
import {themeAssets,applyThemeAssets} from '../lib/workbench/theme-assets.mjs';
import {switchWorkType,inheritWorkType,selectedTransfers,transferChanges} from '../lib/workbench/workflow.mjs';
import {buildWebsitePrompt,websitePromptBasis,websitePromptStale} from '../lib/workbench/prompts.mjs';
import {prepareWebsiteRequest} from '../lib/workbench/website-request.mjs';
import {projectOutputIds} from '../lib/workbench/output-contract.mjs';
import {parseStoredWorkspace} from '../features/projects/model.ts';
import {runMediaProcess,boundedMediaArgs} from '../lib/workbench/media-process.mjs';
import {streamZip,textEntry,readZipMember} from '../lib/workbench/zip-stream.mjs';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {createRuntimeServer} from '../lib/workbench/http-server.mjs';
import {fileURLToPath} from 'node:url';
import {once} from 'node:events';
const uid=()=>randomUUID(),sha=b=>createHash('sha256').update(b).digest('hex');
async function setup(t) {
  const directory=await mkdtemp(join(tmpdir(),'tourism-workflow-'));const repo=createRepository(directory);const tasks=createTaskManager(repo);const core=createCoreService(repo,tasks,{env:{}});
  t.after(async()=>{await tasks.stop();await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:30});});
  return {directory,repo,tasks,core};
}
test('all six theme assets are usable local originals; core selection is idempotent and carries sources into the actual bundle',async t=>{
  const {repo,core}=await setup(t);const catalog=await core.call('theme_asset_list',{});assert.equal(catalog.entries.length,6);assert.equal((await core.call('theme_asset_list',{query:'满洲'})).entries[0].id,'manzhou-window');
  for(const e of catalog.entries){const info=await sharp(await readFile(e.pngPath)).metadata();assert.equal(info.width,e.width);assert.equal(info.height,e.height);const svg=await readFile(e.svgPath,'utf8');assert.match(svg,/<svg/);assert.doesNotMatch(svg,/<script|<image|href=/);assert.ok(e.sources.every(s=>s.url.startsWith('https://')));}
  const initial=await core.call('project_create',{requestId:uid(),type:'website',idea:'当代岭南文化专题'});
  const input={projectId:initial.projectId,expectedVersion:initial.projectVersion,requestId:uid(),entryIds:themeAssets.map(e=>e.id)};
  await core.call('workbench_call_json',{tool:'theme_asset_apply',argumentsJson:JSON.stringify(input)});
  assert.equal((await core.call('theme_asset_apply',input)).replayed,true);const picked=await core.call('project_get',{projectId:initial.projectId});assert.equal(picked.project.assets.length,6);assert.equal(picked.project.concepts.length,6);assert.equal(picked.project.knowledge.length,4);
  const result=await prepareWebsiteRequest({id:uid(),snapshot:picked.project,args:{handoffOnly:true}},{repository:repo,update:async()=>{}});
  const files=unzipSync(await repo.output(result.websiteRequest.bundleFileId));const materials=JSON.parse(strFromU8(files['materials.json']));
  assert.equal(materials.assets.length,6);assert.match(strFromU8(files['KNOWLEDGE.md']),/满洲窗/);
  for(const a of materials.assets){assert.ok(files[a.filename]?.length);assert.match(strFromU8(files[`theme-original-${a.id}.svg`]),/<svg/);assert.ok(a.themeAsset.rights&&a.themeAsset.sources.length);}
  assert.equal((await core.call('theme_asset_list',{query:'客家'})).entries.length,0,'no invented coverage');
  const manual=structuredClone(picked.project);manual.concepts[0].description='用户调整后的用途与设定';assert.equal(applyThemeAssets(manual,[manual.assets[0]]).concepts.find(c=>c.id===manual.concepts[0].id).description,'用户调整后的用途与设定');
});
test('complete novel and real MP4/subtitles survive multiple type transfers and enter a direct website handoff',async t=>{
  const {directory,repo}=await setup(t);const path=join(directory,'movement.mp4');
  await runMediaProcess(ffmpeg,boundedMediaArgs(['-y','-f','lavfi','-i','testsrc2=size=320x180:rate=6','-t','2','-c:v','libx264','-pix_fmt','yuv420p',path]));
  const video=await repo.putOutput(await readFile(path),'mp4'),sub=await repo.putOutput(Buffer.from('1\n00:00:00,000 --> 00:00:01,900\n原创示意\n'),'srt');
  let p=createProject('文化到文旅网站','novel');p.content.novel.story='梗概独有_MARK_OUTLINE';p.novel={title:'廊下的信',text:'完整正文_BEGIN'+('后续原文。'.repeat(9000))+'完整正文_END',taskId:'body-original'};
  p=switchWorkType(p,'video');p.video={ratio:'16:9',shots:[],keepAudio:false,burnSubtitles:false,final:{...video,subtitleFileId:sub.fileId,duration:2,source:'fixture-moving-video',taskId:'video-original'}};
  p=switchWorkType(p,'website');p=inheritWorkType(p,'novel',{brief:false});p=inheritWorkType(p,'video',{brief:false,mediaIds:[video.fileId,sub.fileId]});
  assert.equal(selectedTransfers(p).length,2);assert.ok(buildWebsitePrompt(p).includes('source-novel-novel.md'));assert.ok(buildWebsitePrompt(p).includes(video.fileId));
  await repo.saveWorkspace({projects:[p],activeProjectId:p.id},0,uid());p=parseStoredWorkspace(await repo.loadWorkspace()).workspace.projects[0];
  assert.ok(projectOutputIds(p).includes(video.fileId));assert.deepEqual(transferChanges(p),[]);
  const result=await prepareWebsiteRequest({id:uid(),snapshot:p,args:{handoffOnly:true}},{repository:repo,update:async()=>{}});
  const files=unzipSync(await repo.output(result.websiteRequest.bundleFileId));assert.match(strFromU8(files['source-novel-novel.md']),/完整正文_END$/);assert.equal(JSON.parse(strFromU8(files['TRANSFER.json']))[0].novel.text.length,p.variants.novel.novel.text.length);
  assert.equal(sha(files['media-'+video.fileId]),video.fileId.split('.')[0]);assert.match(strFromU8(files['media-'+sub.fileId.replace('.srt','.vtt')]),/^WEBVTT\n\n1\n00:00:00\.000/);
  assert.match(strFromU8(files['SOURCES.json']),/完整正文_END/);
  p.websiteRequest={prompt:buildWebsitePrompt(p),basis:websitePromptBasis(p),assetIds:[]};p.variants.novel.novel.text+='新段落';assert.equal(websitePromptStale(p),true);assert.deepEqual(transferChanges(p),['novel']);
  assert.throws(()=>inheritWorkType(p,'video',{mediaIds:['a'.repeat(64)+'.mp4']}),/已采用/);
});
test('streaming ZIP backpressure, cancellation and selective preview do not retain unrelated files',async t=>{
  const {repo}=await setup(t);let produced=0;
  const entries=[{name:'large.bin',chunks:async function*(){for(let i=0;i<64;i++){produced++;yield Buffer.alloc(64*1024,17);}}},textEntry('index.html','<!doctype html><title>预览</title>')];
  const iterator=streamZip(entries);await iterator.next();assert.equal(produced,1,'only one input chunk is pulled before consumer advances');await iterator.return();
  const {fileId}=await repo.putOutputStream(streamZip(entries));assert.equal((await readZipMember(repo.fileChunks(fileId),'index.html')).toString(),'<!doctype html><title>预览</title>');
  const compressed=await repo.putOutput(Buffer.from(zipSync({'unused.bin':new Uint8Array(4*1024*1024),'a.css':strToU8('body{color:red}')})),'zip');assert.equal((await readZipMember(repo.fileChunks(compressed.fileId),'a.css')).toString(),'body{color:red}');
  const controller=new AbortController();controller.abort();await assert.rejects(repo.putOutputStream(streamZip(entries,{signal:controller.signal})));assert.ok((await readdir(join(repo.root,'files'))).every(n=>!n.endsWith('.tmp')));
  const unsafe=await repo.putOutput(Buffer.from(zipSync({'../index.html':strToU8('<html>')})),'zip');await assert.rejects(readZipMember(repo.fileChunks(unsafe.fileId),'index.html'),e=>e.code==='invalid_source');
  await assert.rejects(readZipMember(repo.fileChunks(fileId),'missing.css'),e=>e.code==='missing_file');
  const preview=await repo.putOutput(Buffer.from(zipSync({'index.html':strToU8('<html><video controls></video></html>'),'clip.mp4':new Uint8Array(100).fill(42),'captions.vtt':strToU8('WEBVTT\n\n00:00.000 --> 00:01.000\n字幕')})),'zip');
  const runtime=createRuntimeServer({dataDirectory:repo.root,env:{}});runtime.listen(0,'127.0.0.1');await once(runtime,'listening');
  try{
    const base='http://127.0.0.1:'+runtime.address().port+'/v1/source-preview/'+preview.fileId+'/';
    const video=await fetch(base+'clip.mp4',{headers:{Range:'bytes=10-19'}});assert.equal(video.status,206);assert.equal(video.headers.get('content-range'),'bytes 10-19/100');assert.equal((await video.arrayBuffer()).byteLength,10);
    const captions=await fetch(base+'captions.vtt');assert.match(captions.headers.get('content-type'),/^text\/vtt/);await captions.text();
  }finally{await new Promise(r=>runtime.close(r));}
});
test('task cache remains bounded by bytes and count while old tasks remain readable',async t=>{
  const {repo}=await setup(t);
  for(let i=0;i<80;i++)await repo.saveTask({id:'history-'+i,projectId:'p',status:'succeeded',snapshot:{type:'website',novel:{text:'正文'.repeat(50000)}}});
  for(let i=0;i<3;i++){const list=await repo.listTasks({summary:true});assert.equal(list.length,80);assert.ok(list.every(t=>!t.snapshot));const stats=repo.cacheStats().tasks;assert.ok(stats.entries<=64);assert.ok(stats.weight<=8*1024*1024);}
  assert.equal((await repo.task('history-0')).snapshot.novel.text.length,100000);
  await repo.saveTask({id:'oversized',projectId:'other',status:'succeeded',snapshot:{text:'x'.repeat(5*1024*1024)}});
  assert.equal((await repo.listTasks({projectId:'p',summary:true})).length,80);assert.ok(repo.cacheStats().tasks.weight<=8*1024*1024);
});
test('real stdio MCP selects theme art, transfers full text, prepares files and removes a reference without deleting the source',async t=>{
  const directory=await mkdtemp(join(tmpdir(),'tourism-stdio-'));const repo=createRepository(directory);
  const runtime=createRuntimeServer({dataDirectory:directory,env:{},fetchImpl:async()=>{throw Error('No provider call');}});runtime.listen(0,'127.0.0.1');await once(runtime,'listening');
  const client=new Client({name:'tourism-acceptance',version:'1'});const transport=new StdioClientTransport({command:process.execPath,args:[fileURLToPath(new URL('../scripts/workbench-mcp.mjs',import.meta.url))],cwd:directory,env:{WORKBENCH_RUNTIME_URL:'http://127.0.0.1:'+runtime.address().port,WORKBENCH_DATA_DIR:directory},stderr:'pipe'});
  t.after(async()=>{await client.close();await new Promise(r=>runtime.close(r));await rm(directory,{recursive:true,force:true,maxRetries:5});});await client.connect(transport);
  const call=async(name,args)=>{const result=await client.callTool({name,arguments:args});assert.ok(!result.isError,JSON.stringify(result));return JSON.parse(result.content[0].text);};
  assert.equal((await call('workbench_status',{})).coreProtocol,CORE_PROTOCOL);assert.deepEqual((await client.listTools()).tools.map(tool=>tool.name).sort(),Object.keys(coreTools).sort());
  let receipt=await call('project_create',{requestId:uid(),idea:'从正文到文化网站',type:'novel'});const projectId=receipt.projectId;
  const mutate=async(name,rest)=>receipt=await call(name,{projectId,expectedVersion:receipt.projectVersion,requestId:uid(),...rest});
  await mutate('project_update',{patch:{novel:{title:'原文',text:'只在正文出现的完整句子 STDIO_BODY',taskId:'authored'}}});await mutate('project_update',{patch:{type:'website'}});
  await mutate('workflow_update',{action:'inherit',from:'novel',content:true,brief:false});
  const input={projectId,expectedVersion:receipt.projectVersion,requestId:uid(),entryIds:['manzhou-window']};receipt=await call('workbench_call_json',{tool:'theme_asset_apply',argumentsJson:JSON.stringify(input)});
  const id=uid();await call('task_start',{projectId,expectedVersion:receipt.projectVersion,requestId:id,kind:'website'});
  let task;for(let i=0;i<100;i++){task=await call('task_get',{taskId:id});if(task.status==='succeeded')break;await new Promise(r=>setTimeout(r,20));}assert.equal(task.status,'succeeded');
  const files=unzipSync(await repo.output(task.result.websiteRequest.bundleFileId));assert.match(strFromU8(files['source-novel-novel.md']),/STDIO_BODY/);assert.ok(files['theme-original-theme-manzhou-window.svg']);
  await mutate('workflow_update',{action:'remove-inherited',from:'novel'});const p=(await call('project_get',{projectId})).project;assert.equal(p.transfers.length,0);assert.match(p.variants.novel.novel.text,/STDIO_BODY/);
});
