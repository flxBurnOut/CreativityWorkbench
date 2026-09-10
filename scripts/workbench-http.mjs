import '../lib/workbench/env.mjs';
import { createRuntimeServer } from '../lib/workbench/http-server.mjs';

const port = Number(process.env.WORKBENCH_RUNTIME_PORT || 8791);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid runtime port.');
const server = createRuntimeServer();
server.listen(port, '127.0.0.1', () => console.log('Runtime listening on http://127.0.0.1:' + port));
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => {
  void server.shutdown().catch(error => { console.error('Runtime shutdown failed:', error.message); process.exitCode = 1; });
});
