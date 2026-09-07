import { readFile } from 'node:fs/promises';

const manifestUrl = new URL('../../workbench/manifest.json', import.meta.url);

export async function loadManifest() {
  const manifest = JSON.parse(await readFile(manifestUrl, 'utf8'));
  if (manifest.schemaVersion !== 1 || !Array.isArray(manifest.capabilities) || !Array.isArray(manifest.editorModules)) {
    throw new Error('Invalid capability manifest.');
  }
  return manifest;
}

export async function listCapabilities() {
  return (await loadManifest()).capabilities;
}
