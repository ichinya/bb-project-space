import test from 'node:test';
import assert from 'node:assert/strict';
import { threadAttentionTone } from '../thread-attention.ts';
import type { PluginThreadStatus } from '@get-bb/plugin-sdk/app';
const status=(indicator:PluginThreadStatus['indicator'])=>({indicator,rowStatus:null});

test('unread completion, opened thread, read question and a new question follow the read lifecycle',()=>{
  assert.equal(threadAttentionTone(true,status('unread-success')),'success');
  assert.equal(threadAttentionTone(true,status('unread-success'),true),null);
  assert.equal(threadAttentionTone(false,status('unread-success')),null);
  assert.equal(threadAttentionTone(true,status('waiting-for-input')),'question');
  assert.equal(threadAttentionTone(true,status('waiting-for-input'),true),null);
  assert.equal(threadAttentionTone(false,status('waiting-for-input')),null);
  assert.equal(threadAttentionTone(true,status('unread-error')),'error');
  assert.equal(threadAttentionTone(false,status('unread-error')),null);
});
test('running work is neutral; queued failures and contributed terminal outcomes respect unread state',()=>{
  assert.equal(threadAttentionTone(true,status('runtime')),null);
  assert.equal(threadAttentionTone(true,status('queued-failed')),'error');
  const contributed={indicator:'none' as const,rowStatus:{icon:'Check' as const,label:'Finished',tone:'success' as const}};
  assert.equal(threadAttentionTone(true,contributed),'success');assert.equal(threadAttentionTone(false,contributed),null);
});
