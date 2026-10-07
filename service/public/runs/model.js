// The Playground run page (/runs/<id>, #32): reading a run's files and shaping
// them for the page. No DOM here, so tests run it under node.
//
// A run is three things next to each other, the same on this service and on
// the Playground's local live server (npm run playground -- serve):
//   <id>/provenance.json   the record (playground/src/provenance.ts)
//   <id>/events.jsonl      one event per line, appended while the run goes
//   <id>/screenshots/…     the key screenshots the record lists
// and, once published (npm run playground -- publish), <id>/published.json.

export const PROVENANCE_SCHEMA = 'obelisk.playground.provenance/1';
export const EVENT_SCHEMA = 'obelisk.playground.event/1';
export const PUBLISHED_SCHEMA = 'obelisk.playground.published/1';

/** A running run with no new record or event for this long may have stopped. */
export const QUIET_MS = 120_000;

const RUN_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$/;
const TX = /^0x[0-9a-fA-F]{64}$/;
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const SHOT = /^screenshots\/[A-Za-z0-9][\w.-]*\.(png|jpe?g|webp)$/i;

// Explorers by chain id; links are derived here, never taken from the record.
const CHAINS = {
  677: { label: 'BOT Chain 主网', explorer: 'https://scan.botchain.ai' },
  968: { label: 'BOT Chain 测试网', explorer: 'https://scan.bohr.life' },
  31337: { label: '本地开发链', explorer: null },
};

const RUN_STATUS = {
  running: { label: '运行中', tone: 'live' },
  succeeded: { label: '已完成', tone: 'ok' },
  failed: { label: '失败', tone: 'danger' },
  aborted: { label: '已中止', tone: 'warn' },
};
const STEP_STATUS = { pending: '待执行', running: '进行中', succeeded: '完成', failed: '失败', skipped: '跳过' };
const HARNESS = { 'claude-code': 'Claude Code', codex: 'Codex', fake: '模拟助手' };
const ACTION = { prompt: 'AI 运行', cli: 'Obelisk 命令', capture: '截图' };
const ARTIFACT = {
  'skill-draft': 'Skill 草稿',
  'skill-mint': '铸造 Skill',
  'skill-fetch': '取用 Skill',
  share: '分享',
  'share-receipt': '已读回执',
  'usage-report': '调用上报',
  wallet: '钱包',
};

/** What the on-chain check says about one transaction (GET /v1/txs). */
export const CHECK = {
  confirmed: { label: '已核对', tone: 'ok', title: '在链上找到，执行成功' },
  reverted: { label: '执行失败', tone: 'danger', title: '在链上找到，但执行失败（reverted）' },
  pending: { label: '待确认', tone: 'warn', title: '已发送，还没有进入区块' },
  not_found: { label: '未找到', tone: 'danger', title: '这条链上没有这笔交易' },
  unavailable: { label: '暂时查不到', tone: 'dim', title: '查询链上数据失败，稍后会再试' },
  checking: { label: '核对中', tone: 'dim', title: '正在向链上查询' },
  'other-chain': { label: '无法核对', tone: 'dim', title: '这个服务连接的是另一条链' },
  offline: { label: '无法核对', tone: 'dim', title: '没有连上在线服务，无法查询链上数据' },
};

export const isRunId = (id) => typeof id === 'string' && RUN_ID.test(id);
export const isTxHash = (hash) => typeof hash === 'string' && TX.test(hash);
export const isScreenshotFile = (file) => typeof file === 'string' && SHOT.test(file) && !file.includes('..');
export const stepStatusLabel = (status) => STEP_STATUS[status] ?? status;
export const harnessLabel = (kind) => HARNESS[kind] ?? kind;
export const actionLabel = (action) => ACTION[action] ?? action;
export const artifactLabel = (kind) => ARTIFACT[kind] ?? kind;
export const chainLabel = (chainId) => CHAINS[chainId]?.label ?? (chainId == null ? null : `链 ${chainId}`);

/** The run id of a page path (/runs/<id>, /runs/<id>/); null for the list (/runs); undefined for anything else. */
export function runIdOfPath(pathname) {
  const parts = String(pathname || '').split('/').filter(Boolean);
  if (parts[0] === 'runs' && parts.length === 1) return null;
  return parts[0] === 'runs' && parts.length === 2 && isRunId(parts[1]) ? parts[1] : undefined;
}

export function txUrl(chainId, hash) {
  const explorer = CHAINS[chainId]?.explorer;
  return explorer && isTxHash(hash) ? `${explorer}/tx/${hash}` : null;
}

export function addressUrl(chainId, address) {
  const explorer = CHAINS[chainId]?.explorer;
  return explorer && typeof address === 'string' && ADDRESS.test(address) ? `${explorer}/address/${address}` : null;
}

/** A minted Skill's page on the market, when the artifact names one by id. */
export function skillUrl(artifact) {
  return artifact && /^skill-/.test(artifact.kind) && /^[1-9][0-9]{0,20}$/.test(String(artifact.ref)) ? `/market/skills/${artifact.ref}` : null;
}

// --- Reading ---------------------------------------------------------------

/**
 * The record, or why it cannot be shown. Checks the shape the page relies on,
 * not every rule of the runner's validator.
 */
export function checkRecord(raw) {
  const bad = (why) => ({ ok: false, error: why });
  if (!raw || typeof raw !== 'object') return bad('出处记录不是 JSON 对象');
  if (raw.schema !== PROVENANCE_SCHEMA) return bad(`出处记录的格式不是 ${PROVENANCE_SCHEMA}`);
  const run = raw.run;
  if (!run || typeof run !== 'object' || !isRunId(run.id)) return bad('出处记录缺少运行 id');
  if (!run.scenario || typeof run.scenario.title !== 'string') return bad('出处记录缺少剧本');
  if (!Array.isArray(raw.roles) || !Array.isArray(raw.steps)) return bad('出处记录缺少角色或步骤');
  for (const step of raw.steps) {
    for (const key of ['sessions', 'commands', 'transactions', 'artifacts', 'screenshots', 'scenes']) {
      if (!Array.isArray(step?.[key])) return bad(`步骤 ${step?.id ?? '?'} 缺少 ${key}`);
    }
  }
  return { ok: true, record: raw };
}

/**
 * events.jsonl as written so far: events in order, lines that are not events
 * counted, and a half-written last line left for the next read.
 */
export function parseEvents(text, runId) {
  // The part after the last newline is empty or still being written.
  const complete = String(text ?? '').split('\n').slice(0, -1);
  const events = [];
  let skipped = 0;
  for (const line of complete) {
    if (!line.trim()) continue;
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      skipped += 1;
      continue;
    }
    if (!event || event.schema !== EVENT_SCHEMA || (runId && event.runId !== runId) || !Number.isInteger(event.seq) || typeof event.text !== 'string') {
      skipped += 1;
      continue;
    }
    events.push(event);
  }
  events.sort((a, b) => a.seq - b.seq);
  return { events, skipped };
}

// --- Shaping ---------------------------------------------------------------

/** `03:42`, or `1:03:42` past an hour. */
export function formatElapsed(ms) {
  const total = Math.max(0, Math.floor((Number(ms) || 0) / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n) => String(n).padStart(2, '0');
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

/** `21:15:31` in the reader's time zone. */
export function formatClock(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

/** `2026-10-07 21:10` in the reader's time zone. */
export function formatDateTime(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function elapsedMs(record, now = Date.now()) {
  const start = Date.parse(record.run.startedAt);
  const end = record.run.endedAt ? Date.parse(record.run.endedAt) : now;
  return Number.isNaN(start) ? 0 : Math.max(0, end - start);
}

/** The status pill. A running run that has gone quiet says so instead of claiming to run. */
export function runStatus(record, updatedAt, now = Date.now()) {
  const status = RUN_STATUS[record.run.status] ?? { label: record.run.status, tone: 'dim' };
  if (record.run.status === 'running' && updatedAt && now - updatedAt > QUIET_MS) {
    return { key: 'quiet', label: `${Math.floor((now - updatedAt) / 60_000)} 分钟没有新动静`, tone: 'warn' };
  }
  return { key: record.run.status, ...status };
}

/** The network pill: the chain, or why there is none. */
export function networkLabel(record) {
  if (record.run.dryRun) return '空跑 · 未上链';
  return record.run.network?.chainId ? chainLabel(record.run.network.chainId) : '未连链';
}

export function shortRunId(id) {
  const value = String(id || '');
  return value.length > 26 ? `${value.slice(0, 14)}…${value.slice(-6)}` : value;
}

export function shortHash(hash) {
  const value = String(hash || '');
  return value.length > 14 ? `${value.slice(0, 8)}…${value.slice(-4)}` : value;
}

export function shortAddress(address) {
  return typeof address === 'string' && ADDRESS.test(address) ? `${address.slice(0, 6)}…${address.slice(-4)}` : address ?? null;
}

export function roleLabels(record) {
  return new Map((record?.roles ?? []).map((role) => [role.id, role.label]));
}

/** Steps finished (whatever the outcome) out of all steps. */
export function stepProgress(record) {
  const steps = record.steps;
  return { done: steps.filter((step) => ['succeeded', 'failed', 'skipped'].includes(step.status)).length, total: steps.length };
}

export function currentStep(record) {
  return record.steps.find((step) => step.status === 'running') ?? null;
}

/** The first thing that went wrong, for the banner of a failed run. */
export function runFailure(record, events = []) {
  const step = record.steps.find((entry) => entry.status === 'failed');
  if (step) return { step, error: step.error };
  const finished = [...events].reverse().find((event) => event.type === 'run.finished' && event.data?.error);
  return finished ? { step: null, error: finished.data.error } : null;
}

/**
 * Everything the run produced, flattened from its steps, each entry keeping
 * the step it came from: the lists behind every number on the page.
 */
export function runArtifacts(record) {
  const flat = (pick) => record.steps.flatMap((step) => pick(step).map((item) => ({ ...item, step })));
  const tasks = record.steps.filter((step) => step.scenes.length);
  const scenes = new Set(tasks.flatMap((task) => task.scenes));
  const harnesses = new Map();
  for (const role of record.roles) {
    const h = role.harness ?? {};
    const key = `${h.kind}|${h.version ?? ''}|${h.model ?? ''}`;
    if (!harnesses.has(key)) harnesses.set(key, { ...h, roles: [] });
    harnesses.get(key).roles.push(role.label);
  }
  const seen = new Set();
  const transactions = flat((step) => step.transactions).filter((tx) => isTxHash(tx.hash) && !seen.has(tx.hash.toLowerCase()) && seen.add(tx.hash.toLowerCase()));
  return {
    sessions: flat((step) => step.sessions),
    commands: flat((step) => step.commands),
    transactions,
    artifacts: flat((step) => step.artifacts),
    screenshots: flat((step) => step.screenshots).filter((shot) => isScreenshotFile(shot.file)),
    prompts: record.steps.filter((step) => step.prompt),
    tasks,
    scenes: [...scenes],
    harnesses: [...harnesses.values()],
  };
}

/** `obelisk skill mint job-application-materials --confirm 9c41…e07a` */
export function commandLine(command) {
  return ['obelisk', ...command.argv.map((arg) => (/^[0-9a-fA-F]{40,}$|^0x[0-9a-fA-F]{40,}$/.test(arg) ? shortHash(arg) : arg))].join(' ');
}

/** The newest events first, optionally only one step's. */
export function eventFeed(events, stepId = null) {
  return [...events].filter((event) => !stepId || event.stepId === stepId).reverse();
}

/** What an event produced, as the 产物 column shows it. */
export function eventProduct(event) {
  const data = event.data ?? {};
  if (event.type === 'session' && data.obeliskId) return { kind: 'session', session: data };
  if (event.type === 'transaction' && isTxHash(data.hash)) return { kind: 'transaction', transaction: data };
  if (event.type === 'screenshot' && isScreenshotFile(data.file)) return { kind: 'screenshot', screenshot: data };
  if (event.type === 'artifact' && skillUrl(data)) return { kind: 'skill', artifact: data };
  if (event.type === 'command' && data.exitCode) return { kind: 'exit', exitCode: data.exitCode };
  if (event.type === 'step.finished' && data.status === 'failed') return { kind: 'failed' };
  return { kind: 'local' };
}

export function eventTone(event) {
  if (event.type === 'step.finished' || event.type === 'run.finished') {
    if (event.data?.status === 'failed') return 'danger';
    if (event.data?.status === 'aborted') return 'warn';
  }
  return ['run.started', 'run.finished', 'step.started'].includes(event.type) ? 'milestone' : '';
}

/**
 * The on-chain check of a run's transactions, from GET /v1/chain and
 * GET /v1/txs. `chain` is undefined while it is being read and null when the
 * service could not be reached.
 */
export function checkState(record, chain, results) {
  const runChain = record.run.network?.chainId ?? null;
  if (record.run.dryRun || runChain === null) return { mode: 'none' };
  if (chain === undefined) return { mode: 'checking', results: new Map() }; // still asking which chain the service is on
  if (!chain) return { mode: 'offline' };
  if (chain.chainId !== runChain) return { mode: 'other-chain', serviceChain: chain.chainId, runChain };
  return { mode: 'checking', results };
}

/** The check of one transaction: one of the keys of CHECK. */
export function txCheckOf(state, hash) {
  if (!state || state.mode === 'none') return null;
  if (state.mode !== 'checking') return state.mode;
  return state.results?.get(String(hash).toLowerCase())?.status ?? 'checking';
}

/** Counts for the 链上核对 summary. */
export function checkSummary(state, transactions) {
  const counts = { total: transactions.length, confirmed: 0, reverted: 0, pending: 0, not_found: 0, unavailable: 0, checking: 0 };
  if (!state || state.mode !== 'checking') return { ...counts, mode: state?.mode ?? 'none' };
  for (const tx of transactions) counts[txCheckOf(state, tx.hash)] += 1;
  return { ...counts, mode: 'checking', done: counts.checking === 0 };
}

/** Hashes still worth asking about: not yet answered, or not final. */
export function hashesToCheck(transactions, results) {
  return transactions.map((tx) => tx.hash.toLowerCase())
    .filter((hash) => !['confirmed', 'reverted', 'not_found'].includes(results.get(hash)?.status));
}
