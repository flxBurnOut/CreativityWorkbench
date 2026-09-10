import { ServiceError } from './errors.mjs';

export const TEXT_PRESETS = {
  deepseek: {label: 'DeepSeek 官方', baseUrl: 'https://api.deepseek.com', model: 'deepseek-v4-flash'},
  tokenhub: {label: '腾讯云 Token Hub（按量）', baseUrl: 'https://tokenhub.tencentmaas.com/v1', model: 'deepseek-v4-flash-0731'},
};

export function normalizeTextBaseUrl(value) {
  let url;
  try { url = new URL(value); } catch { throw new ServiceError(400, 'invalid_settings', '请输入文字服务的完整 HTTPS API 地址。'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw new ServiceError(400, 'invalid_settings', '文字 API 地址须使用 HTTPS，不能包含密码、查询参数或片段。');
  // Accept either the documented Base URL or a pasted chat endpoint, exactly once.
  url.pathname = url.pathname.replace(/\/+$/, '').replace(/\/chat\/completions$/, '');
  return url.toString().replace(/\/+$/, '');
}

export function textServiceConfig(env = {}) {
  const baseUrl = normalizeTextBaseUrl(env.TEXT_API_BASE_URL || TEXT_PRESETS.deepseek.baseUrl);
  const model = (env.TEXT_API_MODEL || TEXT_PRESETS.deepseek.model).trim();
  if (!model || model.length > 200 || /\s/.test(model) || Array.from(model).some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)) throw new ServiceError(400, 'invalid_settings', '请填写文字服务的准确模型 ID，不能包含空格。');
  const host = new URL(baseUrl).hostname;
  const provider = host === 'api.deepseek.com' ? 'DeepSeek 官方' : /^(tokenhub|tokenhub-intl)\.tencent(cloud)?maas\.(com|cn)$/.test(host) ? '腾讯云 Token Hub' : 'OpenAI 兼容文字服务';
  // Keep the existing secret field so upgrading never discards a saved key.
  return {apiKey: env.DEEPSEEK_API_KEY, baseUrl, model, provider, endpoint: baseUrl + '/chat/completions'};
}

export function textServiceStatus(env) {
  const {apiKey, baseUrl, model, provider} = textServiceConfig(env);
  return {configured: Boolean(apiKey?.trim()), baseUrl, model, provider};
}
