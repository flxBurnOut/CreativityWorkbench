import {stat, readFile, writeFile, realpath} from 'node:fs/promises';
import {isAbsolute, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import sharp from 'sharp';
import {normalizeCraftPlan} from './craft-contract.mjs';
import {craftEngineStatus} from './craft-engine.mjs';
import {runMediaProcess} from './media-process.mjs';
import {ServiceError} from './errors.mjs';
import {validatePreviewGlb} from '../../features/creative-flow/craft-viewer-resources.mjs';

const script = fileURLToPath(new URL('../../scripts/blender-pattern.py', import.meta.url));
export const PATTERN_VESSEL_KINDS = Object.freeze(['bowl', 'plate', 'basin', 'vase', 'jar', 'pot', 'ladle', 'teapot']);
const limit = 32 * 1024 * 1024;

export function patternPlan(input) {
  const plan = normalizeCraftPlan(input);
  if (!PATTERN_VESSEL_KINDS.includes(plan.kind)) throw new ServiceError(422, 'pattern_kind_unsupported', '图案贴合暂支持碗、盘、盆、瓶、罐、锅、瓢勺和茶壶的外壁；建筑构件尚未提供对应 UV 规则。');
  return plan;
}

// Fit complete motifs at a roughly physical aspect ratio. Blank glaze margins
// protect the rim/foot, and softened tile edges avoid a sharp back seam.
export async function preparePatternAtlas(input, planInput) {
  const plan = patternPlan(planInput);
  if (!Buffer.isBuffer(input) || !input.length || input.length > 8 * 1024 * 1024) throw new ServiceError(422, 'pattern_image_invalid', '图案须为不超过 8 MB、1024 像素的 PNG。');
  const options = {limitInputPixels: 1024 * 1024, failOn: 'error'};
  let metadata;
  try {metadata = await sharp(input, options).metadata();} catch {throw new ServiceError(422, 'pattern_image_invalid', '图案无法解码，或超过 1024 像素限制。');}
  if (metadata.format !== 'png' || !metadata.width || !metadata.height || metadata.width > 1024 || metadata.height > 1024 || (metadata.pages || 1) !== 1) throw new ServiceError(422, 'pattern_image_invalid', '图案须为单张、不超过 1024 像素的 PNG。');
  const {width: w, depth: d, height: h} = plan.dimensions;
  const width = 1024, wrapAspect = Math.PI * Math.sqrt((w * w + d * d) / 2) * .82 / h;
  const height = Math.max(128, Math.min(1024, Math.round(width / wrapAspect)));
  const top = Math.ceil(height * .12), innerHeight = height - top * 2;
  const available = width - 64;
  const repeats = Math.max(1, Math.min(16, Math.round(available / (innerHeight * metadata.width / metadata.height))));
  const tileWidth = Math.floor(available / repeats), color = plan.material.color;
  const mask = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${tileWidth}" height="${innerHeight}"><defs><linearGradient id="x"><stop stop-color="white" stop-opacity="0"/><stop offset=".08" stop-color="white"/><stop offset=".92" stop-color="white"/><stop offset="1" stop-color="white" stop-opacity="0"/></linearGradient><linearGradient id="y" x2="0" y2="1"><stop stop-color="white" stop-opacity="0"/><stop offset=".08" stop-color="white"/><stop offset=".92" stop-color="white"/><stop offset="1" stop-color="white" stop-opacity="0"/></linearGradient><mask id="m"><rect width="100%" height="100%" fill="url(#y)"/></mask></defs><rect width="100%" height="100%" fill="url(#x)" mask="url(#m)"/></svg>`);
  const tile = await sharp(input, options).resize(tileWidth, innerHeight, {fit: 'contain', background: color}).ensureAlpha().composite([{input: mask, blend: 'dest-in'}]).png().toBuffer();
  const atlas = await sharp({create: {width, height, channels: 3, background: color}}).composite(Array.from({length: repeats}, (_, i) => ({input: tile, left: 32 + i * tileWidth, top}))).removeAlpha().png().toBuffer();
  return {atlas, width, height, repeats, margin: .12};
}

export async function patternBlender(directory, {env = process.env, signal} = {}) {
  if (!directory || !isAbsolute(directory) || !(await stat(directory)).isDirectory()) throw new TypeError('贴图须使用调用方创建的独立绝对目录。');
  const root = await realpath(directory), planPath = join(root, 'source-plan.json');
  if ((await stat(planPath)).size > 16384) throw new ServiceError(422, 'pattern_plan_invalid', '原模型方案超过预算。');
  const plan = patternPlan(JSON.parse(await readFile(planPath, 'utf8')));
  if (signal?.aborted) throw new ServiceError(409, 'craft_cancelled', '图案贴合已取消。');
  const source = await stat(join(root, 'source.blend')), image = await stat(join(root, 'pattern.png'));
  if (!source.isFile() || source.size < 20 || source.size > limit || !image.isFile() || image.size > 8 * 1024 * 1024) throw new ServiceError(422, 'pattern_input_invalid', '原模型或图案文件大小无效。');
  const engine = await craftEngineStatus(env);
  if (!engine.available) throw new ServiceError(503, 'craft_engine_unavailable', engine.message);
  const atlas = await preparePatternAtlas(await readFile(join(root, 'pattern.png')), plan);
  await writeFile(join(root, 'pattern-atlas.png'), atlas.atlas);
  const deadline = Date.now() + 180000;
  try {
    for (const mode of ['apply', 'verify']) {
      if (signal?.aborted || Date.now() >= deadline) throw new Error('cancelled or timed out');
      await runMediaProcess(engine.binary, ['--background', '--factory-startup', '--disable-autoexec', '--threads', '2', '--python-exit-code', '1', '--python', script, '--', '--output', root, '--mode', mode], {signal, cwd: root, timeoutMs: deadline - Date.now(), memoryLimit: 1073741824});
    }
    for (const file of ['asset.blend', 'asset.glb']) {
      const info = await stat(join(root, file));
      if (!info.isFile() || info.size < 20 || info.size > limit) throw new Error('invalid output file size');
    }
    if ((await stat(join(root, 'validation.json'))).size > 16384) throw new Error('invalid validation report');
    const report = JSON.parse(await readFile(join(root, 'validation.json'), 'utf8'));
    if (!report.reopened || !report.packedTextures || !report.geometryPreserved || !report.protectedSurfacesPreserved || !report.uvValidated || !report.materialsPreserved || !/^[a-f0-9]{64}$/.test(report.geometryHash)) throw new Error('pattern verification failed');
    const glb = await readFile(join(root, 'asset.glb'));
    validatePreviewGlb(glb.buffer.slice(glb.byteOffset, glb.byteOffset + glb.byteLength));
    return {...report, atlas: {width: atlas.width, height: atlas.height, repeats: atlas.repeats, margin: atlas.margin}};
  } catch (error) {
    if (signal?.aborted) throw new ServiceError(409, 'craft_cancelled', '图案贴合已取消。');
    if (['media_guard_unavailable', 'media_busy'].includes(error.code)) throw error;
    throw new ServiceError(422, 'pattern_build_failed', '图案贴合或文件复验失败，原模型保持不变。此流程仅支持工作台生成且未改变拓扑的规则器皿。');
  }
}
