import type { Space } from './model.ts';

export function agentContextInstructions(space:Space):string{
  return [
    'Project Spaces context tools are connected by BB for this thread. They are MCP bridges to the CLIs on the actual execution host; no separate global MCP configuration is required inside BB.',
    `Use spaceId=${JSON.stringify(space.id)} with both bridges. Preserve this scope when a project belongs to multiple spaces.`,
    'Before investigating or modifying code, call project_spaces_repowise with operation=context. If busy=true, preparation is already running: do not call prepare again; do useful independent source checks and poll at reasonable intervals. If idle with an error, report the failed stage. When prepared=true the saved overview is still available; treat stale results as navigation hints and verify them against source. Otherwise prepare missing/stale indexes and poll until prepared=true, busy=false, stale=false. Use list_tools with tool=get_overview for its schema, then call get_overview with repo=all; narrow subsequent evidence queries to aliases from context.',
    space.contextGroup?`For shared project materials, first call project_spaces_workspace with operation=context in this space (group ${JSON.stringify(space.contextGroup)}). list_tools returns names and short descriptions; request one full schema with tool=<name>, then call. Do not dump every schema. Use these scoped bridges when a global MCP has a different workspace/group.`:'ai-workspace is not enabled for this space: its group is empty. Repowise remains available.',
    'After code edits or commits, verify Repowise freshness before using indexed evidence again. BB lifecycle hooks check prepared indexes at turn start/end when auto-refresh is enabled. A freshnessWarning means freshness is unknown; state that limitation and verify against source files instead of claiming the index is current.',
    'The active worktree replaces the primary checkout. Keep repository/path/line/commit evidence separate. Fast index preparation and automatic refresh use index-only operations without model calls. Missing indexes must be explicitly prepared; a lifecycle hook does not initialize every project.',
    'For AGENTS.md, check known checkout roots and relevant ancestor directories directly. Do not recursively scan the home directory or filesystem for instruction files. Use paths returned by context; a missing file is not a reason to widen discovery. Avoid rereading instructions already supplied by the client.',
  ].join('\n\n');
}
export function agentsMarkdown(space:Space):string{
  return managedAgentsBlock([space]);
}

export function managedAgentsBlock(spaces:Space[]):string{
  const data=spaces.slice().sort((a,b)=>a.id.localeCompare(b.id)).map(space=>({spaceId:space.id,name:space.name}));
  const configuration=JSON.stringify(data,null,2).replace(/</g,'\\u003c').replace(/>/g,'\\u003e').replace(/`/g,'\\u0060');
  return [
    '<project-space>',
    '<!-- Managed by BB Project Spaces. Update this block from the plugin settings. -->',
    'In BB, use the active space rules already supplied to this thread; do not load duplicate copies. Use project_spaces_repowise / project_spaces_workspace only when available, with the active spaceId and actual host/worktree.',
    'If context is missing, run `bb project-spaces list --json`, select one linked space, then fetch only its context: `bb project-spaces context <space-id> <project-id> <host-id> --json`. Ask if selection is ambiguous. If BB/tools are unavailable, report that and follow local project rules; this block does not install MCP servers.',
    'Linked spaces (metadata only; full instructions stay in the plugin):',
    '```json',configuration,'```',
    '</project-space>',
  ].join('\n')+'\n';
}

/** Launch maps also contain the saved instructions. Retain their path snapshot,
 * while the selected space rules below are supplied once by configure(). */
export function workspaceMapOnly(map:string):string{
  const first=map.split(/\r?\n/,1)[0]??'',prefix='Project Spaces workspace map (configuration data): ';
  if(first.startsWith(prefix))try{JSON.parse(first.slice(prefix.length));return first;}catch{/* Preserve unknown/legacy metadata instead of guessing. */}
  return map;
}
