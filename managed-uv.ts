import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash,randomUUID } from 'node:crypto';
import { z } from 'zod';
import { downloadSoftwareFile,extractWorkspaceBinary } from './workspace-software.ts';

type Options={signal?:AbortSignal;fetch?:typeof fetch;verify:(binary:string)=>Promise<string>};
const versionPattern=/^\d+\.\d+\.\d+$/;
const releaseSchema=z.object({tag_name:z.string().regex(versionPattern),assets:z.array(z.object({name:z.string(),size:z.number().int().positive().max(96*1024*1024),browser_download_url:z.string().url(),digest:z.string().nullable().optional()}))});
export function uvAssetName(platform=process.platform,arch=process.arch):string|null{
  const target=platform==='win32'&&arch==='x64'?'x86_64-pc-windows-msvc':platform==='win32'&&arch==='arm64'?'aarch64-pc-windows-msvc':platform==='linux'&&arch==='x64'?'x86_64-unknown-linux-gnu':platform==='linux'&&arch==='arm64'?'aarch64-unknown-linux-gnu':platform==='darwin'&&arch==='x64'?'x86_64-apple-darwin':platform==='darwin'&&arch==='arm64'?'aarch64-apple-darwin':null;
  return target?`uv-${target}.${platform==='win32'?'zip':'tar.gz'}`:null;
}
const rootAt=(dataDir:string)=>path.join(dataDir,'software','uv');
const binaryName=()=>process.platform==='win32'?'uv.exe':'uv';
export async function managedUvExecutable(dataDir:string):Promise<string|null>{
  try{const active=JSON.parse(await fs.readFile(path.join(rootAt(dataDir),'active.json'),'utf8'));if(!versionPattern.test(active.version))return null;const binary=path.join(rootAt(dataDir),active.version,binaryName());return (await fs.lstat(binary)).isFile()?binary:null;}catch{return null;}
}
export async function ensureManagedUv(dataDir:string,options:Options):Promise<string>{
  const existing=await managedUvExecutable(dataDir);if(existing)return existing;
  const assetName=uvAssetName();if(!assetName)throw new Error('Для этого устройства установите uv или Python 3.11+ вручную.');
  const release=releaseSchema.parse(JSON.parse((await downloadSoftwareFile('https://api.github.com/repos/astral-sh/uv/releases/latest',options,4*1024*1024)).toString('utf8')));
  const asset=release.assets.find(item=>item.name===assetName),expected=asset?.digest?.match(/^sha256:([a-f0-9]{64})$/)?.[1];
  if(!asset||!expected||asset.browser_download_url!==`https://github.com/astral-sh/uv/releases/download/${release.tag_name}/${assetName}`)throw new Error('Нет проверенного архива uv для выбранного устройства.');
  const archive=await downloadSoftwareFile(asset.browser_download_url,options);
  if(archive.length!==asset.size||createHash('sha256').update(archive).digest('hex')!==expected)throw new Error('SHA-256 или размер архива uv не совпадает. Установка отменена.');
  const entry=process.platform==='win32'?'uv.exe':assetName.replace(/\.tar\.gz$/,'')+'/uv',bytes=extractWorkspaceBinary(archive,assetName,entry),root=rootAt(dataDir);await fs.mkdir(root,{recursive:true});
  const stage=await fs.mkdtemp(path.join(root,'install-')),binary=path.join(stage,binaryName());let temp:string|null=null;
  const verify=async(file:string)=>{const actual=/^uv\s+(\d+\.\d+\.\d+)\b/.exec((await options.verify(file)).trim())?.[1];if(actual!==release.tag_name)throw new Error('Версия uv не совпадает с релизом.');};
  try{
    await fs.writeFile(binary,bytes,{flag:'wx',mode:0o755});await verify(binary);const destination=path.join(root,release.tag_name);
    try{await fs.mkdir(destination);}catch(cause){if((cause as NodeJS.ErrnoException).code!=='EEXIST')throw cause;}
    const destinationBinary=path.join(destination,binaryName());
    try{await fs.copyFile(binary,destinationBinary,2);}catch(cause){if((cause as NodeJS.ErrnoException).code!=='EEXIST')throw cause;}
    await verify(destinationBinary);temp=path.join(root,'active-'+randomUUID()+'.json');await fs.writeFile(temp,JSON.stringify({version:release.tag_name,sha256:expected}),{flag:'wx'});await fs.rename(temp,path.join(root,'active.json'));return destinationBinary;
  }finally{if(temp)await fs.rm(temp,{force:true});if(path.dirname(stage)!==root)throw new Error('Неверный путь установки uv.');await fs.rm(stage,{recursive:true,force:true,maxRetries:5,retryDelay:100});}
}
