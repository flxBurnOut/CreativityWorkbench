import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { normalizeCraftPlan, CRAFT_KINDS, CRAFT_PLAN_SCHEMA } from '../lib/workbench/craft-contract.mjs';
import { buildCraftAsset, craftEngineStatus } from '../lib/workbench/craft-engine.mjs';
import { createTestDirectory } from './helpers/test-directory.mjs';

test('craft plan remains bounded and does not accept executable or arbitrary fields', () => {
  const bowl = normalizeCraftPlan({ kind: 'bowl', decoration: { style: 'floral' } });
  assert.equal(bowl.version, 1);
  assert.equal(bowl.dimensions.wallThickness, .5);
  assert.equal(bowl.decoration.style, 'floral');
  assert.deepEqual(normalizeCraftPlan(bowl), bowl);
  assert.equal(normalizeCraftPlan({ kind: 'bowl', dimensions: { height: 1 } }).dimensions.wallThickness, .125);
  for (const kind of CRAFT_KINDS) {
    const normalized = normalizeCraftPlan({ kind });
    assert.equal(normalized.kind, kind);
    assert.deepEqual(normalizeCraftPlan(normalized), normalized);
  }
  for (const value of [
    { kind: 'dragon' }, { kind: 'bowl', python: 'import os' }, { kind: 'bowl', version: 2 },
    { kind: 'bowl', dimensions: { width: 1e8 } }, { kind: 'bowl', dimensions: { height: NaN } },
    { kind: 'bowl', dimensions: { wallThickness: 4 } }, { kind: 'bowl', dimensions: { width: '16' } },
    { kind: 'bowl', material: { texturePath: 'C:/private.png' } }, { kind: 'bowl', material: { color: 'red' } },
    { kind: 'arcade', details: { bays: 999 } }, { kind: 'bowl', details: { handles: 1.5 } },
    { kind: 'bowl', details: { lid: 'yes' } }, { kind: 'bowl', title: 'bad\nname' },
  ]) assert.throws(() => normalizeCraftPlan(value), TypeError);
  assert.equal(CRAFT_PLAN_SCHEMA.additionalProperties, false);
});

test('craft rejects non-applicable customizations and respects window-specific thickness ranges', () => {
  for (const input of [
    { kind: 'arcade', details: { handles: 2 } }, { kind: 'arcade', details: { lid: true } },
    { kind: 'roof', details: { profile: 'flared' } }, { kind: 'window', details: { roof: 'flat' } },
    { kind: 'colonnade', details: { stories: 3 } }, { kind: 'bowl', details: { bays: 5 } },
    { kind: 'bowl', details: { roof: 'flat' } }, { kind: 'window', details: { spout: true } },
    { kind: 'window', dimensions: { depth: 100 } },
  ]) assert.throws(() => normalizeCraftPlan(input), TypeError);
  const plan = normalizeCraftPlan({ kind: 'window', dimensions: { width: 40, height: 60, depth: 2, wallThickness: 2 } });
  assert.equal(plan.dimensions.depth, 2);
  assert.deepEqual(normalizeCraftPlan(plan), plan);
  assert.equal(normalizeCraftPlan({ kind: 'window' }).dimensions.depth, 8);
  assert.equal(normalizeCraftPlan({ kind: 'colonnade' }).details.stories, 1);
});

test('missing configured Blender reports unavailable without launching or writing output', async t => {
  const fixture = await createTestDirectory(t, 'craft-missing');
  const env = { WORKBENCH_BLENDER_PATH: join(fixture.directory, 'missing-blender') };
  assert.equal((await craftEngineStatus(env)).available, false);
  await assert.rejects(buildCraftAsset({ kind: 'bowl' }, { directory: fixture.directory, env }), { code: 'craft_engine_unavailable' });
});

test('cancelled craft build does not start a worker', async t => {
  const fixture = await createTestDirectory(t, 'craft-abort');
  const controller = new AbortController(); controller.abort();
  await assert.rejects(buildCraftAsset({ kind: 'bowl' }, { directory: fixture.directory, signal: controller.signal }), { code: 'craft_cancelled' });
});

const actual = process.env.WORKBENCH_TEST_BLENDER === '1';
test('real Blender outputs reopenable textured bowl and bounded arcade meshes', { skip: !actual, timeout: 360000 }, async t => {
  const fixture = await createTestDirectory(t, 'craft-real');
  const status = await craftEngineStatus(); assert.equal(status.available, true, status.message);
  for (const kind of ['bowl', 'arcade']) {
    const directory = join(fixture.directory, kind); await mkdir(directory);
    const result = await buildCraftAsset({ kind, decoration: { style: kind === 'bowl' ? 'floral' : 'lattice' } }, { directory });
    assert.ok(result.stats.triangles > 100);
    assert.ok(result.stats.triangles < 40000);
    assert.ok(result.stats.objects > 0);
    assert.equal(result.stats.unit, 'm');
    assert.equal((await readFile(result.blendPath)).toString('ascii', 0, 7), 'BLENDER');
    const glb = await readFile(result.glbPath);
    const jsonLength = glb.readUInt32LE(12);
    const scene = JSON.parse(glb.subarray(20, 20 + jsonLength).toString('utf8'));
    assert.equal(scene.asset.version, '2.0');
    assert.ok(scene.meshes.length > 0);
    assert.ok(scene.images.every(image => image.bufferView !== undefined && image.uri === undefined), 'GLB images must be embedded');
    assert.ok(scene.meshes.every(mesh => mesh.primitives.every(primitive => primitive.attributes.TEXCOORD_0 !== undefined)), 'All meshes retain UVs');
    if (kind === 'bowl') assert.equal(result.stats.objects, 1);
  }
});

test('real Blender supports every advertised recipe and maximum arcade complexity', { skip: !actual, timeout: 360000 }, async t => {
  const fixture = await createTestDirectory(t, 'craft-recipes');
  const plans = [...CRAFT_KINDS.filter(kind => !['bowl', 'arcade'].includes(kind)).map(kind => ({ kind })),
    { kind: 'arcade', details: { bays: 5, stories: 3 } },
    { kind: 'bowl', dimensions: { width: 3, height: 1, depth: 3, wallThickness: .1 } },
    { kind: 'teapot', details: { handles: 2, spout: true, profile: 'flared' } }];
  for (const [index, plan] of plans.entries()) {
    const directory = join(fixture.directory, String(index)); await mkdir(directory);
    const result = await buildCraftAsset(plan, { directory });
    assert.ok(result.stats.triangles > 4 && result.stats.triangles <= 40000, plan.kind);
    assert.ok(result.stats.objects > 0 && result.stats.objects <= 240, plan.kind);
  }
});

test('real Blender applies standalone window depth, material, and flat roof dimensions', { skip: !actual, timeout: 120000 }, async t => {
  const fixture = await createTestDirectory(t, 'craft-dimensions');
  for (const [index, plan, expected] of [
    [0, { kind: 'window', dimensions: { width: 40, height: 60, depth: 2, wallThickness: 2 }, material: { color: '#cb6241' } }, [.4, .02, .6]],
    [1, { kind: 'window', dimensions: { width: 40, height: 60, depth: 12, wallThickness: 2 } }, [.4, .12, .6]],
    [2, { kind: 'roof', dimensions: { width: 200, height: 40, depth: 150, wallThickness: 8 }, details: { roof: 'flat' }, decoration: { style: 'lattice' } }, [2, 1.5, .4]],
  ]) {
    const directory = join(fixture.directory, String(index)); await mkdir(directory);
    const result = await buildCraftAsset(plan, { directory });
    assert.deepEqual(result.stats.dimensions, expected);
    const glb = await readFile(result.glbPath);
    const scene = JSON.parse(glb.subarray(20, 20 + glb.readUInt32LE(12)).toString('utf8'));
    if (index === 0) {
      const body = scene.materials.find(material => material.name === 'Body');
      assert.ok(body, 'Plain standalone windows must use the configured body material');
      assert.ok(body.pbrMetallicRoughness.baseColorFactor[0] > body.pbrMetallicRoughness.baseColorFactor[1]);
    }
    if (index === 2) assert.ok(scene.images.length > 0, 'Standalone roof must retain requested patterned material');
  }
});
