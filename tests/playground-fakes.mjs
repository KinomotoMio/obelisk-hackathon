// Copyright (C) 2026 tommy0103 and contributors.
// SPDX-License-Identifier: AGPL-3.0-only

// Stand-ins for the Playground tests: an obelisk CLI, `claude`, `codex`, a
// built-skills directory and a secret store. None of them touches the network,
// the system keychain, or the owner's history.

import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const TX = `0x${'ab'.repeat(32)}`;

export function memoryStore(initial = {}) {
  const entries = new Map(Object.entries(initial));
  return {
    description: 'test store',
    entries,
    async get(service, account) { return entries.get(`${service}/${account}`) ?? null; },
    async add(service, account, _label, secret) {
      if (entries.has(`${service}/${account}`)) throw new Error('exists');
      entries.set(`${service}/${account}`, secret);
    },
  };
}

function script(file, body) {
  writeFileSync(file, `#!/usr/bin/env node\n${body}\n`);
  chmodSync(file, 0o755);
  return file;
}

export function makeFixture() {
  const root = mkdtempSync(join(tmpdir(), 'obelisk-playground-'));
  const home = join(root, 'home');
  const bin = join(root, 'bin');
  mkdirSync(bin, { recursive: true });

  // claude / codex: record argv and the auth-relevant env, run one obelisk command, then report.
  const seen = join(root, 'seen');
  mkdirSync(seen);

  // obelisk: wallet create → an address derived from OBELISK_HOME; skill mint → a transaction; env → what it saw.
  const cli = script(join(bin, 'fake-obelisk.mjs'), `
const { createHash } = await import('node:crypto');
const [group, action, name] = process.argv.slice(2);
(await import('node:fs')).appendFileSync(${JSON.stringify(join(seen, 'obelisk-home.txt'))}, process.env.HOME + '\\n');
const out = (v) => process.stdout.write(JSON.stringify(v) + '\\n');
if (group === 'wallet' && action === 'create') out({ status: 'created', address: '0x' + createHash('sha256').update(process.env.OBELISK_HOME).digest('hex').slice(0, 40) });
else if (group === 'skill' && action === 'scenes') out({ vocabulary: 'v1' });
else if (group === 'skill' && action === 'list') out([]);
else if (group === 'skill' && action === 'mint') out({ status: 'minted', skill: name, skillId: '7', transaction: '${TX}', explorer: { transaction: 'https://explorer.test/tx/${TX}' } });
else if (group === 'env') out({ OBELISK_HOME: process.env.OBELISK_HOME, CLAUDE_CONFIG_DIR: process.env.CLAUDE_CONFIG_DIR, CODEX_HOME: process.env.CODEX_HOME, CLAUDECODE: process.env.CLAUDECODE ?? null });
else { process.stderr.write('fake obelisk: unsupported ' + process.argv.slice(2).join(' ') + '\\n'); process.exit(3); }
`);

  const harnessBody = (kind) => `
const { spawnSync } = await import('node:child_process');
const { writeFileSync } = await import('node:fs');
const env = Object.fromEntries(['CLAUDE_CODE_OAUTH_TOKEN', 'CODEX_API_KEY', 'CLAUDE_CONFIG_DIR', 'CODEX_HOME', 'OBELISK_HOME', 'CLAUDECODE', 'CLAUDE_CODE_PROJECT_DIR_NAME', 'HOME'].map((k) => [k, process.env[k] ?? null]));
writeFileSync(${JSON.stringify(join(seen, kind))} + '.json', JSON.stringify({ argv: process.argv.slice(2), env, cwd: process.cwd() }));
if (process.argv[2] === '--version') { console.log('9.9.9 (${kind})'); process.exit(0); }
const mint = spawnSync('obelisk', ['skill', 'mint', 'ai-resume'], { encoding: 'utf8' });
const say = (v) => process.stdout.write(JSON.stringify(v) + '\\n');
${kind === 'claude'
    ? `say({ type: 'system', subtype: 'init', session_id: 'sess-claude-1', model: 'claude-test-model' });
say({ type: 'result', subtype: mint.status === 0 ? 'success' : 'error_during_execution', is_error: mint.status !== 0, result: 'ok' });`
    : `say({ type: 'thread.started', thread_id: 'thread-codex-1' });
say({ type: 'turn.completed', usage: {} });`}
`;
  const claude = script(join(bin, 'claude'), harnessBody('claude'));
  const codex = script(join(bin, 'codex'), harnessBody('codex'));

  // The App's headless capture: writes a PNG for any route but #/missing, which "does not render".
  const capture = script(join(bin, 'fake-capture'), `
const { appendFileSync, writeFileSync } = await import('node:fs');
const args = process.argv.slice(2);
const flag = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
appendFileSync(${JSON.stringify(join(seen, 'capture.jsonl'))}, JSON.stringify({ args, OBELISK_HOME: process.env.OBELISK_HOME }) + '\\n');
if (flag('--route') === '#/missing') { process.stderr.write('capture failed: the page did not render within 20000 ms\\n'); process.exit(1); }
writeFileSync(flag('--out'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
console.log(flag('--out'));
`);

  const skills = join(root, 'skills');
  for (const name of ['obelisk', 'obelisk-distill', 'obelisk-wallet']) {
    mkdirSync(join(skills, name), { recursive: true });
    writeFileSync(join(skills, name, 'SKILL.md'), `---\nname: ${name}\ndescription: test\n---\n`);
  }

  const scenarioFile = (scenario) => {
    const file = join(root, `${scenario.name}.json`);
    writeFileSync(file, JSON.stringify({ schema: 'obelisk.playground.scenario/1', ...scenario }));
    return file;
  };
  return { root, home, cli, claude, codex, capture, skills, seen, scenarioFile };
}
