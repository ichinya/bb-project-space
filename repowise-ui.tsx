import { useCallback,useEffect,useRef,useState } from 'react';
import { useRpc,useRealtime } from '@get-bb/plugin-sdk/app';
import type { z } from 'zod';
import type { rpcContract } from './server.ts';
import type { repowiseStatus } from './repowise-contract.ts';

export function RepowiseSettings({id,hosts,revision,dirty}:{id:string;hosts:{id:string;name:string}[];revision:number;dirty:boolean}){
  const rpc=useRpc<typeof rpcContract>();const [hostId,setHostId]=useState(hosts[0]?.id??'');
  const [status,setStatus]=useState<z.infer<typeof repowiseStatus>|null>(null),[error,setError]=useState(''),[loading,setLoading]=useState(false),[starting,setStarting]=useState(false);
  const generation=useRef(0);
  const refresh=useCallback(()=>{if(!hostId)return;const token=++generation.current;setLoading(true);void rpc.call('repowise_status',{id,hostId}).then(value=>{if(token===generation.current){setStatus(value);setError('');}},cause=>{if(token===generation.current)setError(String(cause));}).finally(()=>{if(token===generation.current)setLoading(false);});},[rpc,id,hostId,revision]);
  useEffect(()=>{setStatus(null);refresh();return()=>{generation.current++;};},[refresh]);useRealtime('repowise-changed',refresh);
  useEffect(()=>{if(!status?.busy)return;const timer=setInterval(refresh,3000);return()=>clearInterval(timer);},[status?.busy,refresh]);
  const busy=starting||status?.busy;
  const prepare=async()=>{setStarting(true);setError('');try{await rpc.call('repowise_sync',{id,hostId,revision});refresh();}catch(cause){setError(String(cause));}finally{setStarting(false);}};
  return <fieldset className="ps-workspace"><legend>Контекст кода · Repowise</legend>
    <label>Устройство<select disabled={!!busy} value={hostId} onChange={event=>setHostId(event.target.value)}>{hosts.map(h=><option key={h.id} value={h.id}>{h.name}</option>)}</select></label>
    <p>Версия: <strong>{status?.version??(loading?'Проверка…':'не установлена')}</strong> · {status?.busy?'Индексация выполняется…':status?.prepared?'Пространство подготовлено':'Нужна подготовка индексов'}</p>
    <p className="ps-muted">Общий поиск, зависимости и влияние изменений по всем папкам пространства. Один индекс на checkout переиспользуется между чатами. Первичная подготовка может занять несколько минут.</p>
    {status?.updatedAt&&<p className="ps-muted">Обновлено: {new Date(status.updatedAt).toLocaleString()}</p>}
    {(error||status?.error)&&<p role="alert" className="ps-error">{error||status?.error}</p>}
    {status&&!status.available&&<p className="ps-muted">Установите Repowise на выбранном устройстве и добавьте CLI в PATH.</p>}
    <div className="ps-workspace-folders">{status?.roots.map(root=><section key={root.alias}><strong>{root.name}</strong><code>{root.path}</code><small>{!root.exists?'Папка недоступна':root.message}</small><small>Репозиторий: {root.alias}</small></section>)}</div>
    {dirty&&<p className="ps-save-required" role="status"><strong>Подготовка индексов недоступна: настройки не сохранены.</strong> Нажмите «Сохранить настройки» выше. Сейчас показаны папки из последнего сохранения.</p>}
    <div className="ps-actions"><button type="button" disabled={loading} onClick={refresh}>Проверить состояние</button><button type="button" disabled={!!busy||loading||dirty||!status?.available} onClick={()=>void prepare()}>{busy?'Индексация выполняется…':status?.prepared?'Обновить индексы':'Подготовить все папки'}</button></div>
    <p className="ps-muted">Агент получает <code>project_spaces_repowise</code> для кода и <code>project_spaces_workspace</code> для общих материалов ai-workspace. При нескольких пространствах выбор задаётся тредом. В существующей сессии новые инструменты появятся после её перезапуска.</p>
  </fieldset>;
}
