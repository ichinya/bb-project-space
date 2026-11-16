import type { PluginBbSdk,PluginDispatchInput } from '@get-bb/plugin-sdk';
import type { Space } from './model.ts';
import { readThreadBinding } from './threads.ts';

type Blocks=PluginDispatchInput['blocks'];
type Thread=Awaited<ReturnType<PluginBbSdk['threads']['get']>>;
type Metadata=Awaited<ReturnType<PluginBbSdk['threads']['getPluginMetadata']>>;

/** Only BB's leading, structured Continue from link is a placement source. */
export function continuationSource(blocks:Blocks):string|null {
  const first=blocks.find(block=>block.type==='text'&&block.visibility!=='agent-only');
  if(!first||first.type!=='text')return null;
  const match=/^Continue from (@thread:(thr_[a-z0-9]+))(?=\s|$)/.exec(first.text);
  if(!match)return null;
  const start='Continue from '.length,end=start+match[1]!.length;
  return first.mentions?.some(mention=>mention.start===start&&mention.end===end&&mention.resource.kind==='thread'&&mention.resource.threadId===match[2])?match[2]!:null;
}

const hasPlacement=(metadata:Metadata)=>Object.hasOwn(metadata,'spaceId')||Object.hasOwn(metadata,'spaceSnapshot');
type InheritOptions={replaceLaunch?:boolean;replaceExisting?:boolean};
const placementVersion=(metadata:Metadata)=>JSON.stringify([metadata.spaceId,metadata.threadScope,metadata.bindingOrigin]);

/** Materialize missing placement before agent configuration; explicit moves always win. */
export function makeThreadInheritance(sdk:Pick<PluginBbSdk,'threads'>,spaces:()=>Space[],changed:()=>void) {
  const pending=new Map<string,Promise<Awaited<ReturnType<typeof resolve>>>>();
  async function sourceOf(thread:Thread,input?:Blocks):Promise<string|null> {
    if(thread.sourceThreadId||thread.parentThreadId)return thread.sourceThreadId??thread.parentThreadId;
    const first=(await sdk.threads.events.list({threadId:thread.id,types:['client/turn/requested'],order:'asc',limit:'1'}))[0];
    if(first){
      if(first.type!=='client/turn/requested'||first.data.initiator!=='user'||!Array.isArray(first.data.input))return null;
      return continuationSource(first.data.input as Blocks);
    }
    return input?continuationSource(input):null;
  }
  async function resolve(threadId:string,input?:Blocks,options:InheritOptions={}) {
    let own=await sdk.threads.getPluginMetadata({threadId});
    const initialPlacement=placementVersion(own);
    const canReplace=(metadata:Metadata)=>options.replaceExisting||(options.replaceLaunch&&metadata.bindingOrigin==='launch');
    const unchanged=()=>({threadId,changed:false,sourceThreadId:null as string|null,binding:readThreadBinding(own)});
    if(hasPlacement(own)&&!canReplace(own))return unchanged();
    const target=await sdk.threads.get({threadId});
    let current=target,blocks=input;
    const seen=new Set([threadId]);
    for(let depth=0;depth<16;depth++){
      const sourceThreadId=await sourceOf(current,blocks);blocks=undefined;
      if(!sourceThreadId||seen.has(sourceThreadId))return unchanged();seen.add(sourceThreadId);
      const source=await sdk.threads.getPluginMetadata({threadId:sourceThreadId}),binding=readThreadBinding(source);
      if(binding){
        if(binding.spaceId!==null&&!spaces().some(space=>space.id===binding.spaceId&&space.projectIds.includes(target.projectId)))return unchanged();
        // Check again after source lookups so a concurrent explicit move is preserved.
        own=await sdk.threads.getPluginMetadata({threadId});if(placementVersion(own)!==initialPlacement||(hasPlacement(own)&&!canReplace(own)))return unchanged();
        const set:Metadata={spaceId:binding.spaceId,threadScope:binding.scope,bindingOrigin:'inherited',inheritedFrom:sourceThreadId};
        if(binding.spaceId!==null)for(const key of ['spaceSnapshot','workspaceMap'])if(source[key]!==undefined)set[key]=structuredClone(source[key]);
        await sdk.threads.updatePluginMetadata({threadId,set,remove:['spaceSnapshot','workspaceMap'].filter(key=>!(key in set))});changed();
        return {threadId,changed:true,sourceThreadId,binding};
      }
      if(hasPlacement(source))return unchanged();
      current=await sdk.threads.get({threadId:sourceThreadId});
    }
    return unchanged();
  }
  return (threadId:string,input?:Blocks,options:InheritOptions={})=>{
    const existing=pending.get(threadId);if(existing)return existing;
    const task=resolve(threadId,input,options).finally(()=>pending.delete(threadId));pending.set(threadId,task);return task;
  };
}
