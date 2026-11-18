import test from 'node:test';
import assert from 'node:assert/strict';
import { makeRepowiseAutomation } from '../repowise-automation.ts';
const workspace={spaceId:'5d8b342e-3fbd-4c77-9564-725c77466c97',name:'Space',roots:[{name:'API',path:'/worktree/api'}]};
const thread={id:'thread',projectId:'api',environmentId:'env'};
const status={available:true,version:'0.61.0',workspacePath:'/data',prepared:true,stale:true,busy:false,error:null,updatedAt:1,roots:[]};
test('lifecycle checks coalesce and refresh only prepared changed idle indexes',async()=>{
  let started=0,inspected=0,release!:()=>void;const wait=new Promise<void>(resolve=>{release=resolve;});
  const auto=makeRepowiseAutomation({resolve:async()=>({hostId:'actual',workspace,enabled:true}),inspect:async(input,host)=>{assert.deepEqual(input,workspace);assert.equal(host,'actual');inspected++;await wait;return status;},start:()=>{started++;return true;},onError:error=>{throw error;}});
  const first=auto.notify(thread),second=auto.notify(thread);await new Promise(resolve=>setImmediate(resolve));assert.equal(inspected,1);release();await Promise.all([first,second]);assert.equal(started,1);auto.dispose();await auto.notify(thread);assert.equal(started,1);
  for(const patch of [{prepared:false},{stale:false},{busy:true},{available:false}]){const auto=makeRepowiseAutomation({resolve:async()=>({hostId:'actual',workspace,enabled:true}),inspect:async()=>({...status,...patch}),start:()=>{throw new Error('Must not start');},onError:error=>{throw error;}});await auto.notify(thread);auto.dispose();}
});
test('disabled, unresolved, disposed and failed lifecycle checks never start indexing or block agents',async()=>{
  for(const context of [null,{hostId:'actual',workspace,enabled:false}]){const auto=makeRepowiseAutomation({resolve:async()=>context,inspect:async()=>{throw new Error('Must not inspect');},start:()=>false,onError:error=>{throw error;}});await auto.notify(thread);await auto.notify({...thread,environmentId:null});auto.dispose();}
  let release!:(value:typeof status)=>void,started=0;const auto=makeRepowiseAutomation({resolve:async()=>({hostId:'actual',workspace,enabled:true}),inspect:()=>new Promise(resolve=>{release=resolve;}),start:()=>{started++;return true;},onError:error=>{throw error;}});const pending=auto.notify(thread);await new Promise(resolve=>setImmediate(resolve));auto.dispose();release(status);await pending;assert.equal(started,0);
  const errors:unknown[]=[];const failed=makeRepowiseAutomation({resolve:async()=>{throw new Error('Host offline');},inspect:async()=>status,start:()=>false,onError:error=>errors.push(error)});await failed.notify(thread);assert.equal(errors.length,1);failed.dispose();
});

test('a failed refresh can retry after its cooldown',async()=>{
  let started=0,retryAt=Date.now()+60_000;
  const auto=makeRepowiseAutomation({resolve:async()=>({hostId:'actual',workspace,enabled:true}),inspect:async()=>({...status,error:'timeout',retryAt}),start:()=>{started++;return true;},onError:error=>{throw error;}});
  await auto.notify(thread);assert.equal(started,0);
  retryAt=Date.now()-1;
  await auto.notify(thread);assert.equal(started,1);
});
