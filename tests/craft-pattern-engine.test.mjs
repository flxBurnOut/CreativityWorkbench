import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir, writeFile, readFile, copyFile, rm} from 'node:fs/promises';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import sharp from 'sharp';
import {createTestDirectory} from './helpers/test-directory.mjs';
import {normalizeCraftPlan} from '../lib/workbench/craft-contract.mjs';
import {buildCraftAsset, craftEngineStatus} from '../lib/workbench/craft-engine.mjs';
import {runMediaProcess} from '../lib/workbench/media-process.mjs';
import {patternPlan, preparePatternAtlas, patternBlender} from '../lib/workbench/craft-pattern-engine.mjs';
import {validatePreviewGlb} from '../features/creative-flow/craft-viewer-resources.mjs';

const script = fileURLToPath(new URL('../scripts/blender-pattern.py', import.meta.url));
const illustration = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="512" height="256"><rect width="512" height="256" fill="#4a2f1b"/><g fill="#71a17c"><ellipse cx="150" cy="125" rx="75" ry="36" transform="rotate(-25 150 125)"/><ellipse cx="360" cy="120" rx="62" ry="31" transform="rotate(28 360 120)"/></g><path d="M95 163Q260 75 405 160" stroke="#d9bc87" stroke-width="8" fill="none"/></svg>');

test('local pattern route rejects architectural kinds before any Blender work', async t => {
  for (const kind of ['arcade', 'roof', 'window', 'colonnade']) assert.throws(() => patternPlan({kind}), error => error.code === 'pattern_kind_unsupported');
  const scope = await createTestDirectory(t, 'pattern-invalid');
  await writeFile(join(scope.directory, 'source-plan.json'), JSON.stringify(normalizeCraftPlan({kind: 'arcade'})));
  await assert.rejects(patternBlender(scope.directory, {env: {BLENDER_PATH: 'must-not-start'}}), error => error.code === 'pattern_kind_unsupported');
});

test('pattern atlas keeps full image motifs, original glaze margins and bounded physical aspect ratio', async () => {
  const plan = normalizeCraftPlan({kind: 'bowl', material: {color: '#4a2f1b'}});
  const {atlas, width, height, repeats} = await preparePatternAtlas(await sharp(illustration).png().toBuffer(), plan);
  assert.equal(width, 1024);
  assert.ok(height >= 128 && height < 512);
  assert.ok(repeats >= 1 && repeats <= 16);
  const {data, info} = await sharp(atlas).raw().toBuffer({resolveWithObject: true});
  const pixel = (x, y) => Array.from(data.subarray((y * info.width + x) * info.channels, (y * info.width + x) * info.channels + 3));
  for (const [x, y] of [[0, 0], [width - 1, height - 1], [512, 1], [512, height - 2], [0, Math.floor(height / 2)], [1023, Math.floor(height / 2)]]) assert.deepEqual(pixel(x, y), [74, 47, 27], 'rim, foot and seam retain base glaze color');
  assert.ok(data.some((value, index) => value !== [74, 47, 27][index % 3]), 'the output must actually contain the source ornament');
});

test('pattern atlas rejects oversized, animated/non-PNG or broken images', async () => {
  const plan = {kind: 'bowl'};
  for (const input of [Buffer.from('bad'), await sharp({create: {width: 2048, height: 8, channels: 3, background: 'white'}}).png().toBuffer(), await sharp(illustration).jpeg().toBuffer(), Buffer.alloc(8 * 1024 * 1024 + 1)]) await assert.rejects(preparePatternAtlas(input, plan), error => error.code === 'pattern_image_invalid');
});

test('real Blender applies local patterned UVs only to the outer wall, preserves geometry and packs portable files', {skip: process.env.WORKBENCH_TEST_BLENDER !== '1', timeout: 240000}, async t => {
  const scope = await createTestDirectory(t, 'pattern-real');
  for (const kind of ['bowl', 'teapot']) {
    const base = join(scope.directory, kind + '-base'), stage = join(scope.directory, kind + '-pattern');
    await mkdir(base); await mkdir(stage);
    const plan = normalizeCraftPlan({kind, material: {color: '#4a2f1b', roughness: .36, metallic: .12}, decoration: {style: 'floral'}});
    const source = await buildCraftAsset(plan, {directory: base});
    const original = await readFile(source.blendPath);
    await copyFile(source.blendPath, join(stage, 'source.blend'));
    await writeFile(join(stage, 'source-plan.json'), JSON.stringify(plan));
    await writeFile(join(stage, 'pattern.png'), await sharp(illustration).png().toBuffer());
    let result;
    try {result = await patternBlender(stage);} catch (error) {t.diagnostic(await readFile(join(stage, 'pattern-error.log'), 'utf8').catch(() => 'No Blender diagnostic')); throw error;}
    assert.equal(result.geometryPreserved, true);
    assert.equal(result.protectedSurfacesPreserved, true);
    assert.equal(result.materialsPreserved, true);
    assert.equal(result.uvValidated, true);
    assert.equal(result.stats.vertices, source.stats.vertices);
    assert.equal(result.stats.triangles, source.stats.triangles);
    assert.ok(result.decoratedFaces > 0 && result.protectedFaces > result.decoratedFaces);
    assert.deepEqual(await readFile(source.blendPath), original);
    const glb = await readFile(join(stage, 'asset.glb'));
    const data = validatePreviewGlb(glb.buffer.slice(glb.byteOffset, glb.byteOffset + glb.byteLength));
    const painted = data.materials.filter(mat => mat.name.startsWith('Cultural outer glaze'));
    assert.equal(painted.length, 1);
    assert.ok(painted[0].pbrMetallicRoughness.baseColorTexture);
    assert.ok(Math.abs(painted[0].pbrMetallicRoughness.roughnessFactor - .36) < 1e-6);
    assert.ok(Math.abs(painted[0].pbrMetallicRoughness.metallicFactor - .12) < 1e-6);
    if (kind === 'bowl') {
      const repeated = join(scope.directory, 'repeated'); await mkdir(repeated);
      await copyFile(join(stage, 'asset.blend'), join(repeated, 'source.blend'));
      await writeFile(join(repeated, 'source-plan.json'), JSON.stringify(plan));
      await writeFile(join(repeated, 'pattern.png'), await sharp(illustration).png().toBuffer());
      const again = await patternBlender(repeated);
      assert.equal(again.geometryHash, result.geometryHash);
      assert.equal(again.protectedHash, result.protectedHash);
      assert.equal(again.stats.materials, result.stats.materials, 'repeated enhancement must not accumulate material slots');
    }
    // The reopened Blend must continue to verify with all local image sidecars gone.
    await rm(join(stage, 'pattern.png')); await rm(join(stage, 'pattern-atlas.png'));
    const engine = await craftEngineStatus();
    await runMediaProcess(engine.binary, ['--background', '--factory-startup', '--disable-autoexec', '--threads', '2', '--python-exit-code', '1', '--python', script, '--', '--output', stage, '--mode', 'verify'], {cwd: stage, timeoutMs: 60000, memoryLimit: 1073741824});
    assert.equal(JSON.parse(await readFile(join(stage, 'validation.json'), 'utf8')).packedTextures, true);
  }
});
