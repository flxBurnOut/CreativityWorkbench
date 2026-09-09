import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {randomUUID} from 'node:crypto';
import sharp from 'sharp';
import ffmpeg from 'ffmpeg-static';
import {createRepository} from '../lib/workbench/repository.mjs';
import {createTaskManager} from '../lib/workbench/tasks.mjs';
import {createCoreService} from '../lib/workbench/core-service.mjs';
import {mediaCommand} from '../lib/workbench/video-media.mjs';
import {videoSpec} from '../lib/workbench/media-validation.mjs';
const uid=()=>randomUUID();
async function wait(tasks,id,status){for(let i=0;i<300;i++){const task=await tasks.get(id);if(task.status===status)return task;if(task.status==='failed'&&status!=='failed')throw new Error(task.error);await new Promise(r=>setTimeout(r,15));}throw new Error('task timeout');}
test('actual square input is rejected before dispatch; explicit framing preserves original and is replayable',async t=>{
  const root=await mkdtemp(join(tmpdir(),'media-acceptance-'));const repo=createRepository(root);
  let requests=0;const env={};const fetchImpl=async()=>{requests++;throw new Error('must not call external provider');};
  const tasks=createTaskManager(repo,{env,fetchImpl});const core=createCoreService(repo,tasks,{env,fetchImpl});
  t.after(async()=>{await tasks.stop();await rm(root,{recursive:true,force:true});});
  const original=await sharp({create:{width:160,height:160,channels:3,background:'blue'}}).png().toBuffer();
  const stored=await repo.putImage(original);
  let current=await core.call('project_create',{requestId:uid(),idea:'首帧与画幅验收',type:'video'});const projectId=current.projectId;
  let snapshot=await core.call('project_get',{projectId});snapshot.project.assets=[{id:'square',name:'方图原件',fileId:stored.fileId}];
  await repo.saveWorkspace({projects:[snapshot.project],activeProjectId:projectId},snapshot.revision,uid());
  snapshot=await core.call('project_get',{projectId});
  current=await core.call('project_update',{projectId,expectedVersion:snapshot.projectVersion,requestId:uid(),patch:{video:{ratio:'16:9',burnSubtitles:false,keepAudio:false,shots:[{id:'s',title:'方图测试',visual:'缓慢推进',camera:'固定',duration:2,narration:'',subtitle:'',revision:'',referenceAssetId:'square'}]}}});
  const start=()=>core.call('task_start',{projectId,expectedVersion:current.projectVersion,requestId:uid(),kind:'video-shot',args:{objectId:'s'}});
  assert.equal((await core.call('prompt_prepare',{projectId,kind:'video-shot',args:{objectId:'s'}})).frameCheck.status,'failed');
  const rejected=await start();assert.equal((await wait(tasks,rejected.id,'failed')).code,'frame_ratio_mismatch');assert.equal(requests,0);
  const fit={projectId,expectedVersion:current.projectVersion,requestId:uid(),objectId:'s',fit:'pad'};
  current=await core.call('video_frame_fit',fit);assert.equal((await core.call('video_frame_fit',fit)).replayed,true);
  snapshot=await core.call('project_get',{projectId});const image=snapshot.project.assets.find(a=>a.id===current.frameAssetId);
  const meta=await sharp(await repo.media(image.fileId)).metadata();assert.equal(meta.width,1280);assert.equal(meta.height,720);
  assert.deepEqual(await repo.media(stored.fileId),await repo.media(snapshot.project.assets[0].fileId));assert.equal(snapshot.project.assets.length,2);
  assert.equal((await core.call('prompt_prepare',{projectId,kind:'video-shot',args:{objectId:'s'}})).frameCheck.status,'passed');
  async function produce(width,height) {
    const path=join(root,`fixture-${width}-${height}.mp4`);
    await mediaCommand(ffmpeg,['-nostdin','-v','error','-f','lavfi','-i',`testsrc2=size=${width}x${height}:rate=24`,'-t','2','-c:v','libx264','-pix_fmt','yuv420p',path]);
    const job=await start();const waiting=await wait(tasks,job.id,'waiting_external');await writeFile(waiting.handoff.output,await readFile(path));return wait(tasks,job.id,'succeeded');
  }
  const wrong=await produce(160,160);assert.equal(wrong.result.videoClip.validation.status,'failed');assert.equal(wrong.result.videoClip.width,160);
  await assert.rejects(core.call('task_adopt',{taskId:wrong.id,expectedVersion:current.projectVersion}),/规格/);
  assert.ok((await repo.output(wrong.result.videoClip.fileId)).length>0);assert.equal((await core.call('project_get',{projectId})).project.video.shots[0].clip,undefined);
  const good=await produce(320,180);assert.equal(good.result.videoClip.validation.status,'passed');
  current=await core.call('task_adopt',{taskId:good.id,expectedVersion:current.projectVersion});
  let delivery=await core.call('project_deliver',{projectId});assert.equal(delivery.files.find(f=>f.role==='clip:s').specification.status,'passed');
  snapshot=await core.call('project_get',{projectId});
  await core.call('project_update',{projectId,expectedVersion:current.projectVersion,requestId:uid(),patch:{video:{...snapshot.project.video,ratio:'9:16'}}});
  delivery=await core.call('project_deliver',{projectId});assert.equal(delivery.files.find(f=>f.role==='clip:s').specification.status,'failed');assert.equal(delivery.partial,true);
  assert.equal(requests,0);
});
test('video compliance respects display aspect ratio and distinguishes unknown legacy metadata',()=>{
  assert.equal(videoSpec({width:720,height:576,displayAspectRatio:16/9,duration:5.04},'16:9',5).status,'passed');
  assert.equal(videoSpec({width:1440,height:1440,duration:5.04},'16:9',5).status,'failed');
  assert.equal(videoSpec({width:1280,height:720,duration:8},'16:9',5).status,'failed');
  assert.equal(videoSpec({duration:5},'16:9',5).status,'unverified');
});
