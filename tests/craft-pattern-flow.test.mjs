import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir, readFile, writeFile, readdir} from 'node:fs/promises';
import {join} from 'node:path';
import sharp from 'sharp';
import {createTestDirectory} from './helpers/test-directory.mjs';
import {createRepository, digest} from '../lib/workbench/repository.mjs';
import {createProject} from '../lib/workbench/project-core.mjs';
import {createCoreService} from '../lib/workbench/core-service.mjs';
import {createTaskManager} from '../lib/workbench/tasks.mjs';
import {normalizeCraftPlan} from '../lib/workbench/craft-contract.mjs';
import {buildCraftAsset} from '../lib/workbench/craft-engine.mjs';
import {validatePreviewGlb} from '../features/creative-flow/craft-viewer-resources.mjs';

const stats = {vertices: 770, triangles: 1536, objects: 1, materials: 1, dimensions: [.12,.12,.06], unit: 'm'};
const ornament = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="1280"><rect width="1280" height="1280" fill="#4a2f1b"/><g fill="#c4d3a4"><ellipse cx="400" cy="600" rx="180" ry="70" transform="rotate(-25 400 600)"/><ellipse cx="850" cy="600" rx="180" ry="70" transform="rotate(25 850 600)"/></g><path d="M240 770Q640 450 1020 770" stroke="#c6a96e" stroke-width="25" fill="none"/></svg>');
const png = () => sharp(ornament).png().toBuffer();
function mockFiles() {
  const json = JSON.stringify({asset: {version: '2.0'}, extras: {fixture: true}}), padded = json.padEnd(Math.ceil(json.length / 4) * 4, ' '), glb = Buffer.alloc(20 + padded.length);
  glb.write('glTF'); glb.writeUInt32LE(2, 4); glb.writeUInt32LE(glb.length, 8); glb.writeUInt32LE(padded.length, 12); glb.writeUInt32LE(0x4e4f534a, 16); glb.write(padded, 20);
  return {blend: Buffer.from('BLENDER-v500' + 'fixture-header-only'), glb};
}
async function fixture(t, {kind = 'bowl', real = false} = {}) {
  const scope = await createTestDirectory(t, 'craft-pattern-flow'), repository = createRepository(join(scope.directory, 'data'));
  const plan = normalizeCraftPlan({kind, title: '凉茶陶碗', material: {color: '#4a2f1b', roughness: .45}, decoration: {style: 'plain'}});
  let original = mockFiles(), sourceStats = stats;
  if (real) {
    const base = join(scope.directory, 'base'); await mkdir(base);
    const built = await buildCraftAsset(plan, {directory: base});
    original = {blend: await readFile(built.blendPath), glb: await readFile(built.glbPath)}; sourceStats = built.stats;
  }
  const source = {taskId: 'source-bowl', title: plan.title, kind, prompt: '岭南凉茶陶碗，深褐釉面', createdAt: 1, plan, stats: sourceStats, warnings: [], knowledge: [],
    blendFileId: (await repository.putOutput(original.blend, 'blend')).fileId, glbFileId: (await repository.putOutput(original.glb, 'glb')).fileId};
  const project = {...createProject(source.prompt, 'craft'), craftAsset: source, craftGoal: '保留：下一轮想做一个高一些的花瓶'};
  await repository.mutateProject({projectId: project.id, create: true, operationId: 'fixture-project', requestHash: 'fixture-project'}, () => ({project}));
  // Header-only tests never launch Blender. The availability check merely sees
  // this existing binary; success tests use the actually installed Blender.
  const env = real ? {WORKBENCH_IMAGE_PROVIDER: 'workbuddy', WORKBUDDY_ACCESS_TOKEN: 'fixture-never-dispatched'} : {WORKBENCH_IMAGE_PROVIDER: 'workbuddy', WORKBENCH_BLENDER_PATH: process.execPath};
  const network = [], errors = [];
  const fetchImpl = async url => {network.push(String(url)); throw Error('No real provider or COS calls are allowed in this fixture');};
  let manager, core;
  const connect = () => {
    manager = createTaskManager(repository, {env, fetchImpl, onError: error => errors.push(error)});
    scope.defer(() => manager.stop());
    core = createCoreService(repository, manager, {env, fetchImpl});
    return core;
  };
  connect();
  const current = async () => (await repository.loadWorkspace()).workspace.projects.find(p => p.id === project.id);
  const request = async (extra = {}) => ({requestId: crypto.randomUUID(), projectId: project.id, expectedVersion: digest(await current()), goal: source.prompt, textureOf: source.taskId, textureMode: 'image', ...extra});
  return {scope, repository, source, original, project, env, network, errors, current, request, get core() {return core;}, get manager() {return manager;}, connect};
}

async function waitTask(core, taskId, expected, timeout = 5000) {
  const until = Date.now() + timeout; let last;
  while (Date.now() < until) {
    last = await core.call('task_get', {taskId});
    if (last.status === expected) return last;
    if (['failed','cancelled'].includes(last.status)) assert.fail(`Task became ${last.status}: ${last.code || ''} ${last.error || ''}`);
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  assert.fail(`Task did not reach ${expected}: ${last?.status} ${last?.error || last?.note || ''}`);
}

test('core image pattern preflight needs no COS and rejects invalid source scope before changing the request pointer', async t => {
  const s = await fixture(t), before = digest(await s.current());
  const status = await s.core.call('workbench_status', {});
  assert.equal(status.providers.craft.pattern.ready, true); assert.equal(status.providers.craft.texture.ready, false);
  assert.equal(status.providers.craft.pattern.provider, 'workbuddy');
  for (const [change, code] of [
    [{textureOf: 'other-project-version'}, 'not_found'],
    [{goal: '将碗变成高瓶'}, 'invalid_input'],
    [{planJson: JSON.stringify({kind: 'bowl'})}, 'invalid_input'],
    [{textureOf: undefined}, 'invalid_input'],
  ]) {
    await assert.rejects(s.core.call('craft_generate', await s.request(change)), error => error.code === code);
    assert.equal(digest(await s.current()), before, 'invalid selection must not claim the current task pointer');
  }
  assert.equal((await s.repository.listTasks()).length, 0); assert.deepEqual(s.network, []);
  const architecture = await fixture(t, {kind: 'arcade'}), original = digest(await architecture.current());
  await assert.rejects(architecture.core.call('craft_generate', await architecture.request()), error => error.code === 'unsupported_pattern_kind');
  assert.equal(digest(await architecture.current()), original);
});

test('core and real task manager expose one manual pattern handoff, retain it across restart and reject late completion after cancellation', async t => {
  const s = await fixture(t), input = await s.request();
  const submitted = await s.core.call('craft_generate', input);
  assert.equal(submitted.id, input.requestId);
  const waiting = await waitTask(s.core, input.requestId, 'waiting_external');
  assert.equal(waiting.dispatch, 'manual'); assert.equal(waiting.args.provider, 'workbuddy');
  assert.equal(waiting.handoffContract.taskId, input.requestId); assert.equal(waiting.handoffContract.completionTool, 'task_complete_handoff');
  assert.ok(waiting.next.includes('task_complete_handoff')); assert.ok(waiting.next.includes('result.craftAsset'));
  assert.ok(waiting.handoffMessage.includes(waiting.handoff.output));
  assert.equal((await s.current()).craftGoal, s.project.craftGoal); assert.equal((await s.current()).craftAsset.taskId, s.source.taskId);
  const listed = await s.core.call('task_list', {projectId: s.project.id});
  assert.equal(listed.tasks.length, 1); assert.equal(listed.tasks[0].handoffContract.taskId, input.requestId);
  const replay = await s.core.call('craft_generate', input); assert.equal(replay.id, input.requestId);
  const beforePending = digest(await s.current());
  await assert.rejects(s.core.call('craft_generate', await s.request()), error => error.code === 'pending_task');
  assert.equal(digest(await s.current()), beforePending);
  await s.manager.stop(); s.connect();
  const resumed = await s.core.call('task_get', {taskId: input.requestId});
  assert.equal(resumed.status, 'waiting_external'); assert.equal(resumed.handoff.output, waiting.handoff.output);
  assert.equal((await s.repository.listTasks()).length, 1); assert.deepEqual(s.network, []);
  await s.core.call('task_cancel', {taskId: input.requestId});
  const inbox = await s.repository.inbox(s.project.id); await writeFile(join(inbox, 'late.png'), await png());
  await assert.rejects(s.core.call('task_complete_handoff', {taskId: input.requestId, filename: 'late.png'}), error => error.code === 'invalid_task_state');
  const cancelled = await s.core.call('task_get', {taskId: input.requestId});
  assert.equal(cancelled.status, 'cancelled'); assert.equal(cancelled.result, undefined);
  assert.equal((await s.current()).craftAsset.taskId, s.source.taskId); assert.equal((await s.current()).craftGoal, s.project.craftGoal);
  assert.deepEqual(await s.repository.output(s.source.blendFileId), s.original.blend); assert.deepEqual(s.network, []);
  assert.deepEqual(await readdir(join(s.repository.root, 'render')), []);
});

test('explicit retry reuses a saved image only when source model and pattern request still match', async t => {
  for (const changed of [false, true]) {
    const s = await fixture(t), first = await s.request();
    await s.core.call('craft_generate', first); await waitTask(s.core, first.requestId, 'waiting_external');
    const previous = await s.repository.task(first.requestId), image = await s.repository.putImage(await png());
    const patternImage = {fileId: image.fileId, originalFileId: image.fileId, model: 'fixture-existing-image'};
    await s.repository.saveTask({...previous, status: 'failed', code: 'pattern_build_failed', patternApplyFailed: true, patternImage});
    const input = await s.request({retryOf: first.requestId, texturePrompt: changed ? '改成另一组几何花纹' : previous.args.texturePrompt});
    const retry = await s.core.call('craft_generate', input);
    // Inspect the durable queued receipt and stop before any local Blender
    // process is scheduled; this test isolates retry selection, not geometry.
    await s.manager.stop();
    assert.equal(retry.status, 'queued'); assert.equal(retry.patternApplyFailed, undefined);
    assert.equal(retry.handoff, undefined);
    if (changed) assert.equal(retry.patternImage, undefined, 'a changed design needs a new explicitly requested image');
    else assert.deepEqual(retry.patternImage, patternImage, 'same local failure retry must not pay for the same image again');
    assert.equal((await s.repository.task(first.requestId)).supersededBy, input.requestId);
    assert.deepEqual(s.network, []);
  }
});

test('real Blender core handoff completes the original task, auto-selects the model and keeps history with idempotent PNG completion', {skip: process.env.WORKBENCH_TEST_BLENDER !== '1', timeout: 180000}, async t => {
  const s = await fixture(t, {real: true}), input = await s.request({dispatch: 'conversation'});
  await s.core.call('craft_generate', input);
  const waiting = await waitTask(s.core, input.requestId, 'waiting_external');
  assert.equal(waiting.dispatch, 'conversation'); assert.equal(s.network.length, 0);
  const image = await png(), inbox = await s.repository.inbox(s.project.id);
  await writeFile(join(inbox, 'pattern.png'), image);
  const receipt = await s.core.call('task_complete_handoff', {taskId: input.requestId, filename: 'pattern.png'});
  assert.equal(receipt.id, input.requestId); assert.equal(receipt.handoffCompletion.alreadyWritten, false);
  const finished = await waitTask(s.core, input.requestId, 'succeeded', 120000);
  const current = await s.current(), asset = finished.result.craftAsset;
  assert.equal(asset.taskId, input.requestId); assert.equal(asset.texture.method, 'image-wrap');
  assert.equal(asset.texture.sourceTaskId, s.source.taskId); assert.equal(current.craftAsset.taskId, input.requestId);
  assert.equal(current.craftGoal, s.project.craftGoal); assert.deepEqual(asset.plan, s.source.plan);
  assert.equal(asset.stats.vertices, s.source.stats.vertices); assert.equal(asset.stats.triangles, s.source.stats.triangles);
  assert.ok(current.flow.records.some(record => record.target === 'craftAsset' && record.value.taskId === s.source.taskId), 'previous source version is retained');
  assert.deepEqual(await s.repository.output(s.source.blendFileId), s.original.blend);
  assert.deepEqual(await s.repository.output(s.source.glbFileId), s.original.glb);
  const blend = await s.repository.output(asset.blendFileId), glb = await s.repository.output(asset.glbFileId);
  assert.equal(blend.subarray(0, 7).toString(), 'BLENDER');
  const preview = validatePreviewGlb(glb.buffer.slice(glb.byteOffset, glb.byteOffset + glb.byteLength));
  assert.ok(preview.materials.some(material => material.pbrMetallicRoughness?.baseColorTexture));
  assert.notEqual(finished.patternImage.originalFileId, finished.patternImage.fileId, '1280 source image is normalized to the 1024 texture budget');
  assert.equal(finished.patternImage.originalFileId, receipt.handoffCompletion.fileId);
  const again = await s.core.call('task_complete_handoff', {taskId: input.requestId, filename: 'pattern.png'});
  assert.equal(again.handoffCompletion.alreadyWritten, true); assert.equal(again.result.craftAsset.blendFileId, asset.blendFileId);
  await writeFile(join(inbox, 'different.png'), await sharp({create: {width: 64, height: 64, channels: 3, background: '#ffffff'}}).png().toBuffer());
  await assert.rejects(s.core.call('task_complete_handoff', {taskId: input.requestId, filename: 'different.png'}), error => error.code === 'handoff_conflict');
  assert.equal((await s.repository.listTasks()).length, 1); assert.equal((await s.current()).craftAsset.taskId, input.requestId);
  assert.equal(s.network.length, 0); assert.deepEqual(await readdir(join(s.repository.root, 'render')), []);
  assert.deepEqual(s.errors, []);
});
