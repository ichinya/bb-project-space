# Project Spaces

A BB plugin for grouping existing projects, choosing the primary project for
each chat, and providing shared instructions and an optional ai-workspace group.

## Version 0.1.10

- Create, edit and remove spaces without moving or deleting source directories.
- Put one BB project in several spaces. Choose the default project per space,
  or another selected project for a particular chat.
- Map project checkouts and extra reference folders to explicit machines.
- Start chats with BB's native composer, preserving the chosen model,
  permissions, attachments, environment and execution provenance.
- Capture a configuration snapshot and repository map before the first turn.
- Detect conflicting settings edits instead of overwriting another window.
- Keep data in the plugin's BB SQLite database; no `.bb/chats` or history exports.
- Group the sidebar by space: common threads, then projects and their threads.
- Preserve old unassigned chats under their original BB project. Chats with a
  space binding appear only there, even if the project belongs to several spaces.
- Keep native thread menus, read/work indicators, pinned families, child threads,
  title search, archive filtering and paged archive loading.
- Highlight unread titles: yellow for pending user input, red for failures and
  green for completed work. Opening a thread uses BB's native read tracking and
  restores the normal text color; new unread events highlight it again.
- Show thread lists on each space's page and launch explicitly common or
  project-scoped chats. Version 0.1 bindings default to project-scoped.
- Match the bundled Thread list's row height, typography, group spacing and
  theme colors. Reuse the public BB provider icons, draft/work indicators and
  native menus; keep compact group actions visible and show the native archive
  action on hover.
- Open a project's GitHub repository from its heading, using BB's Git remote.
  Show a GitHub link on threads with a PR found by the bundled GitHub PR Status
  plugin, plus native row metadata when enabled in BB. Missing or unavailable
  PRs show no link; no extra GitHub polling is added by this plugin.

## Current scope

### ai-workspace integration

In a saved space's settings, choose a group and device. The integration shows
the installed CLI version, registered folders, actual groups and config state.
Save changed space settings, then use **Инициализировать и обновить папки**.
This registers project checkouts and additional folders on that device, creates
`.ai-workspace.json` through the CLI, and adds the space group. Existing groups,
shares and notes are preserved. Changed configs are backed up in plugin host data.
Only group memberships introduced by this integration are removed when a folder
or group changes; another space's ownership and manual memberships are preserved.
The root directory, registration and shared files are never deleted.

New provider sessions for space threads receive `project_spaces_workspace`.
Use `operation=context`, then `list_tools` to discover the upstream tool schemas,
then `call` with `tool` and `arguments`. Requests run on the thread's actual host,
through `ai-workspace serve --scope group`, using the space's current group.
The bridge exposes read tools and reuses the installed ai-workspace database.
It does not rewrite a provider's global MCP config or enable file-write tools.
Existing sessions need a safe relaunch to receive the new BB tool.

Use **Проверить обновления** to compare the installed CLI with the latest stable
official GitHub release. Use **Установить ai-workspace** when it is missing or
**Обновить до ...** when an update is available. A verified private copy is
stored in plugin host data and used by Project Spaces, without overwriting the
system PATH installation or requiring administrator rights. The installer
checks archive SHA-256 and size, extracts only the executable, verifies its
reported version and activates it only on success. Downgrades are rejected.
Windows x64, Linux x64/arm64 and macOS x64/arm64 have supported release assets.
Checks use the latest stable release API and cache results for ten minutes.
Offline or failed checks preserve the installed version and show the error.
An existing `ai-workspace` on PATH is used until a managed copy is installed.

Missing or offline devices and invalid configs are reported. The integration uses the
default `.ai-workspace.json` config path and the host's `AI_WORKSPACE_DB` setting.
Removing a space preserves ai-workspace registrations and config files as well.

### Project execution

Extra folders and other project paths are **reference context**. They do not
add native agent write permissions. A native BB worktree covers the selected
project only. Coordinated worktree sets and provider-supported additional roots
are subsequent features, not capabilities claimed by this release.

The actual active environment always overrides the primary project's source
checkout. Missing device sources remain unavailable; they never fall back to a
different device or a main checkout. Each repository keeps independent Git state.

## Use

Open **Project Spaces** in the BB navigation. Create a space, select existing
projects and its primary project, and add common instructions if needed. Use
**New chat here** or **New workspace chat** to open BB's composer.

To register another project, open the space settings and use **Добавить проект
из папки** under Projects. Choose the device, browse or enter an existing folder,
and optionally name the project. **Создать проект и выбрать** registers it in BB
and selects it in the draft space. Save the space to keep that selection.
Existing projects at the same device/path are selected without creating copies.
The BB project remains available if the space edit is cancelled. No Git
initialization, repository cloning or source-file changes are performed.

The UI is currently Russian and follows BB theme colors.

## CLI

```
bb project-spaces list --json
bb project-spaces create "Platform" <primary-project-id> <another-project-id> --json
bb project-spaces context <space-id> <project-id> <host-id> --json
```

## Develop

```
npm install --include=dev
npm run typecheck
npm test
bb plugin build
bb plugin install . --yes
```

The plugin requires BB 0.49+ and Plugin SDK 0.6.132+. No external services are
required. ai-workspace integration is optional and uses the CLI installed on
each selected device.
