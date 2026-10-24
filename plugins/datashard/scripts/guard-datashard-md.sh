#!/usr/bin/env bash
# Runs before Claude edits or writes a file (ADR 0036). A DATASHARD.md's Install line decides which install the
# plugin may save the project's knowledge to, so a change by Claude to any DATASHARD.md asks the person first, even
# where edits are otherwise allowed; so does a change to Claude Code's settings or plugin files, which could turn
# these checks off or change the plugin's address. A change made through a shell command is not seen here.
set -u -o pipefail

about_datashard_md="DATASHARD.md names the Datashard install this project saves to, in its Install line: make sure this change is one you asked for."
about_settings="This changes Claude Code's settings, plugins or MCP servers, which decide where Datashard saves go and whether they are checked: make sure this change is one you asked for."
ask() {
  printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"ask","permissionDecisionReason":"%s"}}\n' \
    "${1:-$about_datashard_md}"
  exit 0
}
# If the file being changed can't be told, ask rather than let a change to DATASHARD.md through.
trap ask ERR

# Every "file_path" (or a notebook's "notebook_path") key in the hook's input. A quote inside a JSON string is
# escaped, so text inside the content being written can't pass for one.
paths=$(grep -oE '"(file|notebook)_path"[[:space:]]*:[[:space:]]*"([^"\\]|\\.)*"') || [ $? -eq 1 ] || ask
# Every tool this runs for names its file; one that doesn't can't be told apart from a change to DATASHARD.md.
[ -n "$paths" ] || ask

# The ERR trap doesn't reach inside the functions below (set -E would make a failure inside $(...) print the answer
# into a variable instead), so each treats a failing command as a file to ask about.

named() {
  local name=${1##*/} lower
  name=${name##*\\}
  lower=$(printf '%s' "$name" | tr '[:upper:]' '[:lower:]') || return 0
  [ "$lower" = "datashard.md" ]
}

# The DATASHARD.md the save check reads: the nearest at or above the project's folder, which Claude Code names.
[ -n "${CLAUDE_PROJECT_DIR:-}" ] || ask
project_md=""
dir=$(CDPATH='' cd "$CLAUDE_PROJECT_DIR" 2>/dev/null && pwd) || dir=""
while [ -n "$dir" ]; do
  if [ -f "$dir/DATASHARD.md" ]; then
    project_md="$dir/DATASHARD.md"
    break
  fi
  parent=$(dirname "$dir")
  [ "$parent" = "$dir" ] && break
  dir=$parent
done

# Whether a path is one of Claude Code's settings, plugin or MCP server files, under any spelling (macOS ignores case)
# and through linked folders.
settings() {
  local path=$1 follow=${2:-follow} real lower config
  # A symlinked file counts as what it points at, one link deep: guarded() below follows longer chains and loops.
  if [ "$follow" = follow ] && [ -L "$path" ]; then
    real=$(readlink "$path") || return 0
    case $real in /*) ;; *) real=$(dirname "$path")/$real ;; esac
    settings "$real" no && return 0
  fi
  real=$(CDPATH='' cd "$(dirname "$path")" 2>/dev/null && pwd -P)/${path##*/} || real=$path
  config=$(printf '%s' "${CLAUDE_CONFIG_DIR:-}" | tr '[:upper:]' '[:lower:]') || return 0
  for candidate in "$path" "$real"; do
    lower=$(printf '%s' "$candidate" | tr '[:upper:]' '[:lower:]') || return 0
    # Windows separators, doubled by JSON's escaping, read as one /; then . and .. are worked out from the text, for
    # folders that don't exist yet.
    lower=${lower//\\//}
    while [[ $lower == *//* ]]; do lower=${lower//\/\//\/}; done
    while [[ $lower == */./* ]]; do lower=${lower//\/.\//\/}; done
    while [[ $lower =~ ^(.*)/[^/]+/\.\./(.*)$ ]]; do lower="${BASH_REMATCH[1]}/${BASH_REMATCH[2]}"; done
    case $lower in
      */.claude/settings.json | */.claude/settings.local.json | */.claude/plugins/* | */.claude/hooks/*) return 0 ;;
      */.claude.json | */.mcp.json) return 0 ;;
    esac
    if [ -n "$config" ]; then case $lower in "${config%/}"/*) return 0 ;; esac; fi
  done
  return 1
}

# Whether changing this path changes a DATASHARD.md: by its name, as the same file under another name (a hard link
# or a symlink, which -ef sees through), or through symlinks followed one by one, even to one that doesn't exist yet.
guarded() {
  local path=$1 hops=0 target beside
  named "$path" && return 0
  beside="$(dirname "$path")/DATASHARD.md"
  [ -e "$path" ] && [ -n "$project_md" ] && [ "$path" -ef "$project_md" ] && return 0
  [ -e "$path" ] && [ -e "$beside" ] && [ "$path" -ef "$beside" ] && return 0
  while [ -L "$path" ]; do
    hops=$((hops + 1))
    [ "$hops" -le 16 ] || return 0
    target=$(readlink "$path") || return 0
    case $target in /*) path=$target ;; *) path=$(dirname "$path")/$target ;; esac
    named "$path" && return 0
  done
  return 1
}

while IFS= read -r line; do
  [ -n "$line" ] || continue
  path=${line#*:}
  path=${path#*\"}
  path=${path%\"}
  if settings "$path"; then ask "$about_settings"; fi
  if guarded "$path"; then ask; fi
done <<<"$paths"
exit 0
