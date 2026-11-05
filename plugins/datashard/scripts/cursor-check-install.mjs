// Runs before a Cursor MCP call that names Datashard (cursor-check-install.sh starts it). Cursor sends the hook one flat
// JSON object, and only its top-level fields are read here, never anything inside tool_input. A save or flag on the
// Datashard server is compared by check-install.sh with the project's DATASHARD.md; any other call is allowed. The
// answer is Cursor's permission JSON.
import { spawnSync } from 'node:child_process';
import { writeSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const COULD_NOT_CHECK = 'The Datashard plugin could not check which install this save belongs to. Save only if this project belongs to the install the plugin connects to.';

const finish = (permission, reason) => {
  const answer = reason ? { permission, user_message: reason, agent_message: reason } : { permission };
  writeSync(1, `${JSON.stringify(answer)}\n`);
  process.exit(0);
};
const ask = (reason = COULD_NOT_CHECK) => finish('ask', reason);

// Everything Cursor writes to the hook's stdin, up to the end of the input.
async function readInput() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

const text = (value) => (typeof value === 'string' ? value : '');

// check-install.sh speaks to Claude Code. The same decision in Cursor's words, each phrase replaced as a whole and
// never inside the folder it quotes back.
const words = [
  ['/config', 'the Datashard address setting'],
  ['/datashard:init', '/datashard-init'],
  ['Claude Code', 'Cursor'],
];
const inCursorWords = (reason, folder) =>
  (folder.length > 1 ? reason.split(folder) : [reason])
    .map((part) => words.reduce((out, [from, to]) => out.split(from).join(to), part))
    .join(folder);

try {
  let payload;
  try { payload = JSON.parse(await readInput()); } catch { /* not JSON */ }
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) ask();

  const tool = text(payload.tool_name);
  const server = text(payload.mcp_server_name);
  if (!server.includes('datashard') && !tool.includes('datashard')) finish('allow');
  if (!/^(MCP:)?(save|flag)$|__(save|flag)$/.test(tool)) finish('allow');

  // Cursor leaves an unfilled ${DATASHARD_URL} in the address. That is no address.
  let url = text(payload.mcp_server_url) || text(payload.url);
  if (url.includes('${')) url = '';
  const root = (Array.isArray(payload.workspace_roots) ? text(payload.workspace_roots[0]) : '') || text(payload.cwd);
  if (!root) ask();

  const check = spawnSync('bash', [join(dirname(fileURLToPath(import.meta.url)), 'check-install.sh')], {
    env: { ...process.env, CLAUDE_PROJECT_DIR: root, CLAUDE_PLUGIN_OPTION_DATASHARD_URL: url },
    encoding: 'utf8', timeout: 4000, stdio: ['ignore', 'pipe', 'ignore'],
  });
  if (check.error || check.status !== 0) ask();
  if (!check.stdout.trim()) finish('allow');
  let verdict;
  try { verdict = JSON.parse(check.stdout).hookSpecificOutput; } catch { /* unreadable */ }
  if (verdict?.permissionDecision === 'allow') finish('allow');
  if (!['deny', 'ask'].includes(verdict?.permissionDecision) || typeof verdict.permissionDecisionReason !== 'string' || !verdict.permissionDecisionReason) ask();
  finish(verdict.permissionDecision, inCursorWords(verdict.permissionDecisionReason, resolve(root)));
} catch {
  ask();
}
