import assert from 'node:assert/strict';
import {test} from 'node:test';
import {websiteVerification,validateWebsiteVerification} from '../lib/workbench/website-verification.mjs';
import {createProject} from '../lib/workbench/project-core.mjs';
import {pruneAssets} from '../features/projects/model.ts';

test('file and static reports cannot certify browser interaction; evidence remains an external report',()=>{
  for(const source of [{verification:'全部通过'}, {verificationMethod:'static',verificationResult:'passed',verificationEvidence:'HTTP 200 and simulated DOM'}, {verificationMethod:'browser',verificationResult:'passed',verificationEvidence:' '}])assert.equal(websiteVerification(source).browserStatus,'unverified');
  const report=websiteVerification({verificationMethod:'user-browser',verificationResult:'failed',verificationEvidence:'FAQ open-close-open: clipped to zero height'});
  assert.equal(report.browserStatus,'reported-fail');assert.equal(report.origin,'external-report');
  assert.equal(websiteVerification({verificationMethod:'browser',verificationResult:'passed',verificationEvidence:'Actual Chromium clicks, visible answers and screenshot'}).browserStatus,'reported-pass');
  assert.throws(()=>validateWebsiteVerification({verificationMethod:'fake-browser'}));
  assert.match(websiteVerification({verificationMethod:'static',verificationResult:'failed'}).note,/检查报告失败/);
});

test('pruning keeps edited image ancestors for actual before-after comparisons, including cycles',()=>{
  const p=createProject('图像返工测试','novel');p.concepts=[{id:'object',candidateAssetId:'new'}];
  p.assets=[{id:'old'}, {id:'mid',source:{parentAssetId:'old'}}, {id:'new',source:{parentAssetId:'mid'}}, {id:'unused'}];
  assert.deepEqual(pruneAssets(p).assets.map(a=>a.id),['old','mid','new']);
  p.assets[0].source={parentAssetId:'new'};assert.equal(pruneAssets(p).assets.length,3);
});
