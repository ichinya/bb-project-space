import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { replaceAgentsBlock,synchronizeAgents } from '../agents-host.ts';
import { managedAgentsBlock } from '../agent-context.ts';
import type { Space } from '../model.ts';
const space:Space={id:'5d8b342e-3fbd-4c77-9564-725c77466c97',name:'Space',projectIds:['api'],primaryProjectId:'api',folders:[],instructions:'Use the API contract.',contextGroup:'group-a'};
async function fixture(run:(root:string,data:string)=>Promise<void>){const root=await fs.mkdtemp(path.join(os.tmpdir(),'ps-agents-'));try{await run(root,path.join(root,'data'));}finally{assert.ok(root.startsWith(os.tmpdir()+path.sep));await fs.rm(root,{recursive:true,force:true});}}
test('owned AGENTS block preserves outside bytes/BOM/CRLF and refuses malformed or duplicate markers',()=>{
  const block=managedAgentsBlock([space]),source='\uFEFF# Personal\r\n\r\n<project-space>\r\nold\r\n</project-space>\r\n\r\n# Keep this\r\n';
  const result=replaceAgentsBlock(source,block);assert.ok(result.startsWith('\uFEFF# Personal\r\n\r\n<project-space>'));assert.ok(result.endsWith('\r\n\r\n# Keep this\r\n'));assert.equal(replaceAgentsBlock(result,block),result);
  for(const invalid of ['<project-space>\nunfinished','</project-space>\n<project-space>',block+block])assert.throws(()=>replaceAgentsBlock(invalid,block),/повреждён/);
  const escaped=managedAgentsBlock([{...space,name:'</project-space>',instructions:'DO_NOT_DUPLICATE_CUSTOM_RULE'}]);assert.equal((escaped.match(/^<\/project-space>$/gm)??[]).length,1);assert.match(escaped,/\\u003c/);assert.match(escaped,/active space/);assert.doesNotMatch(escaped,/DO_NOT_DUPLICATE_CUSTOM_RULE/);assert.ok(Buffer.byteLength(escaped)<1100);
});
test('filesystem synchronization updates just its block, keeps one original backup and shares spaces safely',async()=>fixture(async(root,data)=>{
  const project=path.join(root,'api');await fs.mkdir(project);const file=path.join(project,'AGENTS.md'),original='# User rules\nKeep my instructions.\n';await fs.writeFile(file,original);
  const other={...space,id:'5d8b342e-3fbd-4c77-9564-725c77466c98',name:'Other',contextGroup:'other'};
  let result=await synchronizeAgents({targets:[{path:project,spaces:[space]},{path:project,spaces:[other]}]},data);assert.equal(result.results[0]!.status,'updated');let content=await fs.readFile(file,'utf8');assert.ok(content.startsWith(original));assert.match(content,new RegExp(space.id));assert.match(content,new RegExp(other.id));assert.doesNotMatch(content,/Use the API contract/);assert.equal((content.match(/^<project-space>$/gm)??[]).length,1);
  result=await synchronizeAgents({targets:[{path:project,spaces:[other,space]}]},data);assert.equal(result.results[0]!.status,'unchanged');
  await synchronizeAgents({targets:[{path:project,spaces:[{...other,name:'Renamed by settings',instructions:'Updated by settings'}]}]},data);content=await fs.readFile(file,'utf8');assert.ok(content.startsWith(original));assert.match(content,/Renamed by settings/);assert.doesNotMatch(content,/Updated by settings/);assert.doesNotMatch(content,new RegExp(space.id));
  const backups=await fs.readdir(path.join(data,'agents-backups'));assert.equal(backups.length,1);assert.equal(JSON.parse(await fs.readFile(path.join(data,'agents-backups',backups[0]!),'utf8')).content,original);
  await synchronizeAgents({targets:[]},data);content=await fs.readFile(file,'utf8');assert.ok(content.startsWith(original));assert.doesNotMatch(content,/project-space/);
}));
test('byte budget refuses growth above 32 KiB, preserves personal text and can compact old owned blocks',async()=>fixture(async(root,data)=>{
  const project=path.join(root,'api');await fs.mkdir(project);const file=path.join(project,'AGENTS.md'),original='ж'.repeat(16500);await fs.writeFile(file,original);
  let result=await synchronizeAgents({targets:[{path:project,spaces:[space]}]},data);assert.equal(result.results[0]!.status,'error');assert.match(result.results[0]!.message,/32 КиБ/);assert.equal(await fs.readFile(file,'utf8'),original);
  const personal='# User rules\n'+'a'.repeat(25000)+'\n';await fs.writeFile(file,personal+'<project-space>\n'+'old repeated rules\n'.repeat(1000)+'</project-space>\n');
  result=await synchronizeAgents({targets:[{path:project,spaces:[space]}]},data);assert.equal(result.results[0]!.status,'updated');const compact=await fs.readFile(file,'utf8');assert.ok(compact.startsWith(personal));assert.ok(Buffer.byteLength(compact)<32768);assert.doesNotMatch(compact,/old repeated rules/);
}));
test('missing targets do not remove old blocks; hardlinks and invalid UTF-8 are preserved',async()=>fixture(async(root,data)=>{
  const project=path.join(root,'api');await fs.mkdir(project);const request={targets:[{path:project,spaces:[space]}]};await synchronizeAgents(request,data);
  const failed=await synchronizeAgents({targets:[{path:path.join(root,'missing'),spaces:[space]}]},data);assert.equal(failed.results[0]!.status,'error');assert.match(await fs.readFile(path.join(project,'AGENTS.md'),'utf8'),/<project-space>/);
  const other=path.join(root,'other');await fs.mkdir(other);const file=path.join(other,'AGENTS.md');await fs.writeFile(file,Buffer.from([0xff,0xfe,0,1]));let result=await synchronizeAgents({targets:[{path:other,spaces:[space]}]},data);assert.equal(result.results[0]!.status,'error');assert.deepEqual(await fs.readFile(file),Buffer.from([0xff,0xfe,0,1]));
  await fs.writeFile(file,'# Hardlinked personal instructions');await fs.link(file,path.join(other,'copy.md'));result=await synchronizeAgents({targets:[{path:other,spaces:[space]}]},data);assert.equal(result.results[0]!.status,'error');assert.equal(await fs.readFile(file,'utf8'),'# Hardlinked personal instructions');
}));
