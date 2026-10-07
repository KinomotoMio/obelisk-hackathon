// Settings → 钱包 (#6): show the address, 生成钱包 / 激活 as copied prompts,
// 导入钱包 directly in the App.
//
// Runs the built renderer against mocked IPC. Set OBELISK_WALLET_SCREENSHOTS to
// a directory to also save screenshots of the states it walks through.

import { app, BrowserWindow, ipcMain } from 'electron';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const here = dirname(fileURLToPath(import.meta.url));
const appRoot = join(here, '..');
const screenshotDir = process.env.OBELISK_WALLET_SCREENSHOTS || null;

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

// Hardhat's public development wallet #0. Never holds real funds.
const ADDRESS = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';
const MNEMONIC = 'test test test test test test test test test test test junk';
const DATA_DIR = '/home/user/.obelisk';
const STORED_IN = 'macOS Keychain';

let overview = { state: 'none', dataDir: DATA_DIR, storedIn: STORED_IN };
let activation = null;
let importAnswer = null;
const calls = { get: 0, activation: 0, imports: [] };

const activationOf = (state, extra = {}) => ({
  activation: state,
  address: ADDRESS,
  chainId: 968,
  network: 'BOT Chain 测试网',
  explorerUrl: `https://scan.bohr.life/address/${ADDRESS}`,
  activatedAt: null,
  keyVersion: null,
  ...extra,
});

function registerHandlers() {
  ipcMain.handle('wallet:get', () => {
    calls.get++;
    return overview;
  });
  ipcMain.handle('wallet:activation', () => {
    calls.activation++;
    return activation;
  });
  ipcMain.handle('wallet:import', (_event, secret) => {
    calls.imports.push(secret);
    const answer = importAnswer;
    if (answer?.ok) {
      overview = { state: 'ready', address: answer.address, dataDir: DATA_DIR, storedIn: STORED_IN };
      activation = activationOf('not_activated');
    }
    return answer;
  });
  let assistant = 'claude-code';
  ipcMain.handle('settings:prompt-assistant', () => assistant);
  ipcMain.handle('settings:set', (_event, key, value) => {
    if (key === 'promptAssistant') assistant = value;
    return true;
  });
  ipcMain.handle('settings:get', () => ({
    version: '0.0.0-test',
    dbPath: `${DATA_DIR}/obelisk.sqlite`,
    recapDir: `${DATA_DIR}/recap`,
    sources: [{ id: 'claude', name: 'Claude Code', vendor: 'Anthropic', color: '#d97757', status: 'ok', statusText: 'ok', sessionCount: 1, path: '/home/user/.claude' }],
  }));
  ipcMain.handle('skills:list', () => []);
  ipcMain.handle('shares:list', () => ({ shares: [], network: null, serviceUrl: 'https://service.example' }));
  ipcMain.handle('db:getSessions', () => []);
  ipcMain.handle('db:getMemories', () => []);
  ipcMain.handle('db:getProjects', () => []);
  ipcMain.handle('db:getStats', () => ({}));
  ipcMain.handle('recap:list', () => []);
}

async function screenshot(win, name) {
  if (!screenshotDir) return;
  await delay(600);
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
    value: async (text) => { window.__copied = text; },
  })`);
}

async function clickCopy(win, selector) {
  await js(win, `window.__copied = null; document.querySelector('.prompt-toast-close')?.click()`);
  await js(win, `document.querySelector(${JSON.stringify(selector)}).click()`);
  await waitFor(win.webContents, `window.__copied !== null`, `copying from ${selector}`);
  return js(win, `window.__copied`);
}

async function setSecret(win, value) {
  await js(win, `(() => {
    const el = document.querySelector('[data-wallet-import] textarea');
    el.value = ${JSON.stringify(value)};
    el.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
}

async function reload(win) {
  await js(win, `window.dispatchEvent(new Event('focus'))`);
}

const state = (win) => js(win, `document.querySelector('[data-section="wallet"] [data-wallet-state]')?.dataset.walletState ?? null`);

async function run() {
  registerHandlers();
  const win = new BrowserWindow({
    show: false,
    x: 0,
    y: 0,
    width: 1280,
    height: 860,
    webPreferences: {
      preload: join(appRoot, 'out', 'preload', 'index.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // No wallet: 生成钱包 copies the docs' prompt, 导入 is offered beside it.
  await win.loadFile(join(appRoot, 'out', 'renderer', 'index.html'), { hash: '/settings' });
  await waitFor(win.webContents, `document.querySelector('[data-wallet-state="none"]')`, 'no-wallet state');
  await captureClipboard(win);
  const none = await js(win, `({
    first: document.querySelector('.settings-content > section')?.dataset.section,
    pill: document.querySelector('[data-wallet-state="none"] .pill').textContent.trim(),
    text: document.querySelector('[data-wallet-state="none"] .wallet-text').textContent,
    import: Boolean(document.querySelector('[data-wallet-action="import"]')),
  })`);
  assert(none.first === 'wallet', 'the wallet is the first Settings section');
  assert(none.pill === '未创建', `a missing wallet reads 未创建 (${none.pill})`);
  assert(none.text.includes('Claude Code') && none.text.includes('私钥不会出现在对话里') && none.text.includes('macOS 钥匙串'), `the empty state says where the prompt goes and where the key is kept (${none.text})`);
  assert(none.import, '导入已有钱包 is offered when there is no wallet');
  const create = await clickCopy(win, '[data-prompt-label="生成钱包"]');
  assert(create === '/obelisk-wallet 帮我创建 Obelisk 钱包', `生成钱包 copies the prompt docs/vision/01 names (${create})`);
  await js(win, `document.querySelector('[data-section="prompt-assistant"] [data-assistant="codex"]').click()`);
  const codex = await clickCopy(win, '[data-prompt-label="生成钱包"]');
  assert(codex === '用 obelisk-wallet 帮我创建 Obelisk 钱包', `for Codex it is a sentence naming the skill (${codex})`);
  await js(win, `document.querySelector('[data-section="prompt-assistant"] [data-assistant="claude-code"]').click()`);
  await js(win, `document.querySelector('.prompt-toast-close')?.click()`);
  await screenshot(win, 'wallet-none.png');

  // 导入: the field is masked, refusals come back as Chinese reasons.
  await js(win, `document.querySelector('[data-wallet-action="import"]').click()`);
  await waitFor(win.webContents, `document.querySelector('[data-wallet-import] textarea')`, 'import form');
  const form = await js(win, `(() => {
    const field = document.querySelector('[data-wallet-import] textarea');
    return {
      focused: document.activeElement === field,
      masked: getComputedStyle(field).webkitTextSecurity,
      autocomplete: field.getAttribute('autocomplete'),
      spellcheck: field.getAttribute('spellcheck'),
      submitDisabled: document.querySelector('[data-wallet-action="import-submit"]').disabled,
      note: document.querySelector('.secret-note').textContent,
    };
  })()`);
  assert(form.focused, 'the secret field has focus');
  assert(form.masked === 'disc', `the secret is masked until 显示 is pressed (${form.masked})`);
  assert(form.autocomplete === 'off' && form.spellcheck === 'false', 'the field neither autocompletes nor spellchecks the secret');
  assert(form.submitDisabled, '导入 waits for input');
  assert(form.note.includes('不经过 AI 对话') && form.note.includes('不会发给 Obelisk 在线服务'), 'the form says the secret stays out of the conversation and off the service');

  importAnswer = { ok: false, error: { code: 'mnemonic-word', message: 'Word 5 of the recovery phrase is not in the BIP-39 English word list', wordIndex: 5 } };
  await setSecret(win, 'test test test test tset test test test test test test junk');
  await js(win, `document.querySelector('[data-wallet-action="import-submit"]').click()`);
  await waitFor(win.webContents, `document.querySelector('[data-wallet-import-error]')`, 'import error');
  const refused = await js(win, `document.querySelector('[data-wallet-import-error]').textContent.trim()`);
  assert(refused === '第 5 个词不在 BIP-39 英文词表里，请检查拼写。', `a mistyped word is pointed out by position (${refused})`);
  assert(await js(win, `document.querySelector('[data-wallet-import] textarea').value.length > 0`), 'a refused secret stays in the field to be corrected');
  await screenshot(win, 'wallet-import-error.png');

  importAnswer = { ok: false, error: { code: 'mnemonic-checksum', message: 'checksum' } };
  await js(win, `document.querySelector('[data-wallet-action="import-submit"]').click()`);
  await waitFor(win.webContents, `document.querySelector('[data-wallet-import-error]')?.textContent.includes('校验')`, 'checksum error');
  assert(true, 'a phrase that fails its checksum is refused before anything is stored');

  // A good phrase: stored, cleared from the page, and the wallet appears.
  importAnswer = { ok: true, status: 'imported', address: ADDRESS, kind: 'mnemonic' };
  await setSecret(win, MNEMONIC);
  await js(win, `document.querySelector('[data-wallet-action="import-submit"]').click()`);
  await waitFor(win.webContents, `document.querySelector('[data-activation="not_activated"]')`, 'imported wallet');
  assert(calls.imports.at(-1) === MNEMONIC, 'the secret reaches the main process as typed, once per submit');
  const after = await js(win, `({
    form: Boolean(document.querySelector('[data-wallet-import]')),
    inDom: document.documentElement.outerHTML.includes('junk'),
    notice: document.querySelector('[data-wallet-notice]')?.textContent.trim(),
  })`);
  assert(!after.form && !after.inDom, 'after the import the secret is gone from the page');
  assert(after.notice === '已从助记词导入钱包。', `the import is confirmed (${after.notice})`);

  // Not activated: address, copy, explorer from the chain id, 激活钱包 prompt.
  const ready = await js(win, `(() => {
    const card = document.querySelector('[data-wallet-state="ready"]');
    const link = card.querySelector('[data-wallet-explorer]');
    return {
      address: card.querySelector('[data-wallet-address]').value,
      pill: card.querySelector('[data-wallet-pill]').textContent.trim(),
      network: card.querySelector('[data-wallet-network]')?.textContent.trim(),
      href: link?.getAttribute('href'),
      target: link?.getAttribute('target'),
      rel: link?.getAttribute('rel'),
      callout: card.querySelector('[data-wallet-callout="not-activated"]')?.textContent ?? '',
    };
  })()`);
  assert(ready.address === ADDRESS, 'the full address is shown');
  assert(ready.pill === '未激活', `a wallet without a registered key reads 未激活 (${ready.pill})`);
  assert(ready.network === 'BOT Chain 测试网', `the network is named in Chinese (${ready.network})`);
  assert(ready.href === `https://scan.bohr.life/address/${ADDRESS}` && ready.target === '_blank' && ready.rel.includes('noopener'), `the explorer link opens the address page outside the App (${ready.href})`);
  assert(ready.callout.includes('手续费由 Obelisk 在线服务代付'), 'not activated says what activation does and who pays');
  const copiedAddress = await clickCopy(win, '[data-wallet-action="copy"]');
  assert(copiedAddress === ADDRESS, '复制地址 copies the full address');
  assert(await js(win, `document.querySelector('[data-wallet-action="copy"]').textContent.includes('已复制')`), '复制地址 confirms the copy');
  const activate = await clickCopy(win, '[data-prompt-label="激活钱包"]');
  assert(activate === '/obelisk-wallet 激活我的 Obelisk 钱包', `激活钱包 copies the activation prompt (${activate})`);
  assert(!(await js(win, `Boolean(document.querySelector('[data-wallet-action="import"]'))`)), 'a data directory with a wallet offers no import over it');
  await js(win, `document.querySelector('.prompt-toast-close')?.click()`);
  await screenshot(win, 'wallet-not-activated.png');

  // Activated: coming back to the window re-reads the chain.
  activation = activationOf('active', { activatedAt: '2026-10-07T13:03:00.000Z', keyVersion: 1 });
  const before = calls.activation;
  await delay(1600);
  await reload(win);
  await waitFor(win.webContents, `document.querySelector('[data-activation="active"]')`, 'activated');
  assert(calls.activation > before, 'focusing the window again re-reads the activation');
  const active = await js(win, `({
    pill: document.querySelector('[data-wallet-pill]').textContent.trim(),
    tone: document.querySelector('[data-wallet-pill]').className,
    meta: document.querySelector('.wallet-meta').textContent.replace(/\\s+/g, ' '),
    prompt: Boolean(document.querySelector('[data-prompt-label="激活钱包"]')),
  })`);
  assert(active.pill === '已激活' && active.tone.includes('ok'), `an activated wallet reads 已激活 (${active.pill})`);
  assert(/激活于 2026-10-07 \d{2}:03/.test(active.meta), `it says when it was activated, in local time (${active.meta})`);
  assert(!active.prompt, 'an activated wallet offers no 激活');
  await screenshot(win, 'wallet-activated.png');

  // A different key on chain: 重新激活.
  activation = activationOf('different_key');
  await delay(1600);
  await reload(win);
  await waitFor(win.webContents, `document.querySelector('[data-activation="different_key"]')`, 'different key');
  assert((await clickCopy(win, '[data-prompt-label="重新激活"]')) === '/obelisk-wallet 激活我的 Obelisk 钱包', '重新激活 copies the activation prompt, which previews the replacement');
  await js(win, `document.querySelector('.prompt-toast-close')?.click()`);

  // The service cannot be reached: the address stays, the state is unknown.
  activation = { activation: 'unknown', address: ADDRESS, error: { code: 'unreachable', message: 'Could not reach the Obelisk online service at https://service.example: fetch failed' } };
  await js(win, `document.querySelector('.wallet-head .refresh').click()`);
  await waitFor(win.webContents, `document.querySelector('[data-activation="unknown"]')`, 'service unreachable');
  const offline = await js(win, `({
    address: document.querySelector('[data-wallet-address]').value,
    pill: document.querySelector('[data-wallet-pill]').textContent.trim(),
    explorer: Boolean(document.querySelector('[data-wallet-explorer]')),
    network: Boolean(document.querySelector('[data-wallet-network]')),
    reason: document.querySelector('[data-wallet-callout="unknown"] .wallet-reason').textContent,
    retry: Boolean(document.querySelector('[data-wallet-action="retry"]')),
  })`);
  assert(offline.address === ADDRESS, 'the address is still shown without the service');
  assert(offline.pill === '激活状态未知', `activation is unknown, not guessed (${offline.pill})`);
  assert(!offline.explorer && !offline.network, 'no chain, no explorer link or network name');
  assert(offline.reason.includes('Could not reach'), 'the reason is shown');
  assert(offline.retry, '重试 is offered');
  await screenshot(win, 'wallet-service-unreachable.png');
  activation = activationOf('not_activated');
  await js(win, `document.querySelector('[data-wallet-action="retry"]').click()`);
  await waitFor(win.webContents, `document.querySelector('[data-activation="not_activated"]')`, 'retry');
  assert(true, '重试 reads the activation again');

  // wallet.json without its key: import restores it; another wallet is refused.
  overview = { state: 'key_missing', address: ADDRESS, dataDir: DATA_DIR, storedIn: STORED_IN, message: 'missing' };
  activation = null;
  await delay(1600);
  await reload(win);
  await waitFor(win.webContents, `document.querySelector('[data-wallet-state="key-missing"]')`, 'key missing');
  assert(!(await js(win, `Boolean(document.querySelector('[data-prompt-label="生成钱包"]'))`)), 'a lost key is never papered over with 生成钱包');
  await js(win, `document.querySelector('[data-wallet-action="import"]').click()`);
  await waitFor(win.webContents, `document.querySelector('[data-wallet-import] textarea')`, 'restore form');
  importAnswer = { ok: false, error: { code: 'wallet_exists', message: 'exists', address: ADDRESS } };
  await setSecret(win, `0x${'11'.repeat(32)}`);
  await js(win, `document.querySelector('[data-wallet-action="import-submit"]').click()`);
  await waitFor(win.webContents, `document.querySelector('[data-wallet-import-error]')`, 'restore refused');
  const wrong = await js(win, `document.querySelector('[data-wallet-import-error]').textContent`);
  assert(wrong.includes('0xf39F…2266') && wrong.includes('wallet.json'), `only the recorded wallet can be restored (${wrong})`);
  await screenshot(win, 'wallet-key-missing.png');
  await js(win, `window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))`);
  await js(win, `document.querySelector('[data-wallet-import] textarea')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
  await waitFor(win.webContents, `!document.querySelector('[data-wallet-import]')`, 'form closed');
  assert(true, 'Escape closes the import form');

  // Unreadable: the reason is shown.
  overview = { state: 'error', dataDir: DATA_DIR, message: 'Keeping the wallet key in the system keychain is not supported on win32 yet (macOS and Linux are)' };
  await delay(1600);
  await reload(win);
  await waitFor(win.webContents, `document.querySelector('[data-wallet-state="error"]')`, 'error state');
  assert((await js(win, `document.querySelector('[data-wallet-state="error"] .wallet-reason').textContent`)).includes('not supported on win32'), 'an unreadable wallet says why');
  assert((await state(win)) === 'error', 'state is error');

  win.destroy();
}

app.whenReady()
  .then(run)
  .catch((error) => {
    failures++;
    console.error(error);
  })
  .finally(() => {
    console.log(failures ? `${failures} Settings wallet check(s) failed` : 'Settings wallet checks passed');
    app.exit(failures ? 1 : 0);
  });
