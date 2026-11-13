// The pin: the check CI runs on pull requests and after a merge, the move that opens the pull request, and the labelling
// of pull requests that change a guarded file. They run on throwaway repositories, with a stand-in gh that answers from
// canned files. The repositories read no git configuration of the machine, and their commits are by a made-up author.
import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GUARD_LABEL, isGuarded } from './guarded.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const script = join(root, 'tests/pin.mjs');
const read = (path) => readFileSync(join(root, path), 'utf8');
const contains = (text, part, message) => assert.ok(text.includes(part), message ?? `expected to contain ${part}\n${text}`);
const lacks = (text, part, message) => assert.ok(!text.includes(part), message ?? `expected not to contain ${part}\n${text}`);
const days = (ago) => new Date(Date.now() - ago * 24 * 60 * 60 * 1000).toISOString();

// A gh that answers `gh api ... <path>` from the file named for the path in $GH_API (with / written as __), and
// `gh pr view <number>` from pr-view-<number> there, as a 404 where there is none, and logs every call. `gh pr create`
// prints a pull request address, or fails where GH_FAIL_CREATE is set. Any other command succeeds.
const standIn = `#!/usr/bin/env bash
echo "$*" >> "$GH_LOG"
answer() { [ -f "$1" ] && cat "$1" || { echo "gh: Not Found (HTTP 404)" >&2; exit 1; }; }
case "$1" in
  api)
    expression=""; previous=""
    for arg in "$@"; do
      case "$arg" in repos/*) path=$arg ;; esac
      [ "$previous" = --jq ] && expression=$arg
      previous=$arg
    done
    suffix=""
    case "$expression" in *changed_files*) suffix="__changed_files" ;; esac
    answer "$GH_API/\${path//\\//__}$suffix" ;;
  pr)
    case "$2" in
      view) answer "$GH_API/pr-view-$3" ;;
      create)
        [ -n "\${GH_FAIL_CREATE:-}" ] && { echo "gh: could not create the pull request" >&2; exit 1; }
        echo "https://github.com/acme/plugins/pull/99" ;;
    esac ;;
esac
`;

const dirs = [];
afterEach(() => dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })));

// No configuration of the machine reaches git here: not the global or system files, and so no name, email or signing key.
const hermetic = { GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' };
const git = (dir, ...args) => {
  const run = spawnSync('git', ['-c', 'user.name=Test Author', '-c', 'user.email=author@example.dev', '-c', 'commit.gpgsign=false', ...args], {
    cwd: dir,
    env: { ...process.env, ...hermetic },
    encoding: 'utf8',
  });
  assert.equal(run.status, 0, run.stderr);
  return run.stdout.trim();
};
const manifest = (name, version) => JSON.stringify({ name, version });
const catalog = (sources, extra = {}) =>
  `${JSON.stringify(
    {
      name: 'acme',
      owner: { name: 'Acme' },
      plugins: Object.entries(sources).map(([name, source]) => ({ name, source, description: `The ${name} package.` })),
      ...extra,
    },
    null,
    2,
  )}\n`;
const pin = (name, sha) => ({ source: 'git-subdir', url: 'datashard-ai/plugins', path: `plugins/${name}`, sha });
const pins = (sha) => catalog({ alpha: pin('alpha', sha), beta: pin('beta', sha) });
// The required checks of main: each named in `contexts`, and in `checks` with the app that reports it.
const requiring = (contexts, app_id = 15368, extra = {}) => ({ strict: true, contexts, checks: contexts.map((context) => ({ context, app_id })), ...extra });
const allowed = {
  protection: {
    required_pull_request_reviews: {},
    required_status_checks: requiring(['packages', 'pin-from-main']),
    allow_force_pushes: { enabled: false },
    enforce_admins: { enabled: true },
  },
};
// The ways a clone of the repository may name its origin.
const addresses = [
  'https://github.com/datashard-ai/plugins.git',
  'https://github.com/datashard-ai/plugins',
  'git@github.com:datashard-ai/plugins.git',
  'ssh://git@github.com/datashard-ai/plugins.git',
];
const base = (ref = 'main', repo = 'acme/plugins') => ({ ref, repo: { full_name: repo } });

// A bare "origin" and a clone of it, whose main holds two made-up packages and a marketplace pinning both to the
// first commit (or naming them by path, where `relative` is set). `work` is the clone, checked out on main. The clone
// names GitHub's address for its origin, which git rewrites to the throwaway one: `move` reads the address it is given.
function world({ versions = { alpha: '1.0.0', beta: '0.1.0' }, relative = false } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'plugins-pin-'));
  dirs.push(dir);
  const work = join(dir, 'work');
  const origin = join(dir, 'origin.git');
  for (const folder of ['bin', 'api']) mkdirSync(join(dir, folder));
  writeFileSync(join(dir, 'bin/gh'), standIn, { mode: 0o755 });
  git(dir, 'init', '-q', '--bare', '-b', 'main', 'origin.git');
  git(dir, 'clone', '-q', 'origin.git', 'work');

  const here = (...args) => git(work, ...args);
  for (const address of addresses) here('config', '--add', `url.${origin}.insteadOf`, address);
  here('remote', 'set-url', 'origin', addresses[0]);
  const commit = (files, message) => {
    for (const [path, body] of Object.entries(files)) {
      mkdirSync(dirname(join(work, path)), { recursive: true });
      writeFileSync(join(work, path), body);
    }
    here('add', '-A');
    here('commit', '-q', '-m', message);
    return here('rev-parse', 'HEAD');
  };
  const manifests = (all) => Object.fromEntries(Object.entries(all).map(([name, version]) => [`plugins/${name}/.claude-plugin/plugin.json`, manifest(name, version)]));
  const first = commit({ ...manifests(versions), 'README.md': 'start' }, 'Start the packages');
  const pinned = commit(
    { '.claude-plugin/marketplace.json': relative ? catalog({ alpha: './plugins/alpha', beta: './plugins/beta' }) : pins(first) },
    'Pin the packages',
  );
  here('push', '-q', 'origin', 'main');

  const file = (path, text) => writeFileSync(join(dir, 'api', path.replaceAll('/', '__')), text);
  const w = {
    dir,
    work,
    origin,
    first,
    pinned,
    here,
    commit,
    manifests,
    // Merge a commit into main and publish it.
    land: (files, message) => {
      const sha = commit(files, message);
      here('push', '-q', 'origin', 'main');
      return sha;
    },
    // Say, as the stand-in gh, that a commit's pull request was merged `ago` days ago, into `into`. Other pull
    // requests that don't have the commit as their merge commit sit beside it, as GitHub lists those too.
    merged: (sha, ago, into = base()) =>
      file(
        `repos/acme/plugins/commits/${sha}/pulls`,
        JSON.stringify([
          { number: 3, merge_commit_sha: 'f'.repeat(40), merged_at: days(40), base: base() },
          { number: 4, merge_commit_sha: sha, merged_at: null, base: base() },
          { number: 5, merge_commit_sha: sha, merged_at: days(ago), base: into },
        ]),
      ),
    api: (path, data) => file(path, JSON.stringify(data)),
    protection: (data) => file('repos/acme/plugins/branches/main/protection', JSON.stringify(data)),
    // What `gh api ... --jq` would print: a pull request's description, and the names of the files it changes.
    description: (number, text) => file(`repos/acme/plugins/pulls/${number}`, text),
    // Each file is a name, or [name, previous name]; the count GitHub gives for the pull request is theirs unless told.
    files: (number, entries, count = entries.length) => {
      file(`repos/acme/plugins/pulls/${number}/files`, entries.map((entry) => `${JSON.stringify([entry].flat())}\n`).join(''));
      file(`repos/acme/plugins/pulls/${number}__changed_files`, String(count));
    },
    // Say, as the stand-in gh, which labels a pull request has.
    labels: (number, names) => writeFileSync(join(dir, 'api', `pr-view-${number}`), JSON.stringify({ labels: names.map((name) => ({ name })) })),
    // The pull request's branch, from main, with this marketplace file (or other files).
    pull: (files) => {
      here('switch', '-q', '-c', 'change', 'main');
      return commit(typeof files === 'string' ? { '.claude-plugin/marketplace.json': files } : files, 'Change the marketplace');
    },
    log: () => (existsSync(join(dir, 'gh.log')) ? readFileSync(join(dir, 'gh.log'), 'utf8') : ''),
    run: (args, env = {}, cwd = work) =>
      spawnSync('node', [script, ...args], {
        cwd,
        env: {
          ...process.env,
          ...hermetic,
          PATH: `${join(dir, 'bin')}:${process.env.PATH}`,
          GH_LOG: join(dir, 'gh.log'),
          GH_API: join(dir, 'api'),
          GH_TOKEN: 'token',
          GITHUB_REPOSITORY: 'acme/plugins',
          GITHUB_STEP_SUMMARY: '',
          BASE: 'origin/main',
          PR_BODY: '',
          PR_NUMBER: '',
          PIN_TEST_REPO: 'acme/plugins',
          ...env,
        },
        encoding: 'utf8',
      }),
    summary: join(dir, 'summary.md'),
  };
  w.check = (env) => w.run(['check'], env);
  return w;
}
const output = (run) => run.stdout + run.stderr;

describe('the pin check on a pull request', () => {
  // A world whose main moved on from the pin by one change of alpha, merged `ago` days ago, with a pull request that
  // moves both pins to it.
  const moved = (ago, { version = '1.1.0', ...options } = {}) => {
    const w = world(options);
    const sha = w.land({ ...w.manifests({ alpha: version }), 'plugins/alpha/skills/one/SKILL.md': 'changed' }, 'Change alpha');
    w.merged(sha, ago);
    w.pull(pins(sha));
    return { w, sha };
  };

  it('fails a pin to a commit whose pull request was merged less than 7 days ago', () => {
    const { w, sha } = moved(2);
    const run = w.check();
    assert.equal(run.status, 1, output(run));
    contains(run.stdout, `alpha: ${sha.slice(0, 7)}: pull request #5 merged`);
    contains(run.stdout, 'less than 7 days ago');
    contains(run.stdout, 'beta: ');
    contains(run.stdout, 'Urgent: <reason>');
  });

  it('passes the same pin with an Urgent line, and prints the reason', () => {
    const { w } = moved(2);
    for (const body of ["Fixes the login.\nUrgent: the login fix can't wait\nThanks", "Urgent: the login fix can't wait\r\nThanks\r\n"]) {
      const run = w.check({ PR_BODY: body });
      assert.equal(run.status, 0, output(run));
      contains(run.stdout, "Pinned early: the login fix can't wait");
      assert.doesNotMatch(run.stdout, /Pinned early: .*\r/);
    }
  });

  it('wants a reason after Urgent, at the start of a line', () => {
    const { w } = moved(2);
    for (const body of ['Urgent:', 'Urgent: ', 'Urgent:   \nbut later', 'urgent: yes', 'Not Urgent: yes', '- Urgent: yes']) {
      assert.equal(w.check({ PR_BODY: body }).status, 1, body);
    }
    // A carriage return inside a line, as a commit subject might hold one, starts no line.
    for (const body of ['- abc1234 Fix a thing\rUrgent: skip the wait', 'A line\rUrgent: skip the wait\n', '\rUrgent: skip the wait']) {
      assert.equal(w.check({ PR_BODY: body }).status, 1, JSON.stringify(body));
    }
    assert.equal(w.check({ PR_BODY: 'Fine\r\nUrgent: a real line\r\n' }).status, 0);
  });

  it("reads the description through the API when it runs, so an edit counts and PR_BODY doesn't", () => {
    const { w } = moved(2);
    w.description(12, "Urgent: it can't wait\n");
    let run = w.check({ PR_NUMBER: '12', PR_BODY: 'The description when the run began, without a reason.' });
    assert.equal(run.status, 0, output(run));
    contains(run.stdout, "Pinned early: it can't wait");
    contains(w.log(), 'api repos/acme/plugins/pulls/12 --jq .body // ""');
    w.description(12, 'The reason was edited out.\n');
    run = w.check({ PR_NUMBER: '12', PR_BODY: 'Urgent: a stale reason' });
    assert.equal(run.status, 1, output(run));
    w.description(12, '');
    assert.equal(w.check({ PR_NUMBER: '12' }).status, 1);
  });

  it("fails, saying why, where the description can't be read", () => {
    const { w } = moved(2);
    const run = w.check({ PR_NUMBER: '12', PR_BODY: 'Urgent: a reason that is not read' });
    assert.equal(run.status, 1, output(run));
    contains(run.stdout, "the description of #12 can't be read");
    assert.equal(w.check({ PR_NUMBER: 'twelve' }).status, 1);
  });

  it("doesn't read the description when the pin has waited or hasn't moved", () => {
    assert.doesNotMatch(
      (() => {
        const { w } = moved(30);
        assert.equal(w.check({ PR_NUMBER: '12' }).status, 0);
        return w.log();
      })(),
      /pulls\/12/,
    );
    const w = world();
    w.pull({ 'README.md': 'changed' });
    assert.equal(w.check({ PR_NUMBER: '12' }).status, 0);
    assert.equal(w.log(), '');
  });

  it('passes a pin to a commit merged 7 days ago, and one merged long ago', () => {
    for (const ago of [7.01, 30]) {
      const run = moved(ago).w.check();
      assert.equal(run.status, 0, output(run));
      contains(run.stdout, 'pull request #5 merged');
      lacks(run.stdout, 'Pinned early');
    }
  });

  it('counts only a merged pull request into main of this repository for the age', () => {
    const { w, sha } = moved(30);
    for (const into of [base('feature'), base('main', 'someone/plugins'), {}]) {
      w.merged(sha, 30, into);
      const run = w.check();
      assert.equal(run.status, 1, output(run));
      contains(run.stdout, 'its age is unknown');
    }
    w.merged(sha, 30);
    assert.equal(w.check().status, 0);
  });

  it("fails a pin to a commit that isn't on the base branch, even with an Urgent line", () => {
    const w = world();
    w.here('switch', '-q', '-c', 'change', 'main');
    const sha = w.commit({ ...w.manifests({ alpha: '1.1.0' }), 'plugins/alpha/skills/one/SKILL.md': 'unmerged' }, 'Change alpha');
    w.merged(sha, 30);
    w.commit({ '.claude-plugin/marketplace.json': pins(sha) }, 'Pin it');
    const run = w.check({ PR_BODY: 'Urgent: now' });
    assert.equal(run.status, 1, output(run));
    contains(run.stdout, `${sha.slice(0, 7)} is not a commit of origin/main`);
  });

  it("fails a pin to a commit it can't find", () => {
    const w = world();
    w.pull(pins('1'.repeat(40)));
    const run = w.check();
    assert.equal(run.status, 1, output(run));
    contains(run.stdout, "can't be found in this checkout");
  });

  it("fails when no merged pull request has the commit, or the lookup fails, unless there's an Urgent line", () => {
    const { w, sha } = moved(30);
    w.api(`repos/acme/plugins/commits/${sha}/pulls`, [{ number: 6, merge_commit_sha: 'e'.repeat(40), merged_at: days(30), base: base() }]);
    let run = w.check();
    assert.equal(run.status, 1, output(run));
    contains(run.stdout, 'its age is unknown');
    assert.equal(w.check({ PR_BODY: 'Urgent: the reason' }).status, 0);
    rmSync(join(w.dir, 'api', `repos__acme__plugins__commits__${sha}__pulls`));
    run = w.check();
    assert.equal(run.status, 1, output(run));
    contains(run.stdout, "can't be looked up");
    assert.equal(w.check({ PR_BODY: 'Urgent: the reason' }).status, 0);
  });

  it("fails a pin that lowers a package's version, and passes one that keeps it or raises it", () => {
    const lower = moved(30, { version: '0.9.0' }).w.check();
    assert.equal(lower.status, 1, output(lower));
    contains(lower.stdout, 'alpha: its version goes down, from 1.0.0');
    contains(lower.stdout, 'to 0.9.0');
    lacks(lower.stdout, 'beta: its version');
    assert.equal(moved(30, { version: '1.0.0' }).w.check().status, 0);
    assert.equal(moved(30, { version: '1.0.1' }).w.check().status, 0);
  });

  it('orders versions by their numbers, so 1.10.0 is above 1.9.0', () => {
    const w = moved(30, { version: '1.10.0', versions: { alpha: '1.9.0', beta: '0.1.0' } }).w;
    const run = w.check();
    assert.equal(run.status, 0, output(run));
    const down = moved(30, { version: '1.9.0', versions: { alpha: '1.10.0', beta: '0.1.0' } }).w.check();
    assert.equal(down.status, 1, output(down));
  });

  it("fails a package whose version can't be read at the new pin", () => {
    const { w } = moved(30, { version: '1.1.0-rc1' });
    const run = w.check();
    assert.equal(run.status, 1, output(run));
    contains(run.stdout, 'use x.y.z');
  });

  describe('the first pin, from paths', () => {
    it('passes, with no other pin to compare with', () => {
      const { w } = moved(30, { relative: true });
      const run = w.check();
      assert.equal(run.status, 0, output(run));
      contains(run.stdout, 'the pin moves from a path to');
    });

    it('may come with other changes: it is not a move of a pin', () => {
      const { w } = moved(30, { relative: true });
      w.commit({ 'tests/pin.mjs': 'a different check' }, 'Change the check');
      assert.equal(w.check().status, 0);
    });

    it("fails where it would take people back to a lower version than main has now", () => {
      const w = world({ relative: true });
      const older = w.land({ ...w.manifests({ alpha: '0.9.0' }), 'plugins/alpha/skills/one/SKILL.md': 'older' }, 'Older alpha');
      w.land(w.manifests({ alpha: '1.2.0' }), 'Newer alpha');
      w.merged(older, 30);
      w.pull(pins(older));
      const run = w.check();
      assert.equal(run.status, 1, output(run));
      contains(run.stdout, 'alpha: its version goes down, from 1.2.0 on origin/main to 0.9.0 at');
      lacks(run.stdout, 'beta: its version');
    });

    it('passes where the version is the one main has, or higher', () => {
      const w = world({ relative: true });
      const pinnable = w.land({ ...w.manifests({ alpha: '1.2.0' }), 'plugins/alpha/skills/one/SKILL.md': 'same' }, 'Alpha 1.2.0');
      w.land({ 'plugins/alpha/skills/one/SKILL.md': 'later, same version' }, 'Later');
      w.merged(pinnable, 30);
      w.pull(pins(pinnable));
      const run = w.check();
      assert.equal(run.status, 0, output(run));
    });
  });

  it('passes when no pin changed, and asks gh nothing', () => {
    const w = world();
    w.pull({ 'README.md': 'changed', 'plugins/alpha/skills/one/SKILL.md': 'changed' });
    const run = w.check();
    assert.equal(run.status, 0, output(run));
    contains(run.stdout, 'The pins are unchanged.');
    assert.equal(w.log(), '');
  });

  it('fails an entry that is not a pin to a commit of this repository', () => {
    const sha = 'a'.repeat(40);
    const cases = [
      ['a path', './plugins/alpha', 'source is "./plugins/alpha", not a pin to a commit'],
      ['another kind of source', { ...pin('alpha', sha), source: 'github' }, 'source.source is "github"'],
      ['another repository', { ...pin('alpha', sha), url: 'someone/else' }, 'source.url is "someone/else"'],
      ['another folder', { ...pin('alpha', sha), path: 'plugins/beta' }, 'source.path is "plugins/beta", not "plugins/alpha"'],
      ['a short hash', { ...pin('alpha', sha), sha: 'aaaaaaa' }, 'not 40 lowercase hexadecimal digits'],
      ['capital letters', { ...pin('alpha', sha), sha: 'A'.repeat(40) }, 'not 40 lowercase hexadecimal digits'],
      ['no hash', { source: 'git-subdir', url: 'datashard-ai/plugins', path: 'plugins/alpha' }, 'source.sha is undefined'],
      ['a branch beside the hash', { ...pin('alpha', sha), ref: 'main' }, 'source holds "ref" besides'],
    ];
    for (const [what, source, problem] of cases) {
      const w = world();
      w.pull(catalog({ alpha: source, beta: pin('beta', w.first) }));
      const run = w.check();
      assert.equal(run.status, 1, `${what}: ${output(run)}`);
      assert.ok(run.stdout.split('\n').some((line) => line.startsWith('alpha: ') && line.includes(problem)), `${what}:\n${run.stdout}`);
    }
  });

  it('fails an entry that carries anything besides its name, description and pin', () => {
    // Each of these would reach everyone who reads main, with no pin and no wait.
    for (const [key, value] of [['hooks', {}], ['mcpServers', {}], ['commands', ['x']], ['agents', ['x']], ['lspServers', {}], ['strict', false], ['version', '9.9.9']]) {
      const w = world();
      const file = JSON.parse(pins(w.first));
      file.plugins[0][key] = value;
      w.pull(`${JSON.stringify(file, null, 2)}\n`);
      const run = w.check();
      assert.equal(run.status, 1, `${key}: ${output(run)}`);
      contains(run.stdout, `alpha: holds "${key}" besides name, description, source`);
    }
  });

  it('fails a marketplace file that holds anything besides its name, owner, description and plugins', () => {
    for (const extra of [{ metadata: { pluginRoot: './elsewhere' } }, { strict: false }, { hooks: {} }]) {
      const w = world();
      w.pull(catalog({ alpha: pin('alpha', w.first), beta: pin('beta', w.first) }, extra));
      const run = w.check();
      assert.equal(run.status, 1, output(run));
      contains(run.stdout, `.claude-plugin/marketplace.json holds "${Object.keys(extra)[0]}" besides name, owner, description, plugins`);
    }
  });

  it('fails packages pinned to different commits, which move together', () => {
    const { w, sha } = moved(30);
    w.commit({ '.claude-plugin/marketplace.json': catalog({ alpha: pin('alpha', sha), beta: pin('beta', w.first) }) }, 'Pin apart');
    const run = w.check();
    assert.equal(run.status, 1, output(run));
    contains(run.stdout, 'The packages are pinned to different commits');
    contains(run.stdout, `${sha.slice(0, 7)}`);
  });

  it('fails an entry whose name is not lowercase letters, digits and hyphens, and prints it on its own line', () => {
    const { w } = moved(30);
    const names = ['alpha\nbeta: pinned 7 days ago, fine', 'Alpha', 'alpha/../beta', '', '-alpha', 'alpha beta', 7, null, ['alpha'], { name: 'alpha' }];
    for (const name of names) {
      const file = JSON.parse(pins(w.first));
      file.plugins[0].name = name;
      w.commit({ '.claude-plugin/marketplace.json': `${JSON.stringify(file, null, 2)}\n` }, 'Rename an entry');
      const run = w.check();
      assert.equal(run.status, 1, `${JSON.stringify(name)}: ${output(run)}`);
      const problem = run.stdout.split('\n').filter((line) => line.includes('which is not lowercase letters, digits and hyphens'));
      assert.deepEqual(problem, [`${JSON.stringify(name)}: has the name ${JSON.stringify(name)}, which is not lowercase letters, digits and hyphens`], JSON.stringify(name));
      // Nothing in a name starts a line of its own.
      assert.ok(!run.stdout.split('\n').some((line) => line.startsWith('beta: pinned 7 days ago')), JSON.stringify(name));
    }
  });

  it('fails an entry without a name, and prints the keys it holds besides the allowed ones on one line', () => {
    const { w } = moved(30);
    const file = JSON.parse(pins(w.first));
    delete file.plugins[0].name;
    file['evil\nalpha: fine'] = true;
    w.commit({ '.claude-plugin/marketplace.json': `${JSON.stringify(file, null, 2)}\n` }, 'Drop a name');
    const run = w.check();
    assert.equal(run.status, 1, output(run));
    contains(run.stdout, '(an entry without a name): has no name');
    contains(run.stdout, 'holds "evil\\nalpha: fine" besides name, owner, description, plugins');
    assert.ok(!run.stdout.split('\n').some((line) => line.startsWith('alpha: fine')));
  });

  describe('a pull request that moves a pin', () => {
    it('changes nothing else: not another file, such as the check itself', () => {
      const { w } = moved(30);
      w.commit({ 'tests/pin.mjs': 'a weaker check', 'plugins/alpha/skills/one/SKILL.md': 'changed too' }, 'Slip it in');
      const run = w.check();
      assert.equal(run.status, 1, output(run));
      contains(run.stdout, 'A pull request that moves the pin changes only .claude-plugin/marketplace.json: this one also changes "plugins/alpha/skills/one/SKILL.md", "tests/pin.mjs"');
    });

    it('changes nothing in the marketplace file but the sha values', () => {
      const { w, sha } = moved(30);
      w.commit({ '.claude-plugin/marketplace.json': pins(sha).replace('The alpha package.', 'A different description.') }, 'Reword it');
      const run = w.check();
      assert.equal(run.status, 1, output(run));
      contains(run.stdout, 'changes only the sha values in .claude-plugin/marketplace.json: this one changes more');
    });

    it('passes when the shas are all it changes', () => {
      const { w } = moved(30);
      const run = w.check();
      assert.equal(run.status, 0, output(run));
      lacks(run.stdout, 'changes only');
    });
  });

  describe('with --head, as the pin-from-main check runs it', () => {
    // main after a commit merged 30 days ago and one merged 2 days ago, and two pull requests from it, one pinning each:
    // `good` and `bad` are their heads, `old` and `young` the commits they pin.
    const twoPulls = () => {
      const w = world();
      const old = w.land({ ...w.manifests({ alpha: '1.1.0' }), 'plugins/alpha/skills/one/SKILL.md': 'old' }, 'Change alpha');
      const young = w.land({ ...w.manifests({ alpha: '1.2.0' }), 'plugins/alpha/skills/one/SKILL.md': 'young' }, 'Change alpha again');
      w.merged(old, 30);
      w.merged(young, 2);
      const heads = {};
      for (const [name, sha] of [['good', old], ['bad', young]]) {
        w.here('switch', '-q', '-c', name, 'main');
        heads[name] = w.commit({ '.claude-plugin/marketplace.json': pins(sha) }, `Pin ${name}`);
      }
      return { w, old, young, ...heads };
    };

    it('reads the commit it is given, not the working tree: a bad pin in the tree and a good one in the head passes', () => {
      const { w, good, bad } = twoPulls();
      w.here('switch', '-q', 'bad');
      let run = w.run(['check', '--head', good]);
      assert.equal(run.status, 0, output(run));
      contains(run.stdout, 'pull request #5 merged');
      // Without --head the working tree is read, as before.
      assert.equal(w.check().status, 1);
      run = w.run(['check', '--head', bad]);
      assert.equal(run.status, 1, output(run));
      contains(run.stdout, 'less than 7 days ago');
    });

    it('reads the commit it is given, not the working tree: a good pin in the tree and a bad one in the head fails', () => {
      const { w, good, bad, young } = twoPulls();
      w.here('switch', '-q', 'good');
      const run = w.run(['check', '--head', bad]);
      assert.equal(run.status, 1, output(run));
      contains(run.stdout, `alpha: ${young.slice(0, 7)}: pull request #5 merged`);
      assert.equal(w.check().status, 0);
      // An edit of the working tree that is not committed is not read either.
      writeFileSync(join(w.work, '.claude-plugin/marketplace.json'), pins(young));
      assert.equal(w.check().status, 1);
      const unchanged = w.run(['check', '--head', good]);
      assert.equal(unchanged.status, 0, output(unchanged));
    });

    it("lists the files the head changes against the base, not the working tree's", () => {
      const { w } = moved(30);
      const head = w.commit({ 'plugins/alpha/skills/one/SKILL.md': 'changed too' }, 'Slip it in');
      w.here('switch', '-q', 'main');
      const run = w.run(['check', '--head', head]);
      assert.equal(run.status, 1, output(run));
      contains(run.stdout, 'this one also changes "plugins/alpha/skills/one/SKILL.md"');
    });

    it("is not weakened by a head that edits the check to pass and moves the pin to a commit that hasn't waited", () => {
      const { w, sha } = moved(2);
      const weakened = w.commit({ 'tests/pin.mjs': 'process.exit(0);\n' }, 'Weaken the check');
      // The head's own copy of the check passes it, which is what ci.yml would run on a pull request...
      const own = spawnSync('node', ['tests/pin.mjs', 'check'], { cwd: w.work, encoding: 'utf8' });
      assert.equal(own.status, 0, own.stderr);
      // ...and main's copy, run from a checkout of the base with the head as data, doesn't.
      w.here('switch', '-q', 'main');
      assert.equal(existsSync(join(w.work, 'tests/pin.mjs')), false);
      const run = w.run(['check', '--head', weakened]);
      assert.equal(run.status, 1, output(run));
      contains(run.stdout, `alpha: ${sha.slice(0, 7)}: pull request #5 merged`);
      contains(run.stdout, 'less than 7 days ago');
      contains(run.stdout, 'this one also changes "tests/pin.mjs"');
      // Nothing of the head was written to the tree.
      assert.equal(existsSync(join(w.work, 'tests/pin.mjs')), false);
      assert.equal(w.here('status', '--porcelain'), '');
    });

    it('needs a full lowercase hash of a commit in the checkout that holds the marketplace file', () => {
      const { w } = moved(30);
      const hash = 'a'.repeat(40);
      for (const args of [['--head'], ['--head', 'HEAD'], ['--head', 'change'], ['--head', hash.slice(0, 7)], ['--head', '--help'], ['--head', hash.toUpperCase()], ['--head', hash, '--head', hash]]) {
        const run = w.run(['check', ...args]);
        assert.equal(run.status, 1, args.join(' '));
        contains(run.stderr, 'Usage: node tests/pin.mjs check');
      }
      let run = w.run(['check', '--head', hash]);
      assert.equal(run.status, 1, output(run));
      contains(run.stderr, 'is not a commit in this checkout');
      run = w.run(['check', '--head', w.first]);
      assert.equal(run.status, 1, output(run));
      contains(run.stderr, `.claude-plugin/marketplace.json can't be read at ${w.first.slice(0, 7)}`);
    });
  });

  describe('looks BASE up once, as the commit it names', () => {
    // A tag called origin/main at the commit that holds the moved pin: `origin/main` names the tag, `refs/remotes/origin/main`
    // the branch, and CI gives the full name.
    const shadowed = () => {
      const { w, sha } = moved(2);
      const head = w.here('rev-parse', 'HEAD');
      w.here('tag', 'origin/main', head);
      return { w, sha, head };
    };

    it('still sees the move when a tag is called like the base branch, given its full name', () => {
      const { w, sha, head } = shadowed();
      // The short name does name the tag here, which is why CI gives the full name.
      assert.equal(w.here('rev-parse', 'origin/main'), head);
      assert.notEqual(w.here('rev-parse', 'refs/remotes/origin/main'), head);
      const run = w.check({ BASE: 'refs/remotes/origin/main' });
      assert.equal(run.status, 1, output(run));
      contains(run.stdout, `alpha: the pin moves from ${w.first.slice(0, 7)} to ${sha.slice(0, 7)}`);
      contains(run.stdout, 'less than 7 days ago');
      // The pin it is judged against is the base branch's own, so the pin is a commit of it, and its versions compare.
      lacks(run.stdout, 'is not a commit of');
    });

    it('judges against the commit it found, and names BASE as it was given', () => {
      const w = world({ relative: true });
      const older = w.land({ ...w.manifests({ alpha: '0.9.0' }), 'plugins/alpha/skills/one/SKILL.md': 'older' }, 'Older alpha');
      w.land(w.manifests({ alpha: '1.2.0' }), 'Newer alpha');
      w.merged(older, 30);
      w.pull(pins(older));
      w.here('tag', 'origin/main', w.here('rev-parse', 'HEAD'));
      const run = w.check({ BASE: 'refs/remotes/origin/main' });
      assert.equal(run.status, 1, output(run));
      contains(run.stdout, 'alpha: its version goes down, from 1.2.0 on refs/remotes/origin/main to 0.9.0 at');
    });

    it('takes a commit hash as BASE, as after a merge, and fails a name that is no commit, or looks like an option', () => {
      const { w } = moved(30);
      const base = w.here('rev-parse', 'refs/remotes/origin/main');
      assert.equal(w.check({ BASE: base }).status, 0);
      for (const name of ['--help', '--output=x', '-n', 'refs/remotes/origin/nothing', base.slice(0, 7).replace(/[0-9a-f]/g, 'z')]) {
        const run = w.check({ BASE: name });
        assert.equal(run.status, 1, name);
        contains(run.stderr, `${name} can't be found`);
      }
      assert.equal(existsSync(join(w.work, 'x')), false);
    });
  });

  it("fails when BASE isn't set or can't be found, or an argument is unknown", () => {
    const w = world();
    w.pull({ 'README.md': 'changed' });
    assert.equal(w.check({ BASE: '' }).status, 1);
    const run = w.check({ BASE: 'origin/nothing' });
    assert.equal(run.status, 1);
    contains(run.stderr, "origin/nothing can't be found");
    assert.equal(w.run(['check', '--before-merge']).status, 1);
  });

  describe('writes the job summary', () => {
    const files = { 'README.md': 'changed', 'plugins/alpha/README.md': 'changed', 'plugins/alpha/skills/one/SKILL.md': 'changed again', 'tests/pin.mjs': 'changed' };

    it('with the pin and the guarded files this pull request changes', () => {
      const { w, sha } = moved(30, { relative: true });
      w.commit(files, 'Change more');
      const run = w.check({ GITHUB_STEP_SUMMARY: w.summary });
      assert.equal(run.status, 0, output(run));
      const summary = readFileSync(w.summary, 'utf8');
      contains(summary, "## Changes to what runs on people's machines");
      contains(summary, `- \`alpha\`: from a path to \`${sha.slice(0, 7)}\``);
      for (const guarded of ['.claude-plugin/marketplace.json', 'plugins/alpha/skills/one/SKILL.md', 'tests/pin.mjs']) contains(summary, `- \`${guarded}\``);
      for (const document of ['README.md', 'plugins/alpha/README.md']) lacks(summary, `\`${document}\``);
      lacks(summary, '### Problems');
    });

    it('also when the check fails, with the problems', () => {
      const { w } = moved(2);
      w.commit(files, 'Change more');
      const run = w.check({ GITHUB_STEP_SUMMARY: w.summary });
      assert.equal(run.status, 1, output(run));
      const summary = readFileSync(w.summary, 'utf8');
      contains(summary, '### Problems');
      contains(summary, 'less than 7 days ago');
      contains(summary, '- `tests/pin.mjs`');
    });

    it('and says so when only documents change', () => {
      const w = world();
      w.pull({ 'README.md': 'changed', 'MAINTAINING.md': 'changed' });
      assert.equal(w.check({ GITHUB_STEP_SUMMARY: w.summary }).status, 0);
      const summary = readFileSync(w.summary, 'utf8');
      contains(summary, 'The pins are unchanged.');
      contains(summary, 'None: only the READMEs');
    });
  });
});

describe('the pin check after a merge', () => {
  // main as it was before a pull request that moves the pin merged (`before`), and after. The pull request is merged
  // `ago` days after its commit; the check never asks.
  const merged = (ago, { version = '1.1.0' } = {}) => {
    const w = world();
    const sha = w.land({ ...w.manifests({ alpha: version }), 'plugins/alpha/skills/one/SKILL.md': 'changed' }, 'Change alpha');
    w.merged(sha, ago);
    const before = w.here('rev-parse', 'HEAD');
    w.land({ '.claude-plugin/marketplace.json': pins(sha) }, 'Move the pin');
    return { w, sha, before };
  };
  const after = (w, before, env = {}) => w.run(['check', '--after-merge'], { BASE: before, ...env });

  it('passes a pin merged early, without an Urgent line, and never asks how old the commit is', () => {
    const { w, before } = merged(2);
    const run = after(w, before);
    assert.equal(run.status, 0, output(run));
    contains(run.stdout, 'its age is not checked after the merge');
    lacks(run.stdout, 'less than 7 days');
    assert.equal(w.log(), '');
    // The same pin does not pass as a pull request would.
    assert.equal(w.run(['check'], { BASE: before }).status, 1);
  });

  it('reads the commit it is given with --head, with the arguments in either order', () => {
    const { w, before } = merged(2);
    const head = w.here('rev-parse', 'HEAD');
    // The working tree is main before the pin moved: it alone shows no move.
    w.here('switch', '-q', '-c', 'earlier', before);
    contains(after(w, before).stdout, 'The pins are unchanged.');
    for (const args of [['--after-merge', '--head', head], ['--head', head, '--after-merge']]) {
      const run = w.run(['check', ...args], { BASE: before });
      assert.equal(run.status, 0, output(run));
      contains(run.stdout, 'its age is not checked after the merge');
    }
  });

  it('writes the pin change to the job summary', () => {
    const { w, sha, before } = merged(2);
    assert.equal(after(w, before, { GITHUB_STEP_SUMMARY: w.summary }).status, 0);
    const summary = readFileSync(w.summary, 'utf8');
    contains(summary, "## Changes to what runs on people's machines (after the merge)");
    contains(summary, `- \`alpha\`: from \`${w.first.slice(0, 7)}\` to \`${sha.slice(0, 7)}\``);
    contains(summary, '- `.claude-plugin/marketplace.json`');
  });

  it('passes when the pin did not move', () => {
    const w = world();
    const before = w.here('rev-parse', 'HEAD');
    w.land({ 'README.md': 'changed' }, 'Edit the readme');
    const run = after(w, before);
    assert.equal(run.status, 0, output(run));
    contains(run.stdout, 'The pins are unchanged.');
  });

  it('fails a pin to a commit that is not on main', () => {
    const w = world();
    const before = w.here('rev-parse', 'HEAD');
    w.here('switch', '-q', '-c', 'side', 'main');
    const stray = w.commit({ ...w.manifests({ alpha: '1.1.0' }), 'plugins/alpha/skills/one/SKILL.md': 'stray' }, 'Only on a branch');
    w.here('switch', '-q', 'main');
    w.land({ '.claude-plugin/marketplace.json': pins(stray) }, 'Move the pin');
    const run = after(w, before);
    assert.equal(run.status, 1, output(run));
    contains(run.stdout, `${stray.slice(0, 7)} is not a commit of main`);
  });

  it('fails a pin that lowers a version, a malformed entry, an entry with more than a pin, and mixed pins', () => {
    const { w, before } = merged(30, { version: '0.9.0' });
    const lower = after(w, before);
    assert.equal(lower.status, 1, output(lower));
    contains(lower.stdout, 'alpha: its version goes down, from 1.0.0');

    const withHooks = JSON.parse(pins(w.first));
    for (const entry of withHooks.plugins) entry.hooks = {};
    for (const [what, file] of [
      ['a path', catalog({ alpha: './plugins/alpha', beta: pin('beta', w.first) })],
      ['hooks', `${JSON.stringify(withHooks, null, 2)}\n`],
    ]) {
      const previous = w.here('rev-parse', 'HEAD');
      w.land({ '.claude-plugin/marketplace.json': file }, `Reach main: ${what}`);
      const run = after(w, previous);
      assert.equal(run.status, 1, `${what}: ${output(run)}`);
    }

    const mixed = world();
    const mixedBefore = mixed.here('rev-parse', 'HEAD');
    const sha = mixed.land(mixed.manifests({ alpha: '1.1.0' }), 'Change alpha');
    mixed.land({ '.claude-plugin/marketplace.json': catalog({ alpha: pin('alpha', sha), beta: pin('beta', mixed.first) }) }, 'Pin apart');
    const apart = after(mixed, mixedBefore);
    assert.equal(apart.status, 1, output(apart));
    contains(apart.stdout, 'pinned to different commits');
  });

  it('still fails a pin move that changes more than the pins', () => {
    const w = world();
    const sha = w.land({ ...w.manifests({ alpha: '1.1.0' }), 'plugins/alpha/skills/one/SKILL.md': 'changed' }, 'Change alpha');
    const before = w.here('rev-parse', 'HEAD');
    w.land({ '.claude-plugin/marketplace.json': pins(sha), 'tests/pin.mjs': 'a weaker check' }, 'Move the pin and more');
    const run = after(w, before);
    assert.equal(run.status, 1, output(run));
    contains(run.stdout, 'changes only .claude-plugin/marketplace.json');
  });
});

describe('moving the pin', () => {
  // main after the pin: a commit merged 20 days ago, one 9 days ago, and one 3 days ago, after the commit that pins.
  const history = (options) => {
    const w = world(options);
    w.protection(allowed.protection);
    w.merged(w.pinned, 30);
    const mid = w.land({ 'plugins/alpha/README.md': 'doc', ...w.manifests({ alpha: '1.1.0' }) }, 'Document alpha');
    const second = w.land({ 'plugins/alpha/skills/one/SKILL.md': 'second' }, 'Teach alpha a skill');
    const newest = w.land({ 'plugins/beta/hooks/hooks.json': '{}' }, 'Hook beta');
    w.merged(mid, 20);
    w.merged(second, 9);
    w.merged(newest, 3);
    return { w, mid, second, newest };
  };
  const move = (w, args = [], env = {}) => w.run(['move', '--dry-run', ...args], env);

  it('refuses unless main requires pull requests, the packages and pin-from-main checks up to date, no force pushes, and holds administrators', () => {
    const { w } = history();
    const good = allowed.protection;
    const both = ['packages', 'pin-from-main'];
    const cases = [
      [{ ...good, required_pull_request_reviews: undefined }, 'pull requests are not required'],
      [{ ...good, required_status_checks: requiring(['lint']) }, 'the "packages" check is not required'],
      [{ ...good, required_status_checks: requiring(['lint']) }, 'the "pin-from-main" check is not required'],
      [{ ...good, required_status_checks: undefined }, 'the "packages" check is not required'],
      [{ ...good, required_status_checks: undefined }, 'the "pin-from-main" check is not required'],
      // main's copy of the check is required as well as the pull request's own: one of them is not enough.
      [{ ...good, required_status_checks: requiring(['packages']) }, 'the "pin-from-main" check is not required'],
      [{ ...good, required_status_checks: requiring(['pin-from-main']) }, 'the "packages" check is not required'],
      [{ ...good, allow_force_pushes: { enabled: true } }, 'force pushes to main are allowed'],
      [{ ...good, allow_force_pushes: undefined }, 'force pushes to main are allowed'],
      [{ ...good, required_status_checks: { contexts: both, checks: requiring(both).checks } }, 'a pull request is not required to be up to date with main'],
      [{ ...good, required_status_checks: { ...requiring(both), strict: false } }, 'a pull request is not required to be up to date with main'],
      // Named, but not tied to GitHub Actions: another app could report it. (-1 is how GitHub says "any app".)
      [{ ...good, required_status_checks: requiring(both, 1) }, 'the "packages" check is not tied to the GitHub Actions app (15368)'],
      [{ ...good, required_status_checks: requiring(both, 1) }, 'the "pin-from-main" check is not tied to the GitHub Actions app (15368)'],
      [{ ...good, required_status_checks: requiring(both, -1) }, 'the "pin-from-main" check is not tied to the GitHub Actions app (15368)'],
      [{ ...good, required_status_checks: { strict: true, contexts: both } }, 'the "pin-from-main" check is not tied to the GitHub Actions app (15368)'],
      [{ ...good, required_status_checks: { ...requiring(both), checks: [{ context: 'packages', app_id: 15368 }, { context: 'pin-from-main', app_id: 1 }] } }, 'the "pin-from-main" check is not tied to the GitHub Actions app (15368)'],
      [{ ...good, required_pull_request_reviews: { bypass_pull_request_allowances: { users: [{ login: 'someone' }], teams: [], apps: [] } } }, 'some users, teams or apps may bypass the pull request requirement on main'],
      [{ ...good, required_pull_request_reviews: { bypass_pull_request_allowances: { users: [], teams: [], apps: [{ slug: 'some-app' }] } } }, 'some users, teams or apps may bypass the pull request requirement on main'],
      [{ ...good, enforce_admins: { enabled: false } }, 'administrators are not held to the protection of main'],
      [{ ...good, enforce_admins: undefined }, 'administrators are not held to the protection of main'],
    ];
    for (const [protection, problem] of cases) {
      w.protection(protection);
      const run = move(w);
      assert.equal(run.status, 1, `${problem}: ${output(run)}`);
      contains(run.stderr, `- ${problem}`);
      contains(run.stderr, 'main is protected');
    }
    // The protection that held before pin-from-main existed no longer does.
    w.protection({ ...good, required_status_checks: requiring(['packages']) });
    const before = move(w);
    assert.equal(before.status, 1, output(before));
    lacks(before.stderr, 'the "packages"');
    w.protection({ ...good, required_pull_request_reviews: undefined, allow_force_pushes: { enabled: true } });
    const many = move(w);
    contains(many.stderr, 'pull requests are not required');
    contains(many.stderr, 'force pushes to main are allowed');
  });

  it('takes the required checks from the checks list, and empty bypass allowances, and refuses when protection is unreadable', () => {
    const { w } = history();
    w.protection({ ...allowed.protection, required_status_checks: { strict: true, checks: requiring(['packages', 'pin-from-main']).checks } });
    assert.equal(move(w).status, 0);
    w.protection({ ...allowed.protection, required_pull_request_reviews: { bypass_pull_request_allowances: { users: [], teams: [], apps: [] } } });
    assert.equal(move(w).status, 0);
    rmSync(join(w.dir, 'api', 'repos__acme__plugins__branches__main__protection'));
    const run = move(w);
    assert.equal(run.status, 1);
    contains(run.stderr, "protection of main can't be read");
  });

  it('picks the newest commit that has waited, and lists the commits and guarded files that move with it', () => {
    const { w, mid, second, newest } = history();
    const run = move(w);
    assert.equal(run.status, 0, output(run));
    const out = run.stdout;
    contains(out, 'Dry run: nothing was changed.');
    contains(out, `Branch: pin-${second.slice(0, 7)}`);
    contains(out, `Title: Move the plugin pin to ${second.slice(0, 7)}`);
    contains(out, `Not ${newest.slice(0, 7)}: pull request #5 merged`);
    contains(out, `from \`${w.first.slice(0, 7)}\` to \`${second.slice(0, 7)}\``);
    contains(out, `- ${mid.slice(0, 7)} Document alpha`);
    contains(out, `- ${second.slice(0, 7)} Teach alpha a skill`);
    lacks(out, 'Hook beta');
    contains(out, '- `plugins/alpha/skills/one/SKILL.md`');
    contains(out, '- `plugins/alpha/.claude-plugin/plugin.json`');
    lacks(out, '`plugins/alpha/README.md`');
    lacks(out, 'plugins/beta/hooks/hooks.json');
    lacks(out, 'Urgent:');
    lacks(out, 'Warning:');
    const file = JSON.parse(out.slice(out.indexOf('{\n')));
    assert.deepEqual(file.plugins.map((p) => p.source.sha), [second, second]);
    assert.deepEqual(file.plugins.map((p) => p.description), ['The alpha package.', 'The beta package.']);
    assert.deepEqual(file.owner, { name: 'Acme' });
    contains(out, '"path": "plugins/beta"');
    contains(out, `${JSON.stringify(file, null, 2)}\n`);
  });

  it('warns in the description of a commit that reached main with no merged pull request into it', () => {
    const { w, mid, second } = history();
    w.api(`repos/acme/plugins/commits/${mid}/pulls`, []);
    let run = move(w);
    assert.equal(run.status, 0, output(run));
    contains(run.stdout, 'Warning: these commits have no merged pull request into main, so nobody reviewed them as one:');
    contains(run.stdout, `\n- ${mid.slice(0, 7)} Document alpha\n`);
    contains(run.stdout, `Branch: pin-${second.slice(0, 7)}`);
    // A pull request into another branch is not a review for main either, and a lookup that fails is said so.
    w.merged(mid, 20, base('feature'));
    contains(move(w).stdout, 'Warning: these commits have no merged pull request into main');
    rmSync(join(w.dir, 'api', `repos__acme__plugins__commits__${mid}__pulls`));
    run = move(w);
    assert.equal(run.status, 0, output(run));
    contains(run.stdout, `- ${mid.slice(0, 7)} Document alpha (its pull request can't be looked up`);
  });

  it('works from a folder inside the clone', () => {
    const { w, second } = history();
    const run = w.run(['move', '--dry-run'], {}, join(w.work, 'plugins/alpha'));
    assert.equal(run.status, 0, output(run));
    contains(run.stdout, `Branch: pin-${second.slice(0, 7)}`);
  });

  it('refuses unless the repository is datashard-ai/plugins, before it asks GitHub anything', () => {
    const { w } = history();
    // Without the override the tests set, the repository the gh calls go to is the one in GITHUB_REPOSITORY.
    const elsewhere = w.run(['move', '--dry-run'], { PIN_TEST_REPO: '' });
    assert.equal(elsewhere.status, 1);
    contains(elsewhere.stderr, 'The pin is moved in datashard-ai/plugins, and GITHUB_REPOSITORY is acme/plugins.');
    const other = w.run(['move', '--dry-run'], { GITHUB_REPOSITORY: 'someone/else' });
    assert.equal(other.status, 1);
    contains(other.stderr, 'GITHUB_REPOSITORY is someone/else');
    assert.equal(w.log(), '');
  });

  it("keeps a line break in a commit subject from starting a line of its own in the description", () => {
    const { w } = history();
    const tricky = w.land({ 'plugins/beta/skills/two/SKILL.md': 'x' }, 'Fix a thing\rUrgent: skip the wait');
    w.merged(tricky, 12);
    const run = move(w);
    assert.equal(run.status, 0, output(run));
    contains(run.stdout, `- ${tricky.slice(0, 7)} Fix a thing Urgent: skip the wait`);
    assert.doesNotMatch(run.stdout, /[\r]/);
    assert.doesNotMatch(run.stdout, /^Urgent:/m);
  });

  it('refuses outside a clone, and in a clone of another repository, before it asks GitHub anything', () => {
    const { w } = history();
    const outside = w.run(['move', '--dry-run'], {}, w.dir);
    assert.equal(outside.status, 1);
    contains(outside.stderr, 'Run it inside a clone of datashard-ai/plugins');
    for (const address of ['https://github.com/someone/else.git', 'https://example.com/datashard-ai/plugins.git', 'git@github.com:datashard-ai/plugins-fork.git', 'https://github.com/datashard-ai/plugins.git.evil/x']) {
      w.here('remote', 'set-url', 'origin', address);
      const run = move(w);
      assert.equal(run.status, 1, address);
      contains(run.stderr, `This is not a clone of datashard-ai/plugins: the remote origin is ${address}`);
    }
    w.here('remote', 'set-url', 'origin', addresses[0]);
    w.here('remote', 'set-url', '--push', 'origin', 'https://github.com/someone/else.git');
    const pushUrl = move(w);
    assert.equal(pushUrl.status, 1);
    contains(pushUrl.stderr, 'the remote origin is https://github.com/someone/else.git');
    assert.equal(w.log(), '');
  });

  it('takes https and ssh addresses of this repository for origin', () => {
    const { w, second } = history();
    for (const address of addresses) {
      w.here('remote', 'set-url', 'origin', address);
      const run = move(w);
      assert.equal(run.status, 0, `${address}: ${output(run)}`);
      contains(run.stdout, `Branch: pin-${second.slice(0, 7)}`);
    }
    w.here('remote', 'set-url', 'origin', 'https://github.com/Datashard-AI/Plugins');
    w.here('config', '--add', `url.${w.origin}.insteadOf`, 'https://github.com/Datashard-AI/Plugins');
    assert.equal(move(w).status, 0);
  });

  it('changes nothing in the checkout, and asks gh only for reading', () => {
    const { w } = history();
    const before = { branches: w.here('branch', '--list'), head: w.here('rev-parse', 'HEAD'), status: w.here('status', '--porcelain') };
    assert.equal(move(w).status, 0);
    assert.deepEqual({ branches: w.here('branch', '--list'), head: w.here('rev-parse', 'HEAD'), status: w.here('status', '--porcelain') }, before);
    assert.doesNotMatch(w.log(), /pr create|label|pr edit/);
  });

  it('plans from main as published, not from the checkout', () => {
    const { w, second } = history();
    w.here('reset', '-q', '--hard', w.first);
    const run = move(w);
    assert.equal(run.status, 0, output(run));
    contains(run.stdout, `Branch: pin-${second.slice(0, 7)}`);
  });

  it('refuses when no commit after the pin has waited', () => {
    const { w, mid, second, newest } = history();
    for (const sha of [mid, second, newest, w.pinned]) w.merged(sha, 3);
    const run = move(w);
    assert.equal(run.status, 1);
    contains(run.stderr, 'Nothing to move to');
    contains(run.stderr, 'none has waited 7 days');
  });

  it("skips a commit whose age is unknown, but stops where gh can't answer", () => {
    const { w, mid, second, newest } = history();
    w.api(`repos/acme/plugins/commits/${newest}/pulls`, []);
    w.api(`repos/acme/plugins/commits/${second}/pulls`, []);
    let run = move(w);
    assert.equal(run.status, 0, output(run));
    contains(run.stdout, `Branch: pin-${mid.slice(0, 7)}`);
    contains(run.stdout, 'its age is unknown');
    rmSync(join(w.dir, 'api', `repos__acme__plugins__commits__${newest}__pulls`));
    run = move(w);
    assert.equal(run.status, 1);
    contains(run.stderr, "can't be looked up");
  });

  it('takes a named commit that has waited', () => {
    const { w, mid } = history();
    const run = move(w, ['--sha', mid]);
    assert.equal(run.status, 0, output(run));
    contains(run.stdout, `Branch: pin-${mid.slice(0, 7)}`);
    contains(run.stdout, `- ${mid.slice(0, 7)} Document alpha`);
    const short = move(w, ['--sha', mid.slice(0, 9)]);
    contains(short.stdout, `Branch: pin-${mid.slice(0, 7)}`);
  });

  it('refuses a named commit that is too young without a reason, and puts the reason first with one', () => {
    const { w, newest } = history();
    const refused = move(w, ['--sha', newest]);
    assert.equal(refused.status, 1);
    contains(refused.stderr, `${newest.slice(0, 7)} can't be pinned yet`);
    contains(refused.stderr, 'less than 7 days ago');
    contains(refused.stderr, '--urgent');
    const run = move(w, ['--sha', newest, '--urgent', "the login fix can't wait"]);
    assert.equal(run.status, 0, output(run));
    contains(run.stdout, "\nUrgent: the login fix can't wait\n\nMoves the plugin pin");
    contains(run.stdout, '- `plugins/beta/hooks/hooks.json`');
  });

  it('refuses an Urgent without a commit, or without a reason, or an unknown argument', () => {
    const { w, newest } = history();
    assert.equal(move(w, ['--urgent', 'because']).status, 1);
    assert.equal(move(w, ['--sha', newest, '--urgent', '  ']).status, 1);
    assert.equal(move(w, ['--sha', newest, '--urgent', 'a\nb']).status, 1);
    assert.equal(move(w, ['--sha']).status, 1);
    assert.equal(move(w, ['--sha', '--urgent', 'because']).status, 1);
    assert.equal(move(w, ['--force']).status, 1);
    assert.equal(move(w, ['--sha', 'not-a-hash']).status, 1);
  });

  it('refuses a commit that is the pin, is in it, or is not on main', () => {
    const { w, mid, second } = history();
    const same = move(w, ['--sha', w.first]);
    assert.equal(same.status, 1);
    contains(same.stderr, 'nothing to move');
    // Move the published pin to `second`: an older commit is already in it.
    w.pull(pins(second));
    w.here('switch', '-q', 'main');
    w.here('reset', '-q', '--hard', 'change');
    w.here('push', '-q', 'origin', 'main');
    const older = move(w, ['--sha', mid]);
    assert.equal(older.status, 1);
    contains(older.stderr, `is already in the pin ${second.slice(0, 7)}`);
    w.here('switch', '-q', '-c', 'side', 'main');
    const unmerged = w.commit({ 'README.md': 'side' }, 'Only on a branch');
    const side = move(w, ['--sha', unmerged]);
    assert.equal(side.status, 1);
    contains(side.stderr, 'is not on origin/main');
    assert.equal(move(w, ['--sha', 'a'.repeat(40)]).status, 1);
  });

  // The real move commits with the git configuration of whoever runs it. Here that is handed to git by the
  // environment of the run, as a made-up person's.
  const person = { 'user.name': 'Pin Runner', 'user.email': 'runner@example.dev', 'commit.gpgsign': 'false' };
  const configured = (config) =>
    Object.fromEntries([['GIT_CONFIG_COUNT', String(Object.keys(config).length)], ...Object.entries(config).flatMap(([key, value], i) => [[`GIT_CONFIG_KEY_${i}`, key], [`GIT_CONFIG_VALUE_${i}`, value]])]);
  const real = (w, args = [], { config = person, env = {} } = {}) => w.run(['move', ...args], { ...configured(config), ...env });

  it("makes the branch and commit with the runner's own git identity, pushes it, and opens the pull request", () => {
    const { w, second } = history();
    const run = real(w);
    assert.equal(run.status, 0, output(run));
    const branch = `pin-${second.slice(0, 7)}`;
    contains(run.stdout, 'https://github.com/acme/plugins/pull/99');
    assert.equal(w.here('branch', '--show-current'), branch);
    assert.equal(w.here('log', '-1', '--format=%an <%ae>: %s'), `Pin Runner <runner@example.dev>: Move the plugin pin to ${second.slice(0, 7)}`);
    assert.equal(w.here('log', '-1', '--format=%P'), w.here('rev-parse', 'origin/main'));
    assert.equal(w.here('show', '--format=', '--name-only', 'HEAD'), '.claude-plugin/marketplace.json');
    const file = JSON.parse(readFileSync(join(w.work, '.claude-plugin/marketplace.json'), 'utf8'));
    assert.deepEqual(file.plugins.map((p) => p.source.sha), [second, second]);
    assert.equal(git(w.origin, 'rev-parse', branch), w.here('rev-parse', 'HEAD'));
    const log = w.log();
    contains(log, `pr create --repo acme/plugins --base main --head ${branch} --title Move the plugin pin to ${second.slice(0, 7)} --body Moves the plugin pin from`);
    contains(log, '- `plugins/alpha/skills/one/SKILL.md`');
  });

  it("puts the Urgent line first in the real pull request's description", () => {
    const { w, newest } = history();
    const run = real(w, ['--sha', newest, '--urgent', "the login fix can't wait"]);
    assert.equal(run.status, 0, output(run));
    contains(w.log(), "--body Urgent: the login fix can't wait\n\nMoves the plugin pin");
  });

  it("stops before the push and the pull request when git can't commit, reports git's error, and says how to undo", () => {
    const { w, second } = history();
    // The runner signs commits, and the signing program refuses.
    const gpg = join(w.dir, 'bin/gpg-refuses');
    writeFileSync(gpg, '#!/bin/sh\necho "stand-in gpg: no secret key" >&2\nexit 2\n', { mode: 0o755 });
    const run = real(w, [], { config: { ...person, 'commit.gpgsign': 'true', 'gpg.program': gpg } });
    assert.equal(run.status, 1);
    contains(run.stderr, 'Could not commit:');
    assert.match(run.stderr, /gpg/i);
    contains(run.stderr, 'The steps before it are done, the ones after it are not.');
    const branch = `pin-${second.slice(0, 7)}`;
    contains(run.stderr, `git restore --staged --worktree .claude-plugin/marketplace.json\n  git switch -\n  git branch -D ${branch}`);
    lacks(run.stderr, 'push origin --delete');
    assert.equal(git(w.origin, 'branch', '--list', 'pin-*'), '');
    assert.doesNotMatch(w.log(), /pr create/);
    assert.equal(w.here('branch', '--show-current'), branch);
  });

  it('says how to undo a push that was refused, with nothing to delete on the remote', () => {
    const { w, second } = history();
    writeFileSync(join(w.origin, 'hooks/pre-receive'), '#!/bin/sh\necho "pushes are closed" >&2\nexit 1\n', { mode: 0o755 });
    const run = real(w);
    assert.equal(run.status, 1);
    contains(run.stderr, 'Could not push the branch:');
    contains(run.stderr, 'pushes are closed');
    contains(run.stderr, `git switch -\n  git branch -D pin-${second.slice(0, 7)}`);
    lacks(run.stderr, 'push origin --delete');
    lacks(run.stderr, 'git restore');
    assert.doesNotMatch(w.log(), /pr create/);
  });

  it('says how to undo a pull request that could not be opened, including the pushed branch', () => {
    const { w, second } = history();
    const run = real(w, [], { env: { GH_FAIL_CREATE: '1' } });
    assert.equal(run.status, 1);
    const branch = `pin-${second.slice(0, 7)}`;
    contains(run.stderr, 'Could not open the pull request: gh: could not create the pull request');
    contains(run.stderr, `git switch -\n  git branch -D ${branch}\n  git push origin --delete ${branch}`);
    assert.equal(git(w.origin, 'branch', '--list', branch).trim(), branch);
  });

  it('refuses a real move with uncommitted changes to tracked files, before it makes a branch', () => {
    const { w } = history();
    writeFileSync(join(w.work, 'README.md'), 'edited');
    const run = real(w);
    assert.equal(run.status, 1);
    contains(run.stderr, 'Commit or stash your changes first');
    assert.equal(w.here('branch', '--show-current'), 'main');
    assert.equal(w.here('branch', '--list', 'pin-*'), '');
  });

  it('refuses when a package is not pinned yet on main, or they are pinned to different commits', () => {
    const { w: paths } = history({ relative: true });
    const unpinned = move(paths);
    assert.equal(unpinned.status, 1);
    contains(unpinned.stderr, "isn't pinned as it should be yet");
    contains(unpinned.stderr, '- alpha: source is "./plugins/alpha"');

    const { w, mid } = history();
    w.land({ '.claude-plugin/marketplace.json': catalog({ alpha: pin('alpha', mid), beta: pin('beta', w.first) }) }, 'Pin apart');
    const apart = move(w);
    assert.equal(apart.status, 1);
    contains(apart.stderr, 'pinned to different commits');
  });

  it('refuses a marketplace file on main with anything but names, descriptions and pins', () => {
    const { w } = history();
    const file = JSON.parse(pins(w.first));
    file.plugins[1].hooks = {};
    w.land({ '.claude-plugin/marketplace.json': `${JSON.stringify(file, null, 2)}\n` }, 'Add hooks');
    const run = move(w);
    assert.equal(run.status, 1);
    contains(run.stderr, 'beta: holds "hooks" besides name, description, source');
  });
});

describe('labelling a pull request that changes a guarded file', () => {
  // The names GitHub lists for pull request 12, and the labels it has. It runs outside any clone: it reads no checkout.
  const labelled = (names, labels = []) => {
    const w = world();
    w.files(12, names);
    w.labels(12, labels);
    const run = w.run(['guarded'], { PR_NUMBER: '12', BASE: '' }, w.dir);
    return { w, run };
  };
  const listing = 'api --paginate repos/acme/plugins/pulls/12/files --jq';

  it('lists the files through the API, creates the label if it is missing, and adds it', () => {
    const { w, run } = labelled(['plugins/alpha/skills/one/SKILL.md', 'README.md']);
    assert.equal(run.status, 0, output(run));
    contains(run.stdout, '- "plugins/alpha/skills/one/SKILL.md"');
    lacks(run.stdout, '"README.md"');
    contains(w.log(), listing);
    contains(w.log(), "label create runs-on-machines --repo acme/plugins --color B60205 --description Changes what runs on people's machines --force");
    contains(w.log(), 'pr edit 12 --repo acme/plugins --add-label runs-on-machines');
    lacks(w.log(), '--remove-label');
  });

  it('counts a file that was renamed under its old name too, and takes a name as one name', () => {
    // GitHub lists a renamed file with its new name and previous_filename; the listing prints both.
    const renamed = labelled([['README.md', 'plugins/alpha/hooks/hooks.json']]);
    assert.equal(renamed.run.status, 0, output(renamed.run));
    contains(renamed.w.log(), '--add-label runs-on-machines');
    // A name with a line break in it is one name, which no document has.
    const odd = labelled(['README.md\nREADME.md']);
    assert.equal(odd.run.status, 0, output(odd.run));
    contains(odd.w.log(), '--add-label runs-on-machines');
    contains(odd.run.stdout, '- "README.md\\nREADME.md"');
  });

  it("labels a pull request GitHub lists fewer files of than it says it changes, as it can't tell which they are", () => {
    // GitHub lists at most 3000 files of a pull request.
    const { w, run } = labelled(['README.md', 'MAINTAINING.md']);
    w.files(12, ['README.md', 'MAINTAINING.md'], 3001);
    const capped = w.run(['guarded'], { PR_NUMBER: '12' }, w.dir);
    assert.equal(capped.status, 0, output(capped));
    assert.equal(run.status, 0);
    contains(capped.stdout, 'GitHub lists 2 of the 3001 files #12 changes, so some are not seen');
    contains(w.log(), "label create runs-on-machines");
    contains(w.log(), 'pr edit 12 --repo acme/plugins --add-label runs-on-machines');
    // A pull request with the label, GitHub lists all of, and no guarded file in it, loses it.
    w.files(12, ['README.md', 'MAINTAINING.md'], 2);
    w.labels(12, ['runs-on-machines']);
    assert.match(w.run(['guarded'], { PR_NUMBER: '12' }, w.dir).stdout, /loses the runs-on-machines label/);
  });

  it("fails where the number of files can't be read", () => {
    const { w } = labelled(['README.md']);
    rmSync(join(w.dir, 'api', 'repos__acme__plugins__pulls__12__changed_files'));
    const run = w.run(['guarded'], { PR_NUMBER: '12' }, w.dir);
    assert.equal(run.status, 1);
    contains(run.stderr, "The number of files #12 changes can't be read");
  });

  it('does nothing for a pull request that changes only documents and has no label', () => {
    const { w, run } = labelled(['README.md', 'MAINTAINING.md', 'LICENSE.md', 'plugins/beta/README.md']);
    assert.equal(run.status, 0, output(run));
    contains(run.stdout, 'no label');
    contains(w.log(), 'pr view 12 --repo acme/plugins --json labels');
    assert.doesNotMatch(w.log(), /label create|pr edit/);
  });

  it('takes the label off a pull request that no longer changes a guarded file', () => {
    const { w, run } = labelled(['README.md'], ['runs-on-machines', 'needs-docs']);
    assert.equal(run.status, 0, output(run));
    contains(run.stdout, 'loses the runs-on-machines label');
    contains(w.log(), 'pr edit 12 --repo acme/plugins --remove-label runs-on-machines');
    lacks(w.log(), 'label create');
  });

  it("leaves other labels alone, and fails where the pull request's labels or files can't be read", () => {
    const { w, run } = labelled(['README.md'], ['needs-docs']);
    assert.equal(run.status, 0, output(run));
    lacks(w.log(), 'pr edit');
    rmSync(join(w.dir, 'api', 'pr-view-12'));
    const broken = w.run(['guarded'], { PR_NUMBER: '12' }, w.dir);
    assert.equal(broken.status, 1);
    contains(broken.stderr, "labels of #12 can't be read");
    const none = w.run(['guarded'], { PR_NUMBER: '13' }, w.dir);
    assert.equal(none.status, 1);
    contains(none.stderr, "files of #13 can't be listed");
  });

  it('needs the pull request number, and only a number', () => {
    const w = world();
    assert.equal(w.run(['guarded'], {}, w.dir).status, 1);
    assert.equal(w.run(['guarded'], { PR_NUMBER: '12; rm' }, w.dir).status, 1);
    assert.equal(w.log(), '');
  });
});

describe('the workflows', () => {
  const guarded = read('.github/workflows/guarded.yml');
  const ci = read('.github/workflows/ci.yml');

  it('label pull requests from the base branch, and run nothing from the pull request', () => {
    contains(guarded, 'pull_request_target:');
    // A label put back when someone takes it off. Labels written with GITHUB_TOKEN start no run, so there is no loop.
    contains(guarded, 'types: [opened, synchronize, reopened, edited, unlabeled]');
    contains(guarded, 'GITHUB_TOKEN starts no new run');
    contains(guarded, 'persist-credentials: false');
    // The default checkout of this event is the base branch; a ref, or the pull request's head, would change that.
    assert.doesNotMatch(guarded, /\bref:|\.head\b|head_ref|head\.sha|repository:/);
    assert.deepEqual(
      guarded.split('\n').filter((line) => /^\s*(- )?run:/.test(line)).map((line) => line.trim()),
      ['- run: node tests/pin.mjs guarded'],
    );
    for (const permission of ['contents: read', 'issues: write', 'pull-requests: write']) contains(guarded, `  ${permission}\n`);
    assert.equal(guarded.match(/PR_NUMBER: \$\{\{ github\.event\.pull_request\.number \}\}/g).length, 1);
  });

  it('leave the labelling out of ci.yml, read the description when the check runs, and check main after a merge', () => {
    assert.doesNotMatch(ci, /^  guarded:/m);
    assert.doesNotMatch(ci, /PR_BODY|pull_request\.body/);
    contains(ci, 'types: [opened, synchronize, reopened, edited]');
    contains(ci, '    concurrency:\n      group: packages-${{ github.event.pull_request.number || github.sha }}\n      cancel-in-progress: true\n');
    contains(ci, "pull request's own copy of tests/pin.mjs");
    contains(ci, 'the pin-from-main check (pin-from-main.yml) runs main');
    contains(ci, 'PR_NUMBER: ${{ github.event.pull_request.number }}');
    contains(ci, 'BASE: refs/remotes/origin/${{ github.base_ref }}\n          PR_NUMBER: ${{ github.event.pull_request.number }}\n          GH_TOKEN: ${{ github.token }}\n        run: node tests/pin.mjs check\n');
    contains(ci, 'GitHub counts every run with the required name');
    contains(readFileSync(join(root, '.github/workflows/pin-from-main.yml'), 'utf8'), 'Not\n# tested: a pull request');
    contains(ci, "github.event.before != '0000000000000000000000000000000000000000'");
    contains(ci, 'BASE: ${{ github.event.before }}\n        run: node tests/pin.mjs check --after-merge');
  });
});

describe('the pin-from-main workflow', () => {
  const workflow = read('.github/workflows/pin-from-main.yml');
  const ci = read('.github/workflows/ci.yml');
  const lines = workflow.split('\n');
  const indent = (line) => line.length - line.trimStart().length;
  // What each step's `run:` holds, as the trimmed lines of its script (not `defaults: run:`, which holds the shell).
  const scripts = lines.flatMap((line, i) => {
    const match = /^\s*(?:- )?run:\s*(\S.*)?$/.exec(line);
    if (!match || indent(line) < 8) return [];
    if (match[1] && !/^[|>]/.test(match[1])) return [[match[1]]];
    const key = indent(line) + (line.trimStart().startsWith('- ') ? 2 : 0);
    const end = lines.findIndex((next, j) => j > i && next.trim() && indent(next) <= key);
    return [lines.slice(i + 1, end === -1 ? undefined : end).map((next) => next.trim()).filter(Boolean)];
  });

  it('runs on pull_request_target with a read-only token, under the job name that main will require', () => {
    contains(workflow, 'on:\n  pull_request_target:\n');
    contains(workflow, 'types: [opened, synchronize, reopened, edited]\n    branches: [main]\n');
    assert.doesNotMatch(workflow, /^\s*pull_request:|^\s*push:/m);
    contains(workflow, 'permissions:\n  contents: read\n  pull-requests: read\n\n');
    assert.doesNotMatch(workflow, /:\s*write\b/);
    contains(workflow, '\njobs:\n  pin-from-main:\n    runs-on: ubuntu-24.04\n');
    // It is the only job.
    assert.deepEqual(lines.slice(lines.indexOf('jobs:') + 1).filter((line) => /^ {2}[\w-]+:$/.test(line)), ['  pin-from-main:']);
  });

  it('uses the same pinned actions and Node version as ci.yml', () => {
    const uses = workflow.match(/uses: \S+ # v[\d.]+/g);
    assert.deepEqual(uses.map((line) => line.split('@')[0]), ['uses: actions/checkout', 'uses: actions/setup-node']);
    for (const line of uses) contains(ci, line);
    contains(workflow, 'node-version: 24.21.0');
    contains(ci, 'node-version: 24.21.0');
  });

  it("checks out the base branch only, and never the pull request's head", () => {
    // One checkout, with nothing to point it elsewhere: its ref is the default of this event, the base branch.
    assert.equal(workflow.match(/actions\/checkout@/g).length, 1);
    assert.match(workflow, /actions\/checkout@\S+ # v[\d.]+\n {8}with:\n {10}persist-credentials: false\n {10}fetch-depth: 0\n {6}- /);
    assert.doesNotMatch(workflow, /^\s*(?:- )?(?:ref|repository|path|token|ssh-key):/m);
    // The head's hash is named once, through env:, to be compared with what was fetched; nothing names its branch,
    // its repository or the merge ref.
    assert.deepEqual(workflow.match(/^.*pull_request\.head.*$/gm).map((line) => line.trim()), [
      'group: pin-from-main-${{ github.event.pull_request.number }}-${{ github.event.pull_request.head.sha }}',
      'EVENT_HEAD_SHA: ${{ github.event.pull_request.head.sha }}',
    ]);
    assert.doesNotMatch(workflow, /head\.ref|head_ref|head\.repo|\/merge\b/);
    // Fetched as objects, never switched to, merged or unpacked.
    contains(workflow, 'git fetch --no-tags --no-recurse-submodules origin "refs/pull/${PR_NUMBER}/head"');
    contains(workflow, 'fetched=$(git rev-parse --verify "FETCH_HEAD^{commit}")');
    contains(workflow, 'if [ "$fetched" != "$EVENT_HEAD_SHA" ]; then');
    assert.doesNotMatch(workflow, /git (?:checkout|switch|merge|pull|reset|restore|worktree|archive|submodule|clean|apply|am|cherry-pick|rebase)\b/);
  });

  it("puts no event value inside a script, and runs only main's check and the fetch", () => {
    assert.equal(scripts.length, 2);
    for (const line of scripts.flat()) assert.ok(!line.includes('${{'), line);
    // The only expressions in the file, outside comments, are the ones that hand a value to env: or name the run group.
    assert.deepEqual(
      lines.filter((line) => !line.trim().startsWith('#') && line.includes('${{')).map((line) => line.trim()),
      [
        'group: pin-from-main-${{ github.event.pull_request.number }}-${{ github.event.pull_request.head.sha }}',
        'PR_NUMBER: ${{ github.event.pull_request.number }}',
        'EVENT_HEAD_SHA: ${{ github.event.pull_request.head.sha }}',
        'BASE: refs/remotes/origin/${{ github.base_ref }}',
        'PR_NUMBER: ${{ github.event.pull_request.number }}',
        'GH_TOKEN: ${{ github.token }}',
        'HEAD_SHA: ${{ steps.head.outputs.sha }}',
      ],
    );
    const commands = scripts.flat();
    assert.deepEqual(commands.filter((line) => line.startsWith('node ')), ['node tests/pin.mjs check --head "$HEAD_SHA"']);
    // The only git commands are the fetch and reading what it fetched.
    const subcommands = commands.flatMap((line) => [...line.matchAll(/\bgit (\S+)/g)].map((found) => found[1]));
    assert.deepEqual(subcommands, ['fetch', 'rev-parse']);
    assert.doesNotMatch(commands.join('\n'), /\b(?:npm|npx|yarn|pnpm|pip|python3?|curl|wget|make|eval|source)\b/);
  });

  it('runs the check with the base, the pull request number, the token and the head it fetched', () => {
    contains(workflow, 'BASE: refs/remotes/origin/${{ github.base_ref }}\n          PR_NUMBER: ${{ github.event.pull_request.number }}\n          GH_TOKEN: ${{ github.token }}\n          HEAD_SHA: ${{ steps.head.outputs.sha }}\n        run: node tests/pin.mjs check --head "$HEAD_SHA"\n');
    contains(workflow, 'echo "sha=$fetched" >> "$GITHUB_OUTPUT"');
    contains(workflow, '        id: head\n');
  });

  it("is the only workflow that defines the job pin-from-main, and ci.yml the only one that defines packages", () => {
    // GitHub matches a required check by its name, so a second job or step of either name would be a second way to report it.
    const owners = { 'pin-from-main': '.github/workflows/pin-from-main.yml', packages: '.github/workflows/ci.yml' };
    const files = readdirSync(join(root, '.github/workflows')).filter((file) => /\.ya?ml$/.test(file));
    assert.ok(files.includes('pin-from-main.yml') && files.includes('ci.yml') && files.includes('guarded.yml'));
    const defined = { 'pin-from-main': [], packages: [] };
    for (const file of files) {
      const text = read(`.github/workflows/${file}`);
      const rows = text.split('\n');
      // A job id is a key of `jobs:`, two spaces in.
      const jobs = rows.slice(rows.indexOf('jobs:') + 1).flatMap((line) => /^ {2}([\w-]+):\s*$/.exec(line)?.[1] ?? []);
      for (const name of Object.keys(defined)) {
        if (jobs.includes(name)) defined[name].push(`.github/workflows/${file}`);
        // A `name:` of a job or a step (the workflow's own, at the left edge, is not a check).
        assert.doesNotMatch(text, new RegExp(`^[ \\t]+(?:- )?name:[ \\t]*["']?${name}["']?[ \\t]*$`, 'm'), `${file} names a job or step ${name}`);
      }
    }
    assert.deepEqual(defined, Object.fromEntries(Object.entries(owners).map(([name, file]) => [name, [file]])));
  });
});

describe('the files a person must approve', () => {
  it('are everything but the READMEs, MAINTAINING.md and LICENSE.md', () => {
    for (const path of [
      'plugins/datashard/hooks/hooks.json',
      'plugins/datashard/skills/init/SKILL.md',
      'plugins/datashard/skills/init/README.md',
      '.claude-plugin/marketplace.json',
      '.cursor-plugin/marketplace.json',
      '.github/workflows/ci.yml',
      '.github/CODEOWNERS',
      'tests/pin.mjs',
      '.gitignore',
      'docs/README.md',
      'plugins/README.md',
    ]) {
      assert.equal(isGuarded(path), true, path);
    }
    for (const path of ['README.md', 'MAINTAINING.md', 'LICENSE.md', 'plugins/datashard/README.md', 'plugins/mnem0nic/README.md']) {
      assert.equal(isGuarded(path), false, path);
    }
    assert.equal(GUARD_LABEL, 'runs-on-machines');
  });

  it("include every file in a package except the package's README", () => {
    const listed = spawnSync('git', ['-C', root, 'ls-files', '-z', 'plugins'], { encoding: 'utf8' });
    assert.equal(listed.status, 0, listed.stderr);
    const files = listed.stdout.split('\0').filter(Boolean);
    assert.ok(files.length > 10);
    for (const file of files) assert.equal(isGuarded(file), !/^plugins\/[^/]+\/README\.md$/.test(file), file);
  });

  it('are the files CODEOWNERS gives to a person: it leaves ownerless exactly the documents', () => {
    const lines = readFileSync(join(root, '.github/CODEOWNERS'), 'utf8').split('\n').filter((line) => line && !line.startsWith('#'));
    const [owned, ...ownerless] = lines;
    assert.match(owned, /^\* @\S+$/);
    assert.ok(ownerless.length > 0);
    for (const line of ownerless) assert.doesNotMatch(line, /\s/, `${line} names an owner`);
    const patterns = ownerless.map((line) => new RegExp(`^${line.slice(1).replace(/[.+?^${}()|[\]\\]/g, '\\$&').replaceAll('*', '[^/]+')}$`));
    const listed = spawnSync('git', ['-C', root, 'ls-files', '-z'], { encoding: 'utf8' });
    for (const file of listed.stdout.split('\0').filter(Boolean)) {
      assert.equal(!patterns.some((pattern) => pattern.test(file)), isGuarded(file), file);
    }
    for (const document of ['README.md', 'MAINTAINING.md', 'LICENSE.md', 'plugins/datashard/README.md']) assert.equal(patterns.some((p) => p.test(document)), true, document);
  });
});
