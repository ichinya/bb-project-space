import {useId,useState} from 'react';
import {useSdk,experimental_Icon as Icon} from '@get-bb/plugin-sdk/app';
import {Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription} from './components/ui/dialog.tsx';
import './project-actions.css';

export function ProjectActions({project,onTransfer,onRenamed}:{project:{id:string;name:string};onTransfer?:()=>void;onRenamed?:()=>void}){
  const sdk=useSdk(),inputId=useId();
  const [view,setView]=useState<'menu'|'rename'|null>(null),[name,setName]=useState(project.name);
  const [busy,setBusy]=useState(false),[error,setError]=useState('');
  const open=()=>{setName(project.name);setError('');setView('menu');};
  const trimmed=name.trim();
  return <>
    <button type="button" className="ps-project-actions-trigger" onClick={open} title={`Действия проекта: ${project.name}`} aria-label={`Действия проекта: ${project.name}`}><Icon name="MoreHorizontal"/></button>
    <Dialog open={view!==null} onOpenChange={value=>{if(!value&&!busy)setView(null);}}>
      <DialogContent className="ps-project-actions-dialog">
        <DialogHeader><DialogTitle>{view==='rename'?'Переименовать проект':project.name}</DialogTitle><DialogDescription>{view==='rename'?'Название изменится во всём BB. Папка проекта, Git и треды сохранятся.':'Действия для этого проекта.'}</DialogDescription></DialogHeader>
        {view==='menu'?<div className="ps-project-action-list">
          <button type="button" onClick={()=>setView('rename')}><Icon name="Pencil"/>Переименовать проект</button>
          {onTransfer&&<button type="button" onClick={()=>{setView(null);onTransfer();}}><Icon name="Folder"/>Перенос и копирование тредов</button>}
        </div>:<form onSubmit={async event=>{
          event.preventDefault();if(busy||!trimmed||trimmed===project.name)return;
          setBusy(true);setError('');
          try{await sdk.projects.update({projectId:project.id,name:trimmed});setView(null);onRenamed?.();}
          catch(cause){setError(cause instanceof Error?cause.message:String(cause));}
          finally{setBusy(false);}
        }}>
          <label htmlFor={inputId}>Название проекта</label>
          <input id={inputId} value={name} autoFocus disabled={busy} onChange={event=>setName(event.target.value)} onFocus={event=>event.currentTarget.select()}/>
          {error&&<p role="alert">{error}</p>}
          <div className="ps-project-action-buttons"><button type="button" disabled={busy} onClick={()=>setView(null)}>Отмена</button><button type="submit" disabled={busy||!trimmed||trimmed===project.name}>{busy?'Сохранение…':'Сохранить'}</button></div>
        </form>}
      </DialogContent>
    </Dialog>
  </>;
}
