// The investor preview page (/preview, #33): plays story.json step by step.
// Each step shows the screens of the roles involved side by side, the
// on-chain timeline up to that step, and a role switcher. State lives in the
// query string (?step=3&role=B) so a link opens on the same view.
// Everything is built with DOM calls (no innerHTML), and the page reads only
// files next to it and this service's GET /v1/chain.

import { showNetwork } from '/site/site.js';
import { explorerTxUrl, loadStory, runPageUrl, stepsOfRole, timelineUpTo } from '/preview/story.js';

const $ = (id) => document.getElementById(id);

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
    else node.setAttribute(key, value === true ? '' : String(value));
  }
  for (const child of children.flat()) if (child !== null && child !== undefined && child !== false) node.append(child);
  return node;
}

const state = { story: null, step: 0, role: null };

// --- Pane blocks ----------------------------------------------------------

/** Text with ⟦…⟧ marking what the privacy check covered. */
function richText(text) {
  const parts = String(text ?? '').split(/(⟦[^⟧]*⟧)/);
  return parts.filter(Boolean).map((part) => (part.startsWith('⟦') ? el('span', { class: 'pv-redact', text: `[${part.slice(1, -1)} 已遮盖]` }) : part));
}

function pill(spec, extra = '') {
  return el('span', { class: `pv-pill ${spec.tone ?? 'dim'} ${extra}`.trim(), text: spec.text });
}

const BLOCKS = {
  msg: (block) => el('div', { class: `pv-msg ${['user', 'asst', 'tool'].includes(block.from) ? block.from : 'asst'}` },
    block.who ? el('div', { class: 'pv-who', text: block.who }) : null,
    richText(block.text)),
  row: (block) => el('div', { class: `pv-row${block.hl ? ' pv-hl' : ''}` },
    el('span', { text: block.text }), block.pill ? pill(block.pill) : null),
  pill: (block) => pill(block, `pv-pill-line${block.hl ? ' pv-hl' : ''}`),
  note: (block) => el('p', { class: 'pv-blocknote', text: block.text }),
  kv: (block) => el('dl', { class: 'pv-kv' }, (block.items ?? []).flatMap(([key, value]) => [el('dt', { text: key }), el('dd', { text: value })])),
  denied: (block) => el('div', { class: 'pv-denied' },
    el('span', { class: 'pv-denied-icon', 'aria-hidden': 'true', text: '×' }),
    el('b', { text: block.title }), el('span', { class: 'pv-blocknote', text: block.text })),
  stats: (block) => el('div', { class: 'pv-stats' }, (block.items ?? []).map((item) =>
    el('div', { class: 'pv-stat' }, el('b', { text: item.value }), el('span', { text: item.label })))),
  bars: (block) => el('div', { class: 'pv-bars' }, (block.items ?? []).map((item) => {
    const fill = el('i', { class: 'pv-fill' });
    fill.style.width = `${Math.max(0, Math.min(100, (Number(item.value) / Number(item.max || 1)) * 100))}%`;
    return el('div', { class: 'pv-barrow' }, el('span', { text: item.label }), el('span', { class: 'pv-track' }, fill), el('b', { text: item.text ?? String(item.value) }));
  })),
  tree: (block) => el('div', { class: 'pv-tree' }, (block.items ?? []).map((item) =>
    el('div', { class: `pv-node d${item.depth ? 1 : 0}${item.hl ? ' pv-hl' : ''}` }, el('span', { text: item.text }), el('span', { text: item.note ?? '' })))),
};

function roleById(id) {
  return state.story.roles.find((role) => role.id === id);
}

function pane(screen, index) {
  const role = roleById(screen.role);
  const body = el('div', { class: 'pv-pane-b' });
  if (screen.image) {
    body.append(el('figure', {}, el('img', { src: screen.image, alt: screen.caption ?? screen.where ?? '', loading: 'lazy' }), screen.caption ? el('figcaption', { text: screen.caption }) : null));
  } else {
    for (const block of screen.blocks ?? []) {
      const render = BLOCKS[block.t];
      if (render) body.append(render(block));
    }
  }
  if (screen.illustrative) body.append(el('span', { class: 'pv-pane-tag', text: '示意画面' }));
  return el('article', { class: 'pv-pane enter', 'aria-label': `${role?.label ?? screen.role} · ${screen.where ?? ''}`, 'data-index': index },
    el('div', { class: 'pv-pane-h' },
      el('span', {}, el('span', { class: 'pv-pane-who', text: role?.label ?? screen.role }), el('span', { class: 'pv-pane-where', text: screen.where ? ` · ${screen.where}` : '' })),
      el('span', { class: 'mono muted', text: role?.wallet ?? (role?.count ? `${role.count} 个钱包` : '') })),
    body);
}

/** When the chosen role is not in this step: where it does appear. */
function absentPane(roleId) {
  const role = roleById(roleId);
  const steps = [...stepsOfRole(state.story, roleId)];
  return el('article', { class: 'pv-pane pv-absent enter' },
    el('div', { class: 'pv-pane-h' }, el('span', { class: 'pv-pane-who', text: role.label })),
    el('div', { class: 'pv-pane-b' },
      el('p', { text: `这一步里没有「${role.label}」的画面。` }),
      steps.length > 0 ? el('div', { class: 'pv-jumps' }, steps.map((index) =>
        el('button', { type: 'button', class: 'pv-jump', text: `第 ${index + 1} 步`, onclick: () => go(index) }))) : null,
      el('button', { type: 'button', class: 'pv-jump', text: '看全部角色', onclick: () => pick(null) })));
}

// --- Timeline -------------------------------------------------------------

function record(entry) {
  if (!entry.tx) return el('span', { class: 'pv-rec-none', text: '无交易' });
  const url = explorerTxUrl(entry.tx);
  const count = entry.count ? el('span', { class: 'pv-count-x', text: `×${entry.count}` }) : null;
  if (url) return el('span', {}, el('a', { href: url, target: '_blank', rel: 'noopener noreferrer', title: entry.tx.hash, text: `${entry.tx.hash.slice(0, 8)}… ↗` }), count);
  return el('span', {}, el('span', { class: 'pv-rec-demo', text: '交易 · 示意' }), count);
}

function renderTimeline() {
  const rows = $('pv-tl-rows');
  const entries = timelineUpTo(state.story, state.step);
  rows.replaceChildren(...entries.map((entry) => {
    const now = entry.stepIndex === state.step;
    const other = state.role && entry.role !== state.role;
    return el('tr', { class: [now ? 'now' : 'past', other ? 'other' : ''].join(' ').trim() },
      el('td', { class: 'at', text: entry.at ?? '' }),
      el('td', { class: 'who', text: roleById(entry.role)?.label ?? entry.role }),
      el('td', { class: 'act', text: entry.text }),
      el('td', { class: 'rec' }, record(entry)));
  }));
  const fresh = entries.filter((entry) => entry.stepIndex === state.step).length;
  $('pv-tl-empty').hidden = fresh > 0;
  const onChain = entries.filter((entry) => entry.tx).reduce((sum, entry) => sum + (entry.count ?? 1), 0);
  $('pv-tl-legend').textContent = `到这一步为止 ${onChain} 笔链上记录`;
}

// --- Steps and roles ------------------------------------------------------

function renderSteps() {
  const withRole = state.role ? stepsOfRole(state.story, state.role) : null;
  $('pv-steps').replaceChildren(...state.story.steps.map((step, index) => el('li', {},
    el('button', {
      type: 'button',
      class: ['pv-step-btn', index < state.step ? 'done' : '', withRole && !withRole.has(index) ? 'dim' : '', withRole?.has(index) ? 'has-role' : ''].join(' ').trim(),
      'aria-current': index === state.step ? 'step' : null,
      onclick: () => go(index),
    }, el('span', { class: 'pv-k', text: index < state.step ? '✓' : String(index + 1) }), el('span', { text: step.title })))));
}

function renderRoles() {
  const step = state.story.steps[state.step];
  const inStep = new Set([...(step.roles ?? []), ...step.screens.map((screen) => screen.role)]);
  const all = { id: null, label: '全部角色' };
  $('pv-roles').replaceChildren(...[all, ...state.story.roles].map((role) => el('button', {
    type: 'button',
    class: `pv-role${role.id && inStep.has(role.id) ? ' in-step' : ''}`,
    'aria-pressed': String(state.role === role.id),
    onclick: () => pick(role.id),
  },
  el('span', { text: role.label }),
  el('span', { class: 'addr', text: role.id === null ? '' : role.wallet ?? (role.count ? `${role.count} 个钱包` : '') }),
  role.about && state.role === role.id ? el('span', { class: 'about', text: role.about }) : null)));
  $('pv-rolebar').replaceChildren(...[all, ...state.story.roles].map((role) => el('button', {
    type: 'button', class: 'pv-chip', 'aria-pressed': String(state.role === role.id), text: role.label, onclick: () => pick(role.id),
  })));
}

function renderStep() {
  const { story } = state;
  const step = story.steps[state.step];
  $('pv-count').textContent = `步骤 ${state.step + 1} / ${story.steps.length}`;
  $('pv-prev').disabled = state.step === 0;
  $('pv-next').disabled = state.step === story.steps.length - 1;
  $('pv-step-n').textContent = String(state.step + 1);
  $('pv-step-title').textContent = step.title;
  $('pv-step-point').textContent = step.point ?? '';
  const prov = $('pv-step-prov');
  if (step.provenance) {
    const harness = step.provenance.harness ? ` · ${step.provenance.harness.kind}${step.provenance.harness.model ? ` ${step.provenance.harness.model}` : ''}` : '';
    const page = runPageUrl(step.provenance);
    prov.replaceChildren(
      `出处：运行 ${step.provenance.runId} · 步骤 ${step.provenance.steps.map((item) => item.id).join('、')} · ${step.provenance.sessions} 个 session${harness}`,
      ...(page ? [' · ', el('a', { class: 'pv-run-link', href: page }, '查看这次运行的记录 →')] : []),
    );
    prov.hidden = false;
  } else {
    prov.hidden = true;
  }
  const screens = state.role ? step.screens.filter((screen) => screen.role === state.role) : step.screens;
  $('pv-screens').replaceChildren(...(screens.length > 0 ? screens.map(pane) : [absentPane(state.role)]));
  renderTimeline();
  renderSteps();
  renderRoles();
}

function syncUrl() {
  const params = new URLSearchParams(location.search);
  if (state.step > 0) params.set('step', String(state.step + 1));
  if (state.role) params.set('role', state.role);
  const query = params.toString();
  history.replaceState(null, '', `${location.pathname}${query ? `?${query}` : ''}`);
}

function go(index) {
  const next = Math.max(0, Math.min(state.story.steps.length - 1, index));
  if (next === state.step) return;
  state.step = next;
  renderStep();
  syncUrl();
}

function pick(roleId) {
  state.role = roleId;
  renderStep();
  syncUrl();
}

function renderSource() {
  const { source } = state.story;
  const real = source.kind === 'playground-run';
  const label = source.label ?? (real ? '真实运行' : '示意内容');
  for (const id of ['pv-source-label', 'pv-bar-label']) {
    $(id).textContent = label;
    $(id).classList.toggle('real', real);
  }
  const run = source.run;
  const details = run ? ` 运行 ${run.id}${run.network ? ` · ${run.network}` : ''}${run.gitCommit ? ` · 代码 ${run.gitCommit}` : ''}。` : '';
  $('pv-source-note').replaceChildren(source.note ?? '', details,
    run?.record ? el('a', { href: run.record.startsWith('/runs/') ? run.record.replace(/\/provenance\.json$/, '') : `/preview/${run.record}`, text: ' 查看出处记录' }) : '');
  $('pv-source').classList.toggle('real', real);
  $('pv-source').hidden = false;
  $('pv-roles-note').textContent = real
    ? '截图和交易来自 Playground 真实运行；仍为示意的画面单独标出。'
    : '预览中的界面和数据为示意。Playground 场景一跑出真实运行后，换成真实截图和数据，并附出处。';
}

function fromQuery() {
  const params = new URLSearchParams(location.search);
  const step = Number(params.get('step'));
  state.step = Number.isInteger(step) && step >= 1 && step <= state.story.steps.length ? step - 1 : 0;
  const role = params.get('role');
  state.role = role && state.story.roles.some((item) => item.id === role) ? role : null;
}

async function fetchJson(url) {
  const response = await fetch(url, { headers: { accept: 'application/json' }, cache: 'no-cache' });
  if (!response.ok) throw new Error(`读取 ${url} 失败（HTTP ${response.status}）`);
  return response.json();
}

async function start() {
  showNetwork();
  try {
    state.story = await loadStory(fetchJson);
  } catch (error) {
    $('pv-status').classList.add('error');
    $('pv-status-text').textContent = `剧本没有读出来：${error instanceof Error ? error.message : String(error)}。请稍后刷新。`;
    return;
  }
  $('pv-title').textContent = state.story.title ?? '演示闭环';
  renderSource();
  fromQuery();
  $('pv-prev').addEventListener('click', () => go(state.step - 1));
  $('pv-next').addEventListener('click', () => go(state.step + 1));
  document.addEventListener('keydown', (event) => {
    if (event.altKey || event.ctrlKey || event.metaKey || event.target instanceof HTMLInputElement) return;
    if (event.key === 'ArrowRight') { event.preventDefault(); go(state.step + 1); }
    if (event.key === 'ArrowLeft') { event.preventDefault(); go(state.step - 1); }
  });
  $('pv-status').hidden = true;
  $('pv-stage').hidden = false;
  renderStep();
}

start();
