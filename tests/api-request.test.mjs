import test from 'node:test';
import assert from 'node:assert/strict';
import { requestWorkbench, WorkbenchApiError } from '../features/projects/api-request.mjs';

test('unreachable browser service explains connection failure without retrying a submitted task', async t => {
  const request = {requestId: 'same-request', goal: 'a bowl'};
  const fetch = t.mock.method(globalThis, 'fetch', async () => { throw new TypeError('Failed to fetch'); });
  await assert.rejects(requestWorkbench('core/craft_generate', 'POST', request), error => {
    assert.ok(error instanceof WorkbenchApiError);
    assert.equal(error.code, 'network_error');
    assert.equal(error.status, 0);
    assert.match(error.message, /无法连接工作台服务/);
    assert.doesNotMatch(error.message, /密钥无效/);
    return true;
  });
  assert.equal(fetch.mock.callCount(), 1);
  assert.equal(fetch.mock.calls[0].arguments[1].body, JSON.stringify(request));
});

test('server authentication and runtime errors retain their separate status and message', async t => {
  const fetch = t.mock.method(globalThis, 'fetch');
  for (const [status, code, error] of [[401, 'invalid_key', 'DeepSeek 密钥无效，请检查配置。'], [503, 'runtime_unavailable', '工作台后台尚未启动。']]) {
    fetch.mock.mockImplementation(async () => Response.json({code, error}, {status}));
    await assert.rejects(requestWorkbench('settings'), result => result.status === status && result.code === code && result.message === error);
  }
});

test('timeouts and unreadable replies never pretend to confirm a settings save', async t => {
  const fetch = t.mock.method(globalThis, 'fetch', async () => { throw new DOMException('timed out', 'TimeoutError'); });
  await assert.rejects(requestWorkbench('settings', 'PUT', {}), error => error.code === 'timeout' && error.status === 504);
  assert.equal(fetch.mock.callCount(), 1);
  fetch.mock.mockImplementation(async () => new Response('<html>broken proxy</html>', {status: 502}));
  await assert.rejects(requestWorkbench('settings', 'PUT', {}), error => error.code === 'invalid_response' && error.status === 502);
  const settings = {savedAt: '2026-09-10T10:00:00.000Z', secrets: {DEEPSEEK_API_KEY: true}};
  fetch.mock.mockImplementation(async () => Response.json(settings));
  assert.deepEqual(await requestWorkbench('settings', 'PUT', {}), settings);
});

test('invalid local input fails before connecting and is not reported as a network outage', async t => {
  const fetch = t.mock.method(globalThis, 'fetch');
  const circular = {}; circular.self = circular;
  await assert.rejects(requestWorkbench('settings', 'PUT', circular), error => error instanceof TypeError && !(error instanceof WorkbenchApiError));
  assert.equal(fetch.mock.callCount(), 0);
});
