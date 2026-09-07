import assert from 'node:assert/strict';
import { once } from 'node:events';
import { test } from 'node:test';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { createRuntimeServer } from '../lib/workbench/http-server.mjs';

const execute = promisify(execFile);

test('CLI discovers no preinstalled capabilities', async () => {
  const { stdout } = await execute(process.execPath, ['scripts/workbench.mjs', 'list']);
  assert.deepEqual(JSON.parse(stdout), []);
});

test('HTTP exposes empty discovery and rejects unimplemented execution', async () => {
  const server = createRuntimeServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    const base = 'http://127.0.0.1:' + server.address().port;
    assert.deepEqual(await (await fetch(base + '/v1/capabilities')).json(), { capabilities: [] });
    const response = await fetch(base + '/v1/tasks', { method: 'POST', body: '{}' });
    assert.equal(response.status, 404);
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
});

test('MCP exposes only a read-only empty manifest, with no executable tools', async () => {
  const client = new Client({ name: 'scaffold-test', version: '0.0.0' });
  const transport = new StdioClientTransport({ command: process.execPath, args: ['scripts/workbench-mcp.mjs'], stderr: 'pipe' });
  try {
    await client.connect(transport);
    assert.equal(client.getServerCapabilities().tools, undefined);
    const result = await client.readResource({ uri: 'workbench://manifest' });
    assert.deepEqual(JSON.parse(result.contents[0].text), { schemaVersion: 1, capabilities: [], editorModules: [] });
  } finally {
    await client.close();
  }
});
