import { requestDeepSeekJson } from './deepseek.mjs';
export { readJsonResponse } from './json-response.mjs';

export async function generateJson(system, input, { env, fetchImpl = fetch, signal }) {
  return requestDeepSeekJson([{ role: 'system', content: system }, { role: 'user', content: JSON.stringify(input) }], { apiKey: env.DEEPSEEK_API_KEY, fetchImpl, signal });
}
