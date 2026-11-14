import test from 'node:test';
import assert from 'node:assert/strict';
import { launchHostId } from '../launch.ts';
import type { PluginBrowserBbSdk } from '@get-bb/plugin-sdk';

const sdk={environments:{get:async({environmentId}:{environmentId:string})=>{assert.equal(environmentId,'env-existing');return {hostId:'actual-host'};}}} as unknown as Pick<PluginBrowserBbSdk,'environments'>;

test('native provider composer resolves its selected machine and preserves provider inputs',async()=>{
  const choice={type:'provider' as const,environmentProviderId:'project-checkout',machine:{type:'existing' as const,hostId:'selected-host'},inputs:{branch:{kind:'existing',name:'feat/example'},path:'D:\\Projects\\example'}};
  const before=structuredClone(choice);assert.equal(await launchHostId(choice,sdk),'selected-host');assert.deepEqual(choice,before);
});
test('worktree providers use their explicit machine as well',async()=>{
  assert.equal(await launchHostId({type:'provider',environmentProviderId:'worktree',machine:{type:'existing',hostId:'worktree-host'},inputs:{baseBranch:'main'}},sdk),'worktree-host');
});
test('reused environments resolve their actual host; explicit legacy host selections still work',async()=>{
  assert.equal(await launchHostId({type:'reuse',environmentId:'env-existing'},sdk),'actual-host');
  assert.equal(await launchHostId({type:'host',hostId:'explicit-host',workspace:{type:'unmanaged',path:null}},sdk),'explicit-host');
});
test('unresolved or newly provisioned machines do not silently use another host',async()=>{
  for(const choice of [{type:'project-default' as const},{type:'host' as const,workspace:{type:'unmanaged' as const,path:null}},{type:'provider' as const,environmentProviderId:'project-checkout',inputs:null}])await assert.rejects(()=>launchHostId(choice,sdk),/определить устройство/);
  await assert.rejects(()=>launchHostId({type:'provider',environmentProviderId:'cloud',machine:{type:'new',machineProviderId:'cloud',inputs:null},inputs:null},sdk),/существующее устройство/);
});
