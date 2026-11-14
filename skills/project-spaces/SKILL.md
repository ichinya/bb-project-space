---
name: project-spaces
description: Inspect Project Spaces groups, folders, and shared context when working across related BB projects.
---

# Project Spaces

Run `bb project-spaces list --json` to inspect spaces. Resolve paths on the
selected machine with `bb project-spaces context <space-id> <project-id>
<host-id> --json`. A path map does not grant filesystem permissions.

The Project Spaces sidebar separates common workspace threads from project
threads. A launch records `spaceId` and `threadScope` (`space` or `project`) in
plugin metadata before the first turn. Old 0.1 bindings are project-scoped.
Do not rewrite old chats' project IDs or metadata to reorganize their display.

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
