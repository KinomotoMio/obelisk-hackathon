// Stage 2 preview (docs/vision/05 M3): how one sale would be split along a
// Skill's family tree. The tree passed in may be real; the shares and the
// price are examples, and the page says so wherever they appear.

import { h } from './dom.js';
import { shortAddress } from './ui.js';

/** Example shares each ancestor keeps, nearest first; the author keeps the rest. */
const EXAMPLE_UPSTREAM = [25, 15, 10, 5, 5];

/**
 * `path` is the family from the root down to the Skill being sold:
 * [{ skillId, name, author }]. Returns the payees, seller first.
 */
export function exampleSplit(path) {
  const seller = path.at(-1);
  const ancestors = path.slice(0, -1).reverse();
  const upstream = ancestors.map((skill, at) => ({ ...skill, share: EXAMPLE_UPSTREAM[at] ?? 0, role: at === 0 ? '父 Skill 的作者' : at === 1 ? '祖 Skill 的作者' : `上游第 ${at + 1} 层的作者` }))
    .filter((payee) => payee.share > 0);
  const kept = 100 - upstream.reduce((sum, payee) => sum + payee.share, 0);
  return [{ ...seller, share: kept, role: '这个 Skill 的作者' }, ...upstream];
}

const bot = (value) => `${Number(value.toFixed(4))} BOT`;

/** The split as rows: who gets what share of an example price. */
export function splitFlow(split, price, highlight = null) {
  return h('div', { class: 'split' },
    h('div', { class: 'split-source' },
      h('div', { class: 'split-label muted' }, '买家支付', h('span', { class: 'example' }, '示例')),
      h('div', { class: 'split-amount mono' }, bot(price)),
      h('div', { class: 'split-arrow muted' }, '市场合约在同一笔交易里拆分 →')),
    h('div', { class: 'split-rows' }, split.map((payee) => h('div', { class: ['split-row', payee.skillId === highlight ? 'current' : null] },
      h('div', { class: 'split-who' },
        h('div', null, payee.name ? [`「${payee.name}」`, h('span', { class: 'muted' }, ` #${payee.skillId}`)] : `Skill #${payee.skillId}`),
        h('div', { class: 'muted small' }, payee.role, payee.author ? [' · ', h('span', { class: 'mono' }, shortAddress(payee.author))] : null)),
      h('div', { class: 'split-bar' }, h('i', { style: { width: `${payee.share}%` } })),
      h('div', { class: 'split-share mono' }, `${payee.share}%`, h('span', { class: 'muted' }, ` · ${bot((price * payee.share) / 100)}`))))),
    h('p', { class: 'muted small' }, '比例为示例：阶段 2 里，每一层的比例由上游作者在铸造或上架时写在链上，下游不能单方面修改；付款时合约直接打到各个钱包，不经过平台账户。'));
}
