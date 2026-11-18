# Changelog

## 0.2.2

- Add project renaming to the project's actions menu in the sidebar and space
  page, including projects without threads. Native BB project updates refresh
  names across spaces without changing folders, Git remotes or thread placement.
- Show ai-workspace folder counts by device and retry removal of obsolete group
  bindings when their folders become available again.

## 0.2.1

- Render `::page-preview{page_id="…"}` as a compact, mobile-friendly ChatGPT
  page link in assistant messages, including existing conversations. Optional
  `title` supplies the label. Invalid Page IDs remain inactive; the card does
  not fetch private page content or change the saved message.

## 0.2.0

- Release the shared-context workflow around ai-workspace for materials/groups
  and Repowise for code evidence across related repositories on the actual host.
- Include managed CLI installation/updates, Repowise freshness checks and BB
  lifecycle refresh, compact tool discovery and opt-in managed AGENTS.md blocks.
- Document setup, permissions, downloads and upgrading from the 0.1 source range;
  update the marketplace overview. Saved spaces and thread placement stay compatible.

## 0.1.26

- Return compact tool catalogs from both bridges; return a full schema only for
  one explicitly named read tool. Reject unavailable/write-tool schema requests.
- Guide agents to check instruction files at known paths instead of recursively
  scanning home directories, and avoid repeated prepare calls while indexing runs.

## 0.1.25

- Keep AGENTS.md blocks compact: link to one selected space's context instead
  of copying full instructions for every membership. Update existing owned blocks.
- Inject the selected snapshot rules once, preserving the path map while dropping
  its generated duplicate instructions. Preserve unknown legacy metadata.
- Refuse writes above a protective 32 KiB file budget without truncating user rules.

## 0.1.24

- Manage one project-space block in project AGENTS.md files with opt-in automatic
  updates per device after saving settings and on plugin reload. Preserve other
  instructions, line endings and an original backup; expose results/retry in settings.
- Combine shared-project memberships in one conditional block and remove only
  disabled/deleted entries. Keep reference folders unchanged; reject malformed
  markers, linked files and unsupported encodings without rewriting them.

## 0.1.23

- Resolve the current native ai-workspace registration when historical Windows
  path/case aliases exist; show its groups instead of the first stale DB record.
- Verify requested membership through MCP and the config before reporting a
  successful folder update. Preserve existing registrations and memberships.

## 0.1.22

- Refresh already prepared Repowise indexes from BB turn lifecycle events on the
  thread's actual device and worktree; coalesce checks and allow opt-out per space.
- Detect changes in HEAD, staged/unstaged and untracked files before code queries;
  reject stale evidence and report incomplete freshness checks explicitly.
- Supply scoped context instructions to all BB providers and show tool connection
  details plus a copyable AGENTS.md instruction block in collapsed settings.
  No global editor/MCP configuration or Git hooks are overwritten.

## 0.1.21

- Show GitLab and GitVerse repository icons and links in project rows; use a
  generic Git icon for other servers. Support HTTPS/SSH, nested GitLab groups,
  GitVerse SSH ports and legacy `/sc/` remotes without exposing credentials.
- Refresh repository links after a project is added to the catalog. Preserve
  existing GitHub PR badges and the legacy GitHub catalog field.

## 0.1.20

- Install and update Repowise on the selected device using an isolated managed
  Python environment. Verify package size, SHA-256, origin and CLI version;
  activate only after success, preserve PATH installations and avoid downgrades.
- Bootstrap verified native uv and managed Python when needed, including Linux
  devices whose system Python has no ensurepip. Use managed binaries for status,
  indexing and cross-repository MCP queries.
- Collapse space settings into sections with concise version/readiness summaries,
  searchable project selection and separately collapsed folder/configuration lists.
  Keep save/close controls visible while scrolling and installation errors visible.

## 0.1.19

- Package the pinned Plugin SDK as a production dependency so Git/marketplace
  installations can build the frontend RPC contracts with development dependencies omitted.
- Add the approved marketplace overview and a monochrome folder-tree icon.
- Keep native inline-composer buttons isolated from project-list button styles.

## 0.1.18

- Inherit missing Project Spaces placement for native Continue from, forks and
  delegated child threads. Carry the shared/project scope and saved context
  before dispatch; preserve explicit transfers, including outside placement.
- Recognize only the leading structured Continue from link in the first user
  turn. Ordinary mentions and later messages do not reassign a thread. Bound
  ancestry lookups and publish binding updates for the live sidebar.
- Add read-only thread-binding inspection and an inherit CLI repair command
  for continuations created before this fix, without copying history or sending prompts.
- Distinguish automatic launch defaults from explicit moves/copies so Continue
  from can replace a seeded project scope while preserving deliberate transfers.
  Support explicit --replace repair for older continuations with the wrong scope.

## 0.1.17

- Open project chat forms inline, immediately below the project's launch button.
  Show Close beside that same button; keep a single active composer and native
  draft keys when switching projects or reopening a form.
- Keep common-space chats beneath the space heading with Close beside their
  launch button. Scroll sidebar launches to the matching inline action row.

## 0.1.16

- Place the new-chat composer directly below the space heading, before the
  thread/project lists. Keep the common-chat button beside space settings and
  the close button beside the composer title.
- Scroll to the composer for project/common launch actions and sidebar routes,
  including repeated clicks for an already-open project. Preserve native draft keys.

## 0.1.15

- Make saving a visible first step, place the save action before integrations,
  and keep settings open with the current revision after saving. Explain why
  initialization/indexing is disabled while unsaved and that checks show saved folders.
- Detect unsupported ai-workspace share globs during inspection and before
  changing membership/configuration. Show the offending path and a Russian fix hint.

## 0.1.14

- Keep pending questions and approvals yellow after the thread is opened or
  marked read, until the interaction is resolved. A pending interaction also
  takes precedence over a running indicator.
- Propagate attention through parent threads even when children are expanded.
  Use a brighter yellow and stronger title weight for parents; pending input
  takes priority over unread failures and completion.

## 0.1.13

- Add host-scoped Repowise setup, progress/status UI and read-only agent bridge.
  Managed workspace manifests support arbitrary folder locations; native
  indexes are reused per checkout instead of copied into chat storage.
- Supply ai-workspace and Repowise tools to space threads and project threads
  with a unique space. Require selection for multiple memberships and honor
  explicit outside placement. Resolve both sources on the actual thread host.
- Federate supported workspace queries and fan out other reads by repo alias.
  Bound output, reject unlisted repositories/write tools, and preserve evidence
  labels. Prepare worktree-specific scopes instead of substituting base indexes.
- Add background indexing and CLI setup/status/query commands. Initial indexes
  use fast, no-prose mode and skip editor/hook installation; updates include
  uncommitted code. Preserve existing full indexes and user editor settings.

## 0.1.12

- Add native thread menu actions to move or copy chats into spaces or outside
  spaces. Copies use BB's history fork without sending a prompt; environments
  remain shared. Moves include descendants and retain IDs and native links.
- Add project-level batch transfer dialogs for the current filtered/loaded
  list, with destination membership validation, partial failure reporting and
  retries that do not duplicate successful copies.
- Respect explicit child placement in grouping and label the loose section
  “Треды вне пространств”. Refresh bindings through realtime after transfers.

## 0.1.11

- Use BB's supported Folder icon for the sidebar entry and plugin branding,
  replacing the unsupported Folders name that fell back to a lightning bolt.

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
