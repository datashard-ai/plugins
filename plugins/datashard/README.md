# Datashard integration

Connect Claude Code, Codex or Cursor to your company's Datashard MCP endpoint. This package
contains client setup, skills and the save checks for each client; the hosted server is not
included. Your company supplies an HTTPS address ending in `/mcp` and account access.

## Claude Code

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
marketplace under Marketplaces in `/plugin`.

### Reviewing a change

`/datashard:review-with-datashard` checks a branch or pull request before you merge it.
Claude Code starts an independent review agent in the background, so your session goes
on working. The agent runs an AI review of the diff, then checks the change against what
Datashard records: decisions and contracts it contradicts, private detail it would
publish, facts it makes stale. It changes nothing and approves nothing; you decide.

It needs a recent Claude Code with the `claude` command on your PATH, Python 3.10 or
later and `git`. The GitHub CLI (`gh`), signed in, is needed only to read the pull
request and its checks: without it the review still runs, with the base branch assumed
(origin's default) and the pull request's text unchecked, and the report says so.
The AI review stops the `claude` command after 15 minutes and then counts as not run;
the script's `--timeout <seconds>` changes that.
The Datashard part uses the plugin's `datashard` server, signed in through `/mcp`; if
that is missing, the report says the Datashard part did not run, which is not a pass.
The AI review sends the diff to a model through your own `claude` command. Claude Code
only: Codex and Cursor installs do not get this skill.

## Codex

Codex reads this repository as a plugin marketplace. From the Codex CLI:

```sh
codex plugin marketplace add datashard-ai/plugins
codex plugin add datashard@datashard
codex mcp add datashard --url https://YOUR-INSTALL/mcp
codex mcp login datashard
```

The plugin brings `$datashard-init`, `save-to-datashard`, an HTTP server named
`datashard`, and a hook that checks `save` and `flag` against the project's
`DATASHARD.md`. Codex has no install prompt for the company address. The server
registered with `codex mcp add` is the one it uses: a server of that name in your
Codex configuration replaces the placeholder shipped in the plugin
(`https://example.invalid/mcp`). Keep an existing `datashard` server. Removing it
leaves the placeholder.

Restart Codex, check the connection with `/mcp`, and run `$datashard-init` at the
project root. Open `/hooks` and trust the plugin's save check. Until that hook is
trusted, the `AGENTS.md` instructions `$datashard-init` writes are what stop a save
to a different install. Codex does not stop a tool when a hook only asks, so the
check denies a save it cannot match.

The same address and the two project skills can be installed from a checkout:

```sh
bash plugins/datashard/scripts/install-codex.sh https://YOUR-INSTALL/mcp /path/to/project
```

This registers the remote server when that name is free, and copies
`datashard-init` and `save-to-datashard` into the project's `.agents/skills/`.
The project path defaults to the current directory. For another project, or when
the connection already exists:

```sh
bash plugins/datashard/scripts/install-codex.sh --skills-only /path/to/project
```

`$datashard-init` checks the connection, reads `brief`, reuses or asks for the
project's section, tags and bundle, then creates or updates `DATASHARD.md` and
`AGENTS.md`, preserving existing instructions. It also handles `AGENTS.override.md`
when present, so Codex does not skip the Datashard instructions. Restart Codex if
`$datashard-init` is not listed.

The installer refuses to replace an existing server, so it cannot silently switch you
to another company's install. It accepts identical existing skills and refuses to
overwrite differing ones: review those before moving them aside for an update.

To change Codex's address, inspect the connection with `codex mcp get datashard`,
remove it with `codex mcp remove datashard`, register the new address, and restart
Codex.

## Cursor

Cursor loads `.cursor-plugin/plugin.json` from this package, not the Claude manifest.
In Cursor's marketplace search, add `https://github.com/datashard-ai/plugins`, or
from chat:

```text
/plugin marketplace add datashard-ai/plugins
```

Install `datashard`. When Cursor asks for the Datashard address, enter the company's
HTTPS address ending in `/mcp`. Reload Cursor, sign in to the Datashard MCP server
from Customize, and run `/datashard-init` in the project.

The plugin connects to that address, brings `datashard-init` and `save-to-datashard`,
and checks `save` and `flag` against the project's `DATASHARD.md` before they run.
That check runs in the Cursor desktop app. A cloud agent does not run the plugin's
MCP hook, so the `AGENTS.md` instructions `/datashard-init` writes tell it to compare
the address itself.

Change the address in the plugin's **Datashard address** setting, then reload Cursor
before saving: the server keeps the old address until then.

Do not add a second manual MCP server named `datashard` next to the plugin. Teams
can import `https://github.com/datashard-ai/plugins` from Dashboard → Plugins & MCPs.

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
An existing Codex server named `datashard` is the address the Codex plugin uses.
Leave it in place.

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
[Codex MCP](https://developers.openai.com/codex/mcp),
[Cursor plugins](https://cursor.com/docs/plugins).
