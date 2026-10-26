#!/usr/bin/env bash
# Runs before a Cursor MCP call. save and flag on the Datashard server are checked by check-install.sh
# against the project's DATASHARD.md. Any other call is allowed. The answer is Cursor's permission JSON.
set -u -o pipefail

allow() {
  printf '%s\n' '{"permission":"allow"}'
  exit 0
}
ask() {
  printf '%s\n' '{"permission":"ask","user_message":"The Datashard plugin could not check which install this save belongs to. Save only if this project belongs to the install the plugin connects to.","agent_message":"The Datashard plugin could not check which install this save belongs to. Save only if this project belongs to the install the plugin connects to."}'
  exit 0
}

input=$(cat) || allow
[ -n "$input" ] || allow
flat=$(printf '%s' "$input" | tr '\n\r' '  ') || allow

# The last JSON string for a key. A value may contain \" and \\, which a Datashard address does not.
json_string() {
  printf '%s' "$flat" | grep -oE '"'"$1"'"[[:space:]]*:[[:space:]]*"([^"\\]|\\.)*"' |
    sed -n '$s/.*"\([^"]*\)"$/\1/p'
}

tool=$(json_string tool_name) || true
server=$(json_string mcp_server_name) || true
url=$(json_string mcp_server_url) || true
[ -n "$url" ] || url=$(json_string url) || true
root=$(printf '%s' "$flat" | grep -oE '"workspace_roots"[[:space:]]*:[[:space:]]*\[[[:space:]]*"([^"\\]|\\.)*"' |
  sed -n '$s/.*"\([^"]*\)"$/\1/p') || true
[ -n "$root" ] || root=$(json_string cwd) || true

case $server in
  *datashard*) ;;
  *)
    case $tool in
      *datashard*) ;;
      *) allow ;;
    esac
    ;;
esac
case $tool in
  save|flag|MCP:save|MCP:flag|*__save|*__flag) ;;
  *) allow ;;
esac

# Cursor leaves an unfilled ${DATASHARD_URL} in the address. Treat that as no address.
case $url in
  *'${'*) url="" ;;
esac
url=${url//\\\//\/}

[ -n "$root" ] || ask
root=${root//\\\//\/}

plugin_root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd) || ask
out=$(CLAUDE_PROJECT_DIR="$root" CLAUDE_PLUGIN_OPTION_DATASHARD_URL="$url" /bin/bash "$plugin_root/scripts/check-install.sh" </dev/null) || ask
[ -n "$out" ] || allow

decision=$(printf '%s' "$out" | sed -n -E 's/.*"permissionDecision"[[:space:]]*:[[:space:]]*"([^"]*)".*/\1/p' | sed -n '1p') || ask
reason=$(printf '%s' "$out" | sed -n -E 's/.*"permissionDecisionReason"[[:space:]]*:[[:space:]]*"(.*)"\}\}.*/\1/p' | sed -n '1p') || ask
case $decision in
  allow|deny|ask) ;;
  *) ask ;;
esac
[ -n "$reason" ] || ask
# check-install.sh speaks to Claude Code. The same decision, in Cursor's words.
reason=${reason//Claude Code/Cursor}
reason=${reason//\/datashard:init/\/datashard-init}
reason=${reason//\/config/the Datashard address setting}
printf '{"permission":"%s","user_message":"%s","agent_message":"%s"}\n' "$decision" "$reason" "$reason"
exit 0
