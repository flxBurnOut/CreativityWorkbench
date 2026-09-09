import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createRepository } from '../lib/workbench/repository.mjs';
import { createTaskManager } from '../lib/workbench/tasks.mjs';
import { createCoreService } from '../lib/workbench/core-service.mjs';
const uid = () => randomUUID();
async function setup(t) {
  const directory = await mkdtemp(join(tmpdir(), 'workbench-audit-'));
  const repo = createRepository(directory);
  const env = { DEEPSEEK_API_KEY: 'fixture' };
  const fetchImpl = async () => Response.json({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ title: '测试方案', brief: '仅本地验证', culture: '文化资料待核实' }) } }] });
  const tasks = createTaskManager(repo, { env, fetchImpl });
  const core = createCoreService(repo, tasks, { env, fetchImpl });
  t.after(async () => { await tasks.stop(); await rm(directory, { recursive: true, force: true }); });
  return { repo, tasks, core };
}
async function until(tasks, id, status) {
  for (let i = 0; i < 200; i++) { const task = await tasks.get(id); if (task.status === status) return task; await new Promise(resolve => setTimeout(resolve, 10)); }
  throw new Error('任务未到达 ' + status);
}

test('stopping with a queued task prevents dispatch and waits for durable writes',async t=>{
  const {core,tasks,repo}=await setup(t);
  const p=await core.call('project_create',{requestId:uid(),idea:'停止核查',type:'novel'});
  const job=await core.call('task_start',{requestId:uid(),projectId:p.projectId,expectedVersion:p.projectVersion,kind:'creative'});
  await tasks.stop();assert.equal((await repo.task(job.id)).status,'queued');
  await assert.rejects(core.call('task_start',{requestId:uid(),projectId:p.projectId,expectedVersion:p.projectVersion,kind:'creative'}),e=>e.code==='stopped');
});
test('MCP adoption dismisses the pending UI candidate and remains replayable', async t => {
  const { core, tasks } = await setup(t);
  const p = await core.call('project_create', { requestId: uid(), idea: '文化创作', type: 'novel' });
  const job = await core.call('task_start', { requestId: uid(), projectId: p.projectId, expectedVersion: p.projectVersion, kind: 'creative' });
  await until(tasks, job.id, 'succeeded');
  const input = { taskId: job.id, expectedVersion: p.projectVersion };
  const saved = await core.call('task_adopt', input);
  assert.equal((await tasks.get(job.id)).dismissed, true);
  assert.equal((await core.call('task_adopt', { ...input, expectedVersion: saved.projectVersion })).replayed, true);
});
test('website request metadata returned by project_get can be edited and saved again', async t => {
  const { core, tasks } = await setup(t);
  const p = await core.call('project_create', { requestId: uid(), idea: '岭南文化网站', type: 'website' });
  const job = await core.call('task_start', { requestId: uid(), projectId: p.projectId, expectedVersion: p.projectVersion, kind: 'website' });
  await until(tasks, job.id, 'succeeded');
  await core.call('task_adopt', { taskId: job.id, expectedVersion: p.projectVersion });
  const current = await core.call('project_get', { projectId: p.projectId });
  assert.ok(current.project.websiteRequest.bundleFileId);
  await core.call('project_update', { requestId: uid(), projectId: p.projectId, expectedVersion: current.projectVersion, patch: { websiteRequest: { ...current.project.websiteRequest, prompt: '改成专题展览' } } });
  const after = await core.call('project_get', { projectId: p.projectId });
  assert.equal(after.project.websiteRequest.prompt, '改成专题展览');
  assert.equal(after.project.websiteRequest.bundleFileId, current.project.websiteRequest.bundleFileId);
});
test('an unfinished image in one work type does not block the other type', async t => {
  const { core, tasks } = await setup(t);
  let p = await core.call('project_create', { requestId: uid(), idea: '跨媒介', type: 'novel' });
  const concepts = [{ id: 'object-a', name: '器物', category: 'object', description: '已知设定', prompt: '', revisionRequest: '' }];
  p = await core.call('project_update', { requestId: uid(), projectId: p.projectId, expectedVersion: p.projectVersion, patch: { concepts } });
  const start = async current => core.call('task_start', { requestId: uid(), projectId: current.projectId, expectedVersion: current.projectVersion, kind: 'image', args: { objectId: 'object-a' } });
  const first = await start(p); await until(tasks, first.id, 'waiting_external');
  p = await core.call('project_update', { requestId: uid(), projectId: p.projectId, expectedVersion: p.projectVersion, patch: { type: 'video', concepts } });
  const second = await start(p); await until(tasks, second.id, 'waiting_external');
  assert.equal(second.workType, 'video');
  await assert.rejects(start(p), e => e.code === 'pending_task');
});
