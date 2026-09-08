import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createProject, createDemoProject, emptyWorkspace, updateProject, parseStoredWorkspace, pruneAssets, removeConcept } from '../features/projects/model.ts';

test('switching work type preserves distinct drafts and a stage survives a storage round trip', () => {
  const project = createProject('当代岭南的生活故事', 'novel', '草稿测试', 'project-test');
  project.content.novel.story = '不能丢失的原稿与占位符 {name}';
  project.content.video.script = '另一种作品的脚本';
  let workspace = { projects: [project], activeProjectId: project.id };
  workspace = updateProject(workspace, project.id, p => ({ ...p, type: 'video', stage: 2 }));
  const stored = parseStoredWorkspace(structuredClone({ version: 1, revision: 7, workspace }));
  assert.equal(stored.workspace.projects[0].content.novel.story, '不能丢失的原稿与占位符 {name}');
  assert.equal(stored.workspace.projects[0].content.video.script, '另一种作品的脚本');
  assert.equal(stored.workspace.projects[0].stage, 2);
  assert.equal(stored.workspace.activeProjectId, 'project-test');
});

test('damaged or future browser data is rejected instead of silently replaced', () => {
  const workspace = { projects: [createProject('一个想法')], activeProjectId: null };
  assert.throws(() => parseStoredWorkspace({ version: 2, revision: 1, workspace }));
  const broken = structuredClone(workspace);
  broken.projects[0].requests = [];
  assert.throws(() => parseStoredWorkspace({ version: 1, revision: 1, workspace: broken }));
  assert.throws(() => parseStoredWorkspace({ version: 1, revision: 1, workspace: { ...workspace, activeProjectId: 'missing' } }));
  const malformed = structuredClone(workspace);
  malformed.projects[0].assets = [{ id: 'bad', name: '外部引用', demoSrc: 'javascript:alert(1)' }];
  assert.throws(() => parseStoredWorkspace({ version: 1, revision: 1, workspace: malformed }));
});

test('replacing a candidate retains the saved image and a separately selected cover', () => {
  const p = createProject('一把葵扇', 'craft');
  p.assets = ['saved', 'candidate', 'cover', 'unused'].map(id => ({ id, name: id, blob: new Blob([id], { type: 'image/png' }) }));
  p.coverAssetId = 'cover'; p.manualCover = true;
  p.concepts = [{ id: 'fan', name: '葵扇', category: 'object', description: '', prompt: '', revisionRequest: '', candidateAssetId: 'candidate', savedAssetId: 'saved' }];
  const retained = pruneAssets(p);
  assert.deepEqual(retained.assets.map(a => a.id), ['saved', 'candidate', 'cover']);
  const roundTrip = parseStoredWorkspace(structuredClone({ version: 1, revision: 1, workspace: { projects: [retained], activeProjectId: p.id } }));
  assert.equal(roundTrip.workspace.projects[0].assets[0].blob.size, 5);
  const removed = removeConcept(retained, 'fan');
  assert.deepEqual(removed.assets.map(a => a.id), ['cover']);
  assert.equal(removed.coverAssetId, 'cover');
});

test('removing the auto-cover concept falls back to another saved reference', () => {
  const project = createDemoProject('craft');
  project.coverAssetId = 'demo-fan';
  project.concepts[1].savedAssetId = 'demo-courtyard';
  const next = removeConcept(project, 'demo-object');
  assert.equal(next.coverAssetId, 'demo-courtyard');
  assert.ok(next.assets.some(asset => asset.id === next.coverAssetId));
  // The removed image still has an independent art-reference use.
  assert.ok(next.assets.some(asset => asset.id === 'demo-fan'));
});

test('demo projects never populate a new workspace and all four workflows have distinct content', () => {
  const workspace = emptyWorkspace();
  const types = ['novel', 'video', 'craft', 'website'];
  const projects = types.map(createDemoProject);
  assert.deepEqual(workspace.projects, []);
  assert.equal(new Set(projects.map(p => p.title)).size, 4);
  projects.forEach(p => assert.ok(Object.keys(p.content[p.type]).length >= 4));
  const fresh = createProject('新的想法');
  assert.equal(fresh.brief, '');
  assert.equal(fresh.concepts.length, 0);
  assert.equal(fresh.assets.length, 0);
});
