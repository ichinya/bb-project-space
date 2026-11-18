import test from 'node:test';
import assert from 'node:assert/strict';
import {pagePreviewTarget} from '../page-preview.ts';

const pageId='page_0123456789abcdef0123456789abcdef';
test('page preview uses the canonical HTTPS route and ignores arbitrary URLs',()=>{
  assert.deepEqual(pagePreviewTarget({page_id:pageId,url:'javascript:alert(1)',title:' История с фотографиями '}),{
    pageId,url:`https://chatgpt.com/space/${pageId}`,title:'История с фотографиями',
  });
  assert.equal(pagePreviewTarget({page_id:pageId})?.title,'Страница ChatGPT');
});
test('page preview refuses missing, malformed and path-injecting IDs',()=>{
  for(const value of ['',pageId+'/../../evil',pageId+'?next=evil',pageId+'\n','javascript:alert(1)','https://evil.test',pageId.toUpperCase()])assert.equal(pagePreviewTarget({page_id:value}),null);
  assert.equal(pagePreviewTarget({}),null);
  assert.equal(pagePreviewTarget({page_id:pageId,title:'x'.repeat(1000)})?.title.length,240);
});
