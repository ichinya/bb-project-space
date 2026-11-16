import type { PluginThreadStatus } from '@get-bb/plugin-sdk/app';

export type ThreadAttentionTone='question'|'error'|'success';

/** Pending input needs action even after reading; terminal outcomes only need acknowledgement. */
export function threadAttentionTone(isUnread:boolean,status:Pick<PluginThreadStatus,'indicator'|'rowStatus'>,isOpen=false,hasPendingInteraction=false):ThreadAttentionTone|null {
  if(hasPendingInteraction||status.indicator==='waiting-for-input')return 'question';
  if(!isUnread||isOpen)return null;
  if(status.indicator==='unread-error'||status.indicator==='queued-failed'||status.rowStatus?.tone==='error')return 'error';
  if(status.indicator==='unread-success'||status.rowStatus?.tone==='success')return 'success';
  return null;
}

export type ThreadAttention={tone:ThreadAttentionTone|null;fromDescendant:boolean};
type AttentionNode<T>={thread:T;children:readonly AttentionNode<T>[]};
const priority={question:3,error:2,success:1};

/** Aggregate visible families once, independently of their expanded/collapsed state. */
export function threadFamilyAttention<T extends {id:string}>(nodes:readonly AttentionNode<T>[],ownTone:(thread:T)=>ThreadAttentionTone|null):ReadonlyMap<string,ThreadAttention> {
  const result=new Map<string,ThreadAttention>();
  const visit=(node:AttentionNode<T>):ThreadAttentionTone|null=>{
    let descendantTone:ThreadAttentionTone|null=null;
    for(const child of node.children){
      const tone=visit(child);
      if(tone&&(!descendantTone||priority[tone]>priority[descendantTone]))descendantTone=tone;
    }
    const own=ownTone(node.thread);
    const fromDescendant=!!descendantTone&&(!own||priority[descendantTone]>=priority[own]);
    const tone=fromDescendant?descendantTone:own;
    result.set(node.thread.id,{tone,fromDescendant});
    return tone;
  };
  nodes.forEach(visit);
  return result;
}
