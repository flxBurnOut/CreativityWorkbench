import assert from 'node:assert/strict';
import { test } from 'node:test';
import { once } from 'node:events';
import { generateCreativeBrief, creativeStatus } from '../lib/workbench/creative-brief.mjs';
import { createRuntimeServer } from '../lib/workbench/http-server.mjs';
import { POST } from '../app/api/workbench/creative/route.ts';

const input = { action: 'improve', type: 'novel', idea: '岭南街巷的故事，保留 {name} 和 123.45。', brief: '保留当代背景', culture: '广府生活，细节待核实', instruction: '' };
const output = { title: '廊下的故事', brief: '当代岭南街巷。保留 {name} 和 123.45。', culture: '广府生活，具体习俗待核实。' };
const env = { DEEPSEEK_API_KEY: 'test-secret-never-return' };
const success = () => Response.json({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(output) } }] });

test('DeepSeek adapter uses fixed model, JSON contract and exact user text', async () => {
  let count = 0;
  const result = await generateCreativeBrief(input, { env, fetchImpl: async (url, options) => {
    count++;
    assert.equal(url, 'https://api.deepseek.com/chat/completions');
    assert.equal(options.headers.Authorization, 'Bearer ' + env.DEEPSEEK_API_KEY);
    const request = JSON.parse(options.body);
    assert.equal(request.model, 'deepseek-v4-flash');
    assert.deepEqual(request.thinking, { type: 'disabled' });
    assert.deepEqual(request.response_format, { type: 'json_object' });
    assert.equal(JSON.parse(request.messages[1].content).originalIdea, input.idea);
    assert.match(request.messages[0].content, /岭南/);
    return success();
  } });
  assert.equal(count, 1);
  assert.deepEqual(result, { ...output, model: 'deepseek-v4-flash' });
});

test('invalid inputs and missing key make no billable provider request', async () => {
  const options = { env: {}, fetchImpl: () => { assert.fail('must not call provider'); } };
  for (const bad of [{ ...input, action: 'image' }, { ...input, type: '__proto__' }, { ...input, idea: '' }, { ...input, action: 'revise' }, { ...input, brief: 'a'.repeat(20001) }]) {
    await assert.rejects(generateCreativeBrief(bad, options), error => error.status === 400);
  }
  await assert.rejects(generateCreativeBrief(input, options), error => error.code === 'not_configured');
  assert.equal(creativeStatus({}).configured, false);
  assert.equal(JSON.stringify(creativeStatus(env)).includes(env.DEEPSEEK_API_KEY), false);
});

test('provider errors are sanitized and never automatically retried', async () => {
  for (const status of [401, 402, 429, 500]) {
    let calls = 0;
    await assert.rejects(generateCreativeBrief(input, { env, fetchImpl: async () => { calls++; return new Response(env.DEEPSEEK_API_KEY, { status }); } }), error => error.status >= 400 && !error.message.includes(env.DEEPSEEK_API_KEY));
    assert.equal(calls, 1);
  }
});

test('truncated, empty and malformed output cannot replace a draft', async () => {
  for (const response of [
    { choices: [{ finish_reason: 'length', message: { content: JSON.stringify(output) } }] },
    { choices: [{ finish_reason: 'stop', message: { content: 'not JSON' } }] },
    { choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ ...output, brief: '' }) } }] },
  ]) await assert.rejects(generateCreativeBrief(input, { env, fetchImpl: async () => Response.json(response) }), error => error.status === 502);
});

test('abort signal reaches the provider and reports interruption', async () => {
  const controller = new AbortController();
  const result = generateCreativeBrief(input, { env, signal: controller.signal, fetchImpl: async (_url, { signal }) => new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true })) });
  controller.abort();
  await assert.rejects(result, error => error.code === 'interrupted');
});

test('runtime HTTP returns structured result and refuses browser cross-origin access', async () => {
  const server = createRuntimeServer({ env, fetchImpl: async () => success() });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = 'http://127.0.0.1:' + server.address().port;
  try {
    assert.equal((await (await fetch(base + '/v1/creative/status')).json()).configured, true);
    const request = { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) };
    const response = await fetch(base + '/v1/creative/brief', request);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ...output, model: 'deepseek-v4-flash' });
    assert.equal((await fetch(base + '/v1/creative/brief', { ...request, headers: { ...request.headers, Origin: 'https://untrusted.example' } })).status, 403);
    assert.equal((await fetch(base + '/v1/creative/brief', { ...request, body: '{' })).status, 400);
    assert.equal((await fetch(base + '/v1/creative/brief', { ...request, body: JSON.stringify({ ...input, idea: '' }) })).status, 400);
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});

test('Web endpoint rejects cross-site requests and non-JSON posts before forwarding', async () => {
  assert.equal((await POST(new Request('http://localhost:3001/api/workbench/creative', { method: 'POST', headers: { origin: 'https://untrusted.example', 'Content-Type': 'application/json' }, body: '{}' }))).status, 403);
  assert.equal((await POST(new Request('http://localhost:3001/api/workbench/creative', { method: 'POST', body: '{}' }))).status, 415);
});
