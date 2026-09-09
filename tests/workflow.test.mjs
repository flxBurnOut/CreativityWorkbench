import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {once} from 'node:events';
import http from 'node:http';
import sharp from 'sharp';
import {zipSync,unzipSync,strToU8,strFromU8} from 'fflate';
import {createProject,applyTaskResult} from '../lib/workbench/project-core.mjs';
import {createRepository,digest} from '../lib/workbench/repository.mjs';
import {createTaskManager} from '../lib/workbench/tasks.mjs';
import {createCoreService} from '../lib/workbench/core-service.mjs';
import {createRuntimeServer} from '../lib/workbench/http-server.mjs';
import {taskSource,contentKeys} from '../lib/workbench/task-contract.mjs';
import {switchWorkType,inheritWorkType,projectForType,restoreRecord,flowWarnings,assetChanges} from '../lib/workbench/workflow.mjs';
import {projectOutputIds} from '../lib/workbench/output-contract.mjs';
import {websitePromptBasis,videoPromptBasis} from '../lib/workbench/prompts.mjs';
import {inspectWebsiteZip,importWebsiteSource} from '../lib/workbench/workflow-delivery.mjs';
import {parseStoredWorkspace,pruneAssets} from '../features/projects/model.ts';
import {sourcePreviewMiddleware} from '../lib/workbench/preview-dev.mjs';

const uid=()=>crypto.randomUUID();
const workspace=p=>({projects:[p],activeProjectId:p.id});
const png=color=>sharp({create:{width:48,height:32,channels:3,background:color}}).png().toBuffer();
const shot=()=>({id:'shot-a',title:'当前镜头',visual:'阿澄打开旧伞',camera:'固定中景',duration:5,narration:'',subtitle:'',revision:''});
async function setup(t,type='novel',fetchImpl=async()=>{throw Error('No external requests expected');}) {
  const directory=await mkdtemp(join(tmpdir(),'workflow-'));
  const repo=createRepository(directory);const env={DEEPSEEK_API_KEY:'mock',IMAGE_API_KEY:'mock',WORKBUDDY_ACCESS_TOKEN:'mock',VIDEO_API_KEY:'mock'};
  const tasks=createTaskManager(repo,{env,fetchImpl});const core=createCoreService(repo,tasks,{env,fetchImpl});
  let p=createProject('当代潮汕阿澄与修伞物件 Q-027',type);p.culture='当代潮汕；阿澄为虚构人物，不冒充历史人物';
  await repo.saveWorkspace(workspace(p),0,uid());
  const get=async()=> (await repo.loadWorkspace()).workspace.projects[0];
  const save=async value=>{const ws=await repo.loadWorkspace();await repo.saveWorkspace(workspace(value),ws.revision,uid());return get();};
  const until=async(id,status='succeeded')=>{for(let i=0;i<300;i++){const task=await tasks.get(id);if(task.status===status)return task;if(['failed','uncertain'].includes(task.status))throw Error(JSON.stringify(task));await new Promise(r=>setTimeout(r,10));}throw Error('task timeout');};
  const run=async(kind,args={},status='succeeded')=>{const current=await get();const task=await tasks.submit({id:uid(),projectId:p.id,kind,args,source:taskSource(current,kind,args)});return until(task.id,status);};
  const adopt=async(task,selection)=>save(applyTaskResult(await get(),task,selection));
  t.after(async()=>{await tasks.stop();await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:30});});
  return {p,repo,tasks,core,get,save,run,adopt,until,directory};
}
test('type branches retain existing outputs and isolate art, objects, requests and explicit transfer across restart',async t=>{
  const h=await setup(t);let p=await h.get();
  p.art.palette='小说冷灰';p.brief='小说主题';p.content.novel={story:'原小说梗概',characters:'阿澄保持现代衬衫'};p.delivery.notes='完整短篇';p.novel={title:'已写正文',text:'原正文',taskId:'legacy'};
  const image=await h.repo.putImage(await png('teal'));p.assets=[{id:'person-image',name:'人物图',fileId:image.fileId}];p.concepts=[{id:'person',name:'阿澄',category:'character',description:'现代衬衫',prompt:'',revisionRequest:'',savedAssetId:'person-image'}];
  p=await h.save(p);p=switchWorkType(p,'website');assert.equal(p.art.palette,'');assert.deepEqual(p.concepts,[]);assert.equal(p.novel,undefined);assert.equal(p.content.novel.story,'原小说梗概');
  p.art.palette='网站青绿';p.content.website={goal:'作品展示'};p=await h.save(p);
  p=inheritWorkType(p,'novel',{brief:true,content:true,art:false,conceptIds:['person']});assert.equal(p.art.palette,'网站青绿');assert.equal(p.transfer.content.characters,'阿澄保持现代衬衫');assert.notEqual(p.concepts[0].id,'person');assert.equal(p.concepts[0].savedAssetId,'person-image');
  p=await h.save(p);p=switchWorkType(p,'novel');assert.equal(p.art.palette,'小说冷灰');assert.equal(p.delivery.notes,'完整短篇');assert.equal(p.novel.text,'原正文');
  p=await h.save(p);const restored=parseStoredWorkspace(await h.repo.loadWorkspace()).workspace.projects[0];assert.equal(projectForType(restored,'website').art.palette,'网站青绿');assert.equal(pruneAssets(restored).assets.length,1);
  const legacy={...createProject('旧多类型项目','video'),novel:{title:'旧小说',text:'旧正文',taskId:'old'},video:{ratio:'16:9',shots:[shot()],burnSubtitles:false,keepAudio:false}};
  legacy.websiteRequest={prompt:'旧网站任务编辑稿',basis:'旧依据',assetIds:[]};assert.equal(switchWorkType(legacy,'website').websiteRequest.prompt,'旧网站任务编辑稿');assert.equal(switchWorkType(legacy,'novel').novel.text,'旧正文');assert.equal(switchWorkType(switchWorkType(legacy,'novel'),'video').video.shots[0].id,'shot-a');
});

for(const type of ['novel','video','website','craft','undecided'])test(type+': adopted text, object updates and actual images continuously feed the next generation',async t=>{
  const calls=[];const image=await png('teal');let response;
  const h=await setup(t,type,async(url,options)=>{
    if(String(url).includes('images/')){const images=options.body instanceof FormData?await Promise.all(options.body.getAll('image[]').map(async f=>Buffer.from(await f.arrayBuffer()))):[];calls.push({images,prompt:options.body instanceof FormData?options.body.get('prompt'):JSON.parse(options.body).prompt});return Response.json({data:[{b64_json:image.toString('base64')}]});}
    const body=JSON.parse(options.body);calls.push(body);return Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify(response)}}]});
  });
  response={title:'Q-027',brief:'沿用当代潮汕生活，保留编号 Q-027',culture:h.p.culture};await h.adopt(await h.run('creative',{action:'improve'}));
  response={sections:Object.fromEntries(contentKeys[type].map(k=>[k,'已确认 '+k+'：阿澄、旧伞与 Q-027']))};await h.adopt(await h.run('content',{action:'generate'}));assert.match(JSON.parse(calls.at(-1).messages[1].content).brief,/Q-027/);
  response={direction:'当代写实',material:'棉布与竹柄',palette:'冷灰',constraints:'无古装',fullPrompt:'完整美术表达'};await h.adopt(await h.run('art'));assert.match(JSON.stringify(JSON.parse(calls.at(-1).messages[1].content).content),/已确认/);
  response={objects:[{category:'object',name:'旧伞',description:'阿澄的竹柄旧伞',sourceKeys:[contentKeys[type][0]],usage:type==='website'?'作品详情图':'主体形体参考'}]};let p=await h.adopt(await h.run('objects'));const objectId=p.concepts[0].id;
  response={objects:[{id:objectId,category:'object',name:'修补后的旧伞',description:'保留竹柄，增加用户指定的补丁',sourceKeys:[contentKeys[type][0]]}]};p=await h.adopt(await h.run('objects'),{objectIds:[objectId]});assert.equal(p.concepts.length,1);assert.equal(p.concepts[0].id,objectId);assert.equal(p.concepts[0].usage,type==='website'?'作品详情图':'主体形体参考');
  p=await h.adopt(await h.run('image',{provider:'external',ratio:'3:2',action:'generate',objectId}));const assetId=p.concepts[0].candidateAssetId;p.concepts[0].savedAssetId=assetId;p=await h.save(p);
  p.concepts[0].referenceAssetIds=[assetId];p.concepts[0].revisionRequest='只调整背景，其余保持';p=await h.save(p);
  await h.adopt(await h.run('image',{provider:'external',ratio:'3:2',action:'edit',objectId}));const last=calls.at(-1);assert.deepEqual(last.images[0],await h.repo.media(p.assets.find(a=>a.id===assetId).fileId));assert.match(last.prompt,/补丁/);assert.match(last.prompt,/只调整背景/);assert.match(last.prompt,/棉布与竹柄/);
  if(type==='website'||type==='craft'){const unrelated=structuredClone(p);delete unrelated.concepts[0].sourceKeys;const args={objectId,action:'generate',provider:'external',ratio:'3:2'};const before=taskSource(unrelated,'image',args);unrelated.content[type][type==='website'?'copy':'display']='只修改按钮文案或展示背景';assert.equal(taskSource(unrelated,'image',args),before,'unrelated copy/display does not invalidate an unbound object image');}
  if(type==='novel') {response={title:'Q-027 的短篇',text:'阿澄修补旧伞，保留竹柄和指定补丁。'.repeat(15),complete:true};await h.adopt(await h.run('novel',{action:'generate'}));const input=JSON.parse(calls.at(-1).messages[1].content);assert.equal(input.adoptedObjects[0].name,'修补后的旧伞');assert.match(input.visualReferenceStatus,/未附图片/);response={sections:{characters:'正文确认：阿澄保持现代衬衫',world:'正文确认：当代潮汕街区'}};const suggestion=await h.run('content',{action:'generate',fromNovel:true});const original=(await h.get()).content.novel.world;p=await h.adopt(suggestion,{sectionKeys:['characters']});assert.equal(p.content.novel.world,original);assert.match(p.content.novel.characters,/正文确认/);}
  if(type==='craft'||type==='undecided'){p=await h.adopt(await h.run('design-package'));const entries=unzipSync(await h.repo.output(p.designPackage.fileId));assert.ok(entries['DESIGN.json']);assert.ok(Object.keys(entries).some(k=>k.startsWith('asset-')));assert.match(strFromU8(entries['README.md']),type==='craft'?/没有生成模型/:/未确定媒介/);}
});

test('related changes are identified precisely; prior object and image versions remain restorable',async t=>{
  const h=await setup(t);let p=await h.get();p.content.novel={characters:'阿澄：现代衬衫',world:'当代街区'};p.concepts=[{id:'person',name:'阿澄',category:'character',description:'现代衬衫',prompt:'',revisionRequest:'',sourceKeys:['characters']}];p=await h.save(p);
  const record=p.flow.records.findLast(r=>r.target==='concept:person');assert.ok(record);
  p.content.novel.world='雨后的当代街区';p=await h.save(p);assert.equal(flowWarnings(p).some(w=>w.target==='concept:person'),false);
  p.content.novel.characters='阿澄：用户改为现代外套';p=await h.save(p);assert.ok(flowWarnings(p).find(w=>w.target==='concept:person').changes.some(d=>d.key==='content:characters'));
  p.concepts[0].description='现代外套';p=await h.save(p);assert.equal(flowWarnings(p).some(w=>w.target==='concept:person'),false);
  p=await h.save(restoreRecord(p,record.id));assert.equal(p.concepts[0].description,'现代衬衫');assert.ok(p.flow.records.some(r=>r.value?.description==='现代外套'));
  assert.ok(flowWarnings(p).find(w=>w.target==='concept:person').changes.some(d=>d.key==='content:characters'),'restoring an old version must preserve its old dependencies');
});

test('selected concepts prepare a real frame candidate, then that exact adopted file enters image-to-video',async t=>{
  const first=await png('red'),second=await png('blue'),frame=await png('green');const requests=[];
  const h=await setup(t,'video',async(url,options)=>{
    if(String(url).includes('images/')){requests.push({kind:'frame',images:await Promise.all(options.body.getAll('image[]').map(async f=>Buffer.from(await f.arrayBuffer()))),prompt:options.body.get('prompt')});return Response.json({data:[{b64_json:frame.toString('base64')}]});}
    if(String(url).endsWith('/image_to_video')){requests.push({kind:'video',body:JSON.parse(options.body)});return Response.json({id:'provider-video'});}
    if(String(url).includes('/tasks/'))return Response.json({id:'provider-video',status:'RUNNING'});
    throw Error('Unexpected provider request');
  });
  let p=await h.get();const a=await h.repo.putImage(first),b=await h.repo.putImage(second);
  p.assets=[{id:'person-image',name:'阿澄',fileId:a.fileId},{id:'scene-image',name:'雨后街巷',fileId:b.fileId}];p.concepts=[{id:'person',name:'阿澄',category:'character',description:'现代衬衫',prompt:'',revisionRequest:'',savedAssetId:'person-image'},{id:'scene',name:'街巷',category:'map',description:'当代生活场景',prompt:'',revisionRequest:'',savedAssetId:'scene-image'}];
  p.video={ratio:'16:9',shots:[{...shot(),conceptIds:['person','scene'],frameReferenceIds:['person-image','scene-image'],frameInstruction:'阿澄站在街巷中景，旧伞尚未打开'}],burnSubtitles:false,keepAudio:false};p=await h.save(p);
  p=await h.adopt(await h.run('video-frame',{provider:'external',ratio:'3:2',action:'generate',objectId:'shot-a'}));assert.equal(requests[0].images.length,2);assert.deepEqual(requests[0].images[0],await h.repo.media(a.fileId));assert.match(requests[0].prompt,/尚未打开/);
  const frameAsset=p.assets.find(a=>a.id===p.video.shots[0].frameCandidate);assert.equal(assetChanges(p,frameAsset).length,0);
  p.video.shots[0].referenceAssetId=frameAsset.id;p.video.shots[0].frameCandidate=undefined;p.video.shots[0].prompt='当代潮汕，阿澄保持现代衬衫，在雨后街巷缓缓打开旧伞，固定中景，5 秒。';p.video.shots[0].promptBasis=videoPromptBasis(p,p.video.shots[0]);p=await h.save(p);
  assert.equal(assetChanges(p,frameAsset).length,0,'adopting the prepared frame does not change its generation inputs');
  const current=await h.core.call('project_get',{projectId:p.id});
  await h.core.call('video_frame_fit',{projectId:p.id,expectedVersion:current.projectVersion,requestId:uid(),objectId:'shot-a',fit:'pad'});p=await h.get();
  const fitted=p.assets.find(a=>a.id===p.video.shots[0].referenceAssetId);assert.equal(fitted.source.parentAssetId,frameAsset.id);assert.deepEqual(await h.repo.media(frameAsset.fileId),frame);
  p.video.shots[0].promptBasis=videoPromptBasis(p,p.video.shots[0]);p=await h.save(p);
  await h.run('video-shot',{provider:'external',objectId:'shot-a'},'waiting_provider');const sent=requests.find(r=>r.kind==='video').body;
  assert.equal(sent.promptText,p.video.shots[0].prompt);assert.deepEqual(Buffer.from(sent.promptImage.split(',')[1],'base64'),await h.repo.media(fitted.fileId));assert.equal(sent.duration,5);
});

test('website source is imported as a candidate, adopted, packaged exactly for the next round, and old source is retained',async t=>{
  const h=await setup(t,'website');let p=await h.get();
  const source1=Buffer.from(zipSync({'index.html':strToU8('<!doctype html><button id="filter">Q-027</button><script>document.querySelector("button").onclick=()=>document.querySelector("button").textContent="changed"</script>'),'README.md':strToU8('Open index.html')}));
  await writeFile(join(await h.repo.inbox(p.id),'source.zip'),source1);
  let current=await h.core.call('project_get',{projectId:p.id});
  const imported=await h.core.call('website_source_import',{projectId:p.id,expectedVersion:current.projectVersion,requestId:uid(),filename:'source.zip',instructions:'打开 index.html',verification:'执行端报告：已测试按钮',verificationMethod:'user-browser',verificationResult:'failed',verificationEvidence:'实际浏览器再次展开失败'});
  p=await h.get();assert.equal(p.websiteSource,undefined);assert.ok(p.websiteSourceCandidate);
  await h.core.call('workflow_update',{projectId:p.id,expectedVersion:imported.projectVersion,requestId:uid(),action:'adopt-website-source'});p=await h.get();assert.deepEqual(await h.repo.output(p.websiteSource.fileId),source1);
  const delivered=await h.core.call('project_deliver',{projectId:p.id,format:'all'});assert.equal(delivered.partial,true);assert.equal(delivered.files.find(f=>f.role==='website-source').verification.browserStatus,'reported-fail');assert.equal(parseStoredWorkspace({version:1,revision:1,workspace:workspace(p)}).workspace.projects[0].websiteSource.verificationEvidence,'实际浏览器再次展开失败');
  p.requests[4]='仅调整筛选，不改变原有页面和技术';p.websiteRequest={prompt:'读取 existing-website.zip，保留 Q-027 和现有实现，只完善筛选。',basis:websitePromptBasis(p),assetIds:[]};p.websiteRequest.basis=websitePromptBasis(p);p=await h.save(p);
  p=await h.adopt(await h.run('website',{action:'generate'}));const entries=unzipSync(await h.repo.output(p.websiteRequest.bundleFileId));assert.deepEqual(Buffer.from(entries['existing-website.zip']),source1);
  const first=p.websiteSource.fileId;const oldRecord=p.flow.records.findLast(r=>r.target==='websiteSource');
  const source2=Buffer.from(zipSync({'index.html':strToU8('<!doctype html><button>新版筛选 Q-027</button>')}));p.websiteSource=await importWebsiteSource(source2,h.repo,{verification:'未运行'});p=await h.save(p);assert.ok(projectOutputIds(p).includes(first));p=await h.save(restoreRecord(p,oldRecord.id));assert.equal(p.websiteSource.fileId,first);
  const before=digest(p);const info=await h.core.call('workflow_get',{projectId:p.id,kind:'website'});assert.ok(info.inputManifest.some(i=>i.key==='websiteSource'));assert.equal(digest(await h.get()),before);
  assert.throws(()=>inspectWebsiteZip(Buffer.from(zipSync({'../escape.js':strToU8('alert(1)')}))),/不安全/);
  assert.throws(()=>inspectWebsiteZip(Buffer.from(zipSync({'PROMPT.md':strToU8('Build a site')}))),/没有可识别/);
});

test('HTTP imports actual website sources and serves sandboxed static resources without permitting cross-origin writes',async t=>{
  const directory=await mkdtemp(join(tmpdir(),'workflow-http-'));const server=createRuntimeServer({dataDirectory:directory,env:{}});server.listen(0,'127.0.0.1');await once(server,'listening');t.after(async()=>{await new Promise(r=>server.close(r));await rm(directory,{recursive:true,force:true,maxRetries:5});});const base='http://127.0.0.1:'+server.address().port;
  const bytes=Buffer.from(zipSync({'index.html':strToU8('<!doctype html><link rel="stylesheet" href="style.css"><h1>Q-027</h1>'),'style.css':strToU8('h1{color:teal}')}));
  const imported=await fetch(base+'/v1/files/website-source',{method:'POST',headers:{'Content-Type':'application/octet-stream'},body:bytes});assert.equal(imported.status,201);const result=await imported.json();assert.equal(result.entryCount,2);
  const preview=await fetch(base+'/v1/source-preview/'+result.fileId+'/index.html');assert.equal(preview.status,200);assert.match(preview.headers.get('content-security-policy'),/sandbox allow-scripts/);assert.match(await preview.text(),/Q-027/);
  assert.equal((await fetch(base+'/v1/source-preview/'+result.fileId+'/style.css')).headers.get('content-type'),'text/css; charset=utf-8');
  assert.equal((await fetch(base+'/v1/files/website-source',{method:'POST',headers:{Origin:'https://example.com'},body:bytes})).status,403);
  const middleware=sourcePreviewMiddleware(base);const web=http.createServer((req,res)=>middleware(req,res,()=>{res.writeHead(403);res.end('not a preview read');}));web.listen(0,'127.0.0.1');await once(web,'listening');t.after(()=>new Promise(r=>web.close(r)));
  const webBase='http://127.0.0.1:'+web.address().port;const path='/api/workbench/data/source-preview/'+result.fileId+'/style.css';
  for(const origin of [undefined,'null']){const headers={'Sec-Fetch-Site':'cross-site','Sec-Fetch-Mode':'no-cors'};if(origin)headers.Origin=origin;const r=await fetch(webBase+path,{headers});assert.equal(r.status,200);assert.match(await r.text(),/color:teal/);assert.match(r.headers.get('content-security-policy'),/sandbox allow-scripts/);}
  assert.equal((await fetch(webBase+path,{method:'POST',headers:{Origin:'null'}})).status,403);
  assert.equal((await fetch(webBase+'/api/workbench/data/workspace',{headers:{Origin:'null'}})).status,403);
  const traversalStatus=await new Promise((resolve,reject)=>{const req=http.request(webBase,{path:'/api/workbench/data/source-preview/'+result.fileId+'/%2e%2e/%2e%2e/workspace',headers:{Origin:'null'}},res=>{res.resume();res.on('end',()=>resolve(res.statusCode));});req.on('error',reject);req.end();});assert.equal(traversalStatus,403,'preview forwarding cannot normalize a traversal into a workspace read');
});
