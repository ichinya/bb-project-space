import { spaceSchema,type Space,type Project } from './model.ts';
import { workspaceRoots } from './workspace-model.ts';

/** Explicit thread placement wins. Legacy project threads inherit only an unambiguous space. */
export function contextSpace(spaces:Space[],metadata:Record<string,unknown>,projectId:string,requested?:string){
  if(metadata.spaceId===null)throw new Error('Тред находится вне пространств. Сначала переместите его в пространство.');
  const snapshot=spaceSchema.safeParse(metadata.spaceSnapshot);
  const bound=typeof metadata.spaceId==='string'?metadata.spaceId:snapshot.success?snapshot.data.id:undefined;
  if(bound&&requested&&bound!==requested)throw new Error('Тред привязан к другому пространству. Используйте перенос для смены контекста.');
  const candidates=spaces.filter(s=>s.projectIds.includes(projectId));
  const id=bound??requested??(candidates.length===1?candidates[0]!.id:undefined);
  const space=candidates.find(s=>s.id===id);
  if(!space)throw new Error(id?'Пространство недоступно для проекта треда.':`Выберите spaceId: ${candidates.map(s=>`${s.name} (${s.id})`).join(', ')||'проект не добавлен в пространство'}`);
  return space;
}
export function contextRoots(space:Space,projects:Project[],hostId:string,projectId?:string,environmentPath?:string|null){
  const active=projects.map(p=>p.id===projectId&&environmentPath?{...p,sources:[{hostId,path:environmentPath},...p.sources.filter(s=>s.hostId!==hostId)]}:p);
  const roots=workspaceRoots(space,active,hostId);
  const primary=active.find(p=>p.id===(projectId??space.primaryProjectId))?.sources.find(s=>s.hostId===hostId)?.path;
  return primary?[...roots.filter(r=>r.path===primary),...roots.filter(r=>r.path!==primary)]:roots;
}
