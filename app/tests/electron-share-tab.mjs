// Share tab and the Session detail share dialog (#12).
//
// Runs the built renderer against mocked IPC. Set OBELISK_SHARE_SCREENSHOTS to
// a directory to also save screenshots of the states it walks through.

import { app, BrowserWindow, ipcMain } from 'electron';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { createSessionPatch } from '../src/shared/session-patch.mjs';
import { assembleSessionDetail } from '../src/shared/session-detail-assembly.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const appRoot = join(here, '..');
const screenshotDir = process.env.OBELISK_SHARE_SCREENSHOTS || null;

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

// --- Fixtures -----------------------------------------------------------------

const SESSION_ID = '7c2e91d4-payment-callback';
const SESSION = { title: '修复支付回调重复扣款', source: 'claude', started_at: '2026-10-07T09:12:00.000Z' };
const ACTIVATED = '0x7a3F9c1E52b04D8a6f3B2e9C1d7A4b5E8f60C21e';
const NOT_ACTIVATED = '0x19bE7D2c4A8e3F1b6C9d0E5a2B7f4c3D8e1a44d0';

const turns = [
  '支付回调为什么会重复扣款？日志里同一笔订单扣了两次。',
  '先看回调处理器：没有按回调 id 去重，网关重试时会再次扣款。',
  '那就加幂等键吧，用什么做键？',
  '用网关的回调 id 做幂等键，写入前先查一次，唯一索引兜底。',
  '加上唯一索引之后要怎么迁移旧数据？',
  '先清理重复记录，再加索引；迁移脚本放在 migrations/ 里。',
  '跑一下测试。',
  '测试全部通过，重复回调现在只会扣款一次。',
];

function sessionSummary() {
  return {
    id: SESSION_ID,
    title: SESSION.title,
    project: '-work-payments',
    project_path: '/work/payments',
    source: SESSION.source,
    started_at: SESSION.started_at,
    ended_at: SESSION.started_at,
    message_count: turns.length,
  };
}

function sessionMessages() {
  return turns.map((text, index) => ({
    uuid: `m-${index}`,
    type: index % 2 === 0 ? 'user' : 'assistant',
    timestamp: new Date(Date.parse(SESSION.started_at) + index * 60_000).toISOString(),
    text,
    content_type: 'text',
    is_meta: 0,
  }));
}

const iso = (month, day, hour, minute) => new Date(2026, month - 1, day, hour, minute).toISOString();
const tx = byte => ({ txHash: `0x${byte.repeat(32)}`, explorerUrl: `https://scan.example/tx/0x${byte.repeat(32)}` });

function sent(byte, overrides) {
  const shareId = `0x${byte.repeat(32)}`;
  return {
    draft: byte.repeat(4),
    shareId,
    number: `S-${shareId.slice(2, 6).toUpperCase()}`,
    title: SESSION.title,
    session: { id: SESSION_ID, provider: 'claude' },
    messages: { from: 1, to: 8 },
    recipient: ACTIVATED,
    rules: { opens: 1, expiresAt: iso(10, 8, 21, 3) },
    canOpen: false,
    opens: { count: 0, max: 1, lastOpenedAt: null },
    expiresAt: iso(10, 8, 21, 3),
    revokedAt: null,
    sentAt: iso(10, 7, 21, 0),
    link: `https://service.example/s/${shareId}`,
    ...overrides,
  };
}

const sentShares = [
  sent('3f', { state: 'read', opens: { count: 1, max: 1, lastOpenedAt: iso(10, 7, 21, 3) }, record: { kind: 'open', ...tx('a1') } }),
  sent('9b', { title: '迁移到新版鉴权中间件', recipient: NOT_ACTIVATED, messages: { from: 12, to: 48 }, state: 'unread', canOpen: true, opens: { count: 0, max: 3, lastOpenedAt: null }, rules: { opens: 3, expiresAt: iso(10, 14, 9, 30) }, expiresAt: iso(10, 14, 9, 30), record: { kind: 'create', ...tx('b2') } }),
  sent('c4', { title: '首页性能排查', state: 'expired', expiresAt: iso(10, 6, 10, 0), record: { kind: 'create', ...tx('c3') } }),
  sent('e4', { title: '部署脚本整理', state: 'revoked', revokedAt: iso(10, 5, 18, 20), opens: { count: 0, max: null, lastOpenedAt: null }, rules: { opens: 'unlimited', expiresAt: iso(10, 12, 18, 0) }, record: { kind: 'revoke', ...tx('d4') } }),
];

let listing = { shares: [], network: 'BOT Chain 测试网', serviceUrl: 'https://service.example' };
let listingError = null;

function registerHandlers() {
  ipcMain.handle('shares:list', () => {
    if (listingError) throw new Error(listingError);
    return listing;
  });
  ipcMain.handle('shares:recipient', (_event, address) => {
    if (address === ACTIVATED) return { status: 'activated' };
    if (address === NOT_ACTIVATED) return { status: 'not_activated', activateUrl: 'https://service.example/activate' };
    return { status: 'unreachable', error: 'offline' };
  });
  ipcMain.handle('skills:list', () => []);
  ipcMain.handle('db:getSessions', () => [sessionSummary()]);
  ipcMain.handle('db:getSessionsByIds', (_event, ids) => (ids.includes(SESSION_ID) ? [sessionSummary()] : []));
  ipcMain.handle('db:getSessionMessages', () => sessionMessages());
  ipcMain.handle('db:getSessionToolCalls', () => []);
  ipcMain.handle('db:getSessionToolResults', () => []);
  ipcMain.handle('db:getSessionPatch', (_event, id, cursor) => {
    const patch = createSessionPatch({
      messages: assembleSessionDetail({
        messages: id === SESSION_ID ? sessionMessages() : [],
        toolCalls: [],
        toolResults: [],
        subagents: [],
        workflows: [],
      }).messages,
      workflows: [],
    }, cursor);
    return { ...patch, session: id === SESSION_ID ? sessionSummary() : null };
  });
  ipcMain.handle('db:getSessionSubagents', () => []);
  ipcMain.handle('db:getSessionWorkflows', () => []);
  ipcMain.handle('db:getSessionSummaries', () => []);
  ipcMain.handle('db:getMessageFullText', () => null);
  ipcMain.handle('db:getMemories', () => []);
  ipcMain.handle('db:getProjects', () => [{ project: '-work-payments', count: 1 }]);
  ipcMain.handle('db:getStats', () => ({}));
  ipcMain.handle('settings:get', () => ({
    sources: [{ id: 'claude', name: 'Claude Code', color: '#d97757', status: 'ok', statusText: 'ok', sessionCount: 1 }],
  }));
}

async function screenshot(win, name) {
  if (!screenshotDir) return;
  await delay(1800);
  const image = await win.webContents.capturePage();
  mkdirSync(screenshotDir, { recursive: true });
  const path = join(screenshotDir, name);
  writeFileSync(path, image.toPNG());
  console.log(`screenshot: ${path}`);
}

const js = (win, source) => win.webContents.executeJavaScript(source, true);

// A hidden window never has focus, and the Clipboard API refuses to write
// without it; record what the page writes instead.
async function captureClipboard(win) {
  await js(win, `Object.defineProperty(navigator.clipboard, 'writeText', {
    configurable: true,
    value: async (text) => { window.__copiedPrompt = text; },
  })`);
}

async function clickCopy(win, selector) {
  await js(win, `window.__copiedPrompt = null; document.querySelector('.prompt-toast-close')?.click()`);
  await js(win, `document.querySelector(${JSON.stringify(selector)}).click()`);
  await waitFor(win.webContents, `window.__copiedPrompt !== null`, `copying from ${selector}`);
  return js(win, `window.__copiedPrompt`);
}

async function setInput(win, selector, value) {
  await js(win, `(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    el.value = ${JSON.stringify(String(value))};
    el.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
}

async function reloadShares(win) {
  win.webContents.send('obelisk:shares-updated');
  await delay(200);
}

async function run() {
  registerHandlers();
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

  // Nothing sent yet: the tab says where shares come from and offers the prompt.
  await win.loadFile(join(appRoot, 'out', 'renderer', 'index.html'), { hash: '/share' });
  await waitFor(win.webContents, `document.querySelector('.share-empty')`, 'empty Share tab');
  await captureClipboard(win);
  const empty = await js(win, `({
    title: document.title,
    sidebar: [...document.querySelectorAll('.sidebar-item')].find(el => el.textContent.includes('Share'))?.className,
    received: document.querySelectorAll('.share-tab')[1].disabled,
    text: document.querySelector('.share-empty').textContent,
  })`);
  assert(empty.title.endsWith('— Share'), `the window is titled Share (${empty.title})`);
  assert(empty.sidebar?.includes('active'), 'the Share sidebar item is active');
  assert(empty.received === true, '收到的 is shown as phase 2 and cannot be opened');
  assert(empty.text.includes('Session 详情页点「分享」'), 'the empty state says where sharing starts');
  const example = await clickCopy(win, '.share-empty [data-prompt-label]');
  assert(example.startsWith('/obelisk-share '), `the example prompt starts with the skill's slash command (${example})`);
  await screenshot(win, 'share-tab-empty.png');

  // Sent shares in every state, each with its chain record.
  listing = { ...listing, shares: sentShares };
  await reloadShares(win);
  await waitFor(win.webContents, `document.querySelectorAll('.share-table tbody tr').length === 4`, 'four sent shares');
  const rows = await js(win, `[...document.querySelectorAll('.share-table tbody tr')].map(tr => ({
    number: tr.dataset.share,
    state: tr.dataset.state,
    pill: tr.querySelector('.pill').textContent.trim(),
    tone: tr.querySelector('.pill').className,
    record: tr.querySelector('.chain-link')?.textContent.trim() ?? null,
    href: tr.querySelector('.chain-link')?.getAttribute('href') ?? null,
    target: tr.querySelector('.chain-link')?.getAttribute('target') ?? null,
    revoke: Boolean(tr.querySelector('[data-prompt-label="撤回"]')),
    copyLink: [...tr.querySelectorAll('.row-action')].some(el => el.textContent.includes('复制链接')),
    recipient: tr.querySelector('.cell-recipient').textContent.trim(),
    rules: tr.querySelector('.cell-rules').textContent.trim(),
  }))`);
  const byState = Object.fromEntries(rows.map(row => [row.state, row]));
  assert(byState.read.pill === '已读 · 10-07 21:03' && byState.read.tone.includes('ok'), `read shows when it was opened (${byState.read.pill})`);
  assert(byState.read.record === '打开回执 ↗' && byState.read.href === tx('a1').explorerUrl && byState.read.target === '_blank', 'read links the open receipt on the explorer');
  assert(byState.unread.pill === '未读' && byState.unread.record === '分享授权 ↗', 'unread links the share authorization');
  assert(byState.expired.pill === '已过期' && byState.expired.tone.includes('warn'), 'expired is marked expired');
  assert(byState.revoked.pill === '已撤回' && byState.revoked.record === '撤回记录 ↗' && byState.revoked.href === tx('d4').explorerUrl, 'revoked links the revocation');
  assert(rows.filter(row => row.revoke).map(row => row.state).join() === 'unread', 'only a share that can still be opened offers 撤回');
  assert(rows.filter(row => row.copyLink).map(row => row.state).join() === 'unread', 'only a link that still opens is offered for copying');
  assert(byState.unread.recipient === '0x19bE…44d0' && byState.unread.rules === '3 次 · 至 10-14 09:30', `recipient and rules are compact (${byState.unread.recipient} · ${byState.unread.rules})`);
  assert(byState.revoked.rules.startsWith('不限'), 'unlimited opens read 不限');
  const badge = await js(win, `[...document.querySelectorAll('.sidebar-item')].find(el => el.textContent.includes('Share')).querySelector('.badge').textContent.trim()`);
  assert(badge === '4', `the sidebar counts sent shares (${badge})`);
  const revoke = await clickCopy(win, '.share-table tr[data-state="unread"] [data-prompt-label="撤回"]');
  assert(revoke === `/obelisk-share 撤回我发给 ${NOT_ACTIVATED} 的分享 #S-9B9B「迁移到新版鉴权中间件」`, `撤回 copies the revoke prompt with the share number (${revoke})`);
  const foot = await js(win, `document.querySelector('.share-foot').textContent`);
  assert(foot.includes('来自 BOT Chain 测试网上的记录') && foot.includes('本地时间'), 'the footnote names the chain in Chinese and the time zone');
  const overflow = await js(win, `(() => { const wrap = document.querySelector('.share-table-wrap'); return wrap.scrollWidth - wrap.clientWidth; })()`);
  assert(overflow <= 1, `the sent-shares table fits without a horizontal scrollbar, up to subpixel rounding (${overflow}px over)`);
  await screenshot(win, 'share-tab-sent.png');

  // The online service cannot be reached: the local records stay, marked unknown.
  listing = {
    ...listing,
    network: null,
    shares: sentShares.map(({ canOpen: _c, opens: _o, expiresAt: _e, revokedAt: _r, record: _rec, ...rest }) => ({ ...rest, state: 'unknown', error: 'Could not reach the Obelisk online service at https://service.example: fetch failed' })),
  };
  await reloadShares(win);
  await waitFor(win.webContents, `document.querySelector('[data-banner="offline"]')`, 'offline banner');
  const offline = await js(win, `({
    pills: [...document.querySelectorAll('.share-table .pill')].map(el => el.textContent.trim()),
    revoke: document.querySelectorAll('.share-table [data-prompt-label="撤回"]').length,
    banner: document.querySelector('[data-banner="offline"]').textContent,
  })`);
  assert(offline.pills.every(pill => pill === '状态未知'), 'without the service every state is unknown, not guessed');
  assert(offline.revoke === 0, 'nothing offers 撤回 while its state is unknown');
  assert(offline.banner.includes('Could not reach the Obelisk online service'), 'the banner gives the reason once');
  await screenshot(win, 'share-tab-offline.png');

  // The records themselves cannot be read.
  listingError = 'Unexpected token in sent.json';
  await reloadShares(win);
  await waitFor(win.webContents, `document.querySelector('[data-banner="error"]')`, 'listing error banner');
  assert(true, 'a listing that fails is reported, not shown as empty');
  listingError = null;
  listing = { ...listing, network: 'BOT Chain 测试网', shares: sentShares };
  await reloadShares(win);

  // Session detail → 分享: pick a range, a recipient, and the rules.
  await js(win, `window.location.hash = '#/sessions/${SESSION_ID}'`);
  await waitFor(win.webContents, `document.querySelector('.session-share-btn:not(:disabled)')`, 'share button in the session header');
  await js(win, `document.querySelector('.session-share-btn').click()`);
  await waitFor(win.webContents, `document.querySelector('.share-modal')`, 'share dialog');
  const opened = await js(win, `({
    from: document.querySelectorAll('.range-inputs .num')[0].value,
    to: document.querySelectorAll('.range-inputs .num')[1].value,
    disabled: document.querySelector('.share-modal-foot [data-prompt-label]').disabled,
    note: document.querySelector('.share-modal-foot .note').textContent,
    focused: document.activeElement?.classList.contains('text-input'),
  })`);
  assert(opened.from === '1' && opened.to === String(turns.length), `the range starts as the whole session (${opened.from}–${opened.to})`);
  assert(opened.disabled, '生成分享链接 waits for a recipient');
  assert(opened.note.includes('钱包地址'), `the footer says what is missing (${opened.note})`);
  assert(opened.focused, 'the recipient field has focus');

  await setInput(win, '.range-inputs .num:nth-of-type(1)', 3);
  await setInput(win, '.range-inputs .num:nth-of-type(2)', 6);
  await waitFor(win.webContents, `document.querySelectorAll('.edge').length === 2 && document.querySelector('.edge .edge-n').textContent === '#3'`, 'range edges');
  const edges = await js(win, `[...document.querySelectorAll('.edge')].map(el => el.textContent.replace(/\\s+/g, ' ').trim())`);
  assert(edges[0].includes('那就加幂等键吧') && edges[1].includes('迁移脚本放在 migrations/'), `the first and last messages of the range are shown (${edges.join(' | ')})`);
  const counts = await js(win, `document.querySelector('[data-step="range"] .note').textContent.trim()`);
  assert(counts === '4 条消息 · 0 次工具调用', `the range is counted (${counts})`);

  await setInput(win, '.text-input', '0x7a3f…c21e');
  await waitFor(win.webContents, `document.querySelector('[data-recipient-hint]')?.textContent.includes('40 位')`, 'abbreviated address refused');
  assert(true, 'an abbreviated address is refused: the prompt needs the full address');

  await setInput(win, '.text-input', NOT_ACTIVATED);
  await waitFor(win.webContents, `document.querySelector('[data-recipient-hint]')?.textContent.includes('还没激活')`, 'not activated hint');
  const activateNote = await js(win, `document.querySelector('.recipient-hint .note')?.textContent ?? ''`);
  assert(activateNote.includes('https://service.example/activate'), 'a recipient without a wallet gets the activate link to pass on');
  assert(await js(win, `document.querySelector('.share-modal-foot [data-prompt-label]').disabled`), 'nothing can be shared with a recipient who has not activated');
  await screenshot(win, 'share-dialog-not-activated.png');

  await setInput(win, '.text-input', ACTIVATED);
  await waitFor(win.webContents, `document.querySelector('[data-recipient-hint]')?.textContent.includes('已激活')`, 'activated hint');
  await js(win, `[...document.querySelectorAll('[aria-label="打开次数"] button')].find(b => b.textContent === '不限').click()`);
  await js(win, `[...document.querySelectorAll('[aria-label="有效期"] button')].find(b => b.textContent === '7 天').click()`);
  await waitFor(win.webContents, `!document.querySelector('.share-modal-foot [data-prompt-label]').disabled`, 'share button enabled');
  const sharePrompt = await clickCopy(win, '.share-modal-foot [data-prompt-label]');
  assert(
    sharePrompt === `/obelisk-share 把 session「${SESSION.title}」（${SESSION_ID}）第 3–6 条分享给 ${ACTIVATED}，不限次数，7 天内有效`,
    `生成分享链接 copies the share prompt (${sharePrompt})`,
  );
  await js(win, `[...document.querySelectorAll('[aria-label="打开次数"] button')].find(b => b.textContent === '1 次').click()`);
  await js(win, `[...document.querySelectorAll('[aria-label="有效期"] button')].find(b => b.textContent === '24 小时').click()`);
  await screenshot(win, 'share-dialog.png');

  await setInput(win, '.range-inputs .num:nth-of-type(2)', 99);
  await waitFor(win.webContents, `document.querySelector('.field-error')`, 'range error');
  assert(await js(win, `document.querySelector('.share-modal-foot [data-prompt-label]').disabled`), 'a range past the last message cannot be shared');

  await js(win, `window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))`);
  await waitFor(win.webContents, `!document.querySelector('.share-modal')`, 'dialog closed');
  assert(true, 'Escape closes the dialog');

  win.destroy();
}

app.whenReady()
  .then(run)
  .catch((error) => {
    failures++;
    console.error(error);
  })
  .finally(() => {
    console.log(failures ? `${failures} Share tab check(s) failed` : 'Share tab checks passed');
    app.exit(failures ? 1 : 0);
  });
