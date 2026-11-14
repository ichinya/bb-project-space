import { z } from 'zod';
import path from 'node:path';
export const spaceSchema = z.object({
  id:z.string().uuid(), name:z.string().trim().min(1).max(100),
  projectIds:z.array(z.string().min(1)).min(1).max(40), primaryProjectId:z.string().min(1),
  folders:z.array(z.object({hostId:z.string().min(1),path:z.string().min(1).max(2048)})).max(40),
  instructions:z.string().max(12000), contextGroup:z.string().trim().max(100),
});
export type Space = z.infer<typeof spaceSchema>;
export type Project = {id:string;name:string;sources:{hostId:string;path:string}[]};
export function validateSpace(space:Space, projects:Project[]) {
  spaceSchema.parse(space);
  if(new Set(space.projectIds).size!==space.projectIds.length) throw new Error('Проект указан несколько раз.');
  if(!space.projectIds.includes(space.primaryProjectId)) throw new Error('Основной проект должен входить в пространство.');
  for(const id of space.projectIds) if(!projects.some(p=>p.id===id)) throw new Error(`Проект недоступен: ${id}`);
  const keys=new Set<string>();
  for(const folder of space.folders){
    const flavor=path.win32.isAbsolute(folder.path)?path.win32:path.posix;
    if(!flavor.isAbsolute(folder.path) || /[\r\n\0]/.test(folder.path)) throw new Error('Укажите абсолютный путь дополнительной папки.');
    const key=folder.hostId+'|'+(flavor===path.win32?flavor.normalize(folder.path).toLowerCase():flavor.normalize(folder.path));
    if(keys.has(key)) throw new Error('Дополнительная папка указана несколько раз.');
    keys.add(key);
  }
}
export function contextForSpace(space:Space, projects:Project[], projectId:string, hostId:string) {
  if(!space.projectIds.includes(projectId)) throw new Error('Выбранный проект не входит в пространство.');
  const rows=space.projectIds.map(id=>{const p=projects.find(p=>p.id===id);return {projectId:id,name:p?.name??id,path:p?.sources.find(s=>s.hostId===hostId)?.path??null,primary:id===projectId};});
  if(!rows.find(r=>r.primary)?.path) throw new Error('Основная папка недоступна на выбранном устройстве.');
  const folders=space.folders.filter(f=>f.hostId===hostId);
  return {paths:[...rows.flatMap(r=>r.path?[r.path]:[]),...folders.map(f=>f.path)],instructions:[
    `Project Spaces workspace map (configuration data): ${JSON.stringify({name:space.name,projects:rows,folders})}`,
    'Use the actual active environment for the selected project. A worktree selected in BB replaces that project\'s source checkout. Other paths are references, not additional worktrees or permission grants. Report unavailable sources; never substitute another device.',
    'Each repository keeps its own Git history, branch, checks and pull requests. Do not switch other checkouts implicitly.',
    space.instructions,
    space.contextGroup?`Shared ai-workspace group: ${JSON.stringify(space.contextGroup)}. Discover visible context using MCP. Bind source evidence to the actual checkout; never assume another worktree shares its index.`:'',
  ].filter(Boolean).join('\n\n')};
}
