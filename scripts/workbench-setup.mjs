import '../lib/workbench/env.mjs';
import { mkdir, readFile, readdir, writeFile, stat } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { zipSync } from 'fflate';
import { skillCreativeRules } from '../lib/workbench/prompts.mjs';
import { currentKnowledge, knowledgeText } from '../lib/workbench/knowledge.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = join(root, 'work', 'workbuddy-core');
const skills = join(root, 'workbench', 'skills');
await mkdir(output, { recursive: true });
const names = (await readdir(skills)).sort();
for (const name of names) {
  // Both installable Skills receive the same maintained policy as Runtime prompts.
  await mkdir(join(skills,name,'references'),{recursive:true});
  await writeFile(join(skills,name,'references','creative-rules.md'),skillCreativeRules());
  if(name!=='creativity-project')await writeFile(join(skills,name,'references','continuous-workflow.md'),await readFile(join(skills,'creativity-project','references','continuous-workflow.md')));
  if(name!=='creativity-project')await writeFile(join(skills,name,'references','acceptance.md'),await readFile(join(skills,'creativity-project','references','acceptance.md')));
  if(name!=='creativity-project')await writeFile(join(skills,name,'references','existing-handoff.md'),await readFile(join(skills,'creativity-project','references','existing-handoff.md')));
  await writeFile(join(skills,name,'references','lingnan-knowledge.md'), '# 岭南知识资料\n\n版本 '+currentKnowledge.version+'。'+currentKnowledge.scope+'\n\n从 knowledge_search 搜索、knowledge_apply 选择；本参考不意味着全部条目已被加入项目。\n\n'+knowledgeText({knowledge:currentKnowledge.entries.map(e=>({id:e.id,version:currentKnowledge.version}))}));
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
  type: 'stdio', command: process.env.WORKBENCH_NODE_COMMAND || 'node',
  args: [join(root, 'scripts', 'workbench-mcp.mjs'), '--ensure-runtime'], timeout: 210000,
} } };
await writeFile(join(output, 'mcp.json'), JSON.stringify(config, null, 2) + '\n');
await writeFile(join(output, 'TESTING.md'), await readFile(join(root, 'docs', '创意工作台验收条目.md')));
await writeFile(join(output, 'SETUP.md'), await readFile(join(root, 'docs', 'WORKBUDDY_CORE.md')));
console.log(JSON.stringify({ output, config: join(output, 'mcp.json'), skills: names.map(name => join(output, name + '.zip')), note: '只生成本地导入包，未修改 WorkBuddy 配置或执行加载。' }, null, 2));
