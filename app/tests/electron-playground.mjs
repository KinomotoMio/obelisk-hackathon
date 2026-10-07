// Playground live page (#32): runs as they happen, key screenshots, the
// provenance record, and the 「来源：Playground」 marker on the Skill page.
//
// Runs the built renderer with the real Playground reader
// (out/main/playground-runs.js) over fixture runs in the runner's schema, and
// mocked IPC for everything else. The key screenshots inside the fixture run
// are captured from this App. Set OBELISK_PLAYGROUND_SCREENSHOTS to a
// directory to also save screenshots of the states it walks through.

import { app, BrowserWindow, ipcMain } from 'electron';
import { mkdirSync, mkdtempSync, appendFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { listRuns, readRun, readScreenshot, skillSources } from '../out/main/playground-runs.js';
import { liveRun, LIVE_RUN, SKILL_ID, SKILL_NAME, txHash, wallet, writePlaygroundFixture } from '../../tests/app-playground-fixtures.mjs';
import { EVENT_SCHEMA, summarizeTotals } from '../../playground/src/provenance.ts';

const here = dirname(fileURLToPath(import.meta.url));
const appRoot = join(here, '..');
const screenshotDir = process.env.OBELISK_PLAYGROUND_SCREENSHOTS || null;
const dir = mkdtempSync(join(tmpdir(), 'obelisk-playground-e2e-'));

let failures = 0;

function assert(condition, message) {
  if (condition) console.log(`PASS: ${message}`);
  else {
    failures++;
    console.error(`FAIL: ${message}`);
  }
}

async function waitFor(webContents, expression, message, timeoutMs = 8_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await webContents.executeJavaScript(`Boolean(${expression})`, true)) return;
    await delay(40);
  }
  throw new Error(`Timed out waiting for ${message}`);
}

const js = (win, source) => win.webContents.executeJavaScript(source, true);

async function capture(win) {
  await delay(1200);
  return (await win.webContents.capturePage()).toPNG();
}

async function screenshot(win, name) {
  if (!screenshotDir) return;
  const png = await capture(win);
  mkdirSync(screenshotDir, { recursive: true });
  writeFileSync(join(screenshotDir, name), png);
  console.log(`screenshot: ${join(screenshotDir, name)}`);
}

async function scrollIntoView(win, selector, block = 'start') {
  await js(win, `document.querySelector(${JSON.stringify(selector)}).scrollIntoView({ block: ${JSON.stringify(block)} })`);
  await delay(250);
}

// --- Mocked App data ----------------------------------------------------------

const live = liveRun();
const indexedSession = live.record.steps.find(step => step.id === 'u1-task').sessions[0].obeliskId;

const readShare = {
  draft: '3f3f3f3f',
  shareId: `0x${'3f'.repeat(32)}`,
  number: 'S-3F3F',
  title: '根据提交历史整理项目经历',
  session: { id: 'a-share-session', provider: 'claude' },
  messages: { from: 1, to: 8 },
  recipient: wallet('B'),
  rules: { opens: 1, expiresAt: new Date(Date.now() + 86_400_000).toISOString() },
  canOpen: false,
  opens: { count: 1, max: 1, lastOpenedAt: new Date(Date.now() - 160_000).toISOString() },
  expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
  revokedAt: null,
  sentAt: new Date(Date.now() - 190_000).toISOString(),
  link: 'https://service.example/s/0x3f',
  state: 'read',
  record: { kind: 'open', txHash: txHash('receipt'), explorerUrl: `https://scan.bohr.life/tx/${txHash('receipt')}` },
};

const chainSkill = {
  chainId: 968, skillId: SKILL_ID, author: wallet('A'), parentSkillId: null, createdAt: new Date(Date.now() - 80_000).toISOString(),
  birthScenes: [
    { tag: 'v1:context/job-search', kind: 'vocabulary', label: '求职与实习', dimensionLabel: '行业与用途' },
    { tag: 'v1:artifact/resume', kind: 'vocabulary', label: '简历与履历', dimensionLabel: '产出物' },
  ],
  versionCount: 1,
  version: { index: 0, fingerprint: 'c0'.repeat(32), publishedAt: new Date(Date.now() - 80_000).toISOString() },
  name: SKILL_NAME,
  description: '从真实工作记录里整理求职材料：按"解决了什么问题"写经历，每一条都有可以核对的证据。',
  serviceUrl: 'https://obelisk-service.example.workers.dev', explorerUrl: 'https://scan.bohr.life',
  usage: {
    totalInvocations: 2, uniqueWallets: 2, uniqueWalletsExact: true, lastReportAt: new Date(Date.now() - 30_000).toISOString(),
    scenes: [], outcomesReported: false,
    results: { smooth: 0, rework: 0, failed: 0, unknown: 0, judged: 0, smoothRate: null, toolErrors: 0, userCorrections: 0 },
    trend: { available: true, weeks: Array.from({ length: 8 }, (_, i) => ({ start: new Date(Date.UTC(2026, 7, 17 + i * 7)).toISOString().slice(0, 10), invocations: i === 7 ? 2 : 0 })) },
    versions: [{ index: 0, fingerprint: 'c0'.repeat(32), publishedAt: new Date(Date.now() - 80_000).toISOString(), totalInvocations: 2, uniqueWallets: 2 }],
  },
  usageError: null,
  lineage: { rootSkillId: SKILL_ID, path: [SKILL_ID], truncated: false, nodes: [{ skillId: SKILL_ID, parentSkillId: null, depth: 0, author: wallet('A'), name: SKILL_NAME, versionCount: 1, createdAt: new Date(Date.now() - 80_000).toISOString() }] },
  lineageError: null,
};

function registerHandlers() {
  ipcMain.handle('playground:info', () => ({ dir: '~/.obelisk-hackathon/playground' }));
  ipcMain.handle('playground:runs', () => listRuns(dir));
  ipcMain.handle('playground:run', (_event, runId) => readRun(dir, runId));
  ipcMain.handle('playground:screenshot', (_event, runId, file) => readScreenshot(dir, runId, file));
  ipcMain.handle('playground:skill-sources', (_event, query) => skillSources(dir, query));
  ipcMain.handle('playground:reveal-record', () => {});
  ipcMain.handle('shares:list', () => ({ shares: [readShare], network: 'BOT Chain testnet (968)', serviceUrl: 'https://service.example' }));
  ipcMain.handle('skills:list', () => []);
  ipcMain.handle('skills:describe-scenes', (_event, tags) => tags.map(tag => ({ tag, kind: 'unknown', label: tag })));
  ipcMain.handle('skills:chain-detail', (_event, skillId) => (skillId === SKILL_ID
    ? { ok: true, skill: chainSkill }
    : { ok: false, error: { code: 'unknown_skill', message: `No minted Skill ${skillId}` } }));
  ipcMain.handle('db:getSessions', () => []);
  ipcMain.handle('db:getSessionsByIds', (_event, ids) => ids.filter(id => id === indexedSession).map(id => ({
    id, title: '整理后端岗位的项目经历', project: '-work', project_path: '/work', source: 'claude',
    started_at: new Date().toISOString(), ended_at: new Date().toISOString(), message_count: 6,
  })));
  ipcMain.handle('db:getSessionSubagents', () => []);
  ipcMain.handle('db:getSessionWorkflows', () => []);
  ipcMain.handle('db:getSessionSummaries', () => []);
  ipcMain.handle('db:getMessageFullText', () => null);
  ipcMain.handle('db:getMemories', () => []);
  ipcMain.handle('db:getProjects', () => []);
  ipcMain.handle('db:getStats', () => ({}));
  ipcMain.handle('settings:get', () => ({
    sources: [{ id: 'claude', name: 'Claude Code', color: '#d97757', status: 'ok', statusText: 'ok', sessionCount: 6 }],
  }));
}

// The runner moves on: 用户 3 finishes, 用户 4 starts.
function advanceLiveRun() {
  const record = structuredClone(live.record);
  const at = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  const u3 = record.steps.find(step => step.id === 'u3-task');
  const id = '7d1e2f30-0000-4000-8000-0000000000a3';
  const session = { source: 'claude', id, obeliskId: id };
  Object.assign(u3, {
    status: 'succeeded',
    endedAt: at,
    sessions: [session],
    commands: [...u3.commands, { argv: ['usage', 'report'], exitCode: 0, startedAt: at, endedAt: at, transactions: [txHash('report-u3')] }],
    transactions: [{ hash: txHash('report-u3'), chainId: 968, explorerUrl: null, command: 'usage report' }],
    artifacts: [...u3.artifacts, { kind: 'usage-report', ref: txHash('report-u3') }],
  });
  Object.assign(record.steps.find(step => step.id === 'u4-task'), { status: 'running', startedAt: at });
  record.totals = summarizeTotals(record.roles, record.steps);
  writeFileSync(join(dir, 'runs', LIVE_RUN, 'provenance.json'), JSON.stringify(record, null, 2));
  const next = live.events.length + 1;
  const lines = [
    { seq: next, type: 'session', stepId: 'u3-task', role: 'U3', text: '用户 3 在 Claude Code 中用这个 Skill 改写履历要点', data: session },
    { seq: next + 1, type: 'transaction', stepId: 'u3-task', role: 'U3', text: '用户 3 上报 1 次调用', data: { hash: txHash('report-u3'), chainId: 968, explorerUrl: null, command: 'usage report' } },
    { seq: next + 2, type: 'step.started', stepId: 'u4-task', role: 'U4', text: '用户 4 取用这个 Skill，准备系统设计面试案例', data: {} },
  ].map(event => ({ schema: EVENT_SCHEMA, runId: LIVE_RUN, at, ...event }));
  appendFileSync(join(dir, 'runs', LIVE_RUN, 'events.jsonl'), lines.map(line => `${JSON.stringify(line)}\n`).join(''));
  return record;
}

async function run() {
  registerHandlers();
  mkdirSync(join(dir, 'runs'), { recursive: true });
  const win = new BrowserWindow({
    show: false,
    x: 0,
    y: 0,
    width: 1440,
    height: 960,
    webPreferences: {
      preload: join(appRoot, 'out', 'preload', 'index.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // The key screenshots inside the fixture run are this App's own pages.
  await win.loadFile(join(appRoot, 'out', 'renderer', 'index.html'), { hash: '/share' });
  await waitFor(win.webContents, `document.querySelector('.share-table tbody tr[data-state="read"]')`, 'the Share tab with a read receipt');
  const sharePng = await capture(win);
  await js(win, `window.location.hash = '#/skills/minted/${SKILL_ID}'`);
  await waitFor(win.webContents, `document.querySelector('.minted-detail[data-skill-id="${SKILL_ID}"]')`, `Skill #${SKILL_ID}`);
  await delay(300);
  assert(!(await js(win, `document.querySelector('[data-source="playground"]')`)), 'no Playground marker before any run names the Skill');
  const mintPng = await capture(win);

  writePlaygroundFixture(dir, {
    live,
    screenshots: { 'screenshots/b-open.png': sharePng, 'screenshots/a-distill-mint.png': mintPng },
  });

  // The run list: the live run first, a record that cannot be read last.
  await js(win, `window.location.hash = '#/playground'`);
  await waitFor(win.webContents, `document.querySelectorAll('.pg-card').length === 4`, 'four runs');
  const list = await js(win, `({
    sections: [...document.querySelectorAll('.pg-section')].map(s => [s.dataset.section, [...s.querySelectorAll('.pg-card')].map(c => c.dataset.run)]),
    live: document.querySelector('.pg-card[data-run="${LIVE_RUN}"]').innerText,
    broken: document.querySelector('.pg-section[data-section="past"] .pg-card:last-child').innerText,
    badge: document.querySelector('[data-sidebar="playground"] .badge').textContent.trim(),
  })`);
  assert(list.sections[0][0] === 'running' && list.sections[0][1][0] === LIVE_RUN, 'the running run is listed first');
  assert(list.sections[1][1].at(-1) === 'run-20261004T100000Z-broken', 'an unreadable record is listed last');
  assert(list.live.includes('第 7 步 · 用户 3 取用这个 Skill') && list.live.includes('6 / 10 步') && list.live.includes('7 个模拟用户'), 'a live card shows the current step and counts');
  assert(list.broken.includes('出处记录读不出来') && list.broken.includes('不是有效的 JSON'), 'an unreadable record says why');
  assert(list.badge === '运行中', `the sidebar shows a run in progress (${list.badge})`);
  await screenshot(win, 'playground-list.png');

  // The live page.
  await js(win, `document.querySelector('.pg-card[data-run="${LIVE_RUN}"]').click()`);
  await waitFor(win.webContents, `document.querySelector('.pg-run[data-run="${LIVE_RUN}"] .events tbody tr')`, 'the live page');
  const page = await js(win, `({
    title: document.querySelector('.pg-run .detail-path').textContent.trim(),
    status: document.querySelector('[data-run-status]').innerText,
    progress: document.querySelector('[data-panel="steps"] .count').textContent.trim(),
    current: document.querySelector('.step.running')?.dataset.step,
    rows: document.querySelectorAll('.events tbody tr').length,
    top: document.querySelector('.events tbody tr').dataset.seq,
    counters: Object.fromEntries([...document.querySelectorAll('[data-count]')].map(b => [b.dataset.count, b.querySelector('.big').textContent.trim()])),
    sessionLinks: [...document.querySelectorAll('.events a.product-link[href^="#/sessions/"]')].map(a => a.getAttribute('href')),
    sessionOff: document.querySelectorAll('.events .product-off[title]').length,
    tx: document.querySelector('.events tr[data-seq="4"] a.chain')?.getAttribute('href'),
    exit: document.querySelector('.events tr[data-seq="6"] .product-warn')?.textContent.trim(),
  })`);
  assert(page.title === '演示闭环', 'the page is titled by the scenario');
  assert(page.status.includes('运行中') && /\d{2}:\d{2}/.test(page.status), `the status pill counts elapsed time (${page.status})`);
  assert(page.progress === '6 / 10' && page.current === 'u3-task', `progress and the current step (${page.progress}, ${page.current})`);
  assert(page.rows === 18 && page.top === '18', 'events read newest first');
  assert(JSON.stringify(page.counters) === JSON.stringify({ roles: '7', sessions: '4', commands: '10', transactions: '5', screenshots: '2' }), `counters come from the record totals (${JSON.stringify(page.counters)})`);
  assert(page.sessionLinks.length === 1 && page.sessionLinks[0].includes(indexedSession), 'a session in this index links to it');
  assert(page.sessionOff === 3, 'sessions in another role\'s data say where they are');
  assert(page.tx === `https://scan.bohr.life/tx/${txHash('share')}`, 'a transaction links to the explorer');
  assert(page.exit === '退出码 1', 'a command that failed shows its exit code');
  await screenshot(win, 'playground-live.png');

  // The runner moves on; the page follows without a reload.
  advanceLiveRun();
  await waitFor(win.webContents, `document.querySelector('.events tbody tr')?.dataset.seq === '21'`, 'new events', 6_000);
  const moved = await js(win, `({
    progress: document.querySelector('[data-panel="steps"] .count').textContent.trim(),
    current: document.querySelector('.step.running')?.dataset.step,
    fresh: document.querySelectorAll('.events tr.fresh').length,
    tx: document.querySelector('[data-count="transactions"] .big').textContent.trim(),
  })`);
  assert(moved.progress === '7 / 10' && moved.current === 'u4-task', `progress follows the run (${moved.progress}, ${moved.current})`);
  assert(moved.fresh === 3, `new events are highlighted (${moved.fresh})`);
  assert(moved.tx === '6', 'counters follow the record');
  await screenshot(win, 'playground-live-update.png');

  // A step filters the events to the ones it produced.
  await js(win, `document.querySelector('[data-step="b-open"] .step-button').click()`);
  await waitFor(win.webContents, `document.querySelector('[data-filter]')`, 'step filter');
  const filtered = await js(win, `[...document.querySelectorAll('.events tbody tr')].map(tr => tr.dataset.seq)`);
  assert(JSON.stringify(filtered) === JSON.stringify(['8', '7']), `a step shows only its events (${filtered})`);
  await js(win, `document.querySelector('[data-filter]').click()`);
  await waitFor(win.webContents, `!document.querySelector('[data-filter]')`, 'filter cleared');

  // Key screenshots, tied to their steps.
  await waitFor(win.webContents, `document.querySelectorAll('.shot img[src^="data:image/png"]').length === 2`, 'screenshots loaded');
  const shots = await js(win, `[...document.querySelectorAll('.shot')].map(s => s.innerText.replace(/\\s+/g, ' ').trim())`);
  assert(shots[0].includes('A 的 Share tab · 已读回执') && shots[0].includes('第 3 步 · 接收方 B'), `a screenshot names its step (${shots[0]})`);
  await scrollIntoView(win, '[data-section="screenshots"]');
  await screenshot(win, 'playground-screenshots.png');
  await js(win, `document.querySelector('.shot[data-shot="screenshots/a-distill-mint.png"] .shot-pic').click()`);
  await waitFor(win.webContents, `document.querySelector('.lightbox img')`, 'lightbox');
  await screenshot(win, 'playground-lightbox.png');
  await js(win, `window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))`);
  await waitFor(win.webContents, `!document.querySelector('.lightbox')`, 'lightbox closed');

  // Every count opens the provenance list behind it.
  await js(win, `document.querySelector('[data-count="roles"]').click()`);
  await waitFor(win.webContents, `document.querySelectorAll('[data-prov="roles"] .prov-list tr').length === 7`, 'wallet list');
  await js(win, `document.querySelector('[data-count="transactions"]').click()`);
  await waitFor(win.webContents, `document.querySelector('[data-group="transactions"]')`, 'product lists');
  const prov = await js(win, `({
    wallet: document.querySelector('[data-prov="roles"] .prov-list a')?.getAttribute('href'),
    txs: document.querySelectorAll('[data-group="transactions"] .prov-row').length,
    sessions: document.querySelectorAll('[data-group="sessions"] .prov-row').length,
    skill: [...document.querySelectorAll('[data-group="artifacts"] a')].map(a => a.textContent.trim()),
    ai: document.querySelector('[data-prov="ai"]').innerText,
    tasks: document.querySelector('[data-prov="tasks"]').innerText,
  })`);
  assert(prov.wallet === `https://scan.bohr.life/address/${wallet('A')}`, 'wallets link to the explorer');
  assert(prov.txs === 6 && prov.sessions === 5, `products list every transaction and session (${prov.txs}, ${prov.sessions})`);
  assert(prov.skill.includes(`Skill #${SKILL_ID} ↗`), 'a fetched Skill links to its page');
  assert(/Claude Code\s+claude-sonnet-5-5\s+2\.1\.292/.test(prov.ai) && /Codex\s+gpt-6-astra\s+codex-cli 0\.160\.0/.test(prov.ai), `AI runs name harness, model and version (${prov.ai})`);
  assert(prov.tasks.includes('5 个任务，覆盖 5 个场景'), `tasks count scenes (${prov.tasks})`);
  await js(win, `document.querySelector('[data-prov="tasks"] .prov-toggle').click()`);
  await js(win, `document.querySelector('[data-prov="ai"] .prov-toggle').click()`);
  await scrollIntoView(win, '[data-section="provenance"]');
  await screenshot(win, 'playground-provenance.png');

  // A run that went quiet is not presented as running.
  const old = new Date(Date.now() - 6 * 60_000);
  utimesSync(join(dir, 'runs', LIVE_RUN, 'provenance.json'), old, old);
  utimesSync(join(dir, 'runs', LIVE_RUN, 'events.jsonl'), old, old);
  await waitFor(win.webContents, `document.querySelector('[data-banner="quiet"]')`, 'quiet banner', 6_000);
  assert((await js(win, `document.querySelector('[data-run-status]').innerText`)).includes('分钟没有新动静'), 'a quiet run says how long it has been quiet');
  await scrollIntoView(win, '.pg-run', 'start');
  await screenshot(win, 'playground-quiet.png');

  // A dry run and a failed run say what they are.
  await js(win, `window.location.hash = '#/playground/runs/run-20261006T090000Z-dry'`);
  await waitFor(win.webContents, `document.querySelector('[data-banner="dry-run"]')`, 'dry-run banner');
  assert((await js(win, `document.querySelector('.pg-run .pill').textContent.trim()`)) === '空跑 · 未上链', 'a dry run is not presented as on chain');
  await js(win, `window.location.hash = '#/playground/runs/run-20261005T140000Z-fail'`);
  await waitFor(win.webContents, `document.querySelector('[data-banner="failed"]')`, 'failure banner');
  const failed = await js(win, `document.querySelector('[data-banner="failed"]').innerText`);
  assert(failed.includes('第 1 步失败') && failed.includes('B 的钱包还没有激活'), `a failed run says where and why (${failed})`);
  await screenshot(win, 'playground-failed.png');
  await js(win, `window.location.hash = '#/playground/runs/run-20261004T100000Z-broken'`);
  await waitFor(win.webContents, `document.querySelector('.pg-run .detail-banner.broken')?.innerText.includes('不是有效的 JSON')`, 'unreadable record');
  assert(true, 'an unreadable record is reported with its reason');

  // The Skill page marks data that came from Playground and links the run.
  await js(win, `window.location.hash = '#/skills/minted/${SKILL_ID}'`);
  await waitFor(win.webContents, `document.querySelector('[data-panel="playground-source"]')`, 'Playground source panel');
  const source = await js(win, `({
    pill: document.querySelector('[data-source="playground"]').textContent.trim(),
    kpi: document.querySelector('[data-kpi="invocations"] .source-link')?.textContent.trim(),
    text: document.querySelector('[data-panel="playground-source"]').innerText,
    runs: [...document.querySelectorAll('[data-source-run]')].map(a => a.dataset.sourceRun),
  })`);
  assert(source.pill === '来源：Playground', 'the Skill is marked 来源：Playground');
  assert(source.kpi === '含 Playground 数据 · 1 次运行', `the invocation count says it includes Playground data (${source.kpi})`);
  assert(source.text.includes('由作者 A 铸造') && source.text.includes('链上的统计暂时不区分是否来自 Playground'), 'the note says who minted it and what is not yet separated');
  assert(JSON.stringify(source.runs) === JSON.stringify([LIVE_RUN]), 'the note links the run');
  await scrollIntoView(win, '.minted-detail', 'start');
  await screenshot(win, 'skill-detail-playground-source.png');
  await js(win, `document.querySelector('[data-source-run]').click()`);
  await waitFor(win.webContents, `document.querySelector('.pg-run[data-run="${LIVE_RUN}"]')`, 'the run from the Skill page');
  assert(true, 'the marker opens the run\'s provenance record');

  win.destroy();
}

app.whenReady()
  .then(run)
  .catch((error) => {
    failures++;
    console.error(error);
  })
  .finally(() => {
    rmSync(dir, { recursive: true, force: true });
    console.log(failures ? `${failures} Playground check(s) failed` : 'Playground checks passed');
    app.exit(failures ? 1 : 0);
  });
