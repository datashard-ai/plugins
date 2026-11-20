# Datashard plugins

Installable integrations for **Datashard** team knowledge, for Claude Code, Codex and
Cursor, and for **mnem0nic** personal session memory, for Claude Code and Codex.

| Integration | What it does | Availability |
| --- | --- | --- |
| [Datashard](plugins/datashard/README.md) | Connects to your company's hosted knowledge base through MCP | Requires a Datashard install and sign-in |
| [mnem0nic](plugins/mnem0nic/README.md) | Remembers your own Claude Code and Codex sessions on your Mac, with search and checkpoints | Requires the mnem0nic program, installed with its own installer (Mac with Apple silicon, paid Claude or ChatGPT plan) |

They work independently. mnem0nic does not require a Datashard account. Installing
both keeps personal notes separate from approved team knowledge: mnem0nic never stores
what a Datashard tool returns, and it does not upload checkpoints or turn them into
approved facts.

## Claude Code

Add this marketplace from inside Claude Code:

```text
/plugin marketplace add datashard-ai/plugins
/plugin install datashard@datashard
```

The marketplace installs a reviewed, pinned commit of this repository, so in Claude
Code and Codex a change reaches people about a week after it merges. Cursor still
follows `main`.

Set your company's Datashard address when prompted. Then:

1. Restart Claude Code.
2. Sign in to the Datashard connection with `/mcp`.
3. Run `/datashard:init` in each project you want to use Datashard in.

`/datashard:init` is the step that sets a project up: it creates the project's
`DATASHARD.md` and its instructions, with the section and tags you choose, and the
save check compares every save with the install that file names. Run it once per
project. See the [Datashard setup guide](plugins/datashard/README.md) for CLI
installation, changing the address and migration.

For personal memory, install the mnem0nic program from its own installer, in a
terminal, then restart Claude Code:

```sh
curl -fsSL https://raw.githubusercontent.com/datashard-ai/mnem0nic/main/install.sh | sh
mnem0nic install
```

`mnem0nic install` adds mnem0nic's hooks and MCP server to Claude Code and Codex. The
`mnem0nic@datashard` plugin from the same marketplace adds the skill that tells the
agent how to use it; it does not install the program. See its
[guide](plugins/mnem0nic/README.md).

## Codex

Add this repository as a Codex marketplace, install the plugin, and register your
company's address. Codex uses that registered server in place of the plugin's
placeholder:

```sh
codex plugin marketplace add datashard-ai/plugins
codex plugin add datashard@datashard
codex mcp add datashard --url https://YOUR-INSTALL/mcp
codex mcp login datashard
```

Open a new Codex session, trust the plugin's save check in `/hooks`, and run
`$datashard-init`. From a checkout, the installer registers the same address and
copies both skills into the project's `.agents/skills/`:

```sh
git clone https://github.com/datashard-ai/plugins.git
cd plugins
bash plugins/datashard/scripts/install-codex.sh https://YOUR-INSTALL/mcp /path/to/project
```

For an already registered Datashard connection, use `--skills-only` in place of the
address.

For mnem0nic, install the program from its own installer (the two commands under
Claude Code above), which registers its hooks and MCP server for Codex too, then
restart Codex. The skill is optional:

```sh
codex plugin add mnem0nic@datashard
```

See the [mnem0nic guide](plugins/mnem0nic/README.md).

## Cursor

Cursor reads `.cursor-plugin/marketplace.json` in this repository. In Cursor's
marketplace search, add `https://github.com/datashard-ai/plugins`, or from chat:

```text
/plugin marketplace add datashard-ai/plugins
```

Install `datashard`. Set the **Datashard address** to your company's HTTPS address
ending in `/mcp`, reload Cursor, sign in to the Datashard MCP server, and run
`/datashard-init` in the project. Teams can import the same repository from
Dashboard → Plugins & MCPs.

`mnem0nic` is in that marketplace too, as a skill only: the program records Claude
Code and Codex sessions, not Cursor's, so in Cursor the skill reads what those
recorded through the `mnem0nic` command. See the
[mnem0nic guide](plugins/mnem0nic/README.md) and the
[Datashard setup guide](plugins/datashard/README.md).

## What is distributed

This repository contains readable integration manifests, skills, setup scripts and
client hooks. It does **not** contain the Datashard server implementation, mnem0nic
Rust source, customer knowledge, credentials or personal databases. A GitHub source
archive of this repository contains only those integration files.

The compiled mnem0nic program is published separately, from its private source, at
[datashard-ai/mnem0nic](https://github.com/datashard-ai/mnem0nic), with its own
installer and licence. A compiled executable avoids distributing source, but is not
protection against reverse engineering. This is not an open-source release of either
product.

The mnem0nic package here is a skill and its manifests. The MCP server and the hooks
belong to the program and are registered by its installer, so the package has no MCP
entry or hooks of its own.

## Package checks

Maintainers can run `node --test tests/*.test.mjs` with Node 22 or newer. Tests use
isolated temporary directories and do not change personal client configuration.
Run `claude plugin validate .` and validate each `plugins/*` directory when the
Claude CLI is available. CI runs both on every pull request and push to `main`, and
checks that each changed package's version went up. [MAINTAINING.md](MAINTAINING.md)
describes the publication boundary, releasing, and migration from the older marketplace.

## Licence

[LICENSE.md](LICENSE.md): proprietary, readable and installable, not open source.
