import test from 'node:test';
import assert from 'node:assert/strict';
import { createFakePluginHost,makePluginAgentConfigurationContext,makeThreadResponse } from '@get-bb/plugin-sdk/testing';
import plugin from '../server.ts';
import type { Space } from '../model.ts';

test('Repowise software installation and version checks stay on the explicitly selected host',async()=>{
  const software={installedVersion:'0.61.0',binary:'/plugin/software/repowise',managed:true,latestVersion:'0.61.0',releaseUrl:'https://pypi.org/project/repowise/0.61.0/',checkedAt:1,updateAvailable:false,supported:true,installer:'uv',error:null};
  const {bb,harness}=createFakePluginHost({pluginId:'project-spaces',experimental_callHostRpc:async()=>software});
  try{await plugin(bb);await harness.behavior.callRpc('repowise_software',{hostId:'selected-linux',checkLatest:true});let call=harness.inspection.experimental_hostRpcCalls.at(-1)!;assert.equal(call.hostId,'selected-linux');assert.equal(call.method,'repowise_software');assert.deepEqual(call.input,{checkLatest:true});await harness.behavior.callRpc('repowise_install',{hostId:'selected-linux'});call=harness.inspection.experimental_hostRpcCalls.at(-1)!;assert.equal(call.hostId,'selected-linux');assert.equal(call.method,'repowise_install');const signal=harness.realtimeSignals.at(-1)!;assert.match(signal.channel,/repowise-changed$/);assert.deepEqual(signal.payload,{hostId:'selected-linux'});}finally{await harness.lifecycle.dispose();}
});

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
    assert.match(config.instructions!,/spaceId="5d8b342e/);assert.match(config.instructions!,/stale=false/);assert.match(config.instructions!,/no separate global MCP/);
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

test('native lifecycle refresh uses the actual host/worktree, saved toggle and explicit space placement',async()=>{
  const space:Space={id:'5d8b342e-3fbd-4c77-9564-725c77466c97',name:'Space',projectIds:['api'],primaryProjectId:'api',folders:[],contextGroup:'',instructions:''};
  let metadata:Record<string,unknown>={},stale=true;
  const {bb,harness}=createFakePluginHost({pluginId:'project-spaces',sdk:{projects:{list:async()=>[{id:'api',name:'API',gitRemoteUrl:null,sources:[{type:'local_path',hostId:'other',path:'/wrong'}]}]},threads:{getPluginMetadata:async()=>metadata},environments:{get:async()=>({path:'/worktrees/api',hostId:'actual'})}},experimental_callHostRpc:async call=>({available:true,version:'0.61.0',workspacePath:'/data',prepared:true,stale,busy:false,error:null,updatedAt:1,roots:[]})});
  const thread=makeThreadResponse({id:'thread',projectId:'api',environmentId:'env'});
  try{
    await plugin(bb);await harness.behavior.callRpc('save',{space,revision:0});
    assert.deepEqual((await harness.behavior.emitThreadEvent('thread.active',{thread})).errors,[]);
    const sync=harness.inspection.experimental_hostRpcCalls.find(call=>call.method==='repowise_sync')!;assert.ok(sync);assert.equal(sync.hostId,'actual');assert.deepEqual((sync.input as {roots:unknown[]}).roots,[{name:'API',path:'/worktrees/api'}]);
    await new Promise(resolve=>setImmediate(resolve));stale=false;
    await harness.behavior.emitThreadEvent('thread.idle',{thread,lastAssistantText:null});assert.equal(harness.inspection.experimental_hostRpcCalls.filter(call=>call.method==='repowise_sync').length,1);
    await harness.behavior.callRpc('save',{space:{...space,repowiseAutoRefresh:false},revision:1});const before=harness.inspection.experimental_hostRpcCalls.length;
    stale=true;await harness.behavior.emitThreadEvent('thread.failed',{thread,error:'failure'});assert.equal(harness.inspection.experimental_hostRpcCalls.length,before);
    await harness.behavior.callRpc('save',{space,revision:2});metadata={spaceId:null};await harness.behavior.emitThreadEvent('thread.active',{thread});assert.equal(harness.inspection.experimental_hostRpcCalls.length,before);
    metadata={};await harness.behavior.callRpc('save',{space:{...space,id:'5d8b342e-3fbd-4c77-9564-725c77466c98'},revision:3});await harness.behavior.emitThreadEvent('thread.active',{thread});assert.equal(harness.inspection.experimental_hostRpcCalls.length,before);
  }finally{await harness.lifecycle.dispose();}
});
