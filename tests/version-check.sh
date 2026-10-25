#!/usr/bin/env bash
# A change to a package under plugins/ must raise that package's version above the base's, or people who installed it
# never get the change: Claude Code updates a plugin only when its version changes. BASE is what to compare with: a
# pull request's base branch, or main before a push. Run from the repository's root. When BASE can't be found (a
# force-push to main), the last release tag is the base: stricter than the commit before, which would miss an earlier
# commit of the same push. With no tag either, nothing can be compared, and the check fails rather than pass unchecked.
set -euo pipefail
shopt -s nullglob
: "${BASE:?set BASE to the branch or commit to compare with}"

if base=$(git merge-base HEAD "$BASE" 2>/dev/null); then
  how="its merge base with $BASE"
elif base=$(git describe --tags --abbrev=0 --match 'v*' 2>/dev/null); then
  how="the last tag, $base, as $BASE can't be found"
else
  echo "$BASE can't be found and there is no release tag, so nothing was checked."
  echo "Rerun with BASE set to the commit main was at before this change."
  exit 1
fi
echo "Comparing each package with $how."

version='JSON.parse(require("fs").readFileSync(0, "utf8")).version ?? "0.0.0"'
failed=0
for manifest in plugins/*/.claude-plugin/plugin.json; do
  package=${manifest%/.claude-plugin/plugin.json}
  if git diff --quiet "$base" HEAD -- "$package"; then
    echo "$package/ is unchanged."
    continue
  fi
  # 0.0.0 only where the base has no plugin.json; one that is there but can't be read fails the check.
  old=0.0.0
  if git cat-file -e "$base:$manifest" 2>/dev/null; then
    old=$(git show "$base:$manifest" | node -p "$version")
  fi
  new=$(node -p "$version" < "$manifest")
  if ! printf '%s' "$new" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+$'; then
    echo "$manifest's version is $new: use x.y.z, which this check can order."
    failed=1
  elif [ "$new" = "$old" ] || [ "$(printf '%s\n' "$old" "$new" | sort -V | tail -n 1)" != "$new" ]; then
    echo "$package/ changed: raise $manifest's version above $old."
    echo "On main, this means two pull requests raised it to the same version: raise it again in a new pull request, or people on $new never get this change."
    failed=1
  else
    echo "$package/ changed, and its version went from $old to $new."
  fi
done
exit "$failed"
