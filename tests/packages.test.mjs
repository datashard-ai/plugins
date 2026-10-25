import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, readdirSync, realpathSync, lstatSync, existsSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
const root = fileURLToPath(new URL('..', import.meta.url));
const read = p => readFileSync(join(root,p),'utf8');
const json = p => JSON.parse(read(p));
function scratch(t) { const p=mkdtempSync(join(tmpdir(),'plugins-test-')); t.after(()=>rmSync(p,{recursive:true,force:true})); return p; }
function shell(script,args=[],env={}) {
  return spawnSync('/bin/bash',[join(root,script),...args],{env:{...process.env,...env},encoding:'utf8',timeout:10000,input:'{}'});
}
function executable(p,body) { writeFileSync(p,'#!/bin/bash\nset -eu\n'+body,{mode:0o700}); }
const ds='plugins/datashard/scripts/install-codex.sh';
const mn='plugins/mnem0nic/scripts/setup.sh';
const packageFiles = [
 'plugins/datashard/.claude-plugin/plugin.json','plugins/datashard/.mcp.json','plugins/datashard/README.md',
 'plugins/datashard/hooks/hooks.json','plugins/datashard/scripts/check-install.sh','plugins/datashard/scripts/guard-datashard-md.sh','plugins/datashard/scripts/install-codex.sh',
 'plugins/datashard/skills/init/SKILL.md','plugins/datashard/skills/save-to-datashard/SKILL.md','plugins/datashard/skills/save-to-datashard/fact-format.md','plugins/datashard/templates/DATASHARD.md',
 'plugins/datashard/codex/skills/datashard-init/SKILL.md','plugins/datashard/codex/skills/datashard-init/assets/DATASHARD.md','plugins/datashard/codex/skills/datashard-init/agents/openai.yaml',
 'plugins/mnem0nic/.claude-plugin/plugin.json','plugins/mnem0nic/.codex-plugin/plugin.json','plugins/mnem0nic/README.md','plugins/mnem0nic/scripts/setup.sh','plugins/mnem0nic/skills/mnem0nic/SKILL.md'
];
function files(dir) { return readdirSync(dir).flatMap(n=>{const p=join(dir,n); const s=lstatSync(p); assert.ok(!s.isSymbolicLink(),`Distribution cannot contain symlink: ${p}`);return s.isDirectory()?files(p):[relative(root,p)];}); }

test('distribution contains only reviewed integration files, no implementation or personal data',()=>{
 assert.deepEqual(files(join(root,'plugins')).sort(),packageFiles.sort());
 for(const p of packageFiles) {
   const body=read(p);
   assert.doesNotMatch(body,/\/Users\/|\/private\/var\/|xbt\.datashard\.ai|-----BEGIN [A-Z ]*PRIVATE KEY-----/);
 }
});
test('marketplace packages and their component paths resolve inside the distribution',()=>{
 const catalog=json('.claude-plugin/marketplace.json');
 assert.equal(catalog.name,'datashard');
 assert.deepEqual(catalog.plugins.map(p=>p.name),['datashard','mnem0nic']);
 for(const entry of catalog.plugins) {
   assert.ok(entry.source.startsWith('./')&&!entry.source.includes('..'));
   const manifest=json(entry.source+'/.claude-plugin/plugin.json');
   assert.equal(manifest.name,entry.name);
   assert.equal(manifest.repository,'https://github.com/datashard-ai/plugins');
 }
 const codex=json('plugins/mnem0nic/.codex-plugin/plugin.json');
 assert.ok(existsSync(join(root,'plugins/mnem0nic',codex.skills,'mnem0nic/SKILL.md')));
 const mcp=json('plugins/datashard/.mcp.json');
 assert.equal(mcp.mcpServers.datashard.url,'${user_config.datashard_url}');
 assert.ok(!existsSync(join(root,'plugins/mnem0nic/.mcp.json')));
});
test('Datashard skills-only installs from nested package and reruns without modifying local files',t=>{
 const p=scratch(t); let r=shell(ds,['--skills-only',p]); assert.equal(r.status,0,r.stderr);
 const skill=join(p,'.agents/skills/datashard-init/SKILL.md');const before=readFileSync(skill,'utf8');
 r=shell(ds,['--skills-only',p]);assert.equal(r.status,0,r.stderr);assert.equal(readFileSync(skill,'utf8'),before);
 writeFileSync(skill,'user customization'); r=shell(ds,['--skills-only',p]);assert.notEqual(r.status,0);assert.equal(readFileSync(skill,'utf8'),'user customization');
});
test('Datashard installer refuses invalid URL or existing server before installing skills',t=>{
 const p=scratch(t);const bin=join(p,'bin');mkdirSync(bin);
 executable(join(bin,'codex'),'exit 0\n');
 for(const address of ['http://example.com/mcp','https://user:secret@example.com/mcp','https://example.com/mcp']) {
   const r=shell(ds,[address,p],{PATH:bin+':'+process.env.PATH});assert.notEqual(r.status,0);assert.ok(!existsSync(join(p,'.agents')));
 }
});
test('Datashard registers only the supplied HTTPS endpoint',t=>{
 const p=scratch(t);const bin=join(p,'bin');mkdirSync(bin);const log=join(p,'calls');
 executable(join(bin,'codex'),'if [[ "$2" == get ]]; then echo "Error: No MCP server named \'datashard\' found." >&2; exit 1; fi\nprintf "%s\\n" "$@" > "$CALL_LOG"\n');
 const r=shell(ds,['https://example.com/mcp',p],{PATH:bin+':'+process.env.PATH,CALL_LOG:log});
 assert.equal(r.status,0,r.stderr);assert.equal(readFileSync(log,'utf8'),'mcp\nadd\ndatashard\n--url\nhttps://example.com/mcp\n');
 assert.ok(existsSync(join(p,'.agents/skills/save-to-datashard/fact-format.md')));
});
test('Datashard save guard still refuses a different install after packaging',t=>{
 const p=scratch(t);writeFileSync(join(p,'DATASHARD.md'),'## This project\n- Install: https://other.example.com/mcp\n');
 const r=shell('plugins/datashard/scripts/check-install.sh',[],{CLAUDE_PROJECT_DIR:p,CLAUDE_PLUGIN_OPTION_DATASHARD_URL:'https://example.com/mcp'});
 assert.equal(r.status,0,r.stderr);assert.equal(JSON.parse(r.stdout).hookSpecificOutput.permissionDecision,'deny');
});
function mockMemory(t) {
 const p=scratch(t),binary=join(p,"mnem0nic binary's file"),project=join(p,'project with spaces');mkdirSync(project);
 executable(binary,'if [[ "$1" == --version ]]; then echo "mnem0nic 0.1.0"; exit; fi\n[[ "$1" == --project && "$3" == init ]]\nprintf "%s" "$2" > "$INIT_LOG"\n');
 return {p,binary,project,env:{INIT_LOG:join(p,'init-log')}};
}
test('memory setup passes spaced paths safely and optionally installs the Codex skill',t=>{
 const {binary,project,env}=mockMemory(t);let r=shell(mn,[binary,project,'--codex'],env);assert.equal(r.status,0,r.stderr);
 assert.equal(readFileSync(env.INIT_LOG,'utf8'),realpathSync(project));assert.ok(existsSync(join(project,'.agents/skills/mnem0nic/SKILL.md')));
 r=shell(mn,[binary,project,'--codex'],env);assert.equal(r.status,0,r.stderr);
});
test('memory setup preserves differing local skill before invoking binary init',t=>{
 const {binary,project,env}=mockMemory(t);const dest=join(project,'.agents/skills/mnem0nic');mkdirSync(dest,{recursive:true});writeFileSync(join(dest,'SKILL.md'),'custom');
 const r=shell(mn,[binary,project,'--codex'],env);assert.notEqual(r.status,0);assert.ok(!existsSync(env.INIT_LOG));assert.equal(readFileSync(join(dest,'SKILL.md'),'utf8'),'custom');
});
test('memory setup rejects symlink skill parents before changing project',t=>{
 const {p,binary,project,env}=mockMemory(t);const outside=join(p,'outside');mkdirSync(outside);symlinkSync(outside,join(project,'.agents'));
 const r=shell(mn,[binary,project,'--codex'],env);assert.notEqual(r.status,0);assert.ok(!existsSync(env.INIT_LOG));assert.deepEqual(readdirSync(outside),[]);
});
test('memory setup fails for missing executable and does not install skill',t=>{
 const {project,env}=mockMemory(t);const r=shell(mn,['/nonexistent/mnem0nic',project,'--codex'],env);assert.notEqual(r.status,0);assert.ok(!existsSync(join(project,'.agents')));
});
test('memory setup does not install Codex skill without --codex',t=>{
 const {binary,project,env}=mockMemory(t);const r=shell(mn,[binary,project],env);assert.equal(r.status,0,r.stderr);assert.ok(!existsSync(join(project,'.agents')));
});

test('Datashard rejects symlinked skills parent before changing connection or files',t=>{
 const p=scratch(t),outside=join(p,'outside'),project=join(p,'project');mkdirSync(outside);mkdirSync(project);symlinkSync(outside,join(project,'.agents'));
 const r=shell(ds,['--skills-only',project]);assert.notEqual(r.status,0);assert.deepEqual(readdirSync(outside),[]);
});

test('Datashard refuses unknown lookup failures rather than overwriting an existing server',t=>{
 const p=scratch(t),bin=join(p,'bin');mkdirSync(bin);
 const log=join(p,'calls');
 executable(join(bin,'codex'),'if [[ "$2" == get ]]; then echo "Error: permission denied reading config" >&2; exit 1; fi\necho called > "$CALL_LOG"\n');
 const r=shell(ds,['https://example.com/mcp',p],{PATH:bin+':'+process.env.PATH,CALL_LOG:log});
 assert.notEqual(r.status,0);assert.ok(!existsSync(log));assert.ok(!existsSync(join(p,'.agents')));
});
test('memory setup supports SQLite with double-quoted strings disabled',t=>{
 const {p,binary,project,env}=mockMemory(t),bin=join(p,'bin');mkdirSync(bin);
 const sqlite=spawnSync('/bin/sh',['-c','command -v sqlite3'],{encoding:'utf8'}).stdout.trim();
 assert.ok(sqlite.startsWith('/'));
 executable(join(bin,'sqlite3'),'exec "$REAL_SQLITE" -cmd ".dbconfig dqs_dml off" "$@"\n');
 const r=shell(mn,[binary,project],{...env,REAL_SQLITE:sqlite,PATH:bin+':'+process.env.PATH});
 assert.equal(r.status,0,r.stderr);assert.ok(existsSync(env.INIT_LOG));
});
test('every tracked repository file belongs to the reviewed distribution',()=>{
 const r=spawnSync('git',['-C',root,'ls-files','-z'],{encoding:'utf8'});
 assert.equal(r.status,0,r.stderr);
 const allowed=new Set([...packageFiles,'.claude-plugin/marketplace.json','.gitignore','README.md','MAINTAINING.md',
  '.github/workflows/ci.yml','.github/dependabot.yml','.github/claude-code/package.json','.github/claude-code/package-lock.json',
  'tests/packages.test.mjs','tests/datashard.test.mjs','tests/release-checks.test.mjs','tests/version-check.sh','tests/open-prs-check.sh']);
 for(const file of r.stdout.split('\0').filter(Boolean)) assert.ok(allowed.has(file),`Unreviewed tracked file: ${file}`);
});

function fileGuard(project,path) {
 return spawnSync('/bin/bash',[join(root,'plugins/datashard/scripts/guard-datashard-md.sh')],{
  env:{...process.env,CLAUDE_PROJECT_DIR:project},encoding:'utf8',timeout:10000,
  input:JSON.stringify({tool_name:'Edit',tool_input:{file_path:path}})
 });
}
test('Claude guard asks before settings edits through multiple file symlinks or a loop',t=>{
 const p=scratch(t);mkdirSync(join(p,'.claude'));writeFileSync(join(p,'.claude/settings.json'),'{}');
 symlinkSync('.claude/settings.json',join(p,'alias-two'));symlinkSync('alias-two',join(p,'alias-one'));
 symlinkSync('loop-two',join(p,'loop-one'));symlinkSync('loop-one',join(p,'loop-two'));
 for(const file of ['alias-one','alias-two','loop-one']) {
  const r=fileGuard(p,join(p,file));assert.equal(r.status,0,r.stderr);
  assert.equal(JSON.parse(r.stdout).hookSpecificOutput.permissionDecision,'ask');
 }
});
test('Claude guard allows ordinary source edits through file symlinks',t=>{
 const p=scratch(t);writeFileSync(join(p,'source.txt'),'text');symlinkSync('source.txt',join(p,'source-alias'));
 const r=fileGuard(p,join(p,'source-alias'));assert.equal(r.status,0,r.stderr);assert.equal(r.stdout,'');
});

test('Claude guard resolves JSON-escaped symlink names before inspecting their targets',t=>{
 const p=scratch(t);mkdirSync(join(p,'.claude'));writeFileSync(join(p,'.claude/settings.json'),'{}');
 writeFileSync(join(p,'DATASHARD.md'),'# Datashard');
 for(const [name,target] of [['quoted"settings','.claude/settings.json'],['quoted"datashard','DATASHARD.md'],['back\\slash','.claude/settings.json']]) {
  symlinkSync(target,join(p,name));const r=fileGuard(p,join(p,name));assert.equal(r.status,0,r.stderr);
  assert.equal(JSON.parse(r.stdout).hookSpecificOutput.permissionDecision,'ask');
 }
});
test('Claude guard permits ordinary quoted names and asks for undecoded Unicode escapes',t=>{
 const p=scratch(t);writeFileSync(join(p,'source"file.txt'),'text');
 const r=fileGuard(p,join(p,'source"file.txt'));assert.equal(r.status,0,r.stderr);assert.equal(r.stdout,'');
 const out=spawnSync('/bin/bash',[join(root,'plugins/datashard/scripts/guard-datashard-md.sh')],{
  env:{...process.env,CLAUDE_PROJECT_DIR:p},encoding:'utf8',timeout:10000,
  input:'{"tool_name":"Edit","tool_input":{"file_path":"'+p+'/D\\u0041TASHARD.md"}}'
 });
 assert.equal(out.status,0,out.stderr);assert.equal(JSON.parse(out.stdout).hookSpecificOutput.permissionDecision,'ask');
});
