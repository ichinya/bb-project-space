import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { repowiseLayout,repowiseCalls,synchronizeRepowise,queryRepowise,guardRepowisePaths,inspectRepowise } from '../repowise-host.ts';
import { repowiseQuery } from '../repowise-contract.ts';
import { contextRoots,contextSpace } from '../space-context.ts';
import type { Space } from '../model.ts';
import { repowiseEnvironment } from '../repowise-process.ts';
import { checkoutFingerprints } from '../repowise-freshness.ts';
const space:Space={id:'1a3a9440-ab6a-4429-838d-b532e3382df2',name:'Platform',projectIds:['api','web'],primaryProjectId:'api',folders:[],instructions:'',contextGroup:'platform'};
test('Git ownership exceptions are per-process, preserve existing overrides and list exact roots',()=>{
  const env=repowiseEnvironment({cwd:'/plugin',safePaths:['D:\\api','D:\\web'],env:{GIT_CONFIG_COUNT:'1',GIT_CONFIG_KEY_0:'core.longpaths',GIT_CONFIG_VALUE_0:'true'}});
  assert.equal(env.GIT_CONFIG_COUNT,'3');assert.equal(env.GIT_CONFIG_KEY_0,'core.longpaths');assert.equal(env.GIT_CONFIG_KEY_1,'safe.directory');assert.equal(env.GIT_CONFIG_VALUE_1,'D:/api');assert.equal(env.GIT_CONFIG_VALUE_2,'D:/web');assert.notEqual(env.GIT_CONFIG_VALUE_1,'*');
});
test('repo=all uses native federation where supported and labelled fan-out otherwise',()=>{
  assert.deepEqual(repowiseCalls(repowiseQuery.parse({operation:'call',tool:'get_context',arguments:{targets:['routes.py'],repo:'/outside'}}),['api','web']).map(c=>c.params),[
    {name:'get_context',arguments:{targets:['routes.py'],repo:'api'}},{name:'get_context',arguments:{targets:['routes.py'],repo:'web'}},
  ]);
  assert.equal(repowiseCalls(repowiseQuery.parse({operation:'call',tool:'search_codebase',arguments:{query:'users'}}),['api','web'])[0]!.params.arguments!.repo,'all');
  assert.throws(()=>repowiseCalls(repowiseQuery.parse({operation:'call',tool:'get_context',repo:'/outside'}),['api']),/не входит/);
  assert.throws(()=>repowiseQuery.parse({operation:'call',tool:'generate_refactoring_code'}));
});
test('actual worktree replaces only its own project and appears first; explicit space bindings win',()=>{
  const projects=[{id:'api',name:'API',sources:[{hostId:'h',path:'/api'}]},{id:'web',name:'Web',sources:[{hostId:'h',path:'/web'}]}];
  assert.deepEqual(contextRoots(space,projects,'h','web','/worktrees/web').map(r=>r.path),['/worktrees/web','/api']);
  assert.equal(contextSpace([space],{},'api').id,space.id);
  assert.throws(()=>contextSpace([space],{spaceId:null},'api'),/вне пространств/);
  const other={...space,id:'1a3a9440-ab6a-4429-838d-b532e3382df3'};
  assert.throws(()=>contextSpace([space,other],{},'api'),/Выберите spaceId/);
  assert.throws(()=>contextSpace([space,other],{spaceId:space.id},'api',other.id),/другому/);
});
test('workspace layouts are shared by the same checkout set, bounded to plugin data and collision-free',()=>{
  const data=path.resolve('fixture-data');const roots=[{name:'Same',path:path.resolve('api')},{name:'Same',path:path.resolve('web')}];
  const first=repowiseLayout({spaceId:space.id,name:space.name,roots},data);
  assert.notEqual(first.roots[0]!.alias,first.roots[1]!.alias);assert.ok(first.directory.startsWith(data+path.sep));
  assert.equal(first.directory,repowiseLayout({spaceId:space.id,name:'Renamed space',roots},data).directory);
  assert.notEqual(first.directory,repowiseLayout({spaceId:space.id,name:space.name,roots:[{...roots[0]!,path:path.resolve('worktree')},roots[1]!] },data).directory);
});
test('absolute and traversal targets cannot bypass the selected repo scope',()=>{
  guardRepowisePaths({targets:['src/main.rs','Handler.process','module:api','D:\\api\\src\\main.rs']},[{path:'D:\\api'}]);
  assert.throws(()=>guardRepowisePaths({targets:['D:\\api-other\\secret']},[{path:'D:\\api'}]),/не входит/);
  assert.throws(()=>guardRepowisePaths({scope:'../outside'},[{path:'/api'}]),/границы/);
});
test('an unavailable folder does not prevent checking the other selected folders',async()=>{
  const temp=await fs.mkdtemp(path.join(os.tmpdir(),'project-spaces-repowise-missing-'));
  try{
    const request={spaceId:space.id,name:space.name,roots:[{name:'Missing A',path:path.join(temp,'a')},{name:'Missing B',path:path.join(temp,'b')}]};
    await assert.rejects(()=>synchronizeRepowise(request,temp,{cwd:temp}),/Missing A:[\s\S]*Missing B:/);
    const state=JSON.parse(await fs.readFile(path.join(repowiseLayout(request,temp).directory,'state.json'),'utf8'));
    assert.equal(Object.keys(state.roots).length,2);assert.equal(state.updatedAt,undefined);
  }finally{assert.ok(path.resolve(temp).startsWith(path.resolve(os.tmpdir())+path.sep));await fs.rm(temp,{recursive:true,force:true});}
});

test('old prepared indexes require a freshness baseline; changed evidence is rejected before MCP starts',async()=>{
  const temp=await fs.mkdtemp(path.join(os.tmpdir(),'ps-stale-index-'));
  try{
    const root=path.join(temp,'plain');await fs.mkdir(path.join(root,'.repowise'),{recursive:true});await fs.writeFile(path.join(root,'.repowise','wiki.db'),'fixture');await fs.writeFile(path.join(root,'.repowise','state.json'),'{}');await fs.writeFile(path.join(root,'code.ts'),'one');
    const request={spaceId:space.id,name:'Fixture',roots:[{name:'Plain',path:root}]},layout=repowiseLayout(request,path.join(temp,'data')),options={cwd:temp,binary:process.execPath};await fs.mkdir(layout.directory,{recursive:true});
    const stateFile=path.join(layout.directory,'state.json');await fs.writeFile(stateFile,JSON.stringify({updatedAt:1}));
    await fs.writeFile(path.join(layout.directory,'.repowise-workspace.yaml'),JSON.stringify(layout.manifest));
    assert.equal((await inspectRepowise(request,path.join(temp,'data'),options)).stale,true);
    await fs.writeFile(stateFile,JSON.stringify({updatedAt:1,fingerprints:await checkoutFingerprints(layout.roots)}));
    assert.equal((await inspectRepowise(request,path.join(temp,'data'),options)).stale,false);
    await fs.writeFile(path.join(root,'code.ts'),'two');await fs.utimes(path.join(root,'code.ts'),new Date(),new Date(Date.now()+2000));
    await assert.rejects(()=>queryRepowise(request,{operation:'call',repo:'all',tool:'get_context'},path.join(temp,'data'),options),/operation=prepare/);
    const unknown=await inspectRepowise(request,path.join(temp,'data'),{...options,env:{PATH:temp}});assert.equal(unknown.stale,false);assert.match(unknown.freshnessWarning!,/не подтверждена/);
  }finally{assert.ok(temp.startsWith(os.tmpdir()+path.sep));await fs.rm(temp,{recursive:true,force:true});}
});

test('workspace timeout preserves usable indexes, last success and stage, then recovers in one pass',async()=>{
  const temp=await fs.mkdtemp(path.join(os.tmpdir(),'ps-repowise-retry-'));
  try{
    const root=path.join(temp,'repo'),index=path.join(root,'.repowise'),data=path.join(temp,'data');
    await fs.mkdir(index,{recursive:true});
    execFileSync('git',['-C',root,'init','--quiet'],{windowsHide:true});
    await fs.writeFile(path.join(index,'wiki.db'),'fixture');
    await fs.writeFile(path.join(index,'state.json'),'{}');
    const request={spaceId:space.id,name:'Retry',roots:[{name:'Repo',path:root}]};
    const layout=repowiseLayout(request,data),stateFile=path.join(layout.directory,'state.json');
    await fs.mkdir(layout.directory,{recursive:true});
    await fs.writeFile(path.join(layout.directory,'.repowise-workspace.yaml'),JSON.stringify(layout.manifest));
    const before=await checkoutFingerprints(layout.roots);
    await fs.writeFile(stateFile,JSON.stringify({updatedAt:1,fingerprints:before}));
    await fs.writeFile(path.join(root,'changed.ts'),'export const changed = 1;');
    const calls=path.join(temp,'commands.jsonl');
    // Node runs these fixture files when the bridge invokes the named command.
    await fs.writeFile(path.join(layout.directory,'workspace'),`
      require('node:fs').appendFileSync(process.env.REPOWISE_TEST_CALLS,JSON.stringify(process.argv.slice(2))+'\\n');
      console.log('Updating ${layout.roots[0]!.alias}...');
      if(process.env.REPOWISE_TEST_TIMEOUT==='1')setInterval(()=>{},1000);
    `);
    await fs.writeFile(path.join(layout.directory,'mcp'),`
      require('node:readline').createInterface({input:process.stdin}).on('line',line=>{
        const call=JSON.parse(line);
        if(call.id)console.log(JSON.stringify({jsonrpc:'2.0',id:call.id,result:call.id===1?{}:{content:[{type:'text',text:'{"answer":"saved"}'}]}}));
      });
    `);
    const options={cwd:temp,binary:process.execPath,timeoutMs:1000,env:{REPOWISE_TEST_CALLS:calls}};
    await assert.rejects(()=>synchronizeRepowise(request,data,{...options,env:{...options.env,REPOWISE_TEST_TIMEOUT:'1'}}),/Обновление пространства Repowise[\s\S]*лимит/);
    const saved=JSON.parse(await fs.readFile(stateFile,'utf8'));
    assert.deepEqual(saved.fingerprints,before);
    assert.match(saved.stage.progress,/Updating repo-/);
    const status=await inspectRepowise(request,data,options);
    assert.equal(status.prepared,true);assert.equal(status.updatedAt,1);assert.equal(status.stale,true);
    const overview=await queryRepowise(request,{operation:'call',repo:'all',tool:'get_overview'},data,options);
    assert.match(JSON.stringify(overview),/"stale":true.+"answer":"saved"/);
    const result=await synchronizeRepowise(request,data,options);
    assert.equal(result.prepared,true);assert.equal(result.stale,false);assert.equal(result.error,null);
    const commands=(await fs.readFile(calls,'utf8')).trim().split('\n').map(line=>JSON.parse(line));
    assert.deepEqual(commands,[['update','--index-only','--no-agents','--working-tree'],['update','--index-only','--no-agents','--working-tree']]);
    await fs.writeFile(path.join(root,'.ai-workspace.json'),'{}');
    const unchanged=await synchronizeRepowise(request,data,options);
    assert.equal(unchanged.updatedAt,result.updatedAt);
    await fs.writeFile(stateFile,JSON.stringify({error:'Legacy timeout',roots:{}}));
    const recovered=await inspectRepowise(request,data,options);
    assert.equal(recovered.prepared,true);assert.equal(recovered.stale,true);assert.equal(recovered.updatedAt,null);
    await fs.unlink(path.join(root,'changed.ts'));
    await fs.writeFile(path.join(index,'state.json'),JSON.stringify({working_tree_paths:['.ai-workspace.json']}));
    const migrated=await synchronizeRepowise(request,data,options);
    assert.equal(migrated.stale,false);
    const lastCommand=(await fs.readFile(calls,'utf8')).trim().split('\n').at(-1)!;
    assert.deepEqual(JSON.parse(lastCommand),['update','--index-only','--no-agents']);
  }finally{assert.ok(temp.startsWith(os.tmpdir()+path.sep));await fs.rm(temp,{recursive:true,force:true});}
});
test('real Repowise indexes two repos and a plain folder, federates their context, and installs no editor hooks',{skip:process.env.RUN_REPOWISE_INTEGRATION!=='1',timeout:900000},async()=>{
  const temp=await fs.mkdtemp(path.join(os.tmpdir(),'project-spaces-repowise-'));
  const git=(cwd:string,args:string[])=>execFileSync('git',args,{cwd,windowsHide:true,stdio:'pipe'}).toString();
  try{
    const roots=[];
    for(const [name,file,source] of [
      ['api','routes.py','from fastapi import FastAPI\napp = FastAPI()\n@app.get("/users")\ndef shared_context_marker():\n    return {"ready": True}\n'],
      ['web','client.ts','export async function shared_context_marker() { return fetch("http://api/users"); }\n'],
      ['notes','helper.py','def shared_context_marker():\n    return "plain-folder"\n'],
    ]){
      const directory=path.join(temp,name!);await fs.mkdir(directory);await fs.writeFile(path.join(directory,file!),source!);
      if(name!=='notes'){git(directory,['init','--quiet']);git(directory,['add','.']);git(directory,['-c','user.name=QA','-c','user.email=qa@example.invalid','commit','--quiet','-m','fixture']);}
      roots.push({name:name!,path:directory});
    }
    const request={spaceId:space.id,name:space.name,roots},data=path.join(temp,'data'),options={cwd:temp,timeoutMs:180000};
    const state=await synchronizeRepowise(request,data,options);assert.equal(state.prepared,true,JSON.stringify(state));
    assert.equal(state.stale,false,JSON.stringify(state));assert.equal(state.roots.length,3);
    const discovery=await queryRepowise(request,repowiseQuery.parse({operation:'list_tools',tool:'search_codebase'}),data,options);
    assert.equal((discovery as {tools:{name:string}[]}).tools[0]!.name,'search_codebase');
    const found=await queryRepowise(request,repowiseQuery.parse({operation:'call',tool:'search_codebase',arguments:{query:'shared_context_marker'}}),data,options);
    const text=JSON.stringify(found);assert.match(text,/shared_context_marker/);assert.match(text,/routes.py/);assert.match(text,/client.ts/);assert.match(text,/helper.py/);
    for(const root of roots){assert.equal(await fs.stat(path.join(root.path,'.repowise','wiki.db')).then(()=>true),true);await assert.rejects(fs.stat(path.join(root.path,'AGENTS.md')));}
  }finally{assert.ok(path.resolve(temp).startsWith(path.resolve(os.tmpdir())+path.sep));await fs.rm(temp,{recursive:true,force:true});}
});
