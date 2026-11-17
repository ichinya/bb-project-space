import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash,randomUUID } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { unzipSync } from 'fflate';
import { z } from 'zod';
import { workspaceCommand } from './workspace-process.ts';

const maxBytes=96*1024*1024;
const versionPattern=/^\d+\.\d+\.\d+$/;
const releaseSchema=z.object({tag_name:z.string().regex(/^v\d+\.\d+\.\d+$/),assets:z.array(z.object({name:z.string(),size:z.number().int().positive(),browser_download_url:z.string().url(),digest:z.string().nullable().optional()}))});
export type Release=z.infer<typeof releaseSchema>;
type Options={signal?:AbortSignal;fetch?:typeof fetch;binary?:string};
let cached:{release:Release;checkedAt:number}|null=null;

export function releaseAssetName(platform=process.platform,arch=process.arch):string|null {
  const target=platform==='win32'&&arch==='x64'?'x86_64-pc-windows-msvc':platform==='linux'&&arch==='x64'?'x86_64-unknown-linux-gnu':platform==='linux'&&arch==='arm64'?'aarch64-unknown-linux-gnu':platform==='darwin'&&arch==='x64'?'x86_64-apple-darwin':platform==='darwin'&&arch==='arm64'?'aarch64-apple-darwin':null;
  return target?`ai-workspace-${target}.${platform==='win32'?'zip':'tar.gz'}`:null;
}
export function parseWorkspaceVersion(text:string):string|null {return /^ai-workspace\s+(\d+\.\d+\.\d+)\s*$/.exec(text.trim())?.[1]??null;}
export function newerVersion(latest:string,current:string):boolean {const a=latest.split('.').map(Number),b=current.split('.').map(Number);for(let i=0;i<3;i++){if(a[i]!==b[i])return a[i]!>b[i]!;}return false;}
const softwareDir=(dataDir:string)=>path.join(dataDir,'software','ai-workspace');
const binaryName=()=>process.platform==='win32'?'ai-workspace.exe':'ai-workspace';

export async function workspaceExecutable(dataDir:string):Promise<string> {
  try {const active=JSON.parse(await fs.readFile(path.join(softwareDir(dataDir),'active.json'),'utf8'));if(!versionPattern.test(active.version))throw new Error('Invalid version');const binary=path.join(softwareDir(dataDir),active.version,binaryName());if(!(await fs.lstat(binary)).isFile())throw new Error('Missing binary');return binary;}catch{return 'ai-workspace';}
}
export async function downloadSoftwareFile(url:string,options:Options,limit=maxBytes):Promise<Buffer> {
  const response=await (options.fetch??fetch)(url,{headers:{'User-Agent':'BB-Project-Spaces','Accept':url.startsWith('https://api.github.com/')?'application/vnd.github+json':'application/octet-stream'},signal:AbortSignal.any([AbortSignal.timeout(90000),...(options.signal?[options.signal]:[])])});
  if(!response.ok)throw new Error(`GitHub: HTTP ${response.status}`);
  if(Number(response.headers.get('content-length'))>limit)throw new Error('Релиз превышает допустимый размер.');
  const chunks:Uint8Array[]=[];let size=0;
  const reader=response.body?.getReader();if(!reader)throw new Error('GitHub вернул пустой ответ.');
  try {while(true){const {value,done}=await reader.read();if(done)break;size+=value.length;if(size>limit)throw new Error('Релиз превышает допустимый размер.');chunks.push(value);}}finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
  return Buffer.concat(chunks);
}
const download=downloadSoftwareFile;
export async function latestWorkspaceRelease(options:Options={}):Promise<{release:Release;checkedAt:number}> {
  if(!options.fetch&&cached&&Date.now()-cached.checkedAt<10*60*1000)return cached;
  const raw=await download('https://api.github.com/repos/lee-to/ai-workspace/releases/latest',options,2*1024*1024);
  const release=releaseSchema.parse(JSON.parse(raw.toString('utf8')));
  const result={release,checkedAt:Date.now()};if(!options.fetch)cached=result;return result;
}

export async function inspectWorkspaceSoftware(dataDir:string,checkLatest:boolean,options:Options={}) {
  const binary=options.binary??await workspaceExecutable(dataDir);let installedVersion:string|null=null,localError:string|null=null;
  try {installedVersion=parseWorkspaceVersion(await workspaceCommand(['--version'],{cwd:dataDir,binary,signal:options.signal}));if(!installedVersion)localError='CLI вернул неизвестный формат версии.';}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')localError=String(error);}
  let release=options.fetch?null:cached,error=localError;
  if(checkLatest)try{release=await latestWorkspaceRelease(options);}catch(cause){error=`Проверка обновлений не выполнена: ${cause instanceof Error?cause.message:String(cause)}`;}
  const latestVersion=release?.release.tag_name.slice(1)??null,assetName=releaseAssetName();
  return {installedVersion,binary:installedVersion?binary:null,managed:!!installedVersion&&path.isAbsolute(binary)&&binary.startsWith(softwareDir(dataDir)+path.sep),latestVersion,releaseUrl:latestVersion?`https://github.com/lee-to/ai-workspace/releases/tag/v${latestVersion}`:null,checkedAt:release?.checkedAt??null,updateAvailable:!!(latestVersion&&installedVersion&&newerVersion(latestVersion,installedVersion)),supported:!!assetName,error};
}

/** Extract one regular executable in memory. Archive paths never become disk paths. */
export function extractWorkspaceBinary(archive:Buffer,assetName:string,binaryPath?:string):Buffer {
  const name=binaryPath??(assetName.endsWith('.zip')?'ai-workspace.exe':'ai-workspace');
  if(assetName.endsWith('.zip')){
    let count=0;const files=unzipSync(archive,{filter:file=>{if(file.name!==name)return false;count++;if(file.originalSize>maxBytes)throw new Error('Бинарник слишком большой.');return true;}});
    if(count!==1||!files[name]?.length)throw new Error('В ZIP нет единственного бинарника ai-workspace.');return Buffer.from(files[name]);
  }
  const tar=gunzipSync(archive,{maxOutputLength:maxBytes});let found:Buffer|null=null;
  for(let offset=0;offset+512<=tar.length;){
    const header=tar.subarray(offset,offset+512);if(header.every(b=>b===0))break;
    const entry=header.subarray(0,100).toString().split('\0')[0],size=parseInt(header.subarray(124,136).toString().replace(/\0/g,'').trim(),8);
    if(!Number.isSafeInteger(size)||size<0||offset+512+size>tar.length)throw new Error('Неверный TAR архив.');
    if(entry===name||entry==='./'+name){if(found||(header[156]!==0&&header[156]!==48)||header.subarray(345,500).some(b=>b!==0))throw new Error('Неверный тип бинарника в TAR.');found=Buffer.from(tar.subarray(offset+512,offset+512+size));}
    offset+=512+Math.ceil(size/512)*512;
  }
  if(!found?.length)throw new Error('В TAR нет бинарника ai-workspace.');return found;
}

export async function installWorkspaceSoftware(dataDir:string,options:Options={}) {
  const {release}=await latestWorkspaceRelease(options),version=release.tag_name.slice(1),assetName=releaseAssetName();
  if(!assetName)throw new Error(`Нет готового релиза для ${process.platform}/${process.arch}.`);
  const current=await inspectWorkspaceSoftware(dataDir,false,options);if(current.installedVersion&&newerVersion(current.installedVersion,version))throw new Error('Установлена более новая версия. Понижение версии не выполняется.');
  const asset=release.assets.find(a=>a.name===assetName);if(!asset||asset.size>maxBytes)throw new Error('В релизе нет подходящего архива.');
  const prefix=`https://github.com/lee-to/ai-workspace/releases/download/${release.tag_name}/`;
  if(asset.browser_download_url!==prefix+assetName)throw new Error('Неверный адрес релиза.');
  let expected=asset.digest?.match(/^sha256:([a-f0-9]{64})$/)?.[1];
  if(!expected){const checksum=release.assets.find(a=>a.name==='SHA256SUMS.txt');if(checksum?.browser_download_url!==prefix+'SHA256SUMS.txt')throw new Error('В релизе нет SHA-256.');const text=(await download(checksum.browser_download_url,options,128*1024)).toString();expected=text.split(/\r?\n/).map(line=>/^([a-f0-9]{64})\s+\*?(.+)$/.exec(line)).find(match=>match?.[2]===assetName)?.[1];}
  if(!expected)throw new Error('Не найдена контрольная сумма архива.');
  const archive=await download(asset.browser_download_url,options);
  if(archive.length!==asset.size||createHash('sha256').update(archive).digest('hex')!==expected)throw new Error('SHA-256 или размер архива не совпадает. Установка отменена.');
  const bytes=extractWorkspaceBinary(archive,assetName),root=softwareDir(dataDir);await fs.mkdir(root,{recursive:true});
  const stage=await fs.mkdtemp(path.join(root,'install-')),binary=path.join(stage,binaryName());
  try {
    await fs.writeFile(binary,bytes,{mode:0o755,flag:'wx'});
    const actual=parseWorkspaceVersion(await workspaceCommand(['--version'],{cwd:dataDir,binary,signal:options.signal}));
    if(actual!==version)throw new Error(`Версия бинарника ${actual??'неизвестна'} не совпадает с релизом ${version}.`);
    const destination=path.join(root,version);let exists=false;try{await fs.lstat(destination);exists=true;}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
    if(exists){const actualExisting=parseWorkspaceVersion(await workspaceCommand(['--version'],{cwd:dataDir,binary:path.join(destination,binaryName()),signal:options.signal}));if(actualExisting!==version)throw new Error('Существующая управляемая копия повреждена.');}
    else await fs.rename(stage,destination);
    const temp=path.join(root,'active-'+randomUUID()+'.json');await fs.writeFile(temp,JSON.stringify({version,sha256:expected,installedAt:Date.now()}));await fs.rename(temp,path.join(root,'active.json'));
    return inspectWorkspaceSoftware(dataDir,false,options);
  }finally{if(!path.resolve(stage).startsWith(path.resolve(root)+path.sep))throw new Error('Неверный путь временной установки.');await fs.rm(stage,{recursive:true,force:true,maxRetries:5,retryDelay:100});}
}
