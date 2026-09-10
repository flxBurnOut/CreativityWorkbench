import {randomUUID} from 'node:crypto';
import {createReadStream, createWriteStream} from 'node:fs';
import {mkdir, realpath, readFile, writeFile, rm, rmdir} from 'node:fs/promises';
import {join, sep} from 'node:path';
import {pipeline} from 'node:stream/promises';
import {ServiceError} from './errors.mjs';
import {requireTextureConfig, craftTextureConfig, TEXTURE_MODEL, TEXTURE_SIZE, TEXTURE_PREFIX} from './craft-texture-config.mjs';
import {signedTextureUrl, transferTextureObject, submitTexture, textureRequest, downloadTexture} from './adapters/craft-texture.mjs';
import {textureBlender} from './craft-texture-engine.mjs';
import {validateCraftAsset} from './craft-asset-contract.mjs';
import {knowledgeText} from './knowledge.mjs';

export function defaultTexturePrompt(asset) {
  const goal = String(asset.prompt || '岭南文创器物');
  const culturalContext = goal + ' ' + knowledgeText({knowledge:asset.knowledge || []});
  const theme = /凉茶|草本/.test(goal) ? '外壁原创草本叶片插画，口沿细边饰，内壁留白，深褐色釉面有细微色差' : /骑楼|窗|柱廊|屋顶/.test(goal) ? '岭南建筑主题，灰绿瓦色、米白墙面、深木色构件，细微岁月质感，窗格部位清晰' : /广彩/.test(culturalContext) ? '参考广彩文化资料的配色启发，绘制原创花卉边饰与开光构图，纹样疏密有序，保留温润釉面留白' : '岭南主题原创花叶与几何边饰，疏密有序，主图案与留白分区，温润釉面';
  return Array.from(`当代岭南文创纹理设计。原要求：${Array.from(goal).slice(0, 70).join('')}。${theme}。只画表面颜色，不改变物件形状，不添加文字、标志、摄影光影或浮雕；不标榜传统实物复刻。`).slice(0, 200).join('');
}

const fail = (code, message, status = 422) => {throw new ServiceError(status, code, message);};
async function workPath(task, repository) {
  const work = task.textureWork;
  if (!work || !/^[a-f0-9-]{36}$/.test(work.nonce || '') || work.directory !== 'texture-' + work.nonce) fail('texture_work_missing', '纹理中间文件记录缺失，请保留原模型后重新发起。');
  const root = await realpath(repository.root), parent = join(root, 'render');
  const canonical = value => process.platform === 'win32' ? value.toLowerCase() : value;
  const directory = join(parent, work.directory);
  if (canonical(await realpath(parent)) !== canonical(parent) || canonical(await realpath(directory)) !== canonical(directory) || !canonical(directory).startsWith(canonical(parent + sep))) fail('texture_work_invalid', '纹理临时目录不属于当前工作台。');
  const marker = JSON.parse(await readFile(join(directory, 'owner.json'), 'utf8'));
  if (marker.taskId !== task.id || marker.nonce !== work.nonce || marker.source !== task.args.textureSource.blendFileId) fail('texture_work_invalid', '纹理临时目录归属不匹配。');
  return directory;
}
export async function cleanupTexture(task, {repository, env, fetchImpl = fetch, update}) {
  let warning = '';
  if (task.textureWork?.objectKey && task.textureWork.uploadAttempted) {
    try {
      const c = craftTextureConfig(env), w = task.textureWork;
      if (c.bucket !== w.bucket || c.region !== w.region) throw Error('configuration changed');
      await transferTextureObject('DELETE', c, w.objectKey, task.id, {fetchImpl, signal: AbortSignal.timeout(15000)});
    } catch {warning = '本轮 COS 临时模型未能自动清理，请检查存储权限；配置的临时目录生命周期可作为兜底。';}
  }
  if (task.textureWork) {
    try {const directory = await workPath(task, repository); await rm(directory, {recursive: true, force: true, maxRetries: 4, retryDelay: 100});}
    catch (e) {if (e.code !== 'ENOENT') warning = warning || '本轮本地临时纹理文件未能清理，请检查是否仍被占用。';}
  }
  if (update) await update({textureCleanupPending: Boolean(warning), note: warning || undefined, textureCleaned: !warning});
  return warning;
}

export async function startCraftTexture(task, {repository, env, fetchImpl = fetch, signal, update, blenderImpl = textureBlender}) {
  const c = requireTextureConfig(env), source = validateCraftAsset(task.args.textureSource);
  if (task.textureJob) return null; // Never resubmit a durable remote job.
  if (task.textureSubmittedAt) throw new ServiceError(502,'uncertain','原纹理请求已尝试提交但回执未确认，不能自动重复发送。请先在腾讯云核对。');
  const prompt = task.args.texturePrompt || defaultTexturePrompt(source);
  await repository.initialize();
  const parent = join(await realpath(repository.root), 'render');
  await mkdir(parent, {recursive: true});
  const canonical = value => process.platform === 'win32' ? value.toLowerCase() : value;
  if (canonical(await realpath(parent)) !== canonical(parent)) fail('texture_work_invalid', '纹理目录不能指向其他位置。');
  const nonce = randomUUID(), work = {nonce, directory: 'texture-' + nonce, bucket: c.bucket, region: c.region, objectKey: TEXTURE_PREFIX + task.id + '/' + nonce + '.glb'};
  const directory = join(parent, work.directory);
  await mkdir(directory);
  try {await writeFile(join(directory, 'owner.json'), JSON.stringify({nonce, taskId: task.id, source: source.blendFileId}), {flag: 'wx'});}
  catch (error) {try {await rmdir(directory);} catch { /* Only remove our new empty directory, never another file. */ } throw error;}
  task = {...task, textureWork: work};
  let submitting = false;
  try {
    await update({textureWork: work, phase: 'texture-preparing', note: '正在为已有模型整理贴图位置，保留器形。'});
    await pipeline(repository.fileChunks(source.blendFileId), createWriteStream(join(directory, 'source.blend'), {flags: 'wx'}), {signal});
    await blenderImpl('prepare', directory, {env, signal});
    signal?.throwIfAborted();
    await update({phase: 'texture-uploading', note: '正在把本轮模型临时交给腾讯云。'});
    work.uploadAttempted = true;
    await update({textureWork: work});
    await transferTextureObject('PUT', c, work.objectKey, task.id, {path: join(directory, 'input.glb'), fetchImpl, signal});
    signal?.throwIfAborted();
    // Persist that a billable submission may happen before sending it.
    await update({phase: 'texture-submitting', textureSubmittedAt: Date.now(), texturePrompt: prompt});
    submitting = true;
    const id = await submitTexture(c, signedTextureUrl(c, work.objectKey, task.id), prompt, {fetchImpl, signal});
    try {await update({status: 'waiting_provider', phase: 'texturing', textureJob: {id, base: c.base, model: TEXTURE_MODEL, createdAt: Date.now()}, note: '腾讯云正在生成文化纹理。可以离开页面，返回后查询同一个任务。', lastPolledAt: 0});}
    catch {throw new ServiceError(502,'uncertain','腾讯云已接收纹理任务，但本机回执未能保存。请先在腾讯云核对，勿重复生成。');}
    return null;
  } catch (error) {
    // Unknown submissions may still be using the uploaded model. A cancelled
    // or uncertain task is cleaned when the user explicitly checks/closes it.
    if (!submitting || error instanceof ServiceError && !['uncertain', 'interrupted'].includes(error.code)) await cleanupTexture(task, {repository, env, fetchImpl, update});
    throw error;
  }
}

export async function refreshCraftTexture(task, {repository, env, fetchImpl = fetch, signal, update, blenderImpl = textureBlender}) {
  const c = requireTextureConfig(env), job = task.textureJob;
  if (!job || job.base !== c.base || job.model !== TEXTURE_MODEL) fail('texture_provider_changed', '请恢复本轮原有的纹理服务地址后查询任务。');
  if (Date.now() - job.createdAt > 3600000) {
    await update({status: 'failed', textureRemoteDone: true, code: 'texture_expired', error: '纹理任务等待已超过一小时，保留原模型；请在腾讯云核对后再明确重试。'});
    await cleanupTexture(task, {repository, env, fetchImpl, update}); return;
  }
  const data = await textureRequest('query', {id: job.id}, c, {fetchImpl, signal});
  if (!['queued', 'in_progress', 'completed', 'failed'].includes(data.status) || data.id && data.id !== job.id) fail('texture_poll_error', '纹理任务回执不匹配，请稍后查询原任务。');
  if (['queued', 'in_progress'].includes(data.status)) {
    if(task.status!=='cancelled')await update({status:'waiting_provider',phase:'texturing',error:undefined,code:undefined,note:'腾讯云正在生成文化纹理；继续查询的是原任务，不会重复提交。'});
    return;
  }
  await update({textureRemoteDone: true});
  if (task.status === 'cancelled') {await cleanupTexture(task, {repository, env, fetchImpl, update}); return;}
  if (data.status === 'failed') {
    await update({status: 'failed', code: 'texture_provider_failed', error: '腾讯云未完成本轮纹理生成，原模型继续保留；详情可在腾讯云任务记录中查看。'});
    await cleanupTexture(task, {repository, env, fetchImpl, update}); return;
  }
  const output = Array.isArray(data.data) && data.data.find(item => item.type === 'texture_image' && typeof item.url === 'string');
  if (!output) fail('texture_output_invalid', '腾讯云结果缺少可用的颜色贴图，未用预览图冒充纹理，也未替换原模型。');
  const directory = await workPath(task, repository);
  await update({phase: 'texture-checking', note: '正在检查纹理、打包 Blender 文件并核对器形。'});
  const bytes = await downloadTexture(output.url, {fetchImpl, signal});
  await writeFile(join(directory, 'texture.png'), bytes);
  const report = await blenderImpl('apply', directory, {env, signal});
  signal?.throwIfAborted();
  const source = task.args.textureSource;
  const blend = await repository.putOutputStream(createReadStream(join(directory, 'asset.blend'), {highWaterMark: 65536}), 'blend');
  signal?.throwIfAborted();
  const glb = await repository.putOutputStream(createReadStream(join(directory, 'asset.glb'), {highWaterMark: 65536}), 'glb');
  const craftAsset = {...source, taskId: task.id, createdAt: task.createdAt, title: source.title.replace(/ · 文化纹理$/, '') + ' · 文化纹理', blendFileId: blend.fileId, glbFileId: glb.fileId, stats: report.stats,
    texture: {sourceTaskId: source.taskId, sourceBlendFileId: source.blendFileId, sourceGlbFileId: source.glbFileId, prompt: task.texturePrompt || task.args.texturePrompt || defaultTexturePrompt(source), model: TEXTURE_MODEL, size: TEXTURE_SIZE, geometryHash: report.geometryHash},
    warnings: ['器形与原模型一致；本版新增 AI 颜色纹理，原模型可在历史版本中查看。', '纹理为文化主题启发的当代设计，不作为传统工艺或真实文物复原的证据。']};
  validateCraftAsset(craftAsset);
  signal?.throwIfAborted();
  await update({status: 'succeeded', phase: 'texture-checking', result: {craftAsset}, error: undefined, code: undefined, note: undefined});
  await cleanupTexture(task, {repository, env, fetchImpl, update});
}
