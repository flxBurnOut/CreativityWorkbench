import {createHash, createHmac} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {stat} from 'node:fs/promises';
import sharp from 'sharp';
import {ServiceError} from '../errors.mjs';
import {TEXTURE_MODEL, TEXTURE_PREFIX, TEXTURE_SIZE, validBucket, validRegion} from '../craft-texture-config.mjs';
import {readJsonResponse} from './json-response.mjs';
import {textErrorDiagnostic} from './text-error.mjs';

const fail = (code, message, status = 502) => {throw new ServiceError(status, code, message);};
const timeout = signal => signal ? AbortSignal.any([signal, AbortSignal.timeout(120000)]) : AbortSignal.timeout(120000);
export function textureObjectHost(c) {
  if (!validBucket(c.bucket || '') || !validRegion(c.region || '')) fail('invalid_settings', '临时存储桶名称或地域无效。', 400);
  return `${c.bucket}.cos.${c.region}.myqcloud.com`;
}
export function validateTextureObjectKey(key, taskId) {
  return typeof taskId === 'string' && /^[a-zA-Z0-9_-]{1,80}$/.test(taskId) && typeof key === 'string' && key.startsWith(TEXTURE_PREFIX + taskId + '/') && /^[a-zA-Z0-9_/-]+\.glb$/.test(key) && key.split('/').length === 3;
}
// COS signs only the fixed host and our generated object path. No raw keys or
// signed URLs are returned to the browser or persisted in task records.
export function cosAuthorization(method, host, key, c, expires = 600, now = Math.floor(Date.now() / 1000)) {
  if (!c.secretId || !c.secretKey || /[\s&=?]/.test(c.secretId)) fail('invalid_settings', 'COS 访问凭据格式无效。', 400);
  const period = `${now - 30};${now + expires}`;
  const hmac = (secret, message) => createHmac('sha1', secret).update(message).digest('hex');
  const signingKey = hmac(c.secretKey, period);
  const canonical = `${method.toLowerCase()}\n/${key}\n\nhost=${encodeURIComponent(host)}\n`;
  const digest = createHash('sha1').update(canonical).digest('hex');
  const signature = hmac(signingKey, `sha1\n${period}\n${digest}\n`);
  return `q-sign-algorithm=sha1&q-ak=${encodeURIComponent(c.secretId)}&q-sign-time=${period}&q-key-time=${period}&q-header-list=host&q-url-param-list=&q-signature=${signature}`;
}
export function signedTextureUrl(c, key, taskId) {
  if (!validateTextureObjectKey(key, taskId)) fail('invalid_texture_object', '临时模型路径无效。', 400);
  const host = textureObjectHost(c);
  return `https://${host}/${key}?${cosAuthorization('GET', host, key, c, 3600)}`;
}
export async function transferTextureObject(method, c, key, taskId, {path, fetchImpl = fetch, signal} = {}) {
  if (!['PUT', 'DELETE'].includes(method) || !validateTextureObjectKey(key, taskId)) fail('invalid_texture_object', '只能处理本次任务的临时模型。', 400);
  const host = textureObjectHost(c), headers = {Authorization: cosAuthorization(method, host, key, c)};
  let body;
  if (method === 'PUT') {
    const info = await stat(path);
    if (!info.isFile() || info.size > 32 * 1024 * 1024 || !info.size) fail('texture_file_limit', '中转模型超过 32 MB 或文件无效。', 413);
    headers['Content-Length'] = String(info.size); headers['Content-Type'] = 'model/gltf-binary';
    // Inherit the dedicated bucket's private ACL; no ACL-management permission is needed.
    body = createReadStream(path, {highWaterMark: 64 * 1024});
  }
  try {
    const response = await fetchImpl(`https://${host}/${key}`, {method, headers, signal: timeout(signal), redirect: 'error', ...(body ? {body, duplex: 'half'} : {})});
    await response.body?.cancel();
    if (!response.ok && !(method === 'DELETE' && response.status === 404)) fail('cos_error', `临时模型存储返回 ${response.status}，请核对存储桶、地域及上传/读取/删除权限。`);
  } catch (e) {
    if (e instanceof ServiceError) throw e;
    fail('cos_error', '临时模型传输未完成，请检查 COS 配置和网络。');
  } finally {body?.destroy();}
}
export async function textureRequest(action, body, c, {fetchImpl = fetch, signal} = {}) {
  const submit = action === 'submit';
  if (!submit && action !== 'query') fail('invalid_input', '纹理操作无效。', 400);
  let response;
  try {response = await fetchImpl(c.base + '/api/3d/' + action, {method: 'POST', redirect: 'error', signal: timeout(signal), headers: {'Content-Type': 'application/json', Authorization: 'Bearer ' + c.apiKey}, body: JSON.stringify({model: TEXTURE_MODEL, ...body})});}
  catch {fail(submit ? 'uncertain' : 'texture_poll_error', submit ? '纹理提交结果尚未确认；不会自动重复提交。请在腾讯云核对本次调用后再决定是否重试。' : '纹理进度暂时无法读取，已保留原任务编号。');}
  if (!response.ok) {
    const detail = response.status === 400 ? await textErrorDiagnostic(response, {provider: '腾讯云 Token Hub', apiKey: c.apiKey, texture: true}) : '';
    try {await response.body?.cancel();} catch { /* keep HTTP failure */ }
    fail(submit && response.status >= 500 ? 'uncertain' : submit ? 'texture_api_error' : 'texture_poll_error', `腾讯云纹理服务返回 ${response.status}。${detail || '请核对纹理模型权限、额度与配置。'}`);
  }
  try {return await readJsonResponse(response, 65536);} catch {fail(submit ? 'uncertain' : 'texture_poll_error', '纹理服务回执未能确认，保留原请求，不自动重发。');}
}
export async function submitTexture(c, url, prompt, options) {
  if (!prompt || Array.from(prompt).length > 200) fail('invalid_texture_prompt', '纹理描述须为 200 字以内。', 400);
  const data = await textureRequest('submit', {file_3d: {url}, prompt, texture_size: TEXTURE_SIZE, enable_keep_uv: true, enable_pbr: false}, c, options);
  if (typeof data.id !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(data.id)) fail('uncertain', '腾讯云未返回可确认的纹理任务编号，请先在控制台核对本次调用。');
  return data.id;
}
export async function downloadTexture(url, {fetchImpl = fetch, signal} = {}) {
  let target; try {target = new URL(url);} catch {fail('texture_output_invalid', '纹理下载地址无效。');}
  if (target.protocol !== 'https:' || target.port || target.username || target.password || !/^[a-z0-9-]+\.cos\.[a-z0-9-]+\.(myqcloud\.com|tencentcos\.cn)$/.test(target.hostname)) fail('texture_output_invalid', '纹理文件未使用支持的腾讯云 COS 下载域名。');
  let response;
  try {response = await fetchImpl(target.href, {signal: timeout(signal), redirect: 'error'});} catch {fail('texture_download_error', '纹理下载连接中断，保留原任务以便再次查询下载。');}
  if (!response.ok) {await response.body?.cancel(); fail('texture_download_error', '纹理下载失败，可刷新原任务重新查询下载地址。');}
  const reader = response.body?.getReader(); if (!reader) fail('texture_output_invalid', '纹理文件为空。');
  const chunks = []; let size = 0;
  try {for (;;) {const {done, value} = await reader.read(); if (done) break; size += value.byteLength; if (size > 8 * 1024 * 1024) {await reader.cancel(); fail('texture_output_invalid', '纹理文件超过 8 MB。');} chunks.push(value);}}
  catch (error) {if (error instanceof ServiceError) throw error; fail('texture_download_error', '纹理文件未接收完整，保留原任务以便再次查询下载。');}
  finally {reader.releaseLock();}
  try {
    const source = sharp(Buffer.concat(chunks), {limitInputPixels: 1024 * 1024, sequentialRead: true});
    const meta = await source.metadata();
    if (!['png', 'jpeg'].includes(meta.format) || !meta.width || meta.width > 1024 || !meta.height || meta.height > 1024 || (meta.pages || 1) !== 1) throw Error('invalid texture');
    return await source.removeAlpha().png().toBuffer();
  } catch {fail('texture_output_invalid', '纹理不是有效的 1024 像素以内 PNG/JPEG 图片，未替换原模型。');}
}
