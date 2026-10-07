// The investor preview's data (#33, vision 09 · G6): a "story" that tells the
// demo loop step by step, with what each role sees and what the chain records.
// Pure functions, no DOM, so they run in node:test as well as in the page.
//
// story.json is shaped for G6 step 2: today it carries illustrative screens
// and transactions without hashes (source.kind "illustrative"). When a real
// Playground run of the demo loop is published, story.run points at its
// provenance record (playground/src/provenance.ts) and each story step names
// the run's step ids in `playgroundStep`. applyProvenance then swaps in the
// real wallets, transactions (linked to the explorer), times, screenshots and
// per-step provenance, and marks any screen still drawn by hand as such. No
// change to the page is needed for that swap.

export const STORY_SCHEMA = 'obelisk.preview.story/1';
export const PROVENANCE_SCHEMA = 'obelisk.playground.provenance/1';

const EXPLORERS = { 677: 'https://scan.botchain.ai', 968: 'https://scan.bohr.life' };
const NETWORKS = { 677: 'BOT Chain 主网', 968: 'BOT Chain 测试网' };

export function networkName(chainId) {
  return NETWORKS[chainId] ?? (chainId == null ? null : `链 ${chainId}`);
}

export function shortAddress(address) {
  return typeof address === 'string' && /^0x[0-9a-fA-F]{40}$/.test(address) ? `${address.slice(0, 6)}…${address.slice(-4)}` : address ?? null;
}

/** A transaction's explorer link: the one recorded, else derived from its chain. */
export function explorerTxUrl(tx) {
  if (!tx || typeof tx.hash !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(tx.hash)) return null;
  if (typeof tx.explorerUrl === 'string' && /^https:\/\//.test(tx.explorerUrl)) return tx.explorerUrl;
  const base = EXPLORERS[tx.chainId];
  return base ? `${base}/tx/${tx.hash}` : null;
}

function fail(message) {
  throw new Error(`story.json: ${message}`);
}

/** Check the shape the page relies on; returns the story. */
export function checkStory(story) {
  if (!story || story.schema !== STORY_SCHEMA) fail(`schema must be ${STORY_SCHEMA}`);
  if (!Array.isArray(story.roles) || story.roles.length === 0) fail('roles must be a non-empty array');
  if (!Array.isArray(story.steps) || story.steps.length === 0) fail('steps must be a non-empty array');
  const roles = new Set();
  for (const role of story.roles) {
    if (typeof role.id !== 'string' || roles.has(role.id)) fail(`role id ${role.id} is missing or repeated`);
    roles.add(role.id);
  }
  const known = (id, where) => { if (!roles.has(id)) fail(`${where} names unknown role ${id}`); };
  story.steps.forEach((step, index) => {
    const where = `step ${index + 1} (${step.id})`;
    if (typeof step.title !== 'string') fail(`${where} has no title`);
    for (const id of step.roles ?? []) known(id, where);
    if (!Array.isArray(step.screens) || step.screens.length === 0) fail(`${where} has no screens`);
    for (const screen of step.screens) {
      known(screen.role, `${where} screen`);
      if (!screen.image && !Array.isArray(screen.blocks)) fail(`${where} has a screen with neither image nor blocks`);
    }
    for (const entry of step.timeline ?? []) known(entry.role, `${where} timeline`);
  });
  return story;
}

/** Timeline entries from the first step through `index`, each tagged with its step. */
export function timelineUpTo(story, index) {
  const out = [];
  story.steps.slice(0, index + 1).forEach((step, stepIndex) => {
    for (const entry of step.timeline ?? []) out.push({ ...entry, stepIndex });
  });
  return out;
}

/** Steps (0-based) in which a role takes part: named in `roles` or shown on a screen. */
export function stepsOfRole(story, roleId) {
  const out = new Set();
  story.steps.forEach((step, index) => {
    if ((step.roles ?? []).includes(roleId) || step.screens.some((screen) => screen.role === roleId)) out.add(index);
  });
  return out;
}

function clock(iso) {
  const time = Date.parse(iso ?? '');
  if (Number.isNaN(time)) return null;
  const date = new Date(time);
  const pad = (value) => String(value).padStart(2, '0');
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

/**
 * The story with a real Playground run's data in place of the illustrative
 * parts. `base` is the URL prefix that the record's relative paths (screenshots)
 * resolve against, e.g. "runs/<run id>/".
 */
export function applyProvenance(story, provenance, base = '') {
  if (!provenance || provenance.schema !== PROVENANCE_SCHEMA) fail(`run.provenance is not a ${PROVENANCE_SCHEMA} record`);
  const runSteps = new Map(provenance.steps.map((step) => [step.id, step]));
  const runRoles = new Map(provenance.roles.map((role) => [role.id, role]));
  const chainId = provenance.run.network?.chainId ?? null;

  const roles = story.roles.map((role) => {
    const real = runRoles.get(role.id);
    if (!real) return role;
    return { ...role, wallet: shortAddress(real.wallet?.address) ?? role.wallet, address: real.wallet?.address ?? null, harness: real.harness ?? null, real: true };
  });

  const steps = story.steps.map((step) => {
    const ids = [step.playgroundStep ?? []].flat();
    const matched = ids.map((id) => runSteps.get(id)).filter(Boolean);
    if (matched.length === 0) {
      return { ...step, screens: step.screens.map((screen) => ({ ...screen, illustrative: true })), timeline: (step.timeline ?? []).map((entry) => ({ ...entry, illustrative: true })) };
    }
    // Real transactions, each with the time its command finished and the
    // story's wording for that kind of command when there is one.
    const wording = new Map((step.timeline ?? []).filter((entry) => entry.tx?.command).map((entry) => [entry.tx.command, entry.text]));
    const timeline = [];
    for (const run of matched) {
      for (const tx of run.transactions ?? []) {
        const command = (run.commands ?? []).find((item) => (item.transactions ?? []).includes(tx.hash));
        timeline.push({
          at: clock(command?.endedAt ?? run.endedAt) ?? '',
          role: runRoles.has(run.role) && story.roles.some((role) => role.id === run.role) ? run.role : step.roles?.[0],
          text: wording.get(tx.command) ?? `obelisk ${tx.command}`,
          tx: { ...tx, chainId: tx.chainId ?? chainId },
        });
      }
    }
    // Keep the story's off-chain moments (a refused open has no transaction).
    for (const entry of step.timeline ?? []) if (!entry.tx) timeline.push(entry);

    const safe = (file) => typeof file === 'string' && /^[\w-]+(\/[\w.-]+)*\.(png|jpe?g|webp)$/i.test(file) && !file.includes('..');
    const shots = matched.flatMap((run) => (run.screenshots ?? []).filter((shot) => safe(shot.file))
      .map((shot) => ({ role: run.role, where: shot.caption, image: `${base}${shot.file}`, caption: shot.caption })));
    const shotRoles = new Set(shots.map((shot) => shot.role));
    const screens = [
      ...shots,
      ...step.screens.filter((screen) => !shotRoles.has(screen.role)).map((screen) => ({ ...screen, illustrative: true })),
    ];
    const harness = matched.map((run) => run.harness).find(Boolean) ?? null;
    return {
      ...step,
      screens,
      timeline,
      provenance: {
        runId: provenance.run.id,
        steps: matched.map((run) => ({ id: run.id, status: run.status, startedAt: run.startedAt, endedAt: run.endedAt })),
        sessions: matched.reduce((sum, run) => sum + (run.sessions?.length ?? 0), 0),
        commands: matched.flatMap((run) => (run.commands ?? []).map((command) => `obelisk ${command.argv.slice(0, 2).join(' ')}`)),
        harness: harness ? { kind: harness.kind, model: harness.model } : null,
      },
    };
  });

  return {
    ...story,
    roles,
    steps,
    source: {
      kind: provenance.run.dryRun ? 'dry-run' : 'playground-run',
      label: provenance.run.dryRun ? '试运行数据' : '真实运行',
      note: provenance.run.dryRun
        ? '这次 Playground 运行没有调用模型，也没有上链，只用来检查流程。'
        : '界面截图和链上交易来自一次 Playground 真实运行；仍为示意的画面单独标出。',
      run: {
        id: provenance.run.id,
        scenario: provenance.run.scenario?.title ?? provenance.run.scenario?.name ?? null,
        network: networkName(chainId),
        startedAt: provenance.run.startedAt,
        endedAt: provenance.run.endedAt,
        status: provenance.run.status,
        gitCommit: provenance.run.obelisk?.gitCommit ?? null,
        record: story.run?.provenance ?? null,
      },
    },
  };
}

/**
 * story.json under `root` (the page's directory, e.g. "/preview/"), with the
 * published run applied when it names one. story.run.provenance is relative
 * to `root`, and the record's screenshots are relative to the record.
 */
export async function loadStory(fetchJson, root = '/preview/') {
  const story = checkStory(await fetchJson(`${root}story.json`));
  const record = story.run?.provenance;
  if (!record) return story;
  if (typeof record !== 'string' || !/^[\w-]+(\/[\w.-]+)*\.json$/.test(record) || record.includes('..')) fail('run.provenance must be a path under the page directory');
  const base = `${root}${record.replace(/[^/]*$/, '')}`;
  return checkStory(applyProvenance(story, await fetchJson(`${root}${record}`), base));
}
