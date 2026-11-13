#!/usr/bin/env bash
# After a push to main: an open pull request that changes a package under plugins/ must still raise that package's
# version above main's. Two pull requests can each raise it to the same version and both pass their own checks; once
# one merges, the other would leave people who updated in between without its change. Main's protection makes that pull
# request update its branch before it merges, which reruns its checks; until then, it gets a "plugin version" status on
# its head commit: failure until it raises the version again. Run from main's checkout, with gh signed in (GH_TOKEN)
# and GITHUB_REPOSITORY set.
set -euo pipefail
: "${GITHUB_REPOSITORY:?set GITHUB_REPOSITORY to owner/repo}"

version='JSON.parse(require("fs").readFileSync(0, "utf8")).version ?? "0.0.0"'
above() { [ "$1" != "$2" ] && [ "$(printf '%s\n' "$1" "$2" | sort -V | tail -n 1)" = "$1" ]; }
# A package's version on main: 0.0.0 for a package main doesn't have yet.
main_version() {
  if [ -f "plugins/$1/.claude-plugin/plugin.json" ]; then
    node -p "$version" < "plugins/$1/.claude-plugin/plugin.json"
  else
    echo 0.0.0
  fi
}

# Every open pull request, as "number head-sha base": also those into another branch, such as one stacked on another
# pull request, which reach main later.
open_prs=$(
  gh pr list --repo "$GITHUB_REPOSITORY" --state open --limit 1000 --json number,headRefOid,baseRefName |
    node -e 'for (const pr of JSON.parse(require("fs").readFileSync(0, "utf8")))
      console.log(pr.number, pr.headRefOid, pr.baseRefName)'
)

# A package's version at a commit or branch: 0.0.0 where there is no plugin.json, a failure where it can't be read.
errors=$(mktemp)
trap 'rm -f "$errors"' EXIT
version_at() {
  local file
  if file=$(gh api -H "Accept: application/vnd.github.raw" -X GET \
    "repos/$GITHUB_REPOSITORY/contents/plugins/$1/.claude-plugin/plugin.json" -f ref="$2" 2>"$errors"); then
    printf '%s' "$file" | node -p "$version"
  elif grep -q 'HTTP 404' "$errors"; then
    echo 0.0.0
  else
    return 1
  fi
}

# A pull request that can't be checked is named, the others are still checked, and the run fails at the end.
skipped=""
set_status() {
  if gh api -X POST "repos/$GITHUB_REPOSITORY/statuses/$2" -f state="$3" -f context="plugin version" \
    -f description="${4:0:140}" >/dev/null; then
    echo "#$1: $3, $4"
  else
    echo "#$1: not checked, its status couldn't be set" >&2
    skipped="$skipped #$1"
  fi
}
while read -r number sha base; do
  [ -n "$number" ] || continue
  # All its files, page by page: the pull request list itself names only the first hundred.
  if ! files=$(gh api --paginate "repos/$GITHUB_REPOSITORY/pulls/$number/files" --jq '.[].filename'); then
    echo "#$number: not checked, its files couldn't be listed" >&2
    skipped="$skipped #$number"
    continue
  fi
  packages=$(sed -n 's|^plugins/\([^/]*\)/.*|\1|p' <<<"$files" | sort -u)
  if [ -z "$packages" ]; then
    # A failure this check set on this head earlier, while the pull request still changed a package, is cleared.
    if ! failed=$(gh api "repos/$GITHUB_REPOSITORY/commits/$sha/status" \
      --jq '[.statuses[] | select(.context == "plugin version" and .state == "failure")] | length'); then
      echo "#$number: not checked, its statuses couldn't be read" >&2
      skipped="$skipped #$number"
      continue
    fi
    if [ "$failed" != "0" ]; then
      set_status "$number" "$sha" success "No package under plugins/ is changed here any more"
    fi
    continue
  fi
  # Each changed package is compared with its own base branch, as its pull request CI does, and with main: a stacked
  # pull request reaches main in the end, so it is held to the higher of the two.
  state=success description="" unreadable=""
  for package in $packages; do
    against=$(main_version "$package")
    if ! head=$(version_at "$package" "$sha") || { [ "$base" != main ] && ! stack=$(version_at "$package" "$base"); }; then
      unreadable=1
      break
    fi
    if [ "$base" != main ] && above "$stack" "$against"; then against=$stack; fi
    # x.y.z only, as in version-check.sh: sort -V misorders pre-releases.
    if printf '%s' "$head" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+$' && above "$head" "$against"; then
      [ "$state" = failure ] || description="${description:+$description; }$package $head is above $against"
    else
      [ "$state" = failure ] || description=""
      state=failure
      description="${description:+$description; }Raise $package's plugin.json version above $against, as x.y.z"
    fi
  done
  if [ -n "$unreadable" ]; then
    echo "#$number: not checked, a plugin.json couldn't be read" >&2
    skipped="$skipped #$number"
    continue
  fi
  set_status "$number" "$sha" "$state" "$description"
done <<<"$open_prs"

if [ -n "$skipped" ]; then
  echo "Not checked:$skipped" >&2
  exit 1
fi
