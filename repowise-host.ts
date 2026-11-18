import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash,randomUUID } from 'node:crypto';
import type { z } from 'zod';
import { repowiseRequest,repowiseStatus,repowiseQuery,repowiseReadTools,repowiseStage } from './repowise-contract.ts';
import { repowiseCommand,repowiseMcp,type ProcessOptions } from './repowise-process.ts';
import { folderIdentity } from './folder-project.ts';
import { checkoutFingerprints,checkoutSnapshots,workspaceConfig } from './repowise-freshness.ts';
import { discoverReadTools } from './tool-discovery.ts';

type Request=z.infer<typeof repowiseRequest>;
type Status=z.infer<typeof repowiseStatus>;
const message=(error:unknown)=>error instanceof Error?error.message:String(error);
const hash=(text:string)=>createHash('sha256').update(text).digest('hex');
const jobs=new Map<string,Promise<void>>();
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
type Stage=z.infer<typeof repowiseStage>;
type State={updatedAt?:number;roots?:Record<string,string>;fingerprints?:Record<string,string|null>;error?:string;stage?:Stage;failedAt?:number};
const activeStages=new Map<string,Stage>();
const retryDelayMs=5*60_000;
const manifestName='.repowise-workspace.yaml';

async function stateAt(directory:string):Promise<State>{
  try{return JSON.parse(await fs.readFile(path.join(directory,'state.json'),'utf8'))??{};}catch{return {};}
}
async function repoIndexed(root:string):Promise<boolean>{
  const base=path.join(root,'.repowise');
  return await exists(path.join(base,'wiki.db'))&&await exists(path.join(base,'state.json'));
}
async function hasIndexedWorkingTree(root:string):Promise<boolean>{
  const state:State&{working_tree_paths?:unknown}=await stateAt(path.join(root,'.repowise'));
  return Array.isArray(state.working_tree_paths)&&state.working_tree_paths.some(file=>typeof file==='string'&&file!==workspaceConfig);
}

export async function inspectRepowise(request:Request,dataDir:string,options:ProcessOptions):Promise<Status>{
  const {directory,roots}=repowiseLayout(request,dataDir),state=await stateAt(directory);
  let version:string|null=null,versionError:string|null=null;
  try{
    const key=options.binary??'repowise';let cached=versions.get(key);
    if(!cached||cached.until<Date.now()){
      cached={until:Date.now()+30000,value:repowiseCommand(['--version'],{...options,timeoutMs:10000}).then(text=>text.trim())};versions.set(key,cached);
    }
    version=await cached.value;
  }catch(cause){if((cause as NodeJS.ErrnoException).code!=='ENOENT')versionError=message(cause);}
  const busy=jobs.has(directory);
  const rows=await Promise.all(roots.map(async root=>{
    const available=await exists(root.path),indexed=available&&await repoIndexed(root.path);
    return {...root,exists:available,indexed,message:state.roots?.[root.alias]??(indexed?'Индекс найден':'Не подготовлен')};
  }));
  // Older releases cleared updatedAt on failure. Recover the readable on-disk
  // indexes conservatively and keep them stale until a new sync completes.
  const prepared=rows.every(root=>root.indexed)&&await exists(path.join(directory,manifestName));
  const stage=activeStages.get(directory)??state.stage??null;
  const interrupted=!!stage&&stage.elapsedMs===undefined&&!busy;
  const previousError=state.error??(interrupted?`Обновление прервано на этапе «${stage.name}».`:null);
  const error=versionError??(!version&&/spawn.*ENOENT/.test(previousError??'')?null:previousError);
  const current=prepared&&!busy?await checkoutFingerprints(roots,options):{};
  const stale=prepared&&(busy||!!previousError||!state.updatedAt||roots.some(root=>current[root.alias]!==null&&current[root.alias]!==state.fingerprints?.[root.alias]));
  const uncertain=prepared&&!busy&&roots.some(root=>current[root.alias]===null);
  const freshnessWarning=stale
    ? 'Доступен сохранённый индекс. Его данные могут быть устаревшими. Сверяйте выводы с исходниками.'
    : uncertain?'Не удалось полностью проверить изменения. Актуальность этих индексов не подтверждена.':null;
  return {available:!!version,version,workspacePath:directory,prepared,stale,freshnessWarning,busy,error,stage,
    retryAt:state.failedAt===undefined?null:state.failedAt+retryDelayMs,updatedAt:state.updatedAt??null,roots:rows};
}

export async function synchronizeRepowise(request:Request,dataDir:string,options:ProcessOptions):Promise<Status>{
  const {directory,roots,manifest}=repowiseLayout(request,dataDir);
  const running=jobs.get(directory);
  if(running){await running;return inspectRepowise(request,dataDir,options);}
  const operation=serialize(async()=>{
    options.signal?.throwIfAborted();
    const state=await stateAt(directory),stateFile=path.join(directory,'state.json');
    const save=()=>atomic(stateFile,state);
    async function runStage<T>(name:string,run:(stage:Stage)=>Promise<T>,alias?:string):Promise<T>{
      options.signal?.throwIfAborted();
      const stage:Stage={name,...(alias?{alias}:{}),startedAt:Date.now()};
      state.stage=stage;activeStages.set(directory,stage);await save();
      try{return await run(stage);}
      finally{stage.elapsedMs=Date.now()-stage.startedAt;await save();}
    }
    try{
      const pending=!!state.error||!!state.failedAt||!state.updatedAt||!!(state.stage&&state.stage.elapsedMs===undefined);
      const before=await runStage('Проверка изменений',()=>checkoutSnapshots(roots,options));
      const indexes=await Promise.all(roots.map(root=>repoIndexed(root.path)));
      const hasManifest=await exists(path.join(directory,manifestName));
      if(!pending&&hasManifest&&indexes.every(Boolean)&&roots.every(root=>{
        const current=before[root.alias]?.fingerprint;
        return !!current&&current===state.fingerprints?.[root.alias];
      }))return;

      await atomic(path.join(directory,manifestName),manifest);
      state.roots={...state.roots};
      const failures:string[]=[];
      for(const [index,root] of roots.entries()){
        if(!await exists(root.path)){
          state.roots[root.alias]='Папка недоступна';failures.push(`${root.name}: папка недоступна`);
          continue;
        }
        const current=before[root.alias];
        const plainChanged=current?.kind==='folder'&&(!indexes[index]||!current.fingerprint||current.fingerprint!==state.fingerprints?.[root.alias]);
        // The workspace scanner can skip a now-clean Git tree even when the
        // last index contained local edits. The single-repo updater reconciles
        // its persisted working_tree_paths in that specific case.
        const reverted=current?.kind==='git'&&current.dirty===false&&indexes[index]&&
          (pending||current.fingerprint!==state.fingerprints?.[root.alias])&&await hasIndexedWorkingTree(root.path);
        const bootstrap=!indexes[index];
        if(!bootstrap&&!plainChanged&&!reverted)continue;
        const rootOptions={...options,cwd:root.path,timeoutMs:options.timeoutMs??900000,safePaths:[root.path],requireSuccess:true};
        state.roots[root.alias]='Индексация…';
        const stageName=bootstrap?'Первичная индексация':plainChanged?'Индексация папки':'Восстановление индекса после отмены правок';
        await runStage(stageName,async()=>{
          if(bootstrap||plainChanged){
            await repowiseCommand(['init',root.path,'--mode','fast','--yes','--no-prose','--no-save-key','--no-editor-setup','--no-hook','--no-workspace','--exclude','.bb/','--exclude',workspaceConfig],rootOptions);
          }else{
            await repowiseCommand(['update',root.path,'--no-workspace','--index-only','--working-tree','--no-agents'],rootOptions);
          }
        },root.alias);
        state.roots[root.alias]='Индекс готов';
      }
      if(failures.length)throw new Error(failures.join('\n'));

      // Repowise performs the Git updates and cross-repository analysis in one
      // workspace run. A prior single-repo update would make dirty Git trees run twice.
      await runStage('Обновление пространства Repowise',async stage=>{
        const failed=new Set<string>();
        const known=new Set(roots.map(root=>root.alias));
        let buffer='';
        const progress=(chunk:string)=>{
          buffer=(buffer+chunk).slice(-8000);
          const lines=buffer.split(/\r?\n/);buffer=lines.pop()??'';
          for(const raw of lines){
            // Strip terminal formatting before looking for the native phase/repo rows.
            const line=raw.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g,'').trim();
            const issue=/^[✗↻]\s+([a-z0-9-]+):/.exec(line);
            if(issue&&known.has(issue[1]!))failed.add(issue[1]!);
            if(/^(?:Updating |Running cross-repo analysis|Workspace settings changed|[✓✗↻]\s)/.test(line))stage.progress=line.slice(0,240);
          }
        };
        // New indexes already describe the files on disk. Repowise's
        // workspace-level check needs the working tree only for existing members.
        const workingTree=roots.some((root,index)=>indexes[index]&&(before[root.alias]?.kind==='unknown'||before[root.alias]?.dirty));
        await repowiseCommand(['workspace','update','--index-only','--no-agents',...(workingTree?['--working-tree']:[])],{
          ...options,cwd:directory,timeoutMs:options.timeoutMs??900000,safePaths:roots.map(root=>root.path),requireSuccess:true,onOutput:progress,
        });
        progress('\n');
        if(failed.size)throw new Error(`Repowise не завершил обновление: ${[...failed].join(', ')}.`);
        const indexed=await Promise.all(roots.map(root=>repoIndexed(root.path)));
        const missing=roots.filter((_,index)=>!indexed[index]);
        if(missing.length)throw new Error(`Repowise не создал индекс: ${missing.map(root=>root.name).join(', ')}.`);
      });
      state.updatedAt=Date.now();
      state.fingerprints=Object.fromEntries(roots.map(root=>[root.alias,before[root.alias]?.fingerprint??null]));
      state.roots=Object.fromEntries(roots.map(root=>[root.alias,'Индекс готов']));
      delete state.error;delete state.failedAt;
      await save();
    }catch(cause){
      const stage=state.stage;
      const prefix=stage?`Этап «${stage.name}»${stage.alias?` (${stage.alias})`:''}, ${Math.round((stage.elapsedMs??0)/1000)} с. `:'';
      state.error=(prefix+message(cause)).slice(0,3000);state.failedAt=Date.now();await save();
      throw new Error(state.error,{cause});
    }
  });
  jobs.set(directory,operation);
  try{await operation;}finally{jobs.delete(directory);activeStages.delete(directory);}
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
  if(status.stale&&!status.error&&query.operation==='call'&&query.tool!=='get_overview')throw new Error('После индексации изменились файлы или коммит. Вызовите operation=prepare и дождитесь busy=false, prepared=true, stale=false.');
  const calls=repowiseCalls(query,layout.roots.map(r=>r.alias));
  const results=await repowiseMcp(layout.directory,calls,{...options,safePaths:layout.roots.map(r=>r.path)});
  if(query.operation==='list_tools')return discoverReadTools(results[0],new Set(repowiseReadTools),query.tool);
  return {scope:layout.roots,stale:!!status.stale,updatedAt:status.updatedAt,freshnessWarning:status.freshnessWarning??null,results:results.map((result,index)=>({repo:(calls[index]!.params as {arguments:{repo:string}}).arguments.repo,...unpack(result) as object}))};
}
