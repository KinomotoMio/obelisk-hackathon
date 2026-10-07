import { h, link, replace } from '/market/dom.js';
import { loading, failure, shortAddress } from '/market/ui.js';
import { showNetwork } from '/site/site.js';

const root = document.querySelector('#app');
const address = value => typeof value === 'string' && /^0x[0-9a-fA-F]{40}$/.test(value);
const hash = value => typeof value === 'string' && /^0x[0-9a-fA-F]{64}$/.test(value);
const amount = value => {
  if (typeof value !== 'string' || !/^\d{1,78}$/.test(value)) return '—';
  const wei = BigInt(value);
  const fraction = (wei % 10n ** 18n).toString().padStart(18, '0').replace(/0+$/, '');
  return `${wei / 10n ** 18n}${fraction ? `.${fraction}` : ''}`;
};
async function render() {
  replace(root, loading());
  try {
    const response = await fetch('/v1/market/operations');
    const data = await response.json();
    if (!response.ok) throw new Error(data.error?.code === 'market_not_deployed' ? '结算合约尚未部署。部署后这里会读取真实的平台到账和分配记录。' : '暂时无法读取结算，请稍后刷新。');
    const base = data.chainId === 968 ? 'https://scan.bohr.life' : data.chainId === 677 ? 'https://scan.botchain.ai' : null;
    const rows = Array.isArray(data.rows) ? data.rows.slice(0, 50) : [];
    replace(root,
      h('section', { class: 'hero' }, h('div', { class: 'eyebrow' }, '平台运营'), h('h1', null, '每一份回报，都有来处'),
        h('p', { class: 'lead' }, '创作者带来知识，后来的人接着改进。平台为发现、交付和结算提供服务，从每笔购买中获得约定费用。'),
        h('p', { class: 'muted' }, data.testnet ? '测试网 Demo · 以下金额来自测试币交易，不代表实际营收。' : '以下记录来自主网实际结算。')),
      h('div', { class: 'kpis' },
        h('div', { class: 'kpi' }, h('div', { class: 'kpi-label' }, '平台累计到账'), h('div', { class: 'kpi-value' }, `${amount(data.totalWei)} BOT`)),
        h('div', { class: 'kpi' }, h('div', { class: 'kpi-label' }, '平台费用'), h('div', { class: 'kpi-value' }, `${Number.isInteger(data.platformBps) ? data.platformBps / 100 : '—'}%`)),
        h('div', { class: 'kpi' }, h('div', { class: 'kpi-label' }, '结算笔数'), h('div', { class: 'kpi-value' }, /^\d+$/.test(data.count) ? data.count : '—'))),
      h('section', { class: 'panel' }, h('div', { class: 'panel-head' }, h('h2', null, '购买款项如何分配'), h('button', { class: 'btn', onclick: render }, '刷新')),
        rows.length ? rows.map(row => h('section', { class: 'panel' },
          h('h3', null, `结算 #${String(row.receiptId).slice(0, 30)} · 付款 ${amount(row.paidWei)} BOT`),
          base && hash(row.transaction) ? link(`${base}/tx/${row.transaction}`, { class: 'muted small' }, '核对交易 ↗') : h('p', { class: 'muted small' }, '交易链接尚未建立，金额仍可在结算合约中核对。'),
          h('table', null, h('thead', null, h('tr', null, h('th', null, '受益者'), h('th', null, '钱包'), h('th', null, '到账'))),
            h('tbody', null, (Array.isArray(row.allocations) ? row.allocations.slice(0, 17) : []).map(part => h('tr', null,
              h('td', null, part.skillId === '0' ? '平台服务' : `Skill #${String(part.skillId).slice(0, 30)} 的作者`),
              h('td', null, base && address(part.recipient) ? link(`${base}/address/${part.recipient}`, null, shortAddress(part.recipient)) : '—'),
              h('td', null, `${amount(part.amountWei)} BOT`)))))))
          : h('p', { class: 'muted' }, '还没有购买结算。第一笔交易完成后，平台与作者的到账会一起显示。'),
        data.nextBefore ? h('p', { class: 'muted small' }, '当前展示最近 20 笔结算，累计到账包含全部记录。') : null));
  } catch (error) { replace(root, h('h1', null, '平台运营'), failure(error), h('button', { class: 'btn', onclick: render }, '重新读取')); }
}
void showNetwork();
void render();
