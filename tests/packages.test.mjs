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
const packageFiles = [
 'plugins/datashard/.claude-plugin/plugin.json','plugins/datashard/.codex-plugin/plugin.json','plugins/datashard/.cursor-plugin/plugin.json','plugins/datashard/codex/mcp.json','plugins/datashard/.mcp.json','plugins/datashard/README.md',
 'plugins/datashard/hooks/hooks.json','plugins/datashard/codex/hooks.json','plugins/datashard/cursor/hooks.json','plugins/datashard/cursor/mcp.json','plugins/datashard/cursor/rules/datashard.mdc','plugins/datashard/scripts/check-install.sh','plugins/datashard/scripts/codex-check-install.mjs','plugins/datashard/scripts/cursor-check-install.sh','plugins/datashard/scripts/cursor-check-install.mjs','plugins/datashard/scripts/guard-datashard-md.sh','plugins/datashard/scripts/install-codex.sh',
 'plugins/datashard/skills/init/SKILL.md','plugins/datashard/skills/save-to-datashard/SKILL.md','plugins/datashard/skills/save-to-datashard/fact-format.md','plugins/datashard/skills/record-with-gh0stwriter/SKILL.md','plugins/datashard/templates/DATASHARD.md',
 'plugins/datashard/skills/review-with-datashard/SKILL.md','plugins/datashard/skills/review-with-datashard/ai_review.py','plugins/datashard/skills/review-with-datashard/prompt.md','plugins/datashard/skills/review-with-datashard/schema.json',
 'plugins/datashard/codex/skills/datashard-init/SKILL.md','plugins/datashard/codex/skills/datashard-init/assets/DATASHARD.md','plugins/datashard/codex/skills/datashard-init/agents/openai.yaml',
 'plugins/datashard/codex/skills/save-to-datashard/SKILL.md','plugins/datashard/codex/skills/save-to-datashard/fact-format.md','plugins/datashard/codex/skills/record-with-gh0stwriter/SKILL.md',
 'plugins/datashard/cursor/skills/datashard-init/SKILL.md','plugins/datashard/cursor/skills/save-to-datashard/SKILL.md','plugins/datashard/cursor/skills/save-to-datashard/fact-format.md','plugins/datashard/cursor/skills/record-with-gh0stwriter/SKILL.md',
 'plugins/mnem0nic/.claude-plugin/plugin.json','plugins/mnem0nic/.codex-plugin/plugin.json','plugins/mnem0nic/.cursor-plugin/plugin.json','plugins/mnem0nic/README.md','plugins/mnem0nic/skills/mnem0nic/SKILL.md'
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
 // People read this file from main, so it holds only what the pin check covers: an entry with hooks, MCP servers or
 // commands of its own would reach them with no pin and no wait.
 for(const key of Object.keys(catalog)) assert.ok(['name','owner','description','plugins'].includes(key),`Marketplace field not covered by the pin check: ${key}`);
 for(const entry of catalog.plugins) {
   for(const key of Object.keys(entry)) assert.ok(['name','description','source'].includes(key),`Entry field not covered by the pin check: ${entry.name} ${key}`);
   // Each package is pinned to an exact commit of this repository; its files are read from the checkout.
   assert.deepEqual(Object.keys(entry.source),['source','url','path','sha']);
   assert.equal(entry.source.source,'git-subdir');
   assert.equal(entry.source.url,'datashard-ai/plugins');
   assert.equal(entry.source.path,`plugins/${entry.name}`);
   assert.match(entry.source.sha,/^[0-9a-f]{40}$/);
   const manifest=json(entry.source.path+'/.claude-plugin/plugin.json');
   assert.equal(manifest.name,entry.name);
   assert.equal(manifest.repository,'https://github.com/datashard-ai/plugins');
 }
 const codex=json('plugins/mnem0nic/.codex-plugin/plugin.json');
 assert.ok(existsSync(join(root,'plugins/mnem0nic',codex.skills,'mnem0nic/SKILL.md')));
 const mnemClaude=json('plugins/mnem0nic/.claude-plugin/plugin.json');
 assert.equal(codex.version, mnemClaude.version);
 assert.equal(json('plugins/mnem0nic/.cursor-plugin/plugin.json').version, mnemClaude.version);
 const mcp=json('plugins/datashard/.mcp.json');
 assert.equal(mcp.mcpServers.datashard.url,'${user_config.datashard_url}');
 assert.ok(!existsSync(join(root,'plugins/mnem0nic/.mcp.json')));
});
test('mnem0nic package describes the released program, not the old CLI preview',()=>{
 for(const p of packageFiles.filter(f=>f.startsWith('plugins/mnem0nic/'))) {
   const body=read(p);
   for(const old of ['not yet an MCP server','not an MCP server','setup.sh','separately supplied','sqlite3']) assert.ok(!body.includes(old),`${p}: ${old}`);
 }
 const skill=read('plugins/mnem0nic/skills/mnem0nic/SKILL.md');
 for(const s of ['install.sh','mnem0nic install','mcp__mnem0nic__','memory_save','memory_resume','fact:section/id','datashard_refs','mnem0nic search','mnem0nic sessions']) assert.ok(skill.includes(s),s);
 assert.equal(json('plugins/mnem0nic/.claude-plugin/plugin.json').version,'0.3.0');
 for(const m of ['.claude-plugin/marketplace.json','.cursor-plugin/marketplace.json']) {
   const entry=json(m).plugins.find(p=>p.name==='mnem0nic');
   assert.doesNotMatch(entry.description,/preview|separately supplied|checkpoint workflow/i,m);
 }
});
test('Datashard skills-only installs from nested package and reruns without modifying local files',t=>{
 const p=scratch(t); let r=shell(ds,['--skills-only',p]); assert.equal(r.status,0,r.stderr);
 const skill=join(p,'.agents/skills/datashard-init/SKILL.md');const before=readFileSync(skill,'utf8');
 assert.ok(existsSync(join(p,'.agents/skills/record-with-gh0stwriter/SKILL.md')));
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
test('every tracked repository file belongs to the reviewed distribution',()=>{
 const r=spawnSync('git',['-C',root,'ls-files','-z'],{encoding:'utf8'});
 assert.equal(r.status,0,r.stderr);
 const allowed=new Set([...packageFiles,'.claude-plugin/marketplace.json','.cursor-plugin/marketplace.json','.gitignore','README.md','MAINTAINING.md',
  '.github/workflows/ci.yml','.github/dependabot.yml','.github/claude-code/package.json','.github/claude-code/package-lock.json',
  'tests/packages.test.mjs','tests/datashard.test.mjs','tests/release-checks.test.mjs','tests/version-check.sh','tests/open-prs-check.sh','tests/test_ai_review.py','LICENSE.md',
  '.github/CODEOWNERS','.github/workflows/guarded.yml','.github/workflows/pin-from-main.yml','tests/guarded.mjs','tests/pin.mjs','tests/pin.test.mjs']);
 for(const file of r.stdout.split('\0').filter(Boolean)) assert.ok(allowed.has(file),`Unreviewed tracked file: ${file}`);
});

test('no tracked file holds a private decision number, workspace name, local worktree path or host name',()=>{
 // Built from pieces, so that this file does not match its own patterns.
 const patterns=[/ADR \d{4}/,['ai','kwn'].join('-'),['datashard','platform','tools'].join('-'),['.work','trees/'].join(''),['Mac','Studio'].join('-')];
 const r=spawnSync('git',['-C',root,'ls-files','-z'],{encoding:'utf8'});
 assert.equal(r.status,0,r.stderr);
 for(const file of r.stdout.split('\0').filter(Boolean)) {
  if(!existsSync(join(root,file))) continue;
  const body=read(file);
  for(const pattern of patterns) assert.ok(typeof pattern==='string'?!body.includes(pattern):!pattern.test(body),`${file} holds ${pattern}`);
 }
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
