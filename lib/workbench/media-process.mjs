import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { ServiceError } from './errors.mjs';

let queue = Promise.resolve();
let pending = 0;
const failure = () => new ServiceError(400, 'media_processing_failed', '媒体处理失败或超出资源限制，已停止处理。请缩短视频、降低分辨率或检查原文件。');

export async function runMediaProcess(binary, args, { signal, cwd, timeoutMs = 180000, memoryLimit = 1073741824 } = {}) {
  if (pending >= 8) throw new ServiceError(429, 'media_busy', '本机媒体处理队列已满，请稍后重试。');
  pending++;
  const operation = queue.then(() => new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(failure()); return; }
    const windows = process.platform === 'win32';
    const command = windows ? join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe') : binary;
    const commandArgs = windows ? ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', fileURLToPath(new URL('../../scripts/media-guard.ps1', import.meta.url))] : args;
    const child = spawn(command, commandArgs, { cwd, windowsHide: true, shell: false, stdio: [windows ? 'pipe' : 'ignore', 'pipe', 'pipe'] });
    let out = '', err = '', stopped = false;
    const stop = () => { stopped = true; child.kill(); };
    const timer = setTimeout(stop, Math.min(timeoutMs, 180000));
    signal?.addEventListener('abort', stop, { once: true });
    if (signal?.aborted) stop();
    if (windows) {
      child.stdin.on('error', () => {});
      child.stdin.end(JSON.stringify({ binary, args, cwd: cwd || process.cwd(), memoryLimit }));
    }
    child.stdout.on('data', b => { out = (out + b).slice(0, 200000); });
    child.stderr.on('data', b => { err = (err + b).slice(-20000); });
    child.on('error', () => { /* close follows error; retain the slot until then. */ });
    child.on('close', code => {
      clearTimeout(timer); signal?.removeEventListener('abort', stop);
      if (code === 0 && !stopped) resolve(out);
      else if (code === 125 || err.includes('WORKBENCH_MEDIA_GUARD_FAILED')) reject(new ServiceError(503, 'media_guard_unavailable', '无法启用本机媒体资源保护，已阻止启动。请检查 Windows PowerShell 与运行权限。'));
      else reject(failure());
    });
  }));
  queue = operation.catch(() => {});
  try { return await operation; } finally { pending--; }
}

export function boundedMediaArgs(args, probe = false) {
  if (probe) return ['-max_alloc', '67108864', '-threads', '2', ...args];
  const inputs = args.flatMap(arg => arg === '-i' ? ['-threads', '2', '-i'] : [arg]);
  return ['-max_alloc', '67108864', '-filter_threads', '2', '-filter_complex_threads', '2', ...inputs.slice(0, -1), '-threads', '2', '-max_muxing_queue_size', '128', inputs.at(-1)];
}
