import test from 'node:test';
import assert from 'node:assert/strict';
import {craftStudioState} from '../features/creative-flow/craft-state.mjs';
import {createProject} from '../lib/workbench/project-core.mjs';
import {taskSource} from '../lib/workbench/task-contract.mjs';
import {applyKnowledge, currentKnowledge} from '../lib/workbench/knowledge.mjs';
import {craftModelPath, createDemandRender, disposeModel, readModelResponse, validatePreviewGlb} from '../features/creative-flow/craft-viewer-resources.mjs';

const asset = (taskId, createdAt) => ({taskId, createdAt, title: taskId, glbFileId: 'a'.repeat(64) + '.glb', blendFileId: 'b'.repeat(64) + '.blend'});
const task = (id, status, createdAt) => ({id, status, createdAt, updatedAt: createdAt, projectId: 'project', kind: 'craft-model', result: status === 'succeeded' ? {craftAsset: asset(id, createdAt)} : undefined});
const craftProject = (taskId, requestedAt = 1) => ({...createProject('生成一只陶碗', 'craft', '', 'project'), craftRequest: {taskId, goal: '生成一只陶碗', requestedAt}});
const withSource = (project, value) => { const args = {prompt: project.craftRequest.goal}; return {...value, args, source: taskSource(project, 'craft-model', args)}; };

test('craft success receipt immediately replaces the old preview before workspace synchronization', () => {
  const previous = asset('old', 1), project = {...craftProject('new', 2), craftAsset: previous};
  const current = withSource(project, task('new', 'succeeded', 2));
  const state = craftStudioState(project, [task('old', 'succeeded', 1)], current);
  assert.equal(state.task.id, 'new'); assert.equal(state.latest.taskId, 'new'); assert.equal(state.active, false);
  assert.deepEqual(state.assets.map(value => value.taskId), ['new', 'old']);
});

test('success receipts wait for the matching request pointer before replacing the current preview', () => {
  const before = {...craftProject('old', 1), craftAsset: asset('old', 1)};
  const after = {...before, craftRequest: {taskId: 'new', goal: before.craftRequest.goal, requestedAt: 2}};
  const current = withSource(after, task('new', 'succeeded', 2));
  assert.equal(craftStudioState(before, [], current).latest.taskId, 'old');
  assert.equal(craftStudioState(after, [], current).latest.taskId, 'new');
});

test('changed cultural knowledge keeps an otherwise successful model in history before workspace attachment', () => {
  const source = craftProject('new', 2), current = withSource(source, task('new', 'succeeded', 2));
  const changed = {...applyKnowledge(source, [currentKnowledge.entries[0].id]), craftAsset: asset('old', 1)};
  const state = craftStudioState(changed, [current]);
  assert.equal(state.latest.taskId, 'old'); assert.equal(state.resultEligible, false); assert.equal(state.historicalResult, true);
  assert.ok(state.assets.some(value => value.taskId === 'new'));
  assert.equal(craftStudioState({...changed, craftAsset: undefined}, [current]).latest, null);
});

test('Runtime generated-history decisions and recovered cancellations cannot be promoted by task receipts', () => {
  const project = craftProject('new', 2), current = withSource(project, task('new', 'succeeded', 2));
  const history = {...project, craftAsset: asset('old', 1), flow: {records: [{type: 'craft', target: 'craftAsset', origin: 'generated-history', taskId: current.id, value: current.result.craftAsset}]}};
  assert.equal(craftStudioState(history, [], current).latest.taskId, 'old');
  assert.equal(craftStudioState({...history, craftAsset: undefined}, [], current).latest, null);
  assert.equal(craftStudioState(project, [], {...current, recoveredAfterCancel: true}).latest, null);
});

test('editing the next requirement does not invalidate a successful matching current request', () => {
  const project = craftProject('new', 2), current = withSource(project, task('new', 'succeeded', 2));
  const state = craftStudioState({...project, craftGoal: '下一版改成白色花瓶'}, [], current);
  assert.equal(state.latest.taskId, 'new'); assert.equal(state.resultEligible, true);
});

test('craft keeps one version per task, retains history, and observes cancellation instead of a stale receipt', () => {
  const project = {id: 'project', craftAsset: asset('old', 1), craftRequest: {taskId: 'new'}, flow: {records: [{type: 'craft', target: 'craftAsset', value: asset('first', 0)}, {type: 'craft', target: 'craftAsset', value: asset('old', 1)}]}};
  const receipt = task('new', 'waiting_external', 2), cancelled = {...task('new', 'cancelled', 2), updatedAt: 3};
  const state = craftStudioState(project, [cancelled, task('old', 'succeeded', 1), {...task('foreign', 'succeeded', 4), projectId: 'another'}], receipt);
  assert.equal(state.task.status, 'cancelled'); assert.equal(state.active, false); assert.equal(state.latest.taskId, 'old'); assert.equal(state.assets.length, 2);
  assert.equal(craftStudioState(project, [receipt]).active, true);
});

test('a late historical completion stays available without replacing the current model preview', () => {
  const old = task('older-request', 'succeeded', 1); old.result.craftAsset.createdAt = 10;
  const current = task('current-request', 'succeeded', 3);
  const project = {id: 'project', craftRequest: {taskId: current.id}, craftAsset: current.result.craftAsset};
  const state = craftStudioState(project, [old, current]);
  assert.equal(state.latest.taskId, current.id); assert.equal(state.assets.length, 2);
  const waiting = task('next-request', 'waiting_external', 11);
  assert.equal(craftStudioState({...project, craftRequest: {taskId: waiting.id}}, [old, current, waiting]).latest.taskId, current.id);
});

function glb(json, contents = new Uint8Array(48)) {
  const encoded = new TextEncoder().encode(JSON.stringify(json)), length = Math.ceil(encoded.length / 4) * 4;
  const binaryLength = Math.ceil(contents.byteLength / 4) * 4;
  const buffer = new ArrayBuffer(28 + length + binaryLength), view = new DataView(buffer);
  view.setUint32(0, 0x46546c67, true); view.setUint32(4, 2, true); view.setUint32(8, buffer.byteLength, true); view.setUint32(12, length, true); view.setUint32(16, 0x4e4f534a, true);
  new Uint8Array(buffer, 20, length).fill(32); new Uint8Array(buffer, 20, encoded.length).set(encoded);
  view.setUint32(20 + length, binaryLength, true); view.setUint32(24 + length, 0x004e4942, true);
  new Uint8Array(buffer, 28 + length, contents.byteLength).set(contents); return buffer;
}
function generatedJson() {
  return {asset: {version: '2.0'}, scene: 0, scenes: [{nodes: [0]}], nodes: [{mesh: 0}], meshes: [{primitives: [{attributes: {POSITION: 0}, indices: 1}]}],
    buffers: [{byteLength: 48}], bufferViews: [{buffer: 0, byteOffset: 0, byteLength: 36}, {buffer: 0, byteOffset: 36, byteLength: 6}],
    accessors: [{bufferView: 0, componentType: 5126, count: 3, type: 'VEC3'}, {bufferView: 1, componentType: 5123, count: 3, type: 'SCALAR'}]};
}

test('preview only allows local hashed GLB assets and rejects external model resources before loading', () => {
  assert.match(craftModelPath('a'.repeat(64) + '.glb'), /^\/api\/workbench\/data\/files\//);
  for (const value of ['https://example.com/a.glb', '../asset.glb', 'a'.repeat(64) + '.blend', 'a'.repeat(64) + '.glb?url=x']) assert.throws(() => craftModelPath(value));
  assert.equal(validatePreviewGlb(glb(generatedJson())).asset.version, '2.0');
  assert.throws(() => validatePreviewGlb(glb({asset: {version: '2.0'}, images: [{uri: 'https://example.com/image.png'}]})), /外部资源/);
  assert.throws(() => validatePreviewGlb(glb({asset: {version: '2.0'}, extensions: {custom: {uri: 'file:///secret'}}})), /外部资源|不支持的扩展/);
  assert.throws(() => validatePreviewGlb(glb({...generatedJson(), accessors: [{count: 3000001}]})), /accessor/);
  const broken = glb({asset: {version: '2.0'}}); new DataView(broken).setUint32(8, 999, true); assert.throws(() => validatePreviewGlb(broken), /完整/);
});

test('tiny GLBs cannot request huge empty or sparse accessor allocations', () => {
  const tiny = {...generatedJson(), accessors: Array.from({length: 40}, () => ({componentType: 5126, count: 3000000, type: 'VEC3'}))};
  const bytes = glb(tiny); assert.ok(bytes.byteLength < 8192);
  assert.throws(() => validatePreviewGlb(bytes), /accessor/);
  const sparse = generatedJson(); sparse.accessors[0].sparse = {count: 1};
  assert.throws(() => validatePreviewGlb(glb(sparse)), /accessor/);
  const bounds = generatedJson(); bounds.bufferViews[0].byteOffset = 20;
  assert.throws(() => validatePreviewGlb(glb(bounds)), /缓冲区访问越界/);
  const accessor = generatedJson(); accessor.accessors[0].byteOffset = 8;
  assert.throws(() => validatePreviewGlb(glb(accessor)), /accessor 访问越界/);
});

test('overlapping accessors and repeated mesh instances still obey the decoded byte budget', () => {
  // This fixture contains only 1.4 MB. Validation never constructs the dozens
  // of decoded vertex arrays that the hostile metadata asks a loader to make.
  const bytes = new Uint8Array(1440008), data = generatedJson(); data.buffers[0].byteLength = bytes.length;
  data.bufferViews = [{buffer: 0, byteLength: 1440000}, {buffer: 0, byteOffset: 1440000, byteLength: 6}];
  const vertices = {bufferView: 0, componentType: 5126, count: 120000, type: 'VEC3'};
  data.accessors = Array.from({length: 24}, () => ({...vertices}));
  assert.throws(() => validatePreviewGlb(glb(data, bytes)), /累计网格解码预算/);
  data.accessors = [vertices, {bufferView: 1, componentType: 5123, count: 3, type: 'SCALAR'}];
  data.nodes = Array.from({length: 24}, () => ({mesh: 0})); data.scenes[0].nodes = data.nodes.map((_, index) => index);
  assert.throws(() => validatePreviewGlb(glb(data, bytes)), /累计场景解码预算/);
});

test('embedded PNG dimensions and total decoded pixels are checked before image decoding', () => {
  const bytes = new Uint8Array(84), png = new DataView(bytes.buffer, 48, 33), data = generatedJson();
  png.setUint32(0, 0x89504e47); png.setUint32(4, 0x0d0a1a0a); png.setUint32(8, 13); png.setUint32(12, 0x49484452); png.setUint32(16, 256); png.setUint32(20, 256); png.setUint8(24, 8);
  data.buffers[0].byteLength = bytes.length; data.bufferViews.push({buffer: 0, byteOffset: 48, byteLength: 33}); data.images = [{bufferView: 2, mimeType: 'image/png'}]; data.textures = [{source: 0}];
  assert.equal(validatePreviewGlb(glb(data, bytes)).images.length, 1);
  png.setUint32(16, 65536); assert.throws(() => validatePreviewGlb(glb(data, bytes)), /纹理尺寸/);
  png.setUint32(16, 1024); png.setUint32(20, 1024); data.images = Array.from({length: 5}, () => ({bufferView: 2, mimeType: 'image/png'}));
  assert.throws(() => validatePreviewGlb(glb(data, bytes)), /累计纹理解码预算/);
  data.images = [data.images[0]]; data.textures = Array.from({length: 5}, () => ({source: 0}));
  assert.throws(() => validatePreviewGlb(glb(data, bytes)), /累计纹理实例解码预算/);
});

test('cyclic scene graphs, excessive nodes and compression extensions are rejected', () => {
  const cycle = generatedJson(); cycle.nodes[0].children = [0]; assert.throws(() => validatePreviewGlb(glb(cycle)), /节点重复/);
  const nodes = generatedJson(); nodes.nodes = Array.from({length: 513}, () => ({mesh: 0})); assert.throws(() => validatePreviewGlb(glb(nodes)), /nodes/);
  const compressed = generatedJson(); compressed.meshes[0].primitives[0].extensions = {KHR_draco_mesh_compression: {bufferView: 0}}; assert.throws(() => validatePreviewGlb(glb(compressed)), /不支持的扩展/);
  const material = generatedJson(); material.materials = [{extensions: {KHR_materials_ior: {ior: 1.4}}}]; assert.equal(validatePreviewGlb(glb(material)).materials.length, 1);
});

test('preview cancels oversized streams even when Content-Length is missing or wrong', async () => {
  let cancelled = 0;
  const response = new Response(new ReadableStream({pull(controller) { controller.enqueue(new Uint8Array(40)); }, cancel() { cancelled++; }}), {headers: {'content-length': '1'}});
  await assert.rejects(readModelResponse(response, new AbortController().signal, 64), /上限/);
  assert.equal(cancelled, 1); assert.equal(response.body.locked, false);
  const small = new Response(new Uint8Array([1, 2, 3])); assert.deepEqual([...new Uint8Array(await readModelResponse(small))], [1, 2, 3]);
});

test('preview rejects declared oversize and aborted reads without retaining the stream', async () => {
  let cancelled = 0;
  const stream = () => new ReadableStream({cancel() { cancelled++; }});
  const oversized = new Response(stream(), {headers: {'content-length': '1000'}});
  await assert.rejects(readModelResponse(oversized, undefined, 64), /上限/); assert.equal(cancelled, 1);
  const abort = new AbortController(); abort.abort();
  const stopped = new Response(stream()); await assert.rejects(readModelResponse(stopped, abort.signal), {name: 'AbortError'});
  assert.equal(cancelled, 2); assert.equal(stopped.body.locked, false);
});

test('preview disposes shared geometry, material, textures and bitmaps once', () => {
  const counts = {geometry: 0, material: 0, texture: 0, image: 0};
  const image = {close() { counts.image++; }}, texture = {isTexture: true, source: {data: image}, dispose() { counts.texture++; }};
  const material = {map: texture, normalMap: texture, uniforms: {map: {value: texture}}, dispose() { counts.material++; }};
  const geometry = {dispose() { counts.geometry++; }};
  disposeModel({traverse(callback) { callback({geometry, material: [material, material]}); callback({geometry, material, skeleton: {boneTexture: texture}}); }});
  assert.deepEqual(counts, {geometry: 1, material: 1, texture: 1, image: 1});
});

test('preview renders only on demand and cancels pending work when hidden or unmounted', () => {
  let next = 0, rendered = 0; const callbacks = new Map();
  const demand = createDemandRender(() => rendered++, callback => { callbacks.set(++next, callback); return next; }, id => callbacks.delete(id));
  demand.request(); demand.request(); assert.equal(callbacks.size, 1);
  let callback = callbacks.get(1); callbacks.delete(1); callback(); assert.equal(rendered, 1); assert.equal(callbacks.size, 0);
  demand.request(); demand.visible(false); assert.equal(callbacks.size, 0); demand.request(); assert.equal(callbacks.size, 0);
  demand.visible(true); assert.equal(callbacks.size, 1); callback = [...callbacks.values()][0]; demand.dispose(); assert.equal(callbacks.size, 0);
  callback(); demand.request(); assert.equal(rendered, 1); assert.equal(callbacks.size, 0);
});

test('optional model rotation has one frame loop, limits draw rate and stops when unchecked', () => {
  let next = 0, rendered = 0; const callbacks = new Map(), deltas = [];
  const demand = createDemandRender(() => rendered++, callback => { callbacks.set(++next, callback); return next; }, id => callbacks.delete(id), seconds => deltas.push(seconds));
  const tick = time => { assert.equal(callbacks.size, 1); const [id, callback] = [...callbacks][0]; callbacks.delete(id); callback(time); };
  demand.request(); tick(0); assert.equal(callbacks.size, 0); assert.equal(deltas.length, 0);
  demand.animate(true); demand.animate(true); demand.request(); tick(1000);
  assert.deepEqual(deltas, [0]); assert.equal(rendered, 2);
  tick(1016); assert.equal(rendered, 2, 'high refresh rate must not redraw on every display tick');
  tick(1034); assert.equal(rendered, 3); assert.equal(deltas[1], .034);
  tick(4000); assert.equal(deltas[2], .1, 'a slow frame must not cause a large rotation jump');
  demand.animate(false); tick(5000); assert.equal(callbacks.size, 0);
  assert.equal(deltas.length, 3, 'unchecking must immediately stop moving the model');
  demand.dispose();
});

test('hidden rotation pauses its clock and stale callbacks cannot revive a hidden or disposed viewer', () => {
  let next = 0, rendered = 0; const callbacks = new Map(), deltas = [];
  const demand = createDemandRender(() => rendered++, callback => { callbacks.set(++next, callback); return next; }, id => callbacks.delete(id), seconds => deltas.push(seconds));
  const tick = time => { const [id, callback] = [...callbacks][0]; callbacks.delete(id); callback(time); };
  demand.animate(true); tick(10); tick(50);
  const stale = [...callbacks.values()][0];
  demand.visible(false); assert.equal(callbacks.size, 0);
  demand.request(); stale(100); assert.equal(callbacks.size, 0); assert.equal(rendered, 2);
  demand.visible(true); stale(200); assert.equal(callbacks.size, 1, 'the old callback must not clear the resumed frame');
  tick(900000); assert.equal(deltas.at(-1), 0, 'background time must not advance the model');
  const afterUnmount = [...callbacks.values()][0]; demand.dispose();
  afterUnmount(900100); demand.visible(true); demand.animate(true); demand.request();
  assert.equal(callbacks.size, 0); assert.equal(rendered, 3);
});
