# mnem0nic integration — preview

Personal, project-local checkpoints shared between Claude Code and Codex. No account
or Datashard subscription is required. This package supplies instructions and setup,
not the Rust source or executable.

**A prebuilt mnem0nic executable must be supplied separately by its maintainer.**
There is no public binary release or automatic downloader yet. Do not clone a
private source repository to install this plugin. The current executable is a CLI;
it is not yet an MCP server. Git and sqlite3 with FTS5 are runtime prerequisites.
The setup script requires a POSIX shell; Windows-native installation is not validated.

## Set up a project

Place the prebuilt executable somewhere permanent and make it executable. From the
root of this distribution repository run:

```sh
bash plugins/mnem0nic/scripts/setup.sh /absolute/path/to/mnem0nic /path/to/project --codex
```

Omit `--codex` if you only use Claude Code. Setup creates `.project-memory/` in the
chosen project, adds it to `.gitignore`, and installs AGENTS.md / CLAUDE.md instructions.
The local `./.project-memory/run` runner uses the executable's full path, so it works
even when client shells do not inherit your PATH. Keep the executable at that path.
Existing checkpoints and surrounding instructions are preserved. The optional Codex
skill installer refuses to overwrite a differing existing skill.

For Claude, add the marketplace and install `mnem0nic@datashard`. The plugin exposes
`/mnem0nic:mnem0nic`; ask it to set up the project using your executable path, save a
checkpoint or resume a task. Setup can also be done directly by the script above.
For Codex, restart after setup and use `$mnem0nic`. A compatibility manifest is also
included for Codex hosts that support local skill-only plugin packages; the script
is the documented installation path here.

## Working across sessions

After setup, ask your first client to save a checkpoint after meaningful progress.
Then open a fresh session in the same project using either client and ask it to
continue the task. The instructions request checkpoint retrieval, relevant-file
inspection and reconciliation of Git/file changes before work resumes.

From the project root you can inspect it yourself:

```sh
./.project-memory/run resume
./.project-memory/run resume --task YOUR-TASK
./.project-memory/run search "distinctive words"
```

The preview still needs a completed real-client handoff acceptance test. Process-level
storage tests do not prove that clients reliably follow these instructions. Progress
not checkpointed before a crash is not recoverable. Checks stored in memory are
historical results, not current verification.

## Privacy and optional Datashard

The database is local plaintext and ignored by Git. Do not store credentials or
chat transcripts. Ignore rules do not untrack already committed files. No background
service, transcript recorder or network upload is installed by this package.

Datashard knowledge is fetched live through its separate integration. Store only
fact references locally, never retrieved fact bodies. A team knowledge save follows
the Datashard approval workflow; a local checkpoint does not grant that approval.

Claude Code one-step plugin installation (the binary prerequisite still applies):

```text
/plugin install mnem0nic --marketplace datashard-ai/plugins
```
