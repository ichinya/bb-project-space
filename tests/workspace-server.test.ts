import test from 'node:test';
import assert from 'node:assert/strict';
import { createFakePluginHost,makePluginAgentConfigurationContext } from '@get-bb/plugin-sdk/testing';
import plugin from '../server.ts';
import type { Space } from '../model.ts';

test('agent integration binds the current space group to the actual environment host and rejects write tools',async()=>{
  const space:Space={id:'5d8b342e-3fbd-4c77-9564-725c77466c97',name:'Space',projectIds:['p'],primaryProjectId:'p',folders:[],contextGroup:'group-a',instructions:''};
  const {bb,harness}=createFakePluginHost({pluginId:'project-spaces',agentSkillIds:['project-spaces'],sdk:{
    projects:{list:async()=>[{id:'p',name:'Project',gitRemoteUrl:null,sources:[{type:'local_path',hostId:'source-host',path:'D:\\source'}]}]},
    threads:{getPluginMetadata:async()=>({spaceSnapshot:space}),get:async()=>({environmentId:'env'})},
    environments:{get:async()=>({path:'/worktrees/feature',hostId:'actual-host'})},
  },experimental_callHostRpc:async call=>call.method==='mcp'?{tools:[{name:'workspace_context'},{name:'project_file_write'}]}:{installedVersion:'1.5.0',binary:'ai-workspace',managed:false,latestVersion:'1.7.0',releaseUrl:'https://github.com/lee-to/ai-workspace/releases/tag/v1.7.0',checkedAt:1,updateAvailable:true,supported:true,error:null}});
  try {
    await plugin(bb);await harness.behavior.callRpc('save',{space,revision:0});
    await harness.behavior.callRpc('workspace_software',{hostId:'other-host',checkLatest:true});
    let softwareCall=harness.inspection.experimental_hostRpcCalls.at(-1)!;assert.equal(softwareCall.hostId,'other-host');assert.equal(softwareCall.method,'software');assert.deepEqual(softwareCall.input,{checkLatest:true});
    await harness.behavior.callRpc('workspace_install',{hostId:'other-host'});softwareCall=harness.inspection.experimental_hostRpcCalls.at(-1)!;assert.equal(softwareCall.hostId,'other-host');assert.equal(softwareCall.method,'install');
    const context=makePluginAgentConfigurationContext({project:{id:'p'},pluginMetadata:{spaceSnapshot:space}});
    const configuration=await harness.behavior.resolveAgentConfiguration(context);
    assert.ok(configuration.tools.some(tool=>tool.name==='project_spaces_workspace'));
    await harness.behavior.callRpc('save',{space:{...space,contextGroup:'group-b'},revision:1});
    const result=await harness.behavior.callAgentTool('project_spaces_workspace',{operation:'list_tools'},{threadId:'thread',projectId:'p'});
    const call=harness.inspection.experimental_hostRpcCalls.at(-1)!;
    assert.equal(call.hostId,'actual-host');assert.deepEqual(call.input,{group:'group-b',cwd:'/worktrees/feature',method:'tools/list',arguments:{}});
    assert.match(JSON.stringify(result),/workspace_context/);assert.doesNotMatch(JSON.stringify(result),/project_file_write/);
    await assert.rejects(()=>harness.behavior.callAgentTool('project_spaces_workspace',{operation:'call',tool:'project_file_write',arguments:{}},{threadId:'thread',projectId:'p'}),/инструмент чтения/);
    await assert.rejects(()=>harness.behavior.callRpc('workspace_sync',{id:space.id,hostId:'source-host',revision:0}),/Настройки изменились/);
    await harness.behavior.callRpc('remove',{id:space.id,revision:2});
    const removed=await harness.behavior.resolveAgentConfiguration(context);assert.equal(removed.tools.length,0);
    await assert.rejects(()=>harness.behavior.callAgentTool('project_spaces_workspace',{operation:'context'},{threadId:'thread',projectId:'p'}),/Пространство недоступно/);
  }finally{await harness.lifecycle.dispose();}
});
