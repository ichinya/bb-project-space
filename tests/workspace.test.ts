import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { workspaceRoots } from '../workspace-model.ts';
import { inspectWorkspace,synchronizeWorkspace } from '../workspace-host.ts';
import { workspaceCommand,workspaceMcp,mcpJson } from '../workspace-process.ts';
import type { Space } from '../model.ts';

test('workspace folders are host-specific and duplicate source/reference paths are initialized once',()=>{
  const space:Space={id:'5d8b342e-3fbd-4c77-9564-725c77466c97',name:'Test',projectIds:['p'],primaryProjectId:'p',instructions:'',contextGroup:'test',folders:[{hostId:'win',path:'d:/PROJECT/'},{hostId:'linux',path:'/srv/extra'}]};
  const projects=[{id:'p',name:'Project',sources:[{hostId:'win',path:'D:\\project\\'},{hostId:'linux',path:'/srv/project'}]}];
  assert.equal(workspaceRoots(space,projects,'win').length,1);
  assert.deepEqual(workspaceRoots(space,projects,'linux').map(r=>r.path),['/srv/project','/srv/extra']);
  assert.deepEqual(workspaceRoots(space,projects,'offline'),[]);
  assert.deepEqual(workspaceRoots({...space,folders:[{hostId:'linux',path:'/srv/Project'}]},projects,'linux').map(r=>r.path),['/srv/project','/srv/Project']);
});

test('real CLI initializes, merges configs, scopes MCP, preserves other groups and reconciles removed folders',{skip:process.env.RUN_WORKSPACE_INTEGRATION!=='1',timeout:120000},async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'project-spaces-workspace-'));
  const a=path.join(root,'alpha'),b=path.join(root,'beta'),data=path.join(root,'host-data');
  await fs.mkdir(a);await fs.mkdir(b);await fs.mkdir(data);
  await fs.writeFile(path.join(a,'README.md'),'# Alpha\nShared context.');await fs.writeFile(path.join(b,'README.md'),'# Beta');
  const options={cwd:a,env:{AI_WORKSPACE_DB:path.join(root,'isolated.db')}};
  const id='5d8b342e-3fbd-4c77-9564-725c77466c97',second='f06eb5c9-402c-42f5-af8e-e61a21262b02';
  const request={spaceId:id,group:'space-group',roots:[{path:a,name:'Alpha'},{path:b,name:'Beta'}]};
  try {
    await workspaceCommand(['init','--group=manual'],options);await workspaceCommand(['export'],options);
    const original=JSON.parse(await fs.readFile(path.join(a,'.ai-workspace.json'),'utf8'));
    const unsupported=JSON.stringify({...original,custom:{keep:true}});await fs.writeFile(path.join(a,'.ai-workspace.json'),unsupported);
    const rejected=await synchronizeWorkspace(request,data,options);assert.ok(rejected.results.some(r=>!r.ok&&r.path===a));assert.equal(await fs.readFile(path.join(a,'.ai-workspace.json'),'utf8'),unsupported);
    await fs.writeFile(path.join(a,'.ai-workspace.json'),JSON.stringify(original));
    const result=await synchronizeWorkspace(request,data,options);
    assert.deepEqual(result.results.filter(r=>!r.ok),[],JSON.stringify(result.results));assert.equal(result.status.available,true);assert.equal(result.status.folders.length,2);
    for(const folder of result.status.folders){assert.equal(folder.initialized,true);assert.ok(folder.groups.includes('space-group'));assert.ok(folder.configGroups.includes('space-group'));}
    let config=JSON.parse(await fs.readFile(path.join(a,'.ai-workspace.json'),'utf8'));assert.equal(config.name,original.name);assert.equal(config.slug,original.slug);assert.ok(config.groups.includes('manual'));assert.deepEqual(config.share,original.share);
    const context=mcpJson(await workspaceMcp('tools/call',{name:'workspace_context',arguments:{}},options,'space-group')) as {groups:{name:string}[];projects:{name:string;groups:string[]}[]};
    assert.deepEqual(context.groups.map(g=>g.name),['space-group']);assert.equal(context.projects.length,2);assert.ok(context.projects.every(p=>p.groups.every(g=>g==='space-group')));
    const tools=await workspaceMcp('tools/list',{},options,'space-group') as {tools:{name:string}[]};assert.ok(!tools.tools.some(t=>t.name==='project_file_write'));
    const repeat=await synchronizeWorkspace(request,data,options);assert.ok(repeat.results.every(r=>r.ok));
    // A second space using the same group owns its membership independently.
    await synchronizeWorkspace({...request,spaceId:second},data,options);
    const reduced={...request,roots:[{path:b,name:'Beta'}]};
    await synchronizeWorkspace(reduced,data,options);
    assert.ok(JSON.parse(await fs.readFile(path.join(a,'.ai-workspace.json'),'utf8')).groups.includes('space-group'));
    await synchronizeWorkspace({...reduced,spaceId:second},data,options);
    config=JSON.parse(await fs.readFile(path.join(a,'.ai-workspace.json'),'utf8'));assert.deepEqual(config.groups,['manual']);assert.deepEqual(config.share,original.share);
    // Failed additions preserve the previous healthy group's membership.
    const failed=await synchronizeWorkspace({...reduced,group:'new-group',roots:[{path:path.join(root,'missing'),name:'Missing'}]},data,options);
    assert.ok(failed.results.some(r=>!r.ok));assert.ok(JSON.parse(await fs.readFile(path.join(b,'.ai-workspace.json'),'utf8')).groups.includes('space-group'));
    const changed=await synchronizeWorkspace({...reduced,group:'new-group'},data,options);assert.ok(changed.results.every(r=>r.ok));
    const status=await inspectWorkspace({...reduced,group:'new-group'},options);assert.ok(status.folders[0]!.groups.includes('new-group'));
    assert.equal(await fs.readFile(path.join(a,'README.md'),'utf8'),'# Alpha\nShared context.');
  }finally{await fs.rm(root,{recursive:true,force:true});}
});
