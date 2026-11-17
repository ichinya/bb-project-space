import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID,createHash } from 'node:crypto';
import type { z } from 'zod';
import { agentsRequest,agentsResult } from './agents-contract.ts';
import { managedAgentsBlock } from './agent-context.ts';
const start='<project-space>',end='</project-space>';
type Request=z.infer<typeof agentsRequest>;
type Result=z.infer<typeof agentsResult>['results'][number];

/** Preserve all bytes outside the single owned block, including BOM/newlines. */
export function replaceAgentsBlock(source:string,block:string|null):string{
  const markers=Array.from(source.matchAll(/^(?:<project-space>|<\/project-space>)[ \t]*(?=\r?$)/gm));
  if(markers.length&&(markers.length!==2||markers[0]![0].trim()!==start||markers[1]![0].trim()!==end))throw new Error('В AGENTS.md повреждён или повторён блок project-space. Файл сохранён без изменений.');
  const newline=source.includes('\r\n')?'\r\n':'\n',rendered=block?.replace(/\r?\n/g,newline).replace(/\r?\n$/,'')??'';
  if(markers.length){const first=markers[0]!,last=markers[1]!;return source.slice(0,first.index)+rendered+source.slice(last.index!+last[0].length);}
  return block?source+(source&&!source.endsWith('\n')?newline:'')+(source?newline:'')+rendered+newline:source;
}
async function readAgents(file:string){
  try{const stat=await fs.lstat(file);if(stat.isSymbolicLink()||!stat.isFile()||stat.size>1024*1024||stat.nlink>1)throw new Error('AGENTS.md — ссылка, не обычный файл или больше 1 МБ. Файл сохранён без изменений.');const bytes=await fs.readFile(file);const text=bytes.toString('utf8');if(!Buffer.from(text).equals(bytes))throw new Error('AGENTS.md имеет кодировку, отличную от UTF-8. Файл сохранён без изменений.');return text;}catch(cause){if((cause as NodeJS.ErrnoException).code==='ENOENT')return null;throw cause;}
}
export async function synchronizeAgents(raw:Request,dataDir:string):Promise<z.infer<typeof agentsResult>>{
  const request=agentsRequest.parse(raw),stateFile=path.join(dataDir,'agents-managed.json'),desired=new Map<string,{path:string;spaces:Request['targets'][number]['spaces']}>(),results:Result[]=[];
  const key=(value:string)=>process.platform==='win32'?path.resolve(value).toLowerCase():path.resolve(value);
  let old:string[]=[];try{const state=JSON.parse(await fs.readFile(stateFile,'utf8'));if(!Array.isArray(state.paths)||state.paths.some((value:unknown)=>typeof value!=='string'||!path.isAbsolute(value)))throw new Error('Повреждён журнал AGENTS.md.');old=state.paths;}catch(cause){if((cause as NodeJS.ErrnoException).code!=='ENOENT')throw cause;}
  for(const target of request.targets){try{if(!path.isAbsolute(target.path))throw new Error('Требуется абсолютный путь.');const canonical=await fs.realpath(target.path);if(!(await fs.stat(canonical)).isDirectory())throw new Error('Папка недоступна.');const previous=desired.get(key(canonical));desired.set(key(canonical),{path:canonical,spaces:[...new Map([...(previous?.spaces??[]),...target.spaces].map(space=>[space.id,space])).values()]});}catch(cause){results.push({path:target.path,status:'error',message:String(cause)});}}
  // Do not remove old bindings if a requested target could not be resolved.
  const targets=[...desired.values(),...(results.length?[]:old.filter(root=>!desired.has(key(root))).map(root=>({path:root,spaces:[]})))],retained=new Map(old.map(root=>[key(root),root]));
  await fs.mkdir(dataDir,{recursive:true});
  const persist=async()=>{const temp=stateFile+'.'+randomUUID();try{await fs.writeFile(temp,JSON.stringify({paths:[...retained.values()]},null,2),{flag:'wx'});await fs.rename(temp,stateFile);}finally{await fs.rm(temp,{force:true});}};
  for(const target of targets){try{
    if(key(await fs.realpath(target.path))!==key(target.path)||(await fs.lstat(target.path)).isSymbolicLink())throw new Error('Папка проекта заменена ссылкой. Файлы сохранены без изменений.');
    const file=path.join(target.path,'AGENTS.md'),before=await readAgents(file),after=replaceAgentsBlock(before??'',target.spaces.length?managedAgentsBlock(target.spaces):null);
    if(target.spaces.length&&Buffer.byteLength(after,'utf8')>32768)throw new Error(`AGENTS.md получился ${Buffer.byteLength(after,'utf8')} байт: превышен защитный порог плагина 32 КиБ. Блок не записан. Вынесите справочные разделы в отдельные файлы и оставьте ссылки; остальные инструкции сохранены.`);
    if(before===after||before===null&&!after){results.push({path:target.path,status:'unchanged',message:'Без изменений.'});}
    else{
      if(before!==null){await fs.mkdir(path.join(dataDir,'agents-backups'),{recursive:true});const backup=path.join(dataDir,'agents-backups',createHash('sha256').update(key(file)).digest('hex')+'.json');try{await fs.writeFile(backup,JSON.stringify({path:file,content:before}),{flag:'wx'});}catch(cause){if((cause as NodeJS.ErrnoException).code!=='EEXIST')throw cause;}}
      // Journal ownership before replacing the file, so interrupted writes can
      // be reconciled on the next run. One original backup per path stays bounded.
      if(target.spaces.length){retained.set(key(target.path),target.path);await persist();}
      const temp=file+'.project-spaces-'+randomUUID();
      try{await fs.writeFile(temp,after,{flag:'wx',mode:before!==null?(await fs.stat(file)).mode&0o777:0o666});if(await readAgents(file)!==before||key(await fs.realpath(target.path))!==key(target.path))throw new Error('AGENTS.md или папка изменились параллельно. Повторите обновление.');await fs.rename(temp,file);}finally{await fs.rm(temp,{force:true});}
      results.push({path:target.path,status:target.spaces.length?'updated':'removed',message:target.spaces.length?'Блок Project Spaces обновлён.':'Блок Project Spaces удалён; остальные инструкции сохранены.'});
    }
    if(target.spaces.length)retained.set(key(target.path),target.path);else retained.delete(key(target.path));
  }catch(cause){results.push({path:target.path,status:'error',message:String(cause)});}}
  await persist();
  return {updatedAt:Date.now(),results};
}
