import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { zipSync } from 'fflate';
import { releaseAssetName,parseWorkspaceVersion,newerVersion,extractWorkspaceBinary,installWorkspaceSoftware,workspaceExecutable } from '../workspace-software.ts';

test('release asset selection matches supported OS/CPU combinations',()=>{
  assert.equal(releaseAssetName('win32','x64'),'ai-workspace-x86_64-pc-windows-msvc.zip');
  assert.equal(releaseAssetName('linux','arm64'),'ai-workspace-aarch64-unknown-linux-gnu.tar.gz');
  assert.equal(releaseAssetName('darwin','x64'),'ai-workspace-x86_64-apple-darwin.tar.gz');
  assert.equal(releaseAssetName('win32','arm64'),null);
});
test('installed version parsing and comparisons use numeric semver components',()=>{
  assert.equal(parseWorkspaceVersion('ai-workspace 1.7.0\n'),'1.7.0');assert.equal(parseWorkspaceVersion('unknown binary 1.7.0'),null);
  assert.equal(newerVersion('1.10.0','1.9.9'),true);assert.equal(newerVersion('1.7.0','1.7.0'),false);assert.equal(newerVersion('1.7.0','2.0.0'),false);
});
test('archive extraction picks exactly one executable and never uses archive paths as destinations',()=>{
  const bytes=Buffer.from('fixture executable');
  assert.deepEqual(extractWorkspaceBinary(Buffer.from(zipSync({'ai-workspace.exe':bytes,'../../outside.exe':Buffer.from('ignored')})),'test.zip'),bytes);
  assert.throws(()=>extractWorkspaceBinary(Buffer.from(zipSync({'../../ai-workspace.exe':bytes})),'test.zip'),/единственного/);
  const header=Buffer.alloc(512);header.write('ai-workspace');header.write(bytes.length.toString(8).padStart(11,'0')+'\0',124);header[156]=48;
  const tar=Buffer.concat([header,bytes,Buffer.alloc(512-bytes.length),Buffer.alloc(1024)]);
  assert.deepEqual(extractWorkspaceBinary(gzipSync(tar),'test.tar.gz'),bytes);
  header[156]=50;assert.throws(()=>extractWorkspaceBinary(gzipSync(Buffer.concat([header,bytes,Buffer.alloc(512-bytes.length)])),'test.tar.gz'),/тип/);
});
test('checksum failure preserves the active installation; invalid active paths fall back to PATH',async()=>{
  const data=await fs.mkdtemp(path.join(os.tmpdir(),'workspace-install-test-'));
  const software=path.join(data,'software','ai-workspace');await fs.mkdir(software,{recursive:true});
  const active=path.join(software,'active.json');await fs.writeFile(active,JSON.stringify({version:'../../outside'}));
  try {
    assert.equal(await workspaceExecutable(data),'ai-workspace');
    const name=releaseAssetName()!,asset=Buffer.from('invalid archive'),url=`https://github.com/lee-to/ai-workspace/releases/download/v9.0.0/${name}`;
    const fakeFetch=(async(input:string|URL|Request)=>new Response(String(input).includes('/releases/latest')?JSON.stringify({tag_name:'v9.0.0',assets:[{name,size:asset.length,browser_download_url:url,digest:'sha256:'+'0'.repeat(64)}]}):asset)) as typeof fetch;
    const before=await fs.readFile(active,'utf8');await assert.rejects(()=>installWorkspaceSoftware(data,{fetch:fakeFetch}),/SHA-256/);assert.equal(await fs.readFile(active,'utf8'),before);
  }finally{assert.ok(path.resolve(data).startsWith(path.resolve(os.tmpdir())+path.sep));await fs.rm(data,{recursive:true,force:true});}
});
