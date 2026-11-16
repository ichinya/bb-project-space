import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { workspaceCommand,workspaceMcp,mcpJson,type WorkspaceOptions } from './workspace-process.ts';
import type { z } from 'zod';
import { workspaceRequest,workspaceStatus } from './workspace-contract.ts';

type Request=z.infer<typeof workspaceRequest>;
type Status=z.infer<typeof workspaceStatus>;
type Config=Record<string,unknown>&{name:string;groups?:string[]};
type Member={path:string;group:string;owners:string[];original:boolean};
type State={members:Member[]};
type Registered={path:string;name:string;groups:{name:string}[]};
const key=(value:string)=>process.platform==='win32'?path.resolve(value.replace(/^\\\\\?\\/,'')).toLowerCase():path.resolve(value);
const message=(error:unknown)=>error instanceof Error?error.message:String(error);

/** Native ai-workspace accepts literal shared paths, never glob patterns. */
function validateSharedPaths(config:Config|null) {
  if(!Array.isArray(config?.share))return;
  for(const entry of config.share){
    const sharedPath=typeof entry==='string'?entry:entry&&typeof entry==='object'?entry.path:null;
    if(typeof sharedPath==='string'&&/[*?\[\]{}]/.test(sharedPath))throw new Error(`В .ai-workspace.json → share указан шаблон ${JSON.stringify(sharedPath)}. ai-workspace принимает только точные пути к файлам и папкам: например, "docs" вместо "docs/*". Исправьте конфиг и повторите инициализацию.`);
  }
}

async function configAt(root:string):Promise<{file:string;config:Config|null;raw:string|null}> {
  const file=path.join(root,'.ai-workspace.json');
  try {
    const stat=await fs.lstat(file);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>1024*1024)throw new Error('Небезопасный или слишком большой .ai-workspace.json.');
    const raw=await fs.readFile(file,'utf8'),config=JSON.parse(raw.replace(/^\uFEFF/,''));
    if(!config||typeof config!=='object'||Array.isArray(config)||typeof config.name!=='string'||(config.groups!==undefined&&(!Array.isArray(config.groups)||config.groups.some((g:unknown)=>typeof g!=='string'))))throw new Error('Неверный формат .ai-workspace.json. Файл сохранён без изменений.');
    const allowed=new Set(['ai_workspace_config_version','name','slug','groups','share','notes']);
    if(Object.keys(config).some(key=>!allowed.has(key)))throw new Error('Конфиг содержит неизвестные ai-workspace поля. Файл сохранён без изменений.');
    return {file,config,raw};
  }catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return {file,config:null,raw:null};throw error;}
}

async function updateGroups(root:string,groups:string[],dataDir:string) {
  const current=await configAt(root);if(!current.config)throw new Error('Конфиг не создан командой export.');
  if(JSON.stringify(current.config.groups??[])===JSON.stringify(groups))return;
  await fs.mkdir(path.join(dataDir,'config-backups'),{recursive:true});
  await fs.writeFile(path.join(dataDir,'config-backups',randomUUID()+'.json'),JSON.stringify({path:current.file,content:current.raw}),{flag:'wx'});
  if((await fs.readFile(current.file,'utf8'))!==current.raw)throw new Error('Конфиг изменился параллельно. Повторите синхронизацию.');
  const temp=current.file+'.project-spaces-'+randomUUID();
  try {await fs.writeFile(temp,JSON.stringify({...current.config,groups},null,2)+'\n',{flag:'wx'});const check=await fs.lstat(current.file);if(check.isSymbolicLink())throw new Error('Конфиг заменён ссылкой.');await fs.rename(temp,current.file);}finally{await fs.rm(temp,{force:true});}
}

async function registered(options:WorkspaceOptions):Promise<Registered[]> {
  return mcpJson(await workspaceMcp('tools/call',{name:'list_projects',arguments:{}},options,undefined,true)) as Registered[];
}

export async function inspectWorkspace(request:Request,options:WorkspaceOptions):Promise<Status> {
  let version:string|null=null;
  try {
    version=(await workspaceCommand(['--version'],options)).trim();
    const projects=await registered(options);
    const folders=await Promise.all(request.roots.map(async root=>{
      const result={...root,exists:false,initialized:false,groups:[] as string[],configPath:path.join(root.path,'.ai-workspace.json'),configExists:false,configGroups:[] as string[],error:null as string|null};
      try {const canonical=await fs.realpath(root.path);if(!(await fs.stat(canonical)).isDirectory())throw new Error('Путь не является папкой.');result.exists=true;const project=projects.find(p=>key(p.path)===key(canonical));result.initialized=!!project;result.groups=project?.groups.map(g=>g.name)??[];const config=await configAt(canonical);result.configExists=!!config.config;result.configGroups=config.config?.groups??[];validateSharedPaths(config.config);}catch(error){result.error=message(error);}return result;
    }));
    return {available:true,version,group:request.group,error:null,folders};
  }catch(error){return {available:false,version,group:request.group,error:message(error),folders:[]};}
}

export async function synchronizeWorkspace(request:Request,dataDir:string,options:WorkspaceOptions) {
  const stateFile=path.join(dataDir,'workspace-memberships.json');
  let state:State={members:[]};try{state=JSON.parse(await fs.readFile(stateFile,'utf8'));}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
  await fs.mkdir(dataDir,{recursive:true});
  const persist=async()=>{const temp=stateFile+'.tmp';await fs.writeFile(temp,JSON.stringify(state,null,2));await fs.rename(temp,stateFile);};
  const results:{path:string;ok:boolean;message:string}[]=[];
  const projects=await registered(options);
  const desired=new Set<string>();
  for(const root of request.roots){
    try {
      const canonical=await fs.realpath(root.path);if(!(await fs.stat(canonical)).isDirectory())throw new Error('Путь не является папкой.');desired.add(key(canonical));
      const existing=projects.find(p=>key(p.path)===key(canonical));
      const before=await configAt(canonical);
      validateSharedPaths(before.config);
      let member=state.members.find(m=>key(m.path)===key(canonical)&&m.group===request.group);
      if(!member){member={path:canonical,group:request.group,owners:[],original:(existing?.groups??[]).some(g=>g.name===request.group)||(before.config?.groups??[]).includes(request.group)};state.members.push(member);}
      if(!member.owners.includes(request.spaceId))member.owners.push(request.spaceId);
      // Journal ownership before invoking the CLI so a failed/partial run is retryable.
      await persist();
      const local={...options,cwd:canonical};
      if(!before.config){await workspaceCommand(['init',`--group=${request.group}`,...(existing?[]:[`--name=${root.name}`])],local);await workspaceCommand(['export'],local);}
      const config=await configAt(canonical);
      await updateGroups(canonical,[...new Set([...(config.config?.groups??[]),request.group])],dataDir);
      // init reconciles only this checkout's config; CLI sync also prunes other projects.
      await workspaceCommand(['init'],local);
      results.push({path:root.path,ok:true,message:existing?'Конфиг и группа обновлены.':'Инициализация и конфиг созданы.'});
    }catch(error){results.push({path:root.path,ok:false,message:message(error)});}
  }
  // A failed new root must not cause old membership to be removed.
  if(results.every(row=>row.ok))for(const member of [...state.members]){
    if(!member.owners.includes(request.spaceId)||(member.group===request.group&&desired.has(key(member.path))))continue;
    try {
      const otherOwners=member.owners.filter(id=>id!==request.spaceId);
      if(!otherOwners.length&&!member.original){
        const config=await configAt(member.path);
        if(config.config){await updateGroups(member.path,(config.config.groups??[]).filter(g=>g!==member.group),dataDir);await workspaceCommand(['init'],{...options,cwd:member.path});}
        else await workspaceCommand(['leave',member.group],{...options,cwd:member.path});
      }
      member.owners=otherOwners;if(!otherOwners.length)state.members=state.members.filter(m=>m!==member);await persist();
      results.push({path:member.path,ok:true,message:'Старая привязка пространства снята. Файлы и регистрация сохранены.'});
    }catch(error){results.push({path:member.path,ok:false,message:message(error)});}
  }
  return {status:await inspectWorkspace(request,options),results};
}
