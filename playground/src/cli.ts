// Copyright (C) 2026 tommy0103 and contributors.
// SPDX-License-Identifier: AGPL-3.0-only

// npm run playground -- <command>
//
//   validate <scenario.json>                 check a scenario file
//   roles prepare <scenario.json>            create/refresh its roles: dirs, settings, shim, skills, wallet
//   roles list                               prepared roles and their wallet addresses
//   roles env <id>                           `export` lines that switch a shell into a role
//   auth codex-login                         set up the one Codex sign-in all roles share; prints the login command
//   auth set <secret>                        store a token or API key (hidden input) in the system keychain
//   auth use <harness> keychain <secret>     sign that harness in with a stored secret
//   auth use codex role-file [<auth.json>]   link every role's CODEX_HOME/auth.json to one file (or use their own)
//   auth use <harness> role-login            roles were signed in one by one
//   auth status                              what each harness uses, and whether its secret is stored
//   run <scenario.json> [--dry-run] [--service-url <url>]
//   serve [--port <n>] [--service-url <url>]     the run page on this machine, live while a run goes (#32)
//   publish <run id> [--out <dir>] [--force] [--check]
//                                            copy a finished run into service/public/runs/<id>/ (#32)
//   fixture <dir> [--live] [--seconds <n>]   write the made-up fixture run into <dir>/runs/ (page development)
//
// Home: OBELISK_PLAYGROUND_HOME, default ~/.obelisk-hackathon/playground.

import { existsSync, readdirSync, realpathSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { systemSecretStore, type SecretStore } from '../../packages/core/src/keychain.ts';
import { KEYCHAIN_SERVICE, SECRETS, checkAuthMode, prepareCodexLogin, readConfig, storeSecret, writeConfig, type AuthMode, type SecretName } from './auth.ts';
import { FIXTURE_LENGTH_S, replayFixture, writeFixture } from './fixture.ts';
import { playgroundHome, rolePaths } from './home.ts';
import { publishRun, PublishError } from './publish.ts';
import { readRole, prepareRole, roleShellExports } from './roles.ts';
import { runScenario } from './runner.ts';
import { loadScenario, type RealHarness } from './scenario.ts';
import { startLiveServer } from './serve.ts';
import { resolveServiceUrl } from '../../packages/core/src/obelisk-service.ts';

const USAGE = `Usage: npm run playground -- <command>
  validate <scenario.json>
  roles prepare <scenario.json> | list | env <id>
  auth codex-login
  auth set <${Object.keys(SECRETS).join('|')}>
  auth use <claude-code|codex> keychain <secret> | role-file [<auth.json>] | role-login
  auth status
  run <scenario.json> [--dry-run] [--service-url <url>]
  serve [--port <n>] [--service-url <url>]
  publish <run id> [--out <dir>] [--force] [--check]
  fixture <dir> [--live] [--seconds <n>]`;

function option(args: string[], name: string): string | null {
  const at = args.indexOf(name);
  if (at < 0) return null;
  const value = args[at + 1];
  if (!value || value.startsWith('--')) throw new Error(`${name} needs a value`);
  return value;
}

/** Read one line without echoing it (from a TTY), or all of stdin when piped. */
export async function readHidden(prompt: string, input: NodeJS.ReadStream = process.stdin, output: NodeJS.WriteStream = process.stderr): Promise<string> {
  if (!input.isTTY) {
    let text = '';
    for await (const chunk of input) text += chunk;
    return text.split('\n')[0] ?? '';
  }
  output.write(prompt);
  input.setRawMode(true);
  input.resume();
  input.setEncoding('utf8');
  return new Promise((resolveLine, reject) => {
    let value = '';
    const done = (error?: Error) => {
      input.setRawMode(false);
      input.pause();
      input.off('data', onData);
      output.write('\n');
      if (error) reject(error); else resolveLine(value);
    };
    const onData = (chunk: string) => {
      for (const ch of chunk) {
        if (ch === '\r' || ch === '\n') return done();
        if (ch === '\u0003') return done(new Error('Cancelled; nothing was stored'));
        if (ch === '\u007f' || ch === '\b') value = value.slice(0, -1);
        else value += ch;
      }
    };
    input.on('data', onData);
  });
}

function parseAuthMode(args: string[]): AuthMode {
  const [mode, value] = args;
  if (mode === 'keychain' && value) return { mode: 'keychain', secret: value as SecretName };
  if (mode === 'role-file') return { mode: 'role-file', source: value ? resolve(value) : null };
  if (mode === 'role-login') return { mode: 'role-login' };
  throw new Error(USAGE);
}

export async function main(argv: string[], { store = systemSecretStore(), env = process.env, print = (line: string) => process.stdout.write(`${line}\n`) }: { store?: SecretStore; env?: NodeJS.ProcessEnv; print?: (line: string) => void } = {}): Promise<number> {
  const home = playgroundHome(env);
  const [command, sub, ...rest] = argv;
  const json = (value: unknown) => print(JSON.stringify(value, null, 2));

  if (command === 'validate' && sub) {
    const { scenario, sha256 } = loadScenario(resolve(sub));
    json({ ok: true, name: scenario.name, roles: scenario.roles.length, steps: scenario.steps.length, sha256 });
    return 0;
  }
  if (command === 'roles' && sub === 'prepare' && rest[0]) {
    const { scenario } = loadScenario(resolve(rest[0]));
    const prepared = scenario.roles.map((role) => prepareRole(home, role));
    json({ home, roles: prepared.map(({ id, label, address, skills }) => ({ id, label, address, skills })) });
    return 0;
  }
  if (command === 'roles' && sub === 'list') {
    const dir = join(home, 'roles');
    const ids = existsSync(dir) ? readdirSync(dir).sort() : [];
    json(ids.map((id) => readRole(home, id)).filter(Boolean));
    return 0;
  }
  if (command === 'roles' && sub === 'env' && rest[0]) {
    if (!readRole(home, rest[0])) throw new Error(`Role ${rest[0]} is not prepared (${rolePaths(home, rest[0]).root})`);
    print(roleShellExports(home, rest[0]));
    return 0;
  }
  if (command === 'auth' && sub === 'codex-login') {
    const login = prepareCodexLogin(home);
    json({
      signedIn: login.signedIn,
      authFile: login.authFile,
      run: login.command,
      next: login.signedIn
        ? 'Already signed in. Every role links its CODEX_HOME/auth.json to this file on its next run.'
        : `Run this in your own terminal and finish the sign-in there: ${login.command}`,
    });
    return 0;
  }
  if (command === 'auth' && sub === 'set' && rest[0]) {
    const name = rest[0] as SecretName;
    if (!SECRETS[name]) throw new Error(`Unknown secret ${name}; use one of ${Object.keys(SECRETS).join(', ')}`);
    const value = await readHidden(`${SECRETS[name].how} (input is hidden): `);
    await storeSecret(store, name, value);
    json({ stored: name, in: store.description, service: KEYCHAIN_SERVICE });
    return 0;
  }
  if (command === 'auth' && sub === 'use' && rest[0]) {
    const harness = rest[0] as RealHarness;
    if (harness !== 'claude-code' && harness !== 'codex') throw new Error(USAGE);
    const mode = checkAuthMode(harness, parseAuthMode(rest.slice(1)));
    const config = readConfig(home);
    config.auth[harness] = mode;
    writeConfig(home, config);
    json({ harness, auth: mode });
    return 0;
  }
  if (command === 'auth' && sub === 'status') {
    const config = readConfig(home);
    const status: Record<string, unknown> = {};
    for (const harness of ['claude-code', 'codex'] as const) {
      const mode = config.auth[harness];
      status[harness] = !mode ? { configured: false }
        : mode.mode === 'keychain' ? { ...mode, stored: (await store.get(KEYCHAIN_SERVICE, mode.secret)) !== null }
          : mode.mode === 'role-file' && mode.source ? { ...mode, signedIn: existsSync(mode.source) }
            : mode;
    }
    json(status);
    return 0;
  }
  if (command === 'run' && sub) {
    const dryRun = rest.includes('--dry-run');
    const urlAt = rest.indexOf('--service-url');
    const serviceUrl = urlAt >= 0 ? rest[urlAt + 1] ?? null : null;
    const { runDir, provenance } = await runScenario(loadScenario(resolve(sub)), {
      home, dryRun, serviceUrl, store,
      onEvent: (event) => print(`${event.at.slice(11, 19)}  ${(event.role ?? '').padEnd(4)} ${event.text}`),
    });
    json({ run: provenance.run.id, status: provenance.run.status, runDir, totals: provenance.totals });
    return provenance.run.status === 'succeeded' ? 0 : 1;
  }
  if (command === 'serve') {
    const args = argv.slice(1);
    const port = Number(option(args, '--port') ?? '4318');
    if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('--port must be a port number');
    const serviceUrl = option(args, '--service-url') ?? resolveServiceUrl(env);
    const { url } = await startLiveServer({ home, port, serviceUrl: serviceUrl.replace(/\/+$/, '') });
    print(`Run pages: ${url}/runs  (runs in ${join(home, 'runs')}; on-chain check through ${serviceUrl})`);
    print('Ctrl-C to stop.');
    return new Promise<number>(() => {});
  }
  if (command === 'publish' && sub) {
    const args = argv.slice(2);
    const outDir = option(args, '--out');
    try {
      const result = publishRun({ home, runId: sub, outDir: outDir ? resolve(outDir) : undefined, force: args.includes('--force'), check: args.includes('--check') });
      json(result);
      if (result.written && !outDir) print(`Published to ${result.target}. Commit it and deploy the service (npm run deploy in service/) to put it on the web at /runs/${sub}.`);
      return 0;
    } catch (error) {
      if (error instanceof PublishError) {
        process.stderr.write(`Not published: ${error.message}\n`);
        return 1;
      }
      throw error;
    }
  }
  if (command === 'fixture' && sub) {
    const dir = resolve(sub);
    if (resolve(dir) === resolve(playgroundHome(env)) && !env['OBELISK_PLAYGROUND_HOME']) {
      throw new Error('Write the fixture into a directory of its own, not the Playground home: its made-up runs would show up next to real ones');
    }
    const args = argv.slice(2);
    if (args.includes('--live')) {
      const seconds = Number(option(args, '--seconds') ?? String(FIXTURE_LENGTH_S));
      print(`Replaying the fixture into ${join(dir, 'runs')} over ${seconds}s; watch it with OBELISK_PLAYGROUND_HOME=${dir} npm run playground -- serve`);
      const runDir = await replayFixture(dir, { seconds });
      json({ fixture: runDir });
      return 0;
    }
    json({ fixture: writeFixture(dir) });
    return 0;
  }
  process.stderr.write(`${USAGE}\n`);
  return 2;
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  main(process.argv.slice(2)).then(
    (code) => { process.exitCode = code; },
    (error: Error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; },
  );
}
