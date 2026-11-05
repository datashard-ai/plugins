"""Tests for ai_review.py. Run with: PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s tests -p 'test_*.py'"""

from __future__ import annotations

import contextlib
import io
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from unittest import mock

# Bytecode written next to the skill would put a __pycache__ in plugins/, which the package tests refuse.
sys.dont_write_bytecode = True
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "plugins", "datashard", "skills", "review-with-datashard"))

import ai_review  # noqa: E402


def run(repo: str, *args: str) -> None:
    subprocess.run(["git", "-C", repo, *args], check=True, capture_output=True)


def write(repo: str, path: str, text: str) -> None:
    full = os.path.join(repo, path)
    os.makedirs(os.path.dirname(full), exist_ok=True)
    with open(full, "w") as f:
        f.write(text)


def file_diff(path: str, size: int) -> str:
    header = f"diff --git a/{path} b/{path}\n--- a/{path}\n+++ b/{path}\n@@ -0,0 +1 @@\n"
    return header + "+" + "x" * max(0, size - len(header) - 2) + "\n"


class PromptAndSchema(unittest.TestCase):
    def test_the_prompt_is_generic_and_never_gatekeeps(self):
        prompt = ai_review.load_prompt()
        self.assertNotIn("Datashard", prompt)
        self.assertIn("never approve and never block", prompt)

    def test_every_finding_carries_a_fix_and_a_generic_category(self):
        schema = ai_review.load_schema()
        self.assertEqual(schema["required"], ["summary", "findings"])
        item = schema["properties"]["findings"]["items"]
        self.assertIn("fix", item["required"])
        self.assertEqual(
            item["properties"]["category"]["enum"],
            ["correctness", "data-loss", "security", "concurrency", "error-handling", "contract-break", "tests-docs", "other"],
        )


class RepoCase(unittest.TestCase):
    """A repository whose `work` branch changes a source file and three generated ones."""

    def setUp(self):
        self.repo = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.repo)
        run(self.repo, "init", "-q", "-b", "main")
        run(self.repo, "config", "user.email", "test@example.com")
        run(self.repo, "config", "user.name", "Test")
        run(self.repo, "config", "commit.gpgsign", "false")
        write(self.repo, "src/a.ts", "export const a = 1;\n")
        run(self.repo, "add", ".")
        run(self.repo, "commit", "-q", "-m", "start")
        run(self.repo, "checkout", "-q", "-b", "work")
        write(self.repo, "src/a.ts", "export const a = 2;\n")
        write(self.repo, "package-lock.json", '{"lockfileVersion": 3}\n')
        write(self.repo, "tools/build/dist/app.cjs", "module.exports = 1;\n")
        write(self.repo, "pkg/test/golden/vectors.json", "[[0.1, 0.2]]\n")
        run(self.repo, "add", ".")
        run(self.repo, "commit", "-q", "-m", "feat: change a")


class GeneratedFiles(RepoCase):
    def test_leaves_lock_files_bundles_and_golden_vectors_out_and_names_them(self):
        diff, _, skipped = ai_review.collect_diff(self.repo, "main", "branch", ai_review.DEFAULT_SKIP)
        self.assertIn("src/a.ts", diff)
        self.assertNotIn("lockfileVersion", diff)
        self.assertNotIn("module.exports", diff)
        self.assertNotIn("0.1, 0.2", diff)
        self.assertEqual(
            sorted(skipped),
            ["package-lock.json", "pkg/test/golden/vectors.json", "tools/build/dist/app.cjs"],
        )

    def test_reviews_everything_when_nothing_is_skipped(self):
        diff, _, skipped = ai_review.collect_diff(self.repo, "main", "branch", [])
        self.assertIn("lockfileVersion", diff)
        self.assertEqual(skipped, [])

    def test_lists_every_commit_subject_on_the_branch(self):
        write(self.repo, "src/b.ts", "export const b = 1;\n")
        run(self.repo, "add", ".")
        run(self.repo, "commit", "-q", "-m", "fix: add b")
        self.assertEqual(ai_review.commit_subjects(self.repo, "main"), ["feat: change a", "fix: add b"])


class Truncation(unittest.TestCase):
    def test_cuts_at_a_file_boundary_and_names_the_files_left_out(self):
        diff = file_diff("a.ts", 100) + file_diff("b.ts", 100) + file_diff("c.ts", 100)
        text, cut = ai_review.truncate(diff, 250)
        self.assertIn("b/a.ts", text)
        self.assertIn("b/b.ts", text)
        self.assertNotIn("c.ts", text)
        self.assertEqual(cut, ["c.ts"])

    def test_cuts_inside_a_file_larger_than_the_limit_and_names_it(self):
        diff = file_diff("big.ts", 1000) + file_diff("small.ts", 100)
        text, cut = ai_review.truncate(diff, 500)
        self.assertEqual(len(text), 500)
        self.assertEqual(cut, ["big.ts", "small.ts"])

    def test_leaves_a_diff_within_the_limit_alone(self):
        diff = file_diff("a.ts", 100)
        self.assertEqual(ai_review.truncate(diff, 1000), (diff, []))

    def test_the_prompt_tells_the_reviewer_what_it_did_not_see(self):
        prompt = ai_review.build_prompt("work", ["feat: change a"], "DIFF", ["c.ts"], ["package-lock.json"])
        self.assertIn("feat: change a", prompt)
        self.assertIn("Not reviewed, cut for length: c.ts", prompt)
        self.assertIn("Left out as generated: package-lock.json", prompt)


class Output(unittest.TestCase):
    def test_parses_the_last_result_event_of_an_event_array(self):
        stdout = '[{"type": "system"}, {"type": "result", "n": 1}, {"type": "result", "n": 2}]'
        self.assertEqual(ai_review.parse_envelope(stdout), {"type": "result", "n": 2})

    def test_reads_json_wrapped_in_prose(self):
        self.assertEqual(ai_review.tolerant_json('Here: {"summary": "s"} done'), {"summary": "s"})

    def test_sorts_by_severity_and_shows_the_fix_and_what_was_left_out(self):
        finding = {"file": "f.ts", "line": 3, "confidence": "high", "category": "access", "title": "T", "detail": "D"}
        result = {
            "summary": "S",
            "findings": [dict(finding, severity="low", fix="F low"), dict(finding, severity="blocker", fix="F blocker")],
        }
        out = ai_review.render(result, {}, "described", ["c.ts"], ["package-lock.json"], [])
        self.assertLess(out.index("blocker"), out.index("low"))
        self.assertIn("fix: F blocker", out)
        self.assertIn("Not reviewed, cut for length: c.ts", out)
        self.assertIn("Left out as generated: package-lock.json", out)


def finding(severity: str) -> dict:
    return {"file": "src/a.ts", "line": 1, "severity": severity, "confidence": "high", "category": "correctness",
            "title": "T", "detail": "D", "fix": "F"}


class Verdict(RepoCase):
    def main(self, result, *extra):
        argv = ["ai_review.py", "--repo", self.repo, "--base", "main", "--branch", *extra]
        out, err = io.StringIO(), io.StringIO()
        with mock.patch.object(sys, "argv", argv), \
             mock.patch.object(ai_review.shutil, "which", return_value="/usr/local/bin/claude"), \
             mock.patch.object(ai_review, "review", return_value=(result, {})), \
             contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            code = ai_review.main()
        return code, out.getvalue() + err.getvalue()

    def test_medium_and_above_fail_by_default(self):
        found = [finding("low"), finding("medium"), finding("blocker")]
        self.assertEqual([f["severity"] for f in ai_review.failing(found, "medium")], ["medium", "blocker"])
        self.assertEqual(ai_review.failing(found, "never"), [])
        self.assertEqual(len(ai_review.failing(found, "low")), 3)

    def test_exits_1_and_says_why_when_a_finding_is_medium_or_above(self):
        code, out = self.main({"summary": "S", "findings": [finding("low"), finding("high")]})
        self.assertEqual(code, 1)
        self.assertIn("Failed: 1 finding at medium or above.", out)

    def test_exits_0_when_every_finding_is_low(self):
        code, _ = self.main({"summary": "S", "findings": [finding("low")]})
        self.assertEqual(code, 0)

    def test_fail_on_sets_the_threshold(self):
        self.assertEqual(self.main({"summary": "S", "findings": [finding("blocker")]}, "--fail-on", "never")[0], 0)
        self.assertEqual(self.main({"summary": "S", "findings": [finding("medium")]}, "--fail-on", "high")[0], 0)
        self.assertEqual(self.main({"summary": "S", "findings": [finding("low")]}, "--fail-on", "low")[0], 1)

    def test_reads_a_capitalised_severity_as_its_level(self):
        self.assertEqual(ai_review.failing([finding("Low")], "medium"), [])
        self.assertEqual(len(ai_review.failing([finding("High")], "medium")), 1)

    def test_an_unknown_severity_fails(self):
        self.assertEqual(len(ai_review.failing([finding("severe")], "blocker")), 1)

    def test_exits_2_when_a_finding_is_not_an_object(self):
        self.assertEqual(self.main({"summary": "S", "findings": ["not an object"]})[0], 2)

    def test_exits_2_when_the_review_cannot_run(self):
        argv = ["ai_review.py", "--repo", self.repo, "--base", "no-such-branch", "--branch"]
        with mock.patch.object(sys, "argv", argv), \
             mock.patch.object(ai_review.shutil, "which", return_value="/usr/local/bin/claude"), \
             contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
            self.assertEqual(ai_review.main(), 2)

    def test_exits_2_when_the_answer_has_no_findings_list(self):
        self.assertEqual(self.main({"summary": "S", "findings": None})[0], 2)

    def test_exits_2_when_no_review_could_be_produced(self):
        code, _ = self.main(None)
        self.assertEqual(code, 2)


if __name__ == "__main__":
    unittest.main()
