// Copyright (C) 2026 tommy0103 and contributors.
// SPDX-License-Identifier: AGPL-3.0-only

// `obelisk share outline | draft | send` (#8, docs/vision/02 S1/S2/S6).
//
// Agent-facing like `obelisk wallet`: each command prints one JSON object and,
// in `next`, what to do next. Sending encrypts content for someone else and
// writes on chain, so `send` previews until it gets --confirm. The privacy
// check reports what it found by type and location only; values never appear
// in output, because output goes straight into the AI conversation.

import { userInfo } from 'node:os';

import { getAddress, isAddress, type Address, type Hex } from 'viem';

import { obeliskDomain, shareRegistryTypes } from '../../core/src/chain-protocol.ts';
import { readSessionDetail } from '../../core/src/core.ts';
import { systemSecretStore, type SecretStore } from '../../core/src/keychain.ts';
import {
  networkLabel,
  ObeliskServiceClient,
  resolveServiceUrl,
  ServiceError,
  type ChainInfo,
} from '../../core/src/obelisk-service.ts';
import { resolveObeliskPaths } from '../../core/src/paths.ts';
import type { ScanHints } from '../../core/src/privacy-scan.ts';
import { encryptShareContent, newShareId, sealContentKey } from '../../core/src/share-crypto.ts';
import { ShareDrafts, UNLIMITED_OPENS, type SentShare, type ShareDraft, type ShareOutbox } from '../../core/src/share-drafts.ts';
import {
  buildShareSnapshot,
  outlineMessages,
  redactShareSnapshot,
  scanShareSnapshot,
  type ShareFinding,
  type ShareSnapshot,
} from '../../core/src/share-snapshot.ts';
import type { SessionDetailForRead } from '../../core/src/session-detail-query.ts';
import { loadWallet, type WalletContext } from '../../core/src/wallet.ts';

export const SHARE_USAGE = [
  'Usage:',
  '  obelisk share outline <session-id>',
  '  obelisk share draft <session-id> --to <0x address> [--messages <from>-<to>|all] [--opens <n>|unlimited] [--expires <n>m|h|d]',
  '  obelisk share send <draft-id> [--redact all|none|<n>,<n>…] [--confirm]',
].join('\n');

/** How long a CreateShare signature stays valid for the relay. */
const SIGNATURE_DEADLINE_SECONDS = 600;
/** Largest snapshot accepted; the service takes at most 8 MiB of ciphertext. */
const MAX_SNAPSHOT_BYTES = 6 * 1024 * 1024;
const DEFAULT_OPENS = 1;
const DEFAULT_EXPIRES_SECONDS = 24 * 3600;
const MAX_EXPIRES_SECONDS = 365 * 24 * 3600;

export interface ShareCommandDeps {
  env?: NodeJS.ProcessEnv;
  secrets?: SecretStore;
  fetch?: typeof fetch;
  now?: () => Date;
  readSession?: (ref: string) => SessionDetailForRead;
}

function walletContext(deps: ShareCommandDeps): WalletContext {
  return { paths: resolveObeliskPaths({ env: deps.env ?? process.env }), secrets: deps.secrets ?? systemSecretStore(), now: deps.now };
}

function drafts(deps: ShareCommandDeps): ShareDrafts {
  return new ShareDrafts(resolveObeliskPaths({ env: deps.env ?? process.env }).sharesDir);
}

function service(deps: ShareCommandDeps): ObeliskServiceClient {
  return new ObeliskServiceClient(resolveServiceUrl(deps.env ?? process.env), deps.fetch);
}

function scanHints(): ScanHints {
  try {
    return { username: userInfo().username };
  } catch {
    return {};
  }
}

const now = (deps: ShareCommandDeps) => deps.now?.() ?? new Date();

// --- argument parsing ------------------------------------------------------

function parseFlags(args: string[], allowed: Record<string, 'value' | 'switch'>): { positional: string[]; flags: Map<string, string | true> } {
  const positional: string[] = [];
  const flags = new Map<string, string | true>();
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i]!;
    if (!arg.startsWith('--')) { positional.push(arg); continue; }
    const kind = allowed[arg];
    if (!kind) throw new Error(`Unknown option ${arg}\n${SHARE_USAGE}`);
    if (kind === 'switch') { flags.set(arg, true); continue; }
    const value = args[i + 1];
    if (value === undefined || value.startsWith('--')) throw new Error(`${arg} needs a value\n${SHARE_USAGE}`);
    flags.set(arg, value);
    i += 1;
  }
  return { positional, flags };
}

function parseRange(value: string | undefined, total: number): { from: number; to: number } {
  if (total === 0) throw new Error('This session has no messages to share');
  if (value === undefined || value === 'all') return { from: 1, to: total };
  const match = /^(\d+)\s*(?:-|–|\.\.)\s*(\d+)$/.exec(value) ?? /^(\d+)$/.exec(value);
  if (!match) throw new Error(`--messages must be <from>-<to> (for example 12-48) or all, got ${value}`);
  return { from: Number(match[1]), to: Number(match[2] ?? match[1]) };
}

function parseOpens(value: string | undefined): number {
  if (value === undefined) return DEFAULT_OPENS;
  if (value === 'unlimited') return UNLIMITED_OPENS;
  const opens = Number(value);
  if (!Number.isSafeInteger(opens) || opens < 1 || opens >= UNLIMITED_OPENS) throw new Error(`--opens must be a positive whole number or unlimited, got ${value}`);
  return opens;
}

function parseExpires(value: string | undefined): number {
  if (value === undefined) return DEFAULT_EXPIRES_SECONDS;
  const match = /^(\d+)\s*(m|min|h|d)$/i.exec(value.trim());
  if (!match) throw new Error(`--expires must be a duration such as 30m, 24h, or 7d, got ${value}`);
  const unit = match[2]!.toLowerCase();
  const seconds = Number(match[1]) * (unit.startsWith('m') ? 60 : unit === 'h' ? 3600 : 86400);
  if (seconds < 300 || seconds > MAX_EXPIRES_SECONDS) throw new Error('--expires must be between 5m and 365d');
  return seconds;
}

function parseRedact(value: string, findings: ShareFinding[]): number[] {
  if (value === 'all') return findings.map((finding) => finding.id);
  if (value === 'none') return [];
  const ids = value.split(',').map((part) => part.trim()).filter(Boolean).map(Number);
  if (ids.length === 0 || ids.some((id) => !Number.isInteger(id))) {
    throw new Error(`--redact takes all, none, or finding numbers such as 1,3, got ${value}`);
  }
  const unknown = ids.filter((id) => !findings.some((finding) => finding.id === id));
  if (unknown.length > 0) throw new Error(`No privacy finding numbered ${unknown.join(', ')}; this draft has ${findings.length === 0 ? 'none' : `1–${findings.length}`}`);
  return [...new Set(ids)].sort((a, b) => a - b);
}

// --- presentation ----------------------------------------------------------

function describeDuration(seconds: number): string {
  if (seconds % 86400 === 0) return `${seconds / 86400} day${seconds === 86400 ? '' : 's'}`;
  if (seconds % 3600 === 0) return `${seconds / 3600} hour${seconds === 3600 ? '' : 's'}`;
  return `${Math.round(seconds / 60)} minutes`;
}

function rules(draft: ShareDraft) {
  return {
    opens: draft.maxOpens === UNLIMITED_OPENS ? 'unlimited' : draft.maxOpens,
    expires: `${describeDuration(draft.expiresInSeconds)} after sending`,
  };
}

function messagesSummary(snapshot: ShareSnapshot) {
  return {
    from: snapshot.range.from,
    to: snapshot.range.to,
    count: snapshot.messages.length,
    toolCalls: snapshot.messages.reduce((sum, message) => sum + message.toolCalls.length, 0),
    sessionHas: snapshot.range.total,
  };
}

function sessionSummary(snapshot: ShareSnapshot) {
  return { id: snapshot.source.sessionId, title: snapshot.title, provider: snapshot.source.provider };
}

/** The privacy findings as the conversation may see them: no values. */
function findingsView(findings: ShareFinding[]) {
  return findings.map(({ id, label, type, occurrences, where }) => ({ id, type, label, occurrences, where }));
}

function redactionView(findings: ShareFinding[], redact: number[]) {
  const chosen = new Set(redact);
  return {
    redacted: findings.filter((f) => chosen.has(f.id)).map((f) => ({ id: f.id, label: f.label, where: f.where })),
    kept: findings.filter((f) => !chosen.has(f.id)).map((f) => ({ id: f.id, label: f.label, where: f.where })),
    summary: findings.length === 0
      ? 'The privacy check found nothing to redact.'
      : `${chosen.size} of ${findings.length} finding${findings.length === 1 ? '' : 's'} will be redacted.`,
  };
}

async function recipientStatus(client: ObeliskServiceClient, recipient: Address) {
  const chain = await client.chain();
  const key = await client.key(recipient);
  return { chain, activated: key.registered && Boolean(key.pubKey), key };
}

const NOT_ACTIVATED = (recipient: Address) =>
  `${recipient} has not activated an Obelisk wallet yet, so nothing can be encrypted to it. Ask them to run \`obelisk wallet activate\` (or "帮我创建 Obelisk 钱包" in their AI coding assistant), then preview again.`;

// --- commands --------------------------------------------------------------

function outline(args: string[], deps: ShareCommandDeps) {
  const { positional } = parseFlags(args, {});
  if (positional.length !== 1) throw new Error(SHARE_USAGE);
  const { session, messages } = (deps.readSession ?? readSessionDetail)(positional[0]!);
  return {
    session: { id: session.id, title: session.title ?? null, provider: session.source ?? null },
    messages: outlineMessages(messages, scanHints()),
    next: 'Pick the range to share by message number, then run `obelisk share draft <session-id> --to <address> --messages <from>-<to>`.',
  };
}

async function draft(args: string[], deps: ShareCommandDeps) {
  const { positional, flags } = parseFlags(args, { '--to': 'value', '--messages': 'value', '--opens': 'value', '--expires': 'value' });
  if (positional.length !== 1) throw new Error(SHARE_USAGE);
  const to = flags.get('--to');
  if (typeof to !== 'string') throw new Error(`--to <0x address> is required\n${SHARE_USAGE}`);
  if (!isAddress(to, { strict: false })) throw new Error(`--to must be a wallet address (0x followed by 40 hex characters), got ${to}`);
  const recipient = getAddress(to);
  const maxOpens = parseOpens(flags.get('--opens') as string | undefined);
  const expiresInSeconds = parseExpires(flags.get('--expires') as string | undefined);

  const { account } = await loadWallet(walletContext(deps));
  const { session, messages } = (deps.readSession ?? readSessionDetail)(positional[0]!);
  const { from, to: last } = parseRange(flags.get('--messages') as string | undefined, messages.length);
  const snapshot = buildShareSnapshot({ session, messages, from, to: last, capturedAt: now(deps) });
  const bytes = Buffer.byteLength(JSON.stringify(snapshot));
  if (bytes > MAX_SNAPSHOT_BYTES) {
    throw new Error(`Messages ${from}–${last} come to ${(bytes / 1048576).toFixed(1)} MB, more than one share can hold (${MAX_SNAPSHOT_BYTES / 1048576} MB); share a narrower range`);
  }
  const findings = scanShareSnapshot(snapshot, scanHints());

  let recipientView: Record<string, unknown>;
  try {
    const status = await recipientStatus(service(deps), recipient);
    recipientView = { address: recipient, activated: status.activated, network: networkLabel(status.chain.chainId) };
  } catch (error) {
    recipientView = { address: recipient, activated: 'unknown', serviceError: error instanceof Error ? error.message : String(error) };
  }

  const record = await drafts(deps).create({
    createdAt: now(deps).toISOString(),
    sessionId: session.id,
    recipient,
    maxOpens,
    expiresInSeconds,
    snapshot,
    decision: null,
  });
  const notActivated = recipientView['activated'] === false;
  return {
    draft: record.draftId,
    from: account.address,
    session: sessionSummary(snapshot),
    messages: messagesSummary(snapshot),
    recipient: recipientView,
    rules: rules(record),
    privacyCheck: {
      found: findings.length,
      findings: findingsView(findings),
      note: 'Only the type and location of each finding are shown, never its value.',
    },
    next: notActivated
      ? NOT_ACTIVATED(recipient)
      : findings.length > 0
        ? `Show the user the privacy check (types and locations only; do not look up or quote the values) and ask whether to redact all of them or decide one by one. Then preview with \`obelisk share send ${record.draftId} --redact all\` (or --redact 1,3 to redact only those, or --redact none).`
        : `Nothing sensitive was found. Preview with \`obelisk share send ${record.draftId}\`.`,
  };
}

function signCreateShare(account: Awaited<ReturnType<typeof loadWallet>>['account'], chain: ChainInfo, message: Record<string, unknown>): Promise<Hex> {
  return account.signTypedData({
    domain: obeliskDomain('ShareRegistry', chain.chainId, chain.contracts.ShareRegistry),
    types: shareRegistryTypes,
    primaryType: 'CreateShare',
    message: message as never,
  });
}

async function send(args: string[], deps: ShareCommandDeps) {
  const { positional, flags } = parseFlags(args, { '--redact': 'value', '--confirm': 'switch' });
  if (positional.length !== 1) throw new Error(SHARE_USAGE);
  const store = drafts(deps);
  const record = await store.load(positional[0]!);

  const already = await store.sent(record.draftId);
  if (already) {
    await store.dropUnsent(record);
    return { status: 'already_shared', ...sentView(already) };
  }
  if (!record.snapshot) throw new Error(`Share draft ${record.draftId} has no snapshot left to send; start a new one with \`obelisk share draft\``);
  const snapshot = record.snapshot;
  const findings = scanShareSnapshot(snapshot, scanHints());
  const confirm = flags.has('--confirm');
  const asked = flags.get('--redact') as string | undefined;
  const redact = asked !== undefined ? parseRedact(asked, findings) : null;

  if (!confirm) {
    if (redact === null && findings.length > 0) {
      return {
        preview: false,
        draft: record.draftId,
        needs: 'a redaction choice',
        privacyCheck: { found: findings.length, findings: findingsView(findings) },
        next: `Ask the user whether to redact all findings or which ones, then run \`obelisk share send ${record.draftId} --redact all\` (or --redact 1,3, or --redact none).`,
      };
    }
    const chosen = redact ?? [];
    const client = service(deps);
    const status = await recipientStatus(client, record.recipient);
    const { account } = await loadWallet(walletContext(deps));
    await store.save({ ...record, decision: { redact: chosen, previewedAt: now(deps).toISOString() } });
    return {
      preview: true,
      draft: record.draftId,
      action: 'Encrypt this snapshot on this computer so only the recipient\'s wallet can open it, upload the ciphertext to the Obelisk online service, and record the share rules on BOT Chain',
      from: account.address,
      session: sessionSummary(snapshot),
      messages: messagesSummary(snapshot),
      recipient: { address: record.recipient, activated: status.activated },
      rules: rules(record),
      redaction: redactionView(findings, chosen),
      network: networkLabel(status.chain.chainId),
      contract: status.chain.contracts.ShareRegistry,
      fee: 'Paid by the Obelisk online service; this wallet is not charged.',
      next: status.activated
        ? `Show this preview to the user. Only after they confirm, run \`obelisk share send ${record.draftId} --confirm\`.`
        : NOT_ACTIVATED(record.recipient),
    };
  }

  if (!record.decision) {
    throw new Error(`Preview the share first: \`obelisk share send ${record.draftId}${findings.length > 0 ? ' --redact all' : ''}\`, show it to the user, then confirm`);
  }
  if (redact !== null && redact.join(',') !== record.decision.redact.join(',')) {
    throw new Error(`The redaction choice differs from the last preview; preview it again with \`obelisk share send ${record.draftId} --redact ${asked}\` before confirming`);
  }
  return sendConfirmed(record, snapshot, record.decision.redact, deps);
}

function sentView(sent: SentShare) {
  return {
    link: sent.link,
    shareId: sent.shareId,
    recipient: sent.recipient,
    rules: { opens: sent.maxOpens === UNLIMITED_OPENS ? 'unlimited' : sent.maxOpens, expiresAt: sent.expiresAt },
    redacted: sent.redacted,
    network: networkLabel(sent.chainId),
    transaction: sent.transaction,
    explorer: sent.explorer,
  };
}

async function sendConfirmed(record: ShareDraft, snapshot: ShareSnapshot, redact: number[], deps: ShareCommandDeps) {
  const store = drafts(deps);
  const { account } = await loadWallet(walletContext(deps));
  const client = service(deps);
  const chain = await client.chain();
  const hints = scanHints();
  const redacted = redactShareSnapshot(snapshot, new Set(redact), hints);

  const finish = async (outbox: ShareOutbox, txHash: Hex | null, explorer: string | null) => {
    const onChain = await client.share(outbox.shareId);
    if (!onChain) {
      throw new Error(`Transaction ${txHash ?? '(unknown)'} was confirmed, but ShareRegistry does not show share ${outbox.shareId} yet; run \`obelisk share send ${record.draftId} --confirm\` again in a minute`);
    }
    if (getAddress(onChain.sender) !== account.address || onChain.contentHash.toLowerCase() !== outbox.contentHash.toLowerCase() || getAddress(onChain.recipient) !== record.recipient) {
      throw new Error(`Share ${outbox.shareId} on chain does not match this draft (sender, recipient, or content differ); not recording it as sent`);
    }
    const sent: SentShare = {
      version: 1,
      draftId: record.draftId,
      shareId: outbox.shareId,
      link: client.shareLink(outbox.shareId),
      chainId: chain.chainId,
      sender: account.address,
      recipient: record.recipient,
      maxOpens: onChain.maxOpens ?? UNLIMITED_OPENS,
      expiresAt: onChain.expiresAt,
      title: redacted.title,
      source: redacted.source,
      range: redacted.range,
      redacted: redact.length,
      transaction: txHash ?? onChain.transactions.create?.txHash ?? null,
      explorer: explorer ?? onChain.transactions.create?.explorerUrl ?? null,
      sentAt: now(deps).toISOString(),
    };
    await store.markSent(record, sent, redacted);
    return {
      status: 'shared',
      ...sentView(sent),
      next: `Give the user the link. Only ${record.recipient} can open it, ${sent.maxOpens === UNLIMITED_OPENS ? 'any number of times' : `at most ${sent.maxOpens} time${sent.maxOpens === 1 ? '' : 's'}`}, until ${sent.expiresAt}; anyone else who gets the link is refused.`,
    };
  };

  let outbox = await store.outbox(record.draftId);
  if (outbox) {
    // A previous confirm got this far: finish that share rather than start another.
    if (await client.share(outbox.shareId)) return finish(outbox, outbox.txHash ?? null, null);
    if (outbox.txHash) {
      const tx = await client.tx(outbox.txHash).catch(() => null);
      if (tx?.status === 'pending') return submitted(record, outbox, tx.explorerUrl, chain);
    }
  }

  const key = await client.key(record.recipient);
  if (!key.registered || !key.pubKey) throw new Error(`The share was not created: ${NOT_ACTIVATED(record.recipient)}`);
  if (!outbox || outbox.recipientKey.toLowerCase() !== key.pubKey.toLowerCase() || outbox.redact.join(',') !== redact.join(',')) {
    const shareId = newShareId();
    const { contentKey, blob, contentHash } = encryptShareContent(new TextEncoder().encode(JSON.stringify(redacted)), shareId);
    outbox = {
      version: 1,
      shareId,
      contentHash,
      recipientKey: key.pubKey,
      keyPackage: sealContentKey(contentKey, key.pubKey, shareId),
      ciphertext: Buffer.from(blob).toString('base64'),
      redact,
    };
    await store.saveOutbox(record.draftId, outbox);
  }

  const nowSeconds = Math.floor(now(deps).getTime() / 1000);
  const message = {
    sender: account.address,
    shareId: outbox.shareId,
    recipient: record.recipient,
    contentHash: outbox.contentHash,
    maxOpens: record.maxOpens,
    expiresAt: BigInt(nowSeconds + record.expiresInSeconds),
    nonce: await client.nonce('ShareRegistry', account.address),
    deadline: BigInt(nowSeconds + SIGNATURE_DEADLINE_SECONDS),
  };
  const signature = await signCreateShare(account, chain, message);
  let outcome;
  try {
    outcome = await client.createShare({ message, signature, keyPackage: outbox.keyPackage, ciphertext: outbox.ciphertext });
  } catch (error) {
    if (error instanceof ServiceError && error.code === 'share_exists') return finish(outbox, null, null);
    // The service answers 4xx and these 503s before any transaction exists.
    const refused = error instanceof ServiceError
      && ((error.status >= 400 && error.status < 500) || ['relay_unavailable', 'relay_out_of_funds', 'storage_unavailable'].includes(error.code));
    if (refused) {
      const retry = ['stale_nonce', 'recipient_key_changed'].includes((error as ServiceError).code) ? '; run the same command again' : '';
      throw new Error(`The share was not created: ${error.message}${retry}`, { cause: error });
    }
    throw error;
  }
  if (outcome.status === 'pending') {
    outbox = { ...outbox, txHash: outcome.txHash };
    await store.saveOutbox(record.draftId, outbox);
    return submitted(record, outbox, outcome.explorerUrl, chain);
  }
  return finish(outbox, outcome.txHash, outcome.explorerUrl);
}

function submitted(record: ShareDraft, outbox: ShareOutbox, explorer: string | null, chain: ChainInfo) {
  return {
    status: 'submitted',
    shareId: outbox.shareId,
    network: networkLabel(chain.chainId),
    transaction: outbox.txHash ?? null,
    explorer,
    next: `The share was sent to the chain but not confirmed yet. In a minute, run \`obelisk share send ${record.draftId} --confirm\` again to finish; it will not create a second share.`,
  };
}

export async function runShareCommand(args: string[], deps: ShareCommandDeps = {}): Promise<unknown> {
  const [action, ...rest] = args;
  if (action === 'outline') return outline(rest, deps);
  if (action === 'draft') return draft(rest, deps);
  if (action === 'send') return send(rest, deps);
  throw new Error(SHARE_USAGE);
}
