import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile, writeFile, readdir, mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import sharp from 'sharp';
import {createTestDirectory} from './helpers/test-directory.mjs';
import {createRepository} from '../lib/workbench/repository.mjs';
import {normalizeCraftPlan} from '../lib/workbench/craft-contract.mjs';
import {PATTERN_KINDS, craftPatternStatus, requirePatternConfig, craftPatternPrompt, existingPatternHandoff, startCraftPattern, receiveCraftPattern, cleanupPatternWork} from '../lib/workbench/craft-pattern-runtime.mjs';

const env = {WORKBENCH_IMAGE_PROVIDER: 'external', IMAGE_API_KEY: 'fixture-image-secret', IMAGE_API_BASE_URL: 'https://images.example/v1', IMAGE_API_MODEL: 'fixture-image-model'};
const stats = {vertices: 770, triangles: 1536, objects: 1, materials: 1, dimensions: [.12,.12,.06], unit: 'm'};
const png = (size = 48) => sharp({create: {width: size, height: size, channels: 3, background: '#4a2f1b'}}).png().toBuffer();
function files(suffix = '') {
  const blend = Buffer.from('BLENDER-v500' + 'mock-only-' + suffix);
  const json = JSON.stringify({asset: {version: '2.0'}, extras: {fixture: suffix}}), padded = json.padEnd(Math.ceil(json.length / 4) * 4, ' '), glb = Buffer.alloc(20 + padded.length);
  glb.write('glTF'); glb.writeUInt32LE(2, 4); glb.writeUInt32LE(glb.length, 8); glb.writeUInt32LE(padded.length, 12); glb.writeUInt32LE(0x4e4f534a, 16); glb.write(padded, 20);
  return {blend, glb};
}
async function fixture(t, provider = 'external') {
  const scope = await createTestDirectory(t, 'craft-pattern-runtime'), repository = createRepository(scope.directory), original = files('source');
  const source = {taskId: 'source-bowl', title: '凉茶陶碗', kind: 'bowl', prompt: '岭南凉茶陶碗，深褐釉面', createdAt: 1,
    blendFileId: (await repository.putOutput(original.blend, 'blend')).fileId, glbFileId: (await repository.putOutput(original.glb, 'glb')).fileId,
    plan: normalizeCraftPlan({kind: 'bowl', material: {color: '#4a2f1b'}}), stats, warnings: [], knowledge: []};
  let task = {id: crypto.randomUUID(), projectId: crypto.randomUUID(), kind: 'craft-model', status: 'running', createdAt: Date.now(), args: {prompt: source.prompt, textureMode: 'image', textureSource: source, provider}};
  const update = async patch => {task = {...task, ...patch}; await repository.saveTask(task); return task;};
  await update({});
  const calls = [], stages = [];
  const fetchImpl = async (url, options) => {
    calls.push(String(url));
    assert.equal(String(url), 'https://images.example/v1/images/generations', 'image enhancement never uploads to COS or calls HY');
    const body = JSON.parse(options.body);
    assert.equal(body.n, 1); assert.equal(body.size, '1024x1024'); assert.equal(body.output_format, 'png'); assert.equal(body.model, env.IMAGE_API_MODEL);
    assert.equal((await repository.task(task.id)).patternSubmittedAt > 0, true);
    return Response.json({data: [{b64_json: (await png()).toString('base64')}]});
  };
  const blenderImpl = async directory => {
    stages.push(directory);
    assert.deepEqual(await readFile(join(directory, 'source.blend')), original.blend);
    assert.deepEqual(JSON.parse(await readFile(join(directory, 'source-plan.json'), 'utf8')), source.plan);
    const metadata = await sharp(await readFile(join(directory, 'pattern.png'))).metadata();
    assert.equal(metadata.width, 1024); assert.equal(metadata.height, 1024);
    assert.match((await repository.task(task.id)).patternImage.fileId, /^[a-f0-9]{64}$/);
    const output = files('pattern'); await writeFile(join(directory, 'asset.blend'), output.blend); await writeFile(join(directory, 'asset.glb'), output.glb);
    return {geometryHash: 'c'.repeat(64), geometryPreserved: true, packedTextures: true, reopened: true, stats};
  };
  return {scope, repository, source, original, getTask: () => task, update, fetchImpl, blenderImpl, calls, stages, options: {repository, env, fetchImpl, update, blenderImpl}};
}

test('pattern capability uses image credentials only and supports the eight existing vessel kinds', async t => {
  const s = await fixture(t);
  assert.equal(craftPatternStatus({}).provider, 'workbuddy');
  assert.equal(craftPatternStatus({}).ready, true, 'manual WorkBuddy handoff needs no cloud storage');
  assert.equal(craftPatternStatus({WORKBENCH_IMAGE_PROVIDER: 'external', DEEPSEEK_API_KEY: 'language-only'}).ready, false);
  assert.equal(craftPatternStatus(env).ready, true); assert.equal(PATTERN_KINDS.length, 8);
  assert.throws(() => requirePatternConfig({WORKBENCH_IMAGE_PROVIDER: 'external'}, s.source), e => e.code === 'not_configured');
  const building = {...s.source, kind: 'arcade', plan: normalizeCraftPlan({kind: 'arcade'})};
  assert.throws(() => requirePatternConfig(env, building), e => e.code === 'unsupported_pattern_kind');
  assert.ok(!JSON.stringify(craftPatternStatus(env)).includes(env.IMAGE_API_KEY));
});

test('pattern prompt asks for flat repeat artwork and preserves the original culture and glaze', async t => {
  const s = await fixture(t), prompt = craftPatternPrompt(s.source);
  for (const phrase of ['1024×1024', '#4a2f1b', '草本叶片', '左右可重复衔接', '主要图案远离四边', '不是碗', '禁止画器物轮廓', '原器物需求', '不得编造来源']) assert.ok(prompt.includes(phrase), phrase);
  assert.ok(craftPatternPrompt(s.source, '只画两层米白花叶').includes('只画两层米白花叶'));
  assert.deepEqual(existingPatternHandoff({kind: 'image', handoff: {output: 'result.png'}, args: {}}), {}, 'unrelated handoffs keep their own routing');
});

test('external image is saved before Blender, creates a new version, keeps source files and removes staging', async t => {
  const s = await fixture(t), result = await startCraftPattern(s.getTask(), s.options);
  assert.equal(s.calls.length, 1); assert.equal(s.stages.length, 1);
  assert.equal(result.craftAsset.texture.method, 'image-wrap'); assert.equal(result.craftAsset.texture.sourceTaskId, s.source.taskId);
  assert.equal(result.craftAsset.texture.imageFileId, s.getTask().patternImage.fileId);
  assert.equal(result.craftAsset.texture.model, env.IMAGE_API_MODEL);
  assert.deepEqual(result.craftAsset.plan, s.source.plan); assert.notEqual(result.craftAsset.blendFileId, s.source.blendFileId);
  assert.deepEqual(await s.repository.output(s.source.blendFileId), s.original.blend);
  assert.deepEqual(await readdir(join(s.scope.directory, 'render')), []);
  assert.equal(s.getTask().patternWork, undefined);
  assert.ok(!JSON.stringify(s.getTask()).includes(env.IMAGE_API_KEY));
});

test('WorkBuddy handoff keeps original ID, is manual without token and waits without copying model files', async t => {
  const s = await fixture(t, 'workbuddy'), options = {...s.options, env: {}};
  assert.equal(await startCraftPattern(s.getTask(), options), null);
  assert.equal(s.getTask().status, 'waiting_external'); assert.equal(s.getTask().dispatch, 'manual'); assert.equal(s.calls.length, 0);
  const h = existingPatternHandoff(s.getTask());
  for (const phrase of [s.getTask().id, 'task_complete_handoff', '不能调用 craft_complete_plan', 'result.craftAsset', '仅导入媒体库不算完成']) assert.ok(h.handoffMessage.includes(phrase));
  assert.equal(JSON.parse(await readFile(s.getTask().handoff.requestPath, 'utf8')).taskId, s.getTask().id);
  assert.equal(await receiveCraftPattern(s.getTask(), options), null);
  assert.deepEqual(await readdir(join(s.scope.directory, 'render')), []);
  await startCraftPattern(s.getTask(), options); assert.equal(s.calls.length, 0);
});

test('WorkBuddy sends only one message even if a waiting task is started again', async t => {
  const s = await fixture(t, 'workbuddy'), sent = [];
  const options = {...s.options, env: {WORKBUDDY_ACCESS_TOKEN: 'fixture-local-assistant'}, fetchImpl: async (url, request) => {
    assert.equal(url, 'https://www.workbuddy.cn/openapi/v2/localassistant/message'); sent.push(JSON.parse(request.body));
    assert.ok((await s.repository.task(s.getTask().id)).patternSubmittedAt);
    return Response.json({code: 0, data: {message_id: 'same-original-task'}});
  }};
  await startCraftPattern(s.getTask(), options); await startCraftPattern(s.getTask(), options);
  assert.equal(sent.length, 1); assert.equal(s.getTask().dispatch, 'sent'); assert.ok(sent[0].content.includes(s.getTask().id));
});

test('conversation handoff suppresses dispatch and completion preserves canonical original receipt after resize', async t => {
  const s = await fixture(t, 'workbuddy'); await s.update({args: {...s.getTask().args, handoffOnly: true}});
  const options = {...s.options, env: {WORKBUDDY_ACCESS_TOKEN: 'never-send'}, fetchImpl: async () => {throw Error('conversation cannot dispatch');}};
  await startCraftPattern(s.getTask(), options); assert.equal(s.getTask().dispatch, 'conversation');
  const input = await png(128), receipt = await s.repository.putImage(input);
  await s.repository.completeImageHandoff(s.getTask().id, input);
  const result = await receiveCraftPattern(s.getTask(), options);
  assert.equal(s.getTask().patternImage.originalFileId, receipt.fileId);
  assert.notEqual(s.getTask().patternImage.fileId, receipt.fileId);
  assert.equal(result.craftAsset.taskId, s.getTask().id); assert.equal(result.craftAsset.texture.model, '原任务 PNG 交接（生成模型未记录）');
  assert.equal(s.calls.length, 0); assert.deepEqual(await readdir(join(s.scope.directory, 'render')), []);
});

test('a durable image resumes after task persistence interruption without another paid image request', async t => {
  const s = await fixture(t); let interrupted = false;
  const options = {...s.options, update: async patch => {await s.update(patch); if (patch.patternImage && !interrupted) {interrupted = true; throw Error('saved receipt then interrupted');}}};
  await assert.rejects(startCraftPattern(s.getTask(), options), /saved receipt/);
  assert.ok(s.getTask().patternImage); assert.equal(s.stages.length, 0);
  const result = await startCraftPattern(s.getTask(), {...s.options, env: {}});
  assert.ok(result.craftAsset.blendFileId); assert.equal(s.calls.length, 1); assert.equal(s.stages.length, 1);
});

test('an unknown image submission is never sent again on restart', async t => {
  const s = await fixture(t); let attempts = 0;
  const options = {...s.options, fetchImpl: async () => {attempts++; throw Error('socket lost');}};
  await assert.rejects(startCraftPattern(s.getTask(), options), e => e.code === 'uncertain');
  await assert.rejects(startCraftPattern(s.getTask(), options), e => e.code === 'uncertain');
  assert.equal(attempts, 1); assert.equal(s.stages.length, 0);
});

test('failed Blender keeps the normalized image, cleans staging and is not automatically rerun by polling', async t => {
  const s = await fixture(t); let builds = 0;
  const options = {...s.options, blenderImpl: async () => {builds++; throw Error('guarded Blender exited with failure');}};
  await assert.rejects(startCraftPattern(s.getTask(), options), /Blender exited/);
  assert.ok(s.getTask().patternImage); assert.equal(s.getTask().patternApplyFailed, true);
  await s.update({status: 'uncertain'});
  await assert.rejects(receiveCraftPattern(s.getTask(), options), e => e.code === 'pattern_apply_failed');
  assert.equal(builds, 1); assert.equal(s.calls.length, 1); assert.deepEqual(await readdir(join(s.scope.directory, 'render')), []);
});

test('cancelled handoffs cannot start local Blender or publish a late result', async t => {
  const s = await fixture(t, 'workbuddy'), options = {...s.options, env: {}};
  await startCraftPattern(s.getTask(), options); await s.repository.completeImageHandoff(s.getTask().id, await png());
  await s.update({status: 'cancelled'});
  assert.equal(await receiveCraftPattern(s.getTask(), options), null);
  await assert.rejects(startCraftPattern(s.getTask(), options), e => e.code === 'interrupted');
  assert.equal(s.stages.length, 0); assert.equal(s.getTask().result, undefined);
});

test('temporary stage cleanup waits for the running operation to exit after cancellation', async t => {
  const s = await fixture(t), controller = new AbortController(); let finish, started;
  const entered = new Promise(resolve => {started = resolve;});
  const options = {...s.options, signal: controller.signal, blenderImpl: async directory => {started(directory); await new Promise(resolve => {finish = resolve;}); controller.signal.throwIfAborted();}};
  const pending = startCraftPattern(s.getTask(), options); const directory = await entered;
  controller.abort(); await s.update({status: 'cancelled'});
  assert.ok((await readdir(directory)).includes('source.blend'), 'do not delete while the engine is still running');
  const rejection = assert.rejects(pending); finish(); await rejection;
  assert.deepEqual(await readdir(join(s.scope.directory, 'render')), []); assert.equal(s.getTask().result, undefined);
});

test('ownership mismatch retains its directory instead of deleting another task files', async t => {
  const s = await fixture(t);
  const options = {...s.options, blenderImpl: async directory => {const report = await s.blenderImpl(directory); await writeFile(join(directory, 'owner.json'), JSON.stringify({taskId: 'different-task'})); return report;}};
  const result = await startCraftPattern(s.getTask(), options);
  assert.equal(s.getTask().patternCleanupPending, true); assert.ok(result.craftAsset.warnings.some(w => w.includes('临时图案文件未能清理')));
  assert.equal((await readdir(join(s.scope.directory, 'render'))).length, 1);
});

test('handoff image limits reject non-PNG and oversized input before creating a Blender stage', async t => {
  const s = await fixture(t, 'workbuddy'), options = {...s.options, env: {}};
  await startCraftPattern(s.getTask(), options);
  const jpeg = await sharp(await png()).jpeg().toBuffer();
  const repository = {...s.repository, readHandoff: async () => ({bytes: jpeg})};
  await assert.rejects(receiveCraftPattern(s.getTask(), {...options, repository}), e => e.code === 'invalid_pattern_image');
  const huge = Buffer.alloc(16 * 1024 * 1024 + 1);
  await assert.rejects(receiveCraftPattern(s.getTask(), {...options, repository: {...s.repository, readHandoff: async () => ({bytes: huge})}}), e => e.code === 'invalid_pattern_image');
  assert.equal(s.stages.length, 0);
});

test('restart reuses the saved image and removes its previous owned stage before making another stage', async t => {
  const s = await fixture(t);
  await assert.rejects(startCraftPattern(s.getTask(), {...s.options, update: async patch => {await s.update(patch); if (patch.patternImage) throw Error('fixture pause after saved image');}}), /fixture pause/);
  const nonce = crypto.randomUUID(), patternWork = {nonce, directory: 'pattern-' + nonce}, oldDirectory = join(s.scope.directory, 'render', patternWork.directory);
  await mkdir(oldDirectory);
  await writeFile(join(oldDirectory, 'owner.json'), JSON.stringify({nonce, taskId: s.getTask().id, source: s.source.blendFileId, processId: process.pid}));
  await writeFile(join(oldDirectory, 'source.blend'), s.original.blend);
  await s.update({patternWork, status: 'uncertain'});
  const result = await receiveCraftPattern(s.getTask(), {...s.options, blenderImpl: async directory => {
    await assert.rejects(readdir(oldDirectory), error => error.code === 'ENOENT');
    return s.blenderImpl(directory);
  }});
  assert.ok(result.craftAsset); assert.equal(s.calls.length, 1); assert.equal(s.stages.length, 1);
  assert.deepEqual(await readdir(join(s.scope.directory, 'render')), []); assert.equal(s.getTask().patternWork, undefined);
});

test('cleanup does not discard an old stage pointer when its owner marker is missing or another runtime still owns it', async t => {
  const s = await fixture(t), nonce = crypto.randomUUID(), patternWork = {nonce, directory: 'pattern-' + nonce}, directory = join(s.scope.directory, 'render', patternWork.directory);
  await mkdir(directory); await writeFile(join(directory, 'source.blend'), s.original.blend); await s.update({patternWork});
  await assert.rejects(cleanupPatternWork(s.getTask(), s.options), error => error.code === 'pattern_cleanup_pending');
  assert.deepEqual(s.getTask().patternWork, patternWork); assert.equal(s.getTask().patternCleanupPending, true);
  await writeFile(join(directory, 'owner.json'), JSON.stringify({nonce, taskId: s.getTask().id, source: s.source.blendFileId, processId: process.ppid}));
  await assert.rejects(cleanupPatternWork(s.getTask(), s.options), error => error.code === 'pattern_work_busy');
  assert.deepEqual(await readFile(join(directory, 'source.blend')), s.original.blend);
  assert.deepEqual(s.getTask().patternWork, patternWork);
});
