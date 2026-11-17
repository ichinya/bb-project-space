import { useCallback,useEffect,useRef,useState } from 'react';
import { useRpc,useRealtime } from '@get-bb/plugin-sdk/app';
import type { rpcContract } from './server.ts';
import type { z } from 'zod';
import type { agentsResult } from './agents-contract.ts';
import type { Space } from './model.ts';
import { agentsMarkdown } from './agent-context.ts';
import { SettingsSection,SettingsError } from './settings-section.tsx';

export function AgentSettings({space,dirty,hosts,revision,onHosts}:{space:Space;dirty:boolean;hosts:{id:string;name:string}[];revision:number;onHosts:(hosts:string[])=>void}){
  const rpc=useRpc<typeof rpcContract>(),[hostId,setHostId]=useState(hosts[0]?.id??'');
  const [state,setState]=useState<{busy:boolean;error:string|null;last:z.infer<typeof agentsResult>|null}|null>(null);
  const generation=useRef(0);
  const refresh=useCallback(()=>{if(!hostId)return;const token=++generation.current;void rpc.call('agents_status',{hostId}).then(value=>{if(token===generation.current)setState(value);},cause=>{if(token===generation.current)setError(String(cause));});},[rpc,hostId,revision]);
  useEffect(()=>{setState(null);setError('');refresh();return()=>{generation.current++;};},[refresh]);
  useRealtime('agents-changed',refresh);
  useEffect(()=>{if(!state?.busy)return;const timer=setInterval(refresh,2000);return()=>clearInterval(timer);},[state?.busy,refresh]);
  const [copied,setCopied]=useState(false),[error,setError]=useState('');
  const enabled=space.agentsHosts?.includes(hostId)??false;
  const failures=state?.last?.results.filter(row=>row.status==='error').length??0;
  const update=async()=>{setError('');try{await rpc.call('agents_sync',{hostId,revision});refresh();}catch(cause){setError(String(cause));}};
  const copy=async()=>{setError('');try{await navigator.clipboard.writeText(agentsMarkdown(space));setCopied(true);}catch{setError('Не удалось скопировать. Выделите текст инструкции ниже.');}};
  return <SettingsSection title="Подключение к агентам" summary={error||state?.error||failures?<span className="ps-settings-error">AGENTS.md: ошибка · раскройте раздел</span>:space.contextGroup?'BB · Repowise + ai-workspace':'BB · Repowise'}>
    <p>В тредах этого пространства BB автоматически выдаёт инструменты и инструкции каждому провайдеру агента.</p>
    <ul><li><code>project_spaces_repowise</code> — код, зависимости и изменения во всех папках на устройстве треда.</li><li><code>project_spaces_workspace</code> — общие материалы ai-workspace{space.contextGroup?' в группе '+space.contextGroup:': сначала задайте группу в общем контексте'}.</li></ul>
    <p className="ps-muted">Новые инструменты и инструкции загрузятся в новом треде или после перезапуска сессии агента. Файл AGENTS.md содержит инструкции, а подключение MCP выполняет сам BB.</p>
    <SettingsSection title="Инструкция для AGENTS.md" summary={state?.busy?'Обновление…':enabled?'Автообновление включено на '+(hosts.find(host=>host.id===hostId)?.name??hostId):'Автообновление выключено'} className="ps-settings-nested">
      <label>Устройство<select value={hostId} onChange={event=>setHostId(event.target.value)}>{hosts.map(host=><option key={host.id} value={host.id}>{host.name}</option>)}</select></label>
      <label className="ps-check"><input type="checkbox" disabled={!hostId} checked={enabled} onChange={event=>onHosts(event.target.checked?[...new Set([...(space.agentsHosts??[]),hostId])]:(space.agentsHosts??[]).filter(id=>id!==hostId))}/><span>Автоматически обновлять AGENTS.md на этом устройстве</span></label>
      <p className="ps-muted">Включите автообновление и нажмите «Сохранить настройки»: плагин создаст блок <code>{'<project-space>…</project-space>'}</code> в корне проектов на выбранном устройстве. Дальнейшие сохранения обновляют только этот блок. Остальные инструкции сохраняются, исходный файл копируется в резервную копию. Справочные папки не изменяются.</p>
      <p className="ps-muted">В общем проекте один блок содержит все подключённые пространства; агент выбирает контекст текущего треда. При отключении автообновления блок этого пространства удаляется. На недоступном устройстве обновление можно повторить после подключения.</p>
      <p className="ps-muted">В AGENTS.md записываются только короткая ссылка на контекст и список пространств. Полные инструкции хранятся в плагине и передаются выбранному треду один раз. Файл больше 32 КиБ после обновления не записывается: вынесите подробные справочники в отдельные документы и оставьте ссылки.</p>
      {dirty&&<p className="ps-save-required"><strong>Сначала сохраните настройки пространства.</strong> Запись и обновление используют сохранённую конфигурацию.</p>}
      <div className="ps-actions"><button type="button" disabled={!hostId||dirty||state?.busy} onClick={()=>void update()}>{state?.busy?'Обновление…':'Обновить AGENTS.md'}</button><button type="button" disabled={dirty} onClick={()=>void copy()}>{copied?'Скопировано':'Скопировать блок'}</button></div>
      {(error||state?.error)&&<SettingsError message={error||state?.error||''}/>}
      {!!failures&&<SettingsError message={`Не удалось обновить AGENTS.md в ${failures} папках. Раскройте результат обновления ниже для подробностей.`}/>}
      {state?.last&&<details className="ps-error-details"><summary>Результат обновления · {new Date(state.last.updatedAt).toLocaleString()}</summary><ul>{state.last.results.map((row,index)=><li key={index} className={row.status==='error'?'ps-workspace-failed':''}><code>{row.path}</code> — {row.message}</li>)}</ul></details>}
      <details><summary>Предпросмотр блока этого пространства</summary><pre className="ps-agent-instructions">{agentsMarkdown(space)}</pre></details>
    </SettingsSection>
  </SettingsSection>;
}
