import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {createTestDirectory} from './helpers/test-directory.mjs';
import {WORKBENCH_VERSION} from '../lib/workbench/version.mjs';
import {CORE_PROTOCOL} from '../lib/workbench/protocol.mjs';
import {syncReleaseMetadata} from '../lib/workbench/release-metadata.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const names = ['creativity-media', 'creativity-project'];
const coreMetadata = manifest => manifest.capabilities.find(item => item.id === 'workbuddy-core-mcp');
const skillVersion = source => source.split(/^---\s*$/m)[1]?.match(/^version:[ \t]*(\S+)[ \t]*\r?$/m)?.[1];

test('real MCP initialize advertises the same release as manifest and both Skills', async t => {
  const scope = await createTestDirectory(t, 'mcp-version');
  const client = new Client({name: 'version-handshake-test', version: '1.0.0'});
  scope.defer(() => client.close());
  const transport = new StdioClientTransport({command: process.execPath, args: [join(root, 'scripts/workbench-mcp.mjs')], cwd: scope.directory, env: {WORKBENCH_DATA_DIR: scope.directory, WORKBENCH_RUNTIME_URL: 'http://127.0.0.1:1'}, stderr: 'pipe'});
  await client.connect(transport); // A real initialize response, not a source-code assertion.
  assert.deepEqual(client.getServerVersion(), {name: 'creativity-workbench', version: WORKBENCH_VERSION});
  assert.match(WORKBENCH_VERSION, /^\d+\.\d+\.\d+$/);
  const resource = await client.readResource({uri: 'workbench://manifest'});
  const served = coreMetadata(JSON.parse(resource.contents[0].text));
  const disk = coreMetadata(JSON.parse(await readFile(join(root, 'workbench', 'manifest.json'), 'utf8')));
  for (const entry of [served, disk]) {
    assert.equal(entry.skillVersion, client.getServerVersion().version);
    assert.equal(entry.protocolVersion, CORE_PROTOCOL);
  }
  for (const name of names) assert.equal(skillVersion(await readFile(join(root, 'workbench', 'skills', name, 'SKILL.md'), 'utf8')), WORKBENCH_VERSION, name + ' frontmatter drifted; run npm run workbench:setup');
});

async function metadataFixture(t) {
  const scope = await createTestDirectory(t, 'release-metadata'), root = scope.directory;
  const manifest = {schemaVersion: 1, capabilities: [{id: 'workbuddy-core-mcp', skillVersion: '0.0.1', protocolVersion: 1}, {id: 'historical-capability', protocolVersion: 3}], editorModules: []};
  await mkdir(join(root, 'workbench'), {recursive: true});
  await writeFile(join(root, 'workbench', 'manifest.json'), JSON.stringify(manifest));
  for (const name of names) {
    await mkdir(join(root, 'workbench', 'skills', name), {recursive: true});
    await writeFile(join(root, 'workbench', 'skills', name, 'SKILL.md'), `---\r\nname: ${name}\r\nversion: 0.0.1\r\n---\r\nHistorical example:\r\nversion: 0.0.1\r\n`);
  }
  return root;
}

test('packaging synchronizes release metadata without changing historical text or rewriting aligned files', async t => {
  const root = await metadataFixture(t);
  assert.equal((await syncReleaseMetadata(root)).length, 3);
  const manifest = JSON.parse(await readFile(join(root, 'workbench', 'manifest.json'), 'utf8'));
  assert.equal(coreMetadata(manifest).skillVersion, WORKBENCH_VERSION);
  assert.equal(coreMetadata(manifest).protocolVersion, CORE_PROTOCOL);
  assert.equal(manifest.capabilities[1].protocolVersion, 3);
  for (const name of names) {
    const text = await readFile(join(root, 'workbench', 'skills', name, 'SKILL.md'), 'utf8');
    assert.equal(skillVersion(text), WORKBENCH_VERSION);
    assert.ok(text.endsWith('Historical example:\r\nversion: 0.0.1\r\n'));
  }
  assert.deepEqual(await syncReleaseMetadata(root), []);
});

test('invalid Skill frontmatter stops metadata sync before any file is changed', async t => {
  const root = await metadataFixture(t), path = join(root, 'workbench', 'manifest.json');
  const before = await readFile(path, 'utf8');
  await writeFile(join(root, 'workbench', 'skills', names[1], 'SKILL.md'), '# missing frontmatter');
  await assert.rejects(syncReleaseMetadata(root), /frontmatter version/);
  assert.equal(await readFile(path, 'utf8'), before);
  assert.equal(skillVersion(await readFile(join(root, 'workbench', 'skills', names[0], 'SKILL.md'), 'utf8')), '0.0.1');
});
