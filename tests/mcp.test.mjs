import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile, writeFile } from 'node:fs/promises';
import { createTestDirectory, closeTestServer, stopTestProcess } from './helpers/test-directory.mjs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import http from 'node:http';
import sharp from 'sharp';
import ffmpeg from 'ffmpeg-static';
import { unzipSync, zipSync, strToU8 } from 'fflate';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { createRuntimeServer } from '../lib/workbench/http-server.mjs';
import { createRuntimeClient } from '../lib/workbench/mcp-runtime.mjs';
import { coreTools } from '../lib/workbench/core-contract.mjs';
import { mediaCommand, probeMedia } from '../lib/workbench/video-media.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const uid = () => randomUUID();
async function setup(t) {
  const scope = await createTestDirectory(t, 'creative-mcp');
  const directory = scope.directory;
  let remoteCalls = 0;
  const runtime = createRuntimeServer({ dataDirectory: directory, env: { WORKBUDDY_ACCESS_TOKEN: 'test-no-dispatch' }, fetchImpl: async () => { remoteCalls++; throw new Error('MCP handoff must not dispatch messages or call a provider.'); } });
  scope.defer(() => closeTestServer(runtime));
  runtime.listen(0, '127.0.0.1'); await once(runtime, 'listening');
  const url = 'http://127.0.0.1:' + runtime.address().port;
  async function connect() {
    const transport = new StdioClientTransport({ command: process.execPath, args: [join(root, 'scripts/workbench-mcp.mjs')], cwd: directory, env: { WORKBENCH_RUNTIME_URL: url, WORKBENCH_DATA_DIR: directory }, stderr: 'pipe' });
    const client = new Client({ name: 'core-protocol-test', version: '1.0.0' });
    scope.defer(() => client.close());
    await client.connect(transport); return client;
  }
  t.after(() => assert.equal(remoteCalls, 0));
  const client = await connect();
  async function call(name, input = {}, expectError = false) {
    const result = await client.callTool({ name, arguments: input }, undefined, { timeout: 200000 });
    assert.equal(Boolean(result.isError), expectError, JSON.stringify(result.content));
    if (result.structuredContent) return result.structuredContent;
    try { return JSON.parse(result.content[0].text); }
    catch { return { error: result.content[0].text }; }
  }
  async function until(taskId, status = 'succeeded') {
    const deadline = Date.now() + 30000;
    while (Date.now() < deadline) {
      const task = await call('task_get', { taskId });
      if (task.status === status) return task;
      if (['failed', 'uncertain'].includes(task.status)) throw new Error(JSON.stringify(task));
      await new Promise(r => setTimeout(r, 100));
    }
    throw new Error('MCP task timeout');
  }
  return { client, call, until, directory, connect, url };
}
const site = () => ({ title: '岭南手艺', description: '用户提供的资料', accent: '#35765d', theme: 'paper', pages: [{ id: 'home', title: '首页', intro: '骑楼下', sections: [{ kind: 'text', title: '说明', body: '真实保存的文案', items: [] }] }], limitations: [] });
const video = () => ({ ratio: '16:9', burnSubtitles: false, keepAudio: false, shots: [{ id: 'shot-a', title: '街巷', visual: '日光移动', camera: '推进', duration: 2, narration: '街巷', subtitle: '街巷', revision: '' }] });

test('real stdio: one website goal waits for code and returns the original task draft without extra adoption',async t=>{
  const {call,until,client}=await setup(t);assert.ok((await client.listTools()).tools.some(t=>t.name==='website_complete'));
  const p=await call('project_create',{requestId:uid(),idea:'岭南文化网站',type:'website'});
  const input={projectId:p.projectId,requestId:uid(),expectedVersion:p.projectVersion,goal:'骑楼文化网站，文案与插画结合'};
  const started=await call('website_run',input),waiting=await until(started.id,'waiting_external');assert.equal(waiting.dispatch,'conversation');assert.ok(waiting.result.websiteRequest.bundleFileId);
  const current=await call('project_get',{projectId:p.projectId});await writeFile(join(current.inbox,'website.zip'),zipSync({'index.html':strToU8('<!doctype html><h1>真实源码交接</h1>')}));
  await call('website_complete',{taskId:started.id,filename:'website.zip',verificationMethod:'static',verificationResult:'passed',verificationEvidence:'只检查测试 HTML，不代表浏览器验收'});
  const done=await until(started.id);assert.equal(done.result.websiteSource.verificationMethod,'static');assert.match(done.next,/无需 task_adopt/);
  await call('task_get',{taskId:started.id});const after=await call('project_get',{projectId:p.projectId});assert.equal(after.project.websiteSourceCandidate.fileId,done.result.websiteSource.fileId);assert.equal(after.project.websiteSource,undefined);assert.equal((await call('website_run',input)).id,started.id);
});

test('real stdio: image_select uses the original handoff result, validates comparison and synchronizes selected state',async t=>{
  const {call,until,client}=await setup(t);
  assert.ok((await client.listTools()).tools.some(tool=>tool.name==='image_select'));
  const created=await call('project_create',{requestId:uid(),idea:'改图选用同步','type':'website'}),projectId=created.projectId;
  await call('project_update',{projectId,requestId:uid(),expectedVersion:created.projectVersion,patch:{concepts:[{id:'object-a',category:'object',name:'测试插画',description:'验证实际文件绑定',prompt:'',revisionRequest:'暖色'}]}});
  const finish=async(action,color)=>{
    const current=await call('project_get',{projectId}),id=uid();
    await call('task_start',{projectId,requestId:id,expectedVersion:current.projectVersion,kind:'image',args:{action,objectId:'object-a',provider:'workbuddy'}});
    const waiting=await until(id,'waiting_external');
    await writeFile(waiting.handoff.output,await sharp({create:{width:32,height:32,channels:3,background:color}}).png().toBuffer());
    return until(id);
  };
  const original=await finish('generate','#35765d');let current=await call('project_get',{projectId});
  await call('image_select',{projectId,requestId:uid(),expectedVersion:current.projectVersion,objectId:'object-a',taskId:original.id});
  const edited=await finish('edit','#b65738');current=await call('project_get',{projectId});
  const input={projectId,requestId:uid(),expectedVersion:current.projectVersion,objectId:'object-a',taskId:edited.id};
  assert.equal((await call('image_select',input,true)).code,'image_selection_conflict');
  await call('task_adopt',{taskId:edited.id,expectedVersion:current.projectVersion});current=await call('project_get',{projectId});
  const ready=await call('task_get',{taskId:edited.id});assert.equal(ready.imageState.binding,'candidate');assert.equal(ready.imageState.stale,false);
  const selection={...input,expectedVersion:current.projectVersion,review:{assetId:edited.result.asset.id,parentAssetId:original.result.asset.id,changesVisible:true,preserved:true,notes:'合成测试图由青变红，仅验证比较记录及选用协议。',checkedAt:Date.now()}};
  await call('image_select',selection);assert.equal((await call('image_select',selection)).replayed,true);
  assert.equal((await call('project_get',{projectId})).project.concepts[0].savedAssetId,edited.result.asset.id);
  const selected=(await call('task_list',{projectId})).tasks.find(task=>task.id===edited.id);
  assert.equal(selected.imageState.binding,'selected');assert.equal(selected.resultFileId,edited.result.asset.fileId);
});

test('real stdio: encoded arrays and JSON fallback preserve strict validation and canonical retries',async t=>{
  const {call,client}=await setup(t);
  const created=await call('project_create',{requestId:uid(),idea:'数组兼容',type:'video'});
  const input={requestId:uid(),projectId:created.projectId,expectedVersion:created.projectVersion,entryIds:'["guangcai"]'};
  const selected=await call('knowledge_apply',input);
  assert.equal((await call('knowledge_apply',{...input,entryIds:['guangcai']})).replayed,true);
  const patch={requestId:uid(),projectId:created.projectId,expectedVersion:selected.projectVersion,patch:{video:{...video(),shots:JSON.stringify(video().shots.map(s=>({...s,conceptIds:'[]'})))}}};
  const saved=await call('project_update',patch);
  const read=await call('project_get',{projectId:created.projectId});assert.deepEqual(read.project.video.shots[0].conceptIds,[]);
  for(const bad of ['guangcai','{"0":"guangcai"}','[123]'])await call('knowledge_apply',{...input,requestId:uid(),expectedVersion:saved.projectVersion,entryIds:bad},true);
  const update={requestId:uid(),projectId:created.projectId,expectedVersion:saved.projectVersion,patch:{title:'兼容入口保存'}};
  await call('workbench_call_json',{tool:'project_update',argumentsJson:JSON.stringify(update)});
  assert.equal((await call('project_update',update)).replayed,true);
  for(const args of [{tool:'workbench_call_json',argumentsJson:'{}'},{tool:'project_update',argumentsJson:'[]'},{tool:'project_update',argumentsJson:JSON.stringify({...update,patch:{unknown:true}})}])await call('workbench_call_json',args,true);
  const tools=(await client.listTools()).tools;assert.ok(tools.find(t=>t.name==='knowledge_apply').inputSchema.properties.entryIds.anyOf.some(s=>s.type==='string'));
  assert.equal((await call('project_get',{projectId:created.projectId})).project.title,'兼容入口保存');
});

test('real stdio client: selects sourced knowledge and delivers it without provider credentials',async t=>{
  const {call}=await setup(t);
  const found=await call('knowledge_search',{query:'木雕',region:'潮汕'});
  assert.equal(found.entries[0].id,'chaozhou-wood');
  const p=await call('project_create',{requestId:uid(),idea:'木雕主题网站',type:'website'});
  const input={requestId:uid(),projectId:p.projectId,expectedVersion:p.projectVersion,entryIds:['chaozhou-wood']};
  await call('knowledge_apply',input);assert.equal((await call('knowledge_apply',input)).replayed,true);
  const current=await call('project_get',{projectId:p.projectId});assert.match(current.knowledgeContext,/14020/);
  const prepared=await call('prompt_prepare',{projectId:p.projectId,kind:'website'});assert.match(prepared.prompt,/潮州木雕/);
  const delivery=await call('project_deliver',{projectId:p.projectId});assert.match(await readFile(delivery.files.find(f=>f.role==='theme-knowledge').path,'utf8'),/潮州木雕/);
});

test('real stdio client: discovery, conversation writing, durable retries, version conflicts and website delivery without API keys', async t => {
  const { client, call, until, connect, url } = await setup(t);
  const tools = await client.listTools();
  assert.deepEqual(tools.tools.map(t => t.name).sort(), Object.keys(coreTools).sort());
  assert.ok(tools.tools.some(t => t.name === 'task_dismiss'));
  assert.ok(tools.tools.find(t => t.name === 'project_update').inputSchema.properties.patch.properties.website);
  assert.equal((await client.listResources()).resources[0].uri, 'workbench://manifest');
  assert.ok(JSON.parse((await client.readResource({ uri: 'workbench://manifest' })).contents[0].text).capabilities.length);
  assert.equal((await call('workbench_status')).providers.text.configured, false);
  assert.deepEqual((await call('project_list')).projects, []);
  const create = { requestId: uid(), idea: '岭南短篇', type: 'novel', title: '协议测试小说' };
  const created = await call('project_create', create);
  assert.equal((await call('project_create', create)).projectId, created.projectId);
  assert.equal((await call('project_create', { ...create, idea: '不同请求' }, true)).code, 'conflict');
  const projectId = created.projectId;
  const patch = { requestId: uid(), projectId, expectedVersion: created.projectVersion, patch: { content: { novel: { story: '梗概', voice: '自然语言' } }, novel: { title: '街巷', text: '街巷里的故事，已经保存到共享工作台。' } } };
  const saved = await call('project_update', patch);
  assert.equal((await call('project_update', patch)).replayed, true);
  assert.equal((await call('project_update', { ...patch, requestId: uid() }, true)).code, 'conflict');
  const concurrency = await Promise.all(['甲', '乙'].map(title => client.callTool({ name: 'project_update', arguments: { requestId: uid(), projectId, expectedVersion: saved.projectVersion, patch: { title } } })));
  assert.equal(concurrency.filter(r => !r.isError).length, 1);
  // Web snapshot writes preserve MCP receipts, and another project's save doesn't invalidate this project.
  const other = await call('project_create', { requestId: uid(), idea: '网站', type: 'website' });
  const workspace = await (await fetch(url + '/v1/workspace')).json();
  workspace.workspace.projects.find(p => p.id === other.projectId).title = 'Web 中的更新';
  const webSave = await fetch(url + '/v1/workspace', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ workspace: workspace.workspace, expectedRevision: workspace.revision, writeId: uid() }) });
  assert.equal(webSave.status, 200);
  assert.equal((await call('project_update', patch)).replayed, true);
  const novel = await call('project_get', { projectId });
  assert.equal(novel.project.content.novel.voice, '自然语言');
  const delivery = await call('project_deliver', { projectId });
  assert.equal(delivery.files.length, 2);
  for (const file of delivery.files) {
    assert.match(await readFile(file.path, 'utf8'), /已经保存到共享工作台/);
    assert.equal((await fetch(file.url)).status, 200);
  }
  let current = await call('project_get', { projectId: other.projectId });
  const website = await call('project_update', { requestId: uid(), projectId: other.projectId, expectedVersion: current.projectVersion, patch: { website: { spec: site() } } });
  const start = { requestId: uid(), projectId: other.projectId, expectedVersion: website.projectVersion, kind: 'website-build' };
  await call('task_start', start); await until(start.requestId);
  await call('task_adopt', { taskId: start.requestId, expectedVersion: website.projectVersion });
  assert.equal((await call('task_start', start)).id, start.requestId);
  assert.equal((await call('task_adopt', { taskId: start.requestId, expectedVersion: website.projectVersion })).replayed, true);
  const siteFiles = (await call('project_deliver', { projectId: other.projectId })).files;
  assert.equal(siteFiles.length, 2); assert.ok(siteFiles.every(f => !f.stale));
  assert.match(await readFile(siteFiles.find(f => f.role === 'website-preview').path, 'utf8'), /真实保存的文案/);
  assert.ok(Object.keys(unzipSync(await readFile(siteFiles.find(f => f.role === 'website-zip').path))).includes('index.html'));
  current = await call('project_get', { projectId: other.projectId });
  const oldTask = { requestId: uid(), projectId: other.projectId, expectedVersion: current.projectVersion, kind: 'website-build' };
  await call('task_start', oldTask); await until(oldTask.requestId);
  const modified = await call('project_update', { requestId: uid(), projectId: other.projectId, expectedVersion: current.projectVersion, patch: { website: { spec: { ...site(), title: '新版标题' } } } });
  assert.equal((await call('task_adopt', { taskId: oldTask.requestId, expectedVersion: modified.projectVersion }, true)).code, 'stale_result');
  assert.ok((await call('project_deliver', { projectId: other.projectId })).files.every(f => f.stale));
  const prepared = await call('prompt_prepare', { projectId: other.projectId, kind: 'website' });
  assert.equal(prepared.projectVersion, modified.projectVersion);
  assert.equal((await call('project_get', { projectId: other.projectId })).projectVersion, modified.projectVersion);
  const finalPrompt = prepared.prompt + '\n保留任务编号 MCP-W-029。';
  const requestDraft = await call('project_update', { requestId: uid(), projectId: other.projectId, expectedVersion: modified.projectVersion, patch: { websiteRequest: { prompt: finalPrompt, basis: prepared.basis, assetIds: prepared.assetIds } } });
  const requestTask = { requestId: uid(), projectId: other.projectId, expectedVersion: requestDraft.projectVersion, kind: 'website', args: { provider: 'workbuddy' } };
  await call('task_start', requestTask);
  const packed = await until(requestTask.requestId);
  assert.equal(packed.dispatch, 'conversation');
  assert.equal(packed.submittedPrompt, finalPrompt);
  await call('task_adopt', { taskId: packed.id, expectedVersion: requestDraft.projectVersion });
  const deliveries = (await call('project_deliver', { projectId: other.projectId })).files;
  const bundle = deliveries.find(f => f.role === 'website-request-bundle');
  assert.equal(bundle.stale, false);
  const entries = unzipSync(await readFile(bundle.path));
  assert.equal(Buffer.from(entries['PROMPT.md']).toString('utf8'), finalPrompt);
  assert.ok(entries['existing-website.zip']);
  assert.equal(entries['index.html'], undefined);
  assert.ok(deliveries.find(f => f.role === 'website-zip'));
  current = await call('project_get', { projectId: other.projectId });
  const sourceBytes=zipSync({'index.html':strToU8('<!doctype html><h1>实际网站 MCP-W-029</h1>'),'src/main.js':strToU8('export const version = 2;')});
  await writeFile(join(current.inbox,'website-source.zip'),sourceBytes);
  const importedSource=await call('website_source_import',{requestId:uid(),projectId:other.projectId,expectedVersion:current.projectVersion,filename:'website-source.zip',instructions:'静态打开 index.html',verification:'本地测试源码夹具'});
  assert.equal((await call('project_get',{projectId:other.projectId})).project.websiteSource,undefined);
  await call('workflow_update',{requestId:uid(),projectId:other.projectId,expectedVersion:importedSource.projectVersion,action:'adopt-website-source'});
  const workflow=await call('workflow_get',{projectId:other.projectId,kind:'website'});
  assert.ok(workflow.inputManifest.some(i=>i.key==='websiteSource'));
  current=await call('project_get',{projectId:other.projectId});
  const nextPrompt=await call('prompt_prepare',{projectId:other.projectId,kind:'website'});
  const nextSaved=await call('project_update',{requestId:uid(),projectId:other.projectId,expectedVersion:current.projectVersion,patch:{websiteRequest:{prompt:nextPrompt.prompt,basis:nextPrompt.basis,assetIds:nextPrompt.assetIds}}});
  const nextTask=await call('task_start',{requestId:uid(),projectId:other.projectId,expectedVersion:nextSaved.projectVersion,kind:'website'});
  await until(nextTask.id);await call('task_adopt',{taskId:nextTask.id,expectedVersion:nextSaved.projectVersion});
  const nextFiles=(await call('project_deliver',{projectId:other.projectId})).files;
  const nextEntries=unzipSync(await readFile(nextFiles.find(f=>f.role==='website-request-bundle').path));
  assert.deepEqual(Buffer.from(nextEntries['existing-website.zip']),Buffer.from(sourceBytes));
  await client.close();
  const reopened = await connect();
  const result = await reopened.callTool({ name: 'project_get', arguments: { projectId } });
  assert.match(result.structuredContent.project.novel.text, /已经保存/);
});

test('MCP hands images and audio to its calling conversation, imports actual video, adopts and composes, rejects unsafe inputs', async t => {
  const { call, until, directory } = await setup(t);
  let created = await call('project_create', { requestId: uid(), idea: '媒体闭环', type: 'video' });
  const projectId = created.projectId;
  created = await call('project_update', { requestId: uid(), projectId, expectedVersion: created.projectVersion, patch: { video: video(), concepts: [{ id: 'fan', category: 'object', name: '葵扇', description: '手作葵扇', prompt: '', revisionRequest: '' }] } });
  const imageTask = { requestId: uid(), projectId, expectedVersion: created.projectVersion, kind: 'image', args: { objectId: 'fan' } };
  await call('task_start', imageTask);
  const waiting = await until(imageTask.requestId, 'waiting_external');
  assert.equal(waiting.dispatch, 'conversation');
  const png = await sharp({ create: { width: 20, height: 20, channels: 3, background: '#35765d' } }).png().toBuffer();
  await writeFile(waiting.handoff.output, png);
  const done = await until(imageTask.requestId);
  const adopted = await call('task_adopt', { taskId: done.id, expectedVersion: created.projectVersion });
  let current = await call('project_get', { projectId });
  assert.equal(current.project.concepts[0].candidateAssetId, done.result.asset.id);
  const edit = await call('project_update', { requestId: uid(), projectId, expectedVersion: adopted.projectVersion, patch: { concepts: [{ ...current.project.concepts[0], revisionRequest: '保留主体，只调整背景' }] } });
  const editTask = { requestId: uid(), projectId, expectedVersion: edit.projectVersion, kind: 'image', args: { objectId: 'fan', action: 'edit' } };
  await call('task_start', editTask);
  const editing = await until(editTask.requestId, 'waiting_external');
  const request = JSON.parse(await readFile(editing.handoff.requestPath, 'utf8'));
  assert.equal(request.inputImages.length, 1); assert.deepEqual(await readFile(request.inputImages[0]), png);
  await call('task_cancel', { taskId: editTask.requestId });
  await writeFile(editing.handoff.output, png);
  assert.equal((await until(editTask.requestId)).recoveredAfterCancel, true);
  current = await call('project_get', { projectId });
  const imageImport = { requestId: uid(), projectId, expectedVersion: current.projectVersion, filename: 'reference.png', role: 'image' };
  await writeFile(join(current.inbox, 'reference.png'), png);
  const importedImage = await call('media_import', imageImport);
  assert.equal((await call('media_import', imageImport)).assetId, importedImage.assetId);
  assert.ok((await call('media_import', { ...imageImport, requestId: uid(), expectedVersion: importedImage.projectVersion, filename: '../reference.png' }, true)).error);
  // Schema is strict: a tool cannot be used to replace all projects or write arbitrary paths.
  assert.ok((await call('project_update', { requestId: uid(), projectId, expectedVersion: importedImage.projectVersion, patch: { id: 'another-project' } }, true)).error);
  await mediaCommand(ffmpeg, ['-nostdin', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=160x90:rate=24', '-t', '2', '-c:v', 'libx264', join(current.inbox, 'shot.mp4')]);
  const clip = await call('media_import', { requestId: uid(), projectId, expectedVersion: importedImage.projectVersion, filename: 'shot.mp4', role: 'clip', objectId: 'shot-a' });
  const audioTask = { requestId: uid(), projectId, expectedVersion: clip.projectVersion, kind: 'video-audio', args: { objectId: 'shot-a' } };
  await call('task_start', audioTask);
  const audioWaiting = await until(audioTask.requestId, 'waiting_external');
  assert.equal(audioWaiting.dispatch, 'conversation');
  await mediaCommand(ffmpeg, ['-nostdin', '-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000', '-t', '1', audioWaiting.handoff.output]);
  await until(audioTask.requestId);
  const audioAdopted = await call('task_adopt', { taskId: audioTask.requestId, expectedVersion: clip.projectVersion });
  const compose = { requestId: uid(), projectId, expectedVersion: audioAdopted.projectVersion, kind: 'video-compose' };
  await call('task_start', compose); await until(compose.requestId);
  await call('task_adopt', { taskId: compose.requestId, expectedVersion: audioAdopted.projectVersion });
  const delivered = (await call('project_deliver', { projectId })).files;
  const final = delivered.find(f => f.role === 'video');
  assert.equal(final.stale, false); assert.ok(final.path.startsWith(directory));
  const info = await probeMedia(final.path, { env: {} });
  assert.ok(Math.abs(info.duration - 2) < 0.2); assert.ok(info.audio);
  assert.match(await readFile(delivered.find(f => f.role === 'subtitles').path, 'utf8'), /街巷/);
});

test('runtime client rejects non-loopback, an old runtime and the wrong data directory without sending mutations', async t => {
  assert.throws(() => createRuntimeClient({ env: { WORKBENCH_RUNTIME_URL: 'https://example.com' } }), /127.0.0.1/);
  assert.throws(() => createRuntimeClient({ env: { WORKBENCH_RUNTIME_URL: 'http://127.0.0.1:8791/private' } }), /127.0.0.1/);
  let calls = 0;
  const server = http.createServer((req, res) => { calls++; assert.equal(req.url, '/health'); res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ ok: true, service: 'app-scaffold-runtime' })); });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => new Promise(r => server.close(r)));
  const client = createRuntimeClient({ env: { WORKBENCH_RUNTIME_URL: 'http://127.0.0.1:' + server.address().port }, autoStart: true });
  await assert.rejects(client.call('project_list', {}), e => e.code === 'runtime_mismatch');
  assert.equal(calls, 1);
  const { url, directory } = await setup(t);
  const wrongData = createRuntimeClient({ env: { WORKBENCH_RUNTIME_URL: url, WORKBENCH_DATA_DIR: join(directory, 'wrong-data') } });
  await assert.rejects(wrongData.call('project_list', {}), e => e.code === 'runtime_mismatch');
});

test('automatic Runtime startup is shared and survives an MCP client disconnect', async t => {
  const scope = await createTestDirectory(t, 'creative-mcp-start');
  const directory = scope.directory;
  const reservation = http.createServer(); scope.defer(() => closeTestServer(reservation)); reservation.listen(0, '127.0.0.1'); await once(reservation, 'listening');
  const port = reservation.address().port; await new Promise(r => reservation.close(r));
  const env = { WORKBENCH_RUNTIME_URL: 'http://127.0.0.1:' + port, WORKBENCH_DATA_DIR: directory };
  const runtime = createRuntimeClient({ env, autoStart: true });
  scope.defer(() => stopTestProcess(runtime.startedPid));
  assert.deepEqual((await runtime.call('project_list', {})).projects, []);
  assert.ok(runtime.startedPid);
  const other = createRuntimeClient({ env, autoStart: true });
  assert.deepEqual((await other.call('project_list', {})).projects, []);
  assert.equal(other.startedPid, undefined);
  const transport = new StdioClientTransport({ command: process.execPath, args: [join(root, 'scripts/workbench-mcp.mjs'), '--ensure-runtime'], cwd: directory, env, stderr: 'pipe' });
  const client = new Client({ name: 'disconnect-test', version: '1.0.0' });
  scope.defer(() => client.close());
  try { await client.connect(transport); assert.equal((await client.callTool({ name: 'project_list', arguments: {} })).isError, undefined); }
  finally { await client.close(); }
  assert.deepEqual((await runtime.call('project_list', {})).projects, []);
});
