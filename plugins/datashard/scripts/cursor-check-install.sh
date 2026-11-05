#!/usr/bin/env bash
# Runs before every Cursor MCP call, whichever server it is for. A call that does not name datashard anywhere is
# allowed here, so it never needs Node. One that does is checked by cursor-check-install.mjs, which needs `node`:
# without it, or if it fails, the plugin asks instead of staying silent. The answer is Cursor's permission JSON.
set -u -o pipefail

ask() {
  printf '{"permission":"ask","user_message":"%s","agent_message":"%s"}\n' "$1" "$1"
  exit 0
}

input=$(cat) || input=''
case $input in
  *datashard*) ;;
  *)
    printf '%s\n' '{"permission":"allow"}'
    exit 0
    ;;
esac

command -v node >/dev/null 2>&1 ||
  ask "The Datashard plugin could not check which install this save belongs to, because node is not on PATH. Install Node.js, or save only if this project belongs to the install the plugin connects to."
here=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd) ||
  ask "The Datashard plugin could not find its check. Save only if this project belongs to the install the plugin connects to."
[ -f "$here/cursor-check-install.mjs" ] ||
  ask "The Datashard plugin file scripts/cursor-check-install.mjs is missing. Reinstall the plugin, or save only if this project belongs to the install it connects to."
out=$(printf '%s' "$input" | node "$here/cursor-check-install.mjs") && [ -n "$out" ] ||
  ask "The Datashard plugin could not check which install this save belongs to. Save only if this project belongs to the install the plugin connects to."
printf '%s\n' "$out"
