import assert from 'node:assert/strict';
import { once } from 'node:events';
import { test } from 'node:test';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { createRuntimeServer } from '../lib/workbench/http-server.mjs';
import { loadManifest } from '../lib/workbench/runtime.mjs';

const execute = promisify(execFile);

test('CLI discovers the implemented creative capability', async () => {
  const { stdout } = await execute(process.execPath, ['scripts/workbench.mjs', 'list']);
  assert.deepEqual(JSON.parse(stdout), (await loadManifest()).capabilities);
  assert.equal(JSON.parse(stdout)[0].id, 'creative-brief');
});

test('HTTP exposes discovery and refuses task requests without JSON content type', async () => {
  const server = createRuntimeServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    const base = 'http://127.0.0.1:' + server.address().port;
    assert.deepEqual(await (await fetch(base + '/v1/capabilities')).json(), { capabilities: (await loadManifest()).capabilities });
    const response = await fetch(base + '/v1/tasks', { method: 'POST', body: '{}' });
    assert.equal(response.status, 415);
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
});

test('MCP keeps manifest discovery available without requiring a running Runtime', async () => {
  const client = new Client({ name: 'scaffold-test', version: '0.0.0' });
  const transport = new StdioClientTransport({ command: process.execPath, args: ['scripts/workbench-mcp.mjs'], stderr: 'pipe' });
  try {
    await client.connect(transport);
    assert.ok(client.getServerCapabilities().tools);
    const names = (await client.listTools()).tools.map(t => t.name);
    assert.ok(names.includes('project_update'));
    assert.ok(!names.includes('delete_project'));
    const result = await client.readResource({ uri: 'workbench://manifest' });
    assert.deepEqual(JSON.parse(result.contents[0].text), await loadManifest());
  } finally {
    await client.close();
  }
});
