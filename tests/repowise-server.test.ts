import test from 'node:test';
import assert from 'node:assert/strict';
import { createFakePluginHost,makePluginAgentConfigurationContext } from '@get-bb/plugin-sdk/testing';
import plugin from '../server.ts';
import type { Space } from '../model.ts';

test('both context tools are supplied by default, scope to one space and use the active host/worktree',async()=>{
  const space:Space={id:'5d8b342e-3fbd-4c77-9564-725c77466c97',name:'Space',projectIds:['api','web'],primaryProjectId:'api',folders:[{hostId:'actual',path:'/docs'}],contextGroup:'group-a',instructions:''};
  let metadata:Record<string,unknown>={};
  const {bb,harness}=createFakePluginHost({pluginId:'project-spaces',agentSkillIds:['project-spaces'],sdk:{
    projects:{list:async()=>[
      {id:'api',name:'API',gitRemoteUrl:null,sources:[{type:'local_path',hostId:'actual',path:'/api'}]},
      {id:'web',name:'Web',gitRemoteUrl:null,sources:[{type:'local_path',hostId:'actual',path:'/web'}]},
      {id:'other',name:'Other',gitRemoteUrl:null,sources:[{type:'local_path',hostId:'actual',path:'/outside'}]},
    ]},threads:{getPluginMetadata:async()=>metadata,get:async()=>({environmentId:'env'})},environments:{get:async()=>({path:'/worktrees/api',hostId:'actual'})},
  },experimental_callHostRpc:async call=>call.method==='repowise_inspect'?{available:true,version:'0.60.1',workspacePath:'/plugin/data',prepared:true,busy:false,error:null,updatedAt:1,roots:[]}:{ok:true}});
  try{
    await plugin(bb);await harness.behavior.callRpc('save',{space,revision:0});
    const config=await harness.behavior.resolveAgentConfiguration(makePluginAgentConfigurationContext({project:{id:'api'},pluginMetadata:{}}));
    assert.deepEqual(config.tools.map(t=>t.name).sort(),['project_spaces_repowise','project_spaces_workspace']);
    await harness.behavior.callAgentTool('project_spaces_repowise',{operation:'context'},{threadId:'thread',projectId:'api'});
    const call=harness.inspection.experimental_hostRpcCalls.at(-1)!;assert.equal(call.hostId,'actual');
    assert.deepEqual((call.input as {roots:{path:string}[]}).roots.map(r=>r.path),['/worktrees/api','/web','/docs']);
    await harness.behavior.callAgentTool('project_spaces_repowise',{operation:'call',tool:'get_context',arguments:{targets:['handler']}},{threadId:'thread',projectId:'api'});
    const query=harness.inspection.experimental_hostRpcCalls.at(-1)!;assert.equal(query.method,'repowise_query');assert.equal((query.input as {query:{repo:string}}).query.repo,'all');
    metadata={spaceId:null};await assert.rejects(()=>harness.behavior.callAgentTool('project_spaces_repowise',{operation:'context'},{threadId:'thread',projectId:'api'}),/вне пространств/);
    const outside=await harness.behavior.resolveAgentConfiguration(makePluginAgentConfigurationContext({project:{id:'api'},pluginMetadata:metadata}));assert.equal(outside.tools.length,0);
    metadata={};const second={...space,id:'5d8b342e-3fbd-4c77-9564-725c77466c98',name:'Other space'};await harness.behavior.callRpc('save',{space:second,revision:1});
    await assert.rejects(()=>harness.behavior.callAgentTool('project_spaces_repowise',{operation:'context'},{threadId:'thread',projectId:'api'}),/Выберите spaceId/);
    await harness.behavior.callAgentTool('project_spaces_repowise',{operation:'context',spaceId:space.id},{threadId:'thread',projectId:'api'});
  }finally{await harness.lifecycle.dispose();}
});
