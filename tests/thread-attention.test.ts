import test from 'node:test';
import assert from 'node:assert/strict';
import { threadAttentionTone, threadFamilyAttention, type ThreadAttentionTone } from '../thread-attention.ts';
import type { PluginThreadStatus } from '@get-bb/plugin-sdk/app';
const status=(indicator:PluginThreadStatus['indicator'])=>({indicator,rowStatus:null});

test('pending questions remain yellow after opening or reading, terminal outcomes are acknowledged',()=>{
  assert.equal(threadAttentionTone(true,status('unread-success')),'success');
  assert.equal(threadAttentionTone(true,status('unread-success'),true),null);
  assert.equal(threadAttentionTone(false,status('unread-success')),null);
  assert.equal(threadAttentionTone(true,status('waiting-for-input')),'question');
  assert.equal(threadAttentionTone(true,status('waiting-for-input'),true),'question');
  assert.equal(threadAttentionTone(false,status('waiting-for-input')),'question');
  assert.equal(threadAttentionTone(false,status('runtime'),true,true),'question');
  assert.equal(threadAttentionTone(false,status('runtime'),true,false),null);
  assert.equal(threadAttentionTone(true,status('unread-error')),'error');
  assert.equal(threadAttentionTone(false,status('unread-error')),null);
});
test('parents inherit the highest priority descendant color through every level and clear when answered',()=>{
  const leaf={thread:{id:'question',tone:'question' as ThreadAttentionTone|null},children:[]};
  const parent={thread:{id:'parent',tone:'success' as ThreadAttentionTone|null},children:[leaf]};
  const root={thread:{id:'root',tone:'error' as ThreadAttentionTone|null},children:[parent]};
  let attention=threadFamilyAttention([root],thread=>thread.tone);
  assert.deepEqual(attention.get('question'),{tone:'question',fromDescendant:false});
  assert.deepEqual(attention.get('parent'),{tone:'question',fromDescendant:true});
  assert.deepEqual(attention.get('root'),{tone:'question',fromDescendant:true});
  leaf.thread.tone=null;
  attention=threadFamilyAttention([root],thread=>thread.tone);
  assert.deepEqual(attention.get('parent'),{tone:'success',fromDescendant:false});
  assert.deepEqual(attention.get('root'),{tone:'error',fromDescendant:false});
  parent.thread.tone=null;root.thread.tone=null;
  assert.deepEqual(threadFamilyAttention([root],thread=>thread.tone).get('root'),{tone:null,fromDescendant:false});
});
test('sibling failures precede success, questions precede failures, independent roots stay neutral',()=>{
  const nodes=[{thread:{id:'parent',tone:null as ThreadAttentionTone|null},children:[
    {thread:{id:'success',tone:'success' as ThreadAttentionTone|null},children:[]},
    {thread:{id:'error',tone:'error' as ThreadAttentionTone|null},children:[]},
  ]},{thread:{id:'other',tone:null as ThreadAttentionTone|null},children:[]}];
  assert.deepEqual(threadFamilyAttention(nodes,thread=>thread.tone).get('parent'),{tone:'error',fromDescendant:true});
  nodes[0]!.children[0]!.thread.tone='question';
  const attention=threadFamilyAttention(nodes,thread=>thread.tone);
  assert.deepEqual(attention.get('parent'),{tone:'question',fromDescendant:true});
  assert.deepEqual(attention.get('other'),{tone:null,fromDescendant:false});
});
test('running work is neutral; queued failures and contributed terminal outcomes respect unread state',()=>{
  assert.equal(threadAttentionTone(true,status('runtime')),null);
  assert.equal(threadAttentionTone(true,status('queued-failed')),'error');
  const contributed={indicator:'none' as const,rowStatus:{icon:'Check' as const,label:'Finished',tone:'success' as const}};
  assert.equal(threadAttentionTone(true,contributed),'success');assert.equal(threadAttentionTone(false,contributed),null);
});
