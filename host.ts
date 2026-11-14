import { experimental_defineHostEntry } from '@get-bb/plugin-sdk';
import { workspaceHostContract } from './workspace-contract.ts';
import { inspectWorkspace,synchronizeWorkspace } from './workspace-host.ts';
import { workspaceMcp } from './workspace-process.ts';
import { workspaceExecutable,inspectWorkspaceSoftware,installWorkspaceSoftware } from './workspace-software.ts';

// Serialize workspace mutations in this host worker, including between spaces.
let queue:Promise<unknown>=Promise.resolve();
function serial<T>(run:()=>Promise<T>):Promise<T>{const operation=queue.then(run);queue=operation.catch(()=>{});return operation;}
export default experimental_defineHostEntry({
  contract:workspaceHostContract,
  handlers:{
    software:async(input,ctx)=>{await queue;return inspectWorkspaceSoftware(ctx.experimental_paths.dataDir,input.checkLatest,{signal:ctx.signal});},
    install:async(_input,ctx)=>serial(()=>installWorkspaceSoftware(ctx.experimental_paths.dataDir,{signal:ctx.signal})),
    inspect:async(input,ctx)=>serial(async()=>inspectWorkspace(input,{cwd:ctx.experimental_paths.dataDir,signal:ctx.signal,binary:await workspaceExecutable(ctx.experimental_paths.dataDir)})),
    synchronize:async(input,ctx)=>{
      const operation=queue.then(async()=>synchronizeWorkspace(input,ctx.experimental_paths.dataDir,{cwd:ctx.experimental_paths.dataDir,signal:ctx.signal,binary:await workspaceExecutable(ctx.experimental_paths.dataDir)}));
      queue=operation.catch(()=>{});return operation;
    },
    mcp:async(input,ctx)=>serial(async()=>workspaceMcp(input.method,input.method==='tools/list'?{}:{name:input.tool,arguments:input.arguments??{}},{cwd:input.cwd,signal:ctx.signal,binary:await workspaceExecutable(ctx.experimental_paths.dataDir)},input.group)),
  },
});
