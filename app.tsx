import { useCallback, useEffect, useRef, useState } from 'react';
import { definePluginApp, useRpc, useRealtime, useSdk, useBbNavigate, experimental_NewThreadComposer as NewThreadComposer, type NewThreadRequest, type PluginNavPanelProps } from '@get-bb/plugin-sdk/app';
import type { rpcContract } from './server';
import type { Space, Project } from './model';
import { threadMetadata, type ThreadScope } from './threads';
import { SpaceThreadSidebar, ThreadRows, useGroupedThreads } from './thread-ui';
import './style.css';
import { WorkspaceSettings } from './workspace-ui.tsx';
import { AddFolderProject } from './add-folder-project.tsx';
import { launchHostId } from './launch.ts';
import { registerThreadTransferActions } from './thread-transfer-ui.tsx';
import { RepowiseSettings } from './repowise-ui.tsx';
type Catalog={spaces:Space[];projects:Project[];hosts:{id:string;name:string}[];revision:number};
const empty=(projectId:string):Space=>({id:crypto.randomUUID(),name:'',projectIds:projectId?[projectId]:[],primaryProjectId:projectId,folders:[],instructions:'',contextGroup:''});
function SpacesPage({subPath}:PluginNavPanelProps){
  const rpc=useRpc<typeof rpcContract>(),sdk=useSdk(),navigate=useBbNavigate();
  const [data,setData]=useState<Catalog|null>(null),[selected,setSelected]=useState<string|null>(null),[draft,setDraft]=useState<Space|null>(null);
  const [editing,setEditing]=useState(false),[editRevision,setEditRevision]=useState(0),[launch,setLaunch]=useState(false),[primary,setPrimary]=useState('');
  const [error,setError]=useState(''),[busy,setBusy]=useState(false),[folderPath,setFolderPath]=useState(''),[folderHost,setFolderHost]=useState('');
  const [launchScope,setLaunchScope]=useState<ThreadScope>('space'),[showArchived,setShowArchived]=useState(false);
  const [composerRequest,setComposerRequest]=useState(0);
  const composerRef=useRef<HTMLDivElement|null>(null);
  const appliedRoute=useRef<string|null>(null);
  const report=(e:unknown)=>setError(e instanceof Error?e.message:String(e));
  const refresh=useCallback(()=>{rpc.call('catalog').then(r=>{setData(r);setError('');},report);},[rpc]);
  useEffect(refresh,[refresh]);useRealtime('spaces-changed',refresh);useRealtime('catalog-changed',refresh);
  const space=data?.spaces.find(s=>s.id===selected)??null,hosts=data?.hosts??[];
  const savedDraft=data?.spaces.find(s=>s.id===draft?.id);
  const dirty=!!draft&&JSON.stringify(draft)!==JSON.stringify(savedDraft);
  const threadView=useGroupedThreads(data?.spaces??[],showArchived,'',false);
  const spaceThreads=threadView.grouped.spaces.find(group=>group.space.id===space?.id);
  useEffect(()=>{
    if(!data||!subPath||appliedRoute.current===subPath)return;
    let route:string[];try{route=subPath.split('/').filter(Boolean).map(decodeURIComponent);}catch{return;}
    const target=data.spaces.find(s=>s.id===route[0]);if(!target)return;
    appliedRoute.current=subPath;setSelected(target.id);setEditing(false);
    const projectId=route[1]==='project'&&target.projectIds.includes(route[2]??'')?route[2]!:target.primaryProjectId;
    setPrimary(projectId);setLaunchScope(route[1]==='project'?'project':'space');setLaunch(route[1]==='common'||route[1]==='project');setComposerRequest(value=>value+1);
  },[subPath,data]);
  useEffect(()=>{if(launch&&!editing)composerRef.current?.scrollIntoView({block:'start',behavior:'auto'});},[launch,editing,primary,launchScope,selected,composerRequest]);
  const openComposer=(projectId:string,scope:ThreadScope)=>{setPrimary(projectId);setLaunchScope(scope);setLaunch(true);setComposerRequest(value=>value+1);};
  const edit=(s:Space)=>{setDraft(structuredClone(s));setEditing(true);setLaunch(false);setEditRevision(data?.revision??0);setError('');};
  const select=(s:Space)=>{setSelected(s.id);setPrimary(s.primaryProjectId);setEditing(false);setLaunch(false);setError('');};
  const save=async()=>{if(!draft)return;setBusy(true);setError('');try{const s=await rpc.call('save',{space:draft,revision:editRevision});const catalog=await rpc.call('catalog');setData(catalog);setEditRevision(catalog.revision);setDraft(structuredClone(s));setSelected(s.id);setPrimary(s.primaryProjectId);}catch(e){report(e);}finally{setBusy(false);}};
  const submit=async(request:NewThreadRequest)=>{if(!space)throw new Error('Выберите пространство.');setError('');try{
    if(!space.projectIds.includes(request.projectId))throw new Error('В композере выбран проект вне этого пространства. Выберите проект пространства.');
    const hostId=await launchHostId(request.environment,sdk);
    const context=await rpc.call('context',{id:space.id,projectId:request.projectId,hostId});
    const thread=await sdk.threads.spawn({...request,pluginMetadata:threadMetadata(space,launchScope,context.instructions)});
    navigate.toThread(thread.id);setLaunch(false);
  }catch(e){report(e);throw e;}};
  const composer=launch&&space&&data?<section className="ps-composer" aria-label="Новый чат"><div className="ps-composer-header"><h3>{launchScope==='space'?'Общий тред пространства':'Тред проекта'} {launchScope==='space'?space.name:data.projects.find(project=>project.id===primary)?.name}</h3></div><p className="ps-muted">Основной проект можно изменить в композере. Для изоляции выберите штатный worktree BB. Остальные репозитории используются как справочный контекст.</p><NewThreadComposer key={space.id+primary+launchScope} defaultProjectId={primary} draftKey={'space-'+space.id+'-'+primary+'-'+launchScope} onSubmit={submit}/></section>:null;
  return <div className="ps-root"><header className="ps-header"><div><span className="ps-kicker">PROJECT SPACES</span><h1>Работа в контексте проекта</h1><p>Связанные проекты и папки в одном пространстве. Чаты и Git остаются в BB.</p></div><button onClick={()=>edit(empty(data?.projects[0]?.id??''))} disabled={!data}>Создать пространство</button></header>
  {error&&<div role="alert" className="ps-error">{error}</div>}
  {!data?<p role="status">Загрузка…</p>:<div className="ps-layout"><aside><button onClick={refresh}>Обновить</button>{data.spaces.map(s=><button key={s.id} aria-current={selected===s.id?'page':undefined} className="ps-space" onClick={()=>select(s)}><strong>{s.name}</strong><small>Проекты: {s.projectIds.length} · Папки: {s.folders.length}</small></button>)}{!data.spaces.length&&<p className="ps-muted">Создайте пространство и добавьте существующие проекты BB.</p>}</aside><main>
  {editing&&draft?<form onSubmit={e=>{e.preventDefault();void save();}}><h2>{savedDraft?'Настройки пространства':'Новое пространство'}</h2><div className={dirty?'ps-save-required':'ps-save-ready'} role="status"><strong>{dirty?'Шаг 1. Сохраните настройки пространства.':'Настройки сохранены.'}</strong><span>{dirty?'Выберите проекты, папки и группу, затем нажмите «Сохранить настройки» перед блоками интеграций. После сохранения станут доступны инициализация ai-workspace и подготовка Repowise.':'Шаг 2. Ниже нажмите «Инициализировать и обновить папки» для ai-workspace и «Подготовить все папки» для Repowise. Сохранение настроек само по себе их не запускает.'}</span></div><label>Название<input autoFocus required maxLength={100} value={draft.name} onChange={e=>setDraft({...draft,name:e.target.value})}/></label>
  <fieldset><legend>Проекты</legend>{!data.projects.length&&<p className="ps-muted">Добавьте первый проект из папки на вашем устройстве.</p>}{data.projects.map(p=><label className="ps-check" key={p.id}><input type="checkbox" checked={draft.projectIds.includes(p.id)} onChange={e=>{const ids=e.target.checked?[...draft.projectIds,p.id]:draft.projectIds.filter(id=>id!==p.id);setDraft({...draft,projectIds:ids,primaryProjectId:ids.includes(draft.primaryProjectId)?draft.primaryProjectId:ids[0]??''});}}/><span>{p.name}<small>{p.sources.map(s=>s.path).join(' · ')}</small></span></label>)}<AddFolderProject key={draft.id} hosts={hosts} onBusy={setBusy} onCreated={project=>{setData(current=>current?{...current,projects:[...current.projects.filter(p=>p.id!==project.id),project]}:current);setDraft(current=>current?.id===draft.id?{...current,projectIds:[...new Set([...current.projectIds,project.id])],primaryProjectId:current.primaryProjectId||project.id}:current);}}/></fieldset>
  <label>Основной проект<select required value={draft.primaryProjectId} onChange={e=>setDraft({...draft,primaryProjectId:e.target.value})}>{draft.projectIds.map(id=><option key={id} value={id}>{data.projects.find(p=>p.id===id)?.name??id}</option>)}</select></label>
  <fieldset><legend>Дополнительные папки</legend><p className="ps-muted">Справочные пути на выбранном устройстве. Доступ агента определяется разрешениями BB.</p>{draft.folders.map((f,i)=><div className="ps-folder" key={i}><code>{f.path}</code><button type="button" aria-label={`Убрать ${f.path}`} onClick={()=>setDraft({...draft,folders:draft.folders.filter((_,n)=>i!==n)})}>Убрать</button></div>)}<div className="ps-folder"><select aria-label="Устройство папки" value={folderHost||hosts[0]?.id||''} onChange={e=>setFolderHost(e.target.value)}>{hosts.map(h=><option key={h.id} value={h.id}>{h.name}</option>)}</select><input aria-label="Путь дополнительной папки" placeholder="D:\\Projects\\shared" value={folderPath} onChange={e=>setFolderPath(e.target.value)}/><button type="button" disabled={!folderPath.trim()} onClick={()=>{setDraft({...draft,folders:[...draft.folders,{hostId:folderHost||hosts[0]?.id||'',path:folderPath.trim()}]});setFolderPath('');}}>Добавить</button></div></fieldset>
  <label>Общие инструкции<textarea rows={5} maxLength={12000} value={draft.instructions} onChange={e=>setDraft({...draft,instructions:e.target.value})} placeholder="Связи проектов, общие соглашения, порядок проверок"/></label><label>Группа ai-workspace <span className="ps-muted">необязательно</span><input maxLength={100} value={draft.contextGroup} onChange={e=>setDraft({...draft,contextGroup:e.target.value})} placeholder="aifhub"/></label><p className="ps-muted">Группа будет создана при инициализации папок, если её ещё нет.</p><div className="ps-actions ps-save-actions"><button type="submit" disabled={busy||!dirty||!draft.name.trim()||!draft.projectIds.length}>{busy?'Сохранение…':'Сохранить настройки'}</button><button type="button" disabled={busy} onClick={()=>setEditing(false)}>{dirty?'Отмена':'Закрыть настройки'}</button></div>{savedDraft&&<><WorkspaceSettings id={draft.id} group={draft.contextGroup} hosts={hosts} revision={data.revision} dirty={dirty}/><RepowiseSettings id={draft.id} hosts={hosts} revision={data.revision} dirty={dirty}/></>}</form>:space?<>
  <div className="ps-detail-header"><div><h2>{space.name}</h2><p className="ps-muted">{space.contextGroup?`Общий контекст: ${space.contextGroup}`:'Контекст из настроек пространства'}</p></div><div className="ps-actions ps-compose-actions" ref={launch&&launchScope==='space'?composerRef:undefined}><button onClick={()=>openComposer(space.primaryProjectId,'space')}>Новый чат пространства</button>{launch&&launchScope==='space'&&<button onClick={()=>setLaunch(false)}>Закрыть</button>}<button onClick={()=>edit(space)}>Настройки</button></div></div>
  {launchScope==='space'&&composer}
  <div className="ps-thread-filter"><label><input type="checkbox" checked={showArchived} onChange={event=>setShowArchived(event.target.checked)}/> Показать архивные треды</label></div>
  {threadView.error&&<p role="alert" className="ps-error">{threadView.error} <button onClick={threadView.retry}>Повторить</button></p>}
  <section className="ps-common-threads"><h3>Общие треды пространства</h3>{!threadView.ready?<p role="status" className="ps-muted">Загрузка тредов…</p>:spaceThreads?.common.length?<ThreadRows nodes={spaceThreads.common}/>:<p className="ps-muted">Общих тредов пока нет.</p>}</section>
  <div className="ps-projects">{space.projectIds.map(id=>{const p=data.projects.find(p=>p.id===id),isComposerHere=launch&&launchScope==='project'&&primary===id;return <section key={id} className="ps-project-card"><strong>{p?.name??'Недоступный проект'}</strong>{id===space.primaryProjectId&&<span className="ps-badge">Основной</span>}{p?.sources.map(s=><code key={s.hostId}>{s.path}</code>)}<div className="ps-actions ps-compose-actions ps-project-compose-actions" ref={isComposerHere?composerRef:undefined}><button onClick={()=>openComposer(id,'project')}>Новый чат здесь</button>{isComposerHere&&<button onClick={()=>setLaunch(false)}>Закрыть</button>}</div>{isComposerHere&&composer}{threadView.ready&&<div className="ps-project-threads"><ThreadRows nodes={[...(spaceThreads?.projects.find(project=>project.projectId===id)?.threads??[]),...threadView.grouped.loose.filter(node=>node.thread.projectId===id)].sort((a,b)=>b.thread.updatedAt-a.thread.updatedAt)}/></div>}</section>;})}</div>
  {!!space.folders.length&&<section><h3>Дополнительные папки</h3>{space.folders.map((f,i)=><p key={i}><code>{f.path}</code></p>)}</section>}{space.instructions&&<section><h3>Общие инструкции</h3><p className="ps-pre">{space.instructions}</p></section>}<div className="ps-actions"><button onClick={async()=>{if(!confirm(`Убрать пространство «${space.name}»? Проекты, файлы и чаты сохранятся.`))return;try{await rpc.call('remove',{id:space.id,revision:data.revision});setSelected(null);refresh();}catch(e){report(e);}}}>Убрать пространство</button></div>
  </>:<div className="ps-welcome"><h2>Одно пространство для связанной работы</h2><p>Объедините проекты, выберите основной и добавьте общие инструкции. Один проект может входить в несколько пространств.</p><p className="ps-muted">Настройки хранятся в BB. Папки .bb/chats и копии истории не создаются.</p></div>}
  </main></div>}</div>;
}
export default definePluginApp(app=>{registerThreadTransferActions(app);app.slots.navPanel({id:'spaces',title:'Project Spaces',icon:'Folder',path:'spaces',component:SpacesPage});app.slots.experimental_threadList({id:'spaces',title:'Project Spaces',description:'Пространства → общие треды и проекты → треды проектов',component:SpaceThreadSidebar});});
