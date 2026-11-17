import path from 'node:path';

export type Registered={path:string;name:string;groups:{name:string}[]};

/** The native Windows CLI canonicalizes to a verbatim path. Historical versions
 * could leave other DB records for the same folder: never take the first alias. */
export function registeredProject(projects:Registered[],canonical:string,platform:NodeJS.Platform=process.platform):Registered|undefined{
  const windows=platform==='win32';
  const spelling=(value:string)=>windows?value.replace(/\//g,'\\').replace(/\\+$/,''):value.replace(/\/+$/,'');
  const identity=(value:string)=>windows?path.win32.resolve(value.replace(/^\\\\\?\\/,'')).toLowerCase():path.posix.resolve(value);
  const candidates=projects.filter(project=>identity(project.path)===identity(canonical));
  const preferred=windows?path.win32.toNamespacedPath(canonical):canonical;
  for(const expected of [preferred,canonical]){
    const exact=candidates.filter(project=>spelling(project.path)===spelling(expected));
    if(exact.length===1)return exact[0];
    const sameCaseInsensitive=windows?candidates.filter(project=>spelling(project.path).toLowerCase()===spelling(expected).toLowerCase()):[];
    if(sameCaseInsensitive.length===1)return sameCaseInsensitive[0];
  }
  if(candidates.length>1)throw new Error('В ai-workspace несколько записей этой папки, и определить текущую не удалось. Повторите инициализацию текущим CLI.');
  return candidates[0];
}
