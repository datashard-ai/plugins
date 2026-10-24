#!/usr/bin/env bash
set -euo pipefail

usage() {
  echo 'Usage: bash scripts/install-codex.sh https://<your-install>/mcp [project-root]'
  echo '       bash scripts/install-codex.sh --skills-only [project-root]'
  echo 'The project root defaults to the current directory.'
}

if [[ ${1:-} == --help || ${1:-} == -h ]]; then
  usage
  exit 0
fi
if [[ $# -lt 1 || $# -gt 2 ]]; then
  usage >&2
  exit 1
fi

# Accept only an HTTPS install endpoint, without credentials, query, or fragment.
if [[ $1 != --skills-only && ! $1 =~ ^https://[A-Za-z0-9.-]+(:[0-9]+)?/mcp/?$ ]]; then
  echo 'Give your Datashard HTTPS address, ending in /mcp (without credentials, query, or fragment).' >&2
  exit 1
fi
if [[ $1 != --skills-only ]] && ! command -v codex >/dev/null 2>&1; then
  echo 'Install the Codex CLI first, then run this command again.' >&2
  exit 1
fi

plugin_root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
project_root=$(cd -- "${2:-$PWD}" && pwd)
skills_root="$project_root/.agents/skills"
skill_names=(datashard-init save-to-datashard)
skill_sources=("$plugin_root/codex/skills/datashard-init" "$plugin_root/skills/save-to-datashard")

# Keep project-scoped installation inside the selected project.
for path in "$project_root/.agents" "$skills_root"; do
  if [[ -L $path || ( -e $path && ! -d $path ) ]]; then
    echo "Refusing a symlink or non-directory skills parent: $path. No configuration was changed." >&2
    exit 1
  fi
done

# Preflight both skills before changing the connection or copying either one.
for index in 0 1; do
  target="$skills_root/${skill_names[$index]}"
  if [[ ! -f ${skill_sources[$index]}/SKILL.md ]]; then
    echo "Missing bundled skill: ${skill_sources[$index]}/SKILL.md" >&2
    exit 1
  fi
  if [[ -L $target ]] || { [[ -e $target ]] && ! diff -qr "${skill_sources[$index]}" "$target" >/dev/null 2>&1; }; then
    echo "Existing skill differs: $target. No files or MCP settings were changed." >&2
    echo 'Review and move that skill aside before reinstalling; local changes are never overwritten.' >&2
    exit 1
  fi
done

# A second install must never silently replace another company's connection.
if [[ $1 != --skills-only ]] && codex mcp get datashard >/dev/null 2>&1; then
  echo 'A Codex MCP server named datashard already exists. No configuration was changed.' >&2
  echo 'Inspect it with: codex mcp get datashard' >&2
  echo 'To sign in to it, run: codex mcp login datashard' >&2
  echo 'To replace it deliberately, run: codex mcp remove datashard; then rerun this installer.' >&2
  echo 'To install project skills without changing the connection, rerun with --skills-only [project-root].' >&2
  exit 1
fi

# Codex owns config.toml and the OAuth browser flow; do not write credentials here.
if [[ $1 != --skills-only ]]; then
  codex mcp add datashard --url "$1"
  echo 'Datashard was added to Codex. If sign-in is still needed, run: codex mcp login datashard'
fi
mkdir -p "$skills_root"
for index in 0 1; do
  target="$skills_root/${skill_names[$index]}"
  if [[ ! -e $target ]]; then
    cp -R "${skill_sources[$index]}" "$target"
  fi
done
printf 'Datashard skills installed in %s\n' "$skills_root"
echo 'Open Codex at the project root and run $datashard-init. Restart Codex if the skill is not listed.'
