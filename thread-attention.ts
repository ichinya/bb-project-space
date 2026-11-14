import type { PluginThreadStatus } from '@get-bb/plugin-sdk/app';

export type ThreadAttentionTone='question'|'error'|'success';

/** Color only unseen events on this thread, independently of collapsed children. */
export function threadAttentionTone(isUnread:boolean,status:Pick<PluginThreadStatus,'indicator'|'rowStatus'>,isOpen=false):ThreadAttentionTone|null {
  if(!isUnread||isOpen)return null;
  if(status.indicator==='waiting-for-input')return 'question';
  if(status.indicator==='unread-error'||status.indicator==='queued-failed'||status.rowStatus?.tone==='error')return 'error';
  if(status.indicator==='unread-success'||status.rowStatus?.tone==='success')return 'success';
  return null;
}
