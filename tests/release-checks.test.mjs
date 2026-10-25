// CI's release checks: people get a package's change only when its version goes up.
import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const contains = (text, part, message) => assert.ok(text.includes(part), message ?? `expected to contain ${part}`);

describe("each package's version check in CI", () => {
  const script = join(root, 'tests/version-check.sh');
  const repos = [];
  afterEach(() => repos.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })));

  const git = (dir, ...args) => {
    const run = spawnSync('git', ['-c', 'user.name=test', '-c', 'user.email=test@example.dev', '-c', 'commit.gpgsign=false', ...args], {
      cwd: dir,
      encoding: 'utf8',
    });
    assert.equal(run.status, 0, run.stderr);
    return run.stdout.trim();
  };
  const write = (dir, version, skill, name = 'datashard') => {
    mkdirSync(join(dir, `plugins/${name}/.claude-plugin`), { recursive: true });
    writeFileSync(join(dir, `plugins/${name}/.claude-plugin/plugin.json`), JSON.stringify({ name, version }));
    writeFileSync(join(dir, `plugins/${name}/SKILL.md`), skill);
  };
  // A repository whose main holds the packages in `base` (name: version), and a branch that changes them.
  const repo = (base, change) => {
    const dir = mkdtempSync(join(tmpdir(), 'plugins-version-'));
    repos.push(dir);
    git(dir, 'init', '-q', '-b', 'main');
    writeFileSync(join(dir, 'README.md'), 'x');
    for (const [name, version] of Object.entries(base)) write(dir, version, 'one', name);
    git(dir, 'add', '-A');
    git(dir, 'commit', '-qm', 'base');
    git(dir, 'checkout', '-qb', 'change');
    change(dir);
    git(dir, 'add', '-A');
    git(dir, 'commit', '-qm', 'change', '--allow-empty');
    return dir;
  };
  const run = (dir, base = 'main') => spawnSync('bash', [script], { cwd: dir, env: { ...process.env, BASE: base }, encoding: 'utf8' });

  it('passes when a package changed and its version went up', () => {
    assert.equal(run(repo({ datashard: '1.0.0' }, (dir) => write(dir, '1.0.1', 'two'))).status, 0);
    assert.equal(run(repo({ datashard: '1.9.0' }, (dir) => write(dir, '1.10.0', 'two'))).status, 0);
  });

  it("fails when a package changed and its version didn't go up", () => {
    for (const version of ['1.0.0', '0.9.0']) {
      const result = run(repo({ datashard: '1.0.0' }, (dir) => write(dir, version, 'two')));
      assert.equal(result.status, 1);
      contains(result.stdout, 'above 1.0.0');
    }
  });

  it('passes when the packages are unchanged, or new on the branch', () => {
    assert.equal(run(repo({ datashard: '1.0.0' }, (dir) => writeFileSync(join(dir, 'README.md'), 'y'))).status, 0);
    assert.equal(run(repo({}, (dir) => write(dir, '0.1.0', 'one'))).status, 0);
  });

  it('holds each changed package to its own version, and leaves the others alone', () => {
    const base = { datashard: '1.0.0', mnem0nic: '0.1.0' };
    assert.equal(run(repo(base, (dir) => write(dir, '0.1.1', 'two', 'mnem0nic'))).status, 0);
    const both = run(
      repo(base, (dir) => {
        write(dir, '1.0.1', 'two');
        write(dir, '0.1.0', 'two', 'mnem0nic');
      }),
    );
    assert.equal(both.status, 1);
    contains(both.stdout, 'plugins/datashard/ changed, and its version went from 1.0.0 to 1.0.1');
    contains(both.stdout, "raise plugins/mnem0nic/.claude-plugin/plugin.json's version above 0.1.0");
  });

  it("falls back to the last release, and says so, when the given base can't be found", () => {
    const tagged = repo({ datashard: '1.0.0' }, (dir) => write(dir, '1.0.0', 'two'));
    git(tagged, 'tag', 'v1.0.0', 'main');
    const result = run(tagged, '0000000000000000000000000000000000000000');
    assert.equal(result.status, 1);
    contains(result.stdout, 'the last tag, v1.0.0');
  });

  it("fails, rather than passing unchecked, when the base can't be found and there is no release", () => {
    const untagged = run(repo({ datashard: '1.0.0' }, (dir) => write(dir, '1.0.1', 'two')), '0000000000000000000000000000000000000000');
    assert.equal(untagged.status, 1);
    contains(untagged.stdout, 'nothing was checked');
  });

  it("says what is missing when BASE isn't set", () => {
    const dir = repo({ datashard: '1.0.0' }, (dir) => write(dir, '1.0.1', 'two'));
    const result = spawnSync('bash', [script], { cwd: dir, env: { PATH: process.env.PATH }, encoding: 'utf8' });
    assert.notEqual(result.status, 0);
    contains(result.stderr, 'set BASE');
  });

  it("fails when the base's plugin.json is there but can't be read", () => {
    const dir = repo({ datashard: '1.0.0' }, (dir) => write(dir, '1.0.1', 'two'));
    git(dir, 'checkout', '-q', 'main');
    writeFileSync(join(dir, 'plugins/datashard/.claude-plugin/plugin.json'), '{ not json');
    git(dir, 'commit', '-qam', 'break');
    git(dir, 'checkout', '-qb', 'after-break');
    write(dir, '1.0.1', 'three');
    git(dir, 'commit', '-qam', 'change');
    assert.notEqual(run(dir).status, 0);
  });

  it('takes only x.y.z versions, as sort -V misorders pre-releases', () => {
    const result = run(repo({ datashard: '1.0.0' }, (dir) => write(dir, '1.0.1-rc1', 'two')));
    assert.equal(result.status, 1);
    contains(result.stdout, 'x.y.z');
  });
});

describe('the check of open pull requests after a push to main', () => {
  const script = join(root, 'tests/open-prs-check.sh');
  const dirs = [];
  afterEach(() => dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })));

  // A main holding `mainVersions` (package: version), and a stand-in gh that lists `prs`, serves each head's and
  // base branch's plugin.json per package, and logs statuses. A pull request's `versions` and a base's are
  // package: version.
  const setUp = (mainVersions, prs, bases = {}) => {
    const dir = mkdtempSync(join(tmpdir(), 'plugins-prs-'));
    dirs.push(dir);
    for (const [name, version] of Object.entries(mainVersions)) {
      mkdirSync(join(dir, `main/plugins/${name}/.claude-plugin`), { recursive: true });
      writeFileSync(join(dir, `main/plugins/${name}/.claude-plugin/plugin.json`), JSON.stringify({ version }));
    }
    mkdirSync(join(dir, 'main'), { recursive: true });
    for (const folder of ['bin', 'heads', 'files', 'failed']) mkdirSync(join(dir, folder));
    writeFileSync(
      join(dir, 'prs.json'),
      JSON.stringify(prs.map((pr) => ({ number: pr.number, headRefOid: pr.sha, baseRefName: pr.base ?? 'main' }))),
    );
    const serve = (ref, versions) => {
      for (const [name, version] of Object.entries(versions)) {
        mkdirSync(join(dir, 'heads', ref), { recursive: true });
        writeFileSync(join(dir, 'heads', ref, name), JSON.stringify({ name, version }));
      }
    };
    for (const pr of prs) {
      // No paths: the stand-in's file listing fails for this pull request, as a rate limit would.
      if (pr.paths.length) writeFileSync(join(dir, 'files', String(pr.number)), pr.paths.map((path) => `${path}\n`).join(''));
      serve(pr.sha, pr.versions ?? {});
      if (pr.failedBefore) writeFileSync(join(dir, 'failed', pr.sha), '');
    }
    for (const [branch, versions] of Object.entries(bases)) serve(branch, versions);
    writeFileSync(
      join(dir, 'bin/gh'),
      `#!/usr/bin/env bash
case "$1 $2" in
  "pr list") cat "${dir}/prs.json" ;;
  "api --paginate") number=\${3#*/pulls/}; cat "${dir}/files/\${number%%/*}" 2>/dev/null || { echo "rate limited" >&2; exit 1; } ;;
  "api -H") path=$6; package=\${path#*/contents/plugins/}; package=\${package%%/*}; ref=\${@: -1}; ref=\${ref#ref=}
    [ "$ref" = broken ] && { echo "gh: Server Error (HTTP 502)" >&2; exit 1; }
    [ -f "${dir}/heads/$ref/$package" ] && cat "${dir}/heads/$ref/$package" || { echo "gh: Not Found (HTTP 404)" >&2; exit 1; } ;;
  "api -X") echo "$@" >> "${dir}/statuses.log" ;;
  "api repos/"*) sha=\${2%/status}; sha=\${sha##*/}; [ -f "${dir}/failed/$sha" ] && echo 1 || echo 0 ;;
  *) echo "unexpected gh $*" >&2; exit 1 ;;
esac
`,
      { mode: 0o755 },
    );
    const run = spawnSync('bash', [script], {
      cwd: join(dir, 'main'),
      env: { PATH: `${join(dir, 'bin')}:${process.env.PATH}`, GITHUB_REPOSITORY: 'acme/plugins' },
      encoding: 'utf8',
    });
    const log = existsSync(join(dir, 'statuses.log')) ? readFileSync(join(dir, 'statuses.log'), 'utf8') : '';
    return { run, log };
  };

  it('fails a pull request whose package version main has caught up with, and passes one above it', () => {
    const { run, log } = setUp({ datashard: '0.13.1' }, [
      { number: 7, sha: 'aaa', paths: ['plugins/datashard/skills/init/SKILL.md'], versions: { datashard: '0.13.1' } },
      { number: 8, sha: 'bbb', paths: ['plugins/datashard/.claude-plugin/plugin.json'], versions: { datashard: '0.13.2' } },
    ]);
    assert.equal(run.status, 0, run.stderr);
    contains(log, 'repos/acme/plugins/statuses/aaa -f state=failure -f context=plugin version');
    contains(log, 'repos/acme/plugins/statuses/bbb -f state=success -f context=plugin version');
  });

  it("leaves pull requests that don't change a package alone", () => {
    const { run, log } = setUp({ datashard: '0.13.1' }, [{ number: 9, sha: 'ccc', paths: ['README.md', 'tests/plugins.test.mjs'] }]);
    assert.equal(run.status, 0, run.stderr);
    assert.equal(log, '');
  });

  it('checks every package a pull request changes, each against its own version on main', () => {
    const main = { datashard: '0.13.1', mnem0nic: '0.1.1' };
    const paths = ['plugins/datashard/x', 'plugins/mnem0nic/y'];
    const { log } = setUp(main, [
      { number: 20, sha: 'nnn', paths, versions: { datashard: '0.13.2', mnem0nic: '0.1.1' } },
      { number: 21, sha: 'ooo', paths, versions: { datashard: '0.13.2', mnem0nic: '0.1.2' } },
      { number: 22, sha: 'ppp', paths: ['plugins/new/z'], versions: { new: '0.1.0' } },
    ]);
    contains(log, "statuses/nnn -f state=failure -f context=plugin version -f description=Raise mnem0nic's plugin.json version above 0.1.1");
    contains(log, 'statuses/ooo -f state=success');
    contains(log, 'statuses/ppp -f state=success');
  });

  it('compares a stacked pull request with its own base branch, as its own CI does', () => {
    const { run, log } = setUp(
      { datashard: '0.13.1' },
      [
        { number: 16, sha: 'jjj', paths: ['plugins/datashard/x'], versions: { datashard: '0.14.0' }, base: 'feature' },
        { number: 17, sha: 'kkk', paths: ['plugins/datashard/x'], versions: { datashard: '0.14.1' }, base: 'feature' },
      ],
      { feature: { datashard: '0.14.0' } },
    );
    assert.equal(run.status, 0, run.stderr);
    contains(log, 'statuses/jjj -f state=failure');
    contains(log, 'statuses/kkk -f state=success');
  });

  it("holds a stacked pull request to main's version too, once main has moved past its base", () => {
    const { log } = setUp(
      { datashard: '0.14.5' },
      [{ number: 19, sha: 'mmm', paths: ['plugins/datashard/x'], versions: { datashard: '0.14.1' }, base: 'feature' }],
      { feature: { datashard: '0.14.0' } },
    );
    contains(log, 'statuses/mmm -f state=failure');
  });

  it("names a pull request whose base branch's version can't be read, rather than passing it", () => {
    const { run, log } = setUp({ datashard: '0.13.1' }, [
      { number: 18, sha: 'lll', paths: ['plugins/datashard/x'], versions: { datashard: '0.14.0' }, base: 'broken' },
    ]);
    assert.equal(log, '');
    assert.equal(run.status, 1);
    contains(run.stdout + run.stderr, '#18');
  });

  it('clears its own failure from a pull request that no longer changes a package', () => {
    const { run, log } = setUp({ datashard: '0.13.1' }, [{ number: 15, sha: 'iii', paths: ['README.md'], failedBefore: true }]);
    assert.equal(run.status, 0, run.stderr);
    contains(log, 'statuses/iii -f state=success -f context=plugin version');
  });

  it("fails a pull request whose version isn't x.y.z", () => {
    const { log } = setUp({ datashard: '0.13.1' }, [
      { number: 11, sha: 'eee', paths: ['plugins/datashard/x'], versions: { datashard: '0.14.0-rc1' } },
    ]);
    contains(log, 'statuses/eee -f state=failure');
  });

  it("goes on past a pull request it can't check, then fails the run naming it", () => {
    const fine = setUp({ datashard: '0.13.1' }, [{ number: 12, sha: 'fff', paths: ['plugins/datashard/x'], versions: { datashard: '0.13.2' } }]);
    assert.equal(fine.run.status, 0);
    const broken = setUp({ datashard: '0.13.1' }, [
      { number: 13, sha: 'ggg', paths: [], versions: { datashard: '0.13.2' } },
      { number: 14, sha: 'hhh', paths: ['plugins/datashard/x'], versions: { datashard: '0.13.2' } },
    ]);
    contains(broken.log, 'statuses/hhh -f state=success');
    assert.equal(broken.run.status, 1);
    contains(broken.run.stdout + broken.run.stderr, '#13');
  });

  it('fails a pull request that has no plugin.json', () => {
    const { run, log } = setUp({ datashard: '0.13.1' }, [{ number: 10, sha: 'ddd', paths: ['plugins/datashard/.claude-plugin/plugin.json'] }]);
    assert.equal(run.status, 0, run.stderr);
    contains(log, 'statuses/ddd -f state=failure');
  });
});
