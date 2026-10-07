// Copyright (C) 2026 tommy0103 and contributors.
// SPDX-License-Identifier: AGPL-3.0-only

// `obelisk usage status | enable [--confirm] | disable | report [--if-due]` (#23, vision 04 U4).
//
// Agent-facing like `obelisk wallet`: one JSON object per command, `next`
// says what to do next. Reporting is off until the user turns it on, and
// turning it on previews exactly what would be sent first. Once on,
// `obelisk usage report` sends each minted version's running totals: signed
// by the wallet, relayed by the online service (which pays the fee), and
// counted once per wallet by UsageStats. Only increases are sent.

import type { Address, Hex } from 'viem';

import { withSkillInvocations } from '../../core/src/core.ts';
import { systemSecretStore } from '../../core/src/keychain.ts';
import { networkLabel, ServiceError, type ChainInfo, type ObeliskServiceClient } from '../../core/src/obelisk-service.ts';
import { resolveObeliskPaths } from '../../core/src/paths.ts';
import { skillVersionsByFingerprint } from '../../core/src/skill-invocations.ts';
import { fingerprintToBytes32 } from '../../core/src/skill-chain.ts';
import { countSettledSignals, readUsageAnnotations, storedAnnotator, writeUsageAnnotations } from '../../core/src/usage-annotations.ts';
import { planUsageReports, reportableFingerprints, signReportUsage, type ReportBucket, type UsageReportPlan } from '../../core/src/usage-report.ts';
import { readUsageSettings, reportedKey, writeUsageSettings, type ReportedTotals, type UsageSettings } from '../../core/src/usage-settings.ts';
import { loadWallet } from '../../core/src/wallet.ts';
import { skillService, type SkillChainDeps } from './skill-mint-command.ts';

export const USAGE_USAGE = 'Usage: obelisk usage status | enable [--confirm] | disable | report [--if-due]';

/** How long a report signature stays valid for the relay. */
const REPORT_DEADLINE_SECONDS = 600;
/** `report --if-due` sends at most once per this interval. */
const REPORT_INTERVAL_MS = 24 * 3600 * 1000;

export type UsageDeps = SkillChainDeps;

const WHAT_IS_SENT = 'For each minted Skill version you used: its fingerprint, how many times you invoked it in total, how many of those invocations showed each fact signal (tool error, correction, repeated edit, repeated invocation), and, once invocations are judged, how many fell into each scene and result.';
const NEVER_SENT = 'Never sent: session content, prompts, file names, project paths, Skill names you gave, or when each invocation happened.';
const PUBLIC = 'Reports are written on BOT Chain under your wallet address, so anyone can see which minted versions this wallet reported and its running totals.';
const FEE = 'Paid by the Obelisk online service; this wallet is not charged.';

interface Pending {
  plan: UsageReportPlan;
  onChain: number;
  last: ReportedTotals | null;
  message: { cumulativeInvocations: number; scenes: ReportBucket[]; outcomes: ReportBucket[] } | null;
}

/** Never send less than was sent before; send only when something grew. */
function nextReport(plan: UsageReportPlan, onChain: number, last: ReportedTotals | null): Pending['message'] {
  const raise = (buckets: ReportBucket[], previous: Record<string, number> | undefined) => buckets.map((bucket) =>
    ({ ...bucket, cumulative: Math.max(bucket.cumulative, previous?.[bucket.key] ?? 0) }));
  const cumulativeInvocations = Math.max(plan.cumulativeInvocations, onChain, last?.cumulativeInvocations ?? 0);
  const scenes = raise(plan.scenes, last?.scenes).map((bucket) => ({ ...bucket, cumulative: Math.min(bucket.cumulative, cumulativeInvocations) }));
  const outcomes = raise(plan.outcomes, last?.outcomes).map((bucket) => ({ ...bucket, cumulative: Math.min(bucket.cumulative, cumulativeInvocations) }));
  const grew = (buckets: ReportBucket[], previous: Record<string, number> | undefined) =>
    buckets.some((bucket) => bucket.cumulative > (previous?.[bucket.key] ?? 0));
  if (cumulativeInvocations <= onChain && !grew(scenes, last?.scenes) && !grew(outcomes, last?.outcomes)) return null;
  return { cumulativeInvocations, scenes, outcomes };
}

async function pendingReports(client: ObeliskServiceClient, chain: ChainInfo, wallet: Address, settings: UsageSettings, deps: UsageDeps): Promise<Pending[]> {
  const paths = resolveObeliskPaths({ env: deps.env ?? process.env });
  const versions = await skillVersionsByFingerprint(paths.skillsDir);
  const annotations = await readUsageAnnotations(paths.dataDir);
  const reportable = reportableFingerprints(versions, chain.chainId);
  // Fact signals cost nothing, so they are counted here for every settled
  // invocation of a reportable version; judgments come from `usage judge`.
  const invocations = await withSkillInvocations(async (db, found) => {
    const now = deps.now?.() ?? new Date();
    if (countSettledSignals(db, found, annotations, now, (item) => reportable.has(item.fingerprint ?? '')) > 0) {
      await writeUsageAnnotations(paths.dataDir, annotations);
    }
    return found;
  });
  const plans = planUsageReports(invocations, versions, chain.chainId, storedAnnotator(annotations));
  return Promise.all(plans.map(async (plan) => {
    const usage = await client.usage(fingerprintToBytes32(plan.fingerprint), { wallet });
    const onChain = usage.wallet?.cumulative ?? 0;
    const last = settings.reported[reportedKey(chain.chainId, plan.fingerprint)] ?? null;
    return { plan, onChain, last, message: nextReport(plan, onChain, last) };
  }));
}

function describe(pending: Pending) {
  const { plan, onChain, message } = pending;
  return {
    skill: plan.names.join(', '),
    state: plan.state,
    skillId: plan.skillId,
    version: plan.versionIndex + 1,
    fingerprint: plan.fingerprint,
    invocations: plan.cumulativeInvocations,
    sessions: plan.sessions,
    alreadyReported: onChain,
    willAdd: message ? message.cumulativeInvocations - onChain : 0,
    scenes: (message?.scenes ?? []).map((bucket) => ({ tag: bucket.label, invocations: bucket.cumulative })),
    outcomes: (message?.outcomes ?? []).map((bucket) => ({ id: bucket.label, invocations: bucket.cumulative })),
  };
}

async function context(deps: UsageDeps) {
  const paths = resolveObeliskPaths({ env: deps.env ?? process.env });
  const { account } = await loadWallet({ paths, secrets: deps.secrets ?? systemSecretStore() });
  const client = skillService(deps);
  const chain = await client.chain();
  const settings = await readUsageSettings(paths.dataDir);
  return { paths, account, client, chain, settings };
}

async function preview(deps: UsageDeps, mode: 'status' | 'enable') {
  const { account, client, chain, settings } = await context(deps);
  const pending = await pendingReports(client, chain, account.address, settings, deps);
  const toSend = pending.filter((item) => item.message !== null);
  const base = {
    enabled: settings.enabled,
    wallet: account.address,
    network: networkLabel(chain.chainId),
    contract: chain.contracts.UsageStats,
    lastRunAt: settings.lastRunAt,
    versions: pending.map(describe),
  };
  if (mode === 'status') {
    return {
      ...base,
      next: settings.enabled
        ? (toSend.length > 0 ? `Run \`obelisk usage report\` to send ${toSend.length} report(s).` : 'Nothing new to report.')
        : 'Usage reporting is off. To turn it on, run `obelisk usage enable` and show the preview to the user.',
    };
  }
  if (settings.enabled) {
    return { ...base, status: 'already_enabled', next: 'Usage reporting is already on. `obelisk usage report` sends what is new.' };
  }
  return {
    preview: true,
    action: 'Turn on usage reporting',
    ...base,
    sends: WHAT_IS_SENT,
    neverSent: NEVER_SENT,
    public: PUBLIC,
    fee: FEE,
    schedule: 'After this, `obelisk usage report` sends only what increased, at most once a day when run with --if-due. `obelisk usage disable` turns it off; what was already reported stays on chain.',
    next: toSend.length > 0
      ? `Show this preview to the user. Only after they confirm, run \`obelisk usage enable --confirm\`; it turns reporting on and sends these ${toSend.length} report(s) now.`
      : 'Show this preview to the user. Nothing would be sent yet. Only after they confirm, run `obelisk usage enable --confirm`.',
  };
}

async function report(deps: UsageDeps, { ifDue, enabling }: { ifDue: boolean; enabling: boolean }) {
  const { paths, account, client, chain, settings } = await context(deps);
  const now = deps.now?.() ?? new Date();
  if (!settings.enabled && !enabling && ifDue) return { status: 'off', enabled: false };
  if (!settings.enabled && !enabling) {
    throw new Error('Usage reporting is off. Run `obelisk usage enable` to see what would be reported, and turn it on only after the user confirms.');
  }
  if (ifDue && settings.lastRunAt && now.getTime() - Date.parse(settings.lastRunAt) < REPORT_INTERVAL_MS) {
    return { status: 'not_due', lastRunAt: settings.lastRunAt };
  }
  if (enabling && !settings.enabled) {
    Object.assign(settings, { enabled: true, enabledAt: now.toISOString(), disabledAt: null });
    await writeUsageSettings(paths.dataDir, settings);
  }

  const pending = (await pendingReports(client, chain, account.address, settings, deps)).filter((item) => item.message !== null);
  const results: unknown[] = [];
  let nonce = pending.length > 0 ? await client.nonce('UsageStats', account.address) : 0n;
  let stoppedAt: string | null = null;
  for (const item of pending) {
    const { plan, onChain } = item;
    const sent = item.message!;
    const toChain = (buckets: ReportBucket[]) => buckets.map((bucket) => ({ key: bucket.key as Hex, cumulative: BigInt(bucket.cumulative) }));
    const sign = async () => {
      const message = {
        reporter: account.address,
        fingerprint: fingerprintToBytes32(plan.fingerprint),
        cumulativeInvocations: BigInt(sent.cumulativeInvocations),
        scenes: toChain(sent.scenes),
        outcomes: toChain(sent.outcomes),
        nonce,
        deadline: BigInt(Math.floor(now.getTime() / 1000) + REPORT_DEADLINE_SECONDS),
      };
      return { message, signature: await signReportUsage(account, chain.chainId, chain.contracts.UsageStats, message) };
    };
    const summary = { skill: plan.names.join(', '), skillId: plan.skillId, version: plan.versionIndex + 1, fingerprint: plan.fingerprint };
    let outcome;
    try {
      try {
        outcome = await client.relay({ action: 'ReportUsage', ...(await sign()) });
      } catch (error) {
        if (!(error instanceof ServiceError && error.code === 'stale_nonce')) throw error;
        nonce = await client.nonce('UsageStats', account.address);
        outcome = await client.relay({ action: 'ReportUsage', ...(await sign()) });
      }
    } catch (error) {
      results.push({ ...summary, status: 'failed', error: error instanceof Error ? error.message : String(error) });
      if (error instanceof ServiceError && error.status < 500) continue;
      stoppedAt = plan.fingerprint;
      break;
    }
    nonce += 1n;
    settings.reported[reportedKey(chain.chainId, plan.fingerprint)] = {
      cumulativeInvocations: sent.cumulativeInvocations,
      scenes: Object.fromEntries(sent.scenes.map((bucket) => [bucket.key, bucket.cumulative])),
      outcomes: Object.fromEntries(sent.outcomes.map((bucket) => [bucket.key, bucket.cumulative])),
      reportedAt: now.toISOString(),
      txHash: outcome.txHash,
    };
    await writeUsageSettings(paths.dataDir, settings);
    results.push({
      ...summary,
      status: outcome.status === 'confirmed' ? 'reported' : 'submitted',
      cumulative: sent.cumulativeInvocations,
      added: sent.cumulativeInvocations - onChain,
      transaction: outcome.txHash,
      explorer: outcome.explorerUrl,
    });
    // The next report needs the next contract nonce, which an unconfirmed
    // transaction has not used yet on chain.
    if (outcome.status === 'pending') { stoppedAt = plan.fingerprint; break; }
  }
  const failed = results.some((item) => (item as { status: string }).status === 'failed');
  if (!stoppedAt && !failed) settings.lastRunAt = now.toISOString();
  await writeUsageSettings(paths.dataDir, settings);
  return {
    status: enabling ? 'enabled' : pending.length === 0 ? 'nothing_new' : failed || stoppedAt ? 'partial' : 'reported',
    enabled: true,
    wallet: account.address,
    network: networkLabel(chain.chainId),
    reports: results,
    ...(stoppedAt || failed
      ? { next: 'Not everything was sent. Run `obelisk usage report` again in a minute; reports only ever send running totals, so nothing is counted twice.' }
      : {}),
  };
}

async function disable(deps: UsageDeps) {
  const paths = resolveObeliskPaths({ env: deps.env ?? process.env });
  const settings = await readUsageSettings(paths.dataDir);
  if (!settings.enabled) return { status: 'already_disabled', enabled: false };
  settings.enabled = false;
  settings.disabledAt = (deps.now?.() ?? new Date()).toISOString();
  await writeUsageSettings(paths.dataDir, settings);
  return { status: 'disabled', enabled: false, note: 'Nothing more will be reported. Totals already reported stay on chain.' };
}

export async function runUsageCommand(args: string[], deps: UsageDeps = {}): Promise<unknown> {
  const [action, ...rest] = args;
  const flags = new Set(rest);
  const only = (...allowed: string[]) => {
    if (rest.some((flag) => !allowed.includes(flag)) || flags.size !== rest.length) throw new Error(USAGE_USAGE);
  };
  if (action === 'status') { only(); return preview(deps, 'status'); }
  if (action === 'enable') {
    only('--confirm');
    return flags.has('--confirm') ? report(deps, { ifDue: false, enabling: true }) : preview(deps, 'enable');
  }
  if (action === 'disable') { only(); return disable(deps); }
  if (action === 'report') { only('--if-due'); return report(deps, { ifDue: flags.has('--if-due'), enabling: false }); }
  throw new Error(USAGE_USAGE);
}
