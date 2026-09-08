import { existsSync, readFileSync, mkdirSync, writeFileSync, renameSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { dirname } from 'node:path';
import { ServiceError } from './errors.mjs';

const secrets = ['DEEPSEEK_API_KEY', 'IMAGE_API_KEY', 'VIDEO_API_KEY', 'WORKBUDDY_ACCESS_TOKEN'];
const defaults = { IMAGE_API_BASE_URL: 'https://api.openai.com/v1', IMAGE_API_MODEL: 'gpt-image-2', VIDEO_API_BASE_URL: 'https://api.dev.runwayml.com/v1', WORKBENCH_IMAGE_PROVIDER: 'workbuddy', VIDEO_PROVIDER: 'workbuddy' };
const allowed = [...secrets, ...Object.keys(defaults)];
function validate(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => !allowed.includes(key))) throw new ServiceError(400, 'invalid_settings', '配置字段无效。');
  const result = {};
  for (const [key, value] of Object.entries(input)) {
    if (typeof value !== 'string' || value.length > 4096 || Array.from(value).some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)) throw new ServiceError(400, 'invalid_settings', '配置内容格式无效。');
    result[key] = value.trim();
    if (['WORKBENCH_IMAGE_PROVIDER', 'VIDEO_PROVIDER'].includes(key) && !['workbuddy', 'external'].includes(result[key])) throw new ServiceError(400, 'invalid_settings', '请选择 WorkBuddy 或外部服务。');
    if (key.endsWith('_BASE_URL')) {
      let url;
      try { url = new URL(result[key]); } catch { throw new ServiceError(400, 'invalid_settings', '请输入完整的 HTTPS API 地址。'); }
      if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw new ServiceError(400, 'invalid_settings', 'API 地址须使用 HTTPS，且不能包含密码、查询参数或片段。');
    }
    if (key === 'IMAGE_API_MODEL' && !result[key]) throw new ServiceError(400, 'invalid_settings', '请填写图像模型。');
  }
  return result;
}

export function createServiceSettings(env, path) {
  let saved = existsSync(path) ? validate(JSON.parse(readFileSync(path, 'utf8'))) : {};
  Object.assign(env, saved);
  function status() {
    return { secrets: Object.fromEntries(secrets.map(key => [key, Boolean(env[key]?.trim())])), values: Object.fromEntries(Object.entries(defaults).map(([key, fallback]) => [key, env[key] || fallback])) };
  }
  return { status, save(input) {
    const next = { ...saved, ...validate(input) };
    mkdirSync(dirname(path), { recursive: true });
    const temporary = path + '.' + randomUUID() + '.tmp';
    writeFileSync(temporary, JSON.stringify(next, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
    renameSync(temporary, path);
    saved = next;
    Object.assign(env, saved);
    return status();
  } };
}
