#!/usr/bin/env bash
# Runs before every save through the plugin (ADR 0036). A project's DATASHARD.md names the install its knowledge
# belongs to; a save to the install the plugin connects to is refused when that is another one, and asks first when
# the project names none. Prints nothing when the two agree, so the save goes on through the normal permission flow.
set -u -o pipefail

# A command failing below asks, rather than letting the save through unchecked; a failure inside $(...) fails the
# assignment it feeds, which stops the script here too. So the functions run inside $(...) stay single pipelines,
# which pipefail fails as a whole (set -E instead would make the trap print its answer into the variable). A timeout or a missing bash can't be caught from inside: Claude
# Code then carries on with the save (ADR 0036).
cannot_check() {
  printf '%s\n' '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"ask","permissionDecisionReason":"The Datashard plugin could not check which install this save belongs to: save only if this project belongs to the install the plugin connects to."}}'
  exit 0
}
trap cannot_check ERR

[ -t 0 ] || cat >/dev/null # the hook's input: everything needed is in the environment and DATASHARD.md

plugin_address=${CLAUDE_PLUGIN_OPTION_DATASHARD_URL:-}
case $plugin_address in '${'*) plugin_address="" ;; esac # a setting Claude Code didn't fill in

# The nearest DATASHARD.md at or above the folder Claude Code started in, as Claude Code finds CLAUDE.md.
# Claude Code names that folder; without it, the hook's own working directory can't be trusted to be the project.
# A folder it can't enter isn't searched, so the check doesn't report it as holding no DATASHARD.md either.
[ -n "${CLAUDE_PROJECT_DIR:-}" ] || cannot_check
project_address=""
found=""
start=$(CDPATH='' cd "$CLAUDE_PROJECT_DIR" 2>/dev/null && pwd) || cannot_check
dir=$start
while [ -n "$dir" ]; do
  if [ -f "$dir/DATASHARD.md" ]; then
    found=$dir
    # The first Install line of its "This project" block.
    # sed reads the file itself: it quits at the line, and anything piping the file into it would then fail.
    project_address=$(sed -n -E -e '/^## This project/,/^## /{' -e '/^- Install: /{' \
      -e 's/^- Install: `?([^` ]*)`?.*/\1/p' -e 'q' -e '}' -e '}' "$dir/DATASHARD.md" | tr -d '\r')
    break
  fi
  parent=$(dirname "$dir")
  [ "$parent" = "$dir" ] && break
  dir=$parent
done

# Two addresses name the same install when their scheme, host and port match, default ports ignored. The host ends
# at the first / ? or #, as URLs define it, before any user:password@ is dropped, so nothing after it can pass for
# the host (a / inside a password, which URLs don't allow, then makes an address match nothing). An address
# written without a scheme is taken as https. An IPv6 address is compared as written (bar a default port), and never
# quoted back to Claude.
install_of() {
  printf '%s' "$1" | tr '[:upper:]' '[:lower:]' |
    sed -E -e '/:\/\//!s,^,https://,' -e 's,^([a-z][a-z0-9+.-]*://[^/?#]*).*$,\1,' \
      -e 's,^([a-z][a-z0-9+.-]*://)[^@]*@,\1,' \
      -e 's,\.(:[0-9]+)?$,\1,' -e 's,^(https://(\[[^]]*\]|[^:]*)):443$,\1,' -e 's,^(http://(\[[^]]*\]|[^:]*)):80$,\1,'
}
# A project names no install when its Install line is missing, empty, "none" or still the template's <placeholder>.
# An address written as a Markdown autolink, <https://…>, is read without its brackets.
project_address=${project_address%.}
case $project_address in
  "<"*"://"*">") project_address=${project_address#<} project_address=${project_address%>} ;;
  "<"*) project_address="" ;;
  [Nn][Oo][Nn][Ee]) project_address="" ;;
esac
plugin_install=$(install_of "$plugin_address")
project_install=$(install_of "$project_address")
# Only a plain address (a scheme and a host name with at least one dot) is ever quoted back to Claude, so no other
# text from DATASHARD.md or the plugin's setting reaches it.
plain='^https?://[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+(:[0-9]+)?$'
project_named="another install, at an address this check doesn't repeat"
printf '%s' "$project_install" | grep -Eq "$plain" && project_named="the Datashard at $project_install"
# The plugin's address is never quoted when it holds an @: part of a password could survive the parsing above.
plugin_named="the address in the Datashard plugin's settings"
case $plugin_address in
  *@*) ;;
  *) printf '%s' "$plugin_install" | grep -Eq "$plain" && plugin_named=$plugin_install ;;
esac
# The folder Claude Code started in is quoted only when it holds nothing but ASCII letters, digits, spaces and . _ - /
# (listed rather than ranged, since a range can take in other letters in some locales), so it reaches the message
# whole, with no punctuation of its own. Such a folder can still spell words: an ask's reason is shown to the person in
# the permission prompt, and Claude reads it only in a -p run, where Claude Code refuses the save.
folder_chars="abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789._/ -"
started_in="the folder Claude Code started in"
case $start in
  *[!"$folder_chars"]*) ;;
  *) started_in=$start ;;
esac

json() {
  printf '%s' "$1" | LC_ALL=C tr -cd '\11\40-\176' | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g' -e 's/	/\\t/g'
}
decide() {
  reason=$(json "$2") || cannot_check
  printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"%s","permissionDecisionReason":"%s"}}\n' \
    "$1" "$reason"
}

if [ -z "$plugin_address" ]; then
  decide ask "The Datashard plugin has no address set, so this save's install can't be checked against this project's DATASHARD.md. Set it in /config, then run /datashard:init."
elif [ -z "$found" ]; then
  decide ask "No DATASHARD.md is in $started_in or a folder above it, so nothing names this project's Datashard install, and this save goes to $plugin_named. If the project's DATASHARD.md is in a subfolder, start Claude Code there; if it has none, /datashard:init writes one. Save only if this project's knowledge belongs there."
elif [ -z "$project_install" ]; then
  decide ask "This project's DATASHARD.md names no Datashard install, and this save goes to $plugin_named. Save only if this project's knowledge belongs there; /datashard:init records the install."
elif [ "$project_install" != "$plugin_install" ]; then
  decide deny "This project's knowledge belongs to $project_named (its DATASHARD.md), but the Datashard plugin saves to $plugin_named. Save through that install instead. If DATASHARD.md's Install line is the mistake, /datashard:init corrects it."
fi
exit 0
