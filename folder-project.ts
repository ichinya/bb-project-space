import path from 'node:path';
import { z } from 'zod';
import type { PluginBbSdk } from '@get-bb/plugin-sdk';

export const folderProjectInput=z.object({hostId:z.string().min(1),path:z.string().trim().min(1).max(2048),name:z.string().trim().max(100).default('')});
const folderFlavor=(value:string)=>/^(?:[a-z]:[\\/]|\\\\|\/\/)/i.test(value)?path.win32:path.posix;
export function folderIdentity(value:string) {
  const clean=value.replace(/^\\\\\?\\UNC\\/i,'\\\\').replace(/^\\\\\?\\/,'');
  const flavor=folderFlavor(clean);
  const normalized=flavor.normalize(clean).replace(/[\\/]+$/,'');return flavor===path.win32?normalized.toLowerCase():normalized;
}
function validateAbsolute(value:string) {if(/[\x00-\x1f]/.test(value)||(!path.win32.isAbsolute(value)&&!path.posix.isAbsolute(value)))throw new Error('Укажите абсолютный путь существующей папки на выбранном устройстве.');}

export function makeFolderProjectAdder(sdk:Pick<PluginBbSdk,'hosts'|'projects'>) {
  const pending=new Map<string,Promise<{project:Awaited<ReturnType<PluginBbSdk['projects']['create']>>;reused:boolean}>>();
  return async(raw:z.input<typeof folderProjectInput>)=>{
    const input=folderProjectInput.parse(raw);validateAbsolute(input.path);
    // The directory API validates the path on the selected host, not this server.
    const directory=(await sdk.hosts.directory({hostId:input.hostId,path:input.path})).directory;validateAbsolute(directory);
    const identity=folderIdentity(directory),key=input.hostId+'|'+identity;
    const inflight=pending.get(key);if(inflight)return inflight;
    const operation=(async()=>{
      const findExisting=async()=>(await sdk.projects.list()).find(p=>p.sources.some(source=>source.hostId===input.hostId&&folderIdentity(source.path)===identity));
      const existing=await findExisting();if(existing)return {project:existing,reused:true};
      const flavor=folderFlavor(directory);
      const name=input.name||(flavor.basename(directory.replace(/[\\/]+$/,''))||'Проект').slice(0,100);
      try {return {project:await sdk.projects.create({name,source:{type:'local_path',hostId:input.hostId,path:directory}}),reused:false};}
      catch(error){const concurrent=await findExisting();if(concurrent)return {project:concurrent,reused:true};throw error;}
    })();
    pending.set(key,operation);try{return await operation;}finally{pending.delete(key);}
  };
}
