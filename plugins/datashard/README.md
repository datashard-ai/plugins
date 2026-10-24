# Datashard integration

Connect Claude Code or Codex to your company's Datashard MCP endpoint. This package
contains client setup, skills and Claude permission hooks; the hosted server is not
included. Your company supplies an HTTPS address ending in `/mcp` and account access.

## Claude Code

Inside Claude Code:

```text
/plugin marketplace add datashard-ai/plugins
/plugin install datashard@datashard
```

Enter your company's address when prompted. Restart Claude Code, sign in to the
Datashard connection using `/mcp`, and run `/datashard:init` for each project.
For a CLI supporting install-time configuration:

```sh
claude plugin install datashard --marketplace datashard-ai/plugins --config datashard_url=https://YOUR-INSTALL/mcp
```

Change the address with `/plugin configure datashard@datashard`, then restart.
The init skill creates DATASHARD.md and project instructions with your chosen
section/tags. Saves require approval of the exact fact text. Claude hooks check
that saves go to the endpoint named by the project.

## Codex

From this repository's root:

```sh
bash plugins/datashard/scripts/install-codex.sh https://YOUR-INSTALL/mcp /path/to/project
```

This registers a remote server named `datashard` in your personal Codex configuration
and installs two project skills. If needed, sign in with `codex mcp login datashard`.
Restart Codex and run `$datashard-init` at the project root.

If the connection already exists:

```sh
bash plugins/datashard/scripts/install-codex.sh --skills-only /path/to/project
```

The installer refuses to replace an existing server or overwrite differing skills.
Review existing skills before moving them aside for an update. Codex uses project
instructions for install matching and approval; the Claude hooks do not run in Codex.

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

Install mnem0nic separately if you want personal checkpoints. Datashard does not
require it, and enabling it does not copy company fact bodies into local memory.

References: [Claude marketplaces](https://code.claude.com/docs/en/plugin-marketplaces),
[Codex MCP](https://developers.openai.com/codex/mcp).
