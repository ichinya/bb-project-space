import { randomUUID } from 'node:crypto';
import { defineRpcContract, type BbPluginApi } from '@get-bb/plugin-sdk';
import { z } from 'zod';
import { spaceSchema, validateSpace, contextForSpace, type Space } from './model.ts';
import { readThreadBinding } from './threads.ts';
import { githubRepositoryUrl } from './github.ts';
import { workspaceHostContract,workspaceStatus,workspaceSoftware } from './workspace-contract.ts';
import { workspaceRoots } from './workspace-model.ts';
import { folderProjectInput,makeFolderProjectAdder } from './folder-project.ts';
const projectSchema=z.object({id:z.string(),name:z.string(),githubUrl:z.string().nullable(),sources:z.array(z.object({hostId:z.string(),path:z.string()}))});
export const rpcContract=defineRpcContract({
  project_from_folder:{input:folderProjectInput,output:z.object({project:projectSchema,reused:z.boolean()})},
  workspace_software:{input:z.object({hostId:z.string().min(1),checkLatest:z.boolean()}),output:workspaceSoftware},
  workspace_install:{input:z.object({hostId:z.string().min(1)}),output:workspaceSoftware},
  workspace_status:{input:z.object({id:z.string().uuid(),hostId:z.string().min(1)}),output:workspaceStatus},
  workspace_sync:{input:z.object({id:z.string().uuid(),hostId:z.string().min(1),revision:z.number().int()}),output:z.object({status:workspaceStatus,results:z.array(z.object({path:z.string(),ok:z.boolean(),message:z.string()}))})},
  catalog:{input:z.null(),output:z.object({spaces:z.array(spaceSchema),projects:z.array(projectSchema),hosts:z.array(z.object({id:z.string(),name:z.string()})),revision:z.number().int()})},
  save:{input:z.object({space:spaceSchema,revision:z.number().int()}),output:spaceSchema},
  remove:{input:z.object({id:z.string(),revision:z.number().int()}),output:z.object({removed:z.boolean()})},
  context:{input:z.object({id:z.string(),projectId:z.string(),hostId:z.string()}),output:z.object({instructions:z.string(),paths:z.array(z.string())})},
  thread_bindings:{input:z.object({threadIds:z.array(z.string().min(1)).max(200)}),output:z.object({bindings:z.array(z.object({threadId:z.string(),spaceId:z.string(),scope:z.enum(['space','project'])}))})},
});
export default async function plugin(bb:BbPluginApi){
  const host=bb.hosts.experimental_client({contract:workspaceHostContract});
  const syncing=new Set<string>();
  const db=bb.storage.database();
  db.exec('CREATE TABLE IF NOT EXISTS spaces (id TEXT PRIMARY KEY, data TEXT NOT NULL); CREATE TABLE IF NOT EXISTS state (id INTEGER PRIMARY KEY CHECK(id=1), revision INTEGER NOT NULL); INSERT OR IGNORE INTO state VALUES (1,0)');
  const read=():Space[]=>(db.prepare('SELECT data FROM spaces ORDER BY id').all() as {data:string}[]).map(r=>spaceSchema.parse(JSON.parse(r.data)));
  const revision=()=>(db.prepare('SELECT revision FROM state WHERE id=1').get() as {revision:number}).revision;
  const projects=async()=>(await bb.sdk.projects.list()).map(p=>({id:p.id,name:p.name,githubUrl:githubRepositoryUrl(p.gitRemoteUrl),sources:p.sources.filter(s=>s.type==='local_path').map(s=>({hostId:s.hostId,path:s.path}))}));
  const addFolderProject=makeFolderProjectAdder(bb.sdk);
  async function workspaceInput(id:string,hostId:string,requireGroup=false){
    const space=read().find(s=>s.id===id);if(!space)throw new Error('Сначала сохраните пространство.');
    if((requireGroup&&!space.contextGroup)||/[\x00-\x1f]/.test(space.contextGroup))throw new Error('Укажите группу ai-workspace и сохраните настройки.');
    const roots=workspaceRoots(space,await projects(),hostId);if(!roots.length)throw new Error('На этом устройстве нет папок пространства.');
    return {spaceId:space.id,group:space.contextGroup,roots};
  }
  function mutate(expected:number,operation:()=>void){db.transaction(()=>{if(revision()!==expected)throw new Error('Настройки изменены в другом окне. Обновите страницу перед сохранением.');operation();db.prepare('UPDATE state SET revision=revision+1 WHERE id=1').run();})();bb.realtime.publish('spaces-changed',{revision:revision()});}
  const handlers={
    project_from_folder:async(input:z.input<typeof folderProjectInput>)=>{const result=await addFolderProject(input),p=result.project;bb.realtime.publish('catalog-changed',{});return {project:{id:p.id,name:p.name,githubUrl:githubRepositoryUrl(p.gitRemoteUrl),sources:p.sources.map(s=>({hostId:s.hostId,path:s.path}))},reused:result.reused};},
    workspace_software:async({hostId,checkLatest}:{hostId:string;checkLatest:boolean})=>host.call('software',{checkLatest},{hostId,timeoutMs:120000}),
    workspace_install:async({hostId}:{hostId:string})=>{const result=await host.call('install',{},{hostId,timeoutMs:300000});bb.realtime.publish('workspace-changed',{hostId});return result;},
    workspace_status:async({id,hostId}:{id:string;hostId:string})=>host.call('inspect',await workspaceInput(id,hostId),{hostId,timeoutMs:60000}),
    workspace_sync:async({id,hostId,revision:expected}:{id:string;hostId:string;revision:number})=>{
      if(expected!==revision())throw new Error('Настройки изменились. Обновите страницу.');
      if(syncing.has(id))throw new Error('Синхронизация пространства уже выполняется.');syncing.add(id);
      try {const result=await host.call('synchronize',await workspaceInput(id,hostId,true),{hostId,timeoutMs:300000});bb.realtime.publish('workspace-changed',{id,hostId});return result;}finally{syncing.delete(id);}
    },
    catalog:async()=>({spaces:read(),projects:await projects(),hosts:(await bb.sdk.hosts.list()).map(h=>({id:h.id,name:h.name})),revision:revision()}),
    save:async({space,revision:expected}:{space:Space;revision:number})=>{if(syncing.has(space.id))throw new Error('Дождитесь синхронизации ai-workspace.');validateSpace(space,await projects());mutate(expected,()=>{db.prepare('INSERT OR REPLACE INTO spaces VALUES (?,?)').run(space.id,JSON.stringify(space));});return space;},
    remove:async({id,revision:expected}:{id:string;revision:number})=>{if(syncing.has(id))throw new Error('Дождитесь синхронизации ai-workspace.');let removed=false;mutate(expected,()=>{removed=db.prepare('DELETE FROM spaces WHERE id=?').run(id).changes>0;});return {removed};},
    context:async({id,projectId,hostId}:{id:string;projectId:string;hostId:string})=>{const space=read().find(s=>s.id===id);if(!space)throw new Error('Пространство не найдено.');const catalog=await projects();validateSpace(space,catalog);return contextForSpace(space,catalog,projectId,hostId);},
    thread_bindings:async({threadIds}:{threadIds:string[]})=>{
      if(!threadIds.length)return {bindings:[]};
      const result=await bb.sdk.threads.experimental_listPluginMetadata({threadIds});
      return {bindings:result.threads.flatMap(row=>{const binding=readThreadBinding(row.metadata);return binding?[{threadId:row.threadId,...binding}]:[];})};
    },
  };
  bb.rpc.register(rpcContract,handlers,{experimental_discoverable:true,experimental_description:'Project Spaces: related projects, folders and shared context. Removing a space preserves all projects, files and chats.'});
  const readTools=new Set(['workspace_context','workspace_read','workspace_search','workspace_search_fulltext','workspace_service_graph','workspace_events','workspace_event_details','list_groups','list_projects','project_tree','project_grep','project_context','codegraph_context','codegraph_search','codegraph_node','codegraph_status','codegraph_callers','codegraph_callees']);
  bb.agents.registerTool({
    name:'project_spaces_workspace',description:'Read ai-workspace context in this Project Space group on the thread host. Start with operation=context, then list_tools for exact tool schemas, then call. The configured global MCP may use a different group.',
    parameters:z.object({operation:z.enum(['context','list_tools','call']),tool:z.string().max(80).optional(),arguments:z.record(z.string(),z.unknown()).optional()}),
    async execute(input,ctx){
      const metadata=await bb.sdk.threads.getPluginMetadata({threadId:ctx.threadId});
      const snapshot=spaceSchema.safeParse(metadata.spaceSnapshot);if(!snapshot.success)throw new Error('Тред не связан с пространством.');
      const space=read().find(s=>s.id===snapshot.data.id);if(!space?.contextGroup||!space.projectIds.includes(ctx.projectId))throw new Error('Группа пространства недоступна.');
      const thread=await bb.sdk.threads.get({threadId:ctx.threadId});if(!thread.environmentId)throw new Error('У треда нет рабочей среды.');
      const environment=await bb.sdk.environments.get({environmentId:thread.environmentId});if(!environment.path)throw new Error('Рабочая папка недоступна.');
      const tool=input.operation==='context'?'workspace_context':input.tool;
      if(input.operation==='call'&&(!tool||!readTools.has(tool)))throw new Error('Выберите инструмент чтения из list_tools.');
      const result=await host.call('mcp',{group:space.contextGroup,cwd:environment.path,method:input.operation==='list_tools'?'tools/list':'tools/call',...(tool?{tool}:{}),arguments:input.arguments??{}},{hostId:environment.hostId,signal:ctx.signal,timeoutMs:60000});
      if(input.operation==='list_tools'){const value=result as {tools:{name:string}[]};return JSON.stringify({tools:value.tools.filter(t=>readTools.has(t.name))});}
      return {content:[{type:'text' as const,text:JSON.stringify(result)}],isError:(result as {isError?:boolean})?.isError===true};
    },
  });
  bb.agents.configure(ctx=>{
    const snapshot=spaceSchema.safeParse(ctx.pluginMetadata.spaceSnapshot);
    if(!snapshot.success||!snapshot.data.projectIds.includes(ctx.project.id))return {tools:[],skills:[]};
    const space=snapshot.data;
    const current=read().find(value=>value.id===space.id);
    const map=typeof ctx.pluginMetadata.workspaceMap==='string'?ctx.pluginMetadata.workspaceMap.slice(0,18000):'';
    return {tools:current?.contextGroup&&current.projectIds.includes(ctx.project.id)?['project_spaces_workspace']:[],skills:['project-spaces'],instructions:[
      'Project Spaces: this thread uses the workspace configuration snapshot captured at launch. Listed paths do not grant filesystem permissions.',map,
      ctx.pluginMetadata.threadScope==='space'?'This is a shared workspace thread. Coordinate the task across the selected projects.':'This is a project thread. Focus changes on the selected project while considering the shared workspace context.',
      space.instructions,
      current?.contextGroup?`Call project_spaces_workspace with operation=context for current group ${JSON.stringify(current.contextGroup)} before broad scans. Use operation=list_tools for available schemas, then operation=call. This bridge uses this thread's host and the actual configured group; a global MCP can have another scope. Report unavailable scope explicitly.`:'',
      'Use BB thread storage for artifacts and temporary files. Do not export history or create .bb/chats. Read each directory\'s applicable AGENTS.md. Clean task-owned temporary build dependencies after validation; preserve requested results.',
    ].filter(Boolean).join('\n\n')};
  });
  bb.cli.register({name:'project-spaces',summary:'List spaces and inspect shared project context',commands:[
    {name:'list',summary:'List spaces and projects',usage:'bb project-spaces list [--json]'},
    {name:'create',summary:'Group existing projects',usage:'bb project-spaces create <name> <primary-project-id> [project-id...] [--json]'},
    {name:'context',summary:'Resolve paths on one device',usage:'bb project-spaces context <space-id> <project-id> <host-id> [--json]'}],
    async run(argv){const [command,...args]=argv.filter(a=>a!=='--json');try{let value:unknown;
      if(command==='list')value=await handlers.catalog();
      else if(command==='create'&&args.length>=2){const space:Space={id:randomUUID(),name:args[0]!,projectIds:[...new Set(args.slice(1))],primaryProjectId:args[1]!,folders:[],instructions:'',contextGroup:''};value=await handlers.save({space,revision:revision()});}
      else if(command==='context'&&args.length===3)value=await handlers.context({id:args[0]!,projectId:args[1]!,hostId:args[2]!});
      else return {exitCode:command&&command!=='help'&&command!=='--help'?1:0,stdout:'bb project-spaces list | create <name> <primary-project-id> [project-id...] | context <space-id> <project-id> <host-id> [--json]'};
      return {exitCode:0,stdout:JSON.stringify(value,null,2)};
    }catch(e){return {exitCode:1,stderr:e instanceof Error?e.message:String(e)};}}
  });
}
