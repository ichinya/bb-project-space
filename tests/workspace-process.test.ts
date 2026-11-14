import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { workspaceMcp,mcpJson } from '../workspace-process.ts';

test('MCP resolves after bridge exit even when a background owner inherits its pipes',{timeout:12000},async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'workspace-bridge-test-')),pidFile=path.join(root,'holder.pid');
  const code=`const {spawn}=require('child_process');const fs=require('fs');const readline=require('readline');const holder=spawn(process.execPath,['-e','process.send("ready");process.disconnect();setTimeout(()=>{},10000)'],{stdio:['ignore',1,'ignore','ipc'],windowsHide:true,detached:true});holder.unref();holder.once('message',()=>{fs.writeFileSync(${JSON.stringify(pidFile)},String(holder.pid));readline.createInterface({input:process.stdin}).on('line',line=>{const m=JSON.parse(line);if(m.id)process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:m.id,result:m.id===1?{}:{content:[{type:'text',text:'{"ok":true}'}]}})+'\\n');});});`;
  let ownerPid:number|undefined;
  try {
    const start=Date.now();const result=await workspaceMcp('tools/call',{name:'workspace_context',arguments:{}},{cwd:root,spawn:((_binary,_args,options)=>spawn(process.execPath,['-e',code],options)) as typeof spawn});
    ownerPid=Number(await fs.readFile(pidFile,'utf8'));
    assert.deepEqual(mcpJson(result),{ok:true});assert.ok(Date.now()-start<4000,'Must not wait for inherited owner pipes to close');
    assert.doesNotThrow(()=>process.kill(ownerPid!,0),'The unrelated owner must remain alive');
  }finally{
    if(!ownerPid)try{ownerPid=Number(await fs.readFile(pidFile,'utf8'));}catch{}
    if(ownerPid)try{process.kill(ownerPid);}catch{}
    assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir())+path.sep));await fs.rm(root,{recursive:true,force:true,maxRetries:5,retryDelay:100});
  }
});
