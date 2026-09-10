import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises';
import { resolve, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../work/tmp/tests/', import.meta.url));
const scopes = new Map();

// Register cleanup immediately, before starting a server or writing fixtures.
// Only directories created by this helper may be removed; never scan user Temp.
export async function createTestDirectory(t, prefix, { keep = false } = {}) {
  if (!/^[a-z0-9-]+$/i.test(prefix)) throw new Error('Invalid test directory prefix');
  await mkdir(root, { recursive: true });
  const directory = await mkdtemp(join(root, prefix + '-'));
  const ownedPath = await realpath(directory), basePath = await realpath(root);
  const cleanup = [];
  let disposal;
  const scope = {
    directory,
    defer: operation => cleanup.push(operation),
    dispose: () => disposal ??= (async () => {
      const errors = [];
      for (const operation of cleanup.reverse()) {
        try { await operation(); } catch (error) { errors.push(error); }
      }
      scopes.delete(resolve(directory));
      // A failed stop can leave a process writing here. Preserve the fixture
      // for diagnosis instead of deleting a directory that may still be in use.
      if (!keep && errors.length === 0) {
        try {
          const target = await realpath(directory);
          if (target !== ownedPath || !target.startsWith(basePath + sep) || target === basePath) throw new Error('Test cleanup target moved outside its owned directory');
          await rm(target, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
        } catch (error) { if (error.code !== 'ENOENT') errors.push(error); }
      }
      if (errors.length) throw new AggregateError(errors, 'Test fixture cleanup failed; retained directory: ' + directory);
    })(),
  };
  scopes.set(resolve(directory), scope);
  t?.after(() => scope.dispose());
  return scope;
}

export function trackTestManager(repository, manager) {
  const scope = scopes.get(resolve(repository.root));
  if (!scope) throw new Error('Task manager requires an owned test directory');
  scope.defer(() => manager.stop());
  return manager;
}

export async function closeTestServer(server) {
  if (typeof server.shutdown === 'function') return server.shutdown();
  if (!server.listening) return;
  await new Promise((resolveClose, reject) => {
    server.close(error => error ? reject(error) : resolveClose());
    server.closeAllConnections();
  });
}

export async function stopTestProcess(pid) {
  if (!pid) return;
  try { process.kill(pid, 'SIGTERM'); } catch (error) { if (error.code === 'ESRCH') return; throw error; }
  for (let attempt = 0; attempt < 100; attempt++) {
    try { process.kill(pid, 0); } catch (error) { if (error.code === 'ESRCH') return; throw error; }
    await new Promise(resolveWait => setTimeout(resolveWait, 50));
  }
  throw new Error('Owned test process did not exit: ' + pid);
}
