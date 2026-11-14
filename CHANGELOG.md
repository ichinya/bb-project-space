# Changelog

## 0.1.10

- Indent thread rows below their project/group headings by 24px, keeping
  space, project, thread and child-thread levels visually distinct.

## 0.1.9

- Color unread thread titles by state: yellow for a question/approval, red for
  an error, green for successful completion. Opened/read threads use the normal
  theme text color; new unread events restore the corresponding highlight.
- Use BB's own read state and per-thread status without inheriting a collapsed
  child's attention color or recoloring PR badges and action icons.
- Mark a thread read through the BB SDK when opening its row, including split
  navigation, so read state persists when returning to the list.

## 0.1.8

- Keep PR links and thread action buttons in separate layout slots so GitHub,
  archive and menu icons never overlap on hover or keyboard focus.
- Reserve action width without absolute overflow, including touch layouts.

## 0.1.7

- Finish MCP reads when the stdio bridge exits even if background processes
  still hold inherited output handles open. Close only the bridge's own pipes
  and bound cleanup time without terminating the shared ai-workspace owner.
- Show folder/group loading progress and a busy state label in settings.

## 0.1.6

- Resolve the host from the native composer's provider machine selection when
  launching a space thread. Preserve provider inputs, branch, model and execution
  provenance unchanged instead of rejecting a valid selected device.

## 0.1.5

- Create BB projects from folders directly while editing a space, with device
  selection, a remote directory browser and an optional project name.
- Select created projects automatically and reuse existing projects for the
  same device/folder, including parallel additions.
- Allow creating the first project in an empty BB catalog.
- Keep Linux folder identities case-sensitive when deduplicating workspace roots.

## 0.1.4

- Check installed and latest stable ai-workspace versions per host from settings.
- Install or update a private Project Spaces CLI copy from official GitHub
  releases, validating SHA-256, archive size and the executable's reported version.
- Use the verified managed executable for folder initialization and scoped MCP
  reads while leaving the system PATH installation intact.
- Report offline checks and unsupported platforms; preserve the active binary
  when installation fails and reject downgrades.
- Wait for MCP child processes to exit before completing a request.

## 0.1.3

- Integrate ai-workspace on each enrolled host: show the installed CLI version,
  actual group memberships and per-folder config state in space settings.
- Initialize project and extra folders, create `.ai-workspace.json`, and merge
  the space group while preserving existing shares, notes and other groups.
- Reconcile removed folders and renamed groups using a journal of memberships
  owned by spaces; preserve manual memberships and projects used by other spaces.
- Provide the `project_spaces_workspace` agent tool through a host-local,
  group-scoped MCP bridge, independent of a provider's global MCP settings.
- Back up changed configs and report individual path failures without hiding
  successful updates.

## 0.1.2

- Match the bundled Thread list's compact rows, group headers, indentation,
  provider icons, theme colors, selected states and hover controls.
- Use BB's public draft and row-status hooks for the same visible indicators.
- Use the native archive action and thread menu for row controls.
- Keep new-thread buttons visible on space and project group headings.
- Render native thread row metadata, including GitHub PR Status badges.
- Add GitHub repository links to project headings and PR links to thread rows.

## 0.1.1

- Group the sidebar into spaces, common threads and project threads.
- Keep existing chats under their original projects without duplicate rows.
- Add search, archive filtering, nested families and native BB thread menus.

## 0.1.0

- Create spaces from existing BB projects, choose a primary project per chat,
  and attach shared instructions and optional ai-workspace group context.
