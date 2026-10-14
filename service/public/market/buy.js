// Buy a Skill in the browser and take it to your own agent (Skill detail page).
//
//   1. The buyer's wallet signs BuySkill and sends buyBySig itself, paying the
//      price; the contract splits it to the author, upstream authors and the
//      platform along the on-chain lineage. (Free offers cost only gas.)
//   2. The buyer signs UseSkill; the relay records this retrieval on chain.
//   3. The buyer signs SkillAccess; the service releases the body, which the
//      page checks against the on-chain fingerprint before showing it.
//   4. The page gives a SKILL.md download and a prompt for Claude Code or
//      Codex: install through Obelisk (which records the install so real use
//      can be reported), or save the file directly.
//
// A buyer who already holds the license, or the author, skips step 1.

import { h, replace } from './dom.js';
import { connectWallet, siteChain, switchToSiteChain, walletError, walletState } from '/site/wallet.js';

const SECONDS = 600;
const ACCESS_SECONDS = 3300;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const MARKET_TYPES = {
  BuySkill: [{ name: 'buyer', type: 'address' }, { name: 'offerId', type: 'uint256' }, { name: 'nonce', type: 'uint256' }, { name: 'deadline', type: 'uint256' }],
  UseSkill: [{ name: 'buyer', type: 'address' }, { name: 'offerId', type: 'uint256' }, { name: 'nonce', type: 'uint256' }, { name: 'deadline', type: 'uint256' }],
  SkillAccess: [{ name: 'buyer', type: 'address' }, { name: 'fingerprint', type: 'bytes32' }, { name: 'useTransaction', type: 'bytes32' }, { name: 'deadline', type: 'uint256' }],
};
const DOMAIN_TYPES = [{ name: 'name', type: 'string' }, { name: 'version', type: 'string' }, { name: 'chainId', type: 'uint256' }, { name: 'verifyingContract', type: 'address' }];

class ServiceError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}

async function api(path, body) {
  let response;
  try {
    response = await fetch(path, body === undefined
      ? { headers: { accept: 'application/json' }, cache: 'no-store' }
      : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  } catch { throw new ServiceError(0, 'unreachable', '连不上 Obelisk 在线服务，请检查网络后重试。'); }
  const json = await response.json().catch(() => ({}));
  if (!response.ok) throw new ServiceError(response.status, json.error?.code ?? 'http_error', json.error?.message ?? `HTTP ${response.status}`);
  return json;
}

const deadline = (seconds = SECONDS) => String(Math.floor(Date.now() / 1000) + seconds);

async function signMarket(chain, address, primaryType, message) {
  const typed = {
    types: { EIP712Domain: DOMAIN_TYPES, [primaryType]: MARKET_TYPES[primaryType] },
    domain: { name: 'ObeliskSkillMarket', version: '1', chainId: chain.chainId, verifyingContract: chain.market },
    primaryType, message,
  };
  await switchToSiteChain();
  return walletState().provider.request({ method: 'eth_signTypedData_v4', params: [address, JSON.stringify(typed)] });
}

async function waitFor(hash) {
  for (let i = 0; i < 60; i += 1) {
    try {
      const tx = await api(`/v1/tx/${hash}`);
      if (tx.status === 'confirmed') return tx;
      if (tx.status === 'reverted') throw new ServiceError(502, 'transaction_reverted', '交易已上链但执行失败（reverted），没有扣款或分账。');
    } catch (error) {
      if (!(error instanceof ServiceError) || error.code !== 'unknown_transaction') throw error;
    }
    await sleep(2500);
  }
  throw new ServiceError(504, 'timeout', '交易还没有确认。可以稍后刷新本页；已付款的授权会被自动识别，不会重复扣款。');
}

async function sha256Hex(text) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return `0x${[...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')}`;
}

const normalize = (body) => body.replace(/\r\n?/g, '\n').trim();
const skillMarkdown = ({ name, description, body }) => `---\nname: ${name}\ndescription: ${JSON.stringify(description)}\n---\n\n${normalize(body)}\n`;

function copyButton(label, text) {
  const button = h('button', { type: 'button', class: 'btn', onclick: async () => {
    try { await navigator.clipboard.writeText(text()); button.textContent = '已复制'; } catch { button.textContent = '复制失败，请手动选择'; }
    setTimeout(() => { button.textContent = label; }, 2400);
  } }, label);
  return button;
}

function installPrompt({ chain, skill, offer, content, buyTx, useTx, access }) {
  const fp = offer.fingerprint.slice(2);
  const service = location.origin;
  const md = skillMarkdown(content);
  const en = document.documentElement.lang === 'en';
  const network = chain.chainId === 677 ? (en ? 'BOT Chain Mainnet' : 'BOT Chain 主网') : (en ? 'BOT Chain Testnet' : 'BOT Chain 测试网');
  const command = `OBELISK_SERVICE_URL=${service} obelisk skill fetch ${fp} --receipt ${useTx} --access ${access.buyer}:${access.deadline}:${access.signature}`;
  const lines = en ? [
    'Install a Skill I bought on the Obelisk Skill market into this agent.',
    '',
    `Skill: ${content.name} (${network} Skill #${skill.skillId}, version fingerprint ${fp})`,
    buyTx ? `Purchase transaction: ${buyTx}` : 'License: already held by this wallet',
    `Retrieval receipt: ${useTx}`,
    '',
    'If the Obelisk hackathon build is installed (the obelisk command works), install through it: it checks the body against the on-chain fingerprint and records the install, so real use can later be reported on chain:',
    `  ${command}`,
    'Run it first to preview and show me what the body asks for; after I confirm, run the same command with --confirm (add --harness codex for Codex). The access signature is valid for about an hour.',
    '',
    `Without Obelisk: save the SKILL.md below unchanged to ~/.claude/skills/${content.name}/SKILL.md (Codex: ~/.agents/skills/${content.name}/SKILL.md), then tell me how to invoke it.`,
    '',
  ] : [
    `帮我把一个在 Obelisk Skill 市场购买的 Skill 安装到当前 Agent。`,
    ``,
    `Skill：${content.name}（${network} Skill #${skill.skillId}，版本指纹 ${fp}）`,
    buyTx ? `购买交易：${buyTx}` : `授权：本钱包已持有授权`,
    `取用回执：${useTx}`,
    ``,
    `如果本机装有 Obelisk 黑客松版（obelisk 命令可用），优先用它安装，这样会核对正文指纹并记录安装，之后的真实使用可以上报到链上：`,
    `  ${command}`,
    `先运行上面的命令预览，给我看正文要求做什么；我确认后再在同一命令末尾加 --confirm 安装（Codex 加 --harness codex）。这个授权签名约 1 小时内有效。`,
    ``,
    `如果没有 Obelisk：把下面的 SKILL.md 原样保存到 ~/.claude/skills/${content.name}/SKILL.md（Codex 用 ~/.agents/skills/${content.name}/SKILL.md），不要改动内容，然后告诉我怎么调用它。`,
    ``,
  ];
  return [
    ...lines,
    '```markdown',
    md.trimEnd(),
    '```',
  ].join('\n');
}

/** The purchase panel for one offer; `skill` is { skillId, name } and `offer` comes from /v1/market/offers. */
export function walletPurchase(skill, offer) {
  const root = h('div', { class: 'wb' });
  const free = offer.mode === 'free';
  const state = { step: 0 };

  const steps = (active) => h('ol', { class: 'wb-steps' }, [
    free ? '连接钱包，签名领取（钱包发送，仅付手续费）' : `连接钱包，签名并支付 ${offer.price} BOT（钱包发送）`,
    '签名取用（由 Obelisk 代付记录到链上）',
    '签名领取正文，浏览器核对版本指纹',
  ].map((text, i) => h('li', { class: i < active ? 'done' : i === active ? 'active' : '' }, h('span', null, i < active ? '✓' : String(i + 1)), text)));

  const view = (active, actions, notice) => replace(root,
    steps(active),
    notice ? h('p', { class: `wb-notice ${notice.tone ?? ''}` }, notice.text) : null,
    h('div', { class: 'wb-actions' }, actions));

  const fail = (error) => {
    if (error instanceof ServiceError) return { tone: 'warn', text: error.message };
    const { rejected, message } = walletError(error);
    return { tone: rejected ? '' : 'warn', text: message };
  };

  const start = (notice) => {
    const label = free ? '用钱包免费领取' : `用钱包购买 · ${offer.price} BOT`;
    const button = h('button', { type: 'button', class: 'btn wb-primary', onclick: () => run(button) }, label);
    view(0, [button, h('span', { class: 'muted small' }, '支持 MetaMask、OKX Wallet 等 EVM 钱包')], notice);
  };

  const busy = (button, text) => { button.disabled = true; button.textContent = text; };

  const run = async (button) => {
    let buyTx = null;
    try {
      busy(button, '请在钱包里确认连接…');
      const chain = await siteChain();
      if (!walletState().address && !(await connectWallet())) return start();
      await switchToSiteChain();
      const buyer = walletState().address;
      const access = await api(`/v1/market/access/${offer.offerId}?wallet=${buyer}`);
      const holds = access.author || access.perpetual || BigInt(access.credits ?? '0') > 0n;

      if (!holds) {
        busy(button, '请在钱包里签名购买（1/4）…');
        const { nonce } = await api(`/v1/nonces/SkillMarket/${buyer}`);
        const message = { buyer, offerId: offer.offerId, nonce, deadline: deadline() };
        const signature = await signMarket(chain, buyer, 'BuySkill', message);
        busy(button, '正在核对签名与余额…');
        const call = await api('/v1/direct/prepare', { action: 'BuySkill', message, signature });
        if (!call.enoughBalance) return start({ tone: 'warn', text: `钱包余额 ${call.balance} ${call.symbol}，不足以支付 ${call.price} ${call.symbol} 与约 ${call.estimatedFee} ${call.symbol} 手续费。` });
        busy(button, '请在钱包里确认支付（2/4）…');
        buyTx = await walletState().provider.request({ method: 'eth_sendTransaction', params: [{ from: buyer, to: call.to, data: call.data, value: call.value, gas: call.gas }] });
        busy(button, '等待 BOT Chain 确认付款…');
        await waitFor(buyTx);
        await Promise.allSettled([api('/v1/direct', { txHash: buyTx }), api('/v1/market/receipts', { transaction: buyTx })]);
      }
      view(1, [h('button', { type: 'button', class: 'btn wb-primary', disabled: true }, '请在钱包里签名取用（3/4）…')],
        buyTx ? { tone: 'ok', text: '付款已确认，分账已在链上完成。' } : { tone: 'ok', text: '这个钱包已持有授权，无需再次付款。' });
      const { nonce: useNonce } = await api(`/v1/nonces/SkillMarket/${buyer}`);
      const use = { buyer, offerId: offer.offerId, nonce: useNonce, deadline: deadline() };
      const useSignature = await signMarket(chain, buyer, 'UseSkill', use);
      const used = await api('/v1/relay', { action: 'UseSkill', message: use, signature: useSignature });
      const useTx = used.status === 'confirmed' ? used.txHash : (await waitFor(used.txHash)).txHash;

      view(2, [h('button', { type: 'button', class: 'btn wb-primary', disabled: true }, '请在钱包里签名领取正文（4/4）…')]);
      const request = { buyer, fingerprint: offer.fingerprint, useTransaction: useTx, deadline: deadline(ACCESS_SECONDS) };
      const accessSignature = await signMarket(chain, buyer, 'SkillAccess', request);
      const delivered = await api(`/v1/market/content/${offer.fingerprint}`, { ...request, signature: accessSignature });
      const content = delivered.content;
      if (typeof content?.body !== 'string' || await sha256Hex(normalize(content.body)) !== offer.fingerprint.toLowerCase()) {
        throw new ServiceError(502, 'fingerprint_mismatch', '收到的正文与链上记录的版本指纹不一致，已拒绝显示。');
      }
      done({ chain, buyer, buyTx, useTx, content, access: { buyer, deadline: request.deadline, signature: accessSignature } });
    } catch (error) {
      start(fail(error));
    }
  };

  const done = ({ chain, buyTx, useTx, content, access }) => {
    const explorer = (hash) => (chain.explorerUrl ? `${chain.explorerUrl}/tx/${hash}` : null);
    const md = skillMarkdown(content);
    const prompt = installPrompt({ chain, skill, offer, content, buyTx, useTx, access });
    const blob = URL.createObjectURL(new Blob([md], { type: 'text/markdown;charset=utf-8' }));
    replace(root,
      h('div', { class: 'wb-done' },
        h('p', { class: 'wb-title' }, '✓ 已取得授权，正文已核对'),
        h('dl', { class: 'wb-facts' },
          buyTx ? [h('dt', null, '购买交易（你的钱包发送）'), h('dd', null, h('a', { href: explorer(buyTx), target: '_blank', rel: 'noopener noreferrer', translate: 'no' }, `${buyTx.slice(0, 10)}…${buyTx.slice(-6)} ↗`))] : null,
          [h('dt', null, '取用回执（链上记录）'), h('dd', null, h('a', { href: explorer(useTx), target: '_blank', rel: 'noopener noreferrer', translate: 'no' }, `${useTx.slice(0, 10)}…${useTx.slice(-6)} ↗`))],
          [h('dt', null, '版本指纹'), h('dd', { class: 'mono', translate: 'no' }, offer.fingerprint)]),
        h('h3', null, '交给你的 Agent'),
        h('p', { class: 'muted small' }, '复制下面这段 prompt，粘贴到 Claude Code 或 Codex。装有 Obelisk 时它会核对指纹并记录安装，之后的真实使用可以上报到链上；没有 Obelisk 也能直接安装。'),
        h('pre', { class: 'wb-prompt', translate: 'no' }, prompt),
        h('div', { class: 'wb-actions' },
          copyButton('复制安装 prompt', () => prompt),
          h('a', { class: 'btn', href: blob, download: 'SKILL.md' }, '下载 SKILL.md'),
          copyButton('复制 SKILL.md', () => md)),
        h('details', null, h('summary', null, '查看正文'), h('pre', { class: 'wb-body', translate: 'no' }, md))));
  };

  start();
  return root;
}
