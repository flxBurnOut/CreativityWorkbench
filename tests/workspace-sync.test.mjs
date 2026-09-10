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

test('typing the next website instruction merges with an incoming result on the original project',()=>{
  const p={...createProject('文化网站','website','','p'),websiteEdit:{scope:'all',change:'下一轮草稿'},websiteRequest:{taskId:'current'}};
  const mine={...p,websiteEdit:{scope:'content',change:'新的文案修改要求'},stage:4};
  const theirs={...p,websiteSourceCandidate:{fileId:'actual-result.zip',taskId:'current'}};
  const result=reconcileWorkspace(workspace(p),workspace(mine),workspace(theirs));
  assert.equal(result.copies.length,0);assert.equal(result.workspace.activeProjectId,'p');
  assert.deepEqual(result.workspace.projects[0].websiteEdit,mine.websiteEdit);
  assert.deepEqual(result.workspace.projects[0].websiteSourceCandidate,theirs.websiteSourceCandidate);
  assert.equal(result.workspace.projects[0].stage,4);
});

test('a submitted instruction can be consumed while a newer local instruction is preserved',()=>{
  const p={...createProject('文化网站','website','','p'),websiteEdit:{scope:'all',change:'整站修改'},websiteRequest:{taskId:'old'}};
  const mine={...p,websiteEdit:{scope:'images',change:'下一轮调整图片'}};
  const theirs={...p,websiteEdit:undefined,websiteBrief:{scope:'all',change:'整站修改'},websiteRequest:{taskId:'new'}};
  const result=reconcileWorkspace(workspace(p),workspace(mine),workspace(theirs));
  assert.equal(result.copies.length,0);assert.equal(result.workspace.projects[0].websiteRequest.taskId,'new');
  assert.deepEqual(result.workspace.projects[0].websiteEdit,mine.websiteEdit);
});

test('two people editing the website instruction still retain both conflicting drafts',()=>{
  const p={...createProject('文化网站','website','','p'),websiteEdit:{scope:'all',change:'原要求'}};
  const result=reconcileWorkspace(workspace(p),workspace({...p,websiteEdit:{scope:'content',change:'本机要求'}}),workspace({...p,websiteEdit:{scope:'images',change:'另一端要求'}}),()=> 'copy');
  assert.equal(result.copies.length,1);assert.equal(result.workspace.projects[0].websiteEdit.change,'另一端要求');
  assert.equal(result.workspace.projects[1].websiteEdit.change,'本机要求');
});

test('incoming 3D result and next requirement stay in the original project without a conflict copy',()=>{
  const p={...createProject('白色陶碗','craft','','p'),craftRequest:{taskId:'current',goal:'白色陶碗',requestedAt:1}};
  const mine={...p,craftGoal:'下一轮蓝釉，保留内壁'};
  const theirs={...p,craftGoal:'白色陶碗',craftAsset:{taskId:'current',blendFileId:'blend',glbFileId:'glb'}};
  const result=reconcileWorkspace(workspace(p),workspace(mine),workspace(theirs));
  assert.equal(result.copies.length,0);assert.equal(result.workspace.projects.length,1);
  assert.equal(result.workspace.projects[0].craftGoal,mine.craftGoal);
  assert.deepEqual(result.workspace.projects[0].craftAsset,theirs.craftAsset);
  assert.equal(result.workspace.activeProjectId,'p');
});

test('two people editing a craft requirement retain both distinct drafts',()=>{
  const p={...createProject('白色陶碗','craft','','p'),craftGoal:'白色陶碗'};
  const result=reconcileWorkspace(workspace(p),workspace({...p,craftGoal:'本机蓝釉'}),workspace({...p,craftGoal:'另一端红釉'}),()=> 'copy');
  assert.equal(result.copies.length,1);
  assert.equal(result.workspace.projects[0].craftGoal,'另一端红釉');
  assert.equal(result.workspace.projects[1].craftGoal,'本机蓝釉');
});
