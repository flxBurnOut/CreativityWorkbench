import {ServiceError} from './errors.mjs';
export const TEXTURE_MODEL = 'hy-3d-texture';
export const TEXTURE_SIZE = 1024;
export const TEXTURE_PREFIX = 'workbench-texture/';
export const validBucket = value => /^[a-z0-9][a-z0-9-]{0,49}-[0-9]{5,20}$/.test(value);
export const validRegion = value => /^[a-z]{2}-[a-z0-9-]{2,35}$/.test(value);
export function craftTextureConfig(env = {}) {
  const base = (env.CRAFT_TEXTURE_API_BASE_URL || 'https://tokenhub.tencentmaas.com/v1').replace(/\/+$/, '');
  if (!/^https:\/\/(tokenhub|tokenhub-intl)\.tencentmaas\.(com|cn)\/v1$/.test(base)) throw new ServiceError(400, 'invalid_settings', '纹理服务请填写腾讯云 Token Hub 按量接口地址。');
  const reuseText = !Object.hasOwn(env, 'CRAFT_TEXTURE_API_KEY') && env.TEXT_API_BASE_URL?.replace(/\/+$/, '') === base;
  return {base, apiKey: reuseText ? env.DEEPSEEK_API_KEY?.trim() : env.CRAFT_TEXTURE_API_KEY?.trim(), bucket: env.COS_BUCKET?.trim(), region: env.COS_REGION?.trim() || 'ap-guangzhou', secretId: env.COS_SECRET_ID?.trim(), secretKey: env.COS_SECRET_KEY?.trim(), credentialSource: reuseText ? 'text' : 'separate'};
}
export function craftTextureStatus(env) {
  const c = craftTextureConfig(env);
  const ready = Boolean(c.apiKey && validBucket(c.bucket || '') && validRegion(c.region) && c.secretId && c.secretKey);
  return {ready, credentialSource: c.credentialSource, model: TEXTURE_MODEL, textureSize: TEXTURE_SIZE, message: ready ? '纹理服务与临时存储已配置；实际调用由生成结果验证。' : '首次使用需在设置中配置腾讯云纹理密钥和临时模型存储。'};
}
export function requireTextureConfig(env) {
  if (!craftTextureStatus(env).ready) throw new ServiceError(503, 'texture_not_configured', '请先在设置中完成“文化纹理与临时模型存储”配置，再增强已有模型。');
  return craftTextureConfig(env);
}
export function textureStoragePolicy(bucket, region) {
  if (!validBucket(bucket || '') || !validRegion(region || '')) return '';
  const appId = bucket.slice(bucket.lastIndexOf('-') + 1);
  return JSON.stringify({version:'2.0',statement:[{effect:'allow',action:['name/cos:PutObject','name/cos:GetObject','name/cos:DeleteObject'],resource:[`qcs::cos:${region}:uid/${appId}:${bucket}/${TEXTURE_PREFIX}*`]}]},null,2);
}
