import { useCallback,useEffect,useRef,useState } from 'react';
import { useRpc,useRealtime } from '@get-bb/plugin-sdk/app';
import type { z } from 'zod';
import type { rpcContract } from './server.ts';
import type { repowiseStatus,repowiseSoftware } from './repowise-contract.ts';
import { SettingsSection,SettingsError } from './settings-section.tsx';

export function RepowiseSettings({id,hosts,revision,dirty,autoRefresh,onAutoRefresh}:{id:string;hosts:{id:string;name:string}[];revision:number;dirty:boolean;autoRefresh:boolean;onAutoRefresh:(value:boolean)=>void}){
  const rpc=useRpc<typeof rpcContract>(),[hostId,setHostId]=useState(hosts[0]?.id??'');
  const [status,setStatus]=useState<z.infer<typeof repowiseStatus>|null>(null),[error,setError]=useState(''),[loading,setLoading]=useState(false),[starting,setStarting]=useState(false);
  const [software,setSoftware]=useState<z.infer<typeof repowiseSoftware>|null>(null),[softwareLoading,setSoftwareLoading]=useState(false),[softwareError,setSoftwareError]=useState(''),[installing,setInstalling]=useState(false);
  const [installError,setInstallError]=useState('');
  const generation=useRef(0),softwareGeneration=useRef(0);
  const refresh=useCallback(()=>{if(!hostId)return;const token=++generation.current;setLoading(true);void rpc.call('repowise_status',{id,hostId}).then(value=>{if(token===generation.current){setStatus(value);setError('');}},cause=>{if(token===generation.current){setStatus(null);setError(String(cause));}}).finally(()=>{if(token===generation.current)setLoading(false);});},[rpc,id,hostId,revision]);
  const refreshSoftware=useCallback((checkLatest=false)=>{if(!hostId)return;const token=++softwareGeneration.current;setSoftwareLoading(true);setSoftwareError('');void rpc.call('repowise_software',{hostId,checkLatest}).then(value=>{if(token===softwareGeneration.current)setSoftware(value);},cause=>{if(token===softwareGeneration.current)setSoftwareError(String(cause));}).finally(()=>{if(token===softwareGeneration.current)setSoftwareLoading(false);});},[rpc,hostId]);
  useEffect(()=>{setStatus(null);refresh();return()=>{generation.current++;};},[refresh]);
  useEffect(()=>{setSoftware(null);setInstallError('');refreshSoftware();return()=>{softwareGeneration.current++;};},[refreshSoftware]);
  useRealtime('repowise-changed',useCallback(()=>{refresh();if(!installing)refreshSoftware();},[refresh,refreshSoftware,installing]));
  useEffect(()=>{if(!status?.busy)return;const timer=setInterval(refresh,3000);return()=>clearInterval(timer);},[status?.busy,refresh]);
  const busy=starting||installing||status?.busy,ready=status?.roots.filter(root=>root.indexed).length??0;
  const prepare=async()=>{setStarting(true);setError('');try{await rpc.call('repowise_sync',{id,hostId,revision});refresh();}catch(cause){setError(String(cause));}finally{setStarting(false);}};
  const install=async()=>{const token=++softwareGeneration.current;setInstalling(true);setInstallError('');setSoftwareError('');try{const value=await rpc.call('repowise_install',{hostId});if(token===softwareGeneration.current)setSoftware(value);}catch(cause){if(token===softwareGeneration.current)setInstallError(String(cause));}finally{setInstalling(false);refreshSoftware();refresh();}};
  const problem=installError||softwareError||software?.error||error||status?.error;
  const summary=problem?<span className="ps-settings-error">Ошибка · раскройте раздел</span>:installing?'Установка…':status?.busy?'Индексация…':software?.installedVersion?`${software.installedVersion} · ${status?.stale?'нужно обновить индексы':status?.prepared?'индексы готовы':`индексы: ${ready}/${status?.roots.length??0}`}${software.updateAvailable?' · есть обновление':''}`:softwareLoading?'Проверка…':'Не установлен';
  return <SettingsSection title="Контекст кода · Repowise" summary={summary} className="ps-workspace">
    <label>Устройство<select disabled={!!busy} value={hostId} onChange={event=>setHostId(event.target.value)}>{hosts.map(h=><option key={h.id} value={h.id}>{h.name}</option>)}</select></label>
    {!hostId&&<p role="status" className="ps-muted">Подключите устройство, чтобы установить Repowise.</p>}
    <div className="ps-workspace-summary"><span>Установлено: <strong>{software?.installedVersion??'не установлен'}</strong></span><span>Последняя версия: <strong>{software?.latestVersion??'не проверена'}</strong></span></div>
    {software?.installedVersion&&<p className="ps-muted" title={software.binary??undefined}>{software.managed?'Используется копия Project Spaces.':'Используется Repowise из PATH.'}{software.latestVersion&&!software.updateAvailable?' Установлена актуальная или более новая версия.':''}</p>}
    {!software?.installedVersion&&!softwareLoading&&<p className="ps-muted">Установите Repowise на выбранное устройство кнопкой ниже. После установки подготовьте индексы папок.</p>}
    {software&&!software.supported&&<p className="ps-muted">Для автоматической установки нужен uv или Python 3.11+ на выбранном устройстве.</p>}
    {(softwareError||software?.error)&&<SettingsError message={softwareError||software?.error||''}/>}
    {installError&&<SettingsError message={installError}/>}
    <div className="ps-actions"><button type="button" disabled={!hostId||!!busy||softwareLoading} onClick={()=>refreshSoftware(true)}>{softwareLoading?'Проверка версии…':'Проверить обновления'}</button>{(!software?.installedVersion||software?.updateAvailable)&&<button type="button" disabled={!hostId||!!busy||softwareLoading||!software?.supported} onClick={()=>void install()}>{installing?'Установка…':software?.installedVersion?`Обновить до ${software.latestVersion}`:'Установить Repowise'}</button>}</div>
    {installing&&<p role="status" aria-live="polite" className="ps-muted">Устанавливаем отдельную копию Repowise и зависимости. Это может занять несколько минут.</p>}
    {software?.checkedAt&&<p className="ps-muted">Проверено: {new Date(software.checkedAt).toLocaleString()}{software.releaseUrl&&<> · <a href={software.releaseUrl} target="_blank" rel="noopener noreferrer">Релиз на PyPI</a></>}</p>}
    {(error||status?.error)&&<SettingsError message={error||status?.error||''}/>}
    <label className="ps-check"><input type="checkbox" checked={autoRefresh} onChange={event=>onAutoRefresh(event.target.checked)}/><span>Автообновлять подготовленные индексы в BB<small>Проверка при начале и завершении хода агента. Обновление только при изменениях, без вызовов модели. Новые папки автоматически не инициализируются.</small></span></label>
    {status?.freshnessWarning&&<p role="status" className={status.stale?'ps-save-required':'ps-muted'}>{status.freshnessWarning}</p>}
    {status?.stage&&(status.busy||status.error)&&<p role="status" className="ps-muted">
      {status.stage.name}{status.stage.alias?` · ${status.stage.alias}`:''}{status.stage.elapsedMs!==undefined?` · ${Math.round(status.stage.elapsedMs/1000)} с`:''}
      {status.stage.progress?` · ${status.stage.progress}`:''}
    </p>}
    {status?.updatedAt&&<p className="ps-muted">Последнее успешное обновление {new Date(status.updatedAt).toLocaleString()}</p>}
    {dirty&&<p className="ps-save-required" role="status"><strong>Сначала сохраните настройки пространства.</strong> Подготовка использует сохранённый список папок. Установить сам Repowise можно до сохранения.</p>}
    <div className="ps-actions"><button type="button" disabled={!hostId||!!busy||loading} onClick={refresh}>{loading?'Проверка…':'Проверить индексы'}</button><button type="button" disabled={!!busy||loading||dirty||!status?.available} onClick={()=>void prepare()}>{status?.busy||starting?'Индексация…':status?.prepared?'Обновить индексы':'Подготовить все папки'}</button></div>
    {!!status?.roots.length&&<SettingsSection title="Папки и индексы" summary={`${ready} из ${status.roots.length} проиндексировано`} className="ps-settings-nested"><div className="ps-workspace-folders ps-settings-list">{status.roots.map(root=><section key={root.alias}><strong>{root.name}</strong><code>{root.path}</code><small>{!root.exists?'Папка недоступна':root.message}</small><small>Репозиторий: {root.alias}</small></section>)}</div></SettingsSection>}
    <SettingsSection title="Как работает контекст кода" className="ps-settings-nested"><p className="ps-muted">Общий поиск, зависимости и влияние изменений по всем папкам пространства. Индекс каждого checkout переиспользуется между чатами. Первичная подготовка может занять несколько минут.</p><p className="ps-muted">Установка загружает пакет с PyPI и зависимости в отдельное Python-окружение Project Spaces на выбранном устройстве. При необходимости автоматически загружаются uv с GitHub и Python. Размер, SHA-256 пакетов и версии CLI проверяются до переключения. Глобальная установка и PATH сохраняются.</p><p className="ps-muted">Агент получает <code>project_spaces_repowise</code> для кода и <code>project_spaces_workspace</code> для общих материалов ai-workspace. В существующей сессии новые инструменты появятся после её перезапуска.</p></SettingsSection>
  </SettingsSection>;
}
