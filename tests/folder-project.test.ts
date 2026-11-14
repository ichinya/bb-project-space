import test from 'node:test';
import assert from 'node:assert/strict';
import { folderIdentity,makeFolderProjectAdder } from '../folder-project.ts';
import type { PluginBbSdk } from '@get-bb/plugin-sdk';

test('folder identities normalize Windows paths without folding Linux case',()=>{
  assert.equal(folderIdentity('\\\\?\\D:\\Projects\\Demo\\'),folderIdentity('d:/projects/demo'));
  assert.equal(folderIdentity('\\\\?\\UNC\\server\\share\\demo'),folderIdentity('\\\\server\\share\\demo'));
  assert.notEqual(folderIdentity('/srv/API'),folderIdentity('/srv/api'));
});

function fixture(){
  const projects:{id:string;name:string;gitRemoteUrl:null;sources:{hostId:string;path:string}[]}[]=[];
  const calls:{hostId:string;path?:string}[]=[],created:{name:string;source:{hostId:string;path:string}}[]=[];
  const sdk={hosts:{directory:async(input:{hostId:string;path?:string})=>{calls.push(input);if(input.hostId==='offline')throw new Error('Host offline');return {directory:input.path!.replace('d:/','D:\\').replaceAll('/','\\')};}},projects:{list:async()=>projects,create:async(input:{name:string;source:{hostId:string;path:string}})=>{created.push(input);const project={id:'created-'+created.length,name:input.name,gitRemoteUrl:null,sources:[input.source]};projects.push(project);return project;}}} as unknown as Pick<PluginBbSdk,'hosts'|'projects'>;
  return {projects,calls,created,add:makeFolderProjectAdder(sdk)};
}

test('create uses the selected host and selects an existing folder project on repeated requests',async()=>{
  const f=fixture();const first=await f.add({hostId:'windows',path:'D:\\Projects\\Demo',name:'Demo app'});
  assert.equal(first.reused,false);assert.equal(first.project.name,'Demo app');
  assert.deepEqual(f.created[0],{name:'Demo app',source:{type:'local_path',hostId:'windows',path:'D:\\Projects\\Demo'}});
  const second=await f.add({hostId:'windows',path:'d:/projects/demo/',name:'Do not rename'});
  assert.equal(second.reused,true);assert.equal(second.project.id,first.project.id);assert.equal(f.created.length,1);assert.equal(second.project.name,'Demo app');
  await f.add({hostId:'another-host',path:'D:\\Projects\\Demo'});assert.equal(f.created.length,2);
});

test('parallel additions create only one project and infer its name from the folder',async()=>{
  const f=fixture();const result=await Promise.all([f.add({hostId:'windows',path:'D:\\Projects\\Demo'}),f.add({hostId:'windows',path:'D:\\Projects\\Demo'})]);
  assert.equal(f.created.length,1);assert.equal(result[0].project.id,result[1].project.id);assert.equal(result[0].project.name,'Demo');
});

test('invalid paths and offline hosts fail before creating a project',async()=>{
  const f=fixture();for(const value of ['../demo','relative','D:\\Demo\nother'])await assert.rejects(()=>f.add({hostId:'windows',path:value}));
  assert.equal(f.calls.length,0);await assert.rejects(()=>f.add({hostId:'offline',path:'D:\\Demo'}),/offline/);assert.equal(f.created.length,0);
});
