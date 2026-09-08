import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Node loads server-only settings. Existing process environment takes precedence.
const local = fileURLToPath(new URL('../../.env.local', import.meta.url));
if (existsSync(local)) process.loadEnvFile(local);
