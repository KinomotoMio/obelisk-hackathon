// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 tommy0103 and contributors.

// The web reader (#10, docs/vision/02 S4/S5): open a private share with a
// browser wallet and read it in the page, or activate a wallet so others can
// share with it. Served by the online service at /s/<shareId> and /activate.
//
// The wallet does every signature; this page never asks for a private key
// or seed phrase. Snapshot content is only ever inserted as text nodes.

import {
  base64ToBytes,
  chainName,
  decryptSnapshot,
  deriveEncryptionKey,
  formatDateTime,
  formatShortDateTime,
  openKeyPackage,
  personalSignPayload,
  providerName,
  readableError,
  redactionLabel,
  shareNumber,
  shortAddress,
  speaker,
  timeZoneLabel,
  splitBlocks,
  splitInline,
  splitRedactions,
  summarizeToolCall,
  supportsX25519,
  typedData,
} from './core.js';

const app = document.getElementById('app');
const SIGNATURE_SECONDS = 600;
const state = { chain: null, share: null, shareId: null, wallet: null, address: null, providers: [] };

// --- DOM -------------------------------------------------------------------

/** Build an element. Children are nodes or strings (always text, never HTML). */
function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'class') el.className = value;
    else if (key === 'onclick') el.addEventListener('click', value);
    else if (key === 'text') el.textContent = value;
    else el.setAttribute(key, value === true ? '' : value);
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    el.append(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return el;
}

const ICONS = {
  lock: ['M5 11h14v10H5z', 'M8 11V7a4 4 0 0 1 8 0v4'],
  clock: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z', 'M12 7v5l3 2'],
  ban: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z', 'M5.6 5.6l12.8 12.8'],
  eye: ['M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z', 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z'],
  search: ['M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16z', 'M21 21l-4.3-4.3'],
  wallet: ['M3 7h16a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z', 'M3 7l12-4v4', 'M17 13.5h.01'],
  check: ['M20 6L9 17l-5-5'],
  alert: ['M12 3l10 18H2z', 'M12 10v4', 'M12 17h.01'],
  key: ['M15 7a4 4 0 1 1-3.9 5H3v3h3v3h3v-3h2.1A4 4 0 0 1 15 7z'],
  copy: ['M9 9h11v11H9z', 'M5 15H4V4h11v1'],
  external: ['M14 4h6v6', 'M10 14L20 4', 'M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5'],
};

function icon(name, cls = 'ic') {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.8');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('class', cls);
  for (const d of ICONS[name]) {
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', d);
    svg.append(path);
  }
  return svg;
}

function show(...nodes) {
  app.replaceChildren(...nodes);
  window.scrollTo({ top: 0 });
}

function button(label, onclick, { primary = false, iconName = null } = {}) {
  return h('button', { class: `btn${primary ? ' primary' : ''}`, type: 'button', onclick }, iconName ? icon(iconName) : null, label);
}

/** A link to the explorer, or the transaction hash when the chain has no explorer. */
function chainLink(record, label = '查看链上记录') {
  if (!record) return null;
  if (record.explorerUrl) return h('a', { href: record.explorerUrl, target: '_blank', rel: 'noopener noreferrer' }, `${label} ↗`);
  return h('span', { class: 'mono', title: record.txHash }, `${label}：${shortAddress(record.txHash)}`);
}

function busy(btn, label) {
  btn.disabled = true;
  btn.replaceChildren(h('span', { class: 'spinner small', 'aria-hidden': 'true' }), label);
}

function setWalletChip(address) {
  const chip = document.getElementById('topbar-wallet');
  if (!chip) return;
  chip.textContent = shortAddress(address);
  chip.title = address;
  chip.hidden = !address;
}

// --- service ---------------------------------------------------------------

class ServiceError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

async function api(path, init) {
  let response;
  try {
    response = await fetch(path, { ...init, headers: { 'content-type': 'application/json' }, cache: 'no-store' });
  } catch {
    throw new ServiceError(0, 'unreachable', '连不上 Obelisk 在线服务，请检查网络后重试。');
  }
  const body = await response.json().catch(() => ({}));
  if (response.status >= 400) {
    throw new ServiceError(response.status, body.error?.code ?? 'http_error', body.error?.message ?? `HTTP ${response.status}`, body.error?.details);
  }
  return { status: response.status, body };
}

const post = (path, body) => api(path, { method: 'POST', body: JSON.stringify(body) });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// --- wallet ----------------------------------------------------------------

/** Browser wallets: EIP-6963 announcements, else the injected window.ethereum. */
async function discoverWallets() {
  const found = new Map();
  const onAnnounce = (event) => {
    const { info, provider } = event.detail ?? {};
    if (info?.uuid && provider) found.set(info.uuid, { name: info.name, icon: info.icon, provider });
  };
  window.addEventListener('eip6963:announceProvider', onAnnounce);
  window.dispatchEvent(new Event('eip6963:requestProvider'));
  await sleep(350);
  window.removeEventListener('eip6963:announceProvider', onAnnounce);
  const wallets = [...found.values()];
  if (wallets.length === 0 && window.ethereum) wallets.push({ name: '浏览器钱包', icon: null, provider: window.ethereum });
  return wallets;
}

function walletError(error) {
  const code = error?.code;
  if (code === 4001 || code === 'ACTION_REJECTED') return { rejected: true, message: '你在钱包里取消了这次签名，什么都没有发生。' };
  if (code === -32002) return { message: '钱包里已经有一个待处理的请求，请先在钱包弹窗里完成或取消它。' };
  return { message: `钱包返回了错误：${error?.message ?? String(error)}` };
}

async function connect(wallet) {
  state.wallet = wallet;
  const accounts = await wallet.provider.request({ method: 'eth_requestAccounts' });
  if (!accounts?.[0]) throw new Error('钱包没有返回任何地址');
  if (!state.listening && wallet.provider.on) {
    state.listening = true;
    wallet.provider.on('accountsChanged', (next) => {
      if (next?.[0] && next[0].toLowerCase() !== state.address?.toLowerCase()) location.reload();
    });
  }
  return accounts[0];
}

async function ensureChain(provider) {
  const { chain } = state;
  const want = `0x${chain.chainId.toString(16)}`;
  const current = await provider.request({ method: 'eth_chainId' });
  if (parseInt(current, 16) === chain.chainId) return;
  try {
    await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: want }] });
  } catch (error) {
    if (error?.code !== 4902 && !/unrecognized|not been added|unknown chain/i.test(error?.message ?? '')) throw error;
    await provider.request({
      method: 'wallet_addEthereumChain',
      params: [{
        chainId: want,
        chainName: chain.name,
        nativeCurrency: chain.nativeCurrency,
        rpcUrls: [chain.rpcUrl],
        ...(chain.explorerUrl ? { blockExplorerUrls: [chain.explorerUrl] } : {}),
      }],
    });
  }
}

async function signEncryptionKey(provider, address) {
  const signature = await provider.request({ method: 'personal_sign', params: [personalSignPayload(), address] });
  return deriveEncryptionKey(signature);
}

async function signTyped(provider, address, action, contract, message) {
  await ensureChain(provider);
  return provider.request({ method: 'eth_signTypedData_v4', params: [address, JSON.stringify(typedData(action, contract, state.chain, message))] });
}

function chooseWallet(wallets, then) {
  if (wallets.length === 0) return showNoWallet();
  if (wallets.length === 1) return then(wallets[0]);
  show(h('section', { class: 'panel narrow' },
    h('div', { class: 'eyebrow' }, icon('wallet'), '选择钱包'),
    h('h1', { text: '用哪个钱包打开？' }),
    h('p', { class: 'lead', text: '选择接收这份分享的那个钱包。' }),
    h('div', { class: 'actions' }, wallets.map((wallet) => {
      const img = typeof wallet.icon === 'string' && /^data:image\/(png|svg\+xml|webp|jpeg);/.test(wallet.icon)
        ? h('img', { src: wallet.icon, alt: '', width: '18', height: '18' }) : icon('wallet');
      return h('button', { class: 'btn', type: 'button', onclick: () => then(wallet) }, img, wallet.name);
    })),
  ));
}

function showNoWallet() {
  const copy = button('复制链接', async () => {
    try { await navigator.clipboard.writeText(location.href); copy.replaceChildren(icon('check'), '已复制'); } catch { /* clipboard blocked */ }
  }, { iconName: 'copy' });
  refusal({
    tone: 'dim', iconName: 'wallet',
    title: '没有检测到浏览器钱包',
    text: '在电脑上，安装 MetaMask、OKX Wallet 或 Rabby 等浏览器钱包后刷新本页。在手机上，用钱包 App 内置的浏览器打开这个链接。',
    actions: [button('刷新', () => location.reload(), { primary: true }), copy],
  });
}

// --- generic panels --------------------------------------------------------

function refusal({ tone = 'danger', iconName = 'lock', title, text, detail = null, meta = [], actions = [] }) {
  show(h('section', { class: 'panel narrow denied' },
    h('div', { class: `icon ${tone}` }, icon(iconName)),
    h('h1', {}, title),
    text ? h('p', { class: 'fg2' }, text) : null,
    detail ? h('p', { class: 'detail mono' }, detail) : null,
    actions.length ? h('div', { class: 'actions' }, actions) : null,
    meta.some(Boolean) ? h('p', { class: 'meta' }, ...meta.filter(Boolean).flatMap((part, i) => (i ? [' · ', part] : [part]))) : null,
  ));
}

/** A service failure as a callout under the steps, in the same words as showError. */
function serviceNotice(error) {
  const { text, detail } = readableError(error.message);
  return { tone: 'warn', text: h('span', {}, text, detail ? h('span', { class: 'detail mono' }, detail) : null) };
}

function showError(message, retry) {
  const { text, detail } = readableError(message);
  refusal({
    tone: 'warn',
    iconName: 'alert',
    title: '出了点问题',
    text,
    detail,
    actions: retry ? [button('重试', retry, { primary: true })] : [],
  });
}

// --- share: before opening -------------------------------------------------

function receiptRecord(share) {
  const last = share.receipts?.at(-1);
  return last?.txHash ? { txHash: last.txHash, explorerUrl: last.explorerUrl } : share.transactions?.create ?? null;
}

/** Revoked, expired, or out of opens: the share's own state, read from chain. */
function showStateRefusal(share) {
  const sender = shortAddress(share.sender);
  if (share.status === 'revoked') {
    return refusal({
      tone: 'dim', iconName: 'ban',
      title: '发送方已撤回这份分享',
      text: `撤回于 ${formatDateTime(share.revokedAt)}。撤回后任何人都无法再打开它，Obelisk 在线服务上的加密副本也已删除。`,
      meta: ['撤回由 BOT Chain 上的记录证明', chainLink(share.transactions?.revoke ?? share.transactions?.create, '撤回记录'), `本地时间 ${timeZoneLabel()}`],
    });
  }
  if (share.status === 'expired') {
    return refusal({
      tone: 'warn', iconName: 'clock',
      title: '这份分享已过期',
      text: `它的有效期到 ${formatDateTime(share.expiresAt)} 为止。如果还需要查看，请联系发送方 ${sender} 重新分享。`,
      meta: ['有效期由 BOT Chain 上的分享授权决定', chainLink(share.transactions?.create, '分享授权'), `本地时间 ${timeZoneLabel()}`],
    });
  }
  const last = share.receipts?.at(-1);
  return refusal({
    tone: 'warn', iconName: 'eye',
    title: '打开次数已用完',
    text: `这份分享只能打开 ${share.maxOpens} 次，已经全部用完${last ? `，最后一次在 ${formatDateTime(last.openedAt)}` : ''}。如果还需要查看，请联系发送方 ${sender} 重新分享。`,
    meta: ['每次打开都在 BOT Chain 上留有回执', chainLink(receiptRecord(share), '打开回执'), last ? `本地时间 ${timeZoneLabel()}` : null],
  });
}

function showNotRecipient(share, address) {
  refusal({
    tone: 'danger', iconName: 'lock',
    title: `这份分享属于 ${shortAddress(share.recipient)}`,
    text: h('span', {}, '你当前连接的钱包是 ', h('span', { class: 'mono' }, shortAddress(address)), '，无法打开。'),
    actions: [button('换一个钱包', switchAccount, { iconName: 'wallet' })],
    meta: ['打开规则由 BOT Chain 上的分享授权决定', chainLink(state.share.transactions?.create)],
  });
}

async function switchAccount() {
  try {
    await state.wallet.provider.request({ method: 'wallet_requestPermissions', params: [{ eth_accounts: {} }] });
    const accounts = await state.wallet.provider.request({ method: 'eth_accounts' });
    if (accounts?.[0]) return afterConnect(accounts[0]);
  } catch (error) {
    if (!walletError(error).rejected) showError(walletError(error).message, () => afterConnect(state.address));
  }
}

function opensLine(share) {
  if (share.maxOpens === null) return `不限次数 · 已打开 ${share.openCount} 次`;
  return `共 ${share.maxOpens} 次 · 已打开 ${share.openCount} 次`;
}

function remainingAfterOpen(share) {
  return share.maxOpens === null ? null : share.maxOpens - share.openCount - 1;
}

function showIntro() {
  const { share } = state;
  const resume = loadResume();
  const connectBtn = button('连接钱包', async () => {
    busy(connectBtn, '正在连接钱包…');
    chooseWallet(await discoverWallets(), async (wallet) => {
      try {
        afterConnect(await connect(wallet));
      } catch (error) {
        const { rejected, message } = walletError(error);
        if (rejected) showIntro(); else showError(message, showIntro);
      }
    });
  }, { primary: true, iconName: 'wallet' });

  show(h('section', { class: 'panel narrow' },
    h('div', { class: 'eyebrow' }, icon('lock'), `私密分享 · #${shareNumber(share.shareId)}`),
    h('h1', { text: '有人与你分享了一段 AI 编程对话' }),
    h('p', { class: 'lead', text: '只有指定的钱包能打开它。内容在你的浏览器里解密，Obelisk 在线服务看不到原文。' }),
    h('dl', { class: 'facts' },
      h('dt', { text: '发送方' }), h('dd', { class: 'mono', title: share.sender }, shortAddress(share.sender)),
      h('dt', { text: '指定接收者' }), h('dd', { class: 'mono', title: share.recipient }, shortAddress(share.recipient)),
      h('dt', { text: '打开次数' }), h('dd', { text: opensLine(share) }),
      h('dt', { text: '有效期至' }), h('dd', { text: `${formatDateTime(share.expiresAt)}（${timeZoneLabel()}）` }),
    ),
    resume ? h('div', { class: 'callout' }, '你在这个标签页里打开过这份分享。重新连接钱包即可再次显示，不会再消耗打开次数。') : null,
    h('div', { class: 'actions' }, connectBtn),
    h('p', { class: 'note', text: '打开需要在钱包里签名两次，都不需要支付费用。Obelisk 不会索要你的私钥或助记词。' }),
  ));
}

async function afterConnect(address) {
  state.address = address;
  setWalletChip(address);
  const { share } = state;
  if (address.toLowerCase() !== share.recipient.toLowerCase()) return showNotRecipient(share, address);
  const resume = loadResume();
  const resuming = resume && resume.address.toLowerCase() === address.toLowerCase();
  if (!resuming && share.status !== 'active') return showStateRefusal(share);
  let key;
  try {
    key = (await api(`/v1/keys/${address}`)).body;
  } catch (error) {
    return showError(error.message, () => afterConnect(address));
  }
  if (!key.registered) {
    return refusal({
      tone: 'warn', iconName: 'key',
      title: '这个钱包还没有激活',
      text: '激活后才能解密发给你的内容。激活由 Obelisk 代付，不花费你的代币。',
      actions: [h('a', { class: 'btn primary', href: `/activate?next=${encodeURIComponent(location.pathname)}` }, icon('key'), '去激活')],
    });
  }
  state.registeredKey = key.pubKey.toLowerCase();
  showConfirm(resuming ? { resume } : {});
}

// --- share: opening --------------------------------------------------------

function resumeKey() {
  return `obelisk:open:${state.shareId}`;
}

/** The signed open request, kept for this tab so a reload does not spend another open. */
function loadResume() {
  try {
    const saved = JSON.parse(sessionStorage.getItem(resumeKey()) ?? 'null');
    if (saved && Number(saved.message?.deadline) > Date.now() / 1000 + 30) return saved;
  } catch { /* storage unavailable */ }
  return null;
}

function saveResume(value) {
  try {
    if (value) sessionStorage.setItem(resumeKey(), JSON.stringify(value));
    else sessionStorage.removeItem(resumeKey());
  } catch { /* storage unavailable */ }
}

function stepList(active, remaining, resume) {
  const steps = [
    ['解锁你的解密密钥', '签名一段固定文字，在浏览器里算出只属于你的解密密钥。不上链，不花费。'],
    ['记录这次打开', resume
      ? '这次打开之前已经记录在 BOT Chain 上，不会再消耗次数。'
      : remaining === null
        ? '签名后由 Obelisk 代付写入 BOT Chain，作为已读回执。这份分享不限打开次数。'
        : remaining === 0
          ? '签名后由 Obelisk 代付写入 BOT Chain，作为已读回执。这会用掉最后 1 次打开机会。'
          : `签名后由 Obelisk 代付写入 BOT Chain，作为已读回执。会用掉 1 次打开机会，之后还剩 ${remaining} 次。`],
    ['在本机解密并显示', '内容只在这个页面里解密，并印上你的地址作为水印。'],
  ];
  const isDone = (i) => i < active || (resume && i === 1);
  return h('ol', { class: 'steps' }, steps.map(([t, d], i) => h('li', { class: isDone(i) ? 'done' : i === active ? 'active' : '' },
    h('span', { class: 'n' }, isDone(i) ? icon('check') : String(i + 1)),
    h('div', {}, h('div', { class: 't', text: t }), h('div', { class: 'd', text: d })),
  )));
}

function showConfirm({ resume = null, notice = null, active = -1 }) {
  const { share } = state;
  const remaining = resume ? null : remainingAfterOpen(share);
  const openBtn = button(resume ? '签名并重新显示' : '签名并打开', () => openShare(resume), { primary: true, iconName: 'key' });
  show(h('section', { class: 'panel narrow' },
    h('div', { class: 'eyebrow' }, icon('lock'), `私密分享 · #${shareNumber(share.shareId)}`),
    h('h1', { text: resume ? '重新显示这份分享' : '打开这份分享' }),
    h('p', { class: 'lead', text: resume ? '你在这个标签页里已经打开过它。只需重新解锁解密密钥，不会再消耗打开次数。' : '已确认你是指定接收者。打开分三步，签名都在你的钱包里完成，都不需要支付费用。' }),
    stepList(active, remaining, Boolean(resume)),
    remaining === 0 ? h('div', { class: 'callout warn' }, h('strong', {}, '这是最后一次打开机会。'), '打开后请在本页阅读；关闭这个页面后，就无法再次打开了。') : null,
    notice ? h('div', { class: `callout ${notice.tone ?? ''}` }, notice.text) : null,
    h('div', { class: 'actions' }, openBtn),
  ));
  return openBtn;
}

async function openShare(resume) {
  const { share, wallet, address } = state;
  const provider = wallet.provider;
  let openBtn = showConfirm({ resume, active: 0 });
  busy(openBtn, '请在钱包里签名（1/2）…');

  if (!(await supportsX25519())) {
    return showError('这个浏览器不支持解密所需的 X25519 算法。请升级到最新版 Chrome、Edge、Safari 或 Firefox 后再打开。这次没有消耗打开次数。');
  }
  let encryptionKey;
  try {
    encryptionKey = await signEncryptionKey(provider, address);
  } catch (error) {
    const { message } = walletError(error);
    return showConfirm({ resume, notice: { tone: 'warn', text: message } });
  }
  if (state.registeredKey && encryptionKey.registeredKey !== state.registeredKey) {
    return showError('这个钱包算出的解密密钥和它在 BOT Chain 上登记的不一致，所以无法解密。请使用激活时用的同一个钱包（部分硬件钱包或智能合约钱包的签名每次都不同，无法用来解密）。这次没有消耗打开次数。');
  }

  let request = resume;
  if (!request) {
    openBtn = showConfirm({ active: 1 });
    busy(openBtn, '请在钱包里签名（2/2）…');
    try {
      const { nonce } = (await api(`/v1/nonces/ShareRegistry/${address}`)).body;
      const message = { recipient: address, shareId: share.shareId, nonce, deadline: String(Math.floor(Date.now() / 1000) + SIGNATURE_SECONDS) };
      const signature = await signTyped(provider, address, 'RecordOpen', 'ShareRegistry', message);
      request = { address, message, signature };
      saveResume(request);
    } catch (error) {
      if (error instanceof ServiceError) return showError(error.message, () => showConfirm({}));
      const { message } = walletError(error);
      return showConfirm({ notice: { tone: 'warn', text: message } });
    }
  }

  openBtn = showConfirm({ resume, active: resume ? 2 : 1 });
  busy(openBtn, resume ? '正在取回…' : '正在写入链上回执…');
  let opened;
  try {
    for (let attempt = 0; ; attempt += 1) {
      const { status, body } = await post(`/v1/shares/${share.shareId}/open`, { message: request.message, signature: request.signature });
      if (status === 200) { opened = body; break; }
      if (attempt >= 40) throw new ServiceError(504, 'pending', '链上回执迟迟没有确认。稍后刷新本页即可继续，不会再消耗打开次数。');
      busy(openBtn, '回执确认中，请稍候…');
      await sleep(3000);
    }
  } catch (error) {
    return handleOpenError(error);
  }

  openBtn = showConfirm({ resume, active: 2 });
  busy(openBtn, '正在解密…');
  try {
    const contentKey = await openKeyPackage(opened.keyPackage, encryptionKey, share.shareId);
    const snapshot = await decryptSnapshot(base64ToBytes(opened.ciphertext), contentKey, share.shareId);
    showReader(snapshot, opened);
  } catch {
    showError('内容无法用这个钱包的密钥解密。可能是发送方加密给了旧的密钥，请联系发送方重新分享。');
  }
}

async function handleOpenError(error) {
  if (!(error instanceof ServiceError)) return showError(String(error?.message ?? error));
  const refresh = async () => { state.share = (await api(`/v1/shares/${state.shareId}`)).body; };
  switch (error.code) {
    case 'not_recipient':
      return showNotRecipient(state.share, state.address);
    case 'share_revoked': case 'share_expired': case 'opens_exhausted':
      saveResume(null);
      await refresh().catch(() => undefined);
      return showStateRefusal(state.share);
    case 'deadline_passed': case 'stale_nonce':
      saveResume(null);
      await refresh().catch(() => undefined);
      return showConfirm({ notice: { tone: 'warn', text: '签名已过期或已被使用，请重新签名。' } });
    case 'content_unavailable':
      return refusal({ tone: 'dim', iconName: 'ban', title: '内容已不在 Obelisk 在线服务上', text: '这份分享的加密内容已被删除，无法再打开。' });
    case 'rate_limited':
      return showError('这个钱包短时间内操作太频繁，请稍等几分钟再试。', () => showConfirm({}));
    default:
      return showError(error.message, () => showConfirm({}));
  }
}

// --- share: reading --------------------------------------------------------

function richText(text, into) {
  into.setAttribute('translate', 'no');
  for (const part of splitRedactions(text)) {
    if (typeof part === 'string') into.append(part);
    else into.append(h('span', { class: 'redact', title: '发送方在分享前打码了这里' }, `[已打码：${part.redacted}]`));
  }
  return into;
}

function messageBody(text) {
  const frag = document.createDocumentFragment();
  for (const block of splitBlocks(text)) {
    if (block.kind === 'code') {
      frag.append(h('pre', {}, richText(block.text, h('code'))));
      continue;
    }
    const p = h('p');
    for (const part of splitInline(block.text)) {
      if (part.kind === 'code') p.append(richText(part.text, h('code')));
      else if (part.kind === 'bold') p.append(richText(part.text, h('strong')));
      else richText(part.text, p);
    }
    frag.append(p);
  }
  return frag;
}

function prettyInput(input) {
  try { return JSON.stringify(JSON.parse(input), null, 2); } catch { return input; }
}

function toolCall(call) {
  const { verb, detail } = summarizeToolCall(call);
  const body = h('div', { class: 'body' });
  if (call.input) {
    body.append(h('div', { class: 'label', text: '输入' }), richText(prettyInput(call.input), h('pre')));
    if (call.truncated?.input) body.append(h('div', { class: 'cut', text: `已截断：原文 ${call.truncated.input} 字` }));
  }
  if (call.result) {
    body.append(h('div', { class: 'label', text: '输出' }), richText(call.result, h('pre')));
    if (call.truncated?.result) body.append(h('div', { class: 'cut', text: `已截断：原文 ${call.truncated.result} 字` }));
  }
  return h('details', { class: 'tool' },
    h('summary', {}, h('span', { class: 'verb', text: verb }), richText(detail.split('\n')[0], h('span', { class: 'detail' }))),
    body,
  );
}

function redactionSummary(snapshot) {
  const total = snapshot.redactions?.length ?? 0;
  return total ? `${total} 处已打码` : '未打码';
}

function setWatermark(text) {
  const esc = text.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const line = (x, y) => `<text x="${x}" y="${y}" transform="rotate(-22 ${x} ${y})">${esc}</text>`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="360" height="170"><g font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="12.5" fill="rgba(255,255,255,0.075)">${line(8, 120)}${line(188, 205)}</g></svg>`;
  const mark = document.getElementById('watermark');
  mark.style.backgroundImage = `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
  mark.hidden = false;
}

function showReader(snapshot, opened) {
  const { share } = state;
  const number = shareNumber(share.shareId);
  setWatermark(`${shortAddress(opened.recipient)} · #${number} · ${formatShortDateTime(opened.openedAt)}`);
  document.title = `${snapshot.title || '会话分享'} · Obelisk`;
  document.getElementById('topbar-title').textContent = `分享 #${number}`;

  const remainingPill = opened.remainingOpens === null
    ? h('span', { class: 'pill dim' }, '不限打开次数')
    : opened.remainingOpens === 0
      ? h('span', { class: 'pill warn' }, '这是最后一次打开')
      : h('span', { class: 'pill dim' }, `还可打开 ${opened.remainingOpens} 次`);

  const timeline = h('div', { class: 'timeline' });
  for (const message of snapshot.messages) {
    const text = typeof message.text === 'string' ? message.text.trim() : '';
    if (text) {
      if (message.meta) {
        timeline.append(h('details', { class: 'msg meta' },
          h('summary', {}, `注入的上下文 · 第 ${message.n} 条`),
          messageBody(text),
        ));
      } else {
        const role = message.role === 'user' ? 'user' : 'assistant';
        timeline.append(h('div', { class: `msg ${role}` },
          h('div', { class: 'who' }, h('span', { text: speaker(message.role, snapshot.source?.provider) }), h('span', { class: 'n', text: `#${message.n}` })),
          messageBody(text),
        ));
      }
    }
    for (const call of message.toolCalls ?? []) timeline.append(toolCall(call));
  }

  const redactions = (snapshot.redactions ?? []).map((r) => `${redactionLabel(r.label)}（${r.messages.map((n) => (n === 0 ? '标题' : `第 ${n} 条`)).join('、')}）`);
  const range = snapshot.range ? `第 ${snapshot.range.from}–${snapshot.range.to} 条（共 ${snapshot.range.total} 条）` : '';

  show(
    h('section', { class: 'panel' },
      h('div', { class: 'reader-head' },
        h('div', {},
          h('h1', {}, richText(snapshot.title || '未命名会话', h('span'))),
          h('div', { class: 'sub' }, ...[`来自 ${shortAddress(share.sender)}`, `快照于 ${formatDateTime(snapshot.capturedAt)}`, range, redactionSummary(snapshot)]
            .filter(Boolean).flatMap((part, i) => [i ? ' · ' : null, h('span', { class: 'nowrap' }, part)])),
        ),
        h('div', { class: 'badges' }, h('span', { class: 'pill ok' }, icon('check'), '已验证：你是指定接收者'), remainingPill),
      ),
      h('div', { class: 'reader-meta' },
        h('span', {}, providerName(snapshot.source?.provider)),
        snapshot.source?.startedAt ? h('span', {}, `会话开始于 ${formatDateTime(snapshot.source.startedAt)}`) : null,
        redactions.length ? h('span', {}, `打码：${redactions.join('；')}`) : null,
        h('span', {}, `时间均为本地时间（${timeZoneLabel()}）`),
      ),
      timeline,
      h('div', { class: 'receipt' },
        h('span', {}, `已读回执已写入 ${chainName(state.chain?.chainId)} · 第 ${opened.openCount} 次打开 · ${formatDateTime(opened.openedAt)}`),
        chainLink(opened.receipt, '查看回执'),
      ),
    ),
    h('div', { class: 'note center reader-foot' },
      h('p', {}, `分享编号 #${number} · 内容只读，水印印有你的地址、分享编号和打开时间`),
      h('p', { class: 'mono share-id', title: '完整的分享编号，可以在区块浏览器里核对' }, share.shareId),
    ),
  );
}

// --- activation: one real BOT Chain transaction from the visitor's wallet ---

const ACTIVATE_STEPS = [
  ['连接钱包', '支持 MetaMask、OKX Wallet、Rabby 等 EVM 钱包。只读取地址。'],
  ['切换到 BOT Chain 主网', '钱包切换到 Chain ID 677；钱包里没有这个网络时会请你添加。'],
  ['解锁解密密钥', '签名一段固定文字，在浏览器里算出只属于你的解密密钥。不上链、不花费。'],
  ['签名并发送主网交易', 'EIP-712 签名授权登记公钥，再由你的钱包把交易发到 KeyRegistry 合约。'],
];

function activateSteps(active) {
  return h('ol', { class: 'steps act-steps' }, ACTIVATE_STEPS.map(([t, d], i) => h('li', { class: i < active ? 'done' : i === active ? 'active' : '' },
    h('span', { class: 'n' }, i < active ? icon('check') : String(i + 1)),
    h('div', {}, h('div', { class: 't', text: t }), h('div', { class: 'd', text: d })),
  )));
}

function contractCard() {
  const chain = state.chain;
  const address = chain?.contracts?.KeyRegistry;
  const explorer = chain?.explorerUrl;
  return h('aside', { class: 'act-side' },
    h('div', { class: 'eyebrow' }, icon('key'), '这笔交易做什么'),
    h('dl', { class: 'facts act-facts' },
      h('dt', {}, '网络'), h('dd', {}, `${chainName(chain?.chainId)} · Chain ID ${chain?.chainId ?? '—'}`),
      h('dt', {}, '合约'), h('dd', {}, address && explorer
        ? h('a', { class: 'mono', href: `${explorer}/address/${address}`, target: '_blank', rel: 'noopener noreferrer', translate: 'no' }, `KeyRegistry ${shortAddress(address)} ↗`)
        : h('span', { class: 'mono', translate: 'no' }, `KeyRegistry ${shortAddress(address ?? '')}`)),
      h('dt', {}, '方法'), h('dd', { class: 'mono', translate: 'no' }, 'registerKeyBySig(user, pubKey, deadline, signature)'),
      h('dt', {}, '发起方'), h('dd', {}, '你的钱包（自付少量 BOT 手续费）；没有 BOT 时可选 Obelisk 代付'),
    ),
    h('p', { class: 'note', text: '登记后，别人可以把 session 片段加密分享给你；分享规则、打开回执和撤回都记录在 BOT Chain 上。' }),
  );
}

async function waitForReceipt(hash, onTick) {
  for (let i = 0; i < 60; i += 1) {
    try {
      const { body } = await api(`/v1/tx/${hash}`);
      if (body.status === 'confirmed' || body.status === 'reverted') return body;
    } catch (error) {
      if (!(error instanceof ServiceError) || error.code !== 'unknown_transaction') throw error;
    }
    onTick?.(i);
    await sleep(2500);
  }
  return { status: 'pending', txHash: hash, explorerUrl: state.chain?.explorerUrl ? `${state.chain.explorerUrl}/tx/${hash}` : null };
}

async function bootActivate() {
  document.title = '链上体验 · Obelisk';
  const titleNode = document.getElementById('topbar-title');
  if (titleNode) titleNode.textContent = '链上体验';
  document.body.classList.add('activate-page');
  const next = new URLSearchParams(location.search).get('next');
  const nextPath = next && /^\/s\/0x[0-9a-fA-F]{64}$/.test(next) ? next : null;
  const wallet = await import('/site/wallet.js');

  let stage = 0;
  const page = (active, actions, notice, extra = null) => {
    stage = active;
    show(h('div', { class: 'act-grid' },
      h('section', { class: 'panel act-main' },
        h('div', { class: 'eyebrow act-eyebrow' }, h('span', { class: 'live-dot' }), `${chainName(state.chain?.chainId)} · Chain ID ${state.chain?.chainId ?? ''}`),
        h('h1', { class: 'act-title', text: '用你的钱包，完成一次 BOT Chain 主网交互' }),
        h('p', { class: 'lead', text: '激活 Obelisk：在 BOT Chain 上登记一把只用于解密的公钥。签名在你的钱包里完成，交易由你的钱包直接发出，可在区块浏览器逐笔核对。' }),
        activateSteps(active),
        extra,
        notice ? h('div', { class: `callout ${notice.tone ?? ''}` }, notice.text) : null,
        h('div', { class: 'actions' }, actions),
        h('p', { class: 'note', text: 'Obelisk 不会索要你的私钥或助记词。每一次签名和交易都需要你在钱包里确认。' }),
      ),
      contractCard(),
    ));
  };

  const failNotice = (error) => {
    if (error instanceof ServiceError) return serviceNotice(error);
    const { rejected, message } = wallet.walletError(error);
    return { tone: rejected ? '' : 'warn', text: message };
  };

  const start = (notice) => {
    const s = wallet.walletState();
    if (s.address) return afterConnect(notice);
    const btn = button('连接钱包', async () => {
      busy(btn, '请在钱包里确认连接…');
      try {
        const connected = await wallet.connectWallet();
        if (!connected) return start();
        afterConnect();
      } catch (error) { start(failNotice(error)); }
    }, { primary: true, iconName: 'wallet' });
    page(0, [btn], notice);
  };

  const afterConnect = (notice) => {
    const s = wallet.walletState();
    state.address = s.address;
    if (s.onSiteChain) return unlock(notice);
    const btn = button(`切换到 ${chainName(state.chain.chainId)}（${state.chain.chainId}）`, async () => {
      busy(btn, '请在钱包里确认切换网络…');
      try { await wallet.switchToSiteChain(); unlock(); } catch (error) { afterConnect(failNotice(error)); }
    }, { primary: true, iconName: 'wallet' });
    page(1, [btn], notice ?? { tone: 'warn', text: `钱包当前在 Chain ID ${s.chainId}。Obelisk 主网合约部署在 ${chainName(state.chain.chainId)}（Chain ID ${state.chain.chainId}）。` },
      h('p', { class: 'act-who' }, '已连接 ', h('span', { class: 'mono', translate: 'no' }, s.address)));
  };

  const unlock = async (notice) => {
    const address = wallet.walletState().address;
    let key;
    try { key = (await api(`/v1/keys/${address}`)).body; } catch (error) { return page(2, [button('重试', () => unlock(), { primary: true })], failNotice(error)); }
    const status = key.registered
      ? h('div', { class: 'act-status ok' }, icon('check'), h('span', {}, `这个钱包已在主网激活（公钥版本 v${key.version}）。你仍可以再发一笔交易，把链上公钥记录更新到 v${key.version + 1}。`))
      : null;
    const btn = button(key.registered ? '解锁密钥并更新链上记录' : '解锁解密密钥', async () => {
      busy(btn, '请在钱包里签名（不上链）…');
      try {
        if (!(await supportsX25519())) return page(2, [button('重试', () => unlock(), { primary: true })], { tone: 'danger', text: '这个浏览器不支持所需的 X25519 算法，请升级到最新版 Chrome、Edge、Safari 或 Firefox。' });
        const encryptionKey = await signEncryptionKey(wallet.walletState().provider, address);
        submit(address, encryptionKey);
      } catch (error) { unlock(failNotice(error)); }
    }, { primary: true, iconName: 'key' });
    const actions = [btn];
    if (key.registered) actions.push(h('a', { class: 'btn', href: key.explorerUrl ?? '#', target: '_blank', rel: 'noopener noreferrer' }, icon('external'), '查看我的地址'));
    page(2, actions, notice, h('div', {}, h('p', { class: 'act-who' }, '已连接 ', h('span', { class: 'mono', translate: 'no' }, address), h('span', { class: 'pill ok' }, h('span', { class: 'dot' }), `Chain ID ${state.chain.chainId}`)), status));
  };

  const signRegister = async (address, encryptionKey) => {
    const { nonce } = (await api(`/v1/keys/${address}`)).body;
    const message = { user: address, pubKey: encryptionKey.registeredKey, nonce, deadline: String(Math.floor(Date.now() / 1000) + SIGNATURE_SECONDS) };
    await wallet.switchToSiteChain();
    const signature = await wallet.walletState().provider.request({ method: 'eth_signTypedData_v4', params: [address, JSON.stringify(typedData('RegisterKey', 'KeyRegistry', state.chain, message))] });
    return { action: 'RegisterKey', message, signature };
  };

  const submit = (address, encryptionKey, notice) => {
    const symbol = state.chain.nativeCurrency?.symbol ?? 'BOT';
    const balance = wallet.walletState().balance;
    const direct = button('签名，并用我的钱包发送', async () => {
      busy(direct, '请在钱包里签名（1/2）…');
      try {
        const signed = await signRegister(address, encryptionKey);
        busy(direct, '正在检查签名并估算手续费…');
        const { body: call } = await post('/v1/direct/prepare', signed);
        if (!call.enoughBalance) {
          return submit(address, encryptionKey, { tone: 'warn', text: `钱包余额 ${call.balance} ${symbol}，不足以支付约 ${call.estimatedFee} ${symbol} 的手续费。可以先充值 BOT，或选择由 Obelisk 代付。` });
        }
        busy(direct, '请在钱包里确认发送交易（2/2）…');
        const hash = await wallet.walletState().provider.request({ method: 'eth_sendTransaction', params: [{ from: address, to: call.to, data: call.data, value: '0x0', gas: call.gas }] });
        pending(hash, 'wallet');
      } catch (error) { submit(address, encryptionKey, failNotice(error)); }
    }, { primary: true, iconName: 'wallet' });
    const relay = button(`由 Obelisk 代付（不需要 ${symbol}）`, async () => {
      busy(relay, '请在钱包里签名…');
      try {
        const signed = await signRegister(address, encryptionKey);
        busy(relay, '正在登记到 BOT Chain…');
        const { body } = await post('/v1/relay', signed);
        if (body.status === 'confirmed') return done(body, 'relay');
        pending(body.txHash, 'relay');
      } catch (error) { submit(address, encryptionKey, failNotice(error)); }
    }, { iconName: 'check' });
    page(3, [direct, relay], notice, h('div', { class: 'act-choice' },
      h('p', {}, h('strong', {}, '用我的钱包发送：'), `交易的发起方是你的地址，手续费约 0.004 ${symbol}${balance === null ? '' : `（当前余额 ${balance} ${symbol}）`}。`),
      h('p', {}, h('strong', {}, '由 Obelisk 代付：'), '你只签名，服务的代付钱包提交交易并支付手续费；合约仍以你的签名为准。'),
    ));
  };

  const pending = async (hash, mode) => {
    const explorer = state.chain.explorerUrl ? `${state.chain.explorerUrl}/tx/${hash}` : null;
    show(h('section', { class: 'panel narrow center act-pending' },
      h('div', { class: 'spinner' }),
      h('h1', { text: '交易已发出，等待 BOT Chain 确认…' }),
      h('p', { class: 'mono act-hash', translate: 'no' }, hash),
      explorer ? h('p', {}, h('a', { href: explorer, target: '_blank', rel: 'noopener noreferrer' }, '在区块浏览器查看 ↗')) : null,
    ));
    try {
      const result = await waitForReceipt(hash);
      if (result.status === 'reverted') return showError('交易已上链但执行失败（reverted）。', () => start());
      done(result, mode);
    } catch (error) { showError(error.message, () => start()); }
  };

  const done = async (record, mode) => {
    const address = wallet.walletState().address ?? state.address;
    let indexed = null;
    if (mode === 'wallet' && record.status === 'confirmed') {
      indexed = await post('/v1/direct', { txHash: record.txHash }).then((r) => r.body).catch(() => null);
    }
    const key = await api(`/v1/keys/${address}`).then((r) => r.body).catch(() => null);
    const copy = button('复制交易哈希', async () => {
      try { await navigator.clipboard.writeText(record.txHash); copy.replaceChildren(icon('check'), '已复制'); } catch { /* clipboard blocked */ }
    }, { iconName: 'copy' });
    show(h('section', { class: 'panel narrow denied act-done' },
      h('div', { class: 'icon ok' }, icon('check')),
      h('h1', { class: 'center', text: record.status === 'confirmed' ? '交易已在 BOT Chain 主网确认' : '交易已发出' }),
      h('p', { class: 'fg2 center', text: mode === 'wallet' ? '这笔交易由你的钱包签名并发出。任何人都可以在区块浏览器核对。' : '这笔交易由你签名授权、Obelisk 代付手续费提交。' }),
      h('dl', { class: 'facts' },
        h('dt', {}, '交易哈希'), h('dd', { class: 'mono', translate: 'no' }, record.txHash),
        h('dt', {}, '发起钱包'), h('dd', { class: 'mono', translate: 'no' }, mode === 'wallet' ? address : `${state.chain.relayer ?? '代付钱包'}（代付）`),
        h('dt', {}, '签名钱包'), h('dd', { class: 'mono', translate: 'no' }, address),
        h('dt', {}, '合约 · 方法'), h('dd', { class: 'mono', translate: 'no' }, 'KeyRegistry · registerKeyBySig'),
        record.blockNumber ? h('dt', {}, '区块') : null, record.blockNumber ? h('dd', { class: 'mono', translate: 'no' }, `#${record.blockNumber}`) : null,
        key?.registered ? h('dt', {}, '链上公钥版本') : null, key?.registered ? h('dd', {}, `v${key.version}`) : null,
      ),
      indexed ? h('p', { class: 'note center', text: '已收录到首页「用户钱包发起的主网交易」列表。' }) : null,
      h('div', { class: 'actions' },
        record.explorerUrl ? h('a', { class: 'btn primary', href: record.explorerUrl, target: '_blank', rel: 'noopener noreferrer' }, icon('external'), '在区块浏览器查看') : null,
        copy,
        nextPath ? h('a', { class: 'btn', href: nextPath }, '回到分享') : h('a', { class: 'btn', href: '/market' }, '去 Skill 市场'),
      ),
    ));
  };

  try {
    state.chain = await wallet.siteChain();
  } catch (error) {
    return showError(error.message, () => location.reload());
  }
  window.addEventListener('obelisk:wallet', (event) => {
    const { address, onSiteChain } = event.detail;
    if (!address && state.address) { state.address = null; start(); return; }
    if (address && address !== state.address && stage <= 2) { afterConnect(); return; }
    if (stage === 1 && onSiteChain) unlock();
  });
  start();
}

// --- boot ------------------------------------------------------------------

async function bootShare() {
  const match = /^\/s\/(0x[0-9a-fA-F]{64})\/?$/.exec(location.pathname);
  if (!match) {
    return refusal({ tone: 'dim', iconName: 'search', title: '找不到这份分享', text: '链接不完整。请向发送方要一份完整的分享链接。' });
  }
  state.shareId = match[1].toLowerCase();
  document.getElementById('topbar-title').textContent = `分享 #${shareNumber(state.shareId)}`;
  try {
    const [chain, share] = await Promise.all([api('/v1/chain'), api(`/v1/shares/${state.shareId}`)]);
    state.chain = chain.body;
    state.share = share.body;
  } catch (error) {
    if (error.code === 'unknown_share') {
      return refusal({ tone: 'dim', iconName: 'search', title: '找不到这份分享', text: '链接可能不完整，或者这份分享不在这个网络上。请向发送方确认链接。' });
    }
    return showError(error.message, () => location.reload());
  }
  if (state.share.status !== 'active' && !loadResume()) return showStateRefusal(state.share);
  showIntro();
}

if (location.pathname === '/activate' || location.pathname === '/activate/') bootActivate();
else bootShare();
