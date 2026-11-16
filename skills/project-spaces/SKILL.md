---
name: project-spaces
description: Inspect Project Spaces groups, folders, and shared context when working across related BB projects.
---

# Project Spaces

Two scoped tools are available in a space: `project_spaces_workspace` for shared
ai-workspace materials, and `project_spaces_repowise` for code evidence across
all space folders on the actual host. A legacy project thread inherits a space
only when membership is unambiguous. When several spaces are listed, ask the
user which context to use and pass that `spaceId` to both tools; do not guess.

Start Repowise with `operation=context` for aliases and index readiness. Call
`prepare` when missing/stale and poll `context` until `prepared=true,busy=false`.
Then use `list_tools` (optionally `tool` for one full schema) and `call`.
`repo=all` federates supported operations and fans other tools out separately,
keeping repo-labelled evidence. Narrow a large result to one alias/target.
Honor upstream staleness, confidence, degraded and completeness fields. A new
worktree must use its own checkout index; never answer from its base index.
Fast initial indexes contain structure and essential Git facts; a missing
semantic model or generated wiki is not proof that a symbol or decision is absent.

Run `bb project-spaces list --json` to inspect spaces. Resolve paths on the
selected machine with `bb project-spaces context <space-id> <project-id>
<host-id> --json`. A path map does not grant filesystem permissions.

The Project Spaces sidebar separates common workspace threads from project
threads. A launch records `spaceId` and `threadScope` (`space` or `project`) in
plugin metadata before the first turn. Old 0.1 bindings are project-scoped.
Use the explicit Project Spaces move/copy actions for user-requested
reorganization instead of ad hoc metadata edits. Moves keep project IDs and
history and include child threads. Copies use native idle forks and share the
working environment; they do not copy child agents. The saved space snapshot
can change on a transfer. Restart a session to load its new space instructions.

Use the chat's actual environment for the primary project. Never substitute
the main checkout for a worktree. Other projects remain independent repositories.
Read each directory's applicable AGENTS.md. If an ai-workspace group is configured,
call `project_spaces_workspace` with `operation=context` before broad scans.
Use `operation=list_tools` for the upstream schemas, then `operation=call`,
`tool` and `arguments` for reads, searches, service graphs, events or CodeGraph.
The bridge uses this thread's host and the space's current group. A globally
connected ai-workspace MCP can have a different scope; do not substitute it.
Initialization and group/config updates are in the space settings per device.
Respect checkout identity and stale-index errors; synchronize Rust CodeGraph
explicitly when necessary instead of treating stale results as current. Report
unavailable projects or scopes instead of pretending context was loaded.

Keep artifacts and temporary files in BB thread storage. Do not export history
or create `.bb/chats`. Clean task-owned temporary build dependencies after
validation; preserve requested results.
