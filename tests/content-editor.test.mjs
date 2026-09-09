import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createProject,applyTaskResult} from '../lib/workbench/project-core.mjs';
import {taskSource} from '../lib/workbench/task-contract.mjs';
import {validateGeneration} from '../lib/workbench/generation.mjs';

test('content request instruction is frozen while edited source remains protected',()=>{
  const p=createProject('渡口的故事','novel','渡口');
  p.content.novel={story:'原故事',characters:'原人物'};
  const args={action:'section',key:'story',instruction:'保留结局，丰富动机'};
  const task={id:crypto.randomUUID(),projectId:p.id,kind:'content',args,source:taskSource(p,'content',args),status:'succeeded',result:{sections:{story:'新故事'}}};
  validateGeneration(task,p);
  const next={...p,requests:['','另一轮要求','','','']};
  assert.equal(applyTaskResult(next,task).content.novel.story,'新故事');
  next.content={...p.content,novel:{...p.content.novel,story:'后来手动写的故事'}};
  assert.throws(()=>applyTaskResult(next,task),/生成依据已改变/);
});

test('whole content candidate adopts selected sections only without advancing',()=>{
  const p=createProject('渡口的故事','novel','渡口');p.stage=1;
  p.content.novel={story:'原故事',characters:'原人物'};
  const args={action:'generate',instruction:''};
  const task={projectId:p.id,kind:'content',args,source:taskSource(p,'content',args),status:'succeeded',result:{sections:{story:'新故事',characters:'新人物'}}};
  const next=applyTaskResult(p,task,{sectionKeys:['story']});
  assert.equal(next.content.novel.story,'新故事');assert.equal(next.content.novel.characters,'原人物');assert.equal(next.stage,1);
  assert.throws(()=>applyTaskResult(p,task,{sectionKeys:[]}),/请选择/);
});
