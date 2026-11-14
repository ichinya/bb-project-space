import path from 'node:path';
import type { Space,Project } from './model.ts';
import { folderIdentity } from './folder-project.ts';

export function workspaceRoots(space:Space,projects:Project[],hostId:string) {
  const roots=[...space.projectIds.flatMap(id=>{const project=projects.find(p=>p.id===id);const source=project?.sources.find(s=>s.hostId===hostId);return source?[{name:project!.name,path:source.path}]:[];}),...space.folders.filter(f=>f.hostId===hostId).map(f=>({path:f.path,name:(path.win32.isAbsolute(f.path)?path.win32:path.posix).basename(f.path.replace(/[\\/]+$/,''))||space.name}))];
  const seen=new Set<string>();return roots.filter(root=>{const key=folderIdentity(root.path);if(seen.has(key))return false;seen.add(key);return true;});
}
