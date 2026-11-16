import { useCallback,useEffect,useRef,useState } from 'react';
import { useRpc,useRealtime } from '@get-bb/plugin-sdk/app';
import type { z } from 'zod';
import type { rpcContract } from './server.ts';
import { workspaceStatus,workspaceSoftware } from './workspace-contract.ts';

export function WorkspaceSettings({id,group,hosts,revision,dirty}:{id:string;group:string;hosts:{id:string;name:string}[];revision:number;dirty:boolean}) {
  const rpc=useRpc<typeof rpcContract>();
  const [hostId,setHostId]=useState(hosts[0]?.id??''),[status,setStatus]=useState<z.infer<typeof workspaceStatus>|null>(null);
  const [busy,setBusy]=useState(false),[loading,setLoading]=useState(false),[error,setError]=useState(''),[results,setResults]=useState<{path:string;ok:boolean;message:string}[]>([]);
  const [software,setSoftware]=useState<z.infer<typeof workspaceSoftware>|null>(null),[softwareLoading,setSoftwareLoading]=useState(false),[softwareError,setSoftwareError]=useState(''),[installing,setInstalling]=useState(false);
  const generation=useRef(0);
  const softwareGeneration=useRef(0);
  const refreshSoftware=useCallback((checkLatest=false)=>{if(!hostId)return;const current=++softwareGeneration.current;setSoftwareLoading(true);setSoftwareError('');rpc.call('workspace_software',{hostId,checkLatest}).then(value=>{if(current===softwareGeneration.current)setSoftware(value);},cause=>{if(current===softwareGeneration.current)setSoftwareError(String(cause));}).finally(()=>{if(current===softwareGeneration.current)setSoftwareLoading(false);});},[rpc,hostId]);
  useEffect(()=>{setSoftware(null);refreshSoftware();return()=>{softwareGeneration.current++;};},[refreshSoftware]);
  const refresh=useCallback(()=>{if(!hostId)return;const current=++generation.current;setLoading(true);setError('');rpc.call('workspace_status',{id,hostId}).then(value=>{if(current===generation.current)setStatus(value);},cause=>{if(current===generation.current){setStatus(null);setError(String(cause));}}).finally(()=>{if(current===generation.current)setLoading(false);});},[rpc,id,hostId,revision]);
  useEffect(()=>{setResults([]);setStatus(null);refresh();return()=>{generation.current++;};},[refresh]);
  useRealtime('workspace-changed',useCallback(()=>{if(!busy)refresh();},[busy,refresh]));
  const synchronize=async()=>{const current=++generation.current;setBusy(true);setError('');setResults([]);try{const result=await rpc.call('workspace_sync',{id,hostId,revision});if(current===generation.current){setStatus(result.status);setResults(result.results);}}catch(cause){if(current===generation.current)setError(String(cause));}finally{setBusy(false);refresh();}};
  const install=async()=>{setBusy(true);setInstalling(true);setError('');try{setSoftware(await rpc.call('workspace_install',{hostId}));}catch(cause){setError(String(cause));}finally{setBusy(false);setInstalling(false);refreshSoftware();refresh();}};
  return <fieldset className="ps-workspace"><legend>Интеграция ai-workspace</legend>
    <label>Устройство<select value={hostId} disabled={busy} onChange={event=>setHostId(event.target.value)}>{hosts.map(host=><option key={host.id} value={host.id}>{host.name}</option>)}</select></label>
    <div className="ps-workspace-summary"><span>Установленная версия: <strong>{softwareLoading&&!software?'Проверка…':software?.installedVersion??'не установлена'}</strong></span><span>Последняя версия: <strong>{software?.latestVersion??'не проверена'}</strong></span><span>Группа пространства: <strong>{group||'не выбрана'}</strong></span><span>Конфиг: <code>.ai-workspace.json</code> в каждой папке</span></div>
    {software?.installedVersion&&<p className="ps-muted" title={software.binary??undefined}>Используется {software.managed?'копия Project Spaces':'ai-workspace из PATH'}.{software.latestVersion&&!software.updateAvailable?' Установлена актуальная или более новая версия.':''}</p>}
    {software?.checkedAt&&<p className="ps-muted">Проверено: {new Date(software.checkedAt).toLocaleString()}{software.releaseUrl&&<> · <a href={software.releaseUrl} target="_blank" rel="noopener noreferrer">Релиз на GitHub</a></>}</p>}
    {(softwareError||software?.error)&&<p role="alert" className="ps-error">{softwareError||software?.error}</p>}
    {software&&!software.supported&&<p className="ps-muted">Для этого устройства нет готового бинарника. Установите CLI из исходников и добавьте его в PATH.</p>}
    <div className="ps-actions"><button type="button" disabled={busy||softwareLoading} onClick={()=>refreshSoftware(true)}>{softwareLoading?'Проверка версии…':'Проверить обновления'}</button>{software?.supported&&(!software.installedVersion||software.updateAvailable)&&<button type="button" disabled={busy||softwareLoading} onClick={()=>void install()}>{installing?'Установка…':software.installedVersion?`Обновить до ${software.latestVersion}`:'Установить ai-workspace'}</button>}</div>
    <p className="ps-muted">Инициализация регистрирует проекты и дополнительные папки на этом устройстве, создаёт конфиги и добавляет их в группу. Сохраняет существующие группы, общие файлы и заметки. При удалении папки снимает только привязку, созданную этим пространством.</p>
    {(error||(status?.error&&software?.installedVersion))&&<p role="alert" className="ps-error">{error||status?.error}</p>}
    {loading&&<p role="status" aria-live="polite" className="ps-muted">Проверяем папки и группы ai-workspace…</p>}
    <div className="ps-workspace-folders" aria-busy={loading}>{status?.folders.map(folder=><section key={folder.path}><strong>{folder.name}</strong><code>{folder.path}</code><small>{folder.error??(!folder.exists?'Папка недоступна':!folder.initialized?'Нужна инициализация':folder.groups.includes(status.group)?'В группе пространства':'Нужно добавить в группу')}</small><small>Группы: {folder.groups.join(', ')||'—'}</small><small>Конфиг: {!folder.configExists?'не создан':folder.configGroups.includes(status.group)?'группа настроена':'нужно обновить'}</small></section>)}</div>
    {dirty&&<p className="ps-save-required" role="status"><strong>Инициализация недоступна: настройки не сохранены.</strong> Нажмите «Сохранить настройки» выше. Сейчас показано состояние папок из последнего сохранения.</p>}
    <div className="ps-actions"><button type="button" disabled={busy||loading} onClick={refresh}>{loading?'Проверка состояния…':'Проверить состояние'}</button><button type="button" disabled={busy||loading||dirty||!group.trim()||!status?.available} onClick={()=>void synchronize()}>{busy&&!installing?'Обновление папок…':'Инициализировать и обновить папки'}</button></div>
    {!!results.length&&<ul className="ps-workspace-results" role="status">{results.map((result,index)=><li key={index} className={result.ok?'':'ps-workspace-failed'}><code>{result.path}</code> — {result.message}</li>)}</ul>}
    <p className="ps-muted">Агенты пространства читают эту группу через инструмент <code>project_spaces_workspace</code>. Общий MCP других проектов сохраняет свою область доступа. В существующем треде инструмент появится после нового запуска сессии.</p>
  </fieldset>;
}
