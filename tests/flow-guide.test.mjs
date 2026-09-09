import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createProject } from '../features/projects/model.ts';
import { hasStageDraft, nextStage, taskMatchesStep } from '../features/creative-flow/flow-guide.ts';

test('website handoff and image candidates do not claim an adopted deliverable', () => {
  const p = createProject('岭南专题站', 'website');
  p.websiteRequest = { prompt: '制作网站', basis: '', assetIds: [], bundleFileId: 'request.zip' };
  p.websiteSourceCandidate = { fileId: 'candidate.zip' };
  assert.equal(hasStageDraft(p, 4), false);
  p.websiteSource = p.websiteSourceCandidate;
  assert.equal(hasStageDraft(p, 4), true);
  p.concepts = [{ candidateAssetId: 'picture' }];
  assert.equal(hasStageDraft(p, 3), false);
  p.concepts[0].savedAssetId = 'picture';
  assert.equal(hasStageDraft(p, 3), true);
});

test('novel route skips optional pictures without changing or deleting their drafts', () => {
  const p = createProject('短篇', 'novel');
  p.stage = 1; p.art.direction = '保留原画风'; p.assets = [{ id: 'keep' }];
  const before = structuredClone(p);
  assert.equal(nextStage(p), 4);
  assert.deepEqual(p, before);
  p.type = 'website';
  assert.equal(nextStage(p), 2);
});

test('results stay with their work type and source step, including novel feedback', () => {
  const p = createProject('故事', 'novel'); p.stage = 1;
  const task = { kind: 'content', args: {}, source: JSON.stringify(['version', 'novel']) };
  assert.equal(taskMatchesStep(p, task), true);
  assert.equal(taskMatchesStep(p, { ...task, workType: 'video' }), false);
  assert.equal(taskMatchesStep(p, { ...task, kind: 'art' }), false);
  assert.equal(taskMatchesStep(p, { ...task, args: { fromNovel: true } }), false);
  p.stage = 4;
  assert.equal(taskMatchesStep(p, { ...task, args: { fromNovel: true } }), true);
  assert.equal(taskMatchesStep(p, { ...task, source: 'invalid legacy source' }), false);
});
