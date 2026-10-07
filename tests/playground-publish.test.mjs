// Copyright (C) 2026 tommy0103 and contributors.
// SPDX-License-Identifier: AGPL-3.0-only

// Publishing a Playground run to the web and showing it live (#32): the
// privacy pass, what publish writes and refuses, the fixture, and the local
// live server.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { SITE_HEADERS } from '../service/src/app.ts';
import { main } from '../playground/src/cli.ts';
import { FIXTURE_RUN, fixtureRun, writeFixture } from '../playground/src/fixture.ts';
import { isPng, pngWithText, stripPngMetadata } from '../playground/src/png.ts';
import { validateEvent, validateProvenance } from '../playground/src/provenance.ts';
import { DEFAULT_PUBLISH_DIR, MASK, maskForDisplay, privacyContext, privacyFindings, publishRun, PublishError, scrub } from '../playground/src/publish.ts';
import { PAGE_HEADERS, startLiveServer } from '../playground/src/serve.ts';

const USER = 'tester';
const HOME = `/Users/${USER}`;

function tempHome(t) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'pg-publish-')));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

const ctxFor = (home) => privacyContext(home, { home: HOME, user: USER });
const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'));
const readEvents = (file) => readFileSync(file, 'utf8').trim().split('\n').map((line) => JSON.parse(line));

/** A finished, non-fixture copy of the fixture under `home`, optionally edited. */
function realLookingRun(home, edit = () => {}) {
  const id = 'run-20261007T120000Z-ab12';
  writeFixture(home, FIXTURE_RUN);
  const from = join(home, 'runs', FIXTURE_RUN);
  const to = join(home, 'runs', id);
  cpSync(from, to, { recursive: true });
  rmSync(from, { recursive: true });
  const record = readJson(join(to, 'provenance.json'));
  const events = readEvents(join(to, 'events.jsonl'));
  record.run.id = id;
  record.run.scenario.title = '演示闭环';
  for (const event of events) event.runId = id;
  edit(record, events, to);
  writeFileSync(join(to, 'provenance.json'), JSON.stringify(record, null, 2));
  writeFileSync(join(to, 'events.jsonl'), events.map((e) => `${JSON.stringify(e)}\n`).join(''));
  return id;
}

// --- The fixture -------------------------------------------------------------------

test('the fixture run follows the runner’s schema, is marked as a fixture, and can be caught mid-run', () => {
  const { record, events } = fixtureRun();
  assert.deepEqual(validateProvenance(record), []);
  for (const event of events) assert.deepEqual(validateEvent(event), [], JSON.stringify(event));
  assert.deepEqual(events.map((e) => e.seq), events.map((_, i) => i + 1));
  assert.match(record.run.id, /^fixture-/);
  assert.match(record.run.scenario.title, /示例数据.*fixture/);
  assert.equal(record.run.status, 'succeeded');
  assert.ok(record.totals.transactions >= 5 && record.totals.screenshots === 3);

  const midway = fixtureRun(FIXTURE_RUN, { elapsed: 40 });
  assert.deepEqual(validateProvenance(midway.record), []);
  assert.equal(midway.record.run.status, 'running');
  assert.equal(midway.record.run.endedAt, null);
  assert.equal(midway.record.steps.filter((s) => s.status === 'running').length, 1);
  assert.ok(midway.events.length < events.length);
  assert.ok(!midway.events.some((e) => e.type === 'run.finished'));
});

// --- The privacy pass -----------------------------------------------------------------

test('local paths, temp paths, the user name and local service URLs are replaced', (t) => {
  const home = tempHome(t);
  const ctx = ctxFor(home);
  const { value, redactions } = scrub({
    prompt: `读 ${HOME}/projects/notes.md 和 ${home}/roles/A/obelisk/index.db`,
    argv: ['skill', 'save', '--from', `${HOME}/Desktop/draft.md`, '/private/var/folders/xy/T/obelisk-1/x.json', '/tmp/run-1/log'],
    error: `EACCES: ${HOME}/.obelisk/wallet.json (owner ${USER})`,
    service: 'http://127.0.0.1:8787/v1/relay',
    other: '/home/someone/x and C:\\Users\\Someone\\x',
    untouched: 'obelisk skill mint job-application-materials',
  }, ctx);
  assert.equal(value.prompt, '读 ~/projects/notes.md 和 <playground>/roles/A/obelisk/index.db');
  assert.deepEqual(value.argv.slice(3), ['~/Desktop/draft.md', '<tmp>', '<tmp>']);
  assert.equal(value.error, 'EACCES: ~/.obelisk/wallet.json (owner <user>)');
  assert.equal(value.service, '<本机服务>');
  assert.equal(value.other, '~/x and ~\\x');
  assert.equal(value.untouched, 'obelisk skill mint job-application-materials');
  assert.equal(redactions, 7, "one per string changed");
  assert.deepEqual(privacyFindings(value), []);
});

test('what the replacement cannot fix is found, by path and rule', () => {
  const findings = privacyFindings({
    steps: [{ prompt: '把结果发给 someone@example.com', error: 'OPENAI_API_KEY=sk-proj-abcdefghijklmnopqrstu', commands: [{ argv: ['wallet', 'import', '--private-key', '0xabc'] }] }],
    auth: { mode: 'x' },
    note: 'Authorization: Bearer abcdefghijklmnopqrstuvwxyz012345',
    jwt: 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.c2lnbmF0dXJlLXZhbHVl',
    block: '-----BEGIN OPENSSH PRIVATE KEY-----',
  });
  const by = Object.fromEntries(findings.map((f) => [`${f.path}|${f.rule}`, true]));
  for (const key of [
    'steps[0].prompt|e-mail address',
    'steps[0].error|API key',
    'steps[0].error|secret assignment',
    'steps[0].commands[0].argv[3]|value of --private-key',
    'auth|field named auth',
    'note|bearer token',
    'jwt|JWT',
    'block|private key',
  ]) assert.ok(by[key], `${key} in ${JSON.stringify(findings)}`);
  assert.deepEqual(privacyFindings({ hash: `0x${'ab'.repeat(32)}`, wallet: `0x${'cd'.repeat(20)}`, model: 'gpt-6.1-sol', ref: 'codex:0199-…' }), []);
});

test('the live view masks what it finds instead of refusing', (t) => {
  const masked = maskForDisplay({ text: `发给 a@b.co，路径 ${HOME}/x`, argv: ['--token', 'abc123'], password: 'hunter22' }, ctxFor(tempHome(t)));
  assert.equal(masked.text, `发给 ${MASK}，路径 ~/x`);
  assert.deepEqual(masked.argv, ['--token', MASK]);
  assert.equal(masked.password, MASK);
});

test('PNG metadata chunks are dropped and the picture is kept', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pg-png-'));
  try {
    writeFixture(dir);
    const png = readFileSync(join(dir, 'runs', FIXTURE_RUN, 'screenshots', 'a-mint-shot.png'));
    const tagged = pngWithText(png, 'Comment', `taken in ${HOME}`);
    assert.ok(tagged.includes(Buffer.from(HOME)));
    const { png: clean, dropped } = stripPngMetadata(tagged);
    assert.deepEqual(dropped, ['tEXt']);
    assert.ok(clean.equals(png));
    assert.ok(isPng(clean));
    assert.throws(() => stripPngMetadata(Buffer.from('not a png')), /not a PNG/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// --- publish -------------------------------------------------------------------------

test('publish writes the cleaned record, events, screenshots and a manifest, and lists the run', (t) => {
  const home = tempHome(t);
  const out = join(home, 'public-runs');
  const id = realLookingRun(home, (record, events, dir) => {
    record.steps[0].prompt = `${record.steps[0].prompt}（草稿在 ${HOME}/Documents/简历.md）`;
    events.find((e) => e.type === 'command').text = `${USER} 在 ${home}/roles/A/workspace 运行 obelisk`;
    record.run.network.serviceUrl = 'http://localhost:8787';
    const shot = join(dir, 'screenshots', 'a-mint-shot.png');
    writeFileSync(shot, pngWithText(readFileSync(shot), 'Author', USER));
  });
  const result = publishRun({ home, runId: id, outDir: out, ctx: ctxFor(home), now: new Date('2026-10-07T12:30:00Z') });
  assert.equal(result.written, true);
  const target = join(out, id);
  assert.deepEqual(readdirSync(target).sort(), ['events.jsonl', 'provenance.json', 'published.json', 'screenshots']);
  assert.deepEqual(readdirSync(join(target, 'screenshots')).sort(), ['a-mint-shot.png', 'a-receipt-shot.png', 'a-usage-shot.png']);

  const all = readdirSync(target, { recursive: true }).map((f) => join(target, f)).filter((f) => f.endsWith('.json') || f.endsWith('.jsonl') || f.endsWith('.png'));
  for (const file of all) {
    const text = readFileSync(file).toString('latin1');
    assert.ok(!text.includes(HOME) && !text.includes(home) && !new RegExp(`\\b${USER}\\b`).test(text), `${file} leaks a local path or the user name`);
  }
  const record = readJson(join(target, 'provenance.json'));
  assert.deepEqual(validateProvenance(record), []);
  assert.match(record.steps[0].prompt, /草稿在 ~\/Documents\/简历\.md/);
  assert.equal(record.run.network.serviceUrl, null, 'a local service URL is dropped');
  assert.match(readFileSync(join(target, 'events.jsonl'), 'utf8'), /<user> 在 <playground>\/roles\/A\/workspace 运行 obelisk/);

  const manifest = readJson(join(target, 'published.json'));
  assert.equal(manifest.schema, 'obelisk.playground.published/1');
  assert.equal(manifest.publishedAt, '2026-10-07T12:30:00Z');
  assert.equal(manifest.fixture, false);
  assert.equal(manifest.redactions, 3);
  assert.deepEqual(manifest.files.map((f) => f.path).sort(), ['events.jsonl', 'provenance.json', 'screenshots/a-mint-shot.png', 'screenshots/a-receipt-shot.png', 'screenshots/a-usage-shot.png']);
  assert.deepEqual(result.droppedMetadata, ['screenshots/a-mint-shot.png: tEXt']);

  const index = readJson(join(out, 'index.json'));
  assert.equal(index.schema, 'obelisk.playground.runs/1');
  assert.deepEqual(index.runs.map((r) => [r.id, r.title, r.chainId, r.fixture]), [[id, '演示闭环', 968, false]]);
  assert.ok(!existsSync(join(home, 'runs', id, 'published.json')), 'the run directory itself is not touched');
});

test('publish refuses what is private, running, a fixture, a dry run, or already there — and writes nothing', (t) => {
  const home = tempHome(t);
  const out = join(home, 'public-runs');
  const ctx = ctxFor(home);

  const leaky = realLookingRun(home, (record) => { record.steps[4].prompt += ' 完成后发邮件到 boss@example.com'; });
  assert.throws(() => publishRun({ home, runId: leaky, outDir: out, ctx }), (error) => {
    assert.ok(error instanceof PublishError);
    assert.deepEqual(error.findings, [{ path: 'steps[4].prompt', rule: 'e-mail address' }]);
    assert.match(error.message, /nothing was written/);
    return true;
  });
  assert.ok(!existsSync(out));

  const running = realLookingRun(join(home, 'b'), (record) => { record.run.status = 'running'; record.run.endedAt = null; });
  assert.throws(() => publishRun({ home: join(home, 'b'), runId: running, outDir: out, ctx }), /still running/);

  writeFixture(home);
  assert.throws(() => publishRun({ home, runId: FIXTURE_RUN, outDir: DEFAULT_PUBLISH_DIR, ctx }), /fixture run; it is not evidence/);
  assert.ok(!existsSync(join(DEFAULT_PUBLISH_DIR, FIXTURE_RUN)));

  const dry = realLookingRun(join(home, 'c'), (record) => { record.run.dryRun = true; });
  assert.throws(() => publishRun({ home: join(home, 'c'), runId: dry, outDir: DEFAULT_PUBLISH_DIR, ctx }), /dry run/);

  const checked = publishRun({ home, runId: FIXTURE_RUN, outDir: out, ctx, check: true });
  assert.equal(checked.written, false);
  assert.ok(!existsSync(out), '--check writes nothing');

  publishRun({ home, runId: FIXTURE_RUN, outDir: out, ctx });
  assert.equal(readJson(join(out, FIXTURE_RUN, 'published.json')).fixture, true);
  assert.throws(() => publishRun({ home, runId: FIXTURE_RUN, outDir: out, ctx }), /already exists; pass --force/);
  assert.equal(publishRun({ home, runId: FIXTURE_RUN, outDir: out, ctx, force: true }).written, true);
  assert.deepEqual(readdirSync(out).sort(), [FIXTURE_RUN, 'index.json'], 'no staging directory is left behind');

  assert.throws(() => publishRun({ home, runId: '../etc', outDir: out, ctx }), /Not a run id/);
});

test('the publish command says why it refused and exits 1', async (t) => {
  const home = tempHome(t);
  writeFixture(home);
  const lines = [];
  const errors = [];
  const write = process.stderr.write;
  process.stderr.write = (chunk) => { errors.push(String(chunk)); return true; };
  try {
    const code = await main(['publish', FIXTURE_RUN], { env: { OBELISK_PLAYGROUND_HOME: home }, print: (line) => lines.push(line) });
    assert.equal(code, 1);
  } finally {
    process.stderr.write = write;
  }
  assert.match(errors.join(''), /^Not published: .*fixture run/);
  assert.deepEqual(lines, []);
});

// --- The live server -------------------------------------------------------------------

test('the live server shows local runs through the same page and policy, masked, GET only', async (t) => {
  const home = tempHome(t);
  const id = realLookingRun(home, (record) => {
    record.run.status = 'running';
    record.run.endedAt = null;
    record.steps[0].prompt = `看 ${HOME}/notes.md，然后发给 x@y.io`;
  });
  const asked = [];
  const fetchImpl = async (url) => {
    asked.push(url);
    return new Response(JSON.stringify({ chainId: 968, transactions: [] }), { status: 200 });
  };
  const { server, url } = await startLiveServer({ home, port: 0, serviceUrl: 'https://service.example', ctx: ctxFor(home), fetchImpl });
  t.after(() => server.close());

  const page = await fetch(`${url}/runs/${id}`);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /<script type="module" src="\/runs\/app\.js"><\/script>/);
  assert.equal(page.headers.get('content-security-policy'), SITE_HEADERS['content-security-policy'], 'the same policy as the published page');
  assert.equal(PAGE_HEADERS['content-security-policy'], SITE_HEADERS['content-security-policy']);
  assert.equal((await fetch(`${url}/runs`)).status, 200);

  const record = await (await fetch(`${url}/runs/${id}/provenance.json`)).json();
  assert.equal(record.steps[0].prompt, `看 ~/notes.md，然后发给 ${MASK}`);
  assert.equal(record.run.status, 'running');
  const events = await (await fetch(`${url}/runs/${id}/events.jsonl`)).text();
  assert.ok(events.endsWith('\n') && !events.includes(HOME));
  assert.equal((await fetch(`${url}/runs/${id}/published.json`)).status, 404, 'a local run is not a published one');

  const shot = await fetch(`${url}/runs/${id}/screenshots/a-mint-shot.png`);
  assert.equal(shot.headers.get('content-type'), 'image/png');
  assert.ok(isPng(Buffer.from(await shot.arrayBuffer())));
  writeFileSync(join(home, 'runs', id, 'screenshots', 'unlisted.png'), readFileSync(join(home, 'runs', id, 'screenshots', 'a-mint-shot.png')));
  assert.equal((await fetch(`${url}/runs/${id}/screenshots/unlisted.png`)).status, 404, 'only screenshots the record lists');
  assert.equal((await fetch(`${url}/runs/${id}/steps/a-share/harness.jsonl`)).status, 404, 'raw step output is never served');
  assert.equal((await fetch(`${url}/runs/..%2F..%2Fetc/provenance.json`)).status, 404);
  assert.equal((await fetch(`${url}/site/..%2F..%2Fpackage.json`)).status, 404);
  assert.equal((await fetch(`${url}/site/site.css`)).status, 200);
  assert.equal((await fetch(`${url}/runs/app.js`)).headers.get('content-type'), 'text/javascript; charset=utf-8');

  const index = await (await fetch(`${url}/runs/index.json`)).json();
  assert.deepEqual(index.runs.map((r) => r.id), [id]);

  const hash = `0x${'ab'.repeat(32)}`;
  assert.equal((await fetch(`${url}/v1/txs?hashes=${hash}`)).status, 200);
  assert.deepEqual(asked, [`https://service.example/v1/txs?hashes=${hash}`]);
  const market = await fetch(`${url}/market`, { redirect: 'manual' });
  assert.equal(market.headers.get('location'), 'https://service.example/market');
  assert.equal((await fetch(`${url}/runs/${id}/provenance.json`, { method: 'POST' })).status, 405);
});
