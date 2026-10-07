// /market/skills/:id — one minted Skill as a buyer would judge it: who made
// it and from what, how often it is really used and by how many wallets,
// where it is used compared with what the author declared, how those uses
// went, its family tree and versions, and where to check each of these on
// chain. Read from GET /v1/skills/:id, /usage, and /lineage.

import { h, link, replace, s } from './dom.js';
import * as api from './api.js';
import { networkName } from '/site/site.js';
import { addressLink, ago, count, day, empty, failure, loading, percent, promptBox, sceneChip, shortAddress, shortHex, skillName, title } from './ui.js';
import { exampleSplit, splitFlow } from './split.js';

const OUTCOMES = [
  { id: 'smooth', label: '顺利', className: 'ok' },
  { id: 'rework', label: '返工', className: 'warn' },
  { id: 'failed', label: '失败', className: 'danger' },
  { id: 'unknown', label: '无法判断', className: 'dim' },
];

function panel(heading, note, ...children) {
  return h('section', { class: 'panel' },
    h('div', { class: 'panel-head' }, h('h2', null, heading), note ? h('span', { class: 'muted panel-note' }, note) : null),
    ...children);
}

function kpi(label, value, note, extra) {
  return h('div', { class: ['kpi', extra] }, h('div', { class: 'kpi-label' }, label), h('div', { class: 'kpi-value' }, value), h('div', { class: 'kpi-note muted' }, note));
}

function trendChart(trend) {
  const weeks = api.list(trend?.weeks).map((week) => ({ start: api.str(week?.start, 10) ?? '', invocations: api.num(week?.invocations) })).slice(-12);
  if (!trend?.available) return empty('趋势暂时读不到', '在线服务没有接上存放上报记录的存储，只能显示累计数字。');
  if (weeks.every((week) => week.invocations === 0)) return empty('这几周还没有上报', '使用者开启上报后，每次汇总上报的调用会按周出现在这里。');
  const max = Math.max(...weeks.map((week) => week.invocations));
  // Drawn narrower on phones so its labels stay readable when scaled to fit.
  const narrow = matchMedia('(max-width: 640px)').matches;
  const width = narrow ? 340 : 640;
  const height = narrow ? 170 : 180;
  const left = 8;
  const bottom = 26;
  const top = 22;
  const slot = (width - left * 2) / weeks.length;
  const bar = Math.min(44, slot * 0.6);
  const y = (value) => top + (height - top - bottom) * (1 - value / max);
  return s('svg', { class: 'trend', viewBox: `0 0 ${width} ${height}`, role: 'img', 'aria-label': `近 ${weeks.length} 周上报的调用：${weeks.map((week) => `${week.start.slice(5)} ${week.invocations} 次`).join('，')}` },
    s('line', { x1: left, x2: width - left, y1: height - bottom, y2: height - bottom, class: 'axis' }),
    weeks.map((week, index) => {
      const x = left + slot * index + (slot - bar) / 2;
      const last = index === weeks.length - 1;
      return s('g', null,
        week.invocations > 0 ? s('rect', { x, y: y(week.invocations), width: bar, height: height - bottom - y(week.invocations), rx: 4, class: last ? 'bar now' : 'bar' }) : null,
        week.invocations > 0 ? s('text', { x: x + bar / 2, y: y(week.invocations) - 6, 'text-anchor': 'middle', class: 'value' }, count(week.invocations)) : null,
        last || !narrow || (weeks.length - 1 - index) % 2 === 0
          ? s('text', { x: x + bar / 2, y: height - 8, 'text-anchor': 'middle', class: 'tick' }, last ? '本周' : week.start.slice(5))
          : null);
    }));
}

function resultBar(results) {
  const total = OUTCOMES.reduce((sum, outcome) => sum + api.num(results?.[outcome.id]), 0);
  if (total === 0) return empty('还没有判断过的调用', '使用者用本机的 AI 编程助手判断每次调用的结果后，顺利、返工、失败的比例会出现在这里。');
  return h('div', null,
    h('div', { class: 'stack-bar', role: 'img', 'aria-label': OUTCOMES.map((outcome) => `${outcome.label} ${api.num(results[outcome.id])}`).join('，') },
      OUTCOMES.map((outcome) => {
        const value = api.num(results[outcome.id]);
        return value ? h('i', { class: outcome.className, style: { width: `${(value / total) * 100}%` } }) : null;
      })),
    h('div', { class: 'legend' }, OUTCOMES.map((outcome) => h('span', null, h('i', { class: outcome.className }), `${outcome.label} ${count(api.num(results[outcome.id]))}`))),
    h('p', { class: 'muted small' }, '顺利率 = 顺利 ÷（顺利 + 返工 + 失败），不含无法判断的调用。判断由使用者本机的 AI 编程助手完成，按次汇总上报，链上只有计数。'));
}

function scenesCompare(skill, usage) {
  const declared = api.list(usage?.birthScenes ?? skill.birthScenes.map((tag) => ({ tag })));
  const declaredTags = new Set(declared.map((scene) => scene?.tag));
  const measured = api.list(usage?.scenes).filter((scene) => api.num(scene?.invocations) > 0)
    .sort((a, b) => api.num(b.invocations) - api.num(a.invocations)).slice(0, 10);
  const max = Math.max(1, ...measured.map((scene) => api.num(scene.invocations)));
  const matched = measured.filter((scene) => declaredTags.has(scene.tag)).length;
  const description = api.str(skill.content?.description, 1024);
  return h('div', { class: 'compare' },
    h('div', { class: 'compare-side' },
      h('div', { class: 'compare-title' }, '作者怎么说'),
      h('p', { class: description ? 'fg2' : 'muted' }, description ?? '作者没有把正文存到在线服务，这里没有说明。'),
      declared.length ? h('div', { class: 'chips' }, declared.map((scene) => sceneChip(scene))) : h('p', { class: 'muted small' }, '铸造时没有声明出生场景。')),
    h('div', { class: 'compare-side' },
      h('div', { class: 'compare-title' }, '实际在哪里被用'),
      measured.length
        ? [
          h('div', { class: 'scene-rows' }, measured.map((scene) => {
            const judged = api.num(scene.judged);
            return h('div', { class: 'scene-row' },
              h('div', { class: 'scene-row-head' },
                sceneChip(scene, { declared: declaredTags.has(scene.tag) }),
                h('span', { class: 'mono fg2' }, `${count(api.num(scene.invocations))} 次`)),
              h('div', { class: 'bar-track' }, h('i', { style: { width: `${(api.num(scene.invocations) / max) * 100}%` } })),
              judged > 0 && typeof scene.smoothRate === 'number'
                ? h('div', { class: 'scene-result muted' }, '顺利 ', h('b', { class: scene.smoothRate >= 0.8 ? 'ok-text' : 'fg2' }, percent(scene.smoothRate)), ` · 判断 ${count(judged)} 次`)
                : h('div', { class: 'scene-result muted' }, '这个场景还没有判断过结果'));
          })),
          h('p', { class: 'muted small' }, declared.length ? `实测场景里有 ${matched} 个和作者声明的一致；标「新建」的是共享词表里还没有的场景。` : '标「新建」的是共享词表里还没有的场景。'),
        ]
        : empty('还没有带场景的上报', '使用者的 AI 编程助手判断过调用场景并上报后，这里会和作者的说法并排显示。')));
}

function lineageTree(chainInfo, tree, currentId) {
  const nodes = api.list(tree?.nodes).filter((node) => api.isSkillId(node?.skillId));
  if (nodes.length <= 1) return empty('还没有衍生', '有人在它的基础上改出新版本并铸造时，会记录它为父 Skill，族谱就会多出一支。');
  const byId = new Map(nodes.map((node) => [node.skillId, node]));
  const row = (node, depth) => h('li', null,
    link(`/market/skills/${node.skillId}`, { class: ['tree-node', node.skillId === currentId ? 'current' : null], style: { marginLeft: `${depth * 22}px` } },
      h('span', { class: 'tree-name' }, api.str(node.name, 120) ?? `未命名 Skill`),
      h('span', { class: 'muted mono' }, `#${node.skillId} · v${api.num(node.versionCount) || 1} · ${shortAddress(node.author)}`),
      node.skillId === currentId ? h('span', { class: 'pill acc' }, '本页') : null),
    h('ul', null, api.list(node.childSkillIds).map((id) => byId.get(id)).filter(Boolean).map((child) => row(child, depth + 1))));
  const root = byId.get(tree.rootSkillId) ?? nodes[0];
  return h('div', null,
    h('ul', { class: 'tree' }, row(root, 0)),
    tree.truncated ? h('p', { class: 'muted small' }, '族谱较大，只显示了一部分。') : null,
    h('p', { class: 'muted small' }, `父子关系在铸造时写进${chainInfo ? networkName(chainInfo.chainId) : '链'}上的 Skill 资产合约，不能事后修改。`));
}

function descendants(tree, id) {
  const byId = new Map(api.list(tree?.nodes).map((node) => [node.skillId, node]));
  const out = new Set();
  const walk = (at) => { for (const child of api.list(byId.get(at)?.childSkillIds)) if (!out.has(child)) { out.add(child); walk(child); } };
  walk(id);
  return out.size;
}

function versionsTable(chainInfo, usage, skill) {
  const versions = api.list(usage?.versions).filter((version) => api.isHex32(version?.fingerprint)).sort((a, b) => api.num(b.index) - api.num(a.index));
  if (!versions.length) return h('p', { class: 'muted' }, `共 ${skill.versionCount} 个版本；最新一版发布于 ${day(skill.version?.publishedAt)}。`);
  return h('div', { class: 'table-wrap' }, h('table', null,
    h('thead', null, h('tr', null, h('th', null, '版本'), h('th', null, '发布'), h('th', { class: 'num' }, '调用'), h('th', { class: 'num' }, '钱包'), h('th', null, '内容指纹'))),
    h('tbody', null, versions.map((version, at) => h('tr', null,
      h('td', { 'data-label': '版本' }, `v${api.num(version.index) + 1}`, at === 0 ? h('span', { class: 'pill acc tiny' }, '最新') : null),
      h('td', { 'data-label': '发布' }, day(version.publishedAt)),
      h('td', { class: 'num mono', 'data-label': '调用' }, count(api.num(version.totalInvocations))),
      h('td', { class: 'num mono', 'data-label': '钱包' }, count(api.num(version.uniqueWallets))),
      h('td', { class: 'mono', 'data-label': '内容指纹', title: version.fingerprint }, shortHex(version.fingerprint)))))),
  h('p', { class: 'muted small' }, '每个版本按正文的 SHA-256 指纹登记；使用者装的是哪一版，上报时就记在哪一版上。'));
}

function chainRecords(chainInfo, skill) {
  const contracts = chainInfo?.contracts ?? {};
  const rows = [
    ['作者钱包', addressLink(chainInfo, skill.author, skill.author)],
    ['Skill 资产合约', api.isAddress(contracts.SkillRegistry) ? addressLink(chainInfo, contracts.SkillRegistry, contracts.SkillRegistry) : '—'],
    ['使用统计合约', api.isAddress(contracts.UsageStats) ? addressLink(chainInfo, contracts.UsageStats, contracts.UsageStats) : '—'],
    ['最新版本指纹', h('span', { class: 'mono' }, skill.version?.fingerprint ?? '—')],
  ];
  return h('div', null,
    h('dl', { class: 'records' }, rows.map(([label, value]) => [h('dt', null, label), h('dd', null, value)])),
    h('p', { class: 'muted small' }, api.explorer(chainInfo, 'address', skill.author)
      ? `在区块浏览器里打开合约，用 getSkill(${skill.skillId}) 可以读到作者、父 Skill、版本数和出生场景；使用统计按版本指纹读取。`
      : '本地开发链没有区块浏览器；部署到 BOT Chain 后，这些地址会链接到浏览器。'));
}

// The family a sale would be split along: this Skill's own ancestry, or, for
// a Skill with no parent but with descendants, its deepest descendant's, so
// the preview shows what this author would earn when a derived Skill sells.
function familyForSale(skill, tree) {
  const nodes = api.list(tree?.nodes).filter((node) => api.isSkillId(node?.skillId));
  const byId = new Map(nodes.map((node) => [node.skillId, node]));
  const entry = (id) => ({
    skillId: id,
    name: api.str(byId.get(id)?.name, 120) ?? (id === skill.skillId ? skillName(skill) : null),
    author: api.isAddress(byId.get(id)?.author) ? byId.get(id).author : id === skill.skillId ? skill.author : null,
  });
  const ancestry = (id) => {
    const out = [];
    for (let at = id, guard = 0; at && guard < 64; at = byId.get(at)?.parentSkillId ?? null, guard += 1) out.unshift(at);
    return out;
  };
  const own = ancestry(skill.skillId);
  if (own.length > 1 || !nodes.length) return { family: (own.length ? own : [skill.skillId]).map(entry), seller: skill.skillId };
  const below = nodes.filter((node) => node.skillId !== skill.skillId && ancestry(node.skillId).includes(skill.skillId))
    .sort((a, b) => api.num(b.depth) - api.num(a.depth));
  if (!below.length) return { family: [entry(skill.skillId)], seller: skill.skillId };
  const path = ancestry(below[0].skillId);
  return { family: path.slice(path.indexOf(skill.skillId)).map(entry), seller: below[0].skillId };
}

function stage2Teaser(skill, tree) {
  const { family, seller } = familyForSale(skill, tree);
  const sold = family.at(-1);
  const text = family.length === 1
    ? '它还没有上游，也没有衍生：示例收入全部归作者。有人在它基础上衍生并卖出时，它的作者会按链上比例分到一份。价格和比例是示例。'
    : seller === skill.skillId
      ? '族谱是真实的；价格和比例是示例。阶段 2 里，每卖出一次，钱会在同一笔交易里沿族谱拆给每一位上游作者。'
      : `族谱是真实的：下面是它的衍生${sold.name ? `「${sold.name}」` : ' '}#${sold.skillId} 卖出一次时，这个 Skill 的作者能分到多少。价格和比例是示例。`;
  return h('section', { class: 'panel stage2-panel' },
    h('div', { class: 'panel-head' }, h('h2', null, seller === skill.skillId ? '如果它上架' : '如果它的衍生上架'), h('span', { class: 'pill stage2' }, '阶段 2 预览')),
    h('p', { class: 'fg2' }, text),
    splitFlow(exampleSplit(family), 0.5, skill.skillId),
    h('div', { class: 'row-end' }, link(`/market/stage-2?skill=${seller}`, { class: 'btn' }, '看完整的阶段 2 预览 →')));
}

export async function renderDetail(root, id) {
  replace(root, loading());
  const [chainResult, skillResult, usageResult, lineageResult] = await Promise.allSettled([api.chain(), api.skill(id), api.usage(id), api.lineage(id)]);
  if (skillResult.status === 'rejected') {
    replace(root, link('/market', { class: 'back' }, '← Skill 市场'), failure(skillResult.reason.status === 404 ? { status: 404, message: `这条链上没有 Skill #${id}。` } : skillResult.reason));
    return;
  }
  const chainInfo = chainResult.status === 'fulfilled' ? chainResult.value : null;
  const raw = skillResult.value;
  if (!api.isAddress(raw.author)) {
    replace(root, failure({ message: '在线服务返回的 Skill 记录不完整。' }));
    return;
  }
  const skill = {
    skillId: id,
    author: raw.author,
    parentSkillId: api.isSkillId(raw.parentSkillId) ? raw.parentSkillId : null,
    createdAt: api.str(raw.createdAt, 40),
    birthScenes: api.list(raw.birthScenes).filter((tag) => typeof tag === 'string'),
    versionCount: api.num(raw.versionCount) || 1,
    version: raw.version && api.isHex32(raw.version.fingerprint) ? { fingerprint: raw.version.fingerprint, publishedAt: api.str(raw.version.publishedAt, 40) } : null,
    content: raw.content ? { name: api.str(raw.content.name, 120), description: api.str(raw.content.description, 1024) } : null,
  };
  skill.name = skill.content?.name ?? null;
  const usage = usageResult.status === 'fulfilled' ? usageResult.value : null;
  const tree = lineageResult.status === 'fulfilled' ? lineageResult.value : null;
  const parent = skill.parentSkillId ? api.list(tree?.nodes).find((node) => node?.skillId === skill.parentSkillId) : null;
  document.title = `${title(skill)} · Obelisk Skill 市场`;

  const results = usage?.results ?? null;
  const judged = api.num(results?.judged);
  const derivedCount = tree ? descendants(tree, id) : null;
  const reported = ago(usage?.lastReportAt);
  const versionName = `v${skill.versionCount}`;
  const promptName = skill.name ? `Skill #${id}「${skill.name}」${versionName}` : `Skill #${id} ${versionName}`;

  replace(root,
    link('/market', { class: 'back' }, '← Skill 市场'),
    h('section', { class: 'detail-head' },
      h('div', { class: 'eyebrow' }, `Skill #${id}`),
      h('h1', null, title(skill)),
      h('div', { class: 'meta' },
        h('span', { class: 'pill dim' }, versionName),
        h('span', null, '作者 ', addressLink(chainInfo, skill.author)),
        h('span', null, `铸造于 ${day(skill.createdAt)}`),
        skill.parentSkillId ? link(`/market/skills/${skill.parentSkillId}`, { class: 'pill acc' }, `基于 Skill #${skill.parentSkillId}${api.str(parent?.name, 120) ? `「${parent.name}」` : ''}`) : null,
        chainInfo ? h('span', { class: 'pill chain' }, `可在${networkName(chainInfo.chainId)}上核对`) : null),
      skill.content?.description ? h('p', { class: 'lead' }, skill.content.description) : null),

    usage
      ? h('div', { class: 'kpis' },
        kpi('真实调用', count(api.num(usage.totalInvocations)), api.num(usage.totalInvocations) === 0 ? '还没有使用上报' : `来自 ${count(api.num(usage.uniqueWallets))}${usage.uniqueWalletsExact === false ? '+' : ''} 个钱包${reported ? ` · 最近上报 ${reported}` : ''}`),
        kpi('顺利率', judged > 0 && typeof results.smoothRate === 'number' ? percent(results.smoothRate) : '—', judged > 0 ? `基于 ${count(judged)} 次判断过的调用` : '还没有判断过的调用', judged > 0 && results.smoothRate >= 0.8 ? 'good' : null),
        kpi('衍生', derivedCount === null ? '—' : count(derivedCount), derivedCount ? '个 Skill 在它基础上铸造' : '还没有人在它基础上衍生'),
        kpi('版本', count(skill.versionCount), `最新一版 ${day(skill.version?.publishedAt)}`))
      : failure(usageResult.reason),

    h('div', { class: 'grid-2' },
      panel('近 8 周上报的调用', '按在线服务收到上报的时间分周', usage ? trendChart(usage.trend) : failure(usageResult.reason)),
      panel('调用结果', judged > 0 ? `${count(judged)} 次判断过` : null, usage ? resultBar(results) : failure(usageResult.reason))),

    panel('作者的描述与实测场景', '左边是作者铸造时写的，右边来自真实调用', scenesCompare(skill, usage)),

    h('div', { class: 'grid-2' },
      panel('族谱', tree ? `${api.list(tree.nodes).length} 个 Skill` : null, tree ? lineageTree(chainInfo, tree, id) : failure(lineageResult.reason)),
      panel('版本', null, versionsTable(chainInfo, usage, skill))),

    panel('用它，或在它基础上改', '需要电脑上装好 Obelisk',
      h('div', { class: 'prompts' },
        promptBox('取用', { skill: 'obelisk-skill-assets', text: `取用 ${promptName}，帮我：` }),
        promptBox('在此基础上修改', { skill: 'obelisk-distill', text: `在 ${promptName} 的基础上改出一个新版本，铸造时记录父 Skill。我想改成：` })),
      h('p', { class: 'muted small' }, '复制后粘贴到 Claude Code 或 Codex，在冒号后面写上你要做的事。取用前会先给你看预览并核对指纹；衍生的新 Skill 铸造时会把它记为父 Skill。')),

    stage2Teaser(skill, tree),

    panel('链上记录', null, chainRecords(chainInfo, { ...skill, skillId: id })));
}
