import { useCallback,useEffect,useRef,useState } from 'react';
import { useSdk,experimental_Icon as Icon } from '@get-bb/plugin-sdk/app';
import type { PluginBbSdk } from '@get-bb/plugin-sdk';
type Listing=Awaited<ReturnType<PluginBbSdk['hosts']['directory']>>;

export function FolderBrowser({hostId,initialPath,onPick,onCancel}:{hostId:string;initialPath?:string;onPick:(path:string)=>void;onCancel:()=>void}) {
  const sdk=useSdk(),generation=useRef(0);
  const [listing,setListing]=useState<Listing|null>(null),[input,setInput]=useState(initialPath??''),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const browse=useCallback((value?:string)=>{const current=++generation.current;setBusy(true);setError('');sdk.hosts.directory({hostId,...(value?{path:value}:{})}).then(result=>{if(current===generation.current){setListing(result);setInput(result.directory);}},cause=>{if(current===generation.current)setError(cause instanceof Error?cause.message:String(cause));}).finally(()=>{if(current===generation.current)setBusy(false);});},[sdk,hostId]);
  useEffect(()=>{setListing(null);browse(initialPath||undefined);return()=>{generation.current++;};},[browse]);
  return <div className="ps-directory-browser" role="group" aria-label="Выбор папки на устройстве">
    <div className="ps-directory-path"><input aria-label="Текущая папка" value={input} onChange={event=>setInput(event.target.value)} onKeyDown={event=>{if(event.key==='Enter'){event.preventDefault();browse(input);}}}/><button type="button" disabled={busy} onClick={()=>browse(input)}>Открыть</button></div>
    {error&&<p role="alert" className="ps-error">{error}</p>}
    <div className="ps-directory-roots">{listing?.roots.map(root=><button key={root} type="button" disabled={busy} onClick={()=>browse(root)}>{root}</button>)}<button type="button" disabled={busy||!listing?.parent} onClick={()=>browse(listing?.parent??undefined)}>На уровень выше</button></div>
    {listing&&<code className="ps-directory-current">{listing.directory}</code>}
    <div className="ps-directory-list" aria-busy={busy}>{busy?<p role="status">Загрузка папок…</p>:listing?.entries.filter(entry=>entry.kind==='directory').sort((a,b)=>a.name.localeCompare(b.name)).map(entry=><button key={entry.path} type="button" onClick={()=>browse(entry.path)}><Icon name="Folder"/><span>{entry.name}</span></button>)}{!busy&&listing&&!listing.entries.some(entry=>entry.kind==='directory')&&<p className="ps-muted">Вложенных папок нет.</p>}</div>
    <div className="ps-actions"><button type="button" disabled={busy||!listing||!!error} onClick={()=>listing&&onPick(listing.directory)}>Выбрать эту папку</button><button type="button" onClick={onCancel}>Закрыть выбор папки</button></div>
  </div>;
}
