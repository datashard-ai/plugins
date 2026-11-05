# Datashard plugins

Installable integrations for **Datashard** team knowledge and **mnem0nic** personal
project memory, for Claude Code, Codex and Cursor.

| Integration | What it does | Availability |
| --- | --- | --- |
| [Datashard](plugins/datashard/README.md) | Connects to your company's hosted knowledge base through MCP | Requires a Datashard install and sign-in |
| [mnem0nic](plugins/mnem0nic/README.md) | Saves and restores local project checkpoints | Preview: requires a separately supplied executable |

They work independently. mnem0nic does not require a Datashard account. Installing
both keeps personal notes separate from approved team knowledge; it does not
upload checkpoints or turn them into approved facts.

## Claude Code

Add this marketplace from inside Claude Code:

```text
/plugin marketplace add datashard-ai/plugins
/plugin install datashard@datashard
```

Set your company's Datashard address when prompted. Then:

1. Restart Claude Code.
2. Sign in to the Datashard connection with `/mcp`.
3. Run `/datashard:init` in each project you want to use Datashard in.

`/datashard:init` is the step that sets a project up: it creates the project's
`DATASHARD.md` and its instructions, with the section and tags you choose, and the
save check compares every save with the install that file names. Run it once per
project. See the [Datashard setup guide](plugins/datashard/README.md) for CLI
installation, changing the address and migration.

For the local memory preview, install `mnem0nic@datashard` from the same marketplace
and follow its [setup guide](plugins/mnem0nic/README.md). Installing the plugin does
not download the executable; public binary downloads are not available yet.

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

For mnem0nic, with a prebuilt executable supplied by its maintainer:

```sh
bash plugins/mnem0nic/scripts/setup.sh /absolute/path/to/mnem0nic /path/to/project --codex
```

Open a new Codex session and use `$mnem0nic`. Rust is not required on the user's
machine; this CLI preview requires Git and sqlite3 with FTS5. See the
[mnem0nic guide](plugins/mnem0nic/README.md) for limits and handoff testing.

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

`mnem0nic` is in that marketplace too. It is the same skill; the executable is
still supplied separately. See the [Datashard setup guide](plugins/datashard/README.md).

## What is distributed

This repository contains readable integration manifests, skills, setup scripts and
client hooks. It does **not** contain the Datashard server implementation, mnem0nic
Rust source, customer knowledge, credentials or personal databases. A GitHub source
archive of this repository contains only those integration files.

Compiled mnem0nic downloads will be published separately from its private source.
A compiled executable avoids distributing source, but is not protection against
reverse engineering. This is not an open-source release of either product.

The current mnem0nic package uses shell commands. A local MCP interface and a
combined connection with optional Datashard are future work, not shipped features.

## Package checks

Maintainers can run `node --test tests/*.test.mjs` with Node 22 or newer. Tests use
isolated temporary directories and do not change personal client configuration.
Run `claude plugin validate .` and validate each `plugins/*` directory when the
Claude CLI is available. CI runs both on every pull request and push to `main`, and
checks that each changed package's version went up. [MAINTAINING.md](MAINTAINING.md)
describes the publication boundary, releasing, and migration from the older marketplace.

## Licence

[LICENSE.md](LICENSE.md): proprietary, readable and installable, not open source.
