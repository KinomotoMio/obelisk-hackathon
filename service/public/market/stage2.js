// /market/stage-2 — what the market adds in stage 2 (docs/vision/05 M1, M3,
// M4, M5; M6 is stage 3). None of it is live: every figure here is an
// example and is labeled so. With ?skill=<id>, the revenue split uses that
// Skill's real family tree, read from the chain; prices and shares stay
// examples.

import { h, link, replace } from './dom.js';
import * as api from './api.js';
import { loading } from './ui.js';
import { exampleSplit, splitFlow } from './split.js';

const EXAMPLE_FAMILY = [
  { skillId: '1', name: 'AI 能力履历', author: '0xA1c90000000000000000000000000000000003be2' },
  { skillId: '4', name: '设计师作品集版', author: '0xD4000000000000000000000000000000000071f0' },
  { skillId: '9', name: '插画师作品集版', author: '0xF7000000000000000000000000000000000008a3' },
];

const example = () => h('span', { class: 'example' }, '示例');

function section(code, heading, intro, ...children) {
  return h('section', { class: 'panel stage2-section' },
    h('div', { class: 'panel-head' },
      h('h2', null, h('span', { class: 'code' }, code), heading),
      h('span', { class: 'pill stage2' }, code === 'M6' ? '阶段 3' : '阶段 2')),
    intro ? h('p', { class: 'fg2 section-intro' }, intro) : null,
    ...children);
}

function seg(options, chosen) {
  return h('span', { class: 'seg static', 'aria-disabled': 'true' }, options.map((option) => h('span', { 'aria-pressed': String(option === chosen) }, option)));
}

function futurePrompt(label, text) {
  return h('div', { class: 'prompt future' },
    h('div', { class: 'prompt-head' }, h('span', { class: 'prompt-label' }, label), h('span', { class: 'muted small' }, '阶段 2 上线后可用')),
    h('div', { class: 'prompt-body' }, h('code', null, text)));
}

function listing(family) {
  const seller = family.at(-1);
  const name = seller.name ?? `Skill #${seller.skillId}`;
  return section('M1', '上架与定价', '在 AI 编程助手里说一句话就能上架；衍生作品会自动带出上游作者的分成。预览确认后上链。',
    h('div', { class: 'grid-2' },
      h('div', { class: 'form-preview' },
        h('div', { class: 'field' }, h('label', null, '价格模式'), seg(['免费', '按次', '买断'], '按次')),
        h('div', { class: 'field' }, h('label', null, '价格'), h('div', { class: 'input' }, '0.5 BOT / 次', example())),
        h('div', { class: 'field' }, h('label', null, '许可'), seg(['个人使用', '商用'], '个人使用'))),
      h('div', { class: 'card' },
        h('div', { class: 'card-title' }, '分成规则 · 由族谱自动带出'),
        exampleSplit(family).map((payee) => h('div', { class: 'share-line' },
          h('span', null, payee.role, h('span', { class: 'muted' }, ` · ${payee.name ? `「${payee.name}」` : `#${payee.skillId}`}`)),
          h('b', { class: 'mono' }, `${payee.share}%`))),
        h('p', { class: 'muted small' }, '上游比例在各自铸造时设定，写在链上。比例为示例。'))),
    futurePrompt('上架', `/obelisk-skill-assets 把 Skill #${seller.skillId}「${name}」按次 0.5 BOT 上架，个人使用许可，上游分成按族谱带出。先给我看上架预览`));
}

function income() {
  const cards = [
    ['本月合计', '343.8', 'BOT'],
    ['直接销售', '182.5', 'BOT · 「AI 能力履历」'],
    ['衍生分成', '41.3', 'BOT · 来自 3 个下游 Skill'],
    ['AI 公司授权', '120.0', 'BOT · 按取用量分配 · 阶段 3'],
  ];
  const rows = [
    ['10-07 21:40', '衍生分成', 'acc', '插画师作品集版 → AI 能力履历', '+0.075 BOT'],
    ['10-07 21:12', '直接销售', 'ok', 'AI 能力履历', '+0.5 BOT'],
    ['10-07 20:58', 'AI 公司授权', 'chain', 'AI 能力履历', '+120.0 BOT'],
    ['10-07 20:31', '衍生分成', 'acc', '设计师作品集版 → AI 能力履历', '+0.1 BOT'],
  ];
  return section('M4', '收入面板', '按 Skill 和来源（直接销售、衍生分成、AI 公司授权）分类，每一笔都对应一条链上交易。下面是作者 A 的示例。',
    h('div', { class: 'kpis' }, cards.map(([label, value, note]) => h('div', { class: 'kpi' },
      h('div', { class: 'kpi-label' }, label, example()), h('div', { class: 'kpi-value' }, value), h('div', { class: 'kpi-note muted' }, note)))),
    h('div', { class: 'table-wrap' }, h('table', null,
      h('thead', null, h('tr', null, ['时间', '来源', 'Skill', '金额', '链上记录'].map((name) => h('th', null, name)))),
      h('tbody', null, rows.map(([time, source, kind, skill, amount]) => h('tr', null,
        h('td', { class: 'mono', 'data-label': '时间' }, time),
        h('td', { 'data-label': '来源' }, h('span', { class: `pill ${kind}` }, source)),
        h('td', { 'data-label': 'Skill' }, skill),
        h('td', { class: 'mono', 'data-label': '金额' }, amount),
        h('td', { class: 'muted', 'data-label': '链上记录' }, '上线后链接到交易')))))),
    h('p', { class: 'muted small' }, '表中金额和时间都是示例，没有对应的真实交易。'));
}

function contextPayment() {
  return section('M5', '上下文付费', '大家都在卖 Skill（方法），我们还能卖上下文（经验）：一段真实的 session，记录这件事之前是怎么做成的、踩过哪些坑。付款后按私密分享的规则解锁。',
    h('div', { class: 'grid-2' },
      h('div', { class: 'card' },
        h('div', { class: 'card-title' }, '发送方：给这段 session 定价'),
        h('div', { class: 'share-line' }, h('span', null, '修复支付回调重复扣款', example()), h('span', { class: 'muted small' }, '第 12–48 条 · 4 处已打码')),
        h('div', { class: 'share-line' }, h('span', { class: 'muted' }, '价格'), h('b', { class: 'mono' }, '2 BOT')),
        h('div', { class: 'share-line' }, h('span', { class: 'muted' }, '付款后'), h('span', null, '只能打开 1 次 · 24 小时内有效 · 带水印'))),
      h('div', { class: 'card' },
        h('div', { class: 'card-title' }, '买家：付款解锁'),
        h('p', { class: 'fg2' }, '这段 session 记录了一次线上重复扣款问题从定位到修复、补回归测试的完整过程。', example()),
        h('div', { class: 'chips' }, h('span', { class: 'pill chain' }, '卖家 0xA1c9…3be2'), h('span', { class: 'pill dim' }, '37 条消息')))),
    h('div', { class: 'prompts' },
      futurePrompt('发送方 · 分享并定价', '/obelisk-share 把 session「修复支付回调重复扣款」第 12–48 条分享出售，价格 2 BOT；付款后只能打开 1 次、24 小时内有效'),
      futurePrompt('买家 · 支付并解锁', '/obelisk-share 购买 0xA1c9…3be2 分享的 session「修复支付回调重复扣款」，价格 2 BOT，付款前先让我确认')),
    h('p', { class: 'muted small' }, '已经上线的部分：私密分享本身（指定钱包、打开次数、有效期、已读回执、水印）现在就能用；阶段 2 加的是价格和付款。'));
}

function whyPay() {
  const items = [
    ['持续更新', '作者根据实测场景和顺利率不断改进；新版本只通过 Obelisk 送达，复制的副本停在旧版本。'],
    ['合法使用的凭证', '授权记录在链上；铸造时间和指纹证明谁是作者。'],
    ['真实使用证据', '调用量、场景和顺利率只能在网络里积累，复制正文带不走。'],
    ['上下文（经验）', '每份 session 单独加密给一个接收者，带水印；新的 session 每天都在产生。'],
  ];
  return section('M6', 'Skill 正文可以复制，价值从哪里来', 'Skill 一被使用，正文就会进入 AI 的上下文，技术上无法阻止复制，我们也不假装能阻止。复制走的只是一份快照，下面这些复制不走。AI 公司授权（阶段 3）卖的也是这些。',
    h('div', { class: 'why' }, items.map(([heading, text]) => h('div', { class: 'card' }, h('div', { class: 'card-title' }, heading), h('p', { class: 'fg2' }, text)))));
}

async function familyFor(id) {
  if (!api.isSkillId(id)) return { family: EXAMPLE_FAMILY, real: false };
  try {
    const [tree, skill] = await Promise.all([api.lineage(id), api.skill(id)]);
    const byId = new Map(api.list(tree.nodes).map((node) => [node.skillId, node]));
    const family = api.list(tree.path).filter(api.isSkillId).map((skillId) => ({
      skillId,
      name: api.str(byId.get(skillId)?.name, 120) ?? (skillId === id ? api.str(skill.content?.name, 120) : null),
      author: api.isAddress(byId.get(skillId)?.author) ? byId.get(skillId).author : null,
    }));
    return family.length ? { family, real: true } : { family: EXAMPLE_FAMILY, real: false };
  } catch {
    return { family: EXAMPLE_FAMILY, real: false, failed: true };
  }
}

export async function renderStage2(root, params) {
  replace(root, loading('正在准备预览…'));
  const { family, real, failed } = await familyFor(params.get('skill'));
  const seller = family.at(-1);
  replace(root,
    link(real ? `/market/skills/${seller.skillId}` : '/market', { class: 'back' }, real ? `← Skill #${seller.skillId}` : '← Skill 市场'),
    h('section', { class: 'stage2-hero' },
      h('span', { class: 'pill stage2 big' }, '阶段 2 预览'),
      h('h1', null, '钱沿着族谱流动'),
      h('p', { class: 'lead' }, '上架定价、沿族谱自动分成、收入面板、上下文付费都还没有上线。这一页展示阶段 2 的设计：标「示例」的数字都是编的，没有对应的链上交易。现在已经能在链上核对的，是 Skill 市场里的调用量、钱包数、场景、顺利率和族谱。'),
      failed ? h('p', { class: 'warn small' }, `读不到 Skill #${params.get('skill')} 的族谱，下面换成示例族谱。`) : null),
    listing(family),
    section('M3', '一笔收入怎么拆', real
      ? `用的是 Skill #${seller.skillId} 在链上的真实族谱；价格和比例是示例。`
      : '用的是示例族谱：「AI 能力履历」→「设计师作品集版」→「插画师作品集版」。打开任何一个 Skill 的页面，可以看到它自己的族谱怎么分。',
    splitFlow(exampleSplit(family), 0.5)),
    income(),
    contextPayment(),
    whyPay());
}
