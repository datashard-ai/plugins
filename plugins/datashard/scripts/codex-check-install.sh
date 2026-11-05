#!/usr/bin/env bash
# Runs before a Codex save or flag on the Datashard server. The address Codex actually uses is the
# datashard server in its config, which replaces the plugin's placeholder. check-install.sh compares
# that address with the project's DATASHARD.md. Codex does not stop a tool when a hook asks, so a
# save this check cannot clear is denied. Any other tool is left alone.
set -u -o pipefail

allow() { exit 0; }

deny() {
  printf '%s\n' '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"The Datashard plugin could not check which install this save belongs to. Save only if this project belongs to the install Codex connects to."}}'
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
case $tool in
  mcp__datashard__save|mcp__datashard__flag|mcp__plugin_datashard_datashard__save|mcp__plugin_datashard_datashard__flag|*__datashard__save|*__datashard__flag) ;;
  *) allow ;;
esac

root=$(json_string cwd) || true
root=${root//\\\//\/}

# The first url in [mcp_servers.datashard]. The file is data: it is not executed.
codex_home=${CODEX_HOME:-${HOME:-}/.codex}
plugin_address=""
if [ -f "$codex_home/config.toml" ]; then
  plugin_address=$(awk '
    /^\[mcp_servers\.datashard\][[:space:]]*$/ { section = 1; next }
    section && /^\[/ { exit }
    section && /^url[[:space:]]*=[[:space:]]*"/ {
      sub(/^url[[:space:]]*=[[:space:]]*"/, "")
      sub(/".*$/, "")
      print
      exit
    }
  ' "$codex_home/config.toml") || deny
fi
# The plugin ships example.invalid so a fresh install does not name a company. Codex uses a
# same-named server from config.toml instead. An unfilled template is not an address either.
case $plugin_address in
  *://example.invalid | *://example.invalid/* | *://example.invalid:*) plugin_address="" ;;
  *'${'*) plugin_address="" ;;
esac

plugin_root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd) || deny
out=$(CLAUDE_PROJECT_DIR="$root" CLAUDE_PLUGIN_OPTION_DATASHARD_URL="$plugin_address" /bin/bash "$plugin_root/scripts/check-install.sh" </dev/null) || deny
[ -n "$out" ] || allow

decision=$(printf '%s' "$out" | sed -n -E 's/.*"permissionDecision"[[:space:]]*:[[:space:]]*"([^"]*)".*/\1/p' | sed -n '1p') || deny
reason=$(printf '%s' "$out" | sed -n -E 's/.*"permissionDecisionReason"[[:space:]]*:[[:space:]]*"(.*)"\}\}.*/\1/p' | sed -n '1p') || deny
case $decision in
  deny|ask) decision=deny ;;
  allow) allow ;;
  *) deny ;;
esac
[ -n "$reason" ] || deny
# check-install.sh speaks to Claude Code. The same decision, in Codex's words.
reason=${reason//Claude Code/Codex}
reason=${reason//\/datashard:init/\$datashard-init}
reason=${reason//\/config/codex mcp add}
printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"%s","permissionDecisionReason":"%s"}}\n' "$decision" "$reason"
exit 0
