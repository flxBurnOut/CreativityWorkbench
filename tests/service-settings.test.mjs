import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, stat, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServiceSettings } from '../lib/workbench/service-settings.mjs';
import { generationStatus } from '../lib/workbench/generation.mjs';

test('settings persist securely, apply immediately, never expose keys, and clear environment fallback', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'workbench-settings-'));
  try {
    const path = join(directory, 'settings.json');
    const env = { DEEPSEEK_API_KEY: 'environment-key' };
    const settings = createServiceSettings(env, path);
    assert.equal(settings.status().secrets.DEEPSEEK_API_KEY, true);
    const result = settings.save({ IMAGE_API_KEY: 'test-secret', IMAGE_API_MODEL: 'custom-image' });
    assert.equal(JSON.stringify(result).includes('test-secret'), false);
    assert.equal(generationStatus(env).images.externalConfigured, true);
    assert.equal((await stat(path)).mode & 0o777, 0o600);
    assert.equal(JSON.parse(await readFile(path, 'utf8')).DEEPSEEK_API_KEY, undefined);
    settings.save({ DEEPSEEK_API_KEY: '' });
    const restarted = { DEEPSEEK_API_KEY: 'environment-key' };
    const restored = createServiceSettings(restarted, path);
    assert.equal(restored.status().secrets.DEEPSEEK_API_KEY, false);
    assert.equal(restored.status().secrets.IMAGE_API_KEY, true);
    assert.equal(restored.status().values.IMAGE_API_MODEL, 'custom-image');
    for (const invalid of [{ UNKNOWN: 'value' }, { IMAGE_API_KEY: 'bad\nkey' }, { IMAGE_API_BASE_URL: 'http://example.com' }, { IMAGE_API_BASE_URL: 'https://user:secret@example.com' }, { IMAGE_API_MODEL: '' }, null]) {
      assert.throws(() => restored.save(invalid));
    }
    assert.equal(restarted.IMAGE_API_KEY, 'test-secret');
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('HTTP settings endpoints redact credentials and update generation status', async () => {
  const { createRuntimeServer } = await import('../lib/workbench/http-server.mjs');
  const directory = await mkdtemp(join(tmpdir(), 'workbench-settings-http-'));
  const server = createRuntimeServer({ env: {}, dataDirectory: join(directory, 'data'), settingsPath: join(directory, 'settings.json') });
  try {
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    const base = `http://127.0.0.1:${server.address().port}/v1/`;
    const response = await fetch(base + 'settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ DEEPSEEK_API_KEY: 'test-only-key' }) });
    assert.equal(response.status, 200);
    assert.equal((await response.text()).includes('test-only-key'), false);
    assert.equal((await (await fetch(base + 'status')).json()).text.configured, true);
    assert.equal((await fetch(base + 'settings', { headers: { Origin: 'https://example.com' } })).status, 403);
    assert.equal((await (await fetch(base + 'settings')).json()).secrets.DEEPSEEK_API_KEY, true);
  } finally {
    await new Promise(resolve => server.close(resolve));
    await rm(directory, { recursive: true, force: true });
  }
});
