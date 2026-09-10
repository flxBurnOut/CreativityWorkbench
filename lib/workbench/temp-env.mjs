import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Preload before toolchains: only this process and its children are affected.
// Derive the path from this checkout, never from a child's working directory.
// Do not clear this directory at startup: another process may still use it.
export const workbenchTempDirectory = fileURLToPath(new URL('../../work/tmp/process/', import.meta.url));
mkdirSync(workbenchTempDirectory, { recursive: true });
for (const name of ['TEMP', 'TMP', 'TMPDIR']) process.env[name] = workbenchTempDirectory;
