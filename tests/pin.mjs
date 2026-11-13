#!/usr/bin/env node
// The marketplace points each package at an exact commit of this repository, so a merge to main reaches nobody until a
// reviewed pull request moves the pin, and only for commits merged at least WAIT_DAYS ago (or sooner, with a written
// reason). Plain Node, standard library only, as the other checks.
//
//   node tests/pin.mjs check                 CI, on pull requests. Reads BASE (such as origin/main) and GH_TOKEN, and the
//                                            pull request's description through PR_NUMBER (PR_BODY, for a local run).
//                                            BASE is resolved once, to a commit. CI gives it as a full ref name
//                                            (refs/remotes/origin/main), which no tag of the same short name can shadow.
//   node tests/pin.mjs check --after-merge   CI, on a push to main. The same, without looking at the age: a pin merged early
//                                            on purpose passes, and so would one merged early by mistake. BASE is main
//                                            before the push; the job summary shows the pin change.
//   node tests/pin.mjs check --head <sha>    CI, on pull_request_target, from main's checkout. The same as `check`, with the
//                                            pull request's state read as git objects at <sha> (40 hexadecimal digits)
//                                            instead of from the working tree and HEAD, so the pull request's files are
//                                            data and none of them runs. May go with --after-merge.
//   node tests/pin.mjs move                  Opens the pull request that moves the pin. Run it on your own machine,
//                                            signed in to gh, from a clone of this repository.
//   node tests/pin.mjs guarded               CI, on pull_request_target. Labels a pull request that changes a guarded
//                                            file, and unlabels one that no longer does. Reads PR_NUMBER.
//
// Run from the repository's root (`move` finds it). GITHUB_REPOSITORY, when set, names the repository the gh calls go to.
import { spawnSync } from 'node:child_process';
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { GUARD_LABEL, isGuarded } from './guarded.mjs';

const WAIT_DAYS = 7;
const DAY = 24 * 60 * 60 * 1000;
const SOURCE_URL = 'datashard-ai/plugins';
const REPO = process.env.GITHUB_REPOSITORY || SOURCE_URL;
const MARKETPLACE = '.claude-plugin/marketplace.json';
// GitHub Actions, as the app that reports the required check: another app could report it as well.
const ACTIONS_APP = 15368;
// The checks main must require before the pin is moved: the pull request's own run, and the run of main's copy against it.
const REQUIRED_CHECKS = ['packages', 'pin-from-main'];
const SHA = /^[0-9a-f]{40}$/;
const VERSION = /^\d+\.\d+\.\d+$/;
// People read this file from main, so it holds nothing but what the pin check covers: an entry that carried hooks, MCP
// servers or commands of its own would reach them with no pin and no wait.
const TOP_KEYS = ['name', 'owner', 'description', 'plugins'];
const ENTRY_KEYS = ['name', 'description', 'source'];
// A package's name is also its folder under plugins/, and it is printed in a line of its own.
const NAME = /^[a-z0-9][a-z0-9-]*$/;
const SOURCE_KEYS = ['source', 'url', 'path', 'sha'];
// How this repository's origin may be written: https, or ssh in either form.
const ORIGIN = /^(?:https:\/\/github\.com\/|ssh:\/\/git@github\.com\/|git@github\.com:)datashard-ai\/plugins(?:\.git)?\/?$/i;
const USAGE = `Usage: node tests/pin.mjs check [--after-merge] [--head <sha>]
       node tests/pin.mjs move [--sha <commit> --urgent "<reason>"] [--dry-run]
       node tests/pin.mjs guarded`;

const run = (command, args) => spawnSync(command, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
const git = (...args) => run('git', args);
const gh = (...args) => run('gh', args);
const why = (result) => (result.error ? result.error.message : result.stderr.trim() || result.stdout.trim() || `exit status ${result.status}`);
const short = (sha) => sha.slice(0, 7);
const lines = (text, separator = '\n') => text.split(separator).filter(Boolean);
// A name inside a Markdown code span.
const code = (text) => `\`${String(text).replace(/[`\r\n]/g, '?')}\``;
const extraKeys = (object, allowed) => Object.keys(object).filter((key) => !allowed.includes(key));
// Names found in a file, quoted so that one with a line break in it stays on its line.
const quoted = (names) => names.map((name) => JSON.stringify(name)).join(', ');
const stop = (message) => {
  console.error(message);
  process.exit(1);
};

// gh api <path>, as JSON: { data } or { error }.
function api(path) {
  const result = gh('api', path);
  if (result.status !== 0) return { error: why(result) };
  try {
    return { data: JSON.parse(result.stdout) };
  } catch {
    return { error: 'gh answered with something that is not JSON' };
  }
}

// A marketplace file's text as { data, entries }, or { error }.
function entriesOf(text, where) {
  let data;
  try {
    data = JSON.parse(text);
  } catch (error) {
    return { error: `${where} is not valid JSON (${error.message})` };
  }
  if (!Array.isArray(data?.plugins)) return { error: `${where} has no "plugins" list` };
  return { data, entries: data.plugins };
}

// Why an entry's `source` is not a pin to an exact commit of this repository, or null. The pin is the whole of `source`:
// another field, such as a ref, would leave it unclear which commit people get.
function sourceProblem(entry) {
  const source = entry?.source;
  if (!source || typeof source !== 'object') return `source is ${JSON.stringify(source)}, not a pin to a commit`;
  if (source.source !== 'git-subdir') return `source.source is ${JSON.stringify(source.source)}, not "git-subdir"`;
  if (source.url !== SOURCE_URL) return `source.url is ${JSON.stringify(source.url)}, not "${SOURCE_URL}"`;
  if (source.path !== `plugins/${entry.name}`) return `source.path is ${JSON.stringify(source.path)}, not "plugins/${entry.name}"`;
  if (typeof source.sha !== 'string' || !SHA.test(source.sha)) return `source.sha is ${JSON.stringify(source.sha)}, not 40 lowercase hexadecimal digits`;
  const extra = extraKeys(source, SOURCE_KEYS);
  if (extra.length) return `source holds ${quoted(extra)} besides ${SOURCE_KEYS.join(', ')}`;
  return null;
}

// Why an entry is not just a name, a description and a pin, or null.
function entryProblem(entry) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return 'is not an object';
  if (entry.name === undefined) return 'has no name';
  if (typeof entry.name !== 'string' || !NAME.test(entry.name)) return `has the name ${JSON.stringify(entry.name)}, which is not lowercase letters, digits and hyphens`;
  const extra = extraKeys(entry, ENTRY_KEYS);
  if (extra.length) return `holds ${quoted(extra)} besides ${ENTRY_KEYS.join(', ')}: anything else would reach people with no pin and no wait`;
  return sourceProblem(entry);
}

// What is wrong with the file as a whole and with each entry: one line each.
function shapeProblems(data) {
  const problems = [];
  const extra = extraKeys(data, TOP_KEYS);
  if (extra.length) problems.push(`${MARKETPLACE} holds ${quoted(extra)} besides ${TOP_KEYS.join(', ')}: anything else would reach people with no pin and no wait`);
  for (const entry of data.plugins) {
    const problem = entryProblem(entry);
    // A name that is not a plain one is quoted, so that it can't start a line of its own in the output.
    const name = typeof entry?.name === 'string' && NAME.test(entry.name) ? entry.name : entry?.name === undefined ? '(an entry without a name)' : JSON.stringify(entry.name);
    if (problem) problems.push(`${name}: ${problem}`);
  }
  return problems;
}

// The pull request into main that merged `sha`: { pull, merged }, { missing: true } where none did (an age nobody can
// tell), or { error }. A pull request into another branch or repository, or one that is not merged, doesn't count.
function mergedBy(sha) {
  const { data, error } = api(`repos/${REPO}/commits/${sha}/pulls`);
  if (error) return { error };
  const into = (item) => item.base?.ref === 'main' && item.base?.repo?.full_name?.toLowerCase() === REPO.toLowerCase();
  const pull = Array.isArray(data) ? data.find((item) => item.merge_commit_sha === sha && item.merged_at && into(item)) : undefined;
  const merged = pull && new Date(pull.merged_at);
  if (!merged || Number.isNaN(merged.getTime())) return { missing: true };
  return { pull, merged };
}

// Whether the pull request that merged `sha` was merged WAIT_DAYS ago or more: { text } where it was, else { why }, with
// `lookup` set where gh itself failed.
function waited(sha) {
  const found = mergedBy(sha);
  if (found.error) return { why: `its pull request can't be looked up (${found.error})`, lookup: true };
  if (found.missing) return { why: 'no merged pull request into main has it as its merge commit, so its age is unknown' };
  const age = Date.now() - found.merged.getTime();
  const text = `pull request #${found.pull.number} merged ${found.merged.toISOString().slice(0, 10)}`;
  if (age < WAIT_DAYS * DAY) return { why: `${text}, less than ${WAIT_DAYS} days ago` };
  return { text: `${text}, ${Math.floor(age / DAY)} days ago` };
}

// The reason in the first `Urgent: <reason>` line of a pull request's description, or null. A line ends at a line feed
// (and a carriage return before it); a carriage return inside a line, as one in a commit subject might be, does not
// start a new line.
function urgentReason(body) {
  for (const line of body.split('\n')) {
    const match = /^Urgent: (.+)$/.exec(line.replace(/\r$/, ''));
    if (match && match[1].trim()) return match[1].trim();
  }
  return null;
}

// The pull request's description as it is now, not as it was when the run started (it can be edited meanwhile): read
// through PR_NUMBER. Without one, PR_BODY, for a run on your own machine. { body, error }.
function description() {
  const number = process.env.PR_NUMBER;
  if (!number) return { body: process.env.PR_BODY ?? '' };
  if (!/^\d+$/.test(number)) stop('PR_NUMBER is not a pull request number.');
  const result = gh('api', `repos/${REPO}/pulls/${number}`, '--jq', '.body // ""');
  if (result.status !== 0) return { body: '', error: `the description of #${number} can't be read (${why(result)})` };
  return { body: result.stdout };
}

// A package's version at a commit or branch: { version } or { problem }.
function versionAt(ref, name, label) {
  const file = `plugins/${name}/.claude-plugin/plugin.json`;
  const shown = git('show', `${ref}:${file}`);
  if (shown.status !== 0) return { problem: `${file} can't be read ${label} (${why(shown)})` };
  let version;
  try {
    version = JSON.parse(shown.stdout).version;
  } catch {
    return { problem: `${file} ${label} is not valid JSON` };
  }
  if (typeof version !== 'string' || !VERSION.test(version)) return { problem: `the version ${label} is ${JSON.stringify(version)}: use x.y.z` };
  return { version };
}

// The order of two x.y.z versions, as a number: negative when `a` is lower. Parts count as numbers, so 1.10.0 is above 1.9.0.
const compare = (a, b) => {
  const [x, y] = [a, b].map((version) => version.split('.').map(Number));
  return x.map((part, i) => part - y[i]).find((difference) => difference !== 0) ?? 0;
};

// The files that differ from `base`: { files } or { error }.
function changedFiles(base, head, baseName) {
  const diff = git('diff', '--name-only', '-z', `${base}...${head}`);
  if (diff.status !== 0) return { error: `the files this change touches can't be listed against ${baseName} (${why(diff)})` };
  return { files: lines(diff.stdout, '\0') };
}

// A marketplace file with every sha blanked and its keys in order: what is left is everything but the pins.
const withoutShas = (data) =>
  JSON.stringify(data, (_key, value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
    const sorted = Object.fromEntries(Object.entries(value).sort(([a], [b]) => (a < b ? -1 : 1)));
    return typeof sorted.sha === 'string' && SHA.test(sorted.sha) ? { ...sorted, sha: '' } : sorted;
  });

// The arguments of `check`: { after, head }. `head` is the commit to read the pull request's state from, or null for HEAD
// and the working tree. It is a full hash, so that no value can pass for an option of git.
function checkArguments(args) {
  const options = { after: false, head: null };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--after-merge' && !options.after) options.after = true;
    else if (args[i] === '--head' && options.head === null) {
      options.head = args[++i];
      if (!SHA.test(options.head ?? '')) stop(`--head needs a commit hash of 40 lowercase hexadecimal digits.\n${USAGE}`);
    } else stop(USAGE);
  }
  return options;
}

function check(args) {
  const { after, head: given } = checkArguments(args);
  // BASE is looked up once, here, and every later git call uses the commit it names: a name looked up again could
  // answer differently (a tag called origin/main wins over the branch of that name). CI gives it as a full ref name.
  const baseName = process.env.BASE;
  if (!baseName) stop('Set BASE to the branch to compare with, such as origin/main.');
  const resolved = git('rev-parse', '--verify', '--quiet', '--end-of-options', `${baseName}^{commit}`);
  if (resolved.status !== 0) stop(`${baseName} can't be found: fetch the whole history first.`);
  const base = resolved.stdout.trim();
  // The pull request's state is read at `head`: a commit, as git objects, or HEAD and the working tree where none is given.
  const head = given ?? 'HEAD';
  if (given && git('rev-parse', '--verify', '--quiet', '--end-of-options', `${given}^{commit}`).status !== 0) stop(`${short(given)} is not a commit in this checkout: fetch it first.`);
  let text;
  if (given) {
    const shown = git('show', `${given}:${MARKETPLACE}`);
    if (shown.status !== 0) stop(`${MARKETPLACE} can't be read at ${short(given)} (${why(shown)}).`);
    text = shown.stdout;
  } else text = readFileSync(MARKETPLACE, 'utf8');
  const current = entriesOf(text, given ? `${MARKETPLACE} at ${short(given)}` : MARKETPLACE);
  if (current.error) stop(current.error);
  // A pin has to be a commit of main. On a pull request that is the base branch; after a merge, main is where we are.
  const tip = after ? head : base;

  // The pins on the base, by package. A base that has none (the paths before the first pin) has nothing to compare.
  const oldPins = new Map();
  let baseData = null;
  const shown = git('show', `${base}:${MARKETPLACE}`);
  if (shown.status === 0) {
    baseData = entriesOf(shown.stdout, `${MARKETPLACE} on ${baseName}`).data ?? null;
    for (const entry of baseData?.plugins ?? []) {
      if (sourceProblem(entry) === null) oldPins.set(entry.name, entry.source.sha);
    }
  }

  let urgent; // Read when the first pin turns out to be early, not before: most runs never need it.
  const problems = shapeProblems(current.data);
  const moves = [];
  for (const entry of current.entries) {
    if (entryProblem(entry)) continue;
    const name = entry.name;
    const found = (message) => problems.push(`${name}: ${message}`);
    const { sha } = entry.source;
    const old = oldPins.get(name);
    if (sha === old) continue;
    const move = { name, old, sha, early: false };
    moves.push(move);

    const ancestor = git('merge-base', '--is-ancestor', sha, tip);
    if (ancestor.status !== 0) {
      found(
        ancestor.status === 1
          ? `${short(sha)} is not a commit of ${after ? 'main' : baseName}: pin a commit that has been merged`
          : `${short(sha)} can't be found in this checkout (${why(ancestor)})`,
      );
      continue;
    }

    if (after) move.text = 'its age is not checked after the merge';
    else {
      const age = waited(sha);
      move.text = age.text ?? age.why;
      if (age.why) {
        urgent ??= description();
        const reason = urgentReason(urgent.body);
        if (reason) move.early = reason;
        else found(`${short(sha)}: ${age.why}. Wait, or give the reason in an "Urgent: <reason>" line of the pull request description${urgent.error ? ` (${urgent.error})` : ''}`);
      }
    }

    // Never a lower version than people get now: the old pin's, or, for a first pin, the base branch's.
    let reference = null;
    if (old) reference = versionAt(old, name, `at ${short(old)}`);
    else if (git('cat-file', '-e', `${base}:plugins/${name}/.claude-plugin/plugin.json`).status === 0) reference = versionAt(base, name, `on ${baseName}`);
    if (reference) {
      const next = versionAt(sha, name, `at ${short(sha)}`);
      if (reference.problem || next.problem) found(reference.problem ?? next.problem);
      else if (compare(next.version, reference.version) < 0) found(`its version goes down, from ${reference.version} ${old ? `at ${short(old)}` : `on ${baseName}`} to ${next.version} at ${short(sha)}`);
    }
  }

  // Every package is pinned to one commit: `move` sets them together.
  const pinned = [...new Set(current.entries.filter((entry) => !entryProblem(entry)).map((entry) => entry.source.sha))];
  if (pinned.length > 1) problems.push(`The packages are pinned to different commits (${pinned.map(short).join(', ')}): they move together`);

  const changed = changedFiles(base, head, baseName);
  if (changed.error) problems.push(changed.error);
  // A pull request that moves a pin changes only the pins, so that it can be read as that. In the pin-from-main check this
  // is main's copy of this file, reading the pull request's state as data (--head), so a pull request that changes it
  // doesn't change how it is judged there; ci.yml runs the pull request's own copy, which only the maintainer's review of
  // guarded files holds. The first pin, from paths, is the one exception.
  if (oldPins.size > 0 && moves.some((move) => move.old) && baseData) {
    const others = (changed.files ?? []).filter((file) => file !== MARKETPLACE);
    if (others.length) problems.push(`A pull request that moves the pin changes only ${MARKETPLACE}: this one also changes ${others.slice(0, 5).map((file) => JSON.stringify(file)).join(', ')}${others.length > 5 ? ` and ${others.length - 5} more` : ''}`);
    if (withoutShas(baseData) !== withoutShas(current.data)) problems.push(`A pull request that moves the pin changes only the sha values in ${MARKETPLACE}: this one changes more`);
  }

  for (const move of moves) console.log(`${move.name}: the pin moves from ${move.old ? short(move.old) : 'a path'} to ${short(move.sha)} (${move.text ?? 'not on the base'})`);
  const early = moves.find((move) => move.early);
  if (early) console.log(`Pinned early: ${early.early}`);
  for (const problem of problems) console.log(problem);
  if (!moves.length && !problems.length) console.log('The pins are unchanged.');

  if (process.env.GITHUB_STEP_SUMMARY) {
    const summary = [`## Changes to what runs on people's machines${after ? ' (after the merge)' : ''}`, '', '### The pin', ''];
    if (moves.length) {
      for (const move of moves) summary.push(`- ${code(move.name)}: from ${move.old ? code(short(move.old)) : 'a path'} to ${code(short(move.sha))}, ${move.text ?? 'not on the base'}`);
      if (early) summary.push(`- Pinned early: ${early.early}`);
    } else summary.push('The pins are unchanged.');
    summary.push('', '### Files this pull request changes that a person must approve', '');
    const files = (changed.files ?? []).filter(isGuarded);
    if (files.length) summary.push(...files.map((file) => `- ${code(file)}`));
    else summary.push('None: only the READMEs, MAINTAINING.md and LICENSE.md.');
    if (problems.length) summary.push('', '### Problems', '', ...problems.map((problem) => `- ${problem}`));
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${summary.join('\n')}\n`);
  }
  process.exitCode = problems.length ? 1 : 0;
}

// Why main's protection would not hold the pin: a list, empty where it would. A pull request that nobody may bypass, the
// packages check and the pin-from-main check (main's copy of this one, run on the pull request's files), each reported by
// GitHub Actions, on an up-to-date branch, no force pushes, and no way round it for an administrator. (An administrator
// can still switch the protection off; nothing in this repository can stop that.)
function protectionProblems() {
  const { data, error } = api(`repos/${REPO}/branches/main/protection`);
  if (error) return [`the protection of main can't be read (${error})`];
  const problems = [];
  if (!data.required_pull_request_reviews) problems.push('pull requests are not required to merge into main');
  const required = data.required_status_checks;
  for (const context of REQUIRED_CHECKS) {
    const named = (required?.checks ?? []).filter((item) => item.context === context);
    if (!named.length && !(required?.contexts ?? []).includes(context)) problems.push(`the "${context}" check is not required to merge into main`);
    else if (!named.some((item) => item.app_id === ACTIONS_APP)) problems.push(`the "${context}" check is not tied to the GitHub Actions app (${ACTIONS_APP}), so another app could report it`);
  }
  const bypass = data.required_pull_request_reviews?.bypass_pull_request_allowances;
  if (bypass && ['users', 'teams', 'apps'].some((kind) => (bypass[kind] ?? []).length)) problems.push('some users, teams or apps may bypass the pull request requirement on main');
  if (data.required_status_checks?.strict !== true) problems.push('a pull request is not required to be up to date with main before it merges');
  if (data.allow_force_pushes?.enabled !== false) problems.push('force pushes to main are allowed');
  if (data.enforce_admins?.enabled !== true) problems.push('administrators are not held to the protection of main');
  return problems;
}

// Whether `origin` is this repository, as the clone has it configured (what a person's own `insteadOf` rewrites it to
// doesn't matter): the push URL too, if it has one of its own. Null where it is, else why not.
function originProblem() {
  const url = git('config', '--get', 'remote.origin.url');
  if (url.status !== 0) return "the remote origin isn't set";
  const pushUrl = git('config', '--get', 'remote.origin.pushurl');
  for (const address of [url.stdout.trim(), ...(pushUrl.status === 0 ? [pushUrl.stdout.trim()] : [])]) {
    if (!ORIGIN.test(address)) return `the remote origin is ${address}, not github.com/${SOURCE_URL}`;
  }
  return null;
}

function moveArguments(args) {
  const options = { dryRun: false };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--dry-run') options.dryRun = true;
    else if (args[i] === '--sha' || args[i] === '--urgent') {
      if (args[i + 1] === undefined) stop(`${args[i]} needs a value.`);
      options[args[i].slice(2)] = args[++i];
    } else stop(`Unknown argument ${args[i]}.\n${USAGE}`);
  }
  if (options.urgent !== undefined && options.sha === undefined) stop('--urgent goes with --sha: without it, the pin moves only to a commit that has waited.');
  if (options.urgent !== undefined && (!options.urgent.trim() || /[\r\n]/.test(options.urgent))) stop('--urgent needs a reason, on one line.');
  if (options.sha !== undefined && !/^[0-9a-f]{7,40}$/i.test(options.sha)) stop(`--sha ${options.sha} is not a commit hash.`);
  return options;
}

function move(args) {
  const options = moveArguments(args);
  // The pins are this repository's; GITHUB_REPOSITORY, which names where the gh calls go, must not point elsewhere.
  // PIN_TEST_REPO is for the tests, which run against a stand-in gh.
  const expected = process.env.PIN_TEST_REPO || SOURCE_URL;
  if (REPO.toLowerCase() !== expected.toLowerCase()) stop(`The pin is moved in ${expected}, and GITHUB_REPOSITORY is ${REPO}.`);
  const top = git('rev-parse', '--show-toplevel');
  if (top.status !== 0) stop(`Run it inside a clone of ${SOURCE_URL} (${why(top)}).`);
  process.chdir(top.stdout.trim());
  const elsewhere = originProblem();
  if (elsewhere) stop(`This is not a clone of ${SOURCE_URL}: ${elsewhere}.`);
  const unprotected = protectionProblems();
  if (unprotected.length) stop(`The pin holds only while main is protected, so it was not moved:\n${unprotected.map((problem) => `- ${problem}`).join('\n')}`);

  const fetched = git('fetch', 'origin', 'main');
  if (fetched.status !== 0) stop(`origin/main can't be fetched (${why(fetched)}).`);
  // The pin on main, not in this checkout: the pull request is made from main.
  const shown = git('show', `origin/main:${MARKETPLACE}`);
  if (shown.status !== 0) stop(`${MARKETPLACE} can't be read on origin/main (${why(shown)}).`);
  const market = entriesOf(shown.stdout, `${MARKETPLACE} on origin/main`);
  if (market.error) stop(market.error);
  const unfit = shapeProblems(market.data);
  if (unfit.length || !market.entries.length) stop(`${MARKETPLACE} on origin/main isn't pinned as it should be yet:\n${unfit.map((problem) => `- ${problem}`).join('\n')}`);
  const olds = new Set(market.entries.map((entry) => entry.source.sha));
  if (olds.size !== 1) stop(`The packages are pinned to different commits (${[...olds].map(short).join(', ')}): set them to one commit first.`);
  const [old] = olds;

  let sha;
  let early = null;
  if (options.sha !== undefined) {
    const resolved = git('rev-parse', '--verify', '--quiet', `${options.sha}^{commit}`);
    if (resolved.status !== 0) stop(`${options.sha} is not a commit in this checkout.`);
    sha = resolved.stdout.trim();
    if (git('merge-base', '--is-ancestor', sha, 'origin/main').status !== 0) stop(`${short(sha)} is not on origin/main: pin a commit that has been merged.`);
    if (git('merge-base', '--is-ancestor', sha, old).status === 0) stop(`${short(sha)} is already in the pin ${short(old)}, so there is nothing to move.`);
    const age = waited(sha);
    if (age.why && options.urgent === undefined) stop(`${short(sha)} can't be pinned yet: ${age.why}.\nWait, or pass --urgent "<reason>" for a fix that can't.`);
    early = options.urgent ?? null;
  } else {
    // The newest commit past the pin whose pull request has waited. First parents only: each is a pull request's merge.
    const listed = git('rev-list', '--first-parent', `${old}..origin/main`);
    if (listed.status !== 0) stop(`The commits after the pin ${short(old)} can't be listed (${why(listed)}).`);
    const newer = lines(listed.stdout);
    for (const candidate of newer) {
      const age = waited(candidate);
      if (age.lookup) stop(`${short(candidate)}: ${age.why}.`);
      if (!age.why) {
        sha = candidate;
        break;
      }
      console.log(`Not ${short(candidate)}: ${age.why}.`);
    }
    if (!sha) stop(`Nothing to move to: of the ${newer.length} commits on origin/main after the pin ${short(old)}, none has waited ${WAIT_DAYS} days.`);
  }

  const commits = git('log', '--no-decorate', '--format=%H%x09%h %s', `${old}..${sha}`);
  const changed = git('diff', '--name-only', '-z', old, sha);
  const firstParents = git('rev-list', '--first-parent', `${old}..${sha}`);
  const unlisted = [commits, changed, firstParents].find((result) => result.status !== 0);
  if (unlisted) stop(`The commits between ${short(old)} and ${short(sha)} can't be listed (${why(unlisted)}).`);
  // A subject goes into the description on one line: a line break in it could start a line of its own there.
  const subjects = new Map(lines(commits.stdout).map((line) => [line.slice(0, line.indexOf('\t')), line.slice(line.indexOf('\t') + 1).replace(/[\r\n]/g, ' ')]));
  // A commit that reached main without a merged pull request into it was never reviewed as one: say so.
  const unreviewed = lines(firstParents.stdout).flatMap((commit) => {
    const found = mergedBy(commit);
    return found.missing || found.error ? [`- ${subjects.get(commit) ?? short(commit)}${found.error ? ` (its pull request can't be looked up: ${found.error})` : ''}`] : [];
  });
  const guardedFiles = lines(changed.stdout, '\0').filter(isGuarded);
  const title = `Move the plugin pin to ${short(sha)}`;
  const body = [
    ...(early ? [`Urgent: ${early}`, ''] : []),
    `Moves the plugin pin from ${code(short(old))} to ${code(short(sha))}. These commits are new in it:`,
    '',
    ...[...subjects.values()].map((line) => `- ${line}`),
    ...(unreviewed.length ? ['', 'Warning: these commits have no merged pull request into main, so nobody reviewed them as one:', '', ...unreviewed] : []),
    '',
    "It changes these files, which run on people's machines or are the checks themselves, so a person approves this pull request:",
    '',
    ...(guardedFiles.length ? guardedFiles.map((file) => `- ${code(file)}`) : ['None.']),
  ].join('\n');
  for (const entry of market.entries) entry.source.sha = sha;
  const updated = `${JSON.stringify(market.data, null, 2)}\n`;
  const branch = `pin-${short(sha)}`;

  if (options.dryRun) {
    console.log(`Dry run: nothing was changed.\nBranch: ${branch}\nTitle: ${title}\n\n${body}\n\n${MARKETPLACE} would be:\n${updated}`);
    return;
  }
  if (git('status', '--porcelain', '--untracked-files=no').stdout.trim()) stop('Commit or stash your changes first: the pin goes on a new branch from origin/main.');
  // What a failed step leaves behind, and how to take it away again.
  const done = { branch: false, written: false, committed: false, pushed: false };
  const undo = () =>
    [
      done.written && !done.committed ? `git restore --staged --worktree ${MARKETPLACE}` : null,
      done.branch ? 'git switch -' : null,
      done.branch ? `git branch -D ${branch}` : null,
      done.pushed ? `git push origin --delete ${branch}` : null,
    ]
      .filter(Boolean)
      .join('\n  ');
  const steps = [
    ['create the branch', 'branch', () => git('switch', '--no-track', '-c', branch, 'origin/main')],
    ['write the marketplace', 'written', () => (writeFileSync(MARKETPLACE, updated), git('add', MARKETPLACE))],
    // With the runner's own git configuration: the name, email and key it commits and signs with.
    ['commit', 'committed', () => git('commit', '-m', title)],
    ['push the branch', 'pushed', () => git('push', '--set-upstream', 'origin', branch)],
    ['open the pull request', null, () => gh('pr', 'create', '--repo', REPO, '--base', 'main', '--head', branch, '--title', title, '--body', body)],
  ];
  for (const [what, mark, step] of steps) {
    const result = step();
    if (result.status !== 0) {
      stop(`Could not ${what}: ${why(result)}\nThe steps before it are done, the ones after it are not.${undo() ? `\nTo undo what was done:\n  ${undo()}` : ''}`);
    }
    if (mark) done[mark] = true;
    if (!mark) console.log(result.stdout.trim());
  }
  console.log('A person approves and merges it; an agent never does.');
}

// Runs from the base branch's checkout, on pull_request_target, with a token that can write labels: it must run nothing
// from the pull request. It reads the names of the files the pull request changes from the API, as data, and sorts them
// with the base branch's own guarded.mjs. A renamed file counts under both its names. GitHub lists at most 3000 files of a
// pull request: where it says there are more than it listed, some are not seen, and the pull request is labelled.
function guarded() {
  const number = process.env.PR_NUMBER;
  if (!/^\d+$/.test(number ?? '')) stop('Set PR_NUMBER to the pull request.');
  const listed = gh('api', '--paginate', `repos/${REPO}/pulls/${number}/files`, '--jq', '.[] | [.filename, (.previous_filename // empty)] | @json');
  if (listed.status !== 0) stop(`The files of #${number} can't be listed (${why(listed)}).`);
  let entries;
  try {
    entries = lines(listed.stdout).map((line) => JSON.parse(line));
    if (!entries.every((names) => Array.isArray(names) && names.every((name) => typeof name === 'string'))) throw new Error('not names');
  } catch {
    stop(`The files of #${number} can't be read: gh answered with something that is not a list of names.`);
  }
  const total = gh('api', `repos/${REPO}/pulls/${number}`, '--jq', '.changed_files');
  const count = Number(total.stdout.trim());
  if (total.status !== 0 || !total.stdout.trim() || !Number.isInteger(count)) stop(`The number of files #${number} changes can't be read (${why(total)}).`);
  const unseen = count > entries.length;
  const files = [...new Set(entries.flat())].filter(isGuarded);
  if (!files.length && !unseen) {
    // The label stays off a pull request that no longer changes a guarded file.
    const view = gh('pr', 'view', number, '--repo', REPO, '--json', 'labels');
    let labels;
    try {
      labels = JSON.parse(view.stdout).labels.map((label) => label.name);
    } catch {
      stop(`The labels of #${number} can't be read (${why(view)}).`);
    }
    if (!labels.includes(GUARD_LABEL)) {
      console.log('No guarded file changes, so no label.');
      return;
    }
    const removed = gh('pr', 'edit', number, '--repo', REPO, '--remove-label', GUARD_LABEL);
    if (removed.status !== 0) stop(`gh pr edit failed (${why(removed)}).`);
    console.log(`No guarded file changes any more, so #${number} loses the ${GUARD_LABEL} label.`);
    return;
  }
  if (unseen) console.log(`GitHub lists ${entries.length} of the ${count} files #${number} changes, so some are not seen: it gets the ${GUARD_LABEL} label.`);
  if (files.length) console.log(`These guarded files change, so #${number} gets the ${GUARD_LABEL} label:\n${files.map((file) => `- ${JSON.stringify(file)}`).join('\n')}`);
  const label = ['label', 'create', GUARD_LABEL, '--repo', REPO, '--color', 'B60205', '--description', "Changes what runs on people's machines", '--force'];
  const add = ['pr', 'edit', number, '--repo', REPO, '--add-label', GUARD_LABEL];
  for (const args of [label, add]) {
    const result = gh(...args);
    if (result.status !== 0) stop(`gh ${args.slice(0, 2).join(' ')} failed (${why(result)}).`);
  }
}

const [command, ...args] = process.argv.slice(2);
if (command === 'check') check(args);
else if (command === 'move') move(args);
else if (command === 'guarded' && !args.length) guarded();
else stop(USAGE);
