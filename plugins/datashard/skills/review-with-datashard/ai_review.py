#!/usr/bin/env python3
"""AI review: a first pass over a change, run locally before it is committed.

The reviewer's instructions are in prompt.md and the shape of its answer in schema.json, next to this file. The model
is reached through the `claude` CLI, so a run uses the Claude Code membership: no API key, no metered spend.

Lock files, built bundles and generated test data are left out of the diff and named in the output, so the length
budget goes on code a person wrote. A diff still over the budget is cut at a file boundary, and the files cut are named.

Stdlib only. From inside any repo or worktree:

    python3 <skill dir>/ai_review.py            # branch work + uncommitted changes
    python3 <skill dir>/ai_review.py --staged   # only what is staged
    python3 <skill dir>/ai_review.py --branch   # committed branch work only
    python3 <skill dir>/ai_review.py --skip 'docs/**' --model claude-opus-5-5 --effort high

Exits 1 when a finding is medium or more severe (change the threshold with --fail-on), and 2 when no review could be
produced, so "no output" is never mistaken for "nothing found". A CLI that has not answered within CLAUDE_TIMEOUT
seconds (change that with --timeout) is stopped and counts as no review.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import textwrap

HERE = os.path.dirname(os.path.abspath(__file__))
PROMPT_FILE = os.path.join(HERE, "prompt.md")
SCHEMA_FILE = os.path.join(HERE, "schema.json")

# Generated files: reviewing them spends the budget on text nobody wrote. Git pathspec globs, where `**/` also
# matches the repository root.
DEFAULT_SKIP = [
    "**/package-lock.json",
    "**/pnpm-lock.yaml",
    "**/yarn.lock",
    "**/.terraform.lock.hcl",
    "**/dist/**",
    "**/*.min.js",
    "**/*.map",
    "**/golden/vectors.json",
]

MAX_DIFF_CHARS = 300000

# How long the claude CLI may take before it is stopped. A hung CLI must end in an exit 2, not in a review that never
# reports.
CLAUDE_TIMEOUT = 900

SEV_ICON = {"blocker": "🛑", "high": "🔴", "medium": "🟠", "low": "⚪"}
SEV_ORDER = {"blocker": 0, "high": 1, "medium": 2, "low": 3}
FAIL_ON = ["blocker", "high", "medium", "low", "never"]

FILE_HEADER = re.compile(r"^diff --git a/.* b/(.*)$", re.MULTILINE)

# What `git diff` is told, so that the person's own git settings (diff.external, diff.noprefix, color) cannot change what
# the model sees or break the a/ and b/ headers that truncate() reads.
DIFF_FLAGS = ["--no-ext-diff", "--no-textconv", "--no-color", "--src-prefix=a/", "--dst-prefix=b/"]


def load_prompt() -> str:
    with open(PROMPT_FILE) as f:
        return f.read().strip()


def load_schema() -> dict:
    with open(SCHEMA_FILE) as f:
        return json.load(f)


def git(repo: str, *args: str) -> str:
    # core.quotePath=false: a path with non-ASCII characters is printed as it is, not as a quoted "\303\251" escape that
    # FILE_HEADER cannot read.
    cmd = ["git", "-C", repo, "-c", "core.quotePath=false", *args]
    return subprocess.run(cmd, check=True, capture_output=True, text=True).stdout


def default_base(repo: str) -> str:
    """The branch a pull request from here would target."""
    try:
        out = git(repo, "symbolic-ref", "--quiet", "refs/remotes/origin/HEAD").strip()
        if out:
            return out.removeprefix("refs/remotes/")
    except subprocess.CalledProcessError:
        pass
    for candidate in ("origin/main", "main", "origin/master", "master"):
        try:
            git(repo, "rev-parse", "--verify", "--quiet", candidate)
            return candidate
        except subprocess.CalledProcessError:
            continue
    raise ValueError("could not work out a base branch; pass --base")


def collect_diff(repo: str, base: str, mode: str, skip: list[str]) -> tuple[str, str, list[str]]:
    """Returns (diff, what was diffed, files left out as generated)."""
    if mode == "staged":
        target, described = ["--cached"], "staged changes"
    else:
        merge_base = git(repo, "merge-base", base, "HEAD").strip()
        if mode == "branch":
            target, described = [f"{base}...HEAD"], f"committed branch work vs {base} ({merge_base[:8]})"
        else:
            # Merge base against the working tree: what the commit will hold once the work in progress is in it.
            target, described = [merge_base], f"branch work + uncommitted changes vs {base} ({merge_base[:8]})"

    pathspecs = ["--", "."] + [f":(exclude,glob){pattern}" for pattern in skip]
    every = git(repo, "diff", *DIFF_FLAGS, "--name-only", *target).splitlines()
    kept = set(git(repo, "diff", *DIFF_FLAGS, "--name-only", *target, *pathspecs).splitlines())
    skipped = [name for name in every if name and name not in kept]
    return git(repo, "diff", *DIFF_FLAGS, *target, *pathspecs), described, skipped


def truncate(diff: str, limit: int) -> tuple[str, list[str]]:
    """The diff within `limit` characters, cut at a file boundary when one fits, and the files not wholly kept."""
    if len(diff) <= limit:
        return diff, []
    starts = [(m.start(), m.group(1)) for m in FILE_HEADER.finditer(diff)]
    if not starts:
        # No file header to cut at or to name: say the whole diff was cut, not that nothing was.
        return diff[:limit], ["the whole diff"]
    fits = [start for start, _ in starts if 0 < start <= limit]
    if not fits:
        # Not even the first file fits: keep its head, and name it with every file after it.
        return diff[:limit], [name for _, name in starts]
    return diff[: fits[-1]], [name for start, name in starts if start >= fits[-1]]


def commit_subjects(repo: str, base: str) -> list[str]:
    try:
        out = git(repo, "log", "--reverse", "--pretty=%s", f"{base}..HEAD")
    except subprocess.CalledProcessError:
        return []
    return [line for line in out.splitlines() if line][:30]


def fence_for(*texts: str) -> str:
    """A code fence longer than any run of backticks in `texts` (at least three), so none of them can close it."""
    longest = max((len(run) for text in texts for run in re.findall(r"`+", text)), default=0)
    return "`" * max(3, longest + 1)


def build_prompt(branch: str, subjects: list[str], diff: str, cut: list[str], skipped: list[str]) -> str:
    said = "\n".join(f"- {s}" for s in subjects) or "(no commits yet)"
    # The branch name, the commit subjects, the file names and the diff are the author's text: all of it goes inside a
    # fenced block, and only what this script says about it is outside.
    fence = fence_for(branch, said, diff, *cut, *skipped)
    prompt = f"""{fence}text
Branch: {branch}

What the commits say:
{said}
"""
    if cut:
        prompt += f"\nNot reviewed, cut for length: {', '.join(cut)}\n"
    if skipped:
        prompt += f"\nLeft out as generated: {', '.join(skipped)}\n"
    prompt += f"""{fence}

Diff:
{fence}diff
{diff}
{fence}
"""
    if cut:
        prompt += "\nSay in the summary that the files listed as cut for length were not reviewed.\n"
    return prompt + "\nAnswer as JSON matching the review schema."


def well_formed(result) -> bool:
    """A review answer: an object whose findings are a list of objects."""
    findings = result.get("findings") if isinstance(result, dict) else None
    return isinstance(findings, list) and all(isinstance(f, dict) for f in findings)


def tolerant_json(text: str):
    """Parse JSON, falling back to the outermost {...} if the model wrapped it in prose."""
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass
    start, end = text.find("{"), text.rfind("}")
    if start != -1 and end > start:
        try:
            return json.loads(text[start : end + 1])
        except json.JSONDecodeError:
            pass
    return None


def parse_envelope(stdout: str) -> dict | None:
    """The CLI answers with the result object or with every event; take the last result event from an array."""
    try:
        parsed = json.loads(stdout)
    except json.JSONDecodeError:
        return None
    if isinstance(parsed, dict):
        return parsed
    if isinstance(parsed, list):
        results = [e for e in parsed if isinstance(e, dict) and e.get("type") == "result"]
        if results:
            return results[-1]
    return None


def review(
    prompt: str, model: str | None, effort: str | None, timeout: int = CLAUDE_TIMEOUT
) -> tuple[dict | None, dict]:
    """Runs the claude CLI in print mode. Returns (result, envelope)."""
    cmd = [
        "claude",
        "--print",
        "--system-prompt", load_prompt(),
        "--json-schema", json.dumps(load_schema()),
        "--output-format", "json",
        # No tools and no MCP servers: the reviewer answers from the diff it is given, as prompt.md assumes. Loading
        # them would add about 30k tokens and minutes for nothing. `--tools ""` keeps StructuredOutput, which is how
        # --json-schema is answered.
        "--restricted",
        "--strict-mcp-config",
        "--tools", "",
    ]
    if model:
        cmd += ["--model", model]
    if effort:
        cmd += ["--effort", effort]

    try:
        proc = subprocess.run(cmd, input=prompt, capture_output=True, text=True, timeout=timeout)
    except subprocess.TimeoutExpired:
        print(f"claude did not answer within {timeout} seconds and was stopped; see --timeout", file=sys.stderr)
        return None, {}
    if proc.returncode != 0:
        print(f"claude exited {proc.returncode}: {proc.stderr.strip()[:500]}", file=sys.stderr)
        return None, {}

    envelope = parse_envelope(proc.stdout)
    if envelope is None:
        print(f"could not parse the CLI's answer: {proc.stdout[:500]!r}", file=sys.stderr)
        return None, {}
    if envelope.get("is_error"):
        print(f"claude reported an error: {str(envelope.get('result'))[:500]}", file=sys.stderr)
        return None, envelope

    # --json-schema gives the parsed object; the text is the fallback.
    result = envelope.get("structured_output")
    if not isinstance(result, dict):
        result = tolerant_json(envelope.get("result") or "")
    if not well_formed(result):
        print(f"unparseable model output: {str(envelope.get('result'))[:500]!r}", file=sys.stderr)
        return None, envelope
    return result, envelope


def render(result: dict, envelope: dict, described: str, cut: list[str], skipped: list[str], loose: list[str]) -> str:
    findings = sorted(
        result.get("findings", []),
        key=lambda f: (SEV_ORDER.get(f.get("severity"), 9), f.get("file", "")),
    )

    out = ["", "AI review", f"  reviewed: {described}", ""]
    summary = (result.get("summary") or "").strip()
    if summary:
        out += [textwrap.fill(summary, width=88), ""]

    if not findings:
        out.append("No issues found. This is a first pass, not a sign-off.")
    else:
        out += [f"{len(findings)} finding(s), most severe first. Confidence is the model's own.", ""]
        current_file = None
        for f in findings:
            if f.get("file") != current_file:
                current_file = f.get("file")
                out.append(f"{current_file}")
            loc = f":{f['line']}" if f.get("line") else ""
            out.append(
                f"  {SEV_ICON.get(f.get('severity'), '')} {f.get('title')}"
                f"  [{f.get('severity')} · {f.get('confidence')} confidence · {f.get('category')}{loc}]"
            )
            out.append(textwrap.fill(f.get("detail", ""), width=84, initial_indent="     ", subsequent_indent="     "))
            if f.get("fix"):
                out.append(textwrap.fill(f"fix: {f['fix']}", width=84, initial_indent="     ", subsequent_indent="          "))
            out.append("")

    if cut:
        out += [f"Not reviewed, cut for length: {', '.join(cut)}", ""]
    if skipped:
        out += [f"Left out as generated: {', '.join(skipped)}", ""]
    if loose:
        out.append(f"{len(loose)} untracked file(s) were NOT part of the diff:")
        out += [f"  {p}" for p in loose[:10]]
        if len(loose) > 10:
            out.append(f"  ... and {len(loose) - 10} more")
        out += ["  Stage them and run again if they belong in this change.", ""]

    served = ", ".join((envelope.get("modelUsage") or {}).keys()) or "the CLI's default model"
    out.append(f"Run on your Claude Code membership via {served}. Advisory only: you still review.")
    return "\n".join(out)


def failing(findings: list[dict], fail_on: str) -> list[dict]:
    """The findings at `fail_on` severity or above; none for "never". A severity it does not know counts as failing."""
    if fail_on == "never":
        return []
    return [f for f in findings if SEV_ORDER.get(str(f.get("severity", "")).lower(), -1) <= SEV_ORDER[fail_on]]


def untracked(repo: str) -> list[str]:
    return [line for line in git(repo, "ls-files", "--others", "--exclude-standard").splitlines() if line]


def main() -> int:
    """Exit 0 or 1 is the review's verdict; anything that stops the review from running exits 2."""
    try:
        return run()
    except Exception as error:  # noqa: BLE001 - an exit 1 here would read as "findings found"
        print(f"the review could not run: {error}", file=sys.stderr)
        return 2


def run() -> int:
    ap = argparse.ArgumentParser(description="AI review of a change, run locally before it is committed.")
    ap.add_argument("--repo", default=os.getcwd(), help="repo or worktree to review (default: the current directory)")
    ap.add_argument("--base", help="branch the change will merge into (default: worked out from origin)")
    ap.add_argument("--staged", action="store_true", help="review only staged changes")
    ap.add_argument("--branch", action="store_true", help="review only committed branch work")
    ap.add_argument("--skip", action="append", default=[], metavar="GLOB", help="also leave out these paths (repeatable)")
    ap.add_argument("--no-skip", action="store_true", help="review generated files too")
    ap.add_argument("--max-chars", type=int, default=MAX_DIFF_CHARS, help=f"diff budget (default {MAX_DIFF_CHARS:,})")
    ap.add_argument("--fail-on", choices=FAIL_ON, default="medium",
                    help="exit 1 when a finding is this severe or more (default: medium)")
    ap.add_argument("--model", help="model to review with (default: the CLI's)")
    ap.add_argument("--effort", choices=["low", "medium", "high", "xhigh", "max"], help="effort level")
    ap.add_argument("--timeout", type=int, default=CLAUDE_TIMEOUT, metavar="SECONDS",
                    help=f"stop the claude CLI after this many seconds and exit 2 (default {CLAUDE_TIMEOUT})")
    args = ap.parse_args()

    if args.staged and args.branch:
        return ap.error("--staged and --branch cannot be used together")
    if args.timeout <= 0:
        return ap.error("--timeout must be a positive number of seconds")
    if not shutil.which("claude"):
        print("the `claude` CLI is not on PATH", file=sys.stderr)
        return 2

    repo = os.path.abspath(args.repo)
    mode = "staged" if args.staged else "branch" if args.branch else "working"
    base = args.base or default_base(repo)
    skip = args.skip if args.no_skip else DEFAULT_SKIP + args.skip
    diff, described, skipped = collect_diff(repo, base, mode, skip)

    if not diff.strip():
        print(f"nothing to review ({described} is empty)")
        return 0

    diff, cut = truncate(diff, args.max_chars)
    branch = git(repo, "rev-parse", "--abbrev-ref", "HEAD").strip()
    prompt = build_prompt(branch, commit_subjects(repo, base), diff, cut, skipped)

    print(f"reviewing {described} ({len(diff):,} chars)...", file=sys.stderr)
    result, envelope = review(prompt, args.model, args.effort, args.timeout)
    if not well_formed(result):
        print("no reviewable result; failing rather than reporting a clean run", file=sys.stderr)
        return 2

    loose = untracked(repo) if mode != "branch" else []
    print(render(result, envelope, described, cut, skipped, loose))
    bad = failing(result["findings"], args.fail_on)
    if bad:
        print(f"\nFailed: {len(bad)} finding{'' if len(bad) == 1 else 's'} at {args.fail_on} or above.")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
