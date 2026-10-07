// Copyright (C) 2026 tommy0103 and contributors.
// SPDX-License-Identifier: AGPL-3.0-only

// Display helpers for the Skill tab. Records come from the main process
// (`skills:list` summaries and `skills:get` views, packages/core/src/skills.ts);
// nothing here writes to the library.

const DAY_MS = 24 * 60 * 60 * 1000;

// Block explorers by chain id. Mirrors the chains the online service serves
// (service/src/chains.ts); a chain without one gets no link.
const CHAINS = {
  677: { label: 'BOT Chain', explorer: 'https://scan.botchain.ai' },
  968: { label: 'BOT Chain 测试网', explorer: 'https://scan.bohr.life' },
  31337: { label: '本地开发链', explorer: null },
};

/** `9c41…e07a`: enough to recognise a fingerprint, never enough to name one. */
export function shortFingerprint(fingerprint) {
  const value = String(fingerprint || '');
  return value.length > 12 ? `${value.slice(0, 4)}…${value.slice(-4)}` : value;
}

export function shortAddress(address) {
  const value = String(address || '');
  return value.length > 12 ? `${value.slice(0, 6)}…${value.slice(-4)}` : value;
}

export function versionLabel(versionIndex) {
  return `v${Number(versionIndex) + 1}`;
}

export function chainLabel(chainId) {
  return CHAINS[chainId]?.label ?? `链 ${chainId}`;
}

/** The block explorer of a known chain, or null (a local chain has none). */
export function chainExplorer(chainId) {
  return CHAINS[chainId]?.explorer ?? null;
}

/** The explorer page of a mint transaction, or null when it cannot be linked. */
export function explorerTxUrl(mint) {
  const explorer = CHAINS[mint?.chainId]?.explorer;
  if (!explorer || !/^0x[0-9a-fA-F]{64}$/.test(String(mint?.txHash || ''))) return null;
  return `${explorer}/tx/${mint.txHash}`;
}

/**
 * Where a Skill stands, from a summary or a full view:
 *   'draft'    never minted; the draft waits for review
 *   'revision' minted before, and the draft has changes not minted yet
 *   'minted'   every change is minted
 */
export function skillStage(skill) {
  const minted = 'versionCount' in skill ? skill.versionCount > 0 : skill.versions.some(version => version.mint);
  const pending = 'draftFingerprint' in skill
    ? Boolean(skill.draftFingerprint) && !skill.draftMinted
    : Boolean(skill.draft) && !skill.draft.minted;
  if (!minted) return 'draft';
  return pending ? 'revision' : 'minted';
}

/** Summaries split into what waits for review and what is minted; each keeps its order. */
export function groupSkills(summaries) {
  const pending = [];
  const minted = [];
  for (const skill of summaries) {
    if (skillStage(skill) === 'minted') minted.push(skill);
    else pending.push(skill);
  }
  return { pending, minted };
}

/** Minted versions, newest first, with their display label. */
export function mintedVersions(skill) {
  return skill.versions
    .filter(version => version.mint)
    .map(version => ({ ...version, label: versionLabel(version.mint.versionIndex), txUrl: explorerTxUrl(version.mint) }))
    .sort((a, b) => b.mint.versionIndex - a.mint.versionIndex);
}

function sessionTime(session) {
  const time = new Date(session?.started_at || session?.ended_at || 0).getTime();
  return Number.isFinite(time) && time > 0 ? time : null;
}

/** `3 周`, `5 天`, `同一天` for the time between the first and last source session. */
export function formatSpan(ms) {
  const days = Math.round(ms / DAY_MS);
  if (days < 1) return '同一天';
  if (days < 14) return `${days} 天`;
  if (days < 60) return `${Math.round(days / 7)} 周`;
  return `${Math.round(days / 30)} 个月`;
}

/** `09-12`, the short date the evidence list shows next to a session. */
export function formatShortDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return `${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

/**
 * The evidence list and provenance card of a Skill. `sessions` maps a session
 * id to its index metadata (missing when the session is not in this index);
 * `sourceName` turns a source id into its display name.
 *
 * Every pitfall and correction keeps the number of the evidence entry it came
 * from, so the card can point back to the session that supports it.
 */
export function provenanceCard(provenance, sessions, sourceName = id => id) {
  const evidence = provenance.map((entry, index) => {
    const session = sessions.get(entry.sessionId) ?? null;
    return {
      number: index + 1,
      sessionId: entry.sessionId,
      reason: entry.reason,
      excerpts: entry.excerpts ?? [],
      pitfalls: entry.pitfalls ?? [],
      corrections: entry.corrections ?? [],
      session,
      title: session?.title?.trim() || null,
      source: session ? sourceName(session.source || 'claude') : null,
      date: sessionTime(session) ? formatShortDate(sessionTime(session)) : '',
    };
  });

  const sessionIds = new Set(evidence.map(entry => entry.sessionId));
  const times = evidence.map(entry => sessionTime(entry.session)).filter(time => time !== null);
  const sourceCounts = new Map();
  for (const entry of evidence) {
    if (entry.source) sourceCounts.set(entry.source, (sourceCounts.get(entry.source) ?? 0) + 1);
  }

  return {
    evidence,
    sessionCount: sessionIds.size,
    span: times.length > 1 ? formatSpan(Math.max(...times) - Math.min(...times)) : null,
    sources: [...sourceCounts].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count),
    pitfalls: evidence.flatMap(entry => entry.pitfalls.map(text => ({ text, number: entry.number }))),
    corrections: evidence.flatMap(entry => entry.corrections.map(text => ({ text, number: entry.number }))),
  };
}

// --- Minted Skill detail (#19) ----------------------------------------------

/** `86%`, or null when there is nothing to divide by. */
export function percent(part, whole) {
  return whole > 0 ? `${Math.round((part / whole) * 100)}%` : null;
}

/** The local library's mint of a chain Skill, when this user minted it here. */
export function localMintOf(summaries, chainId, skillId) {
  return summaries.find(summary => {
    const mint = summary.latestVersion?.mint;
    return mint && mint.skillId === skillId && mint.chainId === chainId;
  }) ?? null;
}

/**
 * A family tree as rows, parents before children in mint order, each with its
 * depth below the root. Nodes whose parent is missing (a truncated tree) are
 * kept at the depth the service gave them.
 */
export function lineageRows(nodes) {
  const children = new Map();
  const ids = new Set(nodes.map(node => node.skillId));
  for (const node of nodes) {
    const parent = node.parentSkillId && ids.has(node.parentSkillId) ? node.parentSkillId : null;
    if (!children.has(parent)) children.set(parent, []);
    children.get(parent).push(node);
  }
  const rows = [];
  const visit = (node, depth) => {
    rows.push({ ...node, depth });
    for (const child of children.get(node.skillId) ?? []) visit(child, depth + 1);
  };
  for (const root of children.get(null) ?? []) visit(root, root.depth);
  return rows;
}

/**
 * Points of a weekly trend line in a `width` x `height` box with `pad` inside
 * it, oldest week on the left. A flat zero line sits on the bottom.
 */
export function trendPoints(weeks, { width = 800, height = 110, pad = 12 } = {}) {
  if (!weeks.length) return [];
  const max = Math.max(1, ...weeks.map(week => week.invocations));
  const step = weeks.length > 1 ? (width - pad * 2) / (weeks.length - 1) : 0;
  return weeks.map((week, index) => ({
    x: Math.round(pad + step * index),
    y: Math.round(height - pad - ((height - pad * 2) * week.invocations) / max),
    ...week,
  }));
}
