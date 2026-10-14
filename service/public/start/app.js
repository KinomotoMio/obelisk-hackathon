// Landing page (/): live counters, contract addresses and transactions read
// from this service, and the wallet buttons of the verification checklist.
import { connectWallet, shortAddress, siteChain, switchToSiteChain, walletError, walletState } from '/site/wallet.js';

// Mainnet business transactions signed by user wallets and submitted by the fee relay (docs/submission/mainnet.md).
const SIGNED_MAINNET = [
  ['0x544aa99ae13fc4d8a7ef29978ccbd6b55de8dc85272cbf5b9d264d5efaef1161', '激活钱包（登记加密公钥）', 'key'],
  ['0xc75eb72fed195d9f5887448ea62688bec76e31b7f24509f3e7d5f9d34c4af8fc', '铸造 Skill #1', 'mint'],
  ['0xc3ccc4a0aa3ee1bd2440a107be152c5dc3506c1776099bdbf3fbc6e4dc4a6787', '上报真实使用 · Skill #1', 'usage'],
  ['0xe92de504d9965830ca328d86ad2108010142e1712f07b830524525aa57ee1b58', '上报真实使用 · Skill #2', null],
  ['0xcbe60f984051fdbc230985198d12f514f7f7f0c3ea703637c2d304a04e6bbb52', '上报真实使用 · Skill #1', null],
  ['0x5dd68af18304c09a8eacda4fcc27c44345420f4371bc26544cb62b42a3b10e01', '上报真实使用 · Skill #3', null],
  ['0x152c6bc8b9933c930bde2e45782f52a32f56b5f122399902090abbc9cc3c178f', '上报真实使用 · Skill #4', null],
];

const ACTION_LABELS = {
  RegisterKey: '登记加密公钥', CreateShare: '创建私密分享', RevokeShare: '撤回分享', MintSkill: '铸造 Skill',
  PublishVersion: '发布新版本', ReportUsage: '上报真实使用', buyBySig: '购买 Skill', useBySig: '取用授权', listBySig: '上架 Skill',
};

function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else node.setAttribute(key, value === true ? '' : value);
  }
  for (const child of children.flat()) if (child !== null && child !== undefined && child !== false) node.append(child);
  return node;
}

const json = (path) => fetch(path, { headers: { accept: 'application/json' } }).then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))));
const fmt = (value) => (value === null || value === undefined ? '—' : Number(value).toLocaleString('en-US'));
const safeExplorer = (chain) => { try { const url = new URL(chain.explorerUrl); return url.protocol === 'https:' ? url : null; } catch { return null; } };
const when = (iso) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 16).replace('T', ' ') + ' UTC'; };

function txRow(href, badge, relay, title, sub, meta) {
  return el('a', { class: 'lp-tx', href, target: '_blank', rel: 'noopener noreferrer' },
    el('span', { class: `lp-tx-badge${relay ? ' relay' : ''}`, text: badge }),
    el('span', { class: 'lp-tx-main' }, el('b', { text: title }), el('span', { translate: 'no', text: sub })),
    el('span', { class: 'lp-tx-meta', translate: 'no', text: meta }));
}

async function loadStats() {
  try {
    const stats = await json('/v1/stats');
    for (const node of document.querySelectorAll('[data-stat]')) node.textContent = fmt(stats[node.dataset.stat]);
    document.getElementById('hero-block').textContent = `#${fmt(stats.blockNumber)}`;
  } catch { /* counters stay as dashes */ }
}

async function loadChain() {
  const chain = await siteChain();
  const explorer = safeExplorer(chain);
  const main = chain.chainId === 677;
  document.getElementById('hero-network').textContent = main ? 'BOT Chain 主网 · Chain ID 677' : 'BOT Chain 测试网 · Chain ID 968';
  const contracts = { ...chain.contracts, SkillMarket: chain.market };
  const list = document.getElementById('verify-contracts');
  for (const [name, address] of Object.entries(contracts)) {
    if (!/^0x[0-9a-fA-F]{40}$/.test(address ?? '')) continue;
    const href = explorer ? new URL(`/address/${address}`, explorer).href : '#';
    const card = document.querySelector(`[data-contract="${name}"] [data-address]`);
    if (card) { card.textContent = `${address} ↗`; card.href = href; }
    list.append(el('a', { href, target: '_blank', rel: 'noopener noreferrer' },
      el('span', { text: name }), el('span', { translate: 'no', text: address }), el('span', { text: '↗' })));
  }
  if (!main || !explorer) {
    document.getElementById('signed-txs').append(el('p', { class: 'lp-empty', text: '当前是测试网。主网交易请在 BOT Chain 主网站点查看。' }));
    return { chain, explorer, main };
  }
  return { chain, explorer, main };
}

async function loadSigned({ explorer, main }) {
  if (!main || !explorer) return;
  const box = document.getElementById('signed-txs');
  try {
    const { transactions } = await json(`/v1/txs?hashes=${SIGNED_MAINNET.map(([hash]) => hash).join(',')}`);
    const byHash = new Map(transactions.map((tx) => [tx.hash.toLowerCase(), tx]));
    for (const [hash, label, receipt] of SIGNED_MAINNET) {
      const tx = byHash.get(hash);
      if (!tx || tx.status !== 'confirmed') continue;
      if (receipt) for (const node of document.querySelectorAll(`[data-receipt="${receipt}"]`)) node.textContent = `#${fmt(tx.blockNumber)}`;
      box.append(txRow(new URL(`/tx/${hash}`, explorer).href, '用户签名', true, label, `${tx.contract ?? ''} · ${shortAddress(hash)}`, `#${fmt(tx.blockNumber)} · ${when(tx.timestamp)}`));
    }
  } catch {
    box.append(el('p', { class: 'lp-empty', text: '交易读取失败，请稍后刷新。' }));
  }
}

async function loadWalletTxs({ explorer }) {
  const box = document.getElementById('wallet-txs');
  try {
    const { transactions } = await json('/v1/direct');
    if (!transactions.length) {
      box.replaceChildren(el('p', { class: 'lp-empty', text: '还没有收录到用户钱包直发的交易。连接钱包，成为第一位。' }));
      return;
    }
    box.replaceChildren(...transactions.slice(0, 8).map((tx) => txRow(tx.explorerUrl ?? (explorer ? new URL(`/tx/${tx.txHash}`, explorer).href : '#'),
      '钱包直发', false, `${ACTION_LABELS[tx.action] ?? tx.action} · ${tx.contract}`, `from ${tx.from}`, `#${fmt(tx.blockNumber)} · ${when(tx.timestamp)}`)));
    for (const node of document.querySelectorAll('[data-receipt="key"]')) node.textContent = `#${fmt(transactions[0].blockNumber)}`;
  } catch {
    box.replaceChildren(el('p', { class: 'lp-empty', text: '交易读取失败，请稍后刷新。' }));
  }
}

function renderWallet() {
  const s = walletState();
  const label = s.address ? shortAddress(s.address) : '未连接';
  for (const node of document.querySelectorAll('[data-wallet-state]')) {
    node.textContent = s.address ? `已连接 ${label}${s.info?.name ? ` · ${s.info.name}` : ''}` : '未连接';
    node.className = `lp-check-state${s.address ? ' ok' : ''}`;
  }
  for (const node of document.querySelectorAll('[data-chain-state]')) {
    if (!s.address) { node.textContent = '连接钱包后可切换'; node.className = 'lp-check-state'; continue; }
    node.textContent = s.onSiteChain ? `已在 Chain ID ${s.chainId}` : `钱包当前 Chain ID ${s.chainId}`;
    node.className = `lp-check-state ${s.onSiteChain ? 'ok' : 'warn'}`;
  }
  for (const button of document.querySelectorAll('[data-connect]')) {
    button.textContent = s.address ? `已连接 ${label}` : '连接钱包';
  }
}

function wire() {
  for (const button of document.querySelectorAll('[data-connect]')) {
    button.addEventListener('click', async () => {
      if (walletState().address) { location.href = '/activate'; return; }
      try { await connectWallet(); } catch (error) { const { rejected, message } = walletError(error); if (!rejected) alert(message); }
    });
  }
  for (const button of document.querySelectorAll('[data-switch]')) {
    button.addEventListener('click', async () => {
      try {
        if (!walletState().address && !(await connectWallet())) return;
        await switchToSiteChain();
      } catch (error) { const { rejected, message } = walletError(error); if (!rejected) alert(message); }
    });
  }
  window.addEventListener('obelisk:wallet', renderWallet);
  renderWallet();
}

wire();
loadStats();
setInterval(loadStats, 15000);
loadChain().then((ctx) => Promise.all([loadSigned(ctx), loadWalletTxs(ctx)])).catch(() => {
  document.getElementById('verify-contracts').append(el('p', { class: 'lp-empty', text: '暂时无法确认网络，请刷新重试。' }));
});
