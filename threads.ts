import type { Space } from './model.ts';

export type ThreadScope = 'space' | 'project';
export type ThreadBinding = { spaceId: string | null; scope: ThreadScope };
export type GroupableThread = {
  id: string; projectId: string; parentThreadId: string | null;
  displayTitle: string; updatedAt: number; isPinned: boolean;
  isArchived: boolean; isHidden: boolean;
};
export type ThreadNode<T extends GroupableThread> = { thread: T; children: ThreadNode<T>[] };

/** Old 0.1 metadata did not distinguish launch buttons. Keep those chats under their project. */
export function readThreadBinding(metadata: unknown): ThreadBinding | null {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return null;
  const value = metadata as Record<string, unknown>;
  if (value.spaceId !== null && (typeof value.spaceId !== 'string' || !value.spaceId)) return null;
  if (value.threadScope !== undefined && value.threadScope !== 'space' && value.threadScope !== 'project') return null;
  return { spaceId: value.spaceId, scope: value.threadScope === 'space' ? 'space' : 'project' };
}

export function threadMetadata(space: Space, scope: ThreadScope, workspaceMap: string, bindingOrigin:'launch'|'transfer'='launch') {
  return { spaceId: space.id, threadScope: scope, spaceSnapshot: space, workspaceMap, bindingOrigin };
}

/** Every visible thread appears once. Families follow their visible root; no BB data is moved. */
export function groupThreads<T extends GroupableThread>(
  threads: readonly T[], spaces: readonly Space[], bindings: Readonly<Record<string, ThreadBinding>>,
  options: { includeArchived?: boolean; query?: string; separatePinned?: boolean } = {},
) {
  const visible = threads.filter(t => !t.isHidden && (options.includeArchived || !t.isArchived));
  const byId = new Map(visible.map(t => [t.id, t]));
  const roots = new Map<string, ThreadNode<T>>();
  const parentOf = new Map<string, string | null>();
  const placement=(id:string):ThreadBinding|null=>{
    const seen=new Set<string>();let current:string|null=id;
    while(current&&!seen.has(current)){
      seen.add(current);if(bindings[current])return bindings[current]!;
      current=byId.get(current)?.parentThreadId??null;
    }
    return null;
  };
  for (const thread of visible) {
    let parent = thread.parentThreadId;
    // Bad imported parent links must never make a thread disappear or recurse forever.
    const seen = new Set([thread.id]);
    let next = parent;
    while (next && byId.has(next)) {
      if (seen.has(next)) { parent = null; break; }
      seen.add(next); next = byId.get(next)!.parentThreadId;
    }
    // A moved child keeps its native parent relationship but appears in its own space.
    const own=bindings[thread.id],inherited=parent?placement(parent):null;
    if(own&&(own.spaceId!==(inherited?.spaceId??null)||own.scope!==(inherited?.scope??'project')))parent=null;
    parentOf.set(thread.id, parent && byId.has(parent) ? parent : null);
    roots.set(thread.id, { thread, children: [] });
  }
  const families: ThreadNode<T>[] = [];
  for (const thread of visible) {
    const node = roots.get(thread.id)!;
    const parent = parentOf.get(thread.id);
    if (parent) roots.get(parent)!.children.push(node); else families.push(node);
  }
  const query = options.query?.trim().toLocaleLowerCase() ?? '';
  const matches = (node: ThreadNode<T>): boolean => !query || node.thread.displayTitle.toLocaleLowerCase().includes(query) || node.children.some(matches);
  const pinnedFamily = (node: ThreadNode<T>): boolean => node.thread.isPinned || node.children.some(pinnedFamily);
  const sort = (nodes: ThreadNode<T>[]) => {
    nodes.sort((a,b) => b.thread.updatedAt-a.thread.updatedAt || a.thread.id.localeCompare(b.thread.id));
    nodes.forEach(n => sort(n.children));
  };
  sort(families);
  const groups = spaces.map(space => ({ space, common: [] as ThreadNode<T>[], projects: space.projectIds.map(projectId => ({projectId, threads: [] as ThreadNode<T>[]})) }));
  const pinned: ThreadNode<T>[] = [], loose: ThreadNode<T>[] = [];
  for (const node of families.filter(matches)) {
    if (options.separatePinned !== false && pinnedFamily(node)) { pinned.push(node); continue; }
    const binding = bindings[node.thread.id];
    const group = binding && groups.find(g => g.space.id === binding.spaceId && g.space.projectIds.includes(node.thread.projectId));
    if (!group) { loose.push(node); continue; }
    if (binding.scope === 'space') group.common.push(node);
    else group.projects.find(p => p.projectId === node.thread.projectId)!.threads.push(node);
  }
  return { pinned, spaces: groups, loose };
}

export function flattenThreads<T extends GroupableThread>(nodes: readonly ThreadNode<T>[]): T[] {
  return nodes.flatMap(node => [node.thread, ...flattenThreads(node.children)]);
}
