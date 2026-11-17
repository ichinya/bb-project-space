import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { installRepowiseSoftware,inspectRepowiseSoftware,repowiseExecutable,parseRepowiseVersion,softwareCommand } from '../repowise-software.ts';

const missing=()=>Object.assign(new Error('not found'),{code:'ENOENT'});
const binaryAt=(directory:string)=>path.join(directory,process.platform==='win32'?'Scripts':'bin','repowise'+(process.platform==='win32'?'.exe':''));
async function fixture(){
  const data=await fs.mkdtemp(path.join(os.tmpdir(),'ps-repowise-install-')),wheel=Buffer.from('verified wheel fixture');let version='9.0.0',failInstall=false,badHash=false,foreignUrl=false,wrongVersion=false,venvs=0;
  const calls:{binary:string;args:string[]}[]=[];
  const fakeFetch=(async(input:string|URL|Request)=>new Response(String(input).endsWith('/json')?JSON.stringify({info:{version},urls:[{filename:`repowise-${version}-py3-none-any.whl`,url:`https://${foreignUrl?'untrusted.example':'files.pythonhosted.org'}/packages/repowise-${version}-py3-none-any.whl`,size:wheel.length,digests:{sha256:badHash?'0'.repeat(64):createHash('sha256').update(wheel).digest('hex')}}]}):wheel)) as typeof fetch;
  const run:typeof softwareCommand=async(binary,args)=>{
    calls.push({binary,args});
    if(binary==='uv'&&args[0]==='--version')return 'uv 0.9.0';
    if(binary==='repowise')throw missing();
    if(args.includes('venv')){venvs++;const directory=args.at(-1)!;await fs.mkdir(path.dirname(binaryAt(directory)),{recursive:true});await fs.writeFile(binaryAt(directory),'fixture');return '';}
    if(args.includes('install')){if(failInstall)throw new Error('dependency install failed');return '';}
    if(args[0]==='--version')return 'repowise, version '+(wrongVersion?'0.0.1':path.basename(path.dirname(path.dirname(binary))).split('-')[0]);
    if(args[1]==='--help')return 'Repowise command help';
    throw new Error('Unexpected command');
  };
  return {data,options:{fetch:fakeFetch,run},calls,setVersion:(value:string)=>{version=value;},fail:()=>{failInstall=true;},badHash:()=>{badHash=true;},foreign:()=>{foreignUrl=true;},wrong:()=>{wrongVersion=true;},venvs:()=>venvs,cleanup:async()=>{assert.ok(path.resolve(data).startsWith(path.resolve(os.tmpdir())+path.sep));await fs.rm(data,{recursive:true,force:true,maxRetries:5,retryDelay:100});}};
}

test('Repowise version accepts actual Click output and rejects unrelated output',()=>{
  for(const text of ['repowise, version 0.61.0','repowise 0.61.0','0.61.0\n'])assert.equal(parseRepowiseVersion(text),'0.61.0');
  assert.equal(parseRepowiseVersion('Python 3.12.0'),null);assert.equal(parseRepowiseVersion('repowise 0.61.0; run something'),null);
});
test('software commands reject exit code 2 instead of treating installer errors as success',async()=>{
  await assert.rejects(()=>softwareCommand(process.execPath,['-e','process.exit(2)'],{cwd:os.tmpdir()}),/кодом 2/);
});
test('software probes finish when the CLI exits even if a background child inherits its pipes',async()=>{
  const script="const {spawn}=require('node:child_process');spawn(process.execPath,['-e','setTimeout(()=>{},2500)'],{stdio:['ignore',process.stdout,process.stderr],windowsHide:true}).unref();process.stdout.write('ready',()=>process.exit(0));";
  assert.equal(await softwareCommand(process.execPath,['-e',script],{cwd:os.tmpdir(),timeoutMs:1500}),'ready');
});
test('managed install and update use the verified wheel, preserve the previous CLI and activate the selected version',async()=>{
  const f=await fixture();try{
    const initial=await inspectRepowiseSoftware(f.data,true,f.options);assert.equal(initial.installedVersion,null);assert.equal(initial.error,null);assert.equal(initial.latestVersion,'9.0.0');assert.equal(initial.supported,true);
    const installed=await installRepowiseSoftware(f.data,f.options);assert.equal(installed.installedVersion,'9.0.0');assert.equal(installed.managed,true);
    const before=await repowiseExecutable(f.data);assert.ok(before.startsWith(path.join(f.data,'software','repowise')+path.sep));
    const uvInstall=f.calls.find(call=>call.args.includes('install'))!;assert.ok(uvInstall.args.includes('--python'));assert.ok(uvInstall.args.includes('https://pypi.org/simple'));
    assert.ok(uvInstall.args.at(-1)!.endsWith('repowise-9.0.0-py3-none-any.whl'));assert.equal(f.venvs(),1);
    await installRepowiseSoftware(f.data,f.options);assert.equal(f.venvs(),1);
    f.setVersion('9.1.0');const newer=await inspectRepowiseSoftware(f.data,true,f.options);assert.equal(newer.updateAvailable,true);
    const updated=await installRepowiseSoftware(f.data,f.options);assert.equal(updated.installedVersion,'9.1.0');assert.notEqual(await repowiseExecutable(f.data),before);assert.ok((await fs.stat(before)).isFile());
  }finally{await f.cleanup();}
});
for(const failure of ['badHash','foreign','wrong','fail'] as const)test(`failed ${failure} leaves the active installation intact and cleans the staged environment`,async()=>{
  const f=await fixture();try{
    await installRepowiseSoftware(f.data,f.options);const active=await repowiseExecutable(f.data),root=path.join(f.data,'software','repowise'),before=await fs.readFile(path.join(root,'active.json'),'utf8');
    f.setVersion('9.1.0');f[failure]();await assert.rejects(()=>installRepowiseSoftware(f.data,f.options));
    assert.equal(await fs.readFile(path.join(root,'active.json'),'utf8'),before);assert.equal(await repowiseExecutable(f.data),active);assert.equal((await fs.readdir(root)).length,2);
  }finally{await f.cleanup();}
});
test('downgrades and active path traversal are rejected without replacing the CLI',async()=>{
  const f=await fixture();try{
    await installRepowiseSoftware(f.data,f.options);f.setVersion('8.0.0');await assert.rejects(()=>installRepowiseSoftware(f.data,f.options),/Понижение/);
    await fs.writeFile(path.join(f.data,'software','repowise','active.json'),JSON.stringify({version:'9.0.0',slot:'../../outside'}));assert.equal(await repowiseExecutable(f.data),'repowise');
  }finally{await f.cleanup();}
});
test('offline update checks preserve the installed version and report the network failure',async()=>{
  const f=await fixture();try{
    await installRepowiseSoftware(f.data,f.options);const value=await inspectRepowiseSoftware(f.data,true,{...f.options,fetch:(async()=>{throw new Error('offline');}) as typeof fetch});assert.equal(value.installedVersion,'9.0.0');assert.match(value.error??'',/offline/);
  }finally{await f.cleanup();}
});
test('an active installation lock rejects another install without deleting its owner lock',async()=>{
  const f=await fixture();try{const root=path.join(f.data,'software','repowise');await fs.mkdir(root,{recursive:true});const lock=path.join(root,'install.lock'),owner=JSON.stringify({pid:process.pid});await fs.writeFile(lock,owner);await assert.rejects(()=>installRepowiseSoftware(f.data,f.options),/уже выполняется/);assert.equal(await fs.readFile(lock,'utf8'),owner);assert.equal(f.venvs(),0);}finally{await f.cleanup();}
});
test('real PyPI installation in a long host-data path verifies indexing/MCP imports and supports repeat installation', {skip:process.env.RUN_REPOWISE_INSTALL!=='1',timeout:900000},async()=>{
  const base=await fs.mkdtemp(path.join(os.tmpdir(),'ps-repowise-real-install-')),data=path.join(base,'long-profile-directory-'.repeat(3),'host-data');await fs.mkdir(data,{recursive:true});let alias:string|null=null;
  try{const installed=await installRepowiseSoftware(data);assert.ok(installed.installedVersion);assert.equal(installed.managed,true);const binary=await repowiseExecutable(data);if(process.platform==='win32')alias=path.dirname(path.dirname(path.dirname(binary)));assert.equal(parseRepowiseVersion(await softwareCommand(binary,['--version'],{cwd:data})),installed.installedVersion);await installRepowiseSoftware(data);assert.equal(await repowiseExecutable(data),binary);}
  finally{if(process.platform==='win32'){const root=path.resolve(path.join(data,'software','repowise')).toLowerCase(),cacheBase=path.join(process.env.LOCALAPPDATA!,'bb','ps'),cache=path.join(cacheBase,'r'+createHash('sha256').update(root).digest('hex').slice(0,16));try{assert.equal(JSON.parse(await fs.readFile(path.join(cache,'.project-spaces-owner.json'),'utf8')).root,root);assert.equal(path.dirname(cache),cacheBase);await fs.rm(cache,{recursive:true,force:true,maxRetries:5,retryDelay:100});}catch(cause){if((cause as NodeJS.ErrnoException).code!=='ENOENT')throw cause;}}assert.ok(path.resolve(base).startsWith(path.resolve(os.tmpdir())+path.sep));await fs.rm(base,{recursive:true,force:true,maxRetries:5,retryDelay:100});}
});
