import { requestDeepSeekJson } from './deepseek.mjs';
import { textServiceConfig } from '../text-config.mjs';
export { readJsonResponse } from './json-response.mjs';

export async function generateJson(system, input, { env, fetchImpl = fetch, signal }) {
  return requestDeepSeekJson([{ role: 'system', content: system }, { role: 'user', content: JSON.stringify(input) }], { ...textServiceConfig(env), fetchImpl, signal });
}
