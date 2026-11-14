import test from 'node:test';
import assert from 'node:assert/strict';
import { contextForSpace, validateSpace, spaceSchema, type Space, type Project } from '../model.ts';
const projects:Project[]=[
  {id:'api',name:'API',sources:[{hostId:'windows',path:'D:\\api'},{hostId:'linux',path:'/srv/api'}]},
  {id:'web',name:'Web',sources:[{hostId:'windows',path:'E:\\web'}]},
];
const base:Space={id:'1a3a9440-ab6a-4429-838d-b532e3382df2',name:'Platform',projectIds:['api','web'],primaryProjectId:'api',folders:[],instructions:'Keep contracts compatible.',contextGroup:'platform'};
test('primary must be a selected project',()=>assert.throws(()=>validateSpace({...base,primaryProjectId:'other'},projects),/Основной/));
test('removed projects and duplicate selections fail explicitly',()=>{
  assert.throws(()=>validateSpace({...base,projectIds:['api','gone']},projects),/недоступен/);
  assert.throws(()=>validateSpace({...base,projectIds:['api','api']},projects),/несколько/);
});
test('absolute Windows and Unix paths are accepted, relative and control paths rejected',()=>{
  validateSpace({...base,folders:[{hostId:'windows',path:'D:\\shared'},{hostId:'linux',path:'/srv/shared'}]},projects);
  for(const p of ['../shared','relative','D:\\shared\nother'])assert.throws(()=>validateSpace({...base,folders:[{hostId:'windows',path:p}]},projects));
});
test('Windows folder identity normalizes case and separators',()=>assert.throws(()=>validateSpace({...base,folders:[{hostId:'windows',path:'D:\\Shared'},{hostId:'windows',path:'d:/shared'}]},projects),/несколько/));
test('context never falls back to another host when a project is unavailable',()=>{
  const result=contextForSpace(base,projects,'api','linux');
  assert.deepEqual(result.paths,['/srv/api']);
  assert.match(result.instructions,/"name":"Web","path":null/);
  assert.doesNotMatch(result.instructions,/E:\\\\web/);
  assert.throws(()=>contextForSpace(base,projects,'web','linux'),/недоступна/);
});
test('per-chat main project overrides the space default without mutating it',()=>{
  const result=contextForSpace(base,projects,'web','windows');
  assert.match(result.instructions,/"name":"Web","path":"E:\\\\web","primary":true/);
  assert.equal(base.primaryProjectId,'api');
});
test('folder context is host-specific and does not claim worktree or permission ownership',()=>{
  const result=contextForSpace({...base,folders:[{hostId:'linux',path:'/srv/shared'}]},projects,'api','windows');
  assert.ok(!result.paths.includes('/srv/shared'));
  assert.match(result.instructions,/not additional worktrees or permission grants/);
  assert.match(result.instructions,/actual active environment/);
});
test('invalid IDs, empty names and oversized instructions are rejected at the boundary',()=>{
  for(const patch of [{id:'bad'},{name:' '},{instructions:'x'.repeat(12001)}])assert.equal(spaceSchema.safeParse({...base,...patch}).success,false);
});
