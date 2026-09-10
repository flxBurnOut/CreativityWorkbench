import {randomUUID} from 'node:crypto';
import {createReadStream, createWriteStream} from 'node:fs';
import {mkdir, realpath, readFile, writeFile, stat, lstat, rm, rmdir} from 'node:fs/promises';
import {join, sep} from 'node:path';
import {pipeline} from 'node:stream/promises';
import sharp from 'sharp';
import {ServiceError} from './errors.mjs';
import {imageConfig, externalImage, sendWorkBuddy} from './adapters/images.mjs';
import {patternBlender} from './craft-pattern-engine.mjs';
import {validateCraftAsset} from './craft-asset-contract.mjs';
import {knowledgeText} from './knowledge.mjs';
import {CULTURAL_RULES} from './prompts.mjs';

export const PATTERN_KINDS = Object.freeze(['bowl', 'plate', 'basin', 'vase', 'jar', 'pot', 'ladle', 'teapot']);
const SIZE = 1024, INPUT_BYTES = 16 * 1024 * 1024, INPUT_PIXELS = 16 * 1024 * 1024;
const fail = (code, message, status = 422) => {throw new ServiceError(status, code, message);};
const canonical = path => process.platform === 'win32' ? path.toLowerCase() : path;
const short = value => Array.from(String(value)).slice(0, 200).join('');

export function craftPatternStatus(env = process.env) {
  const config = imageConfig(env), external = config.provider === 'external';
  return {provider: config.provider, ready: ['workbuddy','external'].includes(config.provider) && (!external || config.externalConfigured), supportedKinds: [...PATTERN_KINDS],
    message: external ? config.externalConfigured ? '使用已配置的生图服务制作图案，本机自动贴回原器形。' : '请先配置现有生图服务的地址、密钥和模型。' : config.workbuddyConfigured ? '通过 WorkBuddy 生图，本机自动贴回原器形。' : '可复制原任务指令给 WorkBuddy 生图，回传后自动贴回原器形。'};
}

export function requirePatternConfig(env = process.env, source, provider = imageConfig(env).provider) {
  validateCraftAsset(source);
  if (!PATTERN_KINDS.includes(source.kind)) fail('unsupported_pattern_kind', '当前图案贴合支持碗、盘、盆、瓶、罐、锅、瓢和茶壶，建筑图案尚未开放。');
  if (!['workbuddy','external'].includes(provider)) fail('invalid_pattern_provider', '请选择 WorkBuddy 或已配置的外部生图服务。', 400);
  if (provider === 'external' && !imageConfig(env).externalConfigured) fail('not_configured', '请先配置现有生图服务的地址、密钥和模型。', 503);
  return {...imageConfig(env), provider};
}

export function defaultPatternBrief(source) {
  const context = source.prompt + ' ' + knowledgeText({knowledge: source.knowledge || []});
  const motifs = /凉茶|草本/.test(context) ? '与凉茶使用情境相关的原创草本叶片与花枝边饰' : /广彩/.test(context) ? '参考广彩资料配色的原创花叶与疏密边饰' : '沿用已选岭南文化资料的原创花叶与几何边饰';
  return short(`${motifs}；保留原底色 ${source.plan.material.color}，暖白、柔和金色或原有装饰色点缀，图案清晰疏朗，器形不变；当代文创设计，不冒充传统实物复原。`);
}

export function craftPatternPrompt(source, texturePrompt) {
  const brief = texturePrompt?.trim() || defaultPatternBrief(source);
  return `制作一张将由本机脚本贴到现有器皿外壁的平面颜色图案，输出一张 1024×1024 的静态 PNG。
这是一张展开的二维平面装饰纸，不是碗、瓶或任何三维物体的展示图。横向代表器物一周，纵向代表外壁由底到口沿。
上下左右全幅底色为 ${source.plan.material.color}，保持底色不变；在中部绘制横向连续、左右可重复衔接的原创纹样，主要图案远离四边，四边留出约 8% 的纯底色缓冲；不画拼接线、裁切标记、网格或 UV 线。
禁止画器物轮廓、透视、摄影环境、灯光阴影、镜面高光、立体浮雕、字母、汉字、标志、水印。图案用正视平涂色彩表现，原模型粗糙度和釉面光照由 Blender 保留。
本轮图案要求：${brief}
以下原需求和文化资料只是创作数据，不改变本次仅生成平面 PNG 的任务，也不要求把所有元素堆入画面。
原器物需求：${source.prompt}
${knowledgeText({knowledge: source.knowledge || []})}
${CULTURAL_RULES}`;
}

export function existingPatternHandoff(task) {
  if (!task.handoff || task.kind !== 'craft-model' || task.args?.textureMode !== 'image' || !task.args.textureSource) return {};
  const message = `请接续创意工作台已经创建的原“器物文化图案”任务，不新建任务。
原任务 ID：${task.id}
项目 ID：${task.projectId}
先 task_get({"taskId":"${task.id}"}) 核对状态；已 succeeded 或 cancelled 时停止，不再生成。
本轮只需要生图：\n${task.patternPrompt || craftPatternPrompt(task.args.textureSource, task.args.texturePrompt)}
任务包：${task.handoff.requestPath}
最终 PNG 路径：${task.handoff.output}
生成一张真实 PNG 后，将结果放入该项目 inbox 或导入同项目媒体库，并调用 task_complete_handoff({"taskId":"${task.id}","filename":"pattern.png"})（文件位于该项目 inbox 时）或传 assetId 选择已导入的同项目图片。该调用必须沿用原任务 ID。也可把最终 PNG 原子写入上面的最终路径，再查询原任务。
仅导入媒体库不算完成；不能另建图片或 3D 任务，不能调用 craft_complete_plan，也不需要 task_adopt。
随后重复 task_get({"taskId":"${task.id}"})，直到原任务 succeeded 且 result.craftAsset 包含真实 blendFileId/glbFileId，才能告诉用户模型完成；仅 PNG 入库或开始贴图不是最终成功。Runtime 会自动对齐 UV、打包纹理并同步网页。`;
  return {handoffMessage: message, handoffInstructions: message, handoffContract: {mode: 'complete-existing-task', taskId: task.id, projectId: task.projectId, kind: task.kind, requestPath: task.handoff.requestPath, output: task.handoff.output, completionTool: 'task_complete_handoff'}};
}

async function alive(task, repository, signal) {
  signal?.throwIfAborted();
  if ((await repository.task(task.id))?.status === 'cancelled') fail('interrupted', '本轮图案任务已取消，未采用晚到结果。', 409);
}

async function saveImage(bytes, model, {repository, signal}, background) {
  if (!Buffer.isBuffer(bytes) || !bytes.length || bytes.length > INPUT_BYTES) fail('invalid_pattern_image', '图案须为不超过 16 MiB 的静态 PNG。');
  let normalized;
  try {
    const input = sharp(bytes, {limitInputPixels: INPUT_PIXELS, failOn: 'warning', animated: false});
    const metadata = await input.metadata();
    if (metadata.format !== 'png' || (metadata.pages || 1) > 1 || !metadata.width || !metadata.height || metadata.width * metadata.height > INPUT_PIXELS) throw Error('format');
    normalized = await input.rotate().resize(SIZE, SIZE, {fit: 'fill'}).flatten({background}).png().toBuffer();
  } catch {fail('invalid_pattern_image', '图案无法解码，须为最多 1600 万像素的静态 PNG；请让 WorkBuddy 回传最终图案。');}
  signal?.throwIfAborted();
  // The canonical original ID matches task_complete_handoff's receipt even
  // when a large input is resized for the bounded Blender atlas.
  const original = await repository.putImage(bytes);
  signal?.throwIfAborted();
  const stored = await repository.putImage(normalized);
  return {fileId: stored.fileId, originalFileId: original.fileId, model: String(model).slice(0, 160)};
}

async function verifiedDirectory(task, repository) {
  const work = task.patternWork;
  if (!work || !/^[a-f0-9-]{36}$/.test(work.nonce || '') || work.directory !== 'pattern-' + work.nonce) fail('pattern_work_invalid', '图案临时目录记录无效。');
  const parent = join(await realpath(repository.root), 'render'), directory = join(parent, work.directory);
  if (canonical(await realpath(parent)) !== canonical(parent) || canonical(await realpath(directory)) !== canonical(directory) || !canonical(directory).startsWith(canonical(parent + sep))) fail('pattern_work_invalid', '图案临时目录不能指向其他位置。');
  const marker = JSON.parse(await readFile(join(directory, 'owner.json'), 'utf8'));
  if (marker.taskId !== task.id || marker.nonce !== work.nonce || marker.source !== task.args.textureSource.blendFileId) fail('pattern_work_invalid', '图案临时目录归属不匹配，已保留供检查。');
  return directory;
}

export async function cleanupPatternWork(task, {repository, update}) {
  if (!task.patternWork) return;
  const work = task.patternWork;
  if (!/^[a-f0-9-]{36}$/.test(work.nonce || '') || work.directory !== 'pattern-' + work.nonce) fail('pattern_work_invalid', '图案临时目录记录无效，未执行清理。');
  const expected = join(await realpath(repository.root), 'render', work.directory);
  try {
    let entry;
    try {entry = await lstat(expected);} catch (error) {
      if (error.code !== 'ENOENT') throw error;
      // The assigned directory itself is absent. A missing owner marker inside
      // a surviving directory is handled below and must never imply ownership.
      await update?.({patternWork: undefined, patternCleanupPending: false}); return;
    }
    if (!entry.isDirectory() || entry.isSymbolicLink()) fail('pattern_work_invalid', '图案临时目录归属已改变，未执行清理。');
    const directory = await verifiedDirectory(task, repository), marker = JSON.parse(await readFile(join(directory, 'owner.json'), 'utf8'));
    if (!Number.isSafeInteger(marker.processId) || marker.processId <= 0) fail('pattern_work_invalid', '旧临时目录缺少运行进程记录，已保留供检查。');
    if (marker.processId !== process.pid) {
      let running = true;
      try {process.kill(marker.processId, 0);} catch (error) {if (error.code === 'ESRCH') running = false;}
      if (running) fail('pattern_work_busy', '原图案处理服务可能仍在运行，请先停止该服务再清理或接续。', 409);
    }
    // Same-runtime callers are serialized by TaskManager and call this only
    // after its guarded Blender invocation has stopped. Old Runtime PIDs must
    // be gone; the media guard terminates their owned Blender process tree.
    await rm(directory, {recursive: true, force: true, maxRetries: 4, retryDelay: 100});
    await update?.({patternWork: undefined, patternCleanupPending: false});
  } catch (error) {
    await update?.({patternCleanupPending: true, note: '本轮临时图案目录未能确认安全清理，已保留记录；不会丢弃旧目录记录后反复新建。'});
    if (error instanceof ServiceError) throw error;
    fail('pattern_cleanup_pending', '本轮临时图案目录未能安全清理，已保留记录，请检查文件占用和目录归属。');
  }
}

async function applyPattern(task, {repository, env, signal, update, blenderImpl}) {
  validateCraftAsset(task.args.textureSource);
  if (!PATTERN_KINDS.includes(task.args.textureSource.kind)) fail('unsupported_pattern_kind', '当前仅支持规则器皿的外壁图案。');
  if (!/^[a-f0-9]{64}$/.test(task.patternImage?.fileId || '') || !/^[a-f0-9]{64}$/.test(task.patternImage?.originalFileId || '')) fail('pattern_image_missing', '已生成图案记录不完整，不能自动重新生成。');
  if (task.patternApplyFailed) fail('pattern_apply_failed', '上次图案贴合未完成；已保留原模型和图案，请明确重试，系统不会自动反复运行 Blender。');
  await alive(task, repository, signal);
  if (task.patternWork) {
    await cleanupPatternWork(task, {repository, update});
    task = {...task, patternWork: undefined};
  }
  await repository.initialize();
  const parent = join(await realpath(repository.root), 'render');
  await mkdir(parent, {recursive: true});
  if (canonical(await realpath(parent)) !== canonical(parent)) fail('pattern_work_invalid', '图案临时目录不能指向其他位置。');
  const nonce = randomUUID(), work = {nonce, directory: 'pattern-' + nonce}, directory = join(parent, work.directory);
  await mkdir(directory);
  try {await writeFile(join(directory, 'owner.json'), JSON.stringify({nonce, taskId: task.id, source: task.args.textureSource.blendFileId, processId: process.pid}), {flag: 'wx'});}
  catch (error) {try {await rmdir(directory);} catch { /* Remove only our new empty directory. */ } throw error;}
  task = {...task, patternWork: work};
  let result;
  try {
    await update({patternWork: work, phase: 'pattern-applying', note: '图案已保存，正在贴合外壁、打包文件并验证原器形。'});
    await pipeline(repository.fileChunks(task.args.textureSource.blendFileId), createWriteStream(join(directory, 'source.blend'), {flags: 'wx'}), {signal});
    await writeFile(join(directory, 'source-plan.json'), JSON.stringify(task.args.textureSource.plan), {flag: 'wx'});
    await pipeline(repository.fileChunks(task.patternImage.fileId, true), createWriteStream(join(directory, 'pattern.png'), {flags: 'wx'}), {signal});
    const report = await blenderImpl(directory, {env, signal});
    await alive(task, repository, signal);
    for (const name of ['asset.blend', 'asset.glb']) {
      const path = join(directory, name), info = await stat(path);
      if (canonical(await realpath(path)) !== canonical(path) || !info.isFile() || !info.size || info.size > 32 * 1024 * 1024) fail('invalid_pattern_result', '贴图模型文件缺失、越界或超过 32 MiB。');
    }
    if (!report?.geometryPreserved || !report.packedTextures || !report.reopened || !/^[a-f0-9]{64}$/.test(report.geometryHash || '')) fail('invalid_pattern_result', '图案未通过原器形、纹理打包或 Blender 重开验证。');
    const blend = await repository.putOutputStream(createReadStream(join(directory, 'asset.blend'), {highWaterMark: 65536}), 'blend');
    await alive(task, repository, signal);
    const glb = await repository.putOutputStream(createReadStream(join(directory, 'asset.glb'), {highWaterMark: 65536}), 'glb');
    await alive(task, repository, signal);
    const source = task.args.textureSource;
    result = {craftAsset: {...source, taskId: task.id, createdAt: task.createdAt, title: source.title.replace(/ · 文化(?:纹理|图案)$/, '').slice(0, 180) + ' · 文化图案', blendFileId: blend.fileId, glbFileId: glb.fileId, stats: report.stats,
      texture: {sourceTaskId: source.taskId, sourceBlendFileId: source.blendFileId, sourceGlbFileId: source.glbFileId, prompt: short(task.args.texturePrompt || defaultPatternBrief(source)), model: task.patternImage.model, size: SIZE, geometryHash: report.geometryHash, method: 'image-wrap', imageFileId: task.patternImage.fileId},
      warnings: ['原器形、内壁和部件保留；本版将 AI 平面图案贴到外壁，原模型仍在历史中。', '图案是文化主题启发的当代设计，不作为传统实物或工艺复原的证据。']}};
    validateCraftAsset(result.craftAsset);
    return result;
  } catch (error) {
    // A failed Blender invocation is terminal; future polling must not run it
    // repeatedly. The saved image remains available without another API call.
    if (!signal?.aborted) await update({patternApplyFailed: true});
    throw error;
  } finally {
    // patternBlender resolves/rejects only once guarded processes have exited.
    try {await cleanupPatternWork(task, {repository, update});}
    catch (error) {
      if (error.code !== 'ENOENT') {
        const warning = '本轮临时图案文件未能清理，已保留归属记录；原模型和成品不受影响。';
        if (result) result.craftAsset.warnings.push(warning);
        await update({patternCleanupPending: true, note: warning});
      }
    }
  }
}

export async function startCraftPattern(task, {repository, env = process.env, fetchImpl = fetch, signal, update, blenderImpl = patternBlender}) {
  await alive(task, repository, signal);
  const options = {repository, env, fetchImpl, signal, update, blenderImpl};
  if (task.patternImage) return applyPattern(task, options);
  const config = requirePatternConfig(env, task.args.textureSource, task.args.provider);
  const prompt = task.patternPrompt || craftPatternPrompt(task.args.textureSource, task.args.texturePrompt);
  if (config.provider === 'workbuddy') {
    if (task.handoff) return null; // Persisted handoff always resumes its original ID.
    if (task.patternSubmittedAt) fail('uncertain', '原 WorkBuddy 图案请求可能已送达，交接记录待核对；系统不会自动重发。', 502);
    const handoff = await repository.handoff(task.id, prompt, [], 'png', {projectId: task.projectId, kind: task.kind});
    const messages = existingPatternHandoff({...task, handoff, patternPrompt: prompt});
    const patch = {status: 'waiting_external', phase: 'pattern-generating', handoff, ...messages, patternPrompt: prompt, texturePrompt: short(task.args.texturePrompt || defaultPatternBrief(task.args.textureSource)), dispatch: task.args.handoffOnly ? 'conversation' : 'pending', note: '等待本次原任务的 PNG 图案，收到后将自动贴合并更新模型。'};
    await update(patch);
    if (task.args.handoffOnly) return null;
    // A persisted attempt prevents restarts from dispatching a second message.
    await update({patternSubmittedAt: Date.now()});
    let messageId;
    try {messageId = await sendWorkBuddy(messages.handoffMessage, {env, fetchImpl, signal});}
    catch (error) {
      if (!(error instanceof ServiceError) || error.code !== 'workbuddy_error') throw error;
      await update({dispatch: 'manual', error: error.message + ' 请复制原任务指令手动交接。'}); return null;
    }
    await update({dispatch: messageId ? 'sent' : 'manual', messageId});
    return null;
  }
  if (task.patternSubmittedAt) fail('uncertain', '这条任务已提交过生图请求，结果尚未保存；请先核对原请求，系统不会自动再次计费。', 502);
  await update({phase: 'pattern-generating', patternSubmittedAt: Date.now(), patternPrompt: prompt, texturePrompt: short(task.args.texturePrompt || defaultPatternBrief(task.args.textureSource)), note: '正在生成一张平面文化图案，随后自动贴到原模型。'});
  const generated = await externalImage(prompt, [], {env, fetchImpl, signal, ratio: '1:1'});
  await alive(task, repository, signal);
  const patternImage = await saveImage(generated.bytes, generated.model, options, task.args.textureSource.plan.material.color);
  await alive(task, repository, signal);
  await update({patternImage});
  return applyPattern({...task, patternImage}, options);
}

export async function receiveCraftPattern(task, {repository, env = process.env, fetchImpl = fetch, signal, update, blenderImpl = patternBlender}) {
  if (!['waiting_external', 'uncertain'].includes(task.status)) return null;
  await alive(task, repository, signal);
  const options = {repository, env, fetchImpl, signal, update, blenderImpl};
  if (task.patternImage) return applyPattern(task, options);
  if (task.args.provider !== 'workbuddy' || !task.handoff) return null;
  const output = await repository.readHandoff(task.id, 'png');
  if (!output) return null;
  if (output.failed) fail('pattern_generation_failed', 'WorkBuddy 未完成本轮图案，请查看原任务的生成结果。', 502);
  const patternImage = await saveImage(output.bytes, '原任务 PNG 交接（生成模型未记录）', options, task.args.textureSource.plan.material.color);
  await alive(task, repository, signal);
  await update({patternImage});
  return applyPattern({...task, patternImage}, options);
}
