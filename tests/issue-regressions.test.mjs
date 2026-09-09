import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir, readFile, writeFile, symlink, unlink, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { createRepository, digest, validateWorkspace } from '../lib/workbench/repository.mjs';
import { createProject } from '../lib/workbench/project-core.mjs';
import { createTaskManager } from '../lib/workbench/tasks.mjs';
import { createCoreService } from '../lib/workbench/core-service.mjs';
import { taskSource } from '../lib/workbench/task-contract.mjs';
import { createServiceSettings } from '../lib/workbench/service-settings.mjs';
import { cleanupStorage } from '../lib/workbench/storage-maintenance.mjs';

const uid = () => randomUUID();
const ws = project => ({ projects: [project], activeProjectId: project.id });
const png = () => sharp({ create: { width: 16, height: 16, channels: 3, background: 'green' } }).png().toBuffer();
const response = value => Response.json({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(value) } }] });
const art = { direction: '手绘', material: '纸', palette: '青绿', constraints: '岭南', fullPrompt: '岭南街巷手绘' };
async function setup(t, env = {}, fetchImpl = async () => response(art)) {
  const directory = await mkdtemp(join(tmpdir(), 'workbench-issues-'));
  const repo = createRepository(directory);
  const tasks = createTaskManager(repo, { env, fetchImpl });
  const core = createCoreService(repo, tasks, { env, fetchImpl });
  t.after(async () => { await tasks.stop(); await rm(directory, { recursive: true, force: true }); });
  return { repo, tasks, core, directory };
}
async function until(tasks, id, status) {
  for (let i = 0; i < 300; i++) {
    const task = await tasks.get(id);
    if (task.status === status) return task;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error(`Task did not reach ${status}`);
}

test('canonical data-root aliases allow handoff and inbox, while file and directory escapes remain denied', async t => {
  const { directory } = await setup(t);
  const actual = join(directory, 'actual'); await mkdir(actual);
  const alias = join(directory, 'alias'); await symlink(actual, alias, 'dir');
  const repo = createRepository(alias);
  const handoff = await repo.handoff('task-a', 'test', []);
  const bytes = await png();
  await writeFile(handoff.output, bytes);
  assert.deepEqual((await repo.readHandoff('task-a')).bytes, bytes);
  const inbox = await repo.inbox('project-a'); await writeFile(join(inbox, 'image.png'), bytes);
  assert.deepEqual(await repo.readInbox('project-a', 'image.png'), bytes);
  const outside = join(directory, 'outside.png'); await writeFile(outside, bytes);
  await unlink(handoff.output); await symlink(outside, handoff.output);
  await assert.rejects(repo.readHandoff('task-a'), e => e.code === 'invalid_file');
  await symlink(outside, join(inbox, 'escape.png'));
  await assert.rejects(repo.readInbox('project-a', 'escape.png'), e => e.code === 'invalid_file');
  await mkdir(join(directory, 'outside-inbox')); await writeFile(join(directory, 'outside-inbox', 'image.png'), bytes);
  await symlink(join(directory, 'outside-inbox'), join(actual, 'inbox', 'project-b'), 'dir');
  await assert.rejects(repo.readInbox('project-b', 'image.png'), e => e.code === 'invalid_file');
  await repo.handoff('task-error', 'test', []);
  await symlink(outside, join(actual, 'handoff', 'task-error', 'error.json'));
  await assert.rejects(repo.readHandoff('task-error'), e => e.code === 'invalid_file');
});

test('MCP can round-trip persisted media and final subtitles without weakening strict input validation', async t => {
  const { repo, core } = await setup(t);
  const created = await core.call('project_create', { requestId: uid(), idea: '视频', type: 'video' });
  const clip = await repo.putOutput(Buffer.from('test-video'), 'mp4');
  const captions = await repo.putOutput(Buffer.from('test-subtitles'), 'srt');
  const video = { ratio: '16:9', burnSubtitles: false, keepAudio: true, shots: [{ id: 'shot-a', title: '街巷', visual: '街道', camera: '推进', duration: 2, narration: '', subtitle: '', revision: '', clip: { ...clip, duration: 2, width: 1280, height: 720, videoCodec: 'h264', audio: true, source: 'saved-source', prompt: '画面', provider: 'workbuddy', taskId: 'original-task' } }], final: { ...clip, subtitleFileId: captions.fileId, duration: 2, source: 'final-source', taskId: 'final-task' } };
  let result = await core.call('project_update', { requestId: uid(), projectId: created.projectId, expectedVersion: created.projectVersion, patch: { video } });
  const saved = await core.call('project_get', { projectId: created.projectId });
  result = await core.call('project_update', { requestId: uid(), projectId: created.projectId, expectedVersion: result.projectVersion, patch: { video: saved.project.video } });
  await assert.rejects(core.call('project_update', { requestId: uid(), projectId: created.projectId, expectedVersion: result.projectVersion, patch: { video: { ...video, unexpected: 'reject' } } }), e => e.code === 'invalid_input');
});

test('replaying an operation with a refreshed version cannot repeat a write or overwrite newer text', async t => {
  const { core } = await setup(t);
  const created = await core.call('project_create', { requestId: uid(), idea: '旧稿', type: 'novel' });
  const first = { requestId: uid(), projectId: created.projectId, expectedVersion: created.projectVersion, patch: { title: '第一稿' } };
  const saved = await core.call('project_update', first);
  const next = await core.call('project_update', { ...first, requestId: uid(), expectedVersion: saved.projectVersion, patch: { title: '第二稿' } });
  assert.equal((await core.call('project_update', { ...first, expectedVersion: next.projectVersion })).replayed, true);
  assert.equal((await core.call('project_get', { projectId: created.projectId })).project.title, '第二稿');
  await assert.rejects(core.call('project_update', { ...first, expectedVersion: next.projectVersion, patch: { title: '修改同一操作' } }), e => e.code === 'conflict');
  const stale = { requestId: uid(), projectId: created.projectId, expectedVersion: created.projectVersion, patch: { culture: '核实后的语境' } };
  await assert.rejects(core.call('project_update', stale), e => e.code === 'conflict');
  assert.ok((await core.call('project_update', { ...stale, expectedVersion: next.projectVersion })).projectVersion);
});

test('failed task replay makes no new request; an explicit retry uses a new durable ID', async t => {
  const env = {}; let calls = 0;
  const { core, tasks } = await setup(t, env, async () => { calls++; return response(art); });
  const created = await core.call('project_create', { requestId: uid(), idea: '手绘岭南', type: 'novel' });
  const input = { requestId: uid(), projectId: created.projectId, expectedVersion: created.projectVersion, kind: 'art' };
  await core.call('task_start', input); await until(tasks, input.requestId, 'failed');
  env.DEEPSEEK_API_KEY = 'test';
  assert.equal((await core.call('task_start', input)).status, 'failed'); assert.equal(calls, 0);
  const retry = { ...input, requestId: uid(), retryOf: input.requestId };
  await core.call('task_start', retry); await until(tasks, retry.requestId, 'succeeded');
  assert.equal(calls, 1); assert.equal((await tasks.get(input.requestId)).status, 'failed');
  await core.call('task_start', retry); assert.equal(calls, 1);
});

test('dismissed uncertain tasks release their slot without auto-resubmission', async t => {
  const { repo, core, tasks } = await setup(t, { DEEPSEEK_API_KEY: 'test' });
  const created = await core.call('project_create', { requestId: uid(), idea: '岭南', type: 'novel' });
  const { project } = await core.call('project_get', { projectId: created.projectId });
  await repo.saveTask({ id: 'old-task', projectId: project.id, kind: 'art', args: {}, source: taskSource(project, 'art', {}), snapshot: project, status: 'running', createdAt: Date.now() });
  await tasks.ready();
  assert.equal((await tasks.get('old-task')).status, 'uncertain');
  const request = { requestId: uid(), projectId: project.id, expectedVersion: digest(project), kind: 'art', retryOf: 'old-task' };
  await assert.rejects(core.call('task_start', request), e => e.code === 'invalid_retry');
  await core.call('task_dismiss', { taskId: 'old-task' });
  await core.call('task_start', request); await until(tasks, request.requestId, 'succeeded');
});

test('cancellation retains a paid response that finishes later, without adopting it', async t => {
  let finish; let entered;
  const started = new Promise(resolve => { entered = resolve; });
  const { core, tasks } = await setup(t, { DEEPSEEK_API_KEY: 'test' }, () => { entered(); return new Promise(resolve => { finish = resolve; }); });
  const created = await core.call('project_create', { requestId: uid(), idea: '岭南', type: 'novel' });
  const input = { requestId: uid(), projectId: created.projectId, expectedVersion: created.projectVersion, kind: 'art' };
  await core.call('task_start', input); await started;
  await core.call('task_cancel', { taskId: input.requestId }); finish(response(art));
  const task = await until(tasks, input.requestId, 'succeeded'); assert.equal(task.recoveredAfterCancel, true);
  assert.equal((await core.call('project_get', { projectId: created.projectId })).project.art.fullPrompt, '');
});

test('previous snapshot recovery is explicit, preserves corruption, and rejects stale recovery tokens', async t => {
  const { repo, directory } = await setup(t);
  const project = createProject('原稿', 'novel');
  await repo.saveWorkspace(ws(project), 0, uid()); project.title = '新稿'; await repo.saveWorkspace(ws(project), 1, uid());
  assert.equal((await repo.recoverWorkspace()).recoverable, false);
  await writeFile(join(directory, 'workspace.json'), '{broken');
  await assert.rejects(repo.loadWorkspace(), e => e.code === 'storage_error');
  const inspect = await repo.recoverWorkspace(); assert.equal(inspect.recoverable, true);
  await writeFile(join(directory, 'workspace.json'), '{changed');
  await assert.rejects(repo.recoverWorkspace({ action: 'restore', recoveryToken: inspect.recoveryToken }), e => e.code === 'conflict');
  const current = await repo.recoverWorkspace();
  const restored = await repo.recoverWorkspace({ action: 'restore', recoveryToken: current.recoveryToken });
  assert.equal(await readFile(join(directory, restored.preserved), 'utf8'), '{changed');
  assert.equal((await repo.loadWorkspace()).workspace.projects[0].title, '原稿');
  assert.equal((await repo.recoverWorkspace({ action: 'restore', recoveryToken: current.recoveryToken })).replayed, true);
});

test('provider settings govern new MCP image requests and explicit provider still overrides', async t => {
  let calls = 0;
  const env = {};
  const { core, tasks, directory } = await setup(t, env, async () => { calls++; return Response.json({ data: [{ b64_json: (await png()).toString('base64') }] }); });
  const settings = createServiceSettings(env, join(directory, 'settings.json'));
  settings.save({ WORKBENCH_IMAGE_PROVIDER: 'external', VIDEO_PROVIDER: 'external', IMAGE_API_KEY: 'test' });
  const created = await core.call('project_create', { requestId: uid(), idea: '岭南', type: 'novel' });
  const input = { requestId: uid(), projectId: created.projectId, expectedVersion: created.projectVersion, kind: 'cover' };
  const task = await core.call('task_start', input); assert.equal(task.args.provider, 'external');
  await until(tasks, input.requestId, 'succeeded'); assert.equal(calls, 1);
  const manual = await core.call('task_start', { ...input, requestId: uid(), args: { provider: 'workbuddy' } });
  const waiting = await until(tasks, manual.id, 'waiting_external'); assert.equal(waiting.dispatch, 'conversation'); assert.equal(calls, 1);
});

test('delivery returns available novel files even if an adopted media file is missing', async t => {
  const { repo, core, directory } = await setup(t);
  const project = createProject('岭南', 'novel'); project.novel = { title: '正文', text: '已保存正文', taskId: 'saved' };
  const image = await repo.putImage(await png()); project.assets = [{ id: 'asset-a', name: '参考', fileId: image.fileId }];
  await repo.saveWorkspace(ws(project), 0, uid()); await unlink(join(directory, 'media', image.fileId + '.png'));
  const delivered = await core.call('project_deliver', { projectId: project.id });
  assert.equal(delivered.partial, true); assert.equal(delivered.files.length, 2); assert.equal(delivered.missing[0].fileId, image.fileId);
});

test('dangling asset references identify the exact field and asset', () => {
  const project = createProject('岭南', 'novel'); project.coverAssetId = 'removed';
  assert.throws(() => validateWorkspace(ws(project)), /coverAssetId.*removed/);
  delete project.coverAssetId; project.references = [{ id: 'ref-a', assetId: 'removed', purpose: '' }];
  assert.throws(() => validateWorkspace(ws(project)), /references.ref-a.assetId.*removed/);
});

test('cleanup previews imported duplicates, rejects changed plans and never touches new source files or results', async t => {
  const { repo, core, directory } = await setup(t);
  const created = await core.call('project_create', { requestId: uid(), idea: '岭南', type: 'novel' });
  const inbox = await repo.inbox(created.projectId); await writeFile(join(inbox, 'reference.png'), await png());
  const imported = await core.call('media_import', { requestId: uid(), projectId: created.projectId, expectedVersion: created.projectVersion, filename: 'reference.png', role: 'image' });
  await writeFile(join(inbox, 'not-imported.png'), await png());
  const preview = await cleanupStorage(repo, { minimumAgeDays: 0 });
  assert.deepEqual(preview.entries.map(e => e.path), [`inbox/${created.projectId}/reference.png`]);
  await writeFile(join(inbox, 'reference.png'), Buffer.from('replacement'));
  await assert.rejects(cleanupStorage(repo, { execute: true, minimumAgeDays: 0, confirmationToken: preview.confirmationToken }), e => e.code === 'cleanup_changed');
  assert.equal((await cleanupStorage(repo, { minimumAgeDays: 0 })).entries.length, 0);
  await writeFile(join(inbox, 'reference.png'), await png());
  const fresh = await cleanupStorage(repo, { minimumAgeDays: 0 });
  const result = await cleanupStorage(repo, { execute: true, minimumAgeDays: 0, confirmationToken: fresh.confirmationToken });
  assert.equal(result.executed, true); assert.ok(await repo.media(imported.fileId));
  assert.ok(await readFile(join(inbox, 'not-imported.png')));
  await assert.rejects(readFile(join(inbox, 'reference.png')), e => e.code === 'ENOENT');
  assert.ok((await readFile(join(directory, 'workspace.json'))).length);
});
