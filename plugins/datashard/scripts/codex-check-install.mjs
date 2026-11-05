// Runs before a Codex save or flag on the Datashard server (codex/hooks.json starts it). Codex sends the hook one
// flat JSON object, and only its top-level tool_name and cwd are read here, never anything inside tool_input.
// The address is the one Codex itself resolves for the datashard server (`codex mcp get`), which replaces the
// plugin's placeholder; check-install.sh compares it with the project's DATASHARD.md. Codex carries on when a hook
// fails, and does not support a hook answering "allow" or "ask", so a save this check cannot clear is denied and
// a save that is cleared prints nothing.
import { spawnSync } from 'node:child_process';
import { readFileSync, statSync, writeSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const finish = (reason) => {
  if (reason) {
    const hookSpecificOutput = { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason };
    writeSync(1, `${JSON.stringify({ hookSpecificOutput })}\n`);
  }
  process.exit(0);
};

// Everything Codex writes to the hook's stdin, up to the end of the input.
async function readInput() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

const isFolder = (path) => { try { return statSync(path).isDirectory(); } catch { return false; } };

// The first url in the [mcp_servers.datashard] table of config.toml, for when `codex` is not on the hook's PATH:
// a basic or literal string, after any indentation and before any comment.
function urlFromConfig() {
  let text;
  try { text = readFileSync(join(process.env.CODEX_HOME || join(homedir(), '.codex'), 'config.toml'), 'utf8'); } catch { return undefined; }
  let inTable = false;
  for (const line of text.split(/\r?\n/)) {
    const header = line.match(/^\s*\[+([^[\]]*)\]+\s*(#.*)?$/);
    if (header) { inTable = header[1].replace(/[\s"']/g, '') === 'mcp_servers.datashard'; continue; }
    const value = inTable && line.match(/^\s*url\s*=\s*(?:"((?:[^"\\]|\\.)*)"|'([^']*)')\s*(#.*)?$/);
    if (value) { try { return value[2] ?? JSON.parse(`"${value[1]}"`); } catch { return undefined; } }
  }
  return undefined;
}

function serverAddress() {
  const run = spawnSync('codex', ['mcp', 'get', 'datashard', '--json'], { encoding: 'utf8', timeout: 4000, stdio: ['ignore', 'pipe', 'ignore'] });
  if (run.error?.code === 'ENOENT') return urlFromConfig();
  try {
    const url = JSON.parse(run.stdout).transport?.url;
    return run.status === 0 && typeof url === 'string' ? url : undefined;
  } catch { return undefined; }
}

// check-install.sh speaks to Claude Code. The same decision in Codex's words, each phrase replaced as a whole and
// never inside the folder it quotes back.
const words = [
  ['Set it in /config, then run /datashard:init.', 'Register it with `codex mcp add datashard --url https://<your-install>/mcp`, then run $datashard-init.'],
  ["Save only if this project's knowledge belongs there", "This save is blocked until this project's DATASHARD.md names this install"],
  ['save only if this project belongs to the install the plugin connects to', 'this save is blocked'],
  ['/datashard:init', '$datashard-init'],
  ['Claude Code', 'Codex'],
];
const inCodexWords = (reason, folder) =>
  (folder.length > 1 ? reason.split(folder) : [reason])
    .map((part) => words.reduce((text, [from, to]) => text.split(from).join(to), part))
    .join(folder);

try {
  let payload;
  try { payload = JSON.parse(await readInput()); } catch { /* not JSON */ }
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
    finish("The Datashard save check could not read the hook's input from Codex (empty, not JSON, or not an object), so this save was blocked.");
  }
  const { tool_name: tool, cwd } = payload;
  if (typeof tool !== 'string') finish("The Datashard save check was given no tool name by Codex, so this save was blocked.");
  if (!/^mcp__(plugin_datashard_)?datashard__(save|flag)$/.test(tool)) finish();
  if (typeof cwd !== 'string' || !isAbsolute(cwd) || !isFolder(cwd)) {
    finish("The Datashard save check was not given the folder Codex is working in (an absolute path to an existing folder), so it cannot find this project's DATASHARD.md and this save was blocked.");
  }

  let address = serverAddress();
  if (!address) {
    finish("The Datashard save check could not read the datashard server's address from the Codex configuration, so this save was blocked. Run `codex mcp add datashard --url https://<your-install>/mcp` to register it.");
  }
  // The plugin ships example.invalid so a fresh install does not name a company; an unfilled template is no address either.
  if (/^[^/]*:\/\/example\.invalid([/:]|$)/.test(address) || address.includes('${')) address = '';

  const check = spawnSync('bash', [join(dirname(fileURLToPath(import.meta.url)), 'check-install.sh')], {
    env: { ...process.env, CLAUDE_PROJECT_DIR: cwd, CLAUDE_PLUGIN_OPTION_DATASHARD_URL: address },
    encoding: 'utf8', timeout: 4000, stdio: ['ignore', 'pipe', 'ignore'],
  });
  if (check.error || check.status !== 0) finish('The Datashard save check could not compare this save with the project (its comparison script did not run), so this save was blocked.');
  if (!check.stdout.trim()) finish();
  let verdict;
  try { verdict = JSON.parse(check.stdout).hookSpecificOutput; } catch { /* unreadable */ }
  if (verdict?.permissionDecision === 'allow') finish();
  if (!['deny', 'ask'].includes(verdict?.permissionDecision) || typeof verdict.permissionDecisionReason !== 'string' || !verdict.permissionDecisionReason) {
    finish("The Datashard save check could not read the answer of its comparison script, so this save was blocked.");
  }
  finish(inCodexWords(verdict.permissionDecisionReason, resolve(cwd)));
} catch {
  finish('The Datashard save check failed unexpectedly, so this save was blocked.');
}
