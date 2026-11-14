import test from 'node:test';
import assert from 'node:assert/strict';
import { flattenThreads, groupThreads, readThreadBinding, threadMetadata, type GroupableThread } from '../threads.ts';
import type { Space } from '../model.ts';

const a:Space={id:'1a3a9440-ab6a-4429-838d-b532e3382df2',name:'A',projectIds:['api','web'],primaryProjectId:'api',folders:[],instructions:'',contextGroup:''};
const b:Space={...a,id:'254f3fd0-00d1-49d4-829b-93da22a3b4ce',name:'B'};
const thread=(id:string,patch:Partial<GroupableThread>={}):GroupableThread=>({id,projectId:'api',parentThreadId:null,displayTitle:id,updatedAt:10,isPinned:false,isArchived:false,isHidden:false,...patch});
const allIds=(result:ReturnType<typeof groupThreads>)=>[
  ...flattenThreads(result.pinned),...flattenThreads(result.loose),
  ...result.spaces.flatMap(g=>[...flattenThreads(g.common),...g.projects.flatMap(p=>flattenThreads(p.threads))]),
].map(t=>t.id);

test('common and project threads are separated while legacy chats stay at their project',()=>{
  const result=groupThreads([thread('common'),thread('project'),thread('legacy')],[a],{
    common:{spaceId:a.id,scope:'space'},project:{spaceId:a.id,scope:'project'},
  });
  assert.deepEqual(result.spaces[0]!.common.map(n=>n.thread.id),['common']);
  assert.deepEqual(result.spaces[0]!.projects[0]!.threads.map(n=>n.thread.id),['project']);
  assert.deepEqual(result.loose.map(n=>n.thread.id),['legacy']);
});
test('the same project in two spaces never duplicates a thread',()=>{
  const result=groupThreads([thread('a'),thread('b'),thread('old')],[a,b],{a:{spaceId:a.id,scope:'project'},b:{spaceId:b.id,scope:'project'}});
  assert.deepEqual(result.spaces.map(g=>g.projects[0]!.threads.map(n=>n.thread.id)),[['a'],['b']]);
  const ids=allIds(result);assert.equal(ids.length,3);assert.equal(new Set(ids).size,3);
});
test('visible child families stay under their root with one workspace placement',()=>{
  const result=groupThreads([thread('parent'),thread('child',{parentThreadId:'parent',projectId:'web'}),thread('grandchild',{parentThreadId:'child'})],[a],{parent:{spaceId:a.id,scope:'space'}});
  assert.deepEqual(flattenThreads(result.spaces[0]!.common).map(t=>t.id),['parent','child','grandchild']);
  assert.deepEqual(result.loose,[]);
});
test('hidden or archived parents do not hide otherwise visible children',()=>{
  const result=groupThreads([thread('hidden',{isHidden:true}),thread('archived',{isArchived:true}),thread('child',{parentThreadId:'hidden'}),thread('other',{parentThreadId:'archived'})],[a],{});
  assert.deepEqual(allIds(result).sort(),['child','other']);
});
test('pinned families are shown once; project-page mode keeps them inside their group',()=>{
  const input=[thread('parent'),thread('pinned-child',{parentThreadId:'parent',isPinned:true})];
  const binding={parent:{spaceId:a.id,scope:'space' as const}};
  const sidebar=groupThreads(input,[a],binding);assert.equal(sidebar.pinned.length,1);assert.equal(sidebar.spaces[0]!.common.length,0);
  const page=groupThreads(input,[a],binding,{separatePinned:false});assert.equal(page.pinned.length,0);assert.equal(page.spaces[0]!.common.length,1);
  assert.equal(allIds(sidebar).length,2);assert.equal(allIds(page).length,2);
});
test('removed spaces or removed projects fall back to the original project',()=>{
  const result=groupThreads([thread('removed-space'),thread('removed-project',{projectId:'other'})],[a],{'removed-space':{spaceId:b.id,scope:'space'},'removed-project':{spaceId:a.id,scope:'project'}});
  assert.equal(result.loose.length,2);assert.equal(allIds(result).length,2);
});
test('malformed parent cycles terminate without losing or duplicating threads',()=>{
  const result=groupThreads([thread('one',{parentThreadId:'two'}),thread('two',{parentThreadId:'one'}),thread('self',{parentThreadId:'self'})],[a],{});
  assert.deepEqual(allIds(result).sort(),['one','self','two']);
});
test('search finds a child through its family and archives are opt-in',()=>{
  const input=[thread('parent'),thread('needle',{parentThreadId:'parent'}),thread('archived',{isArchived:true})];
  assert.deepEqual(allIds(groupThreads(input,[a],{},{query:'NEEDLE'})),['parent','needle']);
  assert.ok(allIds(groupThreads(input,[a],{},{includeArchived:true})).includes('archived'));
});
test('0.1 metadata is project-scoped; malformed scope is ignored',()=>{
  assert.deepEqual(readThreadBinding({spaceId:a.id}),{spaceId:a.id,scope:'project'});
  assert.equal(readThreadBinding({spaceId:a.id,threadScope:'unknown'}),null);
  assert.equal(readThreadBinding({spaceId:123}),null);
  assert.equal(readThreadBinding(null),null);
});
test('scope and immutable launch snapshot are seeded together before thread creation',()=>{
  const metadata=threadMetadata(a,'space','repository map');
  assert.deepEqual(readThreadBinding(metadata),{spaceId:a.id,scope:'space'});
  assert.equal(metadata.spaceSnapshot,a);assert.equal(metadata.workspaceMap,'repository map');
});
