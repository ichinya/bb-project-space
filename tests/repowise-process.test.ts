import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { repowiseCommand } from '../repowise-process.ts';

test('a completed CLI does not wait for pipes inherited by its background process',{timeout:12000},async()=>{
  const temp=await fs.mkdtemp(path.join(os.tmpdir(),'project-spaces-repowise-pipes-'));const file=path.join(temp,'owner.pid');
  const ownerCode="process.send('ready');setInterval(()=>{},1000)";
  const code=`const {spawn}=require('node:child_process');const fs=require('node:fs');const owner=spawn(process.execPath,['-e',${JSON.stringify(ownerCode)}],{detached:true,stdio:['ignore','inherit','inherit','ipc']});owner.once('message',()=>{fs.writeFileSync(${JSON.stringify(file)},String(owner.pid));owner.disconnect();owner.unref();process.exit(0);});`;
  let owner:number|undefined;
  try{
    await repowiseCommand(['-e',code],{cwd:temp,binary:process.execPath,timeoutMs:8000});
    owner=Number(await fs.readFile(file,'utf8'));assert.ok(owner>0);process.kill(owner,0);
  }finally{
    if(!owner){try{owner=Number(await fs.readFile(file,'utf8'));}catch{}}
    if(owner){try{process.kill(owner);}catch{}}
    assert.ok(path.resolve(temp).startsWith(path.resolve(os.tmpdir())+path.sep));await fs.rm(temp,{recursive:true,force:true,maxRetries:20,retryDelay:50});
  }
});
