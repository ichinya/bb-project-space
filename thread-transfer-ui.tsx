import { useCallback, useEffect, useId, useState } from 'react';
import { useRpc,useRealtime,useSdk,type PluginAppBuilder,type PluginThreadActionDataInput } from '@get-bb/plugin-sdk/app';
import type { rpcContract } from './server.ts';
import type { Space } from './model.ts';
import type { ThreadBinding } from './threads.ts';
import { Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription } from './components/ui/dialog.tsx';
import './thread-transfer.css';

function useTransferData({threadIds}:PluginThreadActionDataInput){
  const rpc=useRpc<typeof rpcContract>(),sdk=useSdk();
  const [spaces,setSpaces]=useState<Space[]>([]),[bindings,setBindings]=useState<Record<string,ThreadBinding>>({});
  const [busy,setBusy]=useState(false),[ready,setReady]=useState(false),[error,setError]=useState('');
  const [epoch,setEpoch]=useState(0);
  const key=threadIds.join('|');
  const refresh=useCallback(()=>setEpoch(value=>value+1),[]);
  useEffect(()=>{
    let cancelled=false;setReady(false);
    void (async()=>{
      try{
        const catalog=await rpc.call('catalog');const next:Record<string,ThreadBinding>={};
        const ids=key?key.split('|'):[];
        for(let offset=0;offset<ids.length;offset+=200){
          const result=await rpc.call('thread_bindings',{threadIds:ids.slice(offset,offset+200)});
          for(const row of result.bindings)next[row.threadId]={spaceId:row.spaceId,scope:row.scope};
        }
        if(!cancelled){setSpaces(catalog.spaces);setBindings(next);setReady(true);setError('');}
      }catch(cause){if(!cancelled)setError(String(cause));}
    })();return ()=>{cancelled=true;};
  },[rpc,key,epoch]);
  useRealtime('spaces-changed',refresh);useRealtime('thread-bindings-changed',refresh);
  useEffect(()=>sdk.subscribe({event:'realtime:connection',callback:event=>{if(event.reconnected)refresh();}}),[sdk,refresh]);
  return {rpc,spaces,bindings,ready,busy,setBusy,error};
}

export function registerThreadTransferActions(app:PluginAppBuilder){
  for(const mode of ['move','copy'] as const)app.slots.experimental_threadAction({
    id:`${mode}-space`,title:mode==='move'?'Переместить в пространство':'Копировать в пространство',
    icon:mode==='move'?'Folder':'Copy',group:'project-spaces',order:mode==='move'?0:1,
    useData:useTransferData,
    item({thread,data}){
      const candidates=data.spaces.filter(s=>s.projectIds.includes(thread.projectId));
      const binding=data.bindings[thread.id];
      const current=binding?binding.spaceId:thread.parentThreadId?undefined:null;
      return {
        label:mode==='move'?'Переместить в пространство…':'Копировать в пространство…',icon:mode==='move'?'Folder':'Copy',
        disabled:!data.ready||data.busy,detail:data.error||undefined,
        choices:{hint:mode==='move'?'Переносится вместе с дочерними тредами. Новый контекст применяется при новом запуске сессии.':'Отдельный тред с историей, без дочерних тредов. Рабочая папка остаётся общей.',
          items:[...candidates.map(s=>({id:s.id,label:s.name,icon:'Folder',selected:mode==='move'&&s.id===current,disabled:mode==='move'&&s.id===current})),
            {id:'outside',label:'Вне пространств',selected:mode==='move'&&current===null,disabled:mode==='move'&&current===null}]},
        async run({value}){
          if(!value)return;data.setBusy(true);
          try{
            const result=await data.rpc.call('thread_transfer',{threadIds:[thread.id],spaceId:value==='outside'?null:value,mode});
            const failures=result.results.filter(r=>r.error);
            if(failures.length)window.alert(`Выполнено: ${result.results.length-failures.length}. Ошибки:\n${failures.map(r=>`${r.sourceThreadId}: ${r.error}`).join('\n')}`);
          }catch(cause){window.alert(cause instanceof Error?cause.message:String(cause));}
          finally{data.setBusy(false);}
        },
      };
    },
  });
}

/** Bulk operations use the displayed roots, never a history download or a hidden all-project sweep. */
export type ProjectTransferSelection={projectId:string;threadIds:string[];currentSpaceId?:string};
export function ProjectTransferDialog({projectId,threadIds,spaces,currentSpaceId,onClose}:ProjectTransferSelection&{spaces:Space[];onClose:()=>void}){
  const rpc=useRpc<typeof rpcContract>();
  const formId=useId();
  const candidates=spaces.filter(s=>s.projectIds.includes(projectId));
  const [mode,setMode]=useState<'move'|'copy'>('move'),[target,setTarget]=useState(()=>candidates.find(s=>s.id!==currentSpaceId)?.id??'outside');
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[completed,setCompleted]=useState<string[]>([]);
  const pending=threadIds.filter(id=>!completed.includes(id));
  if(!threadIds.length)return null;
  return <Dialog open onOpenChange={value=>{if(!busy&&!value)onClose();}}>
    <DialogContent className="pst-transfer-dialog">
      <DialogHeader><DialogTitle>Треды проекта</DialogTitle><DialogDescription>Треды текущего списка: {threadIds.length}. Для архивных включите их отображение и загрузите нужные строки.</DialogDescription></DialogHeader>
      <form onSubmit={async event=>{
        event.preventDefault();setBusy(true);setError('');let done=[...completed];
        try{
          // A retry only touches failed/unprocessed sources, especially for copies.
          for(let offset=0;offset<pending.length;offset+=200){
            const result=await rpc.call('thread_transfer',{threadIds:pending.slice(offset,offset+200),spaceId:target==='outside'?null:target,mode});
            done=[...done,...result.results.filter(r=>r.threadId).map(r=>r.sourceThreadId)];setCompleted(done);
            const failures=result.results.filter(r=>r.error);if(failures.length)throw new Error(failures.map(r=>`${r.sourceThreadId}: ${r.error}`).join('\n'));
          }
          onClose();
        }catch(cause){setError(cause instanceof Error?cause.message:String(cause));}finally{setBusy(false);}
      }}>
        <div className="pst-transfer-field"><label htmlFor={formId+'-mode'}>Действие</label><select id={formId+'-mode'} disabled={busy||completed.length>0} value={mode} onChange={e=>setMode(e.target.value as 'move'|'copy')}><option value="move">Переместить</option><option value="copy">Копировать с историей</option></select></div>
        <div className="pst-transfer-field"><label htmlFor={formId+'-space'}>Пространство</label><select id={formId+'-space'} disabled={busy||completed.length>0} value={target} onChange={e=>setTarget(e.target.value)}>{candidates.map(s=><option key={s.id} value={s.id} disabled={mode==='move'&&s.id===currentSpaceId}>{s.name}</option>)}<option value="outside" disabled={mode==='move'&&!currentSpaceId}>Вне пространств</option></select></div>
        <p>{mode==='move'?'Дочерние треды переносятся вместе с родителем. Контекст пространства применяется при новом запуске сессии.':'Создаются отдельные треды с историей без запуска агента и копирования дочерних тредов. Рабочая папка остаётся общей.'}</p>
        {error&&<p role="alert">{error}</p>}{completed.length>0&&<p role="status">Выполнено: {completed.length}</p>}
        <div className="pst-transfer-buttons"><button type="button" disabled={busy} onClick={onClose}>Отмена</button><button type="submit" disabled={busy||!pending.length||!target||(mode==='move'&&target===(currentSpaceId??'outside'))}>{busy?'Выполняется…':mode==='move'?'Переместить':'Копировать'}</button></div>
      </form>
    </DialogContent>
  </Dialog>;
}
