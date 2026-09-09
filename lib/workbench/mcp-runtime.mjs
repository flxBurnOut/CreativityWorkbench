import { spawn } from 'node:child_process';
import { open, mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { CORE_PROTOCOL } from './protocol.mjs';
import { ServiceError } from './errors.mjs';

const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
export function createRuntimeClient({ env = process.env, autoStart = false, fetchImpl = fetch } = {}) {
  const base = new URL(env.WORKBENCH_RUNTIME_URL || 'http://127.0.0.1:' + (env.WORKBENCH_RUNTIME_PORT || '8791'));
  if (base.protocol !== 'http:' || base.hostname !== '127.0.0.1' || base.username || base.password || base.pathname !== '/' || base.search || base.hash) throw new Error('MCP Runtime 必须是 http://127.0.0.1:端口，不能连接任意地址。');
  const directory = resolve(repoRoot, env.WORKBENCH_DATA_DIR || 'work/data');
  const dataId = createHash('sha256').update(directory).digest('hex');
  let connecting;
  let startedPid;
  async function health() {
    let response;
    try { response = await fetchImpl(new URL('/health', base), { signal: AbortSignal.timeout(2000), redirect: 'error' }); }
    catch { return false; }
    let value;
    try { value = await response.json(); } catch { value = {}; }
    if (!response.ok || value.workbench !== 'creativity-workbench' || value.coreProtocol !== CORE_PROTOCOL || value.dataId !== dataId) throw new ServiceError(503, 'runtime_mismatch', '端口上的 Runtime 版本或数据目录不匹配。请停止旧版 Runtime，按连接说明重启；不会启动第二个数据写入器。');
    return true;
  }
  async function start() {
    if (await health()) return;
    if (!autoStart) throw new ServiceError(503, 'runtime_unavailable', '共享 Runtime 未运行。请运行 npm run workbench:http，或使用带 --ensure-runtime 的连接配置。');
    await mkdir(directory, { recursive: true });
    const log = await open(join(directory, 'runtime.log'), 'a');
    let launchError;
    try {
      const child = spawn(process.execPath, [join(repoRoot, 'scripts', 'workbench-http.mjs')], {
        cwd: repoRoot, env: { ...env, WORKBENCH_RUNTIME_PORT: base.port || '80', WORKBENCH_DATA_DIR: directory },
        detached: true, windowsHide: true, shell: false, stdio: ['ignore', log.fd, log.fd],
      });
      child.once('error', error => { launchError = error; });
      startedPid = child.pid;
      child.unref();
      // A simultaneous launcher may lose the port race; both attach to the same listener.
      for (let i = 0; i < 40; i++) {
        if (await health()) return;
        if (launchError) break;
        await new Promise(r => setTimeout(r, 200));
      }
    } finally { await log.close(); }
    throw new ServiceError(503, 'runtime_unavailable', 'Runtime 未启动成功，请检查数据目录下 runtime.log。未自动提交生成请求。');
  }
  function ensure() {
    if (!connecting) connecting = start().finally(() => { connecting = undefined; });
    return connecting;
  }
  async function call(name, input) {
    await ensure();
    let response;
    try {
      response = await fetchImpl(new URL('/v1/core/' + name, base), {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input),
        signal: AbortSignal.timeout(['media_import','storage_cleanup'].includes(name) ? 195000 : 25000), redirect: 'error',
      });
    } catch { throw new ServiceError(503, 'runtime_unavailable', '未收到 Runtime 响应；写入结果可能已保存。重试请保留 requestId 和全部参数，生成任务先按原 requestId 查询。'); }
    let value;
    try { value = await response.json(); } catch { throw new ServiceError(502, 'invalid_response', 'Runtime 返回格式无效，请检查服务日志。'); }
    if (!response.ok) throw new ServiceError(response.status, value.code || 'runtime_error', value.error || 'Runtime 请求未完成。');
    if (value.files) value.files = value.files.map(file => ({ ...file, url: new URL(file.url, base).href }));
    return value;
  }
  return { call, ensure, baseUrl: base.origin, get startedPid() { return startedPid; } };
}
