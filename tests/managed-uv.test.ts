import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { zipSync } from 'fflate';
import { ensureManagedUv,managedUvExecutable,uvAssetName } from '../managed-uv.ts';
import { softwareCommand } from '../repowise-software.ts';

test('managed uv selects native targets and rejects unsupported architectures',()=>{
  assert.equal(uvAssetName('linux','x64'),'uv-x86_64-unknown-linux-gnu.tar.gz');assert.equal(uvAssetName('win32','arm64'),'uv-aarch64-pc-windows-msvc.zip');assert.equal(uvAssetName('darwin','arm64'),'uv-aarch64-apple-darwin.tar.gz');assert.equal(uvAssetName('linux','ppc64'),null);
});
async function bootstrapFixture(badHash=false){
  const data=await fs.mkdtemp(path.join(os.tmpdir(),'ps-uv-')),assetName=uvAssetName()!,entry=process.platform==='win32'?'uv.exe':assetName.replace(/\.tar\.gz$/,'')+'/uv',bytes=Buffer.from('native executable fixture');
  let archive:Buffer;
  if(assetName.endsWith('.zip'))archive=Buffer.from(zipSync({[entry]:bytes}));
  else{const header=Buffer.alloc(512);header.write(entry);header.write(bytes.length.toString(8).padStart(11,'0')+'\0',124);header[156]=48;archive=gzipSync(Buffer.concat([header,bytes,Buffer.alloc(512-bytes.length),Buffer.alloc(1024)]));}
  const fakeFetch=(async(input:string|URL|Request)=>new Response(String(input).endsWith('/latest')?JSON.stringify({tag_name:'9.0.0',assets:[{name:assetName,size:archive.length,browser_download_url:`https://github.com/astral-sh/uv/releases/download/9.0.0/${assetName}`,digest:'sha256:'+(badHash?'0'.repeat(64):createHash('sha256').update(archive).digest('hex'))}]}):archive)) as typeof fetch;
  return {data,options:{fetch:fakeFetch,verify:async()=> 'uv 9.0.0'},cleanup:async()=>{assert.ok(path.resolve(data).startsWith(path.resolve(os.tmpdir())+path.sep));await fs.rm(data,{recursive:true,force:true});}};
}
test('bootstrap verifies the uv archive and version and reuses a managed executable',async()=>{
  const f=await bootstrapFixture();try{const binary=await ensureManagedUv(f.data,f.options);assert.equal(await managedUvExecutable(f.data),binary);assert.ok((await fs.stat(binary)).isFile());assert.equal(await ensureManagedUv(f.data,{...f.options,fetch:async()=>{throw new Error('must not download twice');}}),binary);}finally{await f.cleanup();}
});
test('unverified or wrong-version uv cannot become active',async()=>{
  const f=await bootstrapFixture(true);try{await assert.rejects(()=>ensureManagedUv(f.data,f.options),/SHA-256/);assert.equal(await managedUvExecutable(f.data),null);}finally{await f.cleanup();}
  const next=await bootstrapFixture();try{await assert.rejects(()=>ensureManagedUv(next.data,{...next.options,verify:async()=> 'uv 0.0.1'}),/Версия uv/);assert.equal(await managedUvExecutable(next.data),null);}finally{await next.cleanup();}
});
test('real uv bootstrap downloads a verified native executable without running an installer script',{skip:process.env.RUN_MANAGED_UV_INSTALL!=='1',timeout:300000},async()=>{
  const data=await fs.mkdtemp(path.join(os.tmpdir(),'ps-uv-real-'));try{const binary=await ensureManagedUv(data,{verify:binary=>softwareCommand(binary,['--version'],{cwd:data})});assert.match(await softwareCommand(binary,['--version'],{cwd:data}),/^uv \d+\.\d+\.\d+/);assert.equal(await managedUvExecutable(data),binary);}finally{assert.ok(path.resolve(data).startsWith(path.resolve(os.tmpdir())+path.sep));await fs.rm(data,{recursive:true,force:true,maxRetries:5,retryDelay:100});}
});
