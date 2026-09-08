import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import http from 'node:http';
import sharp from 'sharp';
import ffmpeg from 'ffmpeg-static';
import { unzipSync } from 'fflate';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { createRuntimeServer } from '../lib/workbench/http-server.mjs';
import { createRuntimeClient } from '../lib/workbench/mcp-runtime.mjs';
import { coreTools } from '../lib/workbench/core-contract.mjs';
import { mediaCommand, probeMedia } from '../lib/workbench/video-media.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const uid = () => randomUUID();
async function setup(t) {
  const directory = await mkdtemp(join(tmpdir(), 'creative-mcp-'));
  let remoteCalls = 0;
  const runtime = createRuntimeServer({ dataDirectory: directory, env: { WORKBUDDY_ACCESS_TOKEN: 'test-no-dispatch' }, fetchImpl: async () => { remoteCalls++; throw new Error('MCP handoff must not dispatch messages or call a provider.'); } });
  runtime.listen(0, '127.0.0.1'); await once(runtime, 'listening');
  const url = 'http://127.0.0.1:' + runtime.address().port;
  const transports = [];
  async function connect() {
    const transport = new StdioClientTransport({ command: process.execPath, args: [join(root, 'scripts/workbench-mcp.mjs')], cwd: directory, env: { WORKBENCH_RUNTIME_URL: url, WORKBENCH_DATA_DIR: directory }, stderr: 'pipe' });
    const client = new Client({ name: 'core-protocol-test', version: '1.0.0' });
    await client.connect(transport); transports.push(client); return client;
  }
  t.after(async () => { for (const client of transports) await client.close(); await new Promise(r => runtime.close(r)); assert.equal(remoteCalls, 0); });
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
  assert.equal((await call('task_get', { taskId: editTask.requestId })).recoveredAfterCancel, true);
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
  const { url } = await setup(t);
  const wrongData = createRuntimeClient({ env: { WORKBENCH_RUNTIME_URL: url, WORKBENCH_DATA_DIR: join(tmpdir(), uid()) } });
  await assert.rejects(wrongData.call('project_list', {}), e => e.code === 'runtime_mismatch');
});

test('automatic Runtime startup is shared and survives an MCP client disconnect', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'creative-mcp-start-'));
  const reservation = http.createServer(); reservation.listen(0, '127.0.0.1'); await once(reservation, 'listening');
  const port = reservation.address().port; await new Promise(r => reservation.close(r));
  const env = { WORKBENCH_RUNTIME_URL: 'http://127.0.0.1:' + port, WORKBENCH_DATA_DIR: directory };
  const runtime = createRuntimeClient({ env, autoStart: true });
  t.after(() => { if (runtime.startedPid) { try { process.kill(runtime.startedPid); } catch (e) { if (e.code !== 'ESRCH') throw e; } } });
  assert.deepEqual((await runtime.call('project_list', {})).projects, []);
  assert.ok(runtime.startedPid);
  const other = createRuntimeClient({ env, autoStart: true });
  assert.deepEqual((await other.call('project_list', {})).projects, []);
  assert.equal(other.startedPid, undefined);
  const transport = new StdioClientTransport({ command: process.execPath, args: [join(root, 'scripts/workbench-mcp.mjs'), '--ensure-runtime'], cwd: directory, env, stderr: 'pipe' });
  const client = new Client({ name: 'disconnect-test', version: '1.0.0' });
  try { await client.connect(transport); assert.equal((await client.callTool({ name: 'project_list', arguments: {} })).isError, undefined); }
  finally { await client.close(); }
  assert.deepEqual((await runtime.call('project_list', {})).projects, []);
});
