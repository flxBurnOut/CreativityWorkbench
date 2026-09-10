export class WorkbenchApiError extends Error {
  /** @param {string} message @param {number} status @param {string | undefined} code */
  constructor(message, status, code = undefined) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/** @param {string} path @param {string} method @param {unknown} input @param {AbortSignal | undefined} signal */
export async function requestWorkbench(path, method = 'GET', input = undefined, signal = undefined) {
  const options = method === 'GET' ? {} : { headers: { 'Content-Type': 'application/json' }, body: input === undefined ? undefined : JSON.stringify(input) };
  let response, data;
  try {
    try {
      response = await fetch('/api/workbench/data/' + path, { method, cache: 'no-store', ...options, signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(30000)]) : AbortSignal.timeout(30000) });
    } catch (error) {
      if (error instanceof TypeError) throw new WorkbenchApiError('无法连接工作台服务，请确认工作台已启动，再刷新页面。刚才的操作结果尚未确认，请先核对保存状态或任务进度，避免重复生成。', 0, 'network_error');
      throw error;
    }
    try { data = await response.json(); }
    catch (error) {
      if (error instanceof Error && ['TimeoutError', 'AbortError'].includes(error.name)) throw error;
      throw new WorkbenchApiError('服务返回了无法读取的响应，请检查服务连接后重试。', response.status, 'invalid_response');
    }
  } catch (error) {
    if (error instanceof Error && ['TimeoutError', 'AbortError'].includes(error.name)) throw new WorkbenchApiError('工作台响应超时，暂时无法确认操作结果。请稍后核对保存状态或任务进度，避免重复点击生成。', 504, 'timeout');
    throw error;
  }
  const { error, code } = data ?? {};
  if (!response.ok) throw new WorkbenchApiError(typeof error === 'string' ? error : '服务未完成请求。', response.status, typeof code === 'string' ? code : undefined);
  return data;
}
