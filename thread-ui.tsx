import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  useRpc, useRealtime, useSdk, useBbNavigate, ThreadTitle,
  experimental_useSidebarThreads as useSidebarThreads,
  experimental_ThreadActionsContextMenu as ThreadContextMenu,
  experimental_ThreadActionsMenu as ThreadMenu,
  experimental_ThreadStatusGlyph as StatusGlyph,
  experimental_ThreadRowMetadata as ThreadRowMetadata,
  experimental_resolveThreadStatus as resolveStatus,
  experimental_Icon as Icon,
  experimental_ProviderIcon as ProviderIcon,
  experimental_useProviders as useProviders,
  experimental_useThreadActions as useThreadActions,
  experimental_useRpcKeyedQuery as useRpcKeyedQuery,
  useSidebarThreadDraftIds,
  useSidebarThreadRowStatus,
  useSidebarThreadRowStatuses,
  type PluginSidebarThread, type PluginThreadListProps,
} from '@get-bb/plugin-sdk/app';
import type { rpcContract } from './server';
import type { Space } from './model';
import { flattenThreads, groupThreads, type ThreadBinding, type ThreadNode } from './threads.ts';
import './thread-list.css';
import { githubPrStatus, githubPullRequestUrl } from './github.ts';
import { threadAttentionTone, threadFamilyAttention, type ThreadAttention } from './thread-attention.ts';
import { ProjectTransferDialog,type ProjectTransferSelection } from './thread-transfer-ui.tsx';

const activeOnly = { experimental_lifecycles: ['active'] as const };
const allLifecycles = { experimental_lifecycles: ['active','archived'] as const };

function PullRequestLink({thread}:{thread:PluginSidebarThread}) {
  const navigate=useBbNavigate();
  const environmentId=thread.environment?.id;
  const {data}=useRpcKeyedQuery({pluginId:'bb--github-pr-status',contract:githubPrStatus,method:'pullRequests',keys:environmentId?[environmentId]:[],enabled:!!environmentId});
  const row=environmentId?data?.[environmentId]:undefined;
  const pr=row?.outcome==='available'?row.pullRequest:null;
  const url=pr?githubPullRequestUrl(pr.url):null;
  return pr&&url?<a className="pst-pr-link" href={url} target="_blank" rel="noopener noreferrer" title={`PR #${pr.number}: ${pr.title}`} aria-label={`Открыть PR #${pr.number} на GitHub`} onClick={event=>{event.stopPropagation();if(!event.ctrlKey&&!event.metaKey&&!event.shiftKey&&event.button===0&&navigate.openUrl(url))event.preventDefault();}}><Icon name="Github"/></a>:null;
}

export function useGroupedThreads(spaces: readonly Space[], includeArchived = false, query = '', separatePinned = true) {
  const state = useSidebarThreads(includeArchived ? allLifecycles : activeOnly);
  const rpc = useRpc<typeof rpcContract>(), sdk = useSdk();
  const [epoch, setEpoch] = useState(0);
  const [loaded, setLoaded] = useState<{key:string;bindings:Record<string,ThreadBinding>} | null>(null);
  const [error, setError] = useState('');
  const retry = useCallback(() => setEpoch(e => e+1), []);
  const key = state.threads.filter(t => !t.isHidden).map(t => t.id).sort().join('|');
  useRealtime('thread-bindings-changed', retry);
  useEffect(() => sdk.subscribe({event:'realtime:connection',callback:event=>{if(event.reconnected)retry();}}), [sdk,retry]);
  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const ids = key ? key.split('|') : [];
        const bindings:Record<string,ThreadBinding> = {};
        // Read only the live sidebar's IDs, in bounded batches. Never download chat histories.
        for (let offset=0; offset<ids.length; offset+=200) {
          if (cancelled) return;
          const result = await rpc.call('thread_bindings', {threadIds:ids.slice(offset,offset+200)});
          for (const row of result.bindings) bindings[row.threadId] = {spaceId:row.spaceId,scope:row.scope};
        }
        if (!cancelled) { setLoaded({key,bindings}); setError(''); }
      } catch (cause) { if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause)); }
    }
    void load();
    return () => { cancelled = true; };
  }, [key,epoch,rpc]);
  const ready = state.status === 'ready' && loaded?.key === key && !error;
  const grouped = useMemo(() => groupThreads(state.threads, spaces, loaded?.bindings ?? {}, {includeArchived,query,separatePinned}), [state.threads,spaces,loaded,includeArchived,query,separatePinned]);
  return {state,grouped,ready,error,retry};
}

function ThreadRow({node,activeThreadId,onNavigate,attention}:{node:ThreadNode<PluginSidebarThread>;activeThreadId?:string|null;onNavigate?:()=>void;attention:ReadonlyMap<string,ThreadAttention>}) {
  const navigate = useBbNavigate(),sdk=useSdk();
  const [expanded,setExpanded] = useState(false);
  const thread = node.thread;
  const target = {...thread, environment:thread.environment?.id ? {id:thread.environment.id,path:thread.environment.path} : null};
  const {providers} = useProviders();
  const provider = providers.find(value => value.id === thread.providerId) ?? {id:thread.providerId};
  const draftIds = useSidebarThreadDraftIds();
  const rowStatus = useSidebarThreadRowStatus(thread.id);
  const quickAction = useThreadActions(target, {keys:['bb--core/archive']})[0]?.action;
  const hidden = expanded ? [] : flattenThreads(node.children);
  const hasUnsubmittedDraft = draftIds.has(thread.id) || hidden.some(child => draftIds.has(child.id));
  const status = resolveStatus({thread,hiddenThreads:hidden,hasUnsubmittedDraft,rowStatus});
  const threadAttention = attention.get(thread.id);
  return <div className="pst-family">
    <ThreadContextMenu thread={target}><div data-unread-tone={threadAttention?.tone??undefined} data-attention-source={threadAttention?.fromDescendant?'descendant':undefined} className={'pst-row'+(thread.id===activeThreadId?' pst-active':'')+(thread.isUnread?' pst-unread':'')}>
      <span className="pst-leading">
        <ProviderIcon providerKind="agent" provider={provider} className="pst-provider"/>
        {node.children.length>0&&<button className="pst-expand" title={expanded?'Свернуть дочерние треды':'Развернуть дочерние треды'} aria-label={expanded?'Свернуть дочерние треды':'Развернуть дочерние треды'} aria-expanded={expanded} onClick={()=>setExpanded(!expanded)}><Icon name="ChevronRight" className={expanded?'pst-chevron pst-rotated':'pst-chevron'}/></button>}
      </span>
      <a href={thread.href} title={thread.displayTitle} aria-current={thread.id===activeThreadId?'page':undefined} onClick={event=>{
        if(event.button!==0||event.altKey||event.shiftKey)return;
        event.preventDefault();
        // Persist acknowledgement even when the target pane is not focused yet.
        void sdk.threads.markRead({threadId:thread.id}).catch(()=>undefined);
        navigate.toThread(thread.id,{split:event.ctrlKey||event.metaKey});onNavigate?.();
      }}><span className="pst-thread-title"><ThreadTitle threadId={thread.id}/></span><span className="pst-row-metadata"><ThreadRowMetadata thread={thread}/></span></a>
      <span className="pst-trailing">
        <PullRequestLink thread={thread}/>
        <span className="pst-indicators">
          <span className="pst-status" title={status.label??undefined}>
            {node.children.length>0&&!expanded&&<small>{node.children.length}</small>}
            <StatusGlyph indicator={status.indicator} archived={thread.isArchived} rowStatus={status.rowStatus}/>
          </span>
          <span className="pst-row-actions">
            {quickAction&&<button className="pst-quick-action" title={quickAction.label} aria-label={quickAction.label} disabled={quickAction.disabled} onClick={()=>void quickAction.run()}><Icon name={quickAction.icon}/></button>}
            <ThreadMenu thread={target} trigger={props=><button {...props} className={[props.className,'pst-menu'].filter(Boolean).join(' ')} title={`Действия: ${thread.displayTitle}`} aria-label={`Действия: ${thread.displayTitle}`}><Icon name="MoreHorizontal"/></button>}/>
          </span>
        </span>
      </span>
    </div></ThreadContextMenu>
    {expanded&&<div className="pst-children">{node.children.map(child=><ThreadRow key={child.thread.id} node={child} activeThreadId={activeThreadId} onNavigate={onNavigate} attention={attention}/>)}</div>}
  </div>;
}

export function ThreadRows({nodes,activeThreadId,onNavigate,initialLimit=12}:{nodes:ThreadNode<PluginSidebarThread>[];activeThreadId?:string|null;onNavigate?:()=>void;initialLimit?:number}) {
  const [limit,setLimit] = useState(initialLimit);
  const rowStatuses=useSidebarThreadRowStatuses(),draftIds=useSidebarThreadDraftIds();
  const attention=useMemo(()=>threadFamilyAttention(nodes,thread=>threadAttentionTone(thread.isUnread,resolveStatus({thread,hiddenThreads:[],hasUnsubmittedDraft:draftIds.has(thread.id),rowStatus:rowStatuses.get(thread.id)??null}),thread.id===activeThreadId,thread.hasPendingInteraction)),[nodes,rowStatuses,draftIds,activeThreadId]);
  return <div className="pst-rows">{nodes.slice(0,limit).map(node=><ThreadRow key={node.thread.id} node={node} activeThreadId={activeThreadId} onNavigate={onNavigate} attention={attention}/>)}{nodes.length>limit&&<button className="pst-more" onClick={()=>setLimit(limit+initialLimit)}>Ещё {Math.min(initialLimit,nodes.length-limit)} из {nodes.length-limit}</button>}</div>;
}

function Group({id,title,count,children,open=true,icon,onNew,onSettings,repositoryUrl,onTransfer}:{id:string;title:string;count?:number;children:ReactNode;open?:boolean;icon?:string;onNew?:()=>void;onSettings?:()=>void;repositoryUrl?:string|null;onTransfer?:()=>void}) {
  const navigate=useBbNavigate();
  const [expanded,setExpanded] = useState(()=>{try {const value=localStorage.getItem('project-spaces.group.'+id);return value===null?open:value==='open';}catch{return open;}});
  const toggle=()=>{setExpanded(!expanded);try{localStorage.setItem('project-spaces.group.'+id,expanded?'closed':'open');}catch{/* Storage may be unavailable in an embedded client. */}};
  return <section className={'pst-group'+(icon?' pst-project-group':'')}>
    <div className="pst-heading">
      <button className="pst-group-toggle" onClick={toggle} aria-expanded={expanded} title={title}>
        {icon&&<Icon name={icon} className="pst-group-icon"/>}<span>{title}</span>
        <Icon name="ChevronRight" className={expanded?'pst-chevron pst-rotated':'pst-chevron'}/>
      </button>
      {count!==undefined&&count>0&&<small className="pst-count">{count}</small>}
      <span className="pst-heading-actions">
        {repositoryUrl&&<a href={repositoryUrl} target="_blank" rel="noopener noreferrer" title={`GitHub: ${title}`} aria-label={`Репозиторий ${title} на GitHub`} onClick={event=>{if(!event.ctrlKey&&!event.metaKey&&!event.shiftKey&&event.button===0&&navigate.openUrl(repositoryUrl))event.preventDefault();}}><Icon name="Github"/></a>}
        {onNew&&<button onClick={onNew} title={`Новый тред: ${title}`} aria-label={`Новый тред: ${title}`}><Icon name="MessageSquarePlus"/></button>}
        {onSettings&&<button onClick={onSettings} title={`Настройки: ${title}`} aria-label={`Настройки: ${title}`}><Icon name="Settings"/></button>}
        {onTransfer&&<button onClick={onTransfer} title={`Перенос и копирование тредов: ${title}`} aria-label={`Перенос и копирование тредов: ${title}`}><Icon name="MoreHorizontal"/></button>}
      </span>
    </div>
    {expanded&&<div className="pst-group-body">{children}</div>}
  </section>;
}

export function SpaceThreadSidebar(props:PluginThreadListProps) {
  const rpc=useRpc<typeof rpcContract>(),navigate=useBbNavigate();
  const [spaces,setSpaces]=useState<Space[]>([]),[catalogReady,setCatalogReady]=useState(false),[catalogError,setCatalogError]=useState('');
  const [repositories,setRepositories]=useState<Record<string,string|null>>({});
  const [query,setQuery]=useState(''),[archived,setArchived]=useState(false);
  const [transferSelection,setTransferSelection]=useState<ProjectTransferSelection|null>(null);
  const refresh=useCallback(()=>{rpc.call('catalog').then(result=>{setSpaces(result.spaces);setRepositories(Object.fromEntries(result.projects.map(p=>[p.id,p.githubUrl])));setCatalogReady(true);setCatalogError('');},cause=>setCatalogError(String(cause)));},[rpc]);
  useEffect(refresh,[refresh]);useRealtime('spaces-changed',refresh);
  const {state,grouped,ready,error,retry}=useGroupedThreads(spaces,archived,query);
  const openSpace=(space:Space,projectId?:string)=>{navigate.toPluginPanel('spaces',{subPath:space.id+(projectId?'/project/'+projectId:'/common')+'/'+Date.now()});props.onNavigate();};
  const rows=(nodes:ThreadNode<PluginSidebarThread>[])=><ThreadRows nodes={nodes} activeThreadId={props.activeThreadId} onNavigate={props.onNavigate}/>;
  const count=(nodes:ThreadNode<PluginSidebarThread>[])=>flattenThreads(nodes).length;
  const failure=catalogError||error||(state.status==='error'?'Не удалось загрузить треды BB.':'');
  return <div className="pst-sidebar" aria-label="Треды по пространствам и проектам">
    <div className="pst-toolbar"><label className="pst-search"><Icon name="Search"/><input aria-label="Поиск тредов" placeholder="Поиск тредов" value={query} onChange={e=>setQuery(e.target.value)}/></label><button className="pst-archive-filter" aria-label="Показать архивные треды" title="Показать архивные треды" aria-pressed={archived} onClick={()=>setArchived(!archived)}><Icon name="Archive"/></button></div>
    {failure?<div role="alert" className="pst-notice">{failure}<button onClick={()=>{refresh();retry();}}>Повторить</button></div>:!ready||!catalogReady?<p role="status" className="pst-notice">Загрузка тредов…</p>:<>
      {grouped.pinned.length>0&&<Group id="pinned" title="Закреплённые" count={count(grouped.pinned)}>{rows(grouped.pinned)}</Group>}
      {grouped.spaces.map(group=><Group key={group.space.id} id={'space-'+group.space.id} title={group.space.name} count={count(group.common)+group.projects.reduce((sum,p)=>sum+count(p.threads),0)} onNew={()=>openSpace(group.space)} onSettings={()=>{navigate.toPluginPanel('spaces',{subPath:group.space.id});props.onNavigate();}}>
        <Group id={'common-'+group.space.id} title="Общие треды" count={count(group.common)} icon="MessageSquare" onNew={()=>openSpace(group.space)}>{rows(group.common)}</Group>
        {group.projects.map(project=><Group key={project.projectId} id={group.space.id+'-'+project.projectId} title={state.projects.find(p=>p.id===project.projectId)?.name??'Недоступный проект'} count={count(project.threads)} icon="Folder" repositoryUrl={repositories[project.projectId]} onNew={()=>openSpace(group.space,project.projectId)} onTransfer={project.threads.length?()=>setTransferSelection({projectId:project.projectId,threadIds:project.threads.map(n=>n.thread.id),currentSpaceId:group.space.id}):undefined}>
          {rows(project.threads)}
        </Group>)}
      </Group>)}
      {grouped.loose.length>0&&<div className="pst-loose-label">Треды вне пространств</div>}
      {state.projects.map(project=>{const nodes=grouped.loose.filter(n=>n.thread.projectId===project.id);if(!nodes.length)return null;return <Group key={project.id} id={'project-'+project.id} title={project.isPersonal?'Личные треды':project.name} count={count(nodes)} icon={project.isPersonal?undefined:'Folder'} repositoryUrl={repositories[project.id]} onTransfer={!project.isPersonal?()=>setTransferSelection({projectId:project.id,threadIds:nodes.map(n=>n.thread.id)}):undefined} onNew={()=>{navigate.toCompose({projectId:project.id});props.onNavigate();}}>{rows(nodes)}</Group>;})}
      {grouped.loose.some(n=>!state.projects.some(p=>p.id===n.thread.projectId))&&<Group id="other" title="Другие треды">{rows(grouped.loose.filter(n=>!state.projects.some(p=>p.id===n.thread.projectId)))}</Group>}
      {state.experimental_archived?.hasNextPage&&<button className="pst-more" disabled={state.experimental_archived.isFetchingNextPage} onClick={()=>void state.experimental_archived?.fetchNextPage()}>Загрузить ещё архивные треды</button>}
      {state.experimental_archived?.isFetchNextPageError&&<p role="alert">Архив загружен частично. Повторите загрузку.</p>}
    </>}
    {transferSelection&&<ProjectTransferDialog {...transferSelection} spaces={spaces} onClose={()=>setTransferSelection(null)}/>}
  </div>;
}
