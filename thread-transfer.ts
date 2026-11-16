import { z } from 'zod';
import type { PluginBbSdk } from '@get-bb/plugin-sdk';
import { contextForSpace, type Project, type Space } from './model.ts';
import { threadMetadata } from './threads.ts';

export const transferInput = z.object({
  threadIds:z.array(z.string().min(1)).min(1).max(200),
  spaceId:z.string().uuid().nullable(), mode:z.enum(['move','copy']),
});
export const transferResult = z.object({results:z.array(z.object({
  sourceThreadId:z.string(),threadId:z.string().optional(),error:z.string().optional(),
}))});
type TransferInput=z.infer<typeof transferInput>;
type TransferResult=z.infer<typeof transferResult>;
type Thread=Awaited<ReturnType<PluginBbSdk['threads']['get']>>;
type Metadata=Awaited<ReturnType<PluginBbSdk['threads']['getPluginMetadata']>>;

/** Moves patch metadata; native forks copy history without exporting it or sending a prompt. */
export function makeThreadTransfer(sdk:Pick<PluginBbSdk,'threads'|'environments'>,getSpaces:()=>Space[],getProjects:()=>Promise<Project[]>,changed:()=>void) {
  const busy=new Set<string>();
  return async(raw:TransferInput):Promise<TransferResult>=>{
    const input=transferInput.parse(raw),rootIds=[...new Set(input.threadIds)];
    const space=input.spaceId===null?null:getSpaces().find(value=>value.id===input.spaceId);
    if(input.spaceId!==null&&!space)throw new Error('Пространство больше не существует. Обновите список.');
    const ids=new Set(rootIds);
    const locked=new Set<string>();let attempted=false;
    const lock=(values:Iterable<string>)=>{
      const next=[...values];
      if(next.some(id=>busy.has(id)&&!locked.has(id)))throw new Error('Эти треды уже переносятся или копируются. Дождитесь завершения.');
      for(const id of next){busy.add(id);locked.add(id);}
    };
    lock(rootIds);
    try{
    const families=new Map(rootIds.map(id=>[id,[id]]));
    if(input.mode==='move'){
      const descendants=await sdk.threads.experimental_listDescendants({threadIds:rootIds,includeArchived:true,includeHidden:true});
      for(const row of descendants.threads){families.set(row.threadId,[row.threadId,...row.descendantIds]);for(const id of row.descendantIds)ids.add(id);}
    }
    if(ids.size>2000)throw new Error('Выбрано больше 2000 тредов с учётом дочерних. Перенесите их частями.');
    lock(ids);
    const projects=space?await getProjects():[];
    const plan:{thread:Thread;set:Metadata;remove:string[]}[]=[];
    // Validate the entire selection before writing, including children from other projects.
    for(const id of ids){
      const thread=await sdk.threads.get({threadId:id});
      if(space&&!space.projectIds.includes(thread.projectId))throw new Error(`Проект треда «${thread.title??thread.titleFallback??id}» не входит в «${space.name}». Сначала добавьте проект в пространство.`);
      if(!space){plan.push({thread,set:{spaceId:null,threadScope:'project',bindingOrigin:'transfer'},remove:['spaceSnapshot','workspaceMap','inheritedFrom']});continue;}
      let map='';
      if(thread.environmentId){
        const environment=await sdk.environments.get({environmentId:thread.environmentId});
        if(environment.path){
          const activeProjects=projects.map(p=>p.id===thread.projectId?{...p,sources:[{hostId:environment.hostId,path:environment.path!},...p.sources.filter(s=>s.hostId!==environment.hostId)]}:p);
          map=contextForSpace(space,activeProjects,thread.projectId,environment.hostId).instructions;
        }
      }
      plan.push({thread,set:threadMetadata(space,'project',map,'transfer'),remove:['inheritedFrom']});
    }
    if(space&&JSON.stringify(getSpaces().find(s=>s.id===space.id))!==JSON.stringify(space))throw new Error('Настройки пространства изменились. Повторите действие.');
    const results:TransferResult['results']=[];
      for(const {thread,set,remove} of plan){
        try{
          attempted=true;
          if(input.mode==='move'){
            await sdk.threads.updatePluginMetadata({threadId:thread.id,set,remove});
            results.push({sourceThreadId:thread.id,threadId:thread.id});
          }else{
            const source=await sdk.threads.getPluginMetadata({threadId:thread.id});
            const metadata={...source,...set};for(const key of remove)delete metadata[key];
            const copied=await sdk.threads.fork({sourceThreadId:thread.id,title:`${thread.title??thread.titleFallback??'Тред'} (копия)`,visibility:'visible',
              ...(thread.environmentId?{environment:{type:'reuse' as const,environmentId:thread.environmentId}}:{}),
              pluginMetadata:metadata});
            results.push({sourceThreadId:thread.id,threadId:copied.id});
          }
        }catch(error){results.push({sourceThreadId:thread.id,error:error instanceof Error?error.message:String(error)});}
      }
    if(input.mode==='copy')return {results};
    // Report one result per requested family. A partially moved family stays retryable.
    return {results:rootIds.map(id=>{
      const family=new Set(families.get(id));
      const failures=results.filter(r=>family.has(r.sourceThreadId)&&r.error);
      return failures.length?{sourceThreadId:id,error:failures.map(r=>`${r.sourceThreadId}: ${r.error}`).join('\n')}:{sourceThreadId:id,threadId:id};
    })};
    }finally{for(const id of locked)busy.delete(id);if(attempted)changed();}
  };
}
