// /market: the Skills minted on this chain, newest first, with what each one
// has really been used for. Read from GET /v1/skills; nothing here is made up.

import { h, link, replace } from './dom.js';
import * as api from './api.js';
import { networkName } from '/site/site.js';
import { ago, count, empty, failure, loading, sceneChip, shortAddress, title } from './ui.js';

const SORTS = [
  { id: 'new', label: '最新铸造', compare: (a, b) => Number(b.skillId) - Number(a.skillId) },
  { id: 'calls', label: '调用最多', compare: (a, b) => b.totalInvocations - a.totalInvocations || Number(b.skillId) - Number(a.skillId) },
  { id: 'wallets', label: '钱包最多', compare: (a, b) => b.uniqueWallets - a.uniqueWallets || Number(b.skillId) - Number(a.skillId) },
];

function clean(raw) {
  if (!api.isSkillId(raw?.skillId) || !api.isAddress(raw?.author)) return null;
  return {
    skillId: raw.skillId,
    author: raw.author,
    parentSkillId: api.isSkillId(raw.parentSkillId) ? raw.parentSkillId : null,
    name: api.str(raw.name, 120),
    description: api.str(raw.description, 1024),
    birthScenes: api.list(raw.birthScenes).slice(0, 12),
    versionCount: api.num(raw.versionCount) || 1,
    childCount: api.num(raw.childCount),
    totalInvocations: api.num(raw.totalInvocations),
    uniqueWallets: api.num(raw.uniqueWallets),
    uniqueWalletsExact: raw.uniqueWalletsExact !== false,
    lastReportAt: api.str(raw.lastReportAt, 40),
    createdAt: api.str(raw.createdAt, 40),
  };
}

function card(skill) {
  const reported = ago(skill.lastReportAt);
  return link(`/market/skills/${skill.skillId}`, { class: 'skill-card' },
    h('div', { class: 'skill-card-head' },
      h('div', { class: 'skill-card-name' }, title(skill)),
      h('span', { class: 'muted mono' }, `#${skill.skillId} · v${skill.versionCount}`)),
    h('div', { class: 'skill-card-by muted' },
      '作者 ', h('span', { class: 'mono' }, shortAddress(skill.author)),
      skill.parentSkillId ? [' · ', h('span', { class: 'derived-from' }, `基于 #${skill.parentSkillId}`)] : null),
    h('p', { class: ['skill-card-desc', skill.description ? null : 'muted'] }, skill.description ?? '作者没有把正文存到在线服务，所以这里没有名字和说明；链上记录照常可查。'),
    skill.birthScenes.length ? h('div', { class: 'chips' }, skill.birthScenes.slice(0, 3).map((scene) => sceneChip(scene)), skill.birthScenes.length > 3 ? h('span', { class: 'muted chip-more' }, `+${skill.birthScenes.length - 3}`) : null) : null,
    h('div', { class: 'skill-card-stats' },
      h('div', null, h('b', null, count(skill.totalInvocations)), h('span', null, '真实调用')),
      h('div', null, h('b', null, `${count(skill.uniqueWallets)}${skill.uniqueWalletsExact ? '' : '+'}`), h('span', null, '个钱包')),
      h('div', null, h('b', null, count(skill.childCount)), h('span', null, '个衍生'))),
    h('div', { class: 'skill-card-foot muted' }, reported ? `最近上报 ${reported}` : '还没有使用上报'));
}

export async function renderList(root) {
  const state = { skills: [], total: 0, nextBefore: null, sort: 'new', query: '', chain: null };
  const grid = h('div', { class: 'skill-grid', 'aria-live': 'polite' });
  const more = h('div', { class: 'more' });
  const summary = h('div', { class: 'hero-stats' });
  const search = h('input', { type: 'search', class: 'search', placeholder: '按名称、说明或场景筛选', 'aria-label': '筛选 Skill' });
  const sorts = h('span', { class: 'seg', role: 'group', 'aria-label': '排序' });

  const draw = () => {
    const query = state.query.trim().toLowerCase();
    const shown = state.skills
      .filter((skill) => !query || [skill.name, skill.description, `#${skill.skillId}`, ...skill.birthScenes.map((scene) => api.str(scene?.label, 80))]
        .some((text) => text && text.toLowerCase().includes(query)))
      .sort(SORTS.find((sort) => sort.id === state.sort).compare);
    replace(sorts, SORTS.map((sort) => h('button', { type: 'button', 'aria-pressed': String(sort.id === state.sort), onclick: () => { state.sort = sort.id; draw(); } }, sort.label)));
    if (state.total === 0) {
      replace(grid, empty('这条链上还没有铸造的 Skill',
        '在 Claude Code 或 Codex 里用「沉淀 Skill」从自己的历史里起草一个，审阅后铸造，它就会出现在这里。'));
    } else if (shown.length === 0) {
      replace(grid, empty('没有符合筛选的 Skill', '换个关键词试试；筛选只在已加载的 Skill 里进行。'));
    } else {
      replace(grid, shown.map(card));
    }
    const calls = state.skills.reduce((sum, skill) => sum + skill.totalInvocations, 0);
    const derived = state.skills.filter((skill) => skill.parentSkillId).length;
    replace(summary,
      h('div', null, h('b', null, count(state.total)), h('span', null, '个已铸造的 Skill')),
      h('div', null, h('b', null, count(calls)), h('span', null, state.nextBefore ? '次真实调用（已加载部分）' : '次真实调用')),
      h('div', null, h('b', null, count(derived)), h('span', null, '个是在别人基础上衍生的')),
      state.chain ? h('div', null, h('b', { class: 'net-name' }, networkName(state.chain.chainId)), h('span', null, '数据所在的链')) : null);
  };
  search.addEventListener('input', () => { state.query = search.value; draw(); });

  replace(root,
    h('section', { class: 'hero' },
      h('div', { class: 'eyebrow' }, 'Skill 市场'),
      h('h1', null, '用真实使用说话的 Skill'),
      h('p', { class: 'lead' }, '这里的每个 Skill 都铸造在 BOT Chain 上：谁写的、改自哪一个、被多少个钱包真实调用过多少次，都来自链上记录，不是下载量，也不是评分。'),
      summary),
    h('div', { class: 'toolbar' }, search, sorts),
    grid,
    more,
    h('aside', { class: 'stage2-band' },
      h('div', null,
        h('span', { class: 'pill acc' }, '知识因分享而生长'),
        h('div', { class: 'band-title' }, '带走一种方法，也留下你的新发现'),
        h('p', { class: 'muted' }, '找到适合你的 Skill，在真实工作中用出自己的经验。你的改进可以帮助更多人，也让一路分享知识的人得到回报。'))));
  replace(grid, loading());

  const [chainInfo, first] = await Promise.allSettled([api.chain(), api.skills()]);
  state.chain = chainInfo.status === 'fulfilled' ? chainInfo.value : null;
  if (first.status === 'rejected') {
    replace(grid, failure(first.reason));
    return;
  }
  const accept = (page) => {
    state.total = api.num(page.total);
    state.skills.push(...api.list(page.skills).map(clean).filter(Boolean));
    state.nextBefore = api.isSkillId(page.nextBefore) ? page.nextBefore : null;
    replace(more, state.nextBefore ? h('button', {
      type: 'button', class: 'btn',
      onclick: async (event) => {
        event.currentTarget.disabled = true;
        try {
          accept(await api.skills(state.nextBefore));
        } catch (error) {
          replace(more, failure(error));
        }
      },
    }, `加载更早的 Skill（还有 ${count(state.total - state.skills.length)} 个）`) : null);
    draw();
  };
  accept(first.value);
}
