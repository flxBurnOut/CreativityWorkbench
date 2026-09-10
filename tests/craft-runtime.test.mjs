import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createTestDirectory } from './helpers/test-directory.mjs';
import { createRepository, digest } from '../lib/workbench/repository.mjs';
import { createProject } from '../lib/workbench/project-core.mjs';
import { taskSource } from '../lib/workbench/task-contract.mjs';
import { projectOutputIds } from '../lib/workbench/output-contract.mjs';
import { switchWorkType, projectForType } from '../lib/workbench/workflow.mjs';
import { runCraftTask, attachCraftResult, craftKnowledge } from '../lib/workbench/craft-runtime.mjs';

async function setup(t, prompt = '制作一只白色瓷碗') {
  const scope = await createTestDirectory(t, 'craft-runtime');
  const repo = createRepository(scope.directory), id = crypto.randomUUID();
  const project = { ...createProject(prompt, 'craft'), craftGoal: prompt, craftRequest: { taskId: id, goal: prompt, requestedAt: Date.now() } };
  await repo.mutateProject({ projectId: project.id, create: true, operationId: 'create-' + id, requestHash: id }, () => ({ project }));
  const task = { id, projectId: project.id, kind: 'craft-model', createdAt: Date.now(), status: 'running', snapshot: project, args: { prompt, planJson: JSON.stringify({ kind: 'bowl' }) } };
  task.source = taskSource(project, task.kind, task.args);
  return { scope, repo, task, project };
}

// Deliberately small format fixtures for persistence/lifecycle tests. These do
// not establish real mesh validity; the opt-in engine test runs actual Blender.
async function fixtureBuilder(plan, { directory }) {
  const blendPath = join(directory, 'asset.blend'), glbPath = join(directory, 'asset.glb');
  const blend = Buffer.alloc(20); blend.write('BLENDER-v500');
  let json = JSON.stringify({ asset: { version: '2.0' }, scenes: [{}], scene: 0 });
  json = json.padEnd(Math.ceil(json.length / 4) * 4, ' ');
  const glb = Buffer.alloc(20 + json.length); glb.write('glTF'); glb.writeUInt32LE(2, 4); glb.writeUInt32LE(glb.length, 8); glb.writeUInt32LE(json.length, 12); glb.writeUInt32LE(0x4e4f534a, 16); glb.write(json, 20);
  await writeFile(blendPath, blend); await writeFile(glbPath, glb);
  return { plan, blendPath, glbPath, stats: { vertices: 64, triangles: 120, objects: 1, materials: 1, dimensions: [.16, .16, .08], unit: 'm' }, warnings: [] };
}

test('craft success attaches automatically, survives type switching, and streams both protected files', async t => {
  const { repo, task, scope } = await setup(t);
  const phases = [];
  task.result = await runCraftTask(task, { repository: repo, env: {}, buildImpl: fixtureBuilder, update: async patch => { phases.push(patch.phase); } });
  task.status = 'succeeded';
  assert.deepEqual(phases, ['planning', 'building', 'checking']);
  assert.deepEqual(await readdir(join(scope.directory, 'render')), []);
  await attachCraftResult(task, repo);
  let current = (await repo.loadWorkspace()).workspace.projects[0];
  assert.equal(current.craftAsset.taskId, task.id);
  assert.deepEqual(new Set(projectOutputIds(current)), new Set([task.result.craftAsset.blendFileId, task.result.craftAsset.glbFileId]));
  const revision = (await repo.loadWorkspace()).revision;
  await attachCraftResult(task, repo, current);
  assert.equal((await repo.loadWorkspace()).revision, revision, 'polling must not keep rewriting successful assets');
  const switched = switchWorkType(current, 'website');
  assert.equal(projectForType(switched, 'craft').craftAsset.taskId, task.id);
  assert.equal(projectOutputIds(switched).length, 2);
  const glb = await readFile(join(scope.directory, 'files', task.result.craftAsset.glbFileId));
  assert.equal(glb.toString('ascii', 0, 4), 'glTF');
});

test('late craft results cannot replace a newer request or overwrite an edited next prompt', async t => {
  const { repo, task, project } = await setup(t);
  task.result = await runCraftTask(task, { repository: repo, env: {}, buildImpl: fixtureBuilder, update: async () => {} });
  task.status = 'succeeded';
  let current = (await repo.loadWorkspace()).workspace.projects[0];
  await repo.mutateProject({ projectId: project.id, expectedVersion: digest(current), operationId: 'new-request', requestHash: 'new' }, p => ({ project: { ...p, craftGoal: '下一次要蓝色', craftRequest: { ...p.craftRequest, taskId: 'new-task' } } }));
  await attachCraftResult(task, repo);
  current = (await repo.loadWorkspace()).workspace.projects[0];
  assert.equal(current.craftAsset, undefined);
  assert.equal(current.craftGoal, '下一次要蓝色');
  assert.equal(current.flow.records.find(record => record.target === 'craftAsset').value.taskId, task.id);
  assert.equal(projectOutputIds(current).length, 2, 'late valid files remain included in backups');
  await repo.mutateProject({ projectId: project.id, expectedVersion: digest(current), operationId: 'restore-pointer', requestHash: 'restore' }, p => ({ project: { ...p, craftRequest: project.craftRequest } }));
  await attachCraftResult(task, repo);
  current = (await repo.loadWorkspace()).workspace.projects[0];
  assert.equal(current.craftAsset, undefined, 'querying a retained historical task must not promote it again');
  assert.equal(current.craftGoal, '下一次要蓝色', 'completed output must not erase the editable next requirement');
});

test('editing next requirement during building preserves that draft when current output arrives', async t => {
  const { repo, task, project } = await setup(t);
  task.result = await runCraftTask(task, { repository: repo, env: {}, buildImpl: fixtureBuilder, update: async () => {} });
  task.status = 'succeeded';
  const current = (await repo.loadWorkspace()).workspace.projects[0];
  await repo.mutateProject({ projectId: project.id, expectedVersion: digest(current), operationId: 'next-draft', requestHash: 'draft' }, p => ({ project: { ...p, craftGoal: '下个版本改为蓝色，但保留正在生成的白色' } }));
  await attachCraftResult(task, repo);
  const saved = (await repo.loadWorkspace()).workspace.projects[0];
  assert.equal(saved.craftAsset.taskId, task.id);
  assert.equal(saved.craftGoal, '下个版本改为蓝色，但保留正在生成的白色');
});

test('failed or cancelled craft building cleans its own temporary files and publishes no result', async t => {
  const { repo, task, scope } = await setup(t);
  const controller = new AbortController();
  await assert.rejects(runCraftTask(task, { repository: repo, env: {}, signal: controller.signal, update: async () => {}, buildImpl: async (_plan, { directory }) => {
    await writeFile(join(directory, 'partial.blend'), 'partial'); controller.abort(); throw Error('worker exited after cancellation');
  } }));
  assert.deepEqual(await readdir(join(scope.directory, 'render')), []);
  assert.deepEqual(await readdir(join(scope.directory, 'files')), []);
  assert.equal((await repo.loadWorkspace()).workspace.projects[0].craftAsset, undefined);
});

test('no-key craft planning keeps the original task and never starts Blender or fabricates a model', async t => {
  const { repo, task, scope } = await setup(t); delete task.args.planJson;
  const patches = [];
  const result = await runCraftTask(task, { repository: repo, env: {}, update: async patch => { patches.push(patch); }, buildImpl: async () => { assert.fail('must wait for a real plan'); } });
  assert.equal(result, null);
  const wait = patches.find(patch => patch.status === 'waiting_external');
  assert.ok(wait.handoffInstructions.includes(task.id));
  assert.ok(wait.handoffInstructions.includes('craft_complete_plan'));
  assert.deepEqual(await readdir(join(scope.directory, 'files')), []);
});

test('configured text planning builds a validated plan and reports unsupported requests honestly', async t => {
  const { repo, task } = await setup(t); delete task.args.planJson;
  let called = 0;
  const fetchImpl = async (_url, options) => {
    called++;
    const request = JSON.parse(options.body);
    assert.ok(request.messages[0].content.includes('不输出程序'));
    return Response.json({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ plan: { kind: 'bowl', material: { color: '#315f7b' } }, notes: ['默认尺寸为原创设计参数。'] }) } }] });
  };
  const result = await runCraftTask(task, { repository: repo, env: { DEEPSEEK_API_KEY: 'test-only' }, fetchImpl, update: async () => {}, buildImpl: fixtureBuilder });
  assert.equal(result.craftAsset.plan.material.color, '#315f7b'); assert.equal(called, 1);
  await assert.rejects(runCraftTask(task, { repository: repo, env: { DEEPSEEK_API_KEY: 'test-only' }, update: async () => {}, buildImpl: fixtureBuilder, fetchImpl: async () => Response.json({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ unsupported: '首版无法制作精细人物雕塑。' }) } }] }) }), error => error.code === 'unsupported_craft');
});

test('culture matching only adds corresponding named elements and keeps versioned references', () => {
  assert.deepEqual(craftKnowledge({}, '一只普通白碗'), []);
  const references = craftKnowledge({}, '岭南骑楼建筑');
  assert.ok(references.length > 0);
  assert.ok(references.every(ref => typeof ref.version === 'string'));
  assert.deepEqual(craftKnowledge({}, '一件岭南文创'), []);
});
