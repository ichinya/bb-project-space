import { useState } from 'react';
import { useRpc } from '@get-bb/plugin-sdk/app';
import type { rpcContract } from './server.ts';
import type { Project } from './model.ts';
import { FolderBrowser } from './folder-browser.tsx';

export function AddFolderProject({hosts,onCreated,onBusy}:{hosts:{id:string;name:string}[];onCreated:(project:Project)=>void;onBusy:(busy:boolean)=>void}) {
  const rpc=useRpc<typeof rpcContract>();
  const [open,setOpen]=useState(false),[browse,setBrowse]=useState(false),[hostId,setHostId]=useState(hosts[0]?.id??''),[folder,setFolder]=useState(''),[name,setName]=useState('');
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('');
  const create=async()=>{setBusy(true);onBusy(true);setError('');setMessage('');try{const result=await rpc.call('project_from_folder',{hostId,path:folder.trim(),name:name.trim()});onCreated(result.project);setMessage(result.reused?`Выбран существующий проект «${result.project.name}».`:`Проект «${result.project.name}» создан и выбран.`);setFolder('');setName('');setBrowse(false);}catch(cause){setError(cause instanceof Error?cause.message:String(cause));}finally{setBusy(false);onBusy(false);}};
  return <div className="ps-add-project">
    <button type="button" disabled={busy||!hosts.length} aria-expanded={open} onClick={()=>setOpen(!open)}>{open?'Скрыть добавление проекта':'Добавить проект из папки'}</button>
    {open&&<div className="ps-add-project-fields">
      <label>Устройство проекта<select value={hostId} disabled={busy} onChange={event=>{setHostId(event.target.value);setFolder('');setBrowse(false);setError('');}}>{hosts.map(host=><option key={host.id} value={host.id}>{host.name}</option>)}</select></label>
      <label>Папка проекта<div className="ps-directory-path"><input aria-label="Папка нового проекта" placeholder="D:\\Projects\\my-project" value={folder} disabled={busy} onChange={event=>setFolder(event.target.value)} onKeyDown={event=>{if(event.key==='Enter'){event.preventDefault();if(folder.trim())void create();}}}/><button type="button" disabled={busy} aria-expanded={browse} onClick={()=>setBrowse(!browse)}>Выбрать папку</button></div></label>
      {browse&&<FolderBrowser hostId={hostId} initialPath={folder} onPick={value=>{setFolder(value);setBrowse(false);setError('');}} onCancel={()=>setBrowse(false)}/>}
      <label>Название нового проекта <span className="ps-muted">необязательно</span><input aria-label="Название нового проекта" maxLength={100} value={name} disabled={busy} placeholder="По имени папки" onChange={event=>setName(event.target.value)} onKeyDown={event=>{if(event.key==='Enter'){event.preventDefault();if(folder.trim())void create();}}}/></label>
      <p className="ps-muted">Проект создаётся в BB из существующей папки на выбранном устройстве. Чтобы включить его в это пространство, сохраните настройки пространства.</p>
      {error&&<p role="alert" className="ps-error">{error}</p>}
      <div className="ps-actions"><button type="button" disabled={busy||!folder.trim()||!hostId} onClick={()=>void create()}>{busy?'Добавление проекта…':'Создать проект и выбрать'}</button></div>
    </div>}
    {message&&<p role="status">{message}</p>}
  </div>;
}
