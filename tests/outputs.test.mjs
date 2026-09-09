import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import ffmpeg from 'ffmpeg-static';
import { unzipSync, strFromU8 } from 'fflate';
import { createRepository } from '../lib/workbench/repository.mjs';
import { createTaskManager } from '../lib/workbench/tasks.mjs';
import { taskSource } from '../lib/workbench/task-contract.mjs';
import { shotSource, audioSource, composeSource, validateSite } from '../lib/workbench/output-contract.mjs';
import { mediaCommand, importMedia, probeMedia, composeVideo } from '../lib/workbench/video-media.mjs';
import { buildWebsite } from '../lib/workbench/website.mjs';
import { submitVideo, downloadVideo } from '../lib/workbench/adapters/video.mjs';
import { createRuntimeServer, byteRange } from '../lib/workbench/http-server.mjs';
import { createProject, parseStoredWorkspace } from '../features/projects/model.ts';
import { applyTaskResult } from '../features/creative-flow/task-results.ts';

const spec=()=>({title:'岭南记忆',description:'一次文化浏览',accent:'#35765d',theme:'paper',pages:[{id:'home',title:'首页',intro:'骑楼里的故事',sections:[{kind:'gallery',title:'作品',body:'选择分类浏览',items:[{title:'葵扇',text:'日常用品',tag:'手艺'},{title:'街巷',text:'生活环境',tag:'空间'}]},{kind:'faq',title:'常见问题',body:'',items:[{title:'如何浏览？',text:'点击导航并搜索关键词。',tag:''}]}]},{id:'about',title:'关于',intro:'文化依据待核实',sections:[{kind:'text',title:'说明',body:'用户提供资料',items:[]}]}],limitations:[]});
const shot=(id='shot-a')=>({id,title:id,visual:'窗边光影变化',camera:'缓慢推近',duration:2,narration:'',subtitle:'岭南日常',revision:''});
const video=()=>({ratio:'16:9',shots:[shot()],burnSubtitles:true,keepAudio:false});
const request=(p,kind,args={})=>({id:randomUUID(),projectId:p.id,kind,args,source:taskSource(p,kind,args)});
const ws=p=>({projects:[p],activeProjectId:p.id});
async function setup(type='video'){const dir=await mkdtemp(join(tmpdir(),'creative-output-'));const repo=createRepository(dir);const p=createProject('岭南日常',type,'本地验证');if(type==='video')p.video=video();await repo.saveWorkspace(ws(p),0,randomUUID());return {repo,p,dir};}
async function until(manager,id,status='succeeded',ready=()=>true) {for(let i=0;i<600;i++){const task=await manager.get(id);if(task.status===status&&ready(task))return task;if(task.status==='failed'&&status!=='failed')throw new Error(task.error);await new Promise(r=>setTimeout(r,30));}throw new Error('timeout');}
let fixture;
async function clips(){return fixture??=(async()=>{const dir=await mkdtemp(join(tmpdir(),'creative-clips-'));await mediaCommand(ffmpeg,['-nostdin','-v','error','-f','lavfi','-i','testsrc2=size=320x180:rate=24','-f','lavfi','-i','sine=frequency=440:sample_rate=48000','-t','2','-c:v','libx264','-pix_fmt','yuv420p','-c:a','aac',join(dir,'test.mp4')]);await mediaCommand(ffmpeg,['-nostdin','-v','error','-f','lavfi','-i','sine=frequency=600:sample_rate=48000','-t','1','-ac','2',join(dir,'test.wav')]);return {mp4:await readFile(join(dir,'test.mp4')),wav:await readFile(join(dir,'test.wav'))};})();}

test('real FFmpeg imports, decodes, subtitles and composes multiple clips with audio',async()=>{
  const {repo,p,dir}=await setup();const files=await clips();const clip=await importMedia(files.mp4,'mp4',repo,{env:{}});const audio=await importMedia(files.wav,'wav',repo,{env:{}});
  assert.equal(clip.videoCodec,'h264');assert.ok(clip.audio);p.video.shots.push(shot('shot-b'));p.video.shots[0].narration='岭南';
  for(const s of p.video.shots)s.clip={...clip,source:shotSource(s,p.video.ratio,p)};
  p.video.shots[0].audio={...audio,source:audioSource(p.video.shots[0],p)};p.video.music=audio;
  const input={...request(p,'video-compose'),snapshot:p};const result=await composeVideo(input,repo,{env:{}});
  await writeFile(join(dir,'final.mp4'),await repo.output(result.videoFinal.fileId));const info=await probeMedia(join(dir,'final.mp4'),{env:{}});
  assert.ok(Math.abs(info.duration-4)<0.2);assert.equal(info.width,1280);assert.equal(info.height,720);assert.equal(info.videoCodec,'h264');assert.ok(info.audio);
  const srt=(await repo.output(result.videoFinal.subtitleFileId)).toString();assert.match(srt,/00:00:02,000 --> 00:00:04,000/);assert.equal(result.videoFinal.source,composeSource(p.video,p));
  const adopted=applyTaskResult(p,{...input,status:'succeeded',result});await repo.saveWorkspace(ws(adopted),1,randomUUID());assert.equal((await createRepository(dir).loadWorkspace()).workspace.projects[0].video.final.fileId,result.videoFinal.fileId);
  await assert.rejects(importMedia(Buffer.from('this is not video'),'mp4',repo,{env:{}}),e=>e.code==='invalid_media');
  p.video.shots[0].visual='另一画面';await assert.rejects(composeVideo({...input,snapshot:p},repo,{env:{}}),e=>e.code==='stale_clip');
});
test('composition refuses missing narration and audio longer than the shot',async()=>{
  const {repo,p,dir}=await setup();const files=await clips();const clip=await importMedia(files.mp4,'mp4',repo,{env:{}});const s=p.video.shots[0];s.clip={...clip,source:shotSource(s,p.video.ratio,p)};s.narration='不能被省略的旁白';
  await assert.rejects(composeVideo({snapshot:p},repo,{env:{}}),e=>e.code==='missing_audio');
  s.audio={...(await importMedia(files.wav,'wav',repo,{env:{}})),source:'旧稿'};await assert.rejects(composeVideo({snapshot:p},repo,{env:{}}),e=>e.code==='missing_audio');
  await mediaCommand(ffmpeg,['-nostdin','-v','error','-f','lavfi','-i','sine=frequency=600:sample_rate=48000','-t','3',join(dir,'long.wav')]);
  s.audio={...(await importMedia(await readFile(join(dir,'long.wav')),'wav',repo,{env:{}})),source:audioSource(s,p)};
  await assert.rejects(composeVideo({snapshot:p},repo,{env:{}}),e=>e.code==='long_audio');
});
test('WorkBuddy video handoff persists actual MP4, and cancellation preserves late output for explicit adoption',async()=>{
  const {repo,p}=await setup();const manager=createTaskManager(repo,{env:{}});const input=request(p,'video-shot',{provider:'workbuddy',objectId:'shot-a'});await manager.submit(input);const waiting=await until(manager,input.id,'waiting_external',task=>task.dispatch==='manual');
  assert.match(waiting.handoff.output,/result\.mp4$/);assert.match(waiting.handoffMessage,/不要用示例/);assert.equal(waiting.dispatch,'manual');
  await writeFile(waiting.handoff.output,(await clips()).mp4);const done=await until(manager,input.id);assert.equal(done.result.videoClip.source,shotSource(p.video.shots[0],p.video.ratio,p));
  const adopted=applyTaskResult(p,done);assert.ok(adopted.video.shots[0].clip.fileId.endsWith('.mp4'));manager.stop();
  const manager2=createTaskManager(repo,{env:{}});const next=request(p,'video-shot',{provider:'workbuddy',objectId:'shot-a'});await manager2.submit(next);const second=await until(manager2,next.id,'waiting_external');await manager2.cancel(next.id);await writeFile(second.handoff.output,(await clips()).mp4);assert.equal((await until(manager2,next.id)).recoveredAfterCancel,true);manager2.stop();
});
test('Runway sends documented inputs, preserves job ID on restart and never resubmits',async()=>{
  const {repo,p}=await setup();let posts=0,gets=0;const env={VIDEO_API_KEY:'test'};
  const fetchImpl=async(url,options)=>{if(url.endsWith('/text_to_video')){posts++;assert.equal(options.headers['X-Runway-Version'],'2024-11-06');assert.equal(JSON.parse(options.body).duration,2);return Response.json({id:'external-job'});}if(url.includes('/tasks/')){gets++;return Response.json({id:'external-job',status:'SUCCEEDED',output:['https://cdn.runwayml.com/result.mp4']});}assert.equal(options.headers,undefined);return new Response((await clips()).mp4);};
  const first=createTaskManager(repo,{env,fetchImpl});const input=request(p,'video-shot',{provider:'external',objectId:'shot-a'});await first.submit(input);await until(first,input.id,'waiting_provider');await first.stop();
  const next=createTaskManager(repo,{env,fetchImpl});const done=await until(next,input.id);assert.ok(done.result.videoClip.fileId);assert.equal(posts,1);assert.ok(gets>=1&&gets<=2);const completedGets=gets;await next.get(input.id);assert.equal(posts,1);assert.equal(gets,completedGets);await next.stop();
  await assert.rejects(submitVideo('x'.repeat(1001),null,shot(),'16:9',{env,fetchImpl}),e=>e.code==='prompt_too_long');
  await assert.rejects(downloadVideo('http://127.0.0.1/private',{env,fetchImpl}),e=>e.code==='output_host');
});
test('sibling shot results remain adoptable, changed inputs reject stale results',async()=>{
  const {p}=await setup();p.video.shots.push(shot('shot-b'));const a=request(p,'video-shot',{objectId:'shot-a',provider:'workbuddy'});const b=request(p,'video-shot',{objectId:'shot-b',provider:'workbuddy'});
  const file={fileId:'a'.repeat(64)+'.mp4',duration:2,source:shotSource(p.video.shots[0],p.video.ratio,p)};
  const next=applyTaskResult(p,{...a,status:'succeeded',result:{videoClip:file}});assert.equal(taskSource(next,b.kind,b.args),b.source);
  next.video.shots[1].visual='新画面';assert.throws(()=>applyTaskResult(next,{...b,status:'succeeded',result:{videoClip:file}}),/生成依据已改变/);
});
test('website compiler escapes content, validates references and exports an offline package',async()=>{
  const {repo,p,dir}=await setup('website');const input=spec();input.pages[0].intro='<script>fetch("/api/workbench/data/workspace")</script>';
  const site=await buildWebsite(input,p,repo);const html=(await repo.output(site.previewFileId)).toString();assert.match(html,/&lt;script&gt;/);assert.doesNotMatch(html,/<script>fetch/);assert.match(html,/connect-src 'none'/);assert.match(html,/data-gallery/);
  const files=unzipSync(await repo.output(site.zipFileId));assert.equal(strFromU8(files['index.html']),html);assert.match(strFromU8(files['README.md']),/无需安装依赖/);assert.match(strFromU8(files['app.js']),/hashchange/);assert.match(strFromU8(files['app.js']),/aria-pressed/);
  p.website=site;await repo.saveWorkspace(ws(p),1,randomUUID());const saved=await createRepository(dir).loadWorkspace();assert.equal(parseStoredWorkspace(saved).workspace.projects[0].website.previewFileId,site.previewFileId);
  const invalid=spec();invalid.pages[0].sections[0].items[0].assetId='missing';assert.throws(()=>validateSite(invalid,new Set()),/素材/);
});
test('website request replaces new template generation while legacy files still rebuild',async()=>{
  const {repo,p}=await setup('website');let calls=0;const manager=createTaskManager(repo,{env:{DEEPSEEK_API_KEY:'test'},fetchImpl:async()=>{calls++;throw new Error('No model needed to prepare the request');}});
  p.website=await buildWebsite(spec(),p,repo);await repo.saveWorkspace(ws(p),1,randomUUID());
  const input=request(p,'website',{action:'generate'});await manager.submit(input);const task=await until(manager,input.id);const adopted=applyTaskResult(p,task);
  assert.equal(calls,0);assert.equal(adopted.website.previewFileId,p.website.previewFileId);assert.ok(adopted.websiteRequest.bundleFileId.endsWith('.zip'));assert.equal(task.result.website,undefined);
  const packageFiles=unzipSync(await repo.output(adopted.websiteRequest.bundleFileId));assert.equal(strFromU8(packageFiles['PROMPT.md']),adopted.websiteRequest.prompt);assert.equal(packageFiles['index.html'],undefined);
  adopted.website.spec=structuredClone(adopted.website.spec);adopted.website.spec.title='改名后的旧网站';await repo.saveWorkspace(ws(adopted),2,randomUUID());
  const rebuild=request(adopted,'website-build');await manager.submit(rebuild);const built=await until(manager,rebuild.id);assert.equal(calls,0);assert.match((await repo.output(built.result.website.previewFileId)).toString(),/改名后的旧网站/);assert.notEqual(built.result.website.previewFileId,p.website.previewFileId);manager.stop();
});
test('output HTTP supports seek ranges, sandboxed HTML and hash checked backup restoration',async()=>{
  const {repo,dir}=await setup('website');const stored=await repo.putOutput(Buffer.from('<!doctype html><p>safe</p>'),'html');const bytes=(await clips()).mp4;const clip=await repo.putOutput(bytes,'mp4');
  const server=createRuntimeServer({dataDirectory:dir,env:{}});server.listen(0,'127.0.0.1');await once(server,'listening');const base='http://127.0.0.1:'+server.address().port;
  try {const range=await fetch(base+'/v1/files/'+clip.fileId,{headers:{Range:'bytes=0-99'}});assert.equal(range.status,206);assert.equal((await range.arrayBuffer()).byteLength,100);assert.equal(range.headers.get('content-range'),`bytes 0-99/${bytes.length}`);
    const page=await fetch(base+'/v1/files/'+stored.fileId);assert.match(page.headers.get('content-security-policy'),/sandbox allow-scripts/);assert.match(page.headers.get('content-security-policy'),/connect-src 'none'/);
    const restore=await fetch(base+'/v1/files/restore/'+stored.fileId,{method:'POST',body:await repo.output(stored.fileId)});assert.equal(restore.status,201);assert.equal((await restore.json()).fileId,stored.fileId);
    assert.equal((await fetch(base+'/v1/files/restore/'+stored.fileId,{method:'POST',body:'bad'})).status,400);
  }finally{server.closeAllConnections();server.close();}
  assert.deepEqual(byteRange('bytes=-10',100),{start:90,end:99});assert.equal(byteRange('bytes=-0',100),false);assert.equal(byteRange('bytes=100-',100),false);assert.equal(byteRange('bytes=0-1,3-4',100),false);
});

test('composition mixes original sound with narration and accepts literal subtitle punctuation', async () => {
  const { repo, p, dir } = await setup();
  const files = await clips();
  const clip = await importMedia(files.mp4, 'mp4', repo, { env: {} });
  const audio = await importMedia(files.wav, 'wav', repo, { env: {} });
  const s = p.video.shots[0]; s.narration = '旁白'; s.subtitle = '字幕 {原文}, \\N 不应成为滤镜指令';
  s.clip = { ...clip, source: shotSource(s, p.video.ratio,p) }; s.audio = { ...audio, source: audioSource(s,p) };
  // Check both frequencies in decoded audio instead of merely asserting an audio track exists.
  async function amplitudes(keepAudio) {
    p.video.keepAudio = keepAudio;
    const result = await composeVideo({ ...request(p, 'video-compose'), snapshot: p }, repo, { env: {} });
    const path = join(dir, `mix-${keepAudio}.mp4`); await writeFile(path, await repo.output(result.videoFinal.fileId));
    const pcm = join(dir, `mix-${keepAudio}.pcm`);
    await mediaCommand(ffmpeg, ['-nostdin', '-v', 'error', '-i', path, '-ss', '0.2', '-t', '0.5', '-vn', '-ac', '1', '-ar', '8000', '-f', 'f32le', pcm]);
    const bytes = await readFile(pcm);
    const tone = frequency => {
      let real = 0, imaginary = 0;
      for (let i = 0; i < bytes.length / 4; i++) { const value = bytes.readFloatLE(i * 4); real += value * Math.cos(2 * Math.PI * frequency * i / 8000); imaginary += value * Math.sin(2 * Math.PI * frequency * i / 8000); }
      return Math.hypot(real, imaginary) / (bytes.length / 4);
    };
    assert.match((await repo.output(result.videoFinal.subtitleFileId)).toString(), /\{原文\}, \\N/);
    return { original: tone(440), narration: tone(600) };
  }
  const mixed = await amplitudes(true), replaced = await amplitudes(false);
  assert.ok(mixed.original > 0.005, JSON.stringify(mixed));
  assert.ok(mixed.narration > 0.02, JSON.stringify(mixed));
  assert.ok(replaced.original < mixed.original / 10, JSON.stringify({ mixed, replaced }));
});

test('regenerating video plans preserves explicit subtitle and original-audio settings', async () => {
  const { repo, p } = await setup(); p.video.keepAudio = true; p.video.burnSubtitles = false;
  await repo.saveWorkspace(ws(p), 1, randomUUID());
  const manager = createTaskManager(repo, { env: { DEEPSEEK_API_KEY: 'test' }, fetchImpl: async () => Response.json({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ ratio: '16:9', shots: [shot()] }) } }] }) });
  const input = request(p, 'video-plan', { action: 'generate' }); await manager.submit(input);
  const done = await until(manager, input.id);
  assert.equal(done.result.videoPlan.keepAudio, true); assert.equal(done.result.videoPlan.burnSubtitles, false); manager.stop();
});
