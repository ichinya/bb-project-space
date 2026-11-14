import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

export type WorkspaceOptions={cwd:string;signal?:AbortSignal;env?:NodeJS.ProcessEnv;binary?:string;spawn?:typeof spawn};
function environment(options:WorkspaceOptions) {
  const env:NodeJS.ProcessEnv={...process.env,...options.env,AI_WORKSPACE_CONFIG:'.ai-workspace.json',AI_WORKSPACE_SCOPE:'global',AI_WORKSPACE_ALLOW_PROJECT_FILE_WRITE:'0',AI_WORKSPACE_ALLOW_PROJECT_WIDE_TOOLS:'0'};
  delete env.AI_WORKSPACE_SCOPE_GROUP;delete env.AI_WORKSPACE_SCOPE_PROJECT;return env;
}
export function workspaceCommand(args:string[],options:WorkspaceOptions):Promise<string> {
  return new Promise((resolve,reject)=>{
    const child=(options.spawn??spawn)(options.binary??'ai-workspace',args,{cwd:options.cwd,env:environment(options),shell:false,windowsHide:true,signal:options.signal});
    let stdout='',stderr='',settled=false;
    const finish=(error?:Error)=>{if(settled)return;settled=true;clearTimeout(timer);error?reject(error):resolve(stdout);};
    const timer=setTimeout(()=>{child.kill();finish(new Error('ai-workspace: превышено время ожидания команды.'));},20000);
    child.stdout.on('data',chunk=>{stdout+=chunk;if(stdout.length>1024*1024){child.kill();finish(new Error('ai-workspace: слишком большой ответ.'));}});
    child.stderr.on('data',chunk=>{stderr=(stderr+chunk).slice(-4000);});
    child.on('error',finish);child.on('close',code=>finish(code===0?undefined:new Error(stderr.trim()||`ai-workspace завершился с кодом ${code}`)));
  });
}

/** One scoped stdio session per operation; never exposes the local owner's token. */
export function workspaceMcp(method:'tools/list'|'tools/call',params:Record<string,unknown>,options:WorkspaceOptions,group?:string,administrative=false):Promise<unknown> {
  return new Promise((resolve,reject)=>{
    const args=group?['serve','--scope','group',`--group=${group}`]:['serve','--scope','global'];
    const child=(options.spawn??spawn)(options.binary??'ai-workspace',args,{cwd:options.cwd,env:{...environment(options),AI_WORKSPACE_ALLOW_PROJECT_WIDE_TOOLS:administrative?'1':'0'},shell:false,windowsHide:true,signal:options.signal});
    const lines=createInterface({input:child.stdout});let stderr='',settled=false,bytes=0;
    const finish=(error?:Error,result?:unknown)=>{
      if(settled)return;settled=true;clearTimeout(timer);lines.close();let completed=false;
      // A bridge can exit while inherited stdio handles remain open in an owner.
      // Wait for our child to exit, then close only our pipes; never kill the owner.
      const complete=(failure=error)=>{if(completed)return;completed=true;clearTimeout(force);child.stdout.destroy();child.stderr.destroy();child.stdin.destroy();failure?reject(failure):resolve(result);};
      const force=setTimeout(()=>{child.kill('SIGKILL');complete(error??new Error('ai-workspace MCP: не удалось завершить мост за 2 секунды.'));},2000);
      child.once('exit',()=>complete());child.once('close',()=>complete());
      if(child.exitCode!==null||child.signalCode!==null)complete();else{child.stdin.end();child.kill();}
    };
    const timer=setTimeout(()=>finish(new Error('ai-workspace MCP: превышено время ожидания.')),20000);
    const send=(value:unknown)=>{if(!settled)child.stdin.write(JSON.stringify(value)+'\n');};
    child.stdin.on('error',error=>finish(error));
    child.stderr.on('data',chunk=>{stderr=(stderr+chunk).slice(-2000);});
    child.on('error',error=>finish(error));child.on('exit',code=>{if(!settled)finish(new Error(stderr.trim()||`ai-workspace MCP завершился (${code})`));});
    lines.on('line',line=>{bytes+=line.length;if(bytes>4*1024*1024){finish(new Error('ai-workspace MCP: ответ превысил 4 МБ.'));return;}
      try {const message=JSON.parse(line);if(message.id===1){if(message.error){finish(new Error(message.error.message));return;}send({jsonrpc:'2.0',method:'notifications/initialized'});send({jsonrpc:'2.0',id:2,method,params});}
        else if(message.id===2){if(message.error)finish(new Error(message.error.message));else finish(undefined,message.result);}
      }catch(error){finish(error instanceof Error?error:new Error(String(error)));}
    });
    child.on('spawn',()=>send({jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2024-11-05',capabilities:{},clientInfo:{name:'project-spaces',version:'0.1.3'}}}));
  });
}

export function mcpJson(result:unknown):unknown {
  const value=result as {isError?:boolean;content?:{type:string;text?:string}[]};
  const text=value.content?.filter(c=>c.type==='text').map(c=>c.text??'').join('\n')??'';
  if(value.isError)throw new Error(text||'Ошибка ai-workspace MCP');
  return JSON.parse(text);
}
