---
name: init
description: Sets up Datashard in this project. It writes DATASHARD.md with the project's install, section, tags and bundle, and wires AGENTS.md and any existing CLAUDE.md to read it. Run it once per project, and again to change any of them.
disable-model-invocation: true
---

# Set up Datashard in this project

The plugin connects Claude Code to the company's Datashard and brings the save skill. What only the project knows (the
install its knowledge belongs to, its section, its tags, whether it keeps an OKF bundle) goes in `DATASHARD.md` at the
project's root, which every session loads. This sets that up. Before every save, the plugin checks that the install
`DATASHARD.md` names is the one it saves to.

Work from the project's root: the git top level, or the current folder outside a repository. Write, change or delete
nothing until the person says yes to the exact change. Each numbered step that changes something asks on its own.

## 1. Check the connection

- The plugin connects to `${user_config.datashard_url}`. Ask the person whether that is the install this project's
  knowledge belongs to. If the address itself is mistyped, it is changed in `/config` (the Datashard plugin's
  "Datashard address"); then restart Claude Code, so the plugin's server picks up the new address, and run
  `/datashard:init` again. If it is another company's install, offer to turn the plugin off for this person in this project (`"enabledPlugins":
  {"<plugin id>": false}` in `.claude/settings.local.json`, with the id `/plugin` shows, e.g. `datashard@datashard`;
  not `.claude/settings.json`, which turns it off for the whole team), so a save here can't reach another company's
  install, and stop. In a git repository, the change must stay out of commits:
  - Untracked, and `git check-ignore -q .claude/settings.local.json` fails: adding it to `.gitignore` is part of the
    same yes.
  - Tracked (`git ls-files --error-unmatch .claude/settings.local.json` finds it): the team shares that file, so a
    change there reaches everyone, and untracking it would delete it from their clones at their next pull. Say so,
    and offer instead, as a separate yes, to keep this person's change out of commits with
    `git update-index --skip-worktree .claude/settings.local.json`.
  - Outside a repository: nothing more.

  Claude Code asks once more before that write: the plugin asks before any change to its settings, so tell the
  person to expect it.
- If the address above is empty or still a placeholder starting with `${`, Claude Code did not fill it in: take it
  from the URL line of `claude mcp get plugin:datashard:datashard` instead, here and in step 3. If that has no address
  either, tell the person to set it in `/config` (the Datashard plugin's "Datashard address") and run
  `/datashard:init` again, and stop.
- Call `brief` (`mcp__plugin_datashard_datashard__brief`). If it fails or the tool is missing, stop and tell the person
  to sign in with `/mcp` (server `plugin:datashard:datashard`), then run `/datashard:init` again.
- If the session also has `mcp__datashard__*` tools, a `datashard` server was added by hand before the plugin, and every
  tool now shows twice. Compare its address (`claude mcp get datashard`) with the plugin's. Same install: tell the
  person `claude mcp remove datashard` removes the old one (with `-s user` or `-s project` if it says which). Another
  install: keep it, and in that install's projects turn the plugin off as above. A Datashard connector from claude.ai
  (`mcp__claude_ai_…` tools) duplicates them the same way: it can be turned off in `/mcp`.

## 2. Choose the section, tags and bundle

If `DATASHARD.md` exists, start from the section, tags and bundle it names. If it names an install other than the one
confirmed in step 1, show the person both. If they say the Install line is the mistake, correct it in step 3; if not,
stop: the project belongs to that install.

- **Section:** one of the brief's `sections`, shown with its label from `sectionLabels` (under › client › project).
  Suggest the one whose project matches this folder. The person picks; never write a section the brief doesn't list.
- **Tags:** one or more of the brief's `tags`, shown with their `about`. The person picks; never invent a tag.
- **Bundle:** `none`, unless the project has an `.okf/` folder (`find . -name .okf -type d -not -path
  '*/node_modules/*'`). Then ask whether this section's facts live there; if so, the bundle is that folder's path from
  the root, e.g. `.okf/`.
- **Other agents:** ask whether Codex, Cursor or another agent also works here (an `AGENTS.md`, `.cursor/`,
  `.cursorrules` or `.codex/` is a hint). They don't load Claude Code plugins. Cursor installs this
  repository's Cursor plugin and runs `/datashard-init`. Codex installs this repository's Codex plugin and runs
  `$datashard-init`.

## 3. Write DATASHARD.md

**New file:** start from `${CLAUDE_PLUGIN_ROOT}/templates/DATASHARD.md` (if it isn't there, Claude Code did not fill in
the plugin's folder: find it with `find ~/.claude/plugins -path '*datashard*/templates/DATASHARD.md'`) and change only
this, keeping the backticks around each value:

| In the template | Becomes |
|---|---|
| The sentence "Replace every `<…>` below." | removed |
| `<install address>` | the address confirmed in step 1, without any `user:password@` part: `DATASHARD.md` is usually committed. If the address has one, tell the person it should not hold credentials |
| `<section-id>` | the section |
| `` `<tag>`, `<tag>` `` | the tags, each in backticks, comma-separated |
| `["<tag>"]` | the first tag, e.g. `["mcp"]` |
| `<path to the .okf folder, or none>` | the bundle's path, or `none` |
| `` `save-to-datashard` skill (`.claude/skills/save-to-datashard/SKILL.md`) `` | Claude Code only: `` `datashard:save-to-datashard` skill (from the Datashard plugin) ``. Other agents too: unchanged |
| `mcp__datashard__brief` | `mcp__plugin_datashard_datashard__brief` |
| `mcp__datashard__search` | `mcp__plugin_datashard_datashard__search` |
| `mcp__datashard__read` | `mcp__plugin_datashard_datashard__read` |
| `mcp__datashard__fetch` | `mcp__plugin_datashard_datashard__fetch` |
| `mcp__datashard__changes` | `mcp__plugin_datashard_datashard__changes` |
| `mcp__datashard__save` | `mcp__plugin_datashard_datashard__save` |
| `mcp__datashard__flag` | `mcp__plugin_datashard_datashard__flag` |

The last seven rows are the claude-mem section's tool names: the names Claude Code gives the plugin's tools. They wrap
across lines in the template; rewrap the bullet after replacing them.

**Existing file:** change only the `## This project` block, up to the next `##` heading, adding its `- Install:` line
first if it has none. Then offer each of these separately, when it applies:

- The tools are still named `mcp__datashard__…`: the plugin's names, as in the table.
- Claude Code is the only agent, and the save skill is still named by its path: the plugin's skill, as in the table.

Show the whole new file, or the change, and write it on a yes. Claude Code then asks once more before the write:
the plugin asks before any change to a `DATASHARD.md`, so tell the person to expect it.

## 4. Make every agent read it

- Create `AGENTS.md` at the project root if missing. Add the sentence "Before answering about the company or saving
  knowledge, read `DATASHARD.md`." unless an equivalent instruction is already there. Preserve all existing rules.
- Add `@DATASHARD.md` to `AGENTS.md` unless it is already there. Claude expands that import; the plain sentence
  tells other agents to open the file.
- If the project already has `CLAUDE.md`, preserve its content and add `@DATASHARD.md` if missing, or
  `@../DATASHARD.md` for `./.claude/CLAUDE.md`. Do not delete or migrate existing instructions as part of init.
- For a new project, use `AGENTS.md` alone by default. Claude Code v2.1.277 or later reads it directly when there is
  no `CLAUDE.md`, `.claude/CLAUDE.md` or `CLAUDE.local.md` in the working directory or any directory above it.
  Check those ancestor files too: they can suppress automatic loading of the project's `AGENTS.md`.
- If an ancestor or local Claude file suppresses `AGENTS.md`, or this session cannot load it (an older Claude
  version, disabled built-in support, or a restrictive Project instructions setting), explain the reason. Offer a
  project `CLAUDE.md` containing `@AGENTS.md` as a compatibility wrapper, or have the person choose
  `claude-md-and-agents-md` under Project instructions in `/config`. Do not change personal settings silently.

Show all the changes together and make them on a yes. Running init again must not duplicate imports or instructions.
Confirm the loaded instruction files with `/memory` in the next session.

## 5. The project's copy of the save skill

- **Claude Code only**, with `.claude/skills/save-to-datashard/`: offer to remove it (`git rm -r` if tracked). The
  plugin's `datashard:save-to-datashard` replaces it, and two copies give Claude two save skills. If `DATASHARD.md`
  still names the copy's path, renaming it to the plugin's skill is part of the same yes: never remove the copy and
  leave the path.
- **Other agents too:** keep the copy, or offer to copy `${CLAUDE_PLUGIN_ROOT}/skills/save-to-datashard/` there if it
  is missing. `DATASHARD.md` names its path for them. Claude Code then lists two save skills, the plugin's and the
  project's: the same procedure, so either one saves once.

## 6. Personal memory: mnem0nic or claude-mem

`DATASHARD.md` has a section for each local memory tool that works with Datashard, `## mnem0nic` and `## claude-mem`.
Find which of them this person runs:

- **mnem0nic:** `command -v mnem0nic` finds it, or `~/.local/bin/mnem0nic` exists.
- **claude-mem:** an `enabledPlugins` entry `claude-mem@…` set to `true` in `~/.claude/settings.json` (or
  `$CLAUDE_CONFIG_DIR/settings.json`), `.claude/settings.json` or `.claude/settings.local.json`. A `~/.claude-mem`
  folder alone is claude-mem's data, which stays when it is turned off.

Then:

- **mnem0nic, without claude-mem:** offer to remove the `## claude-mem` section, up to the next `##` heading, so the
  file keeps the mnem0nic one. mnem0nic never keeps what a Datashard tool returns, so there is nothing to configure.
  `DATASHARD.md` is usually committed: if teammates still use claude-mem, the person may keep both sections.
- **claude-mem, without mnem0nic:** keep both sections, keep Datashard out of claude-mem (below), then suggest
  mnem0nic (below).
- **Both:** keep both sections and keep Datashard out of claude-mem (below). Tell the person that both now take notes
  of every session, and that turning claude-mem off (`claude plugin disable` with the `claude-mem@…` id found above)
  leaves its data in `~/.claude-mem`.
- **Neither:** change nothing.

**Keep Datashard out of claude-mem,** if `~/.claude-mem/settings.json` exists. Its `CLAUDE_MEM_SKIP_TOOLS` is one
comma-separated string, matched on whole names. Offer to append the seven `mcp__plugin_datashard_datashard__…` names it
lacks, after the names already there, showing the value before and after. If the person keeps a `datashard` server
added by hand (step 1), offer its seven `mcp__datashard__…` names too. On a yes, change that value and nothing else in
the file.

**Suggest mnem0nic,** once, if this is a Mac with Apple silicon (`uname -sm` prints `Darwin arm64`): mnem0nic runs
nowhere else yet. Tell the person, in your own words:

- mnem0nic replaces claude-mem with one native binary that leaves nothing running when idle, where claude-mem runs a
  background worker.
- It has claude-mem's MCP tools under the same names, and imports claude-mem's history, so past sessions come with it.
- It never keeps what a Datashard tool returns, so there is no `CLAUDE_MEM_SKIP_TOOLS` list to keep up.
- It writes its notes through the person's own paid Claude plan (Pro, Max, Team or Enterprise), never an API key: a
  Claude Code signed in with an API key, or on Amazon Bedrock or Google Vertex AI, is not set up.

To switch, the person runs these in a terminal (run them yourself only if they ask you to), with the `claude-mem@…`
id found above in the last one, usually `claude-mem@thedotmack`:

```sh
curl -fsSL https://raw.githubusercontent.com/datashard-ai/mnem0nic/main/install.sh | sh
mnem0nic install
mnem0nic import-claude-mem
claude plugin disable claude-mem@thedotmack
```

The first downloads the latest release and checks its checksum, then puts `mnem0nic` in `~/.local/bin`. The second
adds its hooks and MCP server to Claude Code and Codex, after a dated backup of each settings file. The third imports
claude-mem's history and leaves claude-mem's data as it is. The last turns claude-mem off, so the two don't both take
notes. Then they restart Claude Code and run `/datashard:init` again, which keeps the mnem0nic section. More:
https://github.com/datashard-ai/mnem0nic.

## 7. Check that a save still asks

Read `permissions.allow` in `.claude/settings.json`, `.claude/settings.local.json`, `~/.claude/settings.json` and, if
the organisation has one, the managed settings file (`/Library/Application Support/ClaudeCode/managed-settings.json` on
macOS, `/etc/claude-code/managed-settings.json` on Linux, `C:\Program Files\ClaudeCode\managed-settings.json` on
Windows). Allows given for one session (`--allowedTools`) can't be read from here. An entry that allows `save` (`mcp__plugin_datashard_datashard__save`, `mcp__plugin_datashard_datashard__*`, the bare
`mcp__plugin_datashard_datashard`, or the same for `mcp__datashard`) skips Claude Code's own confirmation, and so does
a `permissions.defaultMode` of `bypassPermissions`. Warn the person, naming the file and the entry. Don't change it
yourself. The plugin's own check still refuses a save to another install whatever the allow lists say, as long as it can run.

## 8. Finish

Tell the person what changed, what they declined, and anything left for them (signing in, removing a duplicate server,
an always-allowed save, switching to mnem0nic). `DATASHARD.md` loads from the next session; the plugin's save check reads its Install line
from now on.
