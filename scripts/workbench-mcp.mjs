import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { loadManifest } from '../lib/workbench/runtime.mjs';

const server = new McpServer({ name: 'app-scaffold', version: '0.0.0' });
server.registerResource('manifest', 'workbench://manifest', { mimeType: 'application/json' }, async (uri) => ({
  contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify(await loadManifest()) }],
}));
// No executable tools are registered until their requirements are defined.
await server.connect(new StdioServerTransport());
