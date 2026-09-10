import './lib/workbench/temp-env.mjs';
import vinext from 'vinext';
import { defineConfig, loadEnv, type ViteDevServer } from 'vite';
import { sourcePreviewMiddleware } from './lib/workbench/preview-dev.mjs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

export default defineConfig(async ({ command, mode }) => {
  process.env.WRANGLER_WRITE_LOGS ??= 'false';
  process.env.WRANGLER_LOG_PATH ??= '.wrangler/logs';
  process.env.MINIFLARE_REGISTRY_PATH ??= '.wrangler/registry';
  const { cloudflare } = await import('@cloudflare/vite-plugin');
  // The Worker has its own environment. Pass only the local Runtime address, never provider keys.
  const runtimeUrl = process.env.WORKBENCH_RUNTIME_URL || loadEnv(mode, process.cwd(), 'WORKBENCH_RUNTIME_URL').WORKBENCH_RUNTIME_URL || 'http://127.0.0.1:8791';
  const cacheIdentity = ['.cache', 'node_modules', '.vite', command, mode].join('/');
  return {
    // Test checkouts can share node_modules through a junction. Their optimized
    // modules must stay in each checkout; builds must not replace a live dev cache.
    // Keep a node_modules segment so Vinext's CommonJS filter skips optimized ESM.
    cacheDir: join(fileURLToPath(new URL('.', import.meta.url)), cacheIdentity),
    server: { strictPort: true },
    plugins: [
      // Vite hashes plugin names but not cacheDir. Include the cache identity so
      // cached dependency responses cannot retain imports from an old location.
      { name: `workbench-dependency-cache:${cacheIdentity}` },
      {name:'workbench-static-source-preview',configureServer(server:ViteDevServer){server.middlewares.use(sourcePreviewMiddleware(runtimeUrl));}},vinext(), cloudflare({
      viteEnvironment: { name: 'rsc', childEnvironments: ['ssr'] },
      config: { name: 'app-scaffold', main: 'vinext/server/fetch-handler', compatibility_flags: ['nodejs_compat'], compatibility_date: '2026-05-15', vars: { WORKBENCH_RUNTIME_URL: runtimeUrl } },
    })],
  };
});
