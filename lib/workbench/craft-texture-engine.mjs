import {stat, readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {craftEngineStatus} from './craft-engine.mjs';
import {runMediaProcess} from './media-process.mjs';
import {ServiceError} from './errors.mjs';
import {validatePreviewGlb} from '../../features/creative-flow/craft-viewer-resources.mjs';

const script = fileURLToPath(new URL('../../scripts/blender-texture.py', import.meta.url));
export async function textureBlender(mode, directory, {env = process.env, signal} = {}) {
  const engine = await craftEngineStatus(env);
  if (!engine.available) throw new ServiceError(503, 'craft_engine_unavailable', engine.message);
  const deadline = Date.now() + 180000;
  for (const phase of mode === 'prepare' ? ['prepare'] : mode === 'verify' ? ['verify'] : ['apply', 'verify']) {
    await runMediaProcess(engine.binary, ['--background', '--factory-startup', '--disable-autoexec', '--threads', '2', '--python-exit-code', '1', '--python', script, '--', '--output', directory, '--mode', phase], {signal, cwd: directory, timeoutMs: Math.max(1, deadline - Date.now()), memoryLimit: 1073741824});
  }
  const files = mode === 'prepare' ? ['prepared.blend', 'input.glb'] : ['asset.blend', 'asset.glb'];
  for (const file of files) {const info = await stat(join(directory, file)); if (!info.isFile() || !info.size || info.size > 32 * 1024 * 1024) throw new ServiceError(422, 'texture_file_limit', '纹理模型文件超过预算或无效。');}
  if (mode === 'prepare') return;
  const reportPath = join(directory, 'validation.json');
  if ((await stat(reportPath)).size > 16384) throw new ServiceError(422, 'invalid_texture_result', '纹理验证报告无效。');
  const report = JSON.parse(await readFile(reportPath, 'utf8'));
  if (!report.reopened || !report.packedTextures || !report.geometryPreserved || !/^[a-f0-9]{64}$/.test(report.geometryHash)) throw new ServiceError(422, 'invalid_texture_result', '纹理未完成打包或器形校验。');
  const glb = await readFile(join(directory, 'asset.glb'));
  validatePreviewGlb(glb.buffer.slice(glb.byteOffset, glb.byteOffset + glb.byteLength));
  return report;
}
