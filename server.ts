import { randomUUID } from 'node:crypto';
import { defineRpcContract, type BbPluginApi } from '@get-bb/plugin-sdk';
import { z } from 'zod';
import { spaceSchema, validateSpace, contextForSpace, type Space } from './model.ts';
import { readThreadBinding } from './threads.ts';
import { githubRepositoryUrl } from './github.ts';
import { gitRepository } from './repository.ts';
import { workspaceHostContract,workspaceStatus,workspaceSoftware } from './workspace-contract.ts';
import { workspaceRoots } from './workspace-model.ts';
import { folderProjectInput,makeFolderProjectAdder } from './folder-project.ts';
import { transferInput,transferResult,makeThreadTransfer } from './thread-transfer.ts';
import { repowiseStatus,repowiseQuery,repowiseSoftware } from './repowise-contract.ts';
import { contextSpace,contextRoots } from './space-context.ts';
import { continuationSource,makeThreadInheritance } from './thread-inheritance.ts';
import { makeRepowiseAutomation } from './repowise-automation.ts';
import { agentContextInstructions,workspaceMapOnly } from './agent-context.ts';
import { agentsResult } from './agents-contract.ts';
import { discoverReadTools } from './tool-discovery.ts';
const projectSchema=z.object({id:z.string(),name:z.string(),githubUrl:z.string().nullable(),repository:z.object({provider:z.enum(['github','gitlab','gitverse','git']),label:z.string(),url:z.string().url()}).nullable().default(null),sources:z.array(z.object({hostId:z.string(),path:z.string()}))});
export const rpcContract=defineRpcContract({
  agents_status:{input:z.object({hostId:z.string().min(1)}),output:z.object({busy:z.boolean(),error:z.string().nullable(),last:agentsResult.nullable()})},
  agents_sync:{input:z.object({hostId:z.string().min(1),revision:z.number().int()}),output:z.object({started:z.boolean()})},
  repowise_software:{input:z.object({hostId:z.string().min(1),checkLatest:z.boolean()}),output:repowiseSoftware},
  repowise_install:{input:z.object({hostId:z.string().min(1)}),output:repowiseSoftware},
  repowise_status:{input:z.object({id:z.string().uuid(),hostId:z.string().min(1)}),output:repowiseStatus},
  repowise_sync:{input:z.object({id:z.string().uuid(),hostId:z.string().min(1),revision:z.number().int()}),output:z.object({started:z.boolean()})},
  thread_transfer:{input:transferInput,output:transferResult},
  project_from_folder:{input:folderProjectInput,output:z.object({project:projectSchema,reused:z.boolean()})},
  workspace_software:{input:z.object({hostId:z.string().min(1),checkLatest:z.boolean()}),output:workspaceSoftware},
  workspace_install:{input:z.object({hostId:z.string().min(1)}),output:workspaceSoftware},
  workspace_status:{input:z.object({id:z.string().uuid(),hostId:z.string().min(1)}),output:workspaceStatus},
  workspace_sync:{input:z.object({id:z.string().uuid(),hostId:z.string().min(1),revision:z.number().int()}),output:z.object({status:workspaceStatus,results:z.array(z.object({path:z.string(),ok:z.boolean(),message:z.string()}))})},
  catalog:{input:z.null(),output:z.object({spaces:z.array(spaceSchema),projects:z.array(projectSchema),hosts:z.array(z.object({id:z.string(),name:z.string()})),revision:z.number().int()})},
  save:{input:z.object({space:spaceSchema,revision:z.number().int()}),output:spaceSchema},
  remove:{input:z.object({id:z.string(),revision:z.number().int()}),output:z.object({removed:z.boolean()})},
  context:{input:z.object({id:z.string(),projectId:z.string(),hostId:z.string()}),output:z.object({instructions:z.string(),paths:z.array(z.string())})},
  thread_bindings:{input:z.object({threadIds:z.array(z.string().min(1)).max(200)}),output:z.object({bindings:z.array(z.object({threadId:z.string(),spaceId:z.string().nullable(),scope:z.enum(['space','project'])}))})},
});
export default async function plugin(bb:BbPluginApi){
  const host=bb.hosts.experimental_client({contract:workspaceHostContract});
  const syncing=new Set<string>();
  const contextJobs=new Map<string,Promise<unknown>>(),contextErrors=new Map<string,string>();
  const disposeContext=new AbortController();bb.onDispose(()=>disposeContext.abort());
  const db=bb.storage.database();
  db.exec('CREATE TABLE IF NOT EXISTS spaces (id TEXT PRIMARY KEY, data TEXT NOT NULL); CREATE TABLE IF NOT EXISTS state (id INTEGER PRIMARY KEY CHECK(id=1), revision INTEGER NOT NULL); INSERT OR IGNORE INTO state VALUES (1,0)');
  const read=():Space[]=>(db.prepare('SELECT data FROM spaces ORDER BY id').all() as {data:string}[]).map(r=>spaceSchema.parse(JSON.parse(r.data)));
  const revision=()=>(db.prepare('SELECT revision FROM state WHERE id=1').get() as {revision:number}).revision;
  const projects=async()=>(await bb.sdk.projects.list()).map(p=>({id:p.id,name:p.name,githubUrl:githubRepositoryUrl(p.gitRemoteUrl),repository:gitRepository(p.gitRemoteUrl),sources:p.sources.filter(s=>s.type==='local_path').map(s=>({hostId:s.hostId,path:s.path}))}));
  const agentsJobs=new Map<string,Promise<unknown>>(),agentsPending=new Set<string>(),agentsLast=new Map<string,z.infer<typeof agentsResult>>(),agentsErrors=new Map<string,string>();
  function refreshAgents(hostId:string):boolean{
    if(disposeContext.signal.aborted)return false;
    if(agentsJobs.has(hostId)){agentsPending.add(hostId);return false;}
    agentsErrors.delete(hostId);
    const task=(async()=>{
      const catalog=await projects(),spaces=read().filter(space=>space.agentsHosts?.includes(hostId));
      const targets=spaces.flatMap(space=>space.projectIds.flatMap(id=>catalog.find(project=>project.id===id)?.sources.filter(source=>source.hostId===hostId).map(source=>({path:source.path,spaces:[space]}))??[]));
      const result=await host.call('agents_sync',{targets},{hostId,timeoutMs:120000,signal:disposeContext.signal});agentsLast.set(hostId,result);
    })();agentsJobs.set(hostId,task);
    void task.catch(cause=>{agentsErrors.set(hostId,String(cause));}).finally(()=>{agentsJobs.delete(hostId);bb.realtime.publish('agents-changed',{hostId});if(agentsPending.delete(hostId))refreshAgents(hostId);});return true;
  }
  const addFolderProject=makeFolderProjectAdder(bb.sdk);
  const transfer=makeThreadTransfer(bb.sdk,read,projects,()=>bb.realtime.publish('thread-bindings-changed',{}));
  const inheritThread=makeThreadInheritance(bb.sdk,read,()=>bb.realtime.publish('thread-bindings-changed',{}));
  bb.events.on('thread.created',({thread})=>{if(thread.sourceThreadId||thread.parentThreadId)return inheritThread(thread.id).then(()=>undefined);});
  bb.experimental_hooks.on('message.dispatch',async ctx=>{
    const continued=ctx.initiator==='user'&&!!continuationSource(ctx.input.blocks);
    if(ctx.thread.sourceThreadId||ctx.thread.parentThreadId||continued)await inheritThread(ctx.thread.id,ctx.initiator==='user'?ctx.input.blocks:undefined,{replaceLaunch:continued});
    return {action:'proceed'};
  });
  async function repowiseInput(id:string,hostId:string,projectId?:string,environmentPath?:string|null){
    const space=read().find(s=>s.id===id);if(!space)throw new Error('Пространство не найдено.');
    const roots=contextRoots(space,await projects(),hostId,projectId,environmentPath);if(!roots.length)throw new Error('На устройстве нет папок этого пространства.');
    return {spaceId:space.id,name:space.name,roots};
  }
  function startRepowise(input:Awaited<ReturnType<typeof repowiseInput>>,hostId:string){
    const key=hostId+'|'+JSON.stringify(input);if(contextJobs.has(key))return false;contextErrors.delete(key);
    const task=host.call('repowise_sync',input,{hostId,signal:disposeContext.signal,timeoutMs:3600000});contextJobs.set(key,task);
    void task.catch(error=>{contextErrors.set(key,error instanceof Error?error.message:String(error));}).finally(()=>{contextJobs.delete(key);bb.realtime.publish('repowise-changed',{id:input.spaceId,hostId});});
    return true;
  }
  async function repowiseState(input:Awaited<ReturnType<typeof repowiseInput>>,hostId:string){
    const key=hostId+'|'+JSON.stringify(input),status=await host.call('repowise_inspect',input,{hostId,timeoutMs:120000});
    return {...status,busy:status.busy||contextJobs.has(key),error:contextErrors.get(key)??status.error};
  }
  async function workspaceInput(id:string,hostId:string,requireGroup=false){
    const space=read().find(s=>s.id===id);if(!space)throw new Error('Сначала сохраните пространство.');
    if((requireGroup&&!space.contextGroup)||/[\x00-\x1f]/.test(space.contextGroup))throw new Error('Укажите группу ai-workspace и сохраните настройки.');
    const roots=workspaceRoots(space,await projects(),hostId);if(!roots.length)throw new Error('На этом устройстве нет папок пространства.');
    return {spaceId:space.id,group:space.contextGroup,roots};
  }
  const automation=makeRepowiseAutomation({
    resolve:async thread=>{
      if(!read().some(space=>space.projectIds.includes(thread.projectId)))return null;
      const metadata=await bb.sdk.threads.getPluginMetadata({threadId:thread.id});
      let space:Space;try{space=contextSpace(read(),metadata,thread.projectId);}catch{return null;}
      const current=read().find(candidate=>candidate.id===space.id);if(!current||current.repowiseAutoRefresh===false)return null;
      const environment=await bb.sdk.environments.get({environmentId:thread.environmentId!});if(!environment.path)return null;
      return {enabled:true,hostId:environment.hostId,workspace:await repowiseInput(space.id,environment.hostId,thread.projectId,environment.path)};
    },
    inspect:repowiseState,start:startRepowise,onError:cause=>bb.log.debug('Repowise automatic refresh skipped: '+String(cause)),
  });
  bb.onDispose(()=>automation.dispose());
  bb.events.on('thread.active',({thread})=>automation.notify(thread));
  bb.events.on('thread.idle',({thread})=>automation.notify(thread));
  bb.events.on('thread.failed',({thread})=>automation.notify(thread));
  function mutate(expected:number,operation:()=>void){db.transaction(()=>{if(revision()!==expected)throw new Error('Настройки изменены в другом окне. Обновите страницу перед сохранением.');operation();db.prepare('UPDATE state SET revision=revision+1 WHERE id=1').run();})();bb.realtime.publish('spaces-changed',{revision:revision()});}
  const handlers={
    agents_status:async({hostId}:{hostId:string})=>({busy:agentsJobs.has(hostId),error:agentsErrors.get(hostId)??null,last:agentsLast.get(hostId)??null}),
    agents_sync:async({hostId,revision:expected}:{hostId:string;revision:number})=>{if(expected!==revision())throw new Error('Настройки изменились. Обновите страницу.');return {started:refreshAgents(hostId)};},
    repowise_software:async({hostId,checkLatest}:{hostId:string;checkLatest:boolean})=>host.call('repowise_software',{checkLatest},{hostId,timeoutMs:120000}),
    repowise_install:async({hostId}:{hostId:string})=>{const result=await host.call('repowise_install',{},{hostId,timeoutMs:1500000});for(const key of contextErrors.keys())if(key.startsWith(hostId+'|'))contextErrors.delete(key);bb.realtime.publish('repowise-changed',{hostId});return result;},
    repowise_status:async({id,hostId}:{id:string;hostId:string})=>repowiseState(await repowiseInput(id,hostId),hostId),
    repowise_sync:async({id,hostId,revision:expected}:{id:string;hostId:string;revision:number})=>{if(expected!==revision())throw new Error('Настройки изменились. Обновите страницу.');return {started:startRepowise(await repowiseInput(id,hostId),hostId)};},
    thread_transfer:transfer,
    project_from_folder:async(input:z.input<typeof folderProjectInput>)=>{const result=await addFolderProject(input),p=result.project;bb.realtime.publish('catalog-changed',{});return {project:{id:p.id,name:p.name,githubUrl:githubRepositoryUrl(p.gitRemoteUrl),repository:gitRepository(p.gitRemoteUrl),sources:p.sources.map(s=>({hostId:s.hostId,path:s.path}))},reused:result.reused};},
    workspace_software:async({hostId,checkLatest}:{hostId:string;checkLatest:boolean})=>host.call('software',{checkLatest},{hostId,timeoutMs:120000}),
    workspace_install:async({hostId}:{hostId:string})=>{const result=await host.call('install',{},{hostId,timeoutMs:300000});bb.realtime.publish('workspace-changed',{hostId});return result;},
    workspace_status:async({id,hostId}:{id:string;hostId:string})=>host.call('inspect',await workspaceInput(id,hostId),{hostId,timeoutMs:60000}),
    workspace_sync:async({id,hostId,revision:expected}:{id:string;hostId:string;revision:number})=>{
      if(expected!==revision())throw new Error('Настройки изменились. Обновите страницу.');
      if(syncing.has(id))throw new Error('Синхронизация пространства уже выполняется.');syncing.add(id);
      try {const result=await host.call('synchronize',await workspaceInput(id,hostId,true),{hostId,timeoutMs:300000});bb.realtime.publish('workspace-changed',{id,hostId});return result;}finally{syncing.delete(id);}
    },
    catalog:async()=>({spaces:read(),projects:await projects(),hosts:(await bb.sdk.hosts.list()).map(h=>({id:h.id,name:h.name})),revision:revision()}),
    save:async({space,revision:expected}:{space:Space;revision:number})=>{if(syncing.has(space.id))throw new Error('Дождитесь синхронизации ai-workspace.');validateSpace(space,await projects());const previous=read().find(row=>row.id===space.id);mutate(expected,()=>{db.prepare('INSERT OR REPLACE INTO spaces VALUES (?,?)').run(space.id,JSON.stringify(space));});for(const hostId of new Set([...(previous?.agentsHosts??[]),...(space.agentsHosts??[])]))refreshAgents(hostId);return space;},
    remove:async({id,revision:expected}:{id:string;revision:number})=>{if(syncing.has(id))throw new Error('Дождитесь синхронизации ai-workspace.');const previous=read().find(row=>row.id===id);let removed=false;mutate(expected,()=>{removed=db.prepare('DELETE FROM spaces WHERE id=?').run(id).changes>0;});for(const hostId of previous?.agentsHosts??[])refreshAgents(hostId);return {removed};},
    context:async({id,projectId,hostId}:{id:string;projectId:string;hostId:string})=>{const space=read().find(s=>s.id===id);if(!space)throw new Error('Пространство не найдено.');const catalog=await projects();validateSpace(space,catalog);return contextForSpace(space,catalog,projectId,hostId);},
    thread_bindings:async({threadIds}:{threadIds:string[]})=>{
      if(!threadIds.length)return {bindings:[]};
      const result=await bb.sdk.threads.experimental_listPluginMetadata({threadIds});
      return {bindings:result.threads.flatMap(row=>{const binding=readThreadBinding(row.metadata);return binding?[{threadId:row.threadId,...binding}]:[];})};
    },
  };
  bb.rpc.register(rpcContract,handlers,{experimental_discoverable:true,experimental_description:'Project Spaces: related projects, folders and shared context. Removing a space preserves all projects, files and chats.'});
  for(const hostId of new Set(read().flatMap(space=>space.agentsHosts??[])))refreshAgents(hostId);
  const readTools=new Set(['workspace_context','workspace_read','workspace_search','workspace_search_fulltext','workspace_service_graph','workspace_events','workspace_event_details','list_groups','list_projects','project_tree','project_grep','project_context','codegraph_context','codegraph_search','codegraph_node','codegraph_status','codegraph_callers','codegraph_callees']);
  const bounded=(value:unknown)=>{const text=JSON.stringify(value);return text.length<=30000?text:JSON.stringify({truncated:true,preview:text.slice(0,27000),hint:'Запросите один repo и более узкий scope/targets. Для list_tools передайте tool.'});};
  bb.agents.registerTool({
    name:'project_spaces_repowise',description:'Read code context across every folder/repository of the current Project Space on this thread host. Start with context for aliases/index readiness. prepare starts local indexing without model calls; poll context. list_tools discovers read schemas (optional tool). call defaults to repo=all: federated tools query the workspace; other tools fan out with repo-labelled evidence. Actual active worktree replaces the base checkout; unavailable hosts are never substituted.',
    parameters:repowiseQuery.extend({operation:z.enum(['context','prepare','list_tools','call']),spaceId:z.string().uuid().optional()}),
    async execute(input,ctx){
      const metadata=await bb.sdk.threads.getPluginMetadata({threadId:ctx.threadId});const space=contextSpace(read(),metadata,ctx.projectId,input.spaceId);
      const thread=await bb.sdk.threads.get({threadId:ctx.threadId});if(!thread.environmentId)throw new Error('У треда нет рабочей среды.');
      const environment=await bb.sdk.environments.get({environmentId:thread.environmentId});
      const workspace=await repowiseInput(space.id,environment.hostId,ctx.projectId,environment.path);
      if(input.operation==='prepare')return bounded({started:startRepowise(workspace,environment.hostId),hint:'Проверяйте operation=context до prepared=true, busy=false, stale=false. Если busy=true, подготовка уже идёт; повторно prepare не вызывайте. Если busy=false и error задана, сообщите об ошибке и проверьте исходники.'});
      if(input.operation==='context')return bounded(await repowiseState(workspace,environment.hostId));
      return {content:[{type:'text' as const,text:bounded(await host.call('repowise_query',{workspace,query:{operation:input.operation,repo:input.repo,tool:input.tool,arguments:input.arguments}},{hostId:environment.hostId,signal:ctx.signal,timeoutMs:180000}))}]};
    },
  });
  bb.agents.registerTool({
    name:'project_spaces_workspace',description:'Read ai-workspace context in this Project Space group on the thread host. Start with operation=context. list_tools returns a compact catalog; pass tool=<name> for one full schema, then call. The configured global MCP may use a different group.',
    parameters:z.object({operation:z.enum(['context','list_tools','call']),spaceId:z.string().uuid().optional(),tool:z.string().max(80).optional(),arguments:z.record(z.string(),z.unknown()).optional()}),
    async execute(input,ctx){
      const metadata=await bb.sdk.threads.getPluginMetadata({threadId:ctx.threadId});
      const space=contextSpace(read(),metadata,ctx.projectId,input.spaceId);if(!space.contextGroup)throw new Error('Группа пространства недоступна.');
      const thread=await bb.sdk.threads.get({threadId:ctx.threadId});if(!thread.environmentId)throw new Error('У треда нет рабочей среды.');
      const environment=await bb.sdk.environments.get({environmentId:thread.environmentId});if(!environment.path)throw new Error('Рабочая папка недоступна.');
      const tool=input.operation==='context'?'workspace_context':input.tool;
      if(input.operation==='call'&&(!tool||!readTools.has(tool)))throw new Error('Выберите инструмент чтения из list_tools.');
      if(input.operation==='list_tools'&&tool&&!readTools.has(tool))throw new Error('Выберите инструмент чтения из list_tools.');
      const result=await host.call('mcp',{group:space.contextGroup,cwd:environment.path,method:input.operation==='list_tools'?'tools/list':'tools/call',...(tool?{tool}:{}),arguments:input.arguments??{}},{hostId:environment.hostId,signal:ctx.signal,timeoutMs:60000});
      if(input.operation==='list_tools')return bounded(discoverReadTools(result,readTools,tool));
      return {content:[{type:'text' as const,text:bounded(result)}],isError:(result as {isError?:boolean})?.isError===true};
    },
  });
  bb.agents.configure(ctx=>{
    const candidates=read().filter(s=>s.projectIds.includes(ctx.project.id));
    if(ctx.pluginMetadata.spaceId===null||!candidates.length)return {tools:[],skills:[]};
    let space:Space;try{space=contextSpace(candidates,ctx.pluginMetadata,ctx.project.id);}catch{
      if(ctx.pluginMetadata.spaceId||ctx.pluginMetadata.spaceSnapshot)return {tools:[],skills:[]};
      return {tools:['project_spaces_workspace','project_spaces_repowise'],skills:['project-spaces'],instructions:`This project belongs to multiple Project Spaces. Do not choose implicitly. Ask which space to use, then pass its spaceId to both tools: ${JSON.stringify(candidates.map(s=>({spaceId:s.id,name:s.name})))}`};
    }
    const current=space;
    const map=typeof ctx.pluginMetadata.workspaceMap==='string'?workspaceMapOnly(ctx.pluginMetadata.workspaceMap).slice(0,18000):'';
    return {tools:[...(current.contextGroup?['project_spaces_workspace']:[]),'project_spaces_repowise'],skills:['project-spaces'],instructions:[
      'Project Spaces: this thread uses the workspace configuration snapshot saved at creation or its latest transfer. Listed paths do not grant filesystem permissions.',map,
      ctx.pluginMetadata.threadScope==='space'?'This is a shared workspace thread. Coordinate the task across the selected projects.':'This is a project thread. Focus changes on the selected project while considering the shared workspace context.',
      space.instructions,
      agentContextInstructions(current),
      'repo=all searches across the space or fans out by repo when native all is unsupported. Honor upstream stale_warning, degraded and completeness fields. Never silently replace unavailable paths.',
      'Use BB thread storage for artifacts and temporary files. Do not export history or create .bb/chats. Read each directory\'s applicable AGENTS.md. Clean task-owned temporary build dependencies after validation; preserve requested results.',
    ].filter(Boolean).join('\n\n')};
  });
  bb.cli.register({name:'project-spaces',summary:'List spaces and inspect shared project context',commands:[
    {name:'thread-binding',summary:'Inspect a thread placement',usage:'bb project-spaces thread-binding <thread-id> [--json]'},
    {name:'inherit',summary:'Restore placement from the original thread',usage:'bb project-spaces inherit <thread-id> [--replace] [--json]'},
    {name:'repowise-status',summary:'Inspect this space on one host',usage:'bb project-spaces repowise-status <space-id> <host-id> [--json]'},
    {name:'repowise-sync',summary:'Prepare/update space indexes without model calls or editor changes',usage:'bb project-spaces repowise-sync <space-id> <host-id> [--json]'},
    {name:'repowise-query',summary:'Read context across a prepared space without launching an agent',usage:'bb project-spaces repowise-query <space-id> <host-id> <tool> [query] [--json]'},
    {name:'list',summary:'List spaces and projects',usage:'bb project-spaces list [--json]'},
    {name:'create',summary:'Group existing projects',usage:'bb project-spaces create <name> <primary-project-id> [project-id...] [--json]'},
    {name:'context',summary:'Resolve paths on one device',usage:'bb project-spaces context <space-id> <project-id> <host-id> [--json]'}],
    async run(argv){const [command,...args]=argv.filter(a=>a!=='--json');try{let value:unknown;
      if(command==='list')value=await handlers.catalog();
      else if(command==='thread-binding'&&args.length===1){const metadata=await bb.sdk.threads.getPluginMetadata({threadId:args[0]!});value={threadId:args[0],binding:readThreadBinding(metadata),storedScope:metadata.threadScope??null,bindingOrigin:metadata.bindingOrigin??null,inheritedFrom:metadata.inheritedFrom??null,metadataKeys:Object.keys(metadata)};}
      else if(command==='inherit'&&(args.length===1||(args.length===2&&args[1]==='--replace')))value=await inheritThread(args[0]!,undefined,{replaceExisting:args[1]==='--replace'});
      else if(command==='repowise-status'&&args.length===2)value=await handlers.repowise_status({id:args[0]!,hostId:args[1]!});
      else if(command==='repowise-sync'&&args.length===2)value=await handlers.repowise_sync({id:args[0]!,hostId:args[1]!,revision:revision()});
      else if(command==='repowise-query'&&args.length>=3)value=await host.call('repowise_query',{workspace:await repowiseInput(args[0]!,args[1]!),query:repowiseQuery.parse({operation:'call',repo:'all',tool:args[2],arguments:args.length>3?{query:args.slice(3).join(' ')}:{}})},{hostId:args[1]!,timeoutMs:180000});
      else if(command==='create'&&args.length>=2){const space:Space={id:randomUUID(),name:args[0]!,projectIds:[...new Set(args.slice(1))],primaryProjectId:args[1]!,folders:[],instructions:'',contextGroup:''};value=await handlers.save({space,revision:revision()});}
      else if(command==='context'&&args.length===3)value=await handlers.context({id:args[0]!,projectId:args[1]!,hostId:args[2]!});
      else return {exitCode:command&&command!=='help'&&command!=='--help'?1:0,stdout:'bb project-spaces list | create <name> <primary-project-id> [project-id...] | context <space-id> <project-id> <host-id> | thread-binding <thread-id> | inherit <thread-id> [--json]'};
      return {exitCode:0,stdout:JSON.stringify(value,null,2)};
    }catch(e){return {exitCode:1,stderr:e instanceof Error?e.message:String(e)};}}
  });
}
