// Playground source marks (#32): a minted Skill that a Playground run produced
// says so, and 查看产生方法 opens the run's published web page (/runs/<id> on
// the online service) in the browser. The run itself is no longer shown in
// the App: there is no Playground page, route or sidebar item.
//
// Runs the built renderer with the real Playground reader
// (out/main/playground-runs.js) over fixture runs in the runner's schema, and
// mocked IPC for everything else. Set OBELISK_PLAYGROUND_SCREENSHOTS to a
// directory to also save screenshots.

import { app, BrowserWindow, ipcMain } from 'electron';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { publishedRunPage, skillSources } from '../out/main/playground-runs.js';
import { liveRun, LIVE_RUN, SKILL_ID, SKILL_NAME, wallet, writePlaygroundFixture } from '../../tests/app-playground-fixtures.mjs';

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

async function screenshot(win, name) {
  if (!screenshotDir) return;
  await delay(1200);
  const png = (await win.webContents.capturePage()).toPNG();
  mkdirSync(screenshotDir, { recursive: true });
  writeFileSync(join(screenshotDir, name), png);
  console.log(`screenshot: ${join(screenshotDir, name)}`);
}

// --- Mocked App data ----------------------------------------------------------

const live = liveRun();

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

// Which runs the service has published: the first fixture run only.
const published = new Set([LIVE_RUN]);
const opened = [];
const servicePages = async (url) => new Response('{}', { status: published.has(url.split('/runs/')[1]?.split('/')[0]) ? 200 : 404 });

function registerHandlers() {
  ipcMain.handle('playground:skill-sources', (_event, query) => skillSources(dir, query));
  ipcMain.handle('playground:open-run', async (_event, runId) => {
    const page = await publishedRunPage('https://obelisk-service.example.workers.dev', runId, servicePages);
    if (page.ok) opened.push(page.url);
    return page;
  });
  ipcMain.handle('settings:prompt-assistant', () => 'claude-code');
  ipcMain.handle('shares:list', () => ({ shares: [], network: null, serviceUrl: 'https://obelisk-service.example.workers.dev' }));
  ipcMain.handle('skills:list', () => []);
  ipcMain.handle('skills:describe-scenes', (_event, tags) => tags.map(tag => ({ tag, kind: 'unknown', label: tag })));
  ipcMain.handle('skills:chain-detail', (_event, skillId) => (skillId === SKILL_ID
    ? { ok: true, skill: chainSkill }
    : { ok: false, error: { code: 'unknown_skill', message: `No minted Skill ${skillId}` } }));
  ipcMain.handle('db:getSessions', () => []);
  ipcMain.handle('db:getSessionsByIds', () => []);
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

  await win.loadFile(join(appRoot, 'out', 'renderer', 'index.html'), { hash: `/skills/minted/${SKILL_ID}` });
  await waitFor(win.webContents, `document.querySelector('.minted-detail[data-skill-id="${SKILL_ID}"]')`, `Skill #${SKILL_ID}`);
  await delay(300);
  assert(!(await js(win, `document.querySelector('[data-source="playground"]')`)), 'no Playground marker before any run names the Skill');

  // The live run and an older failed run both name the Skill; only the first is published.
  writePlaygroundFixture(dir, { live });
  win.webContents.reload();
  await waitFor(win.webContents, `document.querySelector('[data-panel="playground-source"]')`, 'Playground source panel');
  const source = await js(win, `({
    pill: document.querySelector('[data-source="playground"]').textContent.trim(),
    kpi: document.querySelector('[data-kpi="invocations"] .source-link')?.textContent.trim(),
    text: document.querySelector('[data-panel="playground-source"]').innerText,
    runs: [...document.querySelectorAll('[data-source-run]')].map(a => a.dataset.sourceRun),
    go: document.querySelector('[data-source-run] .source-run-go').textContent.trim(),
  })`);
  assert(source.pill === '来源：Playground', 'the Skill is marked 来源：Playground');
  assert(source.kpi === '含 Playground 数据 · 1 次运行', `the invocation count says it includes Playground data (${source.kpi})`);
  assert(source.text.includes('由作者 A 铸造') && source.text.includes('链上的统计暂时不区分是否来自 Playground'), 'the note says who minted it and what is not yet separated');
  assert(JSON.stringify(source.runs) === JSON.stringify([LIVE_RUN]), 'the note lists the run');
  assert(source.go === '查看产生方法 ↗', `each run offers its page on the web (${source.go})`);

  // A published run opens in the browser.
  await js(win, `document.querySelector('[data-source-run="${LIVE_RUN}"]').click()`);
  await waitFor(win.webContents, `!document.querySelector('[data-source-run]').disabled`, 'the open request');
  assert(JSON.stringify(opened) === JSON.stringify([`https://obelisk-service.example.workers.dev/runs/${LIVE_RUN}`]), `查看产生方法 opens /runs/<id> on the service (${opened})`);
  assert(!(await js(win, `document.querySelector('[data-source-note]')`)), 'no note when the page opened');
  assert((await js(win, `location.hash`)) === `#/skills/minted/${SKILL_ID}`, 'the App stays on the Skill page');

  // A run only on this machine says how to publish it instead of opening a 404.
  published.delete(LIVE_RUN);
  await js(win, `document.querySelector('[data-source-run="${LIVE_RUN}"]').click()`);
  await waitFor(win.webContents, `document.querySelector('[data-source-note="${LIVE_RUN}"]')`, 'the unpublished note');
  const note = await js(win, `document.querySelector('[data-source-note="${LIVE_RUN}"]').textContent`);
  assert(note.includes(`npm run playground -- publish ${LIVE_RUN}`), `an unpublished run says how to publish it (${note})`);
  assert(opened.length === 1, 'nothing is opened for an unpublished run');
  await js(win, `document.querySelector('[data-panel="playground-source"]').scrollIntoView({ block: 'center' })`);
  await screenshot(win, 'skill-detail-playground-source.png');

  // There is no in-App run page any more.
  assert(!(await js(win, `document.querySelector('[data-sidebar="playground"]')`)), 'no Playground item in the sidebar');
  await js(win, `window.location.hash = '#/playground/runs/${LIVE_RUN}'`);
  await delay(400);
  assert(!(await js(win, `document.querySelector('.pg-run')`)), 'the old run route shows no run page');

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
