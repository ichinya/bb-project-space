import test from 'node:test';
import assert from 'node:assert/strict';
import { createFakePluginHost,makePluginAgentConfigurationContext } from '@get-bb/plugin-sdk/testing';
import plugin from '../server.ts';
import type { Space } from '../model.ts';
import { contextForSpace } from '../model.ts';
import { threadMetadata } from '../threads.ts';
import { workspaceMapOnly } from '../agent-context.ts';
const space:Space={id:'5d8b342e-3fbd-4c77-9564-725c77466c97',name:'Space',projectIds:['api'],primaryProjectId:'api',folders:[{hostId:'actual',path:'/reference'}],instructions:'Initial',contextGroup:'group'};
test('AGENTS sync is opt-in per host, follows saved settings and combines shared memberships without reference writes',async()=>{
  const {bb,harness}=createFakePluginHost({pluginId:'project-spaces',sdk:{projects:{list:async()=>[{id:'api',name:'API',gitRemoteUrl:null,sources:[{type:'local_path',hostId:'actual',path:'/api'},{type:'local_path',hostId:'other',path:'/elsewhere'}]}]}},experimental_callHostRpc:async()=>({updatedAt:1,results:[]})});
  const settle=()=>new Promise(resolve=>setImmediate(resolve));
  try{
    await plugin(bb);await harness.behavior.callRpc('save',{space,revision:0});await settle();assert.equal(harness.inspection.experimental_hostRpcCalls.length,0);
    const enabled={...space,agentsHosts:['actual']};await harness.behavior.callRpc('save',{space:enabled,revision:1});await settle();let call=harness.inspection.experimental_hostRpcCalls.at(-1)!;assert.equal(call.hostId,'actual');assert.equal(call.method,'agents_sync');assert.deepEqual((call.input as {targets:{path:string}[]}).targets.map(row=>row.path),['/api']);
    const second={...enabled,id:'5d8b342e-3fbd-4c77-9564-725c77466c98',name:'Second'};await harness.behavior.callRpc('save',{space:second,revision:2});await settle();call=harness.inspection.experimental_hostRpcCalls.at(-1)!;assert.equal((call.input as {targets:unknown[]}).targets.length,2);
    await harness.behavior.callRpc('remove',{id:space.id,revision:3});await settle();call=harness.inspection.experimental_hostRpcCalls.at(-1)!;assert.equal((call.input as {targets:unknown[]}).targets.length,1);
    await harness.behavior.callRpc('save',{space:{...second,agentsHosts:[]},revision:4});await settle();assert.deepEqual(harness.inspection.experimental_hostRpcCalls.at(-1)!.input,{targets:[]});
    await assert.rejects(()=>harness.behavior.callRpc('agents_sync',{hostId:'actual',revision:0}),/Настройки изменились/);
    const status=await harness.behavior.callRpc('agents_status',{hostId:'actual'}) as {busy:boolean;last:unknown};assert.equal(status.busy,false);assert.ok(status.last);
  }finally{await harness.lifecycle.dispose();}
});

test('agent receives selected snapshot instructions once even when the launch map contains multiple rule paragraphs',async()=>{
  const selected={...space,instructions:'UNIQUE_RULE_A: preserve contracts.\n\nUNIQUE_RULE_B: validate evidence.'},projects=[{id:'api',name:'API',sources:[{hostId:'actual',path:'/api'}]}];
  const {bb,harness}=createFakePluginHost({pluginId:'project-spaces',agentSkillIds:['project-spaces'],sdk:{projects:{list:async()=>projects.map(project=>({...project,gitRemoteUrl:null,sources:project.sources.map(source=>({...source,type:'local_path'}))}))}}});
  try{
    await plugin(bb);await harness.behavior.callRpc('save',{space:selected,revision:0});
    const map=contextForSpace(selected,projects,'api','actual').instructions;
    const config=await harness.behavior.resolveAgentConfiguration(makePluginAgentConfigurationContext({project:{id:'api'},pluginMetadata:threadMetadata(selected,'project',map)}));
    assert.equal(config.instructions?.match(/UNIQUE_RULE_A/g)?.length,1);assert.equal(config.instructions?.match(/UNIQUE_RULE_B/g)?.length,1);assert.match(config.instructions!,/\/api/);
    const legacy='Legacy metadata\n\nDo not discard';assert.equal(workspaceMapOnly(legacy),legacy);
  }finally{await harness.lifecycle.dispose();}
});
