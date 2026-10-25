# Datashard integration

Connect Claude Code or Codex to your company's Datashard MCP endpoint. This package
contains client setup, skills and Claude permission hooks; the hosted server is not
included. Your company supplies an HTTPS address ending in `/mcp` and account access.

## Claude Code

Installing needs read access to this repository: you have it if you can read this
page on GitHub. While the repository is private, let git reach GitHub without asking
for a password, as Claude Code clones plugins with prompts turned off:

- over HTTPS: `gh auth login`, then `gh auth setup-git`;
- or over SSH: a key loaded in `ssh-agent`.

Without a GitHub SSH key, also set `CLAUDE_CODE_PLUGIN_PREFER_HTTPS=1` in your shell,
or installs and updates from inside Claude Code fail.

Inside Claude Code:

```text
/plugin marketplace add datashard-ai/plugins
/plugin install datashard@datashard
```

Enter your company's address when prompted. Restart Claude Code, sign in to the
Datashard connection using `/mcp`, and run `/datashard:init` for each project.
From a shell, Claude Code 2.1.292 or later also takes the address at install time:

```sh
claude plugin install datashard --marketplace datashard-ai/plugins --config datashard_url=https://YOUR-INSTALL/mcp
```

Change the address with `/plugin configure datashard@datashard`, then restart before
saving: the save check follows the new address at once, but the plugin's server keeps
the old one until Claude Code restarts.
The init skill creates DATASHARD.md and project instructions with your chosen
section/tags. Saves require approval of the exact fact text. Claude hooks check
that saves go to the endpoint named by the project.

If you added Datashard's server by hand before, remove it (`claude mcp remove datashard`),
or every tool shows twice.

### Updates

Claude Code gets a new version when the package's version goes up. Run
`claude plugin update datashard@datashard`, or turn on auto-update for the `datashard`
marketplace under Marketplaces in `/plugin`. While the repository is private,
auto-update needs the stored GitHub sign-in above.

## Codex

From this repository's root:

```sh
bash plugins/datashard/scripts/install-codex.sh https://YOUR-INSTALL/mcp /path/to/project
```

This registers a remote server named `datashard` in your personal Codex configuration
and installs two project skills, `datashard-init` and `save-to-datashard`, in the
project's `.agents/skills/`. The project path defaults to the current directory. If
needed, sign in with `codex mcp login datashard`. Restart Codex, check the connection
with `/mcp`, and run `$datashard-init` at the project root.

You can also register the server without cloning this repository:

```sh
codex mcp add datashard --url https://YOUR-INSTALL/mcp
codex mcp login datashard
```

For each additional project, or if the connection already exists:

```sh
bash plugins/datashard/scripts/install-codex.sh --skills-only /path/to/project
```

`$datashard-init` checks the connection, reads `brief`, reuses or asks for the
project's section, tags and bundle, then creates or updates `DATASHARD.md` and
`AGENTS.md`, preserving existing instructions. It also handles `AGENTS.override.md`
when present, so Codex does not skip the Datashard instructions. Codex discovers the
project skills on its own; restart it if `$datashard-init` is not listed.

Codex also reads this repository as a plugin marketplace
(`codex plugin marketplace add datashard-ai/plugins`). Its `datashard@datashard` plugin
brings only `$datashard-init`, for every project, with no MCP server and no hooks:
the connection still comes from `codex mcp add` or the installer above, and the save
skill from the installer's `--skills-only`.

The installer refuses to replace an existing server, so it cannot silently switch you
to another company's install. It accepts identical existing skills and refuses to
overwrite differing ones: review those before moving them aside for an update. Codex
uses project instructions for install matching and approval; the Claude hooks do not
run in Codex.

To change Codex's address, inspect the connection with `codex mcp get datashard`,
remove it with `codex mcp remove datashard`, rerun the installer with the new address,
and restart Codex.

## Moving from the old marketplace

The marketplace and plugin identifiers stay `datashard` and `datashard@datashard`.
If your registered `datashard` marketplace still points at the old repository, use
`/plugin marketplace list` to check it, remove that marketplace with
`/plugin marketplace remove datashard`, then add `datashard-ai/plugins` and reinstall
`datashard@datashard`. Removing a marketplace can uninstall its plugins; note your
company's endpoint first and configure/sign in again if prompted. Project
DATASHARD.md and knowledge on the server are separate from the marketplace.

Do not add a second manual MCP connection alongside the Claude plugin for the same
install. Inspect duplicate endpoints with `/mcp` before removing a connection.
Existing Codex remote connections can stay; this repository only changes the place
from which the setup skills are installed.

## Optional local memory

[mnem0nic](https://github.com/datashard-ai/mnem0nic) keeps your own sessions and notes
on your Mac. Datashard does not require it, and it never keeps what a Datashard tool
returns. It replaces claude-mem with one native binary that leaves nothing running
when idle, under the same MCP tool names, and imports claude-mem's history. On a Mac
with Apple silicon and a paid Claude or ChatGPT plan:

```sh
curl -fsSL https://raw.githubusercontent.com/datashard-ai/mnem0nic/main/install.sh | sh
mnem0nic install
mnem0nic import-claude-mem    # only when coming from claude-mem
```

Then turn claude-mem off, if you used it, and run `/datashard:init` (or
`$datashard-init`) again: init writes the memory section of `DATASHARD.md` for the
tool you run, and suggests mnem0nic when it finds claude-mem.

References: [Claude marketplaces](https://code.claude.com/docs/en/plugin-marketplaces),
[Codex MCP](https://developers.openai.com/codex/mcp).
