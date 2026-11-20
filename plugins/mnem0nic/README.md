# mnem0nic

Persistent memory for Claude Code and Codex. mnem0nic records your own coding sessions on your own Mac, writes a
short note after every turn, and gives your agent tools to search and pick up past work, across projects and across
both CLIs. No Datashard account or subscription is required.

This package is the `mnem0nic` skill: instructions that tell the agent when to search, save a checkpoint or resume a
task, and how to keep Datashard facts out of its notes. It does not contain the mnem0nic program, and installing it
does not install the program. mnem0nic has its own installer, which also registers mnem0nic's hooks and MCP server, so
this package has none of its own. This page matches mnem0nic 0.10.1; the
[mnem0nic README](https://github.com/datashard-ai/mnem0nic) is the reference for later releases.

## Install mnem0nic

You need a Mac with Apple silicon, and at least one of:

- **Claude Code**, signed in with a paid Claude plan (Pro, Max, Team or Enterprise);
- **Codex**, signed in with a paid ChatGPT plan (Plus, Pro, Business, Enterprise or Edu).

Then, in a terminal:

```sh
curl -fsSL https://raw.githubusercontent.com/datashard-ai/mnem0nic/main/install.sh | sh
mnem0nic install
```

Restart Claude Code or Codex. The first command downloads the latest release, checks its SHA-256 checksum and puts
`mnem0nic` in `~/.local/bin`. The second sets mnem0nic up for all your projects, in each CLI signed in with its own paid plan,
after a dated backup of each settings file it changes, and downloads the search model (130 MB, once) for search by meaning.

Intel Macs and Windows are not supported. Linux is covered in the mnem0nic README.

## Add the skill

The skill is optional for Claude Code and Codex, whose tools mnem0nic's installer registers. It adds the workflow and
the Datashard rule below. From this repository's marketplace:

```text
/plugin marketplace add datashard-ai/plugins
/plugin install mnem0nic@datashard
```

in Claude Code, and in Codex:

```sh
codex plugin marketplace add datashard-ai/plugins
codex plugin add mnem0nic@datashard
```

Cursor reads the same marketplace (see the [root README](../../README.md)). mnem0nic has no Cursor integration and
records nothing from Cursor sessions, so there the skill is the only part: it uses the `mnem0nic` command from the
project root, `mnem0nic search "words"` and `mnem0nic sessions`, to read what Claude Code and Codex recorded for that
project. The documented commands only read, so it cannot save a checkpoint from Cursor.

## What the agent gets

After `mnem0nic install`, the `mnem0nic` MCP server offers claude-mem's tools, with the same names and parameters:

| Tool | What it does |
| --- | --- |
| `mem_search` | Search memory step by step: an index, then context, then the details you pick |
| `save_memory` | Save a note, decision, correction or handoff of your own |
| `search`, `timeline`, `get_observations` | Search with filters, see what happened around a note, read notes by id |
| `get_tool_uses` | Read the original input and output of tool calls already found |
| `work_state_write`, `work_state_read` | Keep to-do lists and working state across sessions |
| `session_start_context` | Show the context a new session starts with |
| `important_workflow` | How to use the tools above, for the agent |

and its own tools, over the word-for-word conversations:

| Tool | What it does |
| --- | --- |
| `memory_search` | Search earlier conversations by words and meaning |
| `memory_get` | Read the messages around a search result |
| `memory_sessions` | List the project's recent sessions |
| `memory_save`, `memory_resume` | Save a checkpoint of your work, and resume from it on the same branch |

In Claude Code the tools appear as `mcp__mnem0nic__…`. A new session also starts with the project's recent context.
In Claude Code, `/mnem0nic search "words"`, `/mnem0nic sessions` and `/mnem0nic doctor` run the commands that read,
when you type them; the agent cannot call `/mnem0nic`. `mnem0nic help` lists every command.

## Working across sessions

Ask the agent to save a checkpoint after meaningful progress. Then open a fresh session in the same project, in
either CLI, and ask it to continue the task: it resumes from the checkpoint on the same branch, reads the relevant
files and reconciles what changed in Git before it goes on. Progress that was not checkpointed is still in the
recorded session and its notes, and is found by search. Checks stored in memory are historical results, not current
verification.

## Coming from claude-mem

mnem0nic reads claude-mem's database directly and keeps the same tool names, so a skill or habit that uses
`mem_search` keeps working. `mnem0nic install` finds your claude-mem history and offers to import it. If you skipped
it, run `mnem0nic import-claude-mem`. It reads claude-mem's database without changing it and adds only what is new.
Turn claude-mem off so the two don't both take notes: `npx claude-mem uninstall`, or
`claude plugin disable claude-mem@thedotmack` to keep it installed but off.

## Privacy and Datashard

- Everything mnem0nic records stays in `~/.local/share/mnem0nic`, readable only by your user account. No account, no
  telemetry, no server of mnem0nic's.
- After each turn, the request, its tool calls and the agent's reply go to the provider of the CLI you used,
  Anthropic for Claude Code and OpenAI for Codex, through your own login, to write the note. Never an API key, so
  never a per-token bill.
- Wrap text in `<private>` tags, or exclude a whole project in mnem0nic's `config.toml`, and it is never stored.
  Secrets that mnem0nic recognises are replaced before anything is stored. Redaction does not cover checkpoints or
  work-state lists.
- **mnem0nic never stores calls to Datashard's tools**, neither what was asked nor what came back, and the notes
  model never sees them. Facts are fetched again when needed, with your current access.
- Datashard knowledge is fetched live through its own integration. In a checkpoint, record only the fact reference
  (`fact:section/id`, in `datashard_refs`), never the fact's text. A team knowledge save follows the Datashard
  approval workflow; a local checkpoint does not grant that approval.

## Check, upgrade and uninstall

```sh
mnem0nic doctor               # checks the store, hooks, background process, search model, notes and sync; only reads
```

Upgrade by running the install command again, then `mnem0nic install`, then restart Claude Code or Codex: a session
keeps the MCP server it started with until you restart it. Your memory and settings are kept.

```sh
mnem0nic uninstall            # removes the hooks and MCP server, keeps your memory
mnem0nic uninstall --purge    # also deletes ~/.local/share/mnem0nic
rm ~/.local/bin/mnem0nic
```
