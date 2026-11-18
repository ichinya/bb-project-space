import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

export type ProcessOptions={cwd:string;binary?:string;signal?:AbortSignal;timeoutMs?:number;env?:NodeJS.ProcessEnv;safePaths?:string[]};
type CommandOptions=ProcessOptions&{requireSuccess?:boolean;onOutput?:(text:string)=>void};
export function repowiseEnvironment(options:ProcessOptions):NodeJS.ProcessEnv{
  const value:NodeJS.ProcessEnv={...process.env,...options.env,REPOWISE_SKIP_EDITOR_SETUP:'1',PYTHONIOENCODING:'utf-8',NO_COLOR:'1'};
  let count=Number(value.GIT_CONFIG_COUNT??0);if(!Number.isInteger(count)||count<0||count>100)throw new Error('Неверный GIT_CONFIG_COUNT.');
  for(const directory of options.safePaths??[]){value[`GIT_CONFIG_KEY_${count}`]='safe.directory';value[`GIT_CONFIG_VALUE_${count}`]=directory.replace(/\\/g,'/').replace(/\/$/,'');count++;}
  if(options.safePaths?.length)value.GIT_CONFIG_COUNT=String(count);
  return value;
}
export function repowiseCommand(args:string[],options:CommandOptions):Promise<string>{
  return new Promise((resolve,reject)=>{
    const child=spawn(options.binary??'repowise',args,{cwd:options.cwd,env:repowiseEnvironment(options),shell:false,windowsHide:true,signal:options.signal});
    let output='',errors='',done=false;
    const finish=(error?:Error)=>{if(done)return;done=true;clearTimeout(timer);child.stdin.destroy();child.stdout.destroy();child.stderr.destroy();error?reject(error):resolve(output);};
    const timeout=options.timeoutMs??180000;
    const timer=setTimeout(()=>{child.kill();finish(new Error(`Repowise: превышен лимит ${Math.round(timeout/1000)} с.`));},timeout);
    child.stdout.setEncoding('utf8');child.stderr.setEncoding('utf8');
    child.stdout.on('data',chunk=>{output=(output+chunk).slice(-1024*1024);options.onOutput?.(chunk);});
    child.stderr.on('data',chunk=>{errors=(errors+chunk).slice(-8000);options.onOutput?.(chunk);});
    const exited=(code:number|null)=>finish(code===0||(!options.requireSuccess&&code===2)?undefined:new Error(errors.trim()||output.slice(-2000)||`Repowise завершился (${code})`));
    child.on('error',finish);child.on('exit',exited);child.on('close',exited);
  });
}

/** One session handles a bounded fan-out. It never starts a daemon or downloads histories. */
export function repowiseMcp(workspace:string,calls:{method:'tools/list'|'tools/call';params:Record<string,unknown>}[],options:ProcessOptions):Promise<unknown[]>{
  if(!calls.length)return Promise.resolve([]);
  return new Promise((resolve,reject)=>{
    const child=spawn(options.binary??'repowise',['mcp',workspace,'--tools','all'],{cwd:workspace,env:repowiseEnvironment(options),shell:false,windowsHide:true,signal:options.signal});
    const lines=createInterface({input:child.stdout});let done=false,bytes=0,stderr='',next=0;const results:unknown[]=[];
    const finish=(error?:Error)=>{
      if(done)return;done=true;clearTimeout(timer);lines.close();let closed=false;
      const complete=()=>{if(closed)return;closed=true;clearTimeout(force);child.stdin.destroy();child.stdout.destroy();child.stderr.destroy();error?reject(error):resolve(results);};
      const force=setTimeout(()=>{child.kill('SIGKILL');complete();},2000);
      child.once('exit',complete);child.once('close',complete);if(child.exitCode!==null||child.signalCode!==null)complete();else{child.stdin.end();child.kill();}
    };
    const timer=setTimeout(()=>finish(new Error('Repowise MCP: превышено время ожидания.')),options.timeoutMs??120000);
    const send=(message:unknown)=>{if(!done)child.stdin.write(JSON.stringify(message)+'\n');};
    const advance=()=>{const call=calls[next];if(!call){finish();return;}send({jsonrpc:'2.0',id:next+2,...call});};
    child.stdin.on('error',error=>finish(error));child.stderr.on('data',chunk=>{stderr=(stderr+chunk).slice(-2000);});
    child.on('error',finish);child.on('exit',code=>{if(!done)finish(new Error(stderr||`Repowise MCP завершился (${code})`));});
    lines.on('line',line=>{
      bytes+=line.length;if(bytes>8*1024*1024){finish(new Error('Repowise MCP: ответ превысил 8 МБ.'));return;}
      try{const message=JSON.parse(line);if(message.id===1){if(message.error){finish(new Error(message.error.message));return;}send({jsonrpc:'2.0',method:'notifications/initialized'});advance();}
        else if(message.id===next+2){results.push(message.error?{isError:true,content:[{type:'text',text:message.error.message}]}:message.result);next++;advance();}
      }catch(error){finish(error instanceof Error?error:new Error(String(error)));}
    });
    child.on('spawn',()=>send({jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2024-11-05',capabilities:{},clientInfo:{name:'project-spaces',version:'0.1.13'}}}));
  });
}
