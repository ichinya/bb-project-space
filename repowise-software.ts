import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createHash,randomUUID } from 'node:crypto';
import { z } from 'zod';
import { newerVersion } from './workspace-software.ts';
import { managedUvExecutable,ensureManagedUv,uvAssetName } from './managed-uv.ts';

const versionPattern=/^\d+\.\d+\.\d+$/;
const slotPattern=/^\d+\.\d+\.\d+-[a-f0-9-]{36}$/;
const maxBytes=96*1024*1024;
const releaseSchema=z.object({info:z.object({version:z.string().regex(versionPattern)}),urls:z.array(z.object({filename:z.string(),url:z.string().url(),size:z.number().int().positive(),digests:z.object({sha256:z.string().regex(/^[a-f0-9]{64}$/)})}))});
type Release=z.infer<typeof releaseSchema>;
type RunOptions={cwd:string;signal?:AbortSignal;timeoutMs?:number;env?:NodeJS.ProcessEnv};
type Runner=(binary:string,args:string[],options:RunOptions)=>Promise<string>;
type Options={signal?:AbortSignal;fetch?:typeof fetch;run?:Runner};
type Runtime={kind:'uv'|'python';binary:string;prefix:string[]};
let cached:{release:Release;checkedAt:number}|null=null;
const rootAt=(dataDir:string)=>path.join(dataDir,'software','repowise');
const executableAt=(directory:string,name:'python'|'repowise')=>path.join(directory,process.platform==='win32'?'Scripts':'bin',name+(process.platform==='win32'?'.exe':''));

async function environmentRoot(dataDir:string):Promise<string>{
  const root=rootAt(dataDir);if(process.platform!=='win32'||root.length<=100)return root;
  const local=process.env.LOCALAPPDATA;if(!local||!path.isAbsolute(local))throw new Error('Для длинного пути профиля нужен LOCALAPPDATA с абсолютным путём.');
  const alias=path.join(local,'bb','ps','r'+createHash('sha256').update(path.resolve(root).toLowerCase()).digest('hex').slice(0,16));
  await fs.mkdir(alias,{recursive:true});if((await fs.lstat(alias)).isSymbolicLink())throw new Error('Короткий путь Repowise не должен быть ссылкой.');
  const ownerFile=path.join(alias,'.project-spaces-owner.json'),identity=path.resolve(root).toLowerCase();
  try{await fs.writeFile(ownerFile,JSON.stringify({root:identity}),{flag:'wx'});}catch(cause){if((cause as NodeJS.ErrnoException).code!=='EEXIST')throw cause;}
  if(JSON.parse(await fs.readFile(ownerFile,'utf8')).root!==identity)throw new Error('Короткий путь Repowise занят другой папкой.');
  return alias;
}

export const softwareCommand:Runner=(binary,args,options)=>new Promise((resolve,reject)=>{
  const child=spawn(binary,args,{cwd:options.cwd,env:options.env??process.env,signal:options.signal,shell:false,windowsHide:true});
  let output='',errors='',done=false;
  const finish=(error?:Error)=>{if(done)return;done=true;clearTimeout(timer);child.stdin.destroy();child.stdout.destroy();child.stderr.destroy();error?reject(error):resolve(output);};
  const timer=setTimeout(()=>{child.kill();finish(new Error('Установка Repowise: превышено время ожидания.'));},options.timeoutMs??600000);
  child.stdout.on('data',chunk=>{output=(output+chunk).slice(-12000);});child.stderr.on('data',chunk=>{errors=(errors+chunk).slice(-12000);});
  const exited=(code:number|null)=>finish(code===0?undefined:new Error(errors.trim()||output.trim()||`${path.basename(binary)} завершился с кодом ${code}.`));
  child.on('error',finish);child.on('exit',exited);child.on('close',exited);
});

export function parseRepowiseVersion(text:string):string|null{return /^(?:repowise(?:,?\s+version)?\s+)?v?(\d+\.\d+\.\d+)\s*$/i.exec(text.trim())?.[1]??null;}
export async function repowiseExecutable(dataDir:string):Promise<string>{
  try{
    const active=JSON.parse(await fs.readFile(path.join(rootAt(dataDir),'active.json'),'utf8'));
    if(!versionPattern.test(active.version)||!slotPattern.test(active.slot)||!active.slot.startsWith(active.version+'-'))return 'repowise';
    const root=active.shortPath?await environmentRoot(dataDir):rootAt(dataDir),binary=executableAt(path.join(root,active.slot),'repowise');return (await fs.lstat(binary)).isFile()?binary:'repowise';
  }catch{return 'repowise';}
}
async function runtimeAt(dataDir:string,options:Options):Promise<Runtime|null>{
  const run=options.run??softwareCommand;
  const managed=await managedUvExecutable(dataDir);if(managed){try{await run(managed,['--version'],{cwd:dataDir,signal:options.signal,timeoutMs:10000});return {kind:'uv',binary:managed,prefix:[]};}catch{if(options.signal?.aborted)throw options.signal.reason;}}
  try{await run('uv',['--version'],{cwd:dataDir,signal:options.signal,timeoutMs:10000});return {kind:'uv',binary:'uv',prefix:[]};}catch{if(options.signal?.aborted)throw options.signal.reason;}
  if(uvAssetName())return null; // Managed uv also supplies Python, including hosts without ensurepip.
  for(const binary of process.platform==='win32'?['python','python3','py']:['python3','python']){
    const prefix=binary==='py'?['-3']:[];
    try{const output=await run(binary,[...prefix,'-c','import sys; print("%d.%d" % sys.version_info[:2])'],{cwd:dataDir,signal:options.signal,timeoutMs:10000});const parts=/^(\d+)\.(\d+)$/.exec(output.trim());if(parts&&Number(parts[1])===3&&Number(parts[2])>=11)return {kind:'python',binary,prefix};}catch{if(options.signal?.aborted)throw options.signal.reason;}
  }
  return null;
}
async function download(url:string,options:Options,limit:number):Promise<Buffer>{
  const response=await (options.fetch??fetch)(url,{headers:{'User-Agent':'BB-Project-Spaces','Accept':url.endsWith('/json')?'application/json':'application/octet-stream'},signal:AbortSignal.any([AbortSignal.timeout(90000),...(options.signal?[options.signal]:[])])});
  if(!response.ok)throw new Error(`PyPI: HTTP ${response.status}`);
  if(Number(response.headers.get('content-length'))>limit)throw new Error('Файл Repowise превышает допустимый размер.');
  const reader=response.body?.getReader();if(!reader)throw new Error('PyPI вернул пустой ответ.');
  const chunks:Uint8Array[]=[];let size=0;
  try{while(true){const {value,done}=await reader.read();if(done)break;size+=value.length;if(size>limit)throw new Error('Файл Repowise превышает допустимый размер.');chunks.push(value);}}finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
  return Buffer.concat(chunks);
}
async function latestRelease(options:Options,force=false){
  if(!options.fetch&&!force&&cached&&Date.now()-cached.checkedAt<600000)return cached;
  const release=releaseSchema.parse(JSON.parse((await download('https://pypi.org/pypi/repowise/json',options,8*1024*1024)).toString('utf8'))),result={release,checkedAt:Date.now()};
  if(!options.fetch)cached=result;return result;
}
export async function inspectRepowiseSoftware(dataDir:string,checkLatest:boolean,options:Options={}){
  const binary=await repowiseExecutable(dataDir),run=options.run??softwareCommand;let installedVersion:string|null=null,error:string|null=null;
  try{installedVersion=parseRepowiseVersion(await run(binary,['--version'],{cwd:dataDir,signal:options.signal,timeoutMs:10000}));if(!installedVersion)error='Repowise вернул неизвестный формат версии.';}catch(cause){if((cause as NodeJS.ErrnoException).code!=='ENOENT')error=cause instanceof Error?cause.message:String(cause);}
  let release=options.fetch?null:cached;
  if(checkLatest)try{release=await latestRelease(options,true);}catch(cause){error=`Проверка обновлений не выполнена: ${cause instanceof Error?cause.message:String(cause)}`;}
  const latestVersion=release?.release.info.version??null,runtime=await runtimeAt(dataDir,options);
  return {installedVersion,binary:installedVersion?binary:null,managed:!!installedVersion&&path.isAbsolute(binary),latestVersion,releaseUrl:latestVersion?`https://pypi.org/project/repowise/${latestVersion}/`:null,checkedAt:release?.checkedAt??null,updateAvailable:!!(installedVersion&&latestVersion&&newerVersion(latestVersion,installedVersion)),supported:!!runtime||!!uvAssetName(),installer:runtime?.kind??(uvAssetName()?'uv':null),error};
}

/** An isolated virtual environment is activated only after the installed CLI reports the pinned version. */
export async function installRepowiseSoftware(dataDir:string,options:Options={}){
  const root=rootAt(dataDir);await fs.mkdir(root,{recursive:true});
  let lock:Awaited<ReturnType<typeof fs.open>>;
  const lockPath=path.join(root,'install.lock');
  try{lock=await fs.open(lockPath,'wx');}catch(cause){
    if((cause as NodeJS.ErrnoException).code!=='EEXIST')throw cause;
    let stale=false;
    try{const owner=JSON.parse(await fs.readFile(lockPath,'utf8'));if(Number.isInteger(owner.pid)&&owner.pid>0){try{process.kill(owner.pid,0);}catch(error){stale=(error as NodeJS.ErrnoException).code==='ESRCH';}}}catch{stale=Date.now()-(await fs.stat(lockPath)).mtimeMs>3600000;}
    if(!stale)throw new Error('Установка Repowise на этом устройстве уже выполняется.');
    await fs.rm(lockPath);lock=await fs.open(lockPath,'wx');
  }
  let destination:string|null=null,temp:string|null=null,activated=false,installRoot=root;
  try{
    await lock.writeFile(JSON.stringify({pid:process.pid,startedAt:Date.now()}));
    const {release}=await latestRelease(options,true),version=release.info.version,current=await inspectRepowiseSoftware(dataDir,false,options);
    if(current.installedVersion&&newerVersion(current.installedVersion,version))throw new Error('Установлена более новая версия Repowise. Понижение версии не выполняется.');
    installRoot=await environmentRoot(dataDir);
    if(current.installedVersion===version&&current.managed&&current.binary?.startsWith(installRoot+path.sep)){
      try{await (options.run??softwareCommand)(current.binary,['init','--help'],{cwd:dataDir,signal:options.signal,timeoutMs:60000});return current;}catch{if(options.signal?.aborted)throw options.signal.reason;}
    }
    let runtime=await runtimeAt(dataDir,options);
    if(runtime?.kind!=='uv'&&uvAssetName())runtime={kind:'uv',binary:await ensureManagedUv(dataDir,{...options,verify:binary=>(options.run??softwareCommand)(binary,['--version'],{cwd:dataDir,signal:options.signal,timeoutMs:10000})}),prefix:[]};
    if(!runtime)throw new Error('Для установки Repowise нужен uv или Python 3.11+ на выбранном устройстве.');
    const filename=`repowise-${version}-py3-none-any.whl`,asset=release.urls.find(item=>item.filename===filename);
    if(!asset||asset.size>maxBytes)throw new Error('В PyPI нет подходящего пакета Repowise.');
    const url=new URL(asset.url);if(url.protocol!=='https:'||url.hostname!=='files.pythonhosted.org'||url.username||url.password||url.search||url.hash||!url.pathname.endsWith('/'+filename))throw new Error('Неверный адрес пакета Repowise.');
    const wheel=await download(asset.url,options,maxBytes);if(wheel.length!==asset.size||createHash('sha256').update(wheel).digest('hex')!==asset.digests.sha256)throw new Error('SHA-256 или размер пакета Repowise не совпадает. Установка отменена.');
    const slot=version+'-'+randomUUID();destination=path.join(installRoot,slot);await fs.mkdir(destination);
    const env:NodeJS.ProcessEnv={...process.env,UV_CACHE_DIR:path.join(dataDir,'software','uv-cache'),UV_PYTHON_INSTALL_DIR:path.join(installRoot,'_python'),UV_NO_PROGRESS:'1',PIP_CONFIG_FILE:process.platform==='win32'?'NUL':'/dev/null',PIP_NO_INPUT:'1',REPOWISE_SKIP_EDITOR_SETUP:'1',PYTHONIOENCODING:'utf-8',NO_COLOR:'1'};
    for(const key of ['VIRTUAL_ENV','PYTHONHOME','PYTHONPATH','PIP_INDEX_URL','PIP_EXTRA_INDEX_URL','PIP_TRUSTED_HOST','UV_INDEX_URL','UV_EXTRA_INDEX_URL','UV_DEFAULT_INDEX','UV_INDEX'])delete env[key];
    const run=options.run??softwareCommand,runOptions={cwd:dataDir,signal:options.signal,env};
    if(runtime.kind==='uv')await run(runtime.binary,['--no-config','--managed-python','venv','--python','3.12',destination],runOptions);
    else await run(runtime.binary,[...runtime.prefix,'-m','venv',destination],runOptions);
    const wheelPath=path.join(destination,filename);await fs.writeFile(wheelPath,wheel,{flag:'wx'});
    if(runtime.kind==='uv')await run(runtime.binary,['--no-config','pip','install','--python',executableAt(destination,'python'),'--index-url','https://pypi.org/simple',wheelPath],runOptions);
    else await run(executableAt(destination,'python'),['-m','pip','--isolated','install','--disable-pip-version-check','--no-input','--index-url','https://pypi.org/simple',wheelPath],runOptions);
    await fs.rm(wheelPath,{force:true});
    const actual=parseRepowiseVersion(await run(executableAt(destination,'repowise'),['--version'],{...runOptions,timeoutMs:30000}));if(actual!==version)throw new Error(`Версия Repowise ${actual??'неизвестна'} не совпадает с пакетом ${version}.`);
    await run(executableAt(destination,'repowise'),['init','--help'],{...runOptions,timeoutMs:60000});
    await run(executableAt(destination,'repowise'),['mcp','--help'],{...runOptions,timeoutMs:60000});
    const latestInstalled=await inspectRepowiseSoftware(dataDir,false,options);if(latestInstalled.installedVersion&&newerVersion(latestInstalled.installedVersion,version))throw new Error('Более новая версия Repowise уже установлена. Понижение версии не выполняется.');
    temp=path.join(root,'active-'+randomUUID()+'.json');await fs.writeFile(temp,JSON.stringify({version,slot,shortPath:installRoot!==root,sha256:asset.digests.sha256,installedAt:Date.now()}),{flag:'wx'});await fs.rename(temp,path.join(root,'active.json'));activated=true;
    return inspectRepowiseSoftware(dataDir,false,options);
  }finally{
    await lock.close();await fs.rm(lockPath,{force:true});if(temp)await fs.rm(temp,{force:true});
    // Venv launchers embed their absolute path, so successful environments are never moved.
    if(destination&&!activated){if(path.dirname(destination)!==installRoot)throw new Error('Неверный путь установки Repowise.');await fs.rm(destination,{recursive:true,force:true,maxRetries:5,retryDelay:100});}
  }
}
