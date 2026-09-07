import { loadManifest } from '../lib/workbench/runtime.mjs';

const command = process.argv[2];
if (command === 'list' || command === 'doctor') {
  const manifest = await loadManifest();
  console.log(JSON.stringify(command === 'list' ? manifest.capabilities : { manifest: 'ok', capabilities: manifest.capabilities.length }, null, 2));
} else {
  console.error('Usage: npm run workbench -- list|doctor');
  process.exitCode = 1;
}
