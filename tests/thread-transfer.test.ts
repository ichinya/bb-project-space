import test from 'node:test';
import assert from 'node:assert/strict';
import type { PluginBbSdk } from '@get-bb/plugin-sdk';
import { makeThreadTransfer } from '../thread-transfer.ts';
import { groupThreads,readThreadBinding } from '../threads.ts';
import type { Space,Project } from '../model.ts';

const space:Space={id:'1a3a9440-ab6a-4429-838d-b532e3382df2',name:'Platform',projectIds:['api'],primaryProjectId:'api',folders:[],instructions:'Use platform contracts.',contextGroup:'platform'};
const projects:Project[]=[{id:'api',name:'API',sources:[{hostId:'windows',path:'D:\\api'}]}];
type Thread=Awaited<ReturnType<PluginBbSdk['threads']['get']>>;
type Metadata=Awaited<ReturnType<PluginBbSdk['threads']['getPluginMetadata']>>;
type ForkArgs=Parameters<PluginBbSdk['threads']['fork']>[0];
function fixture(){
  const rows=new Map<string,Thread>();
  const metadata=new Map<string,Metadata>();
  const writes:string[]=[],forks:ForkArgs[]=[];const failures=new Set<string>();let signals=0;
  const add=(id:string,patch:Partial<Thread>={},data:Metadata={})=>{
    rows.set(id,{id,projectId:'api',title:'Task',titleFallback:null,parentThreadId:null,environmentId:'env',status:'idle',...patch} as Thread);
    metadata.set(id,structuredClone(data));
  };
  const sdk={threads:{
    async get({threadId}:{threadId:string}){const row=rows.get(threadId);if(!row)throw new Error('missing');return row;},
    async getPluginMetadata({threadId}:{threadId:string}){return structuredClone(metadata.get(threadId)??{});},
    async experimental_listDescendants({threadIds}:{threadIds:readonly string[]}){
      return {threads:threadIds.map(threadId=>{
        const all=new Set([threadId]);for(let n=0;n<rows.size;n++)for(const row of rows.values())if(row.parentThreadId&&all.has(row.parentThreadId))all.add(row.id);
        all.delete(threadId);return {threadId,descendantIds:[...all]};
      })};
    },
    async updatePluginMetadata({threadId,set,remove=[]}:{threadId:string;set:Metadata;remove?:string[]}){
      if(failures.has(threadId))throw new Error('write failed');
      writes.push(threadId);const next={...metadata.get(threadId),...set};for(const key of remove)delete next[key];metadata.set(threadId,next);return next;
    },
    async fork(args:ForkArgs){
      if(failures.has(args.sourceThreadId))throw new Error('fork failed');
      forks.push(args);const id=`copy-${forks.length}`;add(id,{sourceThreadId:args.sourceThreadId},args.pluginMetadata);return rows.get(id)!;
    },
  },environments:{async get(){return {id:'env',hostId:'windows',path:'D:\\worktrees\\api-task'};}}} as unknown as Pick<PluginBbSdk,'threads'|'environments'>;
  const spaces=[space];const transfer=makeThreadTransfer(sdk,()=>spaces,async()=>projects,()=>{signals++;});
  return {add,rows,metadata,writes,forks,failures,spaces,transfer,signals:()=>signals};
}

test('moving an existing family preserves IDs and extra metadata and uses the actual worktree',async()=>{
  const f=fixture();f.add('root',{}, {custom:'keep'});f.add('child',{parentThreadId:'root'});f.add('other');
  const result=await f.transfer({threadIds:['root','root'],spaceId:space.id,mode:'move'});
  assert.deepEqual(result.results,[{sourceThreadId:'root',threadId:'root'}]);
  assert.deepEqual(f.writes,['root','child']);assert.equal(f.forks.length,0);assert.equal(f.metadata.get('root')!.custom,'keep');
  for(const id of ['root','child'])assert.deepEqual(readThreadBinding(f.metadata.get(id)),{spaceId:space.id,scope:'project'});
  assert.match(String(f.metadata.get('root')!.workspaceMap),/worktrees/);assert.equal(f.metadata.get('other')!.spaceId,undefined);
  assert.equal(f.rows.get('child')!.parentThreadId,'root');assert.equal(f.signals(),1);
});

test('copy uses native history fork without a prompt, preserves source, and reuses environment',async()=>{
  const f=fixture();const source={spaceId:'old-space',threadScope:'space',custom:'keep'};f.add('source',{},source);f.add('child',{parentThreadId:'source'});
  const result=await f.transfer({threadIds:['source'],spaceId:space.id,mode:'copy'});
  assert.deepEqual(result.results,[{sourceThreadId:'source',threadId:'copy-1'}]);assert.deepEqual(f.metadata.get('source'),source);
  assert.equal(f.forks.length,1);assert.equal(f.writes.length,0);const request=f.forks[0]!;
  assert.equal(request.sourceThreadId,'source');assert.equal(request.input,undefined);assert.equal(request.lifecycleOwnerThreadId,undefined);
  assert.deepEqual(request.environment,{type:'reuse',environmentId:'env'});assert.equal(request.title,'Task (копия)');
  assert.equal(request.pluginMetadata!.custom,'keep');assert.equal(request.pluginMetadata!.spaceId,space.id);
});

test('moving outside removes workspace instructions but keeps an explicit outside placement',async()=>{
  const f=fixture();f.add('root',{}, {spaceId:space.id,spaceSnapshot:space,workspaceMap:'old map',custom:1});
  await f.transfer({threadIds:['root'],spaceId:null,mode:'move'});
  assert.deepEqual(f.metadata.get('root'),{spaceId:null,threadScope:'project',bindingOrigin:'transfer',custom:1});
  assert.deepEqual(readThreadBinding(f.metadata.get('root')),{spaceId:null,scope:'project'});
});

test('destination and all descendant project memberships are checked before any writes',async()=>{
  const f=fixture();f.add('root');f.add('child',{parentThreadId:'root',projectId:'web'});
  await assert.rejects(()=>f.transfer({threadIds:['root'],spaceId:space.id,mode:'move'}),/не входит/);
  assert.equal(f.writes.length,0);assert.equal(f.forks.length,0);
  await assert.rejects(()=>f.transfer({threadIds:['root'],spaceId:'1a3a9440-ab6a-4429-838d-b532e3382df3',mode:'copy'}),/больше не существует/);
  assert.equal(f.forks.length,0);
  await f.transfer({threadIds:['root'],spaceId:null,mode:'move'});
  assert.deepEqual(f.writes,['root','child']);
});

test('partial family failure is retryable and reports the failed child',async()=>{
  const f=fixture();f.add('root');f.add('child',{parentThreadId:'root'});f.failures.add('child');
  const first=await f.transfer({threadIds:['root'],spaceId:space.id,mode:'move'});
  assert.match(first.results[0]!.error!,/child: write failed/);assert.equal(first.results[0]!.threadId,undefined);
  f.failures.clear();const retry=await f.transfer({threadIds:['root'],spaceId:space.id,mode:'move'});
  assert.equal(retry.results[0]!.threadId,'root');assert.equal(f.metadata.get('child')!.spaceId,space.id);
});

test('partial copy returns individual successes so retries can exclude them',async()=>{
  const f=fixture();f.add('one');f.add('two');f.failures.add('two');
  const result=await f.transfer({threadIds:['one','two'],spaceId:space.id,mode:'copy'});
  assert.equal(result.results[0]!.threadId,'copy-1');assert.match(result.results[1]!.error!,/fork failed/);
  f.failures.clear();await f.transfer({threadIds:result.results.filter(r=>r.error).map(r=>r.sourceThreadId),spaceId:space.id,mode:'copy'});
  assert.deepEqual(f.forks.map(r=>r.sourceThreadId),['one','two']);
});

test('copying outside clears source workspace context from the copied namespace only',async()=>{
  const f=fixture();f.add('root',{}, {spaceId:space.id,spaceSnapshot:space,workspaceMap:'context'});
  await f.transfer({threadIds:['root'],spaceId:null,mode:'copy'});
  assert.equal(f.forks[0]!.pluginMetadata!.spaceId,null);assert.equal(f.forks[0]!.pluginMetadata!.spaceSnapshot,undefined);
  assert.equal(f.metadata.get('root')!.workspaceMap,'context');
});

test('concurrent copies are rejected before the first metadata read and locks release after completion',async()=>{
  let unblock!:()=>void;const gate=new Promise<void>(resolve=>{unblock=resolve;});let forks=0;
  const sdk={threads:{
    async get(){await gate;return {id:'root',projectId:'api',title:'Task',environmentId:null};},
    async getPluginMetadata(){return {};},
    async fork(){forks++;return {id:'copy'};},
  }} as unknown as Pick<PluginBbSdk,'threads'|'environments'>;
  const transfer=makeThreadTransfer(sdk,()=>[space],async()=>projects,()=>{});
  const first=transfer({threadIds:['root'],spaceId:space.id,mode:'copy'});
  await assert.rejects(()=>transfer({threadIds:['root'],spaceId:space.id,mode:'copy'}),/уже переносятся/);
  unblock();await first;assert.equal(forks,1);
  await transfer({threadIds:['root'],spaceId:space.id,mode:'copy'});assert.equal(forks,2);
});

test('a moved child is displayed in its destination without changing its native parent',()=>{
  const f=fixture();f.add('parent');f.add('child',{parentThreadId:'parent'});f.add('grandchild',{parentThreadId:'child'});
  const input=[...f.rows.values()].map(row=>({...row,displayTitle:'task',updatedAt:1,isPinned:false,isHidden:false,isArchived:false}));
  const result=groupThreads(input,[space],{child:{spaceId:space.id,scope:'project'}});
  assert.deepEqual(result.loose.map(n=>n.thread.id),['parent']);
  assert.equal(result.spaces[0]!.projects[0]!.threads[0]!.thread.id,'child');
  assert.equal(result.spaces[0]!.projects[0]!.threads[0]!.children[0]!.thread.id,'grandchild');
  const outside=groupThreads(input,[space],{parent:{spaceId:space.id,scope:'project'},child:{spaceId:null,scope:'project'}});
  assert.deepEqual(outside.loose.map(n=>n.thread.id),['child']);
  const sameOutside=groupThreads(input,[space],{child:{spaceId:null,scope:'project'}});
  assert.equal(sameOutside.loose.length,1);assert.equal(sameOutside.loose[0]!.children[0]!.thread.id,'child');
});
