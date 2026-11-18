import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { repowiseEnvironment,type ProcessOptions } from './repowise-process.ts';

const execute=promisify(execFile);
const ignored=new Set(['.git','.bb','.repowise','node_modules','.venv','venv','__pycache__']);
export const workspaceConfig='.ai-workspace.json';
const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const stamp=(stat:Awaited<ReturnType<typeof fs.lstat>>)=>[stat.size,stat.mtimeMs,stat.ctimeMs,stat.mode];
export async function checkoutSnapshot(root:string,options:Pick<ProcessOptions,'signal'|'env'>={}):Promise<{fingerprint:string|null;kind:'git'|'folder'|'unknown';dirty?:boolean}>{
  try{
    const env={...repowiseEnvironment({cwd:root,...options,safePaths:[root]}),GIT_OPTIONAL_LOCKS:'0'};
    const git=(args:string[])=>execute('git',['-C',root,...args],{env,signal:options.signal,windowsHide:true,timeout:10000,maxBuffer:1024*1024,encoding:'utf8'});
    let status:string;
    try{status=(await git(['-c','status.relativePaths=true','status','--porcelain=v1','-z','--untracked-files=all','--','.',...Array.from(ignored,name=>':(exclude)'+name),':(exclude,literal)'+workspaceConfig])).stdout;}
    catch(cause){if(!/not a git repository/i.test(String((cause as {stderr?:string}).stderr)))return {fingerprint:null,kind:'unknown'};return {fingerprint:await plainFolderFingerprint(root,options.signal),kind:'folder'};}
    let head='unborn';try{head=(await git(['rev-parse','--verify','HEAD'])).stdout.trim();}catch(cause){if(options.signal?.aborted)throw cause;/* An empty Git repository has no HEAD yet. */}
    const records=status.split('\0'),files:string[]=[];
    for(let i=0;i<records.length;i++){const row=records[i]!;if(!row)continue;files.push(row.slice(3));if(/[RC]/.test(row.slice(0,2)))i++;}
    if(files.length>2000)return {fingerprint:null,kind:'git',dirty:true};
    const stamps=await Promise.all(files.map(async name=>{const file=path.resolve(root,name);if(!file.startsWith(path.resolve(root)+path.sep))throw new Error('Outside checkout');try{const stat=await fs.lstat(file);if(stat.isDirectory())throw new Error('Changed submodule needs a separate checkout check');return [name,...stamp(stat)];}catch(cause){if((cause as NodeJS.ErrnoException).code==='ENOENT')return [name,'deleted'];throw cause;}}));
    return {fingerprint:hash({head,status,stamps}),kind:'git',dirty:!!status};
  }catch(cause){if(options.signal?.aborted)throw cause;return {fingerprint:null,kind:'unknown'};}
}
export async function checkoutFingerprint(root:string,options:Pick<ProcessOptions,'signal'|'env'>={}):Promise<string|null>{
  return (await checkoutSnapshot(root,options)).fingerprint;
}
async function plainFolderFingerprint(root:string,signal?:AbortSignal):Promise<string|null>{
  const files:unknown[]=[],started=Date.now();let complete=true;
  async function visit(directory:string):Promise<void>{
    if(signal?.aborted)throw signal.reason;
    if(files.length>2000||Date.now()-started>2500){complete=false;return;}
    for(const entry of (await fs.readdir(directory,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){
      if(ignored.has(entry.name)||entry.isSymbolicLink())continue;
      if(directory===root&&entry.name===workspaceConfig&&entry.isFile())continue;
      const file=path.join(directory,entry.name);
      if(entry.isDirectory())await visit(file);else if(entry.isFile())files.push([path.relative(root,file),...stamp(await fs.lstat(file))]);
      if(!complete||files.length>2000){complete=false;return;}
    }
  }
  try{await visit(root);return complete?hash(files):null;}catch(cause){if(signal?.aborted)throw cause;return null;}
}
export async function checkoutSnapshots(roots:{path:string;alias:string}[],options:Pick<ProcessOptions,'signal'|'env'>={}){
  const result:Record<string,Awaited<ReturnType<typeof checkoutSnapshot>>>={};let cursor=0;
  await Promise.all(Array.from({length:Math.min(4,roots.length)},async()=>{while(cursor<roots.length){const root=roots[cursor++]!;result[root.alias]=await checkoutSnapshot(root.path,options);}}));
  return result;
}
export async function checkoutFingerprints(roots:{path:string;alias:string}[],options:Pick<ProcessOptions,'signal'|'env'>={}){
  return Object.fromEntries(Object.entries(await checkoutSnapshots(roots,options)).map(([alias,snapshot])=>[alias,snapshot.fingerprint]));
}
