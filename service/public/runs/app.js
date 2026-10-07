// The Playground run page (/runs/<id>, #32; docs/vision/09 G3–G5): one run's
// progress, events, key screenshots and provenance record, with every
// transaction checked on chain through this service's GET /v1/txs.
//
// The same page serves a published run (files under /runs/<id>/ on this
// service) and a run in progress on the Playground's local live server, which
// serves the run directory at the same paths; while the record says the run
// is going, the page reads it again every few seconds.
//
// Everything is built with DOM calls, never from HTML strings; the page reads only files
// next to it and this service's GET /v1/chain and GET /v1/txs.

import { loadChain, showNetwork } from '/site/site.js';
import {
  CHECK, PUBLISHED_SCHEMA, actionLabel, addressUrl, artifactLabel, chainLabel, checkRecord, checkState, checkSummary,
  commandLine, currentStep, elapsedMs, eventFeed, eventProduct, eventTone, formatClock, formatDateTime, formatElapsed,
  harnessLabel, hashesToCheck, isRunId, networkLabel, parseEvents, roleLabels, runArtifacts, runFailure, runIdOfPath,
  runStatus, shortAddress, shortHash, shortRunId, skillUrl, stepProgress, stepStatusLabel, txCheckOf, txUrl,
} from '/runs/model.js';

const LIVE_POLL_MS = 2_000;
const CHECK_EVERY_MS = 8_000;
const MAX_PER_CHECK = 50;

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

const external = (href, attrs, ...children) => el('a', { href, target: '_blank', rel: 'noopener noreferrer', ...attrs }, ...children);

const state = {
  runId: null,
  record: null,
  events: [],
  skipped: 0,
  published: null,
  raw: '',
  updatedAt: null,
  seenSeq: 0,
  freshFrom: Infinity,
  step: null,
  open: { roles: false, tasks: false, ai: false, products: false },
  chain: undefined,
  checks: new Map(),
  checkedAt: 0,
  checking: false,
};

// --- Loading -----------------------------------------------------------------

async function fetchText(path) {
  const response = await fetch(path, { cache: 'no-cache' });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`读取 ${path} 失败（HTTP ${response.status}）`);
  return response.text();
}

function showStatus(text, error = false) {
  const box = $('rn-status-box');
  box.hidden = false;
  box.classList.toggle('error', error);
  $('rn-status-text').textContent = text;
}

async function loadRun() {
  const base = `/runs/${state.runId}/`;
  const [recordText, eventsText] = await Promise.all([fetchText(`${base}provenance.json`), fetchText(`${base}events.jsonl`)]);
  if (recordText === null) {
    showStatus(`没有这次运行：${state.runId}。它可能还没有发布，或者链接有误。`, true);
    return false;
  }
  const raw = `${recordText}\u0000${eventsText ?? ''}`;
  if (raw === state.raw) return true;
  let parsed;
  try {
    parsed = JSON.parse(recordText);
  } catch {
    if (state.record) return true; // half-written while the runner rewrites it; keep the last good one
    showStatus('这次运行的出处记录读不出来（不是有效的 JSON）。', true);
    return false;
  }
  const checked = checkRecord(parsed);
  if (!checked.ok) {
    showStatus(`这次运行的出处记录读不出来：${checked.error}`, true);
    return false;
  }
  if (checked.record.run.id !== state.runId) {
    showStatus('出处记录里的运行 id 和链接不一致，没有显示。', true);
    return false;
  }
  const { events, skipped } = parseEvents(eventsText ?? '', state.runId);
  const newest = events.at(-1)?.seq ?? 0;
  state.freshFrom = state.seenSeq ? state.seenSeq + 1 : Infinity;
  state.seenSeq = newest;
  state.raw = raw;
  state.record = checked.record;
  state.events = events;
  state.skipped = skipped;
  state.updatedAt = Date.now();
  return true;
}

async function loadPublished() {
  try {
    const text = await fetchText(`/runs/${state.runId}/published.json`);
    const value = text ? JSON.parse(text) : null;
    state.published = value?.schema === PUBLISHED_SCHEMA && value.runId === state.runId ? value : null;
  } catch {
    state.published = null;
  }
}

// --- On-chain check ------------------------------------------------------------

async function runChecks(force = false) {
  const record = state.record;
  if (!record || state.checking) return;
  if (state.chain === undefined) state.chain = await loadChain();
  const mode = checkState(record, state.chain, state.checks).mode;
  if (mode !== 'checking') return;
  const hashes = hashesToCheck(runArtifacts(record).transactions, state.checks, record.run.status === 'running');
  if (!hashes.length) return;
  // A transaction never asked about goes at once; the rest wait their turn.
  const unasked = hashes.some((hash) => !state.checks.has(hash));
  if (!force && !unasked && Date.now() - state.checkedAt < CHECK_EVERY_MS) return;
  state.checking = true;
  state.checkedAt = Date.now();
  try {
    for (let i = 0; i < hashes.length; i += MAX_PER_CHECK) {
      const chunk = hashes.slice(i, i + MAX_PER_CHECK);
      const response = await fetch(`/v1/txs?hashes=${chunk.join(',')}`, { headers: { accept: 'application/json' } });
      const body = response.ok ? await response.json() : null;
      if (!body || body.chainId !== record.run.network.chainId || !Array.isArray(body.transactions)) {
        for (const hash of chunk) if (!state.checks.has(hash)) state.checks.set(hash, { hash, status: 'unavailable' });
        continue;
      }
      for (const tx of body.transactions) if (typeof tx?.hash === 'string' && CHECK[tx.status]) state.checks.set(tx.hash.toLowerCase(), tx);
    }
  } catch {
    for (const hash of hashes) if (!state.checks.has(hash)) state.checks.set(hash, { hash, status: 'unavailable' });
  } finally {
    state.checking = false;
  }
  renderChecks();
}

// --- Rendering: pieces --------------------------------------------------------

const roleName = (id) => (id ? roleLabels(state.record).get(id) ?? id : '');
const stepById = (id) => state.record.steps.find((step) => step.id === id) ?? null;
const chainId = () => state.record.run.network?.chainId ?? null;
const shotSrc = (file) => `/runs/${state.runId}/${file}`;
const checkNow = () => checkState(state.record, state.chain, state.checks);

function pill(text, tone, attrs = {}) {
  return el('span', { class: `rn-pill ${tone}`, ...attrs }, text);
}

/** The badge next to a transaction: 已核对, 未找到, … */
function checkBadge(hash) {
  const key = txCheckOf(checkNow(), hash);
  if (!key) return null;
  const spec = CHECK[key];
  const result = state.checks.get(String(hash).toLowerCase());
  const detail = result?.blockNumber ? ` · 区块 ${result.blockNumber}${result.timestamp ? ` · ${formatDateTime(result.timestamp)}` : ''}${result.contract ? ` · ${result.contract}` : ''}` : '';
  return el('span', { class: `rn-check ${spec.tone}`, 'data-check': key, title: `${spec.title}${detail}` },
    key === 'confirmed' ? el('span', { class: 'rn-tick', 'aria-hidden': 'true' }) : null, spec.label);
}

function txLink(tx, label) {
  const href = txUrl(tx.chainId ?? chainId(), tx.hash);
  return href
    ? external(href, { class: 'rn-chain mono', title: tx.hash }, label ?? `${shortHash(tx.hash)} ↗`)
    : el('span', { class: 'mono rn-off', title: tx.hash }, shortHash(tx.hash));
}

function openShot(shot) {
  const dialog = $('rn-lightbox');
  $('rn-lightbox-img').src = shotSrc(shot.file);
  $('rn-lightbox-img').alt = shot.caption;
  $('rn-lightbox-cap').textContent = `${shot.caption} · 第 ${shot.step.index + 1} 步 · ${roleName(shot.step.role)}`;
  if (typeof dialog.showModal === 'function') dialog.showModal();
}

function selectStep(id, scroll = false) {
  state.step = state.step === id ? null : id;
  const params = new URLSearchParams(location.search);
  if (state.step) params.set('step', state.step); else params.delete('step');
  const query = params.toString();
  history.replaceState(null, '', `${location.pathname}${query ? `?${query}` : ''}`);
  renderSteps();
  renderEvents();
  if (scroll) document.querySelector('.rn-events-card')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function openProvenance(row) {
  state.open[row] = true;
  renderProvenance();
  document.querySelector(`[data-prov="${row}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

// --- Rendering: sections ------------------------------------------------------

function renderHead() {
  const { record, published } = state;
  const run = record.run;
  document.title = `${run.scenario.title} · Playground 运行记录 · Obelisk`;
  $('rn-title').textContent = run.scenario.title;
  const fixture = published?.fixture === true || /^fixture-/.test(run.id);
  $('rn-source').replaceChildren(
    fixture ? pill('示例数据', 'warn')
      : published ? pill(`已发布 · ${formatDateTime(published.publishedAt)}`, 'ok')
        : pill(run.status === 'running' ? '本机 · 实时' : '本机', 'acc'),
  );
  const meta = [
    `开始 ${formatDateTime(run.startedAt)}`,
    run.endedAt ? `结束 ${formatDateTime(run.endedAt)}` : null,
    el('span', {}, '剧本 ', el('span', { class: 'mono', title: `sha256 ${run.scenario.sha256}` }, `${run.scenario.file} · ${String(run.scenario.sha256 ?? '').slice(0, 8)}`)),
    run.obelisk?.gitCommit ? el('span', {}, 'Obelisk ', el('span', { class: 'mono' }, run.obelisk.gitCommit)) : null,
  ].filter(Boolean);
  $('rn-meta').replaceChildren(...meta.flatMap((item, i) => (i ? [el('span', { class: 'rn-dot', 'aria-hidden': 'true' }), item] : [item])));
  $('rn-bar-id').textContent = shortRunId(run.id);
  $('rn-bar-id').title = run.id;
  $('rn-network').textContent = networkLabel(record);
  $('rn-network').className = `rn-pill ${run.dryRun || !run.network?.chainId ? 'dim' : 'chain'}`;
}

function renderClock() {
  const { record } = state;
  if (!record) return;
  const status = runStatus(record, state.updatedAt);
  const badge = $('rn-status');
  badge.className = `rn-pill ${status.tone}`;
  badge.dataset.runStatus = status.key;
  badge.replaceChildren(...[
    status.key === 'running' ? el('span', { class: 'rn-live-dot', 'aria-hidden': 'true' }) : null,
    status.label,
    el('span', { class: 'mono' }, formatElapsed(elapsedMs(record))),
  ].filter(Boolean));
  const now = currentStep(record);
  $('rn-bar-note').textContent = now ? `正在进行第 ${now.index + 1} 步 · ${roleName(now.role)}` : '';
}

function banner(tone, title, text, key) {
  return el('div', { class: `rn-banner ${tone}`, 'data-banner': key }, el('strong', {}, title), el('span', {}, text));
}

function renderBanners() {
  const { record, published } = state;
  const list = [];
  if (published?.fixture === true || /^fixture-/.test(record.run.id)) {
    list.push(banner('warn', '示例数据，不是真实运行', '这是开发这个页面用的样例：步骤、截图和交易哈希都是编出来的，所以链上核对会显示「未找到」。真实运行发布后，同一个页面显示它的数据。', 'fixture'));
  }
  if (record.run.dryRun) {
    list.push(banner('warn', '空跑', '所有角色都用模拟助手：没有调用模型，也没有上链。这次运行只验证流水线，它的数据不是真实数据。', 'dry-run'));
  }
  const status = runStatus(record, state.updatedAt);
  if (status.key === 'quiet') list.push(banner('warn', `已经 ${status.label}`, '出处记录还写着「运行中」，但执行器可能已经退出。', 'quiet'));
  const failure = runFailure(record, state.events);
  if (failure) {
    list.push(banner('danger', failure.step ? `第 ${failure.step.index + 1} 步失败：${failure.step.title}` : '运行失败', failure.error || '执行器没有记录原因。', 'failed'));
  }
  $('rn-banners').replaceChildren(...list);
}

function renderChecks() {
  const { record } = state;
  if (!record) return;
  const products = runArtifacts(record);
  const check = checkNow();
  const summary = checkSummary(check, products.transactions);
  const box = $('rn-proof');
  box.hidden = summary.mode === 'none';
  box.className = 'rn-proof';
  if (summary.mode === 'offline' || summary.mode === 'other-chain') {
    box.classList.add('dim');
    box.replaceChildren(
      el('div', { class: 'rn-proof-main' },
        el('span', { class: 'rn-proof-icon', 'aria-hidden': 'true', text: '?' }),
        el('div', {},
          el('strong', {}, '链上核对暂时做不了'),
          el('p', {}, summary.mode === 'offline'
            ? '没有连上在线服务，无法查询链上数据。下面每笔交易仍然可以点开，在区块浏览器里自己核对。'
            : `这个服务连接的是 ${chainLabel(check.serviceChain)}，这次运行在 ${chainLabel(check.runChain)} 上。下面每笔交易可以点开，在区块浏览器里自己核对。`))));
  } else if (summary.mode === 'checking') {
    const bad = summary.not_found + summary.reverted;
    const tone = summary.total === 0 ? 'dim' : bad ? 'danger' : summary.done && summary.confirmed === summary.total ? 'ok' : 'dim';
    box.classList.add(tone);
    const headline = summary.total === 0 ? '这次运行没有产生链上交易'
      : bad ? `${bad} 笔交易没有通过链上核对`
        : summary.confirmed === summary.total ? `${summary.total} 笔链上交易全部核对通过`
          : summary.checking === summary.total ? `正在向链上核对 ${summary.total} 笔交易…`
            : `已核对 ${summary.confirmed} / ${summary.total} 笔链上交易`;
    const parts = ['confirmed', 'pending', 'reverted', 'not_found', 'unavailable', 'checking']
      .filter((key) => summary[key])
      .map((key) => el('span', { class: `rn-check ${CHECK[key].tone}` }, key === 'confirmed' ? el('span', { class: 'rn-tick', 'aria-hidden': 'true' }) : null, `${CHECK[key].label} ${summary[key]}`));
    box.replaceChildren(
      el('div', { class: 'rn-proof-main' },
        el('span', { class: 'rn-proof-icon', 'aria-hidden': 'true', text: tone === 'ok' ? '✓' : tone === 'danger' ? '!' : '…' }),
        el('div', {},
          el('strong', { 'data-proof': tone }, headline),
          el('p', {}, `本页通过这个服务向 ${chainLabel(record.run.network.chainId)} 查询每笔交易：链上存在、执行成功，并记下区块和时间。每个哈希都链接到区块浏览器，可以自己再查一遍。`))),
      ...(parts.length ? [el('div', { class: 'rn-proof-counts' }, parts)] : []),
    );
  }
  // Badges next to transactions elsewhere on the page.
  for (const node of document.querySelectorAll('[data-check-for]')) node.replaceChildren(checkBadge(node.dataset.checkFor) ?? '');
  renderCounters();
}

function renderSteps() {
  const { record } = state;
  const progress = stepProgress(record);
  $('rn-progress').textContent = `${progress.done} / ${progress.total}`;
  $('rn-steps').replaceChildren(...record.steps.map((step) => {
    const shots = step.screenshots.filter((shot) => /^screenshots\//.test(shot.file));
    return el('li', { class: `rn-step ${step.status}${state.step === step.id ? ' selected' : ''}`, 'data-step': step.id },
      el('button', {
        type: 'button', class: 'rn-step-btn', 'aria-pressed': String(state.step === step.id),
        title: state.step === step.id ? '显示全部事件' : '只看这一步的事件', onclick: () => selectStep(step.id),
      },
      el('span', { class: 'rn-k' }, step.status === 'succeeded' ? el('span', { class: 'rn-tick', 'aria-hidden': 'true' }) : String(step.index + 1)),
      el('span', { class: 'rn-step-body' },
        el('span', { class: 'rn-step-title', translate: 'no' }, step.title),
        el('span', { class: 'rn-step-meta' },
          el('span', {}, roleName(step.role)),
          el('span', {}, actionLabel(step.action)),
          !['succeeded', 'pending'].includes(step.status) ? el('span', { class: 'rn-step-status' }, stepStatusLabel(step.status)) : null,
          step.sessions.length ? el('span', { class: 'mono' }, `${step.sessions.length} session`) : null,
          step.transactions.length ? el('span', { class: 'mono rn-tx' }, `${step.transactions.length} 交易`) : null))),
      shots.map((shot) => el('button', {
        type: 'button', class: 'rn-step-shot', title: `${shot.caption} · 点开看大图`, onclick: () => openShot({ ...shot, step }),
      }, el('img', { src: shotSrc(shot.file), alt: '', loading: 'lazy' }), el('span', {}, shot.caption))));
  }));
}

function productCell(event) {
  const product = eventProduct(event);
  if (product.kind === 'session') {
    return el('span', { class: 'rn-off', title: `${product.session.obeliskId}\n会话内容留在${roleName(event.role) || '这个角色'}的电脑上，不随记录发布。` }, 'session');
  }
  if (product.kind === 'transaction') {
    const tx = product.transaction;
    const href = txUrl(tx.chainId ?? chainId(), tx.hash);
    return el('span', { class: 'rn-product-tx' },
      el('span', { 'data-check-for': tx.hash.toLowerCase() }, checkBadge(tx.hash) ?? ''),
      href ? external(href, { class: 'rn-chain', title: tx.hash }, '交易 ↗') : el('span', { class: 'mono rn-off', title: tx.hash }, shortHash(tx.hash)));
  }
  if (product.kind === 'screenshot') {
    const step = stepById(event.stepId);
    return el('button', { type: 'button', class: 'rn-link', onclick: () => openShot({ ...product.screenshot, step: step ?? { index: 0, role: event.role } }) }, '截图');
  }
  if (product.kind === 'skill') return el('a', { class: 'rn-link', href: skillUrl(product.artifact) }, `Skill #${product.artifact.ref}`);
  if (product.kind === 'exit') return el('span', { class: 'rn-warn mono' }, `退出码 ${product.exitCode}`);
  if (product.kind === 'failed') return el('span', { class: 'rn-warn' }, '失败');
  return el('span', { class: 'rn-off' }, '本机');
}

function renderEvents() {
  const { record, events } = state;
  const feed = eventFeed(events, state.step);
  const count = $('rn-events-count');
  if (state.step && stepById(state.step)) {
    count.replaceChildren(el('button', { type: 'button', class: 'rn-filter', onclick: () => selectStep(state.step) },
      `只看第 ${stepById(state.step).index + 1} 步`, el('span', { 'aria-hidden': 'true' }, ' ×')));
  } else {
    count.textContent = `${events.length} 条`;
  }
  $('rn-events').replaceChildren(...feed.map((event) => {
    const step = event.stepId ? stepById(event.stepId) : null;
    return el('tr', { class: `${eventTone(event)}${event.seq >= state.freshFrom ? ' fresh' : ''}`, 'data-seq': event.seq },
      el('td', { class: 'mono rn-time' }, formatClock(event.at)),
      el('td', { class: 'rn-role' }, roleName(event.role)),
      el('td', { class: 'rn-what' },
        event.text,
        event.type !== 'run.finished' && event.data?.error ? el('span', { class: 'rn-what-error' }, event.data.error) : null,
        !state.step && step && event.type !== 'step.started' ? el('span', { class: 'rn-what-step' }, `第 ${step.index + 1} 步`) : null),
      el('td', { class: 'product' }, productCell(event)));
  }));
  const empty = $('rn-events-empty');
  empty.hidden = feed.length > 0;
  empty.textContent = state.step ? '这一步还没有事件。' : record.run.status === 'running' ? '还没有事件。执行器写下第一条事件后，这里会实时更新。' : '这次运行没有记录事件。';
  const note = $('rn-events-note');
  note.hidden = !state.skipped;
  note.textContent = state.skipped ? `另有 ${state.skipped} 行不是有效的事件，没有显示。` : '';
}

function renderCounters() {
  const { record } = state;
  if (!record) return;
  const products = runArtifacts(record);
  const summary = checkSummary(checkNow(), products.transactions);
  const counter = (key, label, value, onclick, sub = null) => el('button', { type: 'button', class: 'rn-counter', 'data-count': key, onclick },
    el('span', { class: 'rn-counter-label' }, label), el('span', { class: 'rn-big' }, String(value)), sub);
  const txSub = summary.mode === 'checking' && summary.total
    ? el('span', { class: `rn-counter-sub ${summary.not_found + summary.reverted ? 'danger' : summary.confirmed === summary.total ? 'ok' : ''}` }, `${summary.confirmed} 笔已核对`)
    : null;
  $('rn-counters').replaceChildren(
    counter('roles', '模拟用户', record.roles.length, () => openProvenance('roles')),
    counter('sessions', '产生的 session', products.sessions.length, () => openProvenance('products')),
    counter('commands', 'Obelisk 命令', products.commands.length, () => openProvenance('products')),
    counter('transactions', '链上交易', products.transactions.length, () => openProvenance('products'), txSub),
    counter('screenshots', '关键截图', products.screenshots.length, () => $('rn-shots-section').scrollIntoView({ behavior: 'smooth', block: 'start' })),
  );
}

function renderShots() {
  const { record } = state;
  const shots = runArtifacts(record).screenshots;
  $('rn-shots-count').textContent = `${shots.length} 张`;
  $('rn-shots').replaceChildren(...(shots.length ? shots.map((shot) => el('figure', { class: 'rn-shot', 'data-shot': shot.file },
    el('button', { type: 'button', class: 'rn-shot-pic', onclick: () => openShot(shot), 'aria-label': `${shot.caption}，点开看大图` },
      el('img', { src: shotSrc(shot.file), alt: shot.caption, loading: 'lazy' })),
    el('figcaption', {},
      el('span', { class: 'rn-shot-caption' }, shot.caption),
      el('button', { type: 'button', class: 'rn-shot-step', onclick: () => selectStep(shot.step.id, true) }, `第 ${shot.step.index + 1} 步 · ${roleName(shot.step.role)}`))))
    : [el('p', { class: 'rn-empty' }, record.run.status === 'running' ? '剧本标记的步骤完成时会自动截图，截好的画面出现在这里。' : '这次运行没有截图。')]));
}

function toggle(row, label) {
  return el('button', { type: 'button', class: 'rn-toggle', 'aria-expanded': String(state.open[row]), onclick: () => { state.open[row] = !state.open[row]; renderProvenance(); } },
    state.open[row] ? '收起' : label);
}

function provRow(key, title, ...cells) {
  return el('tr', { 'data-prov': key }, el('th', { scope: 'row' }, title), el('td', {}, ...cells));
}

const stepNote = (step) => `第 ${step.index + 1} 步 · ${roleName(step.role)}`;

function renderProvenance() {
  const { record, published } = state;
  const run = record.run;
  const products = runArtifacts(record);
  const cid = chainId();
  const group = (key, title, items, row) => el('div', { class: 'rn-group', 'data-group': key },
    el('h3', {}, title, el('span', { class: 'rn-count' }, String(items.length))),
    items.length ? items.map(row) : el('p', { class: 'muted' }, '没有。'));

  $('rn-prov').replaceChildren(
    provRow('run', '运行',
      el('span', { class: 'mono' }, run.id), ` · ${formatDateTime(run.startedAt)} 开始`, run.endedAt ? ` · ${formatDateTime(run.endedAt)} 结束` : ' · 仍在运行',
      ` · 剧本「${run.scenario.title}」`,
      el('div', { class: 'rn-sub' },
        el('span', { class: 'mono', title: `sha256 ${run.scenario.sha256}` }, `${run.scenario.file} · sha256 ${String(run.scenario.sha256 ?? '').slice(0, 12)}`),
        ` · ${run.network?.chainId ? chainLabel(run.network.chainId) : '没有连接链'}`,
        run.obelisk?.gitCommit ? el('span', {}, ' · Obelisk ', el('span', { class: 'mono' }, run.obelisk.gitCommit)) : null)),
    provRow('roles', '模拟用户',
      `${record.roles.length} 个钱包，每个模拟用户有自己的 Obelisk 数据和 AI 助手登录 · `, toggle('roles', '查看地址列表'),
      state.open.roles ? el('table', { class: 'rn-list' }, el('tbody', {}, record.roles.map((role) => el('tr', {},
        el('td', {}, role.label),
        el('td', { class: 'mono' }, role.wallet?.address
          ? (addressUrl(cid, role.wallet.address) ? external(addressUrl(cid, role.wallet.address), { class: 'rn-chain', title: role.wallet.address }, `${shortAddress(role.wallet.address)} ↗`) : shortAddress(role.wallet.address))
          : el('span', { class: 'muted' }, '没有钱包')),
        el('td', { class: 'muted' }, harnessLabel(role.harness?.kind)))))) : null),
    provRow('tasks', '任务',
      `${record.steps.length} 个步骤，其中 ${products.tasks.length} 个任务覆盖 ${products.scenes.length} 个场景标签 · `, toggle('tasks', '查看步骤清单'),
      state.open.tasks ? el('ul', { class: 'rn-items' }, record.steps.map((step) => el('li', {},
        el('span', { class: 'rn-item-title' }, step.title),
        el('span', { class: 'muted' }, `${stepNote(step)} · ${actionLabel(step.action)} · ${stepStatusLabel(step.status)}`),
        step.scenes.length ? el('span', { class: 'rn-tags' }, step.scenes.map((scene) => el('span', { class: `rn-tag${/^user:/.test(scene) ? ' user' : ''}` }, scene))) : null))) : null),
    provRow('ai', 'AI 运行',
      products.harnesses.map((h) => el('div', { class: 'rn-harness' },
        el('span', { class: 'rn-harness-name' }, harnessLabel(h.kind)),
        h.model ? el('span', { class: 'mono' }, h.model) : null,
        h.version ? el('span', { class: 'mono muted' }, h.version) : null,
        el('span', { class: 'muted' }, h.roles.join('、')))),
      products.prompts.length ? toggle('ai', `查看 ${products.prompts.length} 条 prompt`) : null,
      state.open.ai ? el('ul', { class: 'rn-items' }, products.prompts.map((step) => el('li', {},
        el('span', { class: 'muted' }, `${stepNote(step)} · ${harnessLabel(step.harness?.kind)}${step.harness?.model ? ` · ${step.harness.model}` : ''}${step.harness?.maxTurns ? ` · 最多 ${step.harness.maxTurns} 轮` : ''}`),
        el('div', { class: 'rn-prompt' }, step.prompt)))) : null),
    provRow('products', '产物',
      `${products.sessions.length} 个 session · ${products.artifacts.length} 个 Obelisk 产物 · ${products.transactions.length} 笔链上交易 · ${products.commands.length} 条 Obelisk 命令 · `,
      toggle('products', '逐条查看'),
      state.open.products ? el('div', { class: 'rn-groups' },
        group('transactions', '链上交易', products.transactions, (tx) => el('div', { class: 'rn-row' },
          el('span', { class: 'muted' }, `${stepNote(tx.step)} · `, el('span', { class: 'mono' }, `obelisk ${tx.command}`)),
          txLink(tx), el('span', { 'data-check-for': tx.hash.toLowerCase() }, checkBadge(tx.hash) ?? ''))),
        group('artifacts', 'Obelisk 产物', products.artifacts, (item) => el('div', { class: 'rn-row' },
          el('span', { class: 'muted' }, `${stepNote(item.step)} · ${artifactLabel(item.kind)}`),
          skillUrl(item) ? el('a', { class: 'mono rn-link', href: skillUrl(item) }, `Skill #${item.ref} ↗`)
            : el('span', { class: 'mono', title: item.ref }, String(item.ref).length > 40 ? shortHash(item.ref) : item.ref))),
        group('sessions', 'session', products.sessions, (session) => el('div', { class: 'rn-row' },
          el('span', { class: 'muted' }, `${stepNote(session.step)} · ${session.source}`),
          el('span', { class: 'mono', title: '会话内容留在模拟用户的电脑上，不随记录发布' }, session.obeliskId))),
        group('commands', 'Obelisk 命令', products.commands, (command) => el('div', { class: 'rn-row' },
          el('span', { class: 'muted' }, stepNote(command.step)),
          el('span', { class: 'mono rn-command', title: ['obelisk', ...command.argv].join(' ') }, commandLine(command)),
          command.exitCode !== 0 ? el('span', { class: 'rn-warn mono' }, `退出码 ${command.exitCode}`) : null))) : null),
    provRow('screenshots', '截图', `${products.screenshots.length} 张，与剧本步骤对应`),
  );
  const note = [`出处记录只保存 id、钱包地址和交易哈希，不保存对话内容和命令输出。`];
  if (published) {
    note.push(`这份记录在 ${formatDateTime(published.publishedAt)} 发布${published.redactions ? `，发布前把 ${published.redactions} 处本机路径换成了占位符` : ''}；原始文件是这次运行目录里的 provenance.json 和 events.jsonl。`);
  } else {
    note.push('现在显示的是 Playground 在本机写下的文件，发布后会出现在 Obelisk 的在线服务上。');
  }
  $('rn-prov-note').textContent = note.join('');
  // The files themselves, for anyone who wants to check them or keep a copy.
  $('rn-prov-files').replaceChildren(...['provenance.json', 'events.jsonl'].map((file) => el('a', {
    class: 'rn-file', href: `/runs/${state.runId}/${file}`, download: `${state.runId}-${file}`,
  }, `下载 ${file}`)));
  for (const node of document.querySelectorAll('#rn-prov [data-check-for]')) node.replaceChildren(checkBadge(node.dataset.checkFor) ?? '');
}

function renderRefresh() {
  const running = state.record.run.status === 'running';
  $('rn-refresh').textContent = running ? `运行中，每 ${LIVE_POLL_MS / 1000} 秒读取一次新的事件。` : '';
  $('rn-refresh').hidden = !running;
}

function renderRun() {
  $('rn-status-box').hidden = true;
  $('rn-run').hidden = false;
  renderHead();
  renderClock();
  renderBanners();
  renderSteps();
  renderEvents();
  renderCounters();
  renderShots();
  renderProvenance();
  renderChecks();
  renderRefresh();
}

// --- The list of runs ----------------------------------------------------------

async function showList() {
  let index;
  try {
    const text = await fetchText('/runs/index.json');
    index = text ? JSON.parse(text) : { runs: [] };
  } catch {
    showStatus('运行列表读不出来。', true);
    return;
  }
  const runs = (Array.isArray(index?.runs) ? index.runs : []).filter((run) => isRunId(run?.id));
  $('rn-status-box').hidden = true;
  $('rn-list').hidden = false;
  $('rn-runs').replaceChildren(...(runs.length ? runs.map((run) => el('a', { class: 'rn-run-card', href: `/runs/${run.id}` },
    el('span', { class: 'rn-run-title', translate: 'no' }, run.title ?? run.id),
    el('span', { class: 'rn-run-meta' },
      el('span', { class: 'mono' }, shortRunId(run.id)),
      run.startedAt ? el('span', {}, formatDateTime(run.startedAt)) : null,
      run.chainId ? el('span', { class: 'rn-chain-text' }, chainLabel(run.chainId)) : null,
      run.fixture ? pill('示例数据', 'warn') : null,
      run.dryRun ? pill('空跑', 'dim') : null),
    el('span', { class: 'rn-run-totals' }, [
      ['模拟用户', run.totals?.roles], ['session', run.totals?.sessions], ['链上交易', run.totals?.transactions], ['截图', run.totals?.screenshots],
    ].filter(([, n]) => Number.isInteger(n)).map(([label, n]) => el('span', {}, el('b', {}, String(n)), label))),
    el('span', { class: 'rn-run-go' }, '查看运行记录 →')))
    : [el('p', { class: 'rn-card rn-empty-card' }, '还没有发布的运行。Playground 跑完一次真实运行后，用 npm run playground -- publish <运行 id> 发布到这里。')]));
}

// --- Start ---------------------------------------------------------------------

async function tick() {
  try {
    const ok = await loadRun();
    if (!ok) return false;
    renderRun();
    runChecks();
  } catch (error) {
    if (!state.record) showStatus(String(error?.message || error), true);
  }
  return true;
}

async function start() {
  showNetwork();
  const id = runIdOfPath(location.pathname);
  if (id === null) return showList();
  if (!id) return showStatus('这个链接不是一次运行的地址。', true);
  state.runId = id;
  const step = new URLSearchParams(location.search).get('step');
  if (step) state.step = step;
  await loadPublished();
  if (!(await tick())) return;
  if (state.step && !stepById(state.step)) {
    state.step = null;
    renderEvents();
    renderSteps();
  } else if (state.step) {
    document.querySelector(`[data-step="${CSS.escape(state.step)}"]`)?.scrollIntoView({ block: 'nearest' });
  }
  runChecks(true);

  setInterval(() => {
    if (state.record?.run.status === 'running') {
      renderClock();
      renderBanners();
    }
  }, 1_000);
  // While the run goes, read it again every few seconds. Once it has ended,
  // only ask the chain again about transactions still pending or unanswered,
  // for a few minutes.
  let rechecks = 0;
  const poll = async () => {
    if (state.record?.run.status === 'running') {
      await tick();
      setTimeout(poll, LIVE_POLL_MS);
    } else if (rechecks < 30) {
      rechecks += 1;
      await runChecks();
      setTimeout(poll, CHECK_EVERY_MS);
    }
  };
  setTimeout(poll, LIVE_POLL_MS);

  const dialog = $('rn-lightbox');
  $('rn-lightbox-close').addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', (event) => { if (event.target === dialog) dialog.close(); });
}

start();
