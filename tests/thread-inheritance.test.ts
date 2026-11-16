import test from 'node:test';
import assert from 'node:assert/strict';
import type { PluginBbSdk,PluginDispatchInput } from '@get-bb/plugin-sdk';
import { createFakePluginHost,makeMessageDispatchHookContext,makePluginAgentConfigurationContext,makeThreadResponse } from '@get-bb/plugin-sdk/testing';
import { continuationSource,makeThreadInheritance } from '../thread-inheritance.ts';
import { groupThreads,threadMetadata } from '../threads.ts';
import type { Space } from '../model.ts';
import plugin from '../server.ts';

const space:Space={id:'1a3a9440-ab6a-4429-838d-b532e3382df2',name:'Platform',projectIds:['api'],primaryProjectId:'api',folders:[],instructions:'Shared task',contextGroup:'platform'};
type Blocks=PluginDispatchInput['blocks'];
type Metadata=Awaited<ReturnType<PluginBbSdk['threads']['getPluginMetadata']>>;
const continued=(id='thr_source'):Blocks=>[{type:'text',text:`Continue from @thread:${id}\nпроверь`,mentions:[{start:14,end:22+id.length,resource:{kind:'thread',threadId:id,label:'Source'}}]}];
function fixture(){
  const rows=new Map<string,ReturnType<typeof makeThreadResponse>>(),metadata=new Map<string,Metadata>(),events=new Map<string,unknown[]>();
  const writes:string[]=[],eventReads:string[]=[];let signals=0;
  const add=(id:string,data:Metadata={},patch:Partial<ReturnType<typeof makeThreadResponse>>={})=>{rows.set(id,makeThreadResponse({id,projectId:'api',parentThreadId:null,sourceThreadId:null,...patch}));metadata.set(id,structuredClone(data));};
  const threads={
    get:async({threadId}:{threadId:string})=>{const row=rows.get(threadId);if(!row)throw new Error('Missing thread');return row;},
    getPluginMetadata:async({threadId}:{threadId:string})=>structuredClone(metadata.get(threadId)??{}),
    updatePluginMetadata:async({threadId,set,remove=[]}:{threadId:string;set:Metadata;remove?:string[]})=>{writes.push(threadId);const next={...metadata.get(threadId),...set};for(const key of remove)delete next[key];metadata.set(threadId,next);return next;},
    experimental_listPluginMetadata:async({threadIds}:{threadIds:readonly string[]})=>({threads:threadIds.map(threadId=>({threadId,metadata:structuredClone(metadata.get(threadId)??{})}))}),
    events:{list:async({threadId,limit,types}:{threadId:string;limit:string;types:string[]})=>{assert.equal(limit,'1');assert.deepEqual(types,['client/turn/requested']);eventReads.push(threadId);return events.get(threadId)??[];}},
  } as unknown as PluginBbSdk['threads'];
  const inherit=makeThreadInheritance({threads},()=>[space],()=>signals++);
  return {add,rows,metadata,events,writes,eventReads,threads,inherit,signals:()=>signals};
}

test('only the leading structured Continue from link inherits placement',()=>{
  assert.equal(continuationSource(continued()),'thr_source');
  assert.equal(continuationSource([{type:'text',text:'Continue from @thread:thr_source',mentions:[]}]),null);
  assert.equal(continuationSource([{type:'text',text:'Look at @thread:thr_source',mentions:[]}]),null);
  assert.equal(continuationSource(continued().map(b=>({...b,visibility:'agent-only' as const}))),null);
  const bad=structuredClone(continued());if(bad[0]?.type==='text')bad[0].mentions[0]!.start=0;
  assert.equal(continuationSource(bad),null);
});
test('fresh continuation copies shared scope and context without unrelated source metadata',async()=>{
  const f=fixture();f.add('thr_source',{...threadMetadata(space,'space','saved paths'),secretOfOtherFeature:'leave'});f.add('thr_new',{custom:'keep'});
  const result=await f.inherit('thr_new',continued());assert.equal(result.changed,true);
  assert.deepEqual(f.metadata.get('thr_new'),{custom:'keep',...threadMetadata(space,'space','saved paths'),bindingOrigin:'inherited',inheritedFrom:'thr_source'});assert.equal(f.signals(),1);
  const row=f.rows.get('thr_new')!;const grouped=groupThreads([{id:row.id,projectId:row.projectId,parentThreadId:null,displayTitle:'Continued',updatedAt:1,isPinned:false,isHidden:false,isArchived:false}],[space],{thr_new:result.binding!});
  assert.deepEqual(grouped.spaces[0]!.common.map(n=>n.thread.id),['thr_new']);
  assert.equal((await f.inherit('thr_new',continued())).changed,false);assert.deepEqual(f.writes,['thr_new']);
});
test('repair reads only the first user turn and ignores later Continue from messages',async()=>{
  const f=fixture();f.add('thr_source',threadMetadata(space,'space','paths'));f.add('thr_old');
  f.events.set('thr_old',[{type:'client/turn/requested',data:{initiator:'user',input:continued()}}]);
  assert.equal((await f.inherit('thr_old')).binding?.scope,'space');
  f.add('thr_regular');f.events.set('thr_regular',[{type:'client/turn/requested',data:{initiator:'user',input:[{type:'text',text:'Independent task',mentions:[]}]}}]);
  assert.equal((await f.inherit('thr_regular',continued())).changed,false);
});
test('explicit project/outside placement and removed or incompatible spaces are preserved',async()=>{
  const f=fixture();f.add('thr_source',threadMetadata(space,'space','paths'));
  for(const own of [{spaceId:null,threadScope:'project'},{spaceId:space.id,threadScope:'project'}]){
    f.add('thr_new',own);assert.equal((await f.inherit('thr_new',continued())).changed,false);assert.deepEqual(f.metadata.get('thr_new'),own);
  }
  f.add('thr_new',{}, {projectId:'other'});assert.equal((await f.inherit('thr_new',continued())).changed,false);
  f.add('thr_new');f.metadata.set('thr_source',{spaceId:'removed',threadScope:'space'});assert.equal((await f.inherit('thr_new',continued())).changed,false);
  assert.deepEqual(f.writes,[]);
});
test('native forks and delegated children inherit through native links without reading prompts',async()=>{
  const f=fixture();f.add('thr_source',threadMetadata(space,'space','paths'));
  f.add('thr_fork',{}, {sourceThreadId:'thr_source'});f.add('thr_child',{}, {parentThreadId:'thr_fork'});
  assert.equal((await f.inherit('thr_fork')).binding?.scope,'space');assert.equal((await f.inherit('thr_child')).binding?.scope,'space');assert.deepEqual(f.eventReads,[]);
  f.add('thr_outside',{spaceId:null,threadScope:'project'});f.add('thr_copy',{}, {sourceThreadId:'thr_outside'});
  assert.deepEqual((await f.inherit('thr_copy')).binding,{spaceId:null,scope:'project'});
});
test('Continue from replaces only a launch default; explicit moves remain authoritative',async()=>{
  const f=fixture();f.add('thr_source',threadMetadata(space,'space','source context'));
  f.add('thr_default',threadMetadata(space,'project','wrong default'));
  assert.equal((await f.inherit('thr_default',continued(),{replaceLaunch:true})).binding?.scope,'space');
  f.add('thr_moved',threadMetadata(space,'project','chosen project','transfer'));
  assert.equal((await f.inherit('thr_moved',continued(),{replaceLaunch:true})).changed,false);
  assert.equal(f.metadata.get('thr_moved')!.workspaceMap,'chosen project');
  f.add('thr_outside',{spaceId:null,threadScope:'project',bindingOrigin:'transfer'});
  f.add('thr_default',threadMetadata(space,'project','must be removed'));
  assert.equal((await f.inherit('thr_default',continued('thr_outside'),{replaceLaunch:true})).binding?.spaceId,null);
  assert.equal(f.metadata.get('thr_default')!.spaceSnapshot,undefined);assert.equal(f.metadata.get('thr_default')!.workspaceMap,undefined);
});
test('an explicit repair can correct the old project default using only the original first turn',async()=>{
  const f=fixture();f.add('thr_source',threadMetadata(space,'space','source context'));
  f.add('thr_old',{spaceId:space.id,threadScope:'project',workspaceMap:'old default'});
  f.events.set('thr_old',[{type:'client/turn/requested',data:{initiator:'user',input:continued()}}]);
  assert.equal((await f.inherit('thr_old')).changed,false);
  assert.equal((await f.inherit('thr_old',undefined,{replaceExisting:true})).binding?.scope,'space');
  assert.equal(f.metadata.get('thr_old')!.workspaceMap,'source context');
});
test('cycles terminate and a move while source metadata loads wins over inheritance',async()=>{
  const f=fixture();f.add('thr_one',{}, {sourceThreadId:'thr_two'});f.add('thr_two',{}, {parentThreadId:'thr_one'});
  assert.equal((await f.inherit('thr_one')).changed,false);
  f.add('thr_source',threadMetadata(space,'space','paths'));f.add('thr_new');
  const read=f.threads.getPluginMetadata;
  f.threads.getPluginMetadata=async args=>{if(args.threadId==='thr_source')f.metadata.set('thr_new',{spaceId:null,threadScope:'project'});return read(args);};
  assert.equal((await f.inherit('thr_new',continued())).changed,false);assert.deepEqual(f.writes,[]);
});
test('dispatch hook persists the inherited binding before agent configuration and supplies both tools',async()=>{
  const f=fixture();f.add('thr_source',threadMetadata(space,'space','paths'));f.add('thr_new',threadMetadata(space,'project','default project context'));
  const {bb,harness}=createFakePluginHost({pluginId:'project-spaces',agentSkillIds:['project-spaces'],sdk:{threads:f.threads,projects:{list:async()=>[{id:'api',name:'API',gitRemoteUrl:null,sources:[]}]}}});
  try{
    await plugin(bb);await harness.behavior.callRpc('save',{space,revision:0});
    const ctx=makeMessageDispatchHookContext({thread:{id:'thr_new',sourceThreadId:null,parentThreadId:null},initiator:'user',input:{blocks:continued(),text:'Continue from @thread:thr_source\nпроверь'}});
    assert.deepEqual(await harness.inspection.registrations.hooks['message.dispatch']!(ctx),{action:'proceed'});
    const config=await harness.behavior.resolveAgentConfiguration(makePluginAgentConfigurationContext({thread:{id:'thr_new'},project:{id:'api'},pluginMetadata:f.metadata.get('thr_new')!}));
    assert.match(config.instructions,/shared workspace thread/);assert.equal(config.tools.length,2);
    const binding=await harness.behavior.callRpc('thread_bindings',{threadIds:['thr_new']});
    assert.deepEqual(binding,{bindings:[{threadId:'thr_new',spaceId:space.id,scope:'space'}]});
    assert.equal(f.metadata.get('thr_new')!.threadScope,'space');
  }finally{await harness.lifecycle.dispose();}
});
