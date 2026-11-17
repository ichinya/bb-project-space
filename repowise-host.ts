import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash,randomUUID } from 'node:crypto';
import type { z } from 'zod';
import { repowiseRequest,repowiseStatus,repowiseQuery,repowiseReadTools } from './repowise-contract.ts';
import { repowiseCommand,repowiseMcp,type ProcessOptions } from './repowise-process.ts';
import { folderIdentity } from './folder-project.ts';
import { checkoutFingerprints } from './repowise-freshness.ts';
import { discoverReadTools } from './tool-discovery.ts';

type Request=z.infer<typeof repowiseRequest>;
type Status=z.infer<typeof repowiseStatus>;
const message=(error:unknown)=>error instanceof Error?error.message:String(error);
const hash=(text:string)=>createHash('sha256').update(text).digest('hex');
const jobs=new Map<string,Promise<void>>();
const indexes=new Map<string,Promise<void>>();
let writeQueue:Promise<unknown>=Promise.resolve();
function serialize<T>(run:()=>Promise<T>){const next=writeQueue.then(run);writeQueue=next.catch(()=>{});return next;}
const versions=new Map<string,{until:number;value:Promise<string>}>();
export function repowiseLayout(raw:Request,dataDir:string){
  const request=repowiseRequest.parse(raw);const seen=new Set<string>();
  const roots=request.roots.filter(root=>{if(!path.isAbsolute(root.path)||/[\x00-\x1f]/.test(root.path))throw new Error('Требуется абсолютный путь папки на выбранном устройстве.');const key=folderIdentity(root.path);if(seen.has(key))return false;seen.add(key);return true;}).map(root=>({...root,alias:(root.name.toLowerCase().replace(/[^a-z0-9-]+/g,'-').replace(/^-|-$/g,'').slice(0,50)||'repo')+'-'+hash(folderIdentity(root.path)).slice(0,8)}));
  const directory=path.join(dataDir,'repowise',request.spaceId,hash(JSON.stringify(roots.map(r=>[folderIdentity(r.path),r.alias]))).slice(0,16));
  return {directory,roots,manifest:{version:1,name:request.name,default_repo:roots[0]!.alias,repos:roots.map(r=>({path:r.path.replace(/\\/g,'/'),alias:r.alias}))}};
}
async function exists(file:string){try{return (await fs.stat(file)).isDirectory()||Boolean((await fs.stat(file)).isFile());}catch{return false;}}
async function atomic(file:string,value:unknown){await fs.mkdir(path.dirname(file),{recursive:true});const temp=file+'.'+randomUUID();try{await fs.writeFile(temp,JSON.stringify(value,null,2)+'\n',{flag:'wx'});await fs.rename(temp,file);}finally{await fs.rm(temp,{force:true});}}
async function stateAt(directory:string):Promise<{updatedAt?:number;roots?:Record<string,string>;fingerprints?:Record<string,string|null>;error?:string}>{try{return JSON.parse(await fs.readFile(path.join(directory,'state.json'),'utf8'));}catch{return {};}}
export async function inspectRepowise(request:Request,dataDir:string,options:ProcessOptions):Promise<Status>{
  const {directory,roots}=repowiseLayout(request,dataDir),state=await stateAt(directory);let version:string|null=null,error:string|null=null;
  try{const key=options.binary??'repowise';let cached=versions.get(key);if(!cached||cached.until<Date.now()){cached={until:Date.now()+30000,value:repowiseCommand(['--version'],{...options,timeoutMs:10000}).then(text=>text.trim())};versions.set(key,cached);}version=await cached.value;}catch(cause){if((cause as NodeJS.ErrnoException).code!=='ENOENT')error=message(cause);}
  const rows=await Promise.all(roots.map(async root=>({...root,exists:await exists(root.path),indexed:await exists(path.join(root.path,'.repowise','wiki.db'))&&await exists(path.join(root.path,'.repowise','state.json')),message:state.roots?.[root.alias]??'Не подготовлен'})));
  const previousError=!version&&/spawn.*ENOENT/.test(state.error??'')?null:state.error;
  const prepared=!!state.updatedAt&&rows.every(r=>r.indexed),current=prepared?await checkoutFingerprints(roots,options):{};
  const stale=prepared&&roots.some(root=>current[root.alias]!==null&&current[root.alias]!==state.fingerprints?.[root.alias]);
  const uncertain=prepared&&roots.some(root=>current[root.alias]===null);
  return {available:!!version,version,workspacePath:directory,prepared,stale,freshnessWarning:uncertain?'Не удалось полностью проверить изменения. Актуальность этих индексов не подтверждена.':null,busy:jobs.has(directory),error:error??previousError??null,updatedAt:state.updatedAt??null,roots:rows};
}
export async function synchronizeRepowise(request:Request,dataDir:string,options:ProcessOptions):Promise<Status>{
  const layout=repowiseLayout(request,dataDir),{directory,roots}=layout;const running=jobs.get(directory);if(running){await running;return inspectRepowise(request,dataDir,options);}
  const operation=(async()=>{
    const state:{updatedAt?:number;roots:Record<string,string>;fingerprints?:Record<string,string|null>;error?:string}={roots:{}};
    await atomic(path.join(directory,'.repowise-workspace.yaml'),layout.manifest);await atomic(path.join(directory,'state.json'),state);
    try{
      const before=await checkoutFingerprints(roots,options);
      const sizes=await Promise.all(roots.map(async root=>({root,size:await fs.stat(path.join(root.path,'.repowise','wiki.db')).then(s=>s.size).catch(()=>0)})));
      const failures:string[]=[];
      // Bootstrap small/new members first; a large primary index must not starve its siblings.
      for(const {root} of sizes.sort((a,b)=>a.size-b.size)){
        try{
        if(!await exists(root.path))throw new Error(`Папка недоступна: ${root.path}`);
        state.roots[root.alias]='Ожидает очереди';await atomic(path.join(directory,'state.json'),state);
        const identity=folderIdentity(root.path);let task=indexes.get(identity);
        if(!task){task=serialize(async()=>{
          state.roots[root.alias]='Индексация…';await atomic(path.join(directory,'state.json'),state);
          const rootOptions={...options,cwd:root.path,timeoutMs:900000,safePaths:[root.path]};
          const initialized=await exists(path.join(root.path,'.repowise','wiki.db'))&&await exists(path.join(root.path,'.repowise','state.json'));
          const initialize=()=>repowiseCommand(['init',root.path,'--mode','fast','--yes','--no-prose','--no-save-key','--no-editor-setup','--no-hook','--no-workspace','--exclude','.bb/'],rootOptions);
          if(initialized){try{await repowiseCommand(['update',root.path,'--no-workspace','--index-only','--working-tree'],rootOptions);}catch(cause){if(/No previous sync found|not initialized|not indexed/i.test(message(cause)))await initialize();else throw cause;}}
          else await initialize();
          if(!await exists(path.join(root.path,'.repowise','wiki.db')))throw new Error('Repowise не создал индекс.');
        });indexes.set(identity,task);void task.finally(()=>{indexes.delete(identity);}).catch(()=>{});}
        await task;state.roots[root.alias]='Индекс готов';await atomic(path.join(directory,'state.json'),state);
        }catch(cause){const failure=message(cause);state.roots[root.alias]='Ошибка: '+failure;failures.push(root.name+': '+failure);await atomic(path.join(directory,'state.json'),state);}
      }
      if(failures.length)throw new Error(failures.join('\n'));
      // The managed workspace references external folders; it never scans their common parent.
      await serialize(()=>repowiseCommand(['workspace','update','--index-only','--working-tree'],{...options,cwd:directory,timeoutMs:900000,safePaths:roots.map(r=>r.path)}));
      state.updatedAt=Date.now();state.fingerprints=before;await atomic(path.join(directory,'state.json'),state);
    }catch(cause){state.error=message(cause);await atomic(path.join(directory,'state.json'),state);throw cause;}
  })();jobs.set(directory,operation);
  try{await operation;}finally{jobs.delete(directory);}
  return inspectRepowise(request,dataDir,options);
}

export function repowiseCalls(query:z.infer<typeof repowiseQuery>,aliases:string[]){
  if(query.operation==='list_tools')return [{method:'tools/list' as const,params:{}}];
  if(!query.tool||!repowiseReadTools.includes(query.tool))throw new Error('Выберите инструмент чтения из list_tools.');
  if(query.repo!=='all'&&!aliases.includes(query.repo))throw new Error('Репозиторий не входит в текущее пространство. Используйте alias из context.');
  const nativeAll=['get_overview','search_codebase','get_dead_code'].includes(query.tool)||(query.tool==='get_why'&&typeof query.arguments?.query==='string');
  const targets=query.repo!=='all'?[query.repo]:nativeAll?['all']:aliases;
  return targets.map(repo=>({method:'tools/call' as const,params:{name:query.tool,arguments:{...query.arguments,repo}}}));
}
function unpack(result:unknown){const value=result as {content?:{type:string;text?:string}[];isError?:boolean};const text=value.content?.filter(c=>c.type==='text').map(c=>c.text??'').join('\n');if(text){try{return {isError:!!value.isError,result:JSON.parse(text)};}catch{return {isError:!!value.isError,result:text};}}return result;}
export function guardRepowisePaths(arguments_:Record<string,unknown>|undefined,roots:{path:string}[]){
  for(const key of ['targets','changed_files','source','target','scope','path','file_path']){
    const values=arguments_?.[key];for(const value of Array.isArray(values)?values:[values]){
      if(typeof value!=='string')continue;
      if(value.split(/[\\/]/).includes('..'))throw new Error('Путь запроса выходит за границы репозитория.');
      if(path.isAbsolute(value)||path.win32.isAbsolute(value)){
        const identity=folderIdentity(value),inside=roots.some(root=>{const parent=folderIdentity(root.path),separator=path.win32.isAbsolute(root.path)?'\\':'/';return identity===parent||identity.startsWith(parent+separator);});
        if(!inside)throw new Error('Путь запроса не входит в текущее пространство.');
      }
    }
  }
}
export async function queryRepowise(request:Request,query:z.infer<typeof repowiseQuery>,dataDir:string,options:ProcessOptions){
  const layout=repowiseLayout(request,dataDir),status=await inspectRepowise(request,dataDir,options);if(query.operation==='context')return status;
  guardRepowisePaths(query.arguments,query.repo==='all'?layout.roots:layout.roots.filter(r=>r.alias===query.repo));
  if(!status.prepared)throw new Error('Индексы этого пространства/checkout не подготовлены. Вызовите operation=prepare, затем context для проверки готовности.');
  if(status.stale)throw new Error('После индексации изменились файлы или коммит. Вызовите operation=prepare и дождитесь busy=false, prepared=true, stale=false.');
  const calls=repowiseCalls(query,layout.roots.map(r=>r.alias));
  const results=await repowiseMcp(layout.directory,calls,{...options,safePaths:layout.roots.map(r=>r.path)});
  if(query.operation==='list_tools')return discoverReadTools(results[0],new Set(repowiseReadTools),query.tool);
  return {scope:layout.roots,freshnessWarning:status.freshnessWarning??null,results:results.map((result,index)=>({repo:(calls[index]!.params as {arguments:{repo:string}}).arguments.repo,...unpack(result) as object}))};
}
