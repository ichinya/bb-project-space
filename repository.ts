export type Repository={provider:'github'|'gitlab'|'gitverse'|'git';label:string;url:string};

/** A browser link, never a clone URL containing credentials or an SSH port. */
export function gitRepository(remote:string|null|undefined):Repository|null{
  if(!remote||remote.length>4096||/[\s\x00-\x1f\x7f\\]/.test(remote))return null;
  try{
    const scp=!remote.includes('://')?/^(?:([A-Za-z0-9_.-]+)@)?([A-Za-z0-9.-]+):([^?#]+)$/.exec(remote):null;
    if(scp&&!scp[1]&&!scp[2]!.includes('.'))return null;
    const rawPath=scp?'/'+scp[3]:/^[a-z]+:\/\/[^/]+(\/[^?#]*)/i.exec(remote)?.[1]??'';
    if(rawPath.includes('%')||rawPath.split('/').some(part=>part==='.'||part==='..'))return null;
    const url=new URL(scp?`ssh://${scp[1]??'git'}@${scp[2]}/${scp[3]}`:remote);
    if(!['https:','http:','ssh:','git:'].includes(url.protocol)||url.search||url.hash)return null;
    const host=url.hostname.toLowerCase(),parts=url.pathname.replace(/\/$/,'').replace(/\.git$/i,'').split('/').slice(1);
    if(parts.length<2||parts.some(part=>!part||!/[A-Za-z0-9_-]/.test(part)||!/^[A-Za-z0-9_.-]+$/.test(part)))return null;
    const provider:Repository['provider']=host==='github.com'?'github':host==='gitlab.com'||host==='gitlab'||host.startsWith('gitlab.')||host.endsWith('.gitlab')?'gitlab':host==='gitverse.ru'?'gitverse':'git';
    if(provider==='gitverse'&&parts.length===3&&parts[0]==='sc')parts.shift();
    if((provider==='github'||provider==='gitverse')&&parts.length!==2)return null;
    if(provider==='gitlab'&&parts.includes('-'))return null;
    const webProtocol=provider==='git'&&url.protocol==='http:'?'http:':'https:';
    const port=['http:','https:'].includes(url.protocol)?url.port:'';
    return {provider,label:provider==='github'?'GitHub':provider==='gitlab'?'GitLab':provider==='gitverse'?'GitVerse':'Git',url:`${webProtocol}//${host}${port?':'+port:''}/${parts.join('/')}`};
  }catch{return null;}
}
