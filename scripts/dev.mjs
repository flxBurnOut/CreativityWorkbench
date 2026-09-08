import '../lib/workbench/env.mjs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const cwd = fileURLToPath(new URL('../', import.meta.url));
const children = [];
let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  process.exitCode = code;
  for (const child of children) {
    if (!child.pid || child.exitCode !== null) continue;
    if (process.platform === 'win32') {
      spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], { stdio: 'ignore', windowsHide: true });
    } else child.kill('SIGTERM');
  }
}
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => stop());
for (const args of [['scripts/workbench-http.mjs'], ['node_modules/vinext/dist/cli.js', 'dev', '--hostname', 'localhost', '--port', '3001']]) {
  const child = spawn(process.execPath, args, { cwd, stdio: 'inherit', windowsHide: true });
  children.push(child);
  child.once('error', (error) => { console.error(error.message); stop(1); });
  child.once('exit', (code) => { if (!stopping) stop(code || 1); });
}
