import vinext from 'vinext';
import { defineConfig, loadEnv, type ViteDevServer } from 'vite';
import { sourcePreviewMiddleware } from './lib/workbench/preview-dev.mjs';

export default defineConfig(async ({ mode }) => {
  process.env.WRANGLER_WRITE_LOGS ??= 'false';
  process.env.WRANGLER_LOG_PATH ??= '.wrangler/logs';
  process.env.MINIFLARE_REGISTRY_PATH ??= '.wrangler/registry';
  const { cloudflare } = await import('@cloudflare/vite-plugin');
  // The Worker has its own environment. Pass only the local Runtime address, never provider keys.
  const runtimeUrl = process.env.WORKBENCH_RUNTIME_URL || loadEnv(mode, process.cwd(), 'WORKBENCH_RUNTIME_URL').WORKBENCH_RUNTIME_URL || 'http://127.0.0.1:8791';
  return {
    server: { strictPort: true },
    plugins: [{name:'workbench-static-source-preview',configureServer(server:ViteDevServer){server.middlewares.use(sourcePreviewMiddleware(runtimeUrl));}},vinext(), cloudflare({
      viteEnvironment: { name: 'rsc', childEnvironments: ['ssr'] },
      config: { name: 'app-scaffold', main: 'vinext/server/fetch-handler', compatibility_flags: ['nodejs_compat'], compatibility_date: '2026-05-15', vars: { WORKBENCH_RUNTIME_URL: runtimeUrl } },
    })],
  };
});
