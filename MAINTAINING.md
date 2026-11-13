# Maintaining the distribution

Only client integration files belong here. Keep product implementations in their
private repositories. Build release executables privately, review the artifacts,
then distribute only the selected binaries with checksums and required third-party
notices. Do not attach private source archives, debug symbols containing private
paths, build logs, credentials or personal databases.

The GitHub-generated source archives for this repository contain integration files;
they must never include product implementation. The package tests enforce a narrow
file allowlist. Adding a new distribution component requires reviewing that allowlist.
Public skill instructions and shell glue are readable by installers. This repository
is public, so everything in it is: no client names, internal paths or private decision
numbers.

The Datashard package starts at 0.26.0 in this new marketplace. Both its plugin name
and marketplace name remain datashard to preserve client tool naming. The original
repository is not transferred or deleted by this change. Do not point an old
single-package publishing script at this multi-package repository: such a script
could erase its other packages.

## Releasing

`main` is where changes are merged, not what people get. The marketplace pins each
package to an exact commit of this repository (`source` in
`.claude-plugin/marketplace.json`, with `"source": "git-subdir"` and the commit's
`sha`), so a merge to `main` reaches nobody until a pull request moves the pin. People
get a change when that pull request merges, at least 7 days after the change itself
merged, or sooner for an urgent fix with its reason in an `Urgent:` line of the pull
request description. Only the maintainer, a person and never an agent, writes an
`Urgent:` line.

`node tests/pin.mjs move` opens that pull request, from a clone of this repository: it
picks the newest commit on `main` whose pull request merged at least 7 days ago (or the
commit given with `--sha`, which needs `--urgent "<reason>"` if it is younger) and lists
in the description the commits and the guarded files it brings, and any commit that
reached `main` without a merged pull request. It commits with your own git
configuration (your name, email and signing setting) and opens the pull request as
your `gh` account. It refuses unless GitHub requires pull requests into `main` that no
user, team or app may bypass, requires the `packages` and `pin-from-main` checks on a
branch that is up to date, each reported by the GitHub Actions app, refuses force
pushes, and holds administrators to all of it, and unless the repository it works in is
`datashard-ai/plugins`. `pin-from-main` is made required on `main` right after it
merged; `move` refuses until it is. An administrator can still switch that protection
off, which nothing in this repository can stop.

CI (`node tests/pin.mjs check`) fails a pull request that pins a commit that is not on
`main`, has not waited and has no `Urgent:` line (read from the description as it is
when the check runs), or holds a lower package version than the commit it replaces
(for the first pin, than `main` has now). It also fails a marketplace file that holds
anything but each entry's name, description and pin and the file's own name, owner,
description and plugins, since anything else would reach people with no pin and no
wait; packages pinned to different commits; and a pull request that moves a pin and
changes anything besides the `sha` values in `.claude-plugin/marketplace.json`. The
`packages` check runs the pull request's own copy of `tests/pin.mjs`; the
`pin-from-main` check (`.github/workflows/pin-from-main.yml`, on `pull_request_target`)
runs `main`'s copy of the pin check against the pull request's files, which it reads
with git as data and never checks out or runs, so a change to `tests/pin.mjs` in a pull
request does not change how that check judges the pull request. A change to the check
itself takes effect only after it merges, and is reviewed as a guarded file before that.
One gap is left: GitHub matches a required check by its name, so a pull request that
adds or changes a workflow could report a check called `pin-from-main` itself. Whether
that can satisfy the requirement is being tested; until then such a pull request (a
guarded file) is held by the maintainer's review, as before. After a merge, CI checks
`main` again (`node tests/pin.mjs check --after-merge`) for the file's shape, the pin
being on `main`, versions, one commit for all packages and changes to nothing but the
pins. It does not look at the age, so it can't tell an early pin merged on purpose from
one merged by mistake; the job summary shows every pin change.

All packages are pinned to one commit. To add a package, move the pin first (to a
commit that has the package), then add the new entry pinned to that same commit.

People get a package's change only when its version goes up, so a pull request that
changes anything under `plugins/<name>/` raises that package's `version` in its
`.claude-plugin/plugin.json` above its base branch's, as x.y.z (CI checks each
package on its own). Before merging, update the branch with `main`, so CI compares
the version with what has merged since: `main` requires a pull request and the
`packages` check on a branch that is up to date, and refuses force pushes. After each
push to `main`, CI also marks any open pull request whose version `main` has caught up
with, so a stale one shows it before anyone tries to merge it; if the check fails on
`main` itself, raise the version in a new pull request.

A person approves every pull request that changes a guarded file: everything except
the READMEs, MAINTAINING.md and LICENSE.md, since the rest runs on people's machines,
tells the model what to do, or is the check itself (`tests/guarded.mjs`). CI labels
such a pull request `runs-on-machines` (and takes the label off again if no guarded
file is left in it), and `.github/CODEOWNERS` names the person. An agent may open such
a pull request, never approve or merge it. Approving means the maintainer reads the
pull request and merges it personally. GitHub cannot tell that apart from an agent
merging with the same sign-in, so it is this rule.

During the wait, the maintainer runs `main` from a local checkout, so a new commit is
used by someone before everyone gets it: update the checkout (`git switch main`, then
`git pull`) and start Claude Code with the package loaded from it, which is for that
session only:

```sh
claude --plugin-dir /path/to/checkout/plugins/datashard
```

`claude --plugin-dir /path/to/checkout/plugins/datashard plugin details datashard`
lists that copy (its source reads `datashard@inline`). Add the flag again with
`plugins/mnem0nic` for the other package. A marketplace added from the checkout would
not do: its entries are the same pins, so it installs the pinned commits from GitHub,
not the checkout, and `claude plugin marketplace add` has no option to give it another
name.

To undo a bad pin, revert the change on `main` with a higher version (a lower version
fails the check, so the pin cannot go back to an older commit), then pin that commit
with an `Urgent:` line.

Claude Code 2.1.323 and Codex 0.164.0 install a pinned commit; older versions have not
been checked.

Everyone gets the same Datashard package, whatever Datashard release their install
runs, so it must keep working with every release still deployed.

Codex reads the same root `.claude-plugin/marketplace.json`, so it installs the same
pinned commit (checked with Codex 0.164.0: it installs the pin, keeps it on `update`
while `main` moves, and follows a moved pin). Where a package has a
`.codex-plugin/plugin.json`, Codex uses it in place of `.claude-plugin/plugin.json`:
keep both at the same version (the tests check). Without one, Codex loads the Claude
package as it is, including its `.mcp.json` and `hooks/hooks.json`. The Datashard
Codex manifest points at its own skills, `codex/mcp.json`, and `codex/hooks.json`.
Codex does not fill in Claude's `${user_config.datashard_url}`. The address it uses
is the `datashard` server in the person's Codex configuration, which replaces the
placeholder in `codex/mcp.json`. Keep that placeholder on `example.invalid`: a
company address does not belong in the package.

The Datashard package's `templates/DATASHARD.md` and `skills/save-to-datashard/` are
copies of Datashard's own agent templates, which its source keeps for agents set up
by hand. Change both in the same piece of work; `codex/skills/datashard-init/assets/DATASHARD.md`
must equal `templates/DATASHARD.md`, and both `cursor/skills/save-to-datashard/` and
`codex/skills/save-to-datashard/` must equal `skills/save-to-datashard/` (the tests check).

The Datashard package's `skills/review-with-datashard/` is its one Python component:
`ai_review.py`, standard library only, with its `prompt.md` and `schema.json`. It is Claude
Code only (the skill starts an agent and the script calls the `claude` command), so neither
the Codex nor the Cursor package carries it. `tests/test_ai_review.py` tests it; CI runs it
with `PYTHONDONTWRITEBYTECODE=1`, since a `__pycache__` under `plugins/` fails the allowlist
test. The skill finds its script through the "Base directory for this skill" that Claude
Code prints when it loads, so keep it free of paths from any one workspace.

Cursor reads a root `.cursor-plugin/marketplace.json` before the Claude marketplace.
That file still names the packages by path, so Cursor follows `main`: whether Cursor
honours a pin has not been checked. Each package's `.cursor-plugin/plugin.json` is
what Cursor loads: keep it at the same version as `.claude-plugin/plugin.json` and
`.codex-plugin/plugin.json` (the tests check). The Datashard Cursor manifest points
at its own MCP file, skills, rule and hooks, so Cursor does not fill in Claude's
`${user_config.datashard_url}` or run Claude's `hooks/hooks.json`.

No hosted MCP connection, account, endpoint or access permission is changed merely
by publishing this repository. Existing installs need the documented marketplace
migration. The mnem0nic preview ships no executable or MCP entry; add those only
when the corresponding release and protocol implementation have been validated.

Before publishing, run the package tests and review the complete Git file list.
Ensure GitHub repository visibility matches the intended distribution audience;
people can install only if they can read the repository. The repository is under
[LICENSE.md](LICENSE.md): proprietary, readable and installable, not open source.

This is an independently hosted marketplace, not an Anthropic directory submission.
The directory validator also reports missing licensing metadata, listing icons and
Datashard privacy-policy metadata. Resolve those before submitting to that directory;
ordinary manifest validation does not certify directory eligibility. No product
licensing terms have been invented as part of this packaging change.
