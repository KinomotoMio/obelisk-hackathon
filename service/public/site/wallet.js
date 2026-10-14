// SPDX-License-Identifier: AGPL-3.0-only
// Shared browser-wallet connection for every public page: discovery
// (EIP-6963, else window.ethereum), connect, switch to this site's BOT Chain
// network, and the "Connect wallet" control in the top bar. Pages listen for
// the `obelisk:wallet` event or call `walletState()`; the reader and the
// landing page drive the same connection, so it never diverges.
//
// The wallet does every signature. Nothing here asks for a private key, and
// nothing is built from HTML strings.

const LAST_WALLET = 'obelisk.wallet.last';
const state = { chain: null, provider: null, info: null, address: null, chainId: null, balance: null };
let chainRequest = null;
let listening = null;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'class') el.className = value;
    else if (key === 'text') el.textContent = value;
    else if (key.startsWith('on')) el.addEventListener(key.slice(2), value);
    else el.setAttribute(key, value === true ? '' : value);
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    el.append(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return el;
}

const PATHS = {
  wallet: ['M3 7h16a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z', 'M3 7l12-4v4', 'M17 13.5h.01'],
  copy: ['M9 9h11v11H9z', 'M5 15H4V4h11v1'],
  check: ['M20 6L9 17l-5-5'],
  external: ['M14 4h6v6', 'M10 14L20 4', 'M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5'],
  close: ['M6 6l12 12', 'M18 6L6 18'],
  bolt: ['M13 2L4 14h7l-1 8 9-12h-7z'],
  swap: ['M7 7h13l-3-3', 'M17 17H4l3 3'],
  logout: ['M15 4h4v16h-4', 'M10 8l-4 4 4 4', 'M6 12h11'],
};

export function svgIcon(name, cls = 'wl-ic') {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  for (const [k, v] of Object.entries({ viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.8', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true', class: cls })) svg.setAttribute(k, v);
  for (const d of PATHS[name]) {
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', d);
    svg.append(path);
  }
  return svg;
}

export const shortAddress = (address) => (address ? `${address.slice(0, 6)}…${address.slice(-4)}` : '');

/** The network this site serves, from GET /v1/chain (677 on the mainnet site). */
export function siteChain() {
  chainRequest ??= fetch('/v1/chain', { headers: { accept: 'application/json' } })
    .then((response) => (response.ok ? response.json() : Promise.reject(new Error(`HTTP ${response.status}`))))
    .then((chain) => { state.chain = chain; return chain; })
    .catch((error) => { chainRequest = null; throw error; });
  return chainRequest;
}

export function walletState() {
  return { ...state, onSiteChain: Boolean(state.chain && state.chainId === state.chain.chainId) };
}

function emit() {
  const detail = walletState();
  window.dispatchEvent(new CustomEvent('obelisk:wallet', { detail }));
  renderControl();
}

/** Browser wallets announced through EIP-6963; else the injected window.ethereum. */
export async function discoverWallets() {
  const found = new Map();
  const onAnnounce = (event) => {
    const { info, provider } = event.detail ?? {};
    if (info?.uuid && provider) found.set(info.uuid, { name: info.name, icon: info.icon, rdns: info.rdns ?? info.name, provider });
  };
  window.addEventListener('eip6963:announceProvider', onAnnounce);
  window.dispatchEvent(new Event('eip6963:requestProvider'));
  await sleep(350);
  window.removeEventListener('eip6963:announceProvider', onAnnounce);
  const wallets = [...found.values()];
  if (wallets.length === 0 && window.ethereum) wallets.push({ name: '浏览器钱包', icon: null, rdns: 'injected', provider: window.ethereum });
  return wallets;
}

export function walletError(error) {
  const code = error?.code;
  if (code === 4001 || code === 'ACTION_REJECTED') return { rejected: true, message: '你在钱包里取消了这次请求，什么都没有发生。' };
  if (code === -32002) return { message: '钱包里已经有一个待处理的请求，请先在钱包弹窗里完成或取消它。' };
  return { message: `钱包返回了错误：${error?.message ?? String(error)}` };
}

async function readBalance() {
  if (!state.provider || !state.address) return;
  try {
    const wei = BigInt(await state.provider.request({ method: 'eth_getBalance', params: [state.address, 'latest'] }));
    state.balance = Number(wei / 10n ** 12n) / 1e6;
  } catch { state.balance = null; }
}

function listen(provider) {
  if (listening === provider || !provider.on) return;
  listening = provider;
  provider.on('accountsChanged', async (accounts) => {
    state.address = accounts?.[0] ?? null;
    if (!state.address) forget();
    await readBalance();
    emit();
  });
  provider.on('chainChanged', async (chainId) => {
    state.chainId = parseInt(chainId, 16);
    await readBalance();
    emit();
  });
}

function forget() {
  try { localStorage.removeItem(LAST_WALLET); } catch { /* storage is optional */ }
}

async function adopt(wallet, accounts) {
  state.provider = wallet.provider;
  state.info = { name: wallet.name, icon: wallet.icon, rdns: wallet.rdns };
  state.address = accounts[0];
  state.chainId = parseInt(await wallet.provider.request({ method: 'eth_chainId' }), 16);
  listen(wallet.provider);
  try { localStorage.setItem(LAST_WALLET, wallet.rdns); } catch { /* storage is optional */ }
  await readBalance();
  emit();
  return walletState();
}

/** Ask one wallet for accounts (shows the wallet's own prompt). */
export async function connectWith(wallet) {
  await siteChain().catch(() => null);
  const accounts = await wallet.provider.request({ method: 'eth_requestAccounts' });
  if (!accounts?.[0]) throw new Error('钱包没有返回任何地址');
  return adopt(wallet, accounts);
}

/** Connect, letting the person choose when several wallets are installed. Resolves null if they close the chooser. */
export async function connectWallet() {
  if (state.address) return walletState();
  const wallets = await discoverWallets();
  const wallet = wallets.length === 1 ? wallets[0] : await chooseWallet(wallets);
  if (!wallet) return null;
  return connectWith(wallet);
}

/** Switch the wallet to this site's network, adding BOT Chain to the wallet first if it does not know it. */
export async function switchToSiteChain() {
  const chain = await siteChain();
  if (!state.provider) throw new Error('请先连接钱包');
  const want = `0x${chain.chainId.toString(16)}`;
  const current = parseInt(await state.provider.request({ method: 'eth_chainId' }), 16);
  if (current === chain.chainId) { state.chainId = current; return; }
  try {
    await state.provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: want }] });
  } catch (error) {
    if (error?.code !== 4902 && error?.data?.originalError?.code !== 4902 && !/unrecognized|not been added|unknown chain|not added/i.test(error?.message ?? '')) throw error;
    await state.provider.request({
      method: 'wallet_addEthereumChain',
      params: [{
        chainId: want,
        chainName: chain.chainId === 677 ? 'BOT Chain Mainnet' : chain.name,
        nativeCurrency: chain.nativeCurrency,
        rpcUrls: [chain.rpcUrl],
        ...(chain.explorerUrl ? { blockExplorerUrls: [chain.explorerUrl] } : {}),
      }],
    });
  }
  state.chainId = parseInt(await state.provider.request({ method: 'eth_chainId' }), 16);
  await readBalance();
  emit();
}

export async function disconnectWallet() {
  try { await state.provider?.request({ method: 'wallet_revokePermissions', params: [{ eth_accounts: {} }] }); } catch { /* not every wallet supports it */ }
  forget();
  Object.assign(state, { provider: null, info: null, address: null, chainId: null, balance: null });
  emit();
}

/** Reconnect silently to the wallet used last time, without any prompt. */
async function restore() {
  let last;
  try { last = localStorage.getItem(LAST_WALLET); } catch { return; }
  if (!last) return;
  const wallet = (await discoverWallets()).find((candidate) => candidate.rdns === last);
  if (!wallet) return;
  const accounts = await wallet.provider.request({ method: 'eth_accounts' }).catch(() => []);
  if (accounts?.[0]) await adopt(wallet, accounts);
}

// --- chooser ---------------------------------------------------------------

const INSTALL = [
  ['MetaMask', 'https://metamask.io/download/'],
  ['OKX Wallet', 'https://web3.okx.com/download'],
  ['Rabby', 'https://rabby.io/'],
];

function walletImage(wallet) {
  if (typeof wallet.icon === 'string' && /^data:image\/(png|svg\+xml|webp|jpeg);/.test(wallet.icon)) {
    return h('img', { src: wallet.icon, alt: '', width: '28', height: '28' });
  }
  return h('span', { class: 'wl-fallback' }, svgIcon('wallet'));
}

function chooseWallet(wallets) {
  return new Promise((resolve) => {
    const close = (value) => { dialog.close(); dialog.remove(); resolve(value); };
    const body = wallets.length === 0
      ? [
          h('p', { class: 'wl-sub', text: '没有检测到浏览器钱包。安装任意 EVM 钱包后刷新本页；在手机上，请用钱包 App 内置的浏览器打开。' }),
          h('div', { class: 'wl-list' }, INSTALL.map(([name, href]) => h('a', { class: 'wl-option', href, target: '_blank', rel: 'noopener noreferrer' },
            h('span', { class: 'wl-fallback' }, svgIcon('wallet')), h('span', { class: 'wl-name', text: `安装 ${name}` }), svgIcon('external')))),
        ]
      : [
          h('p', { class: 'wl-sub', text: '选择一个 EVM 钱包。连接只读取地址，之后的每次签名和交易都会在钱包里请你确认。' }),
          h('div', { class: 'wl-list' }, wallets.map((wallet) => h('button', { class: 'wl-option', type: 'button', onclick: () => close(wallet) },
            walletImage(wallet), h('span', { class: 'wl-name', text: wallet.name }), h('span', { class: 'wl-tag', text: '已检测到' })))),
        ];
    const dialog = h('dialog', { class: 'wl-dialog', 'aria-labelledby': 'wl-title' },
      h('div', { class: 'wl-head' },
        h('h2', { id: 'wl-title', text: '连接钱包' }),
        h('button', { class: 'wl-x', type: 'button', 'aria-label': '关闭', onclick: () => close(null) }, svgIcon('close'))),
      ...body,
      h('p', { class: 'wl-foot', text: '支持 MetaMask、OKX Wallet、Rabby 等 EVM 钱包 · BOT Chain 主网 Chain ID 677' }),
    );
    dialog.addEventListener('cancel', (event) => { event.preventDefault(); close(null); });
    dialog.addEventListener('click', (event) => { if (event.target === dialog) close(null); });
    document.body.append(dialog);
    dialog.showModal();
  });
}

// --- top bar control -------------------------------------------------------

let control = null;
let popover = null;

function networkLabel() {
  if (!state.chain) return '';
  return state.chain.chainId === 677 ? 'BOT Chain 主网' : 'BOT Chain 测试网';
}

function renderPopover() {
  if (!popover) return;
  const s = walletState();
  const explorer = state.chain?.explorerUrl;
  const copy = h('button', { class: 'wl-mini', type: 'button', onclick: async () => {
    try { await navigator.clipboard.writeText(state.address); copy.replaceChildren(svgIcon('check'), '已复制'); } catch { /* clipboard blocked */ }
  } }, svgIcon('copy'), '复制');
  popover.replaceChildren(
    h('div', { class: 'wl-pop-head' },
      state.info ? walletImage(state.info) : null,
      h('div', {},
        h('div', { class: 'wl-pop-addr', translate: 'no', title: state.address, text: shortAddress(state.address) }),
        h('div', { class: 'wl-pop-name', text: state.info?.name ?? '' })),
      copy),
    h('div', { class: `wl-net ${s.onSiteChain ? 'ok' : 'warn'}` },
      h('span', { class: 'wl-dot' }),
      h('span', {}, s.onSiteChain ? `已连接 ${networkLabel()} · Chain ID ${state.chainId}` : `钱包当前网络 Chain ID ${state.chainId ?? '?'}，不是 ${networkLabel()}`)),
    s.onSiteChain
      ? h('div', { class: 'wl-bal' }, h('span', { text: '余额' }), h('strong', { translate: 'no', text: state.balance === null ? '—' : `${state.balance} ${state.chain.nativeCurrency.symbol}` }))
      : h('button', { class: 'wl-btn primary', type: 'button', onclick: async () => { try { await switchToSiteChain(); } catch (error) { alert(walletError(error).message); } } },
        svgIcon('swap'), `切换到 ${networkLabel()}（${state.chain?.chainId ?? ''}）`),
    h('a', { class: 'wl-btn', href: '/activate' }, svgIcon('bolt'), '用钱包完成一次链上交互 →'),
    explorer ? h('a', { class: 'wl-link', href: `${explorer}/address/${state.address}`, target: '_blank', rel: 'noopener noreferrer' }, '在区块浏览器查看我的地址 ↗') : null,
    h('button', { class: 'wl-link', type: 'button', onclick: () => { togglePopover(false); disconnectWallet(); } }, '断开连接'),
  );
}

function togglePopover(open) {
  if (!popover) return;
  popover.hidden = !open;
  control?.setAttribute('aria-expanded', String(open));
  if (open) renderPopover();
}

function renderControl() {
  if (!control) return;
  const s = walletState();
  control.classList.toggle('connected', Boolean(state.address));
  control.classList.toggle('wrong', Boolean(state.address && state.chain && !s.onSiteChain));
  if (!state.address) {
    control.replaceChildren(svgIcon('wallet'), h('span', { text: '连接钱包' }));
    control.title = '连接 MetaMask、OKX Wallet 等 EVM 钱包';
  } else {
    control.replaceChildren(h('span', { class: 'wl-dot' }), h('span', { translate: 'no', text: shortAddress(state.address) }));
    control.title = s.onSiteChain ? `${networkLabel()} · ${state.address}` : '钱包不在本站网络，点击切换';
  }
  if (popover && !popover.hidden) renderPopover();
}

/** Put the wallet control in the top bar; called by navigation.js on every page. */
export function mountWalletControl(header) {
  if (control || !header) return;
  const wrap = h('div', { class: 'wl-wrap' });
  control = h('button', { class: 'wl-control', type: 'button', 'aria-haspopup': 'true', 'aria-expanded': 'false', onclick: async () => {
    if (state.address) return togglePopover(popover.hidden);
    try {
      const connected = await connectWallet();
      if (connected && !connected.onSiteChain) togglePopover(true);
    } catch (error) {
      const { rejected, message } = walletError(error);
      if (!rejected) alert(message);
    }
  } });
  popover = h('div', { class: 'wl-pop', hidden: true, role: 'dialog', 'aria-label': '钱包' });
  wrap.append(control, popover);
  document.addEventListener('click', (event) => { if (!wrap.contains(event.target)) togglePopover(false); });
  document.addEventListener('keydown', (event) => { if (event.key === 'Escape') togglePopover(false); });
  const language = header.querySelector('.site-language');
  if (language) language.before(wrap); else header.append(wrap);
  renderControl();
  siteChain().then(renderControl).catch(() => undefined);
  restore().catch(() => undefined);
}
