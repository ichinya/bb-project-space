# Project Spaces

A BB plugin for related repositories, shared context and project threads.
Project Spaces 0.2 uses **ai-workspace** for shared files, notes and groups, and
**Repowise** for code queries and relationships across the space's repositories.
Both integrations use the thread's actual device and checkout; the active
worktree replaces its project's base checkout.

## Version 0.2.0

### Set up context

1. Create a space and select its projects and primary project. For ai-workspace,
   enter a group under **Общий контекст**, then save settings.
2. Open **Общие материалы · ai-workspace**. Select the device, install/update the
   CLI, and initialize folders in the configured group to share project materials.
3. Open **Контекст кода · Repowise**. Install/update its CLI on that device and
   prepare the indexes. Preparation uses index-only operations without model calls
   or an API key; prepared indexes can refresh through BB turn lifecycle hooks.
4. Start a new agent session to receive `project_spaces_workspace` and
   `project_spaces_repowise`. Each bridge starts with `operation=context`;
   `list_tools` gives a compact catalog, and `tool=<name>` requests one full schema.
5. Optionally enable a compact managed AGENTS.md block under **Подключение к
   агентам** for each device. Save settings to apply it while preserving other rules.

The context CLIs are optional for organizing spaces and chats. Their installation
requires downloads from GitHub/PyPI and can include managed uv/Python for Repowise.
They do not configure external MCP clients or change global editor settings.

### What you get

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
- Move a thread to another space or outside spaces through its native action
  menu. Moves preserve IDs/history and include descendants; all their projects
  must belong to the destination. Explicitly moved children retain native parent
  links and appear at their destination. Space context applies on session restart.
- Copy a thread with BB's native history fork, without starting an agent or
  copying child threads. Copies reuse the original working environment/files.
- Use the project's ellipsis button for move/copy of the current filtered list.
  Archived threads are included only when loaded and shown. Partial batch
  failures report results and retry only failed sources.
- Prepare Repowise across all space folders from settings. Each checkout keeps
  its native index; managed workspace manifests and cross-repo artifacts live
  in plugin host data, shared between chats with the same checkout set.
- Agents receive `project_spaces_repowise` for code and
  `project_spaces_workspace` for ai-workspace materials. Unbound project threads
  inherit a unique space; multiple memberships require an explicit choice.
  Explicitly outside threads stay outside. Existing sessions need a restart.
- Repowise `repo=all` uses native federated operations when supported and fans
  other reads out with repo-labelled results. The active worktree replaces
  only its project; other folders stay on the same selected host. New worktrees
  prepare their own index rather than querying an unrelated base checkout.

- Keep native thread menus, read/work indicators, pinned families, child threads,
  title search, archive filtering and paged archive loading.
- Preserve space/common versus project placement when using native Continue from,
  forks and delegated children. Explicit transfers take precedence. Repair an old
  unbound continuation with `bb project-spaces inherit <thread-id>`; inspect its
  placement with `bb project-spaces thread-binding <thread-id>`. For an older
  continuation already assigned the wrong scope, use `inherit <thread-id> --replace`.
- Highlight pending questions and approvals in yellow until answered, including
  opened/read threads. Unread failures are red and completed work is green;
  opening the thread acknowledges those outcomes. Parent threads inherit their
  descendants' attention even when expanded, with brighter yellow for pending input.
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

### Repowise integration

Open **Контекст кода · Repowise** in space settings and select the device.
**Проверить обновления** shows the installed and latest PyPI versions;
**Установить Repowise** / **Обновить до …** installs an isolated, versioned
copy in the plugin's host data. A PATH installation remains available until a
managed copy is activated. The installer verifies the wheel's size, SHA-256,
download origin and CLI version, and preserves the active copy on failure.
It uses uv from the device or downloads a verified native uv release from
astral-sh/uv on GitHub. uv supplies Python 3.12 when necessary. Dependencies
come from PyPI; managed software stays separate from project and chat folders. Neither
global Python packages nor PATH are modified. Old managed versions are retained
so an in-flight index or query can finish against its original environment.
On Windows, long host-data paths use an owned per-profile application cache under
`LOCALAPPDATA/bb/ps` to keep native dependency paths below Windows loader limits;
the active-version metadata remains in plugin host data. Installation also checks
the indexing and MCP command imports before activation.

New indexes use
`--mode fast --no-prose --no-save-key --no-editor-setup --no-hook --no-workspace`
and exclude `.bb/`. Updates include uncommitted files via
`--index-only --working-tree`. This initial mode provides code structure and
essential Git facts, not a full generated wiki or guaranteed semantic embeddings.
Indexes can be upgraded separately with native Repowise. No global MCP/editor
configuration or model keys are changed. Git ownership exceptions are limited
to the exact selected roots in the child process environment; global Git
configuration is preserved.

BB lifecycle hooks check already prepared indexes when an agent turn starts,
finishes or fails, and refresh changed indexes with the same index-only mode.
They use the thread's actual host/worktree and do not initialize missing indexes.
Disable **Автообновлять подготовленные индексы в BB** per space and save to opt out.
Freshness checks include HEAD and staged/unstaged/untracked files; generated
index/plugin folders are excluded. Incomplete checks return `freshnessWarning`
instead of claiming freshness. Queries reject known stale indexes until updated.
These are BB lifecycle hooks; existing Git post-commit and editor hooks stay intact.

**Подключение к агентам → Инструкция для AGENTS.md** offers a copyable managed
`<project-space>…</project-space>` block and optional automatic writing per device.
Enable the device checkbox and save: the plugin creates/updates AGENTS.md in
project roots, keeping other content and one original backup per file in host data.
It reconciles enabled spaces on settings save, removal and plugin reload; shared
projects receive one block with all enabled spaces and conditional context selection.
Disabling a space removes only its entry; reference folders are not written.
Offline failures can be retried with **Обновить AGENTS.md**. Malformed/duplicate
markers, links and non-UTF-8 files are preserved and reported as errors.
BB also passes instructions directly to each provider. Restart an existing agent
session to load changed tools/instructions. AGENTS.md alone does not register MCP
servers; Codex/Claude started outside BB need separate client configuration.

The managed block contains only a short context lookup and linked-space IDs/names,
without duplicating every space's full rules. BB injects the selected snapshot's
rules once, stripping their duplicate copy from its generated launch map. External
clients can fetch one selected space through the read-only BB context CLI when
available. The writer rejects a resulting AGENTS.md above a protective 32 KiB
threshold; this is a per-file guard, not a guarantee about the client's combined
instruction-chain budget. Existing non-plugin instructions are never truncated.

Both context bridges return only a compact name/description catalog for
`operation=list_tools`. Fetch a single complete schema with `tool=<name>` before
calling it. Agent guidance uses direct instruction-file checks at known roots and
ancestors, avoiding recursive home-directory discovery and duplicate preparation
requests while an index job is already running.

CLI setup and verification:

```text
bb project-spaces repowise-sync <space-id> <host-id> --json
bb project-spaces repowise-status <space-id> <host-id> --json
bb project-spaces repowise-query <space-id> <host-id> get_overview --json
```

Preparation runs in the background. Poll status until `busy=false`,
`prepared=true` and `stale=false`. A failed refresh keeps readable indexes
and reports the last successful update, failed stage and elapsed time. The
overview remains available with a freshness warning while the index is stale.
The next eligible agent turn retries an unsuccessful refresh after a cooldown.
Project Spaces ignores uncommitted changes to the root `.ai-workspace.json`
in its freshness check. Agent calls `prepare` and `context`
use the thread's actual environment, including a selected worktree. Inspect
upstream staleness/confidence diagnostics and update indexes before relying on
changed code. Neither index scope nor path maps grant filesystem permissions.

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
Use `operation=context`, then `list_tools` for the compact catalog. Request one
schema with `list_tools, tool=<name>`, then `call` with `tool` and `arguments`.
Requests run on the thread's actual host,
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
Project rows show provider-specific repository links for GitHub, GitLab and
GitVerse, with a generic Git icon for other servers. Links accept HTTPS and
SSH remotes, remove embedded credentials, and support nested GitLab groups.
GitVerse's legacy `/sc/` clone prefix maps to the current repository page.
Thread PR status badges continue to use BB's native GitHub integration.
Settings are grouped into collapsed sections with version and readiness
summaries. Project selection has a name/path filter; folder/configuration lists
have separate disclosures and bounded scrolling. Save/close controls stay at
the top while scrolling. Save the space before folder initialization/indexing;
CLI installation itself does not require saving draft space changes.

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

The plugin requires BB 0.49+ and Plugin SDK 0.6.132+. Space/thread organization
does not require an external context service. ai-workspace and Repowise are
optional CLIs installed on each selected device; chats use your configured provider.

## Upgrade from 0.1

Version 0.2.0 preserves the plugin ID `project-spaces`, saved spaces and thread
placement. Existing settings remain compatible; automatic AGENTS.md writing is
opt-in per device. Restart existing agent sessions to load current instructions.
Git installs tracking `^0.1.x` need an explicit source change to `^0.2.0`; that
older range does not include the 0.2 release line.
