import { access, open, readFile, writeFile, stat } from 'node:fs/promises';
import { constants } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeCraftPlan } from './craft-contract.mjs';
import { runMediaProcess } from './media-process.mjs';
import { ServiceError } from './errors.mjs';

const script = fileURLToPath(new URL('../../scripts/blender-craft.py', import.meta.url));
const MAX_FILE_BYTES = 32 * 1024 * 1024;
export async function craftEngineStatus(env = process.env) {
  const configured = env.WORKBENCH_BLENDER_PATH || env.BLENDER_PATH;
  const candidates = configured ? [configured] : process.platform === 'win32' ? [
    'C:\\Program Files\\Blender Foundation\\Blender 5.0\\blender.exe',
    'C:\\Program Files\\Blender Foundation\\Blender 4.5\\blender.exe',
    'C:\\Program Files\\Blender Foundation\\Blender 4.4\\blender.exe',
    'C:\\Program Files\\Blender Foundation\\Blender 4.3\\blender.exe',
  ] : ['/usr/bin/blender', '/usr/local/bin/blender', '/Applications/Blender.app/Contents/MacOS/Blender'];
  for (const binary of candidates) {
    if (!isAbsolute(binary)) continue;
    try {
      await access(binary, constants.R_OK);
      if (!(await stat(binary)).isFile()) continue;
      return { available: true, binary, message: '已找到本机 Blender；生成时将验证实际输出。' };
    } catch { /* Report unavailable without starting a heavyweight process for every poll. */ }
  }
  return { available: false, message: '未找到 Blender。请在本机配置 WORKBENCH_BLENDER_PATH 为 Blender 可执行文件的绝对路径。' };
}
async function checkOutput(path, magic) {
  const info = await stat(path);
  if (!info.isFile() || info.size < 20 || info.size > MAX_FILE_BYTES) throw new Error('输出文件大小不符合限制。');
  const file = await open(path, 'r');
  try {
    const header = Buffer.alloc(20);
    await file.read(header, 0, header.length, 0);
    if (header.toString('ascii', 0, magic.length) !== magic) throw new Error('输出文件格式不正确。');
    return { header, size: info.size };
  } finally { await file.close(); }
}
export async function buildCraftAsset(input, { directory, signal, env = process.env } = {}) {
  const plan = normalizeCraftPlan(input);
  if (!directory || !isAbsolute(directory) || !(await stat(directory)).isDirectory()) throw new TypeError('建模须使用调用方创建的独立绝对目录。');
  if (signal?.aborted) throw new ServiceError(409, 'craft_cancelled', '建模任务已取消。');
  const engine = await craftEngineStatus(env);
  if (!engine.available) throw new ServiceError(503, 'craft_engine_unavailable', engine.message);
  const root = resolve(directory), planPath = join(root, 'plan.json');
  // Fixed names and a trusted script only. User requests never become executable Python.
  await writeFile(planPath, JSON.stringify(plan), { flag: 'wx' });
  try {
    const deadline = Date.now() + 180000;
    for (const mode of ['build', 'verify']) {
      const timeoutMs = deadline - Date.now();
      if (timeoutMs <= 0 || signal?.aborted) throw new Error('3D 生成已取消或超时。');
      await runMediaProcess(engine.binary, ['--background', '--factory-startup', '--disable-autoexec', '--threads', '2', '--python-exit-code', '1', '--python', script, '--', '--plan', planPath, '--output', root, '--mode', mode], { signal, cwd: root, timeoutMs, memoryLimit: 1073741824 });
    }
    if (signal?.aborted) throw new ServiceError(409, 'craft_cancelled', '建模任务已取消。');
    const blendPath = join(root, 'asset.blend'), glbPath = join(root, 'asset.glb');
    await checkOutput(blendPath, 'BLENDER');
    const glb = await checkOutput(glbPath, 'glTF');
    if (glb.header.readUInt32LE(4) !== 2 || glb.header.readUInt32LE(8) !== glb.size) throw new Error('GLB 长度或版本不正确。');
    if ((await stat(join(root, 'validation.json'))).size > 16384) throw new Error('验证报告过大。');
    const report = JSON.parse(await readFile(join(root, 'validation.json'), 'utf8'));
    const stats = report.stats;
    if (report.reopened !== true || !stats || !Number.isInteger(stats.triangles) || stats.triangles < 4 || stats.triangles > 40000 || !Number.isInteger(stats.objects) || stats.objects < 1 || stats.objects > 240 || !Array.isArray(stats.dimensions) || stats.dimensions.length !== 3 || stats.dimensions.some(v => !Number.isFinite(v) || v <= 0) || report.packedTextures !== true) throw new Error('Blender 重开验证或网格预算检查失败。');
    return { plan, blendPath, glbPath, stats, warnings: ['此结果为主题启发的规则建模资产，不是文物测绘复原；不保证可直接用于制造或三维打印。', ...(['arcade', 'window', 'colonnade', 'roof'].includes(plan.kind) ? ['建筑为简化组合构件，未包含完整建筑结构或施工细节。'] : [])] };
  } catch (error) {
    if (signal?.aborted) throw new ServiceError(409, 'craft_cancelled', '建模任务已取消。');
    if (error.code === 'media_guard_unavailable' || error.code === 'media_busy') throw error;
    throw new ServiceError(422, 'craft_build_failed', '3D 建模或文件复验失败，未保存为成功结果。请调整需求或检查 Blender 与资源限制。');
  }
}
