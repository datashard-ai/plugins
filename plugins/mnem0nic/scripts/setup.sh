#!/usr/bin/env bash
set -euo pipefail
usage() {
  echo 'Usage: bash scripts/setup.sh /absolute/path/to/mnem0nic /path/to/project [--codex]'
  echo 'Uses a prebuilt executable; no source download, account or Datashard connection is required.'
}
if [[ ${1:-} == --help || ${1:-} == -h ]]; then usage; exit 0; fi
if [[ $# -lt 2 || $# -gt 3 || ( $# == 3 && $3 != --codex ) ]]; then usage >&2; exit 1; fi
binary=$1
if [[ $binary != /* || ! -f $binary || ! -x $binary ]]; then
  echo 'Provide the absolute path to an executable mnem0nic binary.' >&2; exit 1
fi
project_root=$(cd -- "$2" && pwd -P)
plugin_root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)
source_skill="$plugin_root/skills/mnem0nic"
target="$project_root/.agents/skills/mnem0nic"
if [[ ${3:-} == --codex ]]; then
  for path in "$project_root/.agents" "$project_root/.agents/skills" "$target"; do
    if [[ -L $path ]]; then echo "Refusing skill path through symlink: $path" >&2; exit 1; fi
    if [[ -e $path && ! -d $path ]]; then echo "Not a directory: $path" >&2; exit 1; fi
  done
  if [[ -e $target ]] && ! diff -qr "$source_skill" "$target" >/dev/null 2>&1; then
    echo "Existing skill differs: $target. No project files were changed; preserve or move it before retrying." >&2
    exit 1
  fi
fi
version=$("$binary" --version)
if [[ $version != mnem0nic\ * ]]; then echo 'The executable does not identify itself as mnem0nic.' >&2; exit 1; fi
command -v git >/dev/null || { echo 'Git is required.' >&2; exit 1; }
command -v sqlite3 >/dev/null || { echo 'sqlite3 with FTS5 is required by this preview.' >&2; exit 1; }
sqlite3 -batch -bail -json :memory: 'CREATE VIRTUAL TABLE probe USING fts5(body); SELECT json_valid("{}");' >/dev/null
"$binary" --project "$project_root" init
if [[ ${3:-} == --codex ]]; then
  mkdir -p "$project_root/.agents/skills"
  if [[ ! -e $target ]]; then cp -R "$source_skill" "$target"; fi
fi
echo 'Local memory is ready. Open a new client session to load project instructions.'
echo 'Run ./.project-memory/run resume from the project root. Codex users can also invoke $mnem0nic.'
