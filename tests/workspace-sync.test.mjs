import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject } from '../features/projects/model.ts';
import { reconcileWorkspace } from '../features/projects/workspace-sync.ts';

const workspace = (...projects) => ({ projects, activeProjectId: projects[0]?.id ?? null });
test('saving another project keeps concurrent WorkBuddy changes without creating a copy', () => {
  const a = createProject('岭南故事', 'novel', 'A', 'project-a');
  const b = createProject('文化网站', 'website', 'B', 'project-b');
  const base = workspace(a, b);
  const local = workspace({ ...a, brief: '本机创意' }, b);
  const remote = workspace(a, { ...b, brief: 'WorkBuddy 保存的网站创意' });
  const result = reconcileWorkspace(base, local, remote);
  assert.equal(result.copies.length, 0);
  assert.equal(result.workspace.projects[0].brief, '本机创意');
  assert.equal(result.workspace.projects[1].brief, 'WorkBuddy 保存的网站创意');
});
test('concurrent edits to the same project preserve both versions and select the local copy', () => {
  const p = createProject('共同创意', 'novel', '同一个项目', 'project-a');
  const result = reconcileWorkspace(workspace(p), workspace({ ...p, brief: '本机版本' }), workspace({ ...p, brief: '远端版本' }), () => 'conflict-copy');
  assert.equal(result.workspace.projects[0].brief, '远端版本');
  assert.equal(result.workspace.projects[1].brief, '本机版本');
  assert.equal(result.workspace.activeProjectId, 'conflict-copy');
  assert.equal(result.copies.length, 1);
});
test('navigation and resolved image hashes are not treated as concurrent content edits', () => {
  const p = createProject('图片', 'novel', '', 'project-a');
  const blob = new Blob(['image']);
  p.assets = [{ id: 'asset', name: '图', fileId: 'hash' }];
  const local = { ...p, stage: 3, updatedAt: 42, assets: [{ ...p.assets[0], blob }] };
  const remote = { ...p, brief: '来自 WorkBuddy 的更新' };
  const result = reconcileWorkspace(workspace(p), workspace(local), workspace(remote));
  assert.equal(result.copies.length, 0);
  assert.equal(result.workspace.projects[0].brief, remote.brief);
  assert.equal(result.workspace.projects[0].stage, 3);
});
test('remote deletion does not erase an unsaved local draft', () => {
  const p = createProject('保留草稿', 'novel', '', 'project-a');
  const result = reconcileWorkspace(workspace(p), workspace({ ...p, brief: '未保存内容' }), workspace(), () => 'rescued');
  assert.equal(result.workspace.projects[0].id, 'rescued');
  assert.equal(result.workspace.projects[0].brief, '未保存内容');
});

test('local deletion of a remotely edited project is preserved and explicitly reported',()=>{
  const p=createProject('保留远端修改','novel','','p');
  const merged=reconcileWorkspace(workspace(p),workspace(),workspace({...p,brief:'对话端新稿'}));
  assert.equal(merged.workspace.projects[0].brief,'对话端新稿');assert.deepEqual(merged.preservedRemovals,[p.title]);
});
