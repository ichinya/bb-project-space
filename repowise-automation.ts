import type { z } from 'zod';
import type { repowiseRequest,repowiseStatus } from './repowise-contract.ts';
type Request=z.infer<typeof repowiseRequest>;
type Thread={id:string;projectId:string;environmentId:string|null};
type Context={hostId:string;workspace:Request;enabled:boolean};

/** Lifecycle announcements never block dispatch and never bootstrap unprepared spaces. */
export function makeRepowiseAutomation(deps:{resolve:(thread:Thread)=>Promise<Context|null>;inspect:(input:Request,hostId:string)=>Promise<z.infer<typeof repowiseStatus>>;start:(input:Request,hostId:string)=>boolean;onError:(error:unknown)=>void}){
  const checking=new Map<string,Promise<void>>();let disposed=false;
  return {
    dispose:()=>{disposed=true;},
    async notify(thread:Thread){
      if(disposed||!thread.environmentId)return;
      try{
        const context=await deps.resolve(thread);if(disposed||!context?.enabled)return;
        const key=context.hostId+'|'+JSON.stringify(context.workspace);if(checking.has(key))return checking.get(key);
        const check=(async()=>{
          const status=await deps.inspect(context.workspace,context.hostId);
          if(!disposed&&status.available&&status.prepared&&status.stale&&!status.busy&&(!status.retryAt||status.retryAt<=Date.now())){
            deps.start(context.workspace,context.hostId);
          }
        })();
        checking.set(key,check);try{await check;}finally{checking.delete(key);}
      }catch(cause){if(!disposed)deps.onError(cause);}
    },
  };
}
