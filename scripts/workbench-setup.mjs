import { mkdir, readFile, readdir, writeFile, stat } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { zipSync } from 'fflate';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = join(root, 'work', 'workbuddy-core');
const skills = join(root, 'workbench', 'skills');
await mkdir(output, { recursive: true });
const names = (await readdir(skills)).sort();
for (const name of names) {
  const files = {};
  async function collect(directory) {
    for (const item of await readdir(directory)) {
      const path = join(directory, item);
      if ((await stat(path)).isDirectory()) await collect(path);
      else files[relative(skills, path).replaceAll('\\', '/')] = new Uint8Array(await readFile(path));
    }
  }
  await collect(join(skills, name));
  await writeFile(join(output, name + '.zip'), zipSync(files));
}
const config = { mcpServers: { 'creativity-workbench': {
  type: 'stdio', command: process.execPath,
  args: [join(root, 'scripts', 'workbench-mcp.mjs'), '--ensure-runtime'], timeout: 210000,
} } };
await writeFile(join(output, 'mcp.json'), JSON.stringify(config, null, 2) + '\n');
await writeFile(join(output, 'TESTING.md'), await readFile(join(root, 'docs', 'WORKBUDDY_CORE.md')));
console.log(JSON.stringify({ output, config: join(output, 'mcp.json'), skills: names.map(name => join(output, name + '.zip')), note: '只生成本地导入包，未修改 WorkBuddy 配置或执行加载。' }, null, 2));
