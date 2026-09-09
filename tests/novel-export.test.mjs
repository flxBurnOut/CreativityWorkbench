import test from 'node:test';
import assert from 'node:assert/strict';
import {formatNovel} from '../lib/workbench/novel-export.mjs';
test('exports remove only a duplicate opening title and preserve repeated words in the story',()=>{
  for(const heading of ['修伞人的一天','# 修伞人的一天','**修伞人的一天**']) {
    const novel={title:'修伞人的一天',text:heading+'\r\n\r\n故事开始。\n\n修伞人的一天\n故事结束。'};
    const original=novel.text;
    assert.equal(formatNovel(novel,'md'),'# 修伞人的一天\n\n故事开始。\n\n修伞人的一天\n故事结束。\n');
    assert.equal(formatNovel(novel,'txt'),'修伞人的一天\n\n故事开始。\n\n修伞人的一天\n故事结束。\n');
    assert.equal(novel.text,original);
  }
  assert.equal(formatNovel({title:'标题',text:'标题里的人回来了。\n'}),'# 标题\n\n标题里的人回来了。\n');
  assert.equal(formatNovel({title:'标题',text:'## 第一章\n内容'}),'# 标题\n\n## 第一章\n内容\n');
});
