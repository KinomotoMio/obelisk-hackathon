// Copyright (C) 2026 tommy0103 and contributors.
// SPDX-License-Identifier: AGPL-3.0-only

// `obelisk skill mint <name> [--confirm <fingerprint>]` (#16).
//
// Agent-facing like `obelisk wallet`: prints one JSON object whose `next`
// says what to do next. Without --confirm it only previews what will be
// written on chain. The confirmation names the previewed fingerprint, so a
// draft that changed after the preview is never what gets signed.
//
// A confirmed mint: MintSkill (or PublishVersion, for a Skill minted before)
// signed by the wallet and relayed by the online service, which pays the
// fee; then the body is stored on the service with a SkillContent signature
// so others can fetch it (#17); then the version is frozen in the local
// library. Re-running the same confirmation finishes an interrupted mint
// without writing on chain again.

import { getAddress, type Address } from 'viem';

import { resolveObeliskPaths } from '../../core/src/paths.ts';
import { systemSecretStore, type SecretStore } from '../../core/src/keychain.ts';
import { loadWallet } from '../../core/src/wallet.ts';
import {
  ObeliskServiceClient,
  networkLabel,
  resolveServiceUrl,
  ServiceError,
  type ChainInfo,
  type MintedSkillInfo,
  type RelayOutcome,
} from '../../core/src/obelisk-service.ts';
import { describeSceneTag, migrateSceneTag, normalizeBirthScenes } from '../../core/src/scenes.ts';
import {
  findDynamicSkillContent,
  normalizeSkillBody,
  readSkill,
  recordMintedVersion,
  type SkillMint,
  type SkillView,
} from '../../core/src/skills.ts';
import { fingerprintToBytes32, signMintSkill, signPublishVersion, signSkillContent } from '../../core/src/skill-chain.ts';

export const SKILL_MINT_USAGE = 'Usage: obelisk skill mint <name> [--confirm <fingerprint>]';

/** How long a mint signature stays valid for the relay. */
const MINT_DEADLINE_SECONDS = 600;
/** The service accepts 256 KiB per stored Skill, metadata included. */
const MAX_BODY_BYTES = 200 * 1024;

export interface SkillChainDeps {
  env?: NodeJS.ProcessEnv;
  secrets?: SecretStore;
  fetch?: typeof fetch;
  now?: () => Date;
  cwd?: string;
}

function envOf(deps: SkillChainDeps): NodeJS.ProcessEnv {
  return deps.env ?? process.env;
}

export function skillService(deps: SkillChainDeps): ObeliskServiceClient {
  return new ObeliskServiceClient(resolveServiceUrl(envOf(deps)), deps.fetch);
}

function explorerLink(chain: ChainInfo, kind: 'tx' | 'address', value: string): string | null {
  return chain.explorerUrl ? `${chain.explorerUrl}/${kind}/${value}` : null;
}

/** A minted version by 0x fingerprint, or null when it is not on chain. */
async function mintedVersion(client: ObeliskServiceClient, fingerprint: string): Promise<MintedSkillInfo | null> {
  try {
    return await client.skill(fingerprintToBytes32(fingerprint));
  } catch (error) {
    if (error instanceof ServiceError && error.code === 'unknown_skill') return null;
    throw error;
  }
}

function notSubmitted(error: unknown, what: string): never {
  // The relay answers 4xx and these 503s before any transaction exists.
  const refused = error instanceof ServiceError
    && ((error.status >= 400 && error.status < 500) || ['relay_unavailable', 'relay_out_of_funds'].includes(error.code));
  if (refused) {
    const retry = error.code === 'stale_nonce' ? '; run the command again' : '';
    throw new Error(`${what} was not submitted: ${error.message}${retry}`, { cause: error });
  }
  throw error;
}

interface ParentPlan {
  skillId: string;
  name: string | null;
  author: Address;
}

async function resolveParent(skill: SkillView, skillsDir: string, client: ObeliskServiceClient, chain: ChainInfo): Promise<ParentPlan | null> {
  const parent = skill.parent;
  if (!parent) return null;
  if (parent.chainId !== undefined && parent.chainId !== chain.chainId) {
    throw new Error(`Skill ${skill.name} names a parent on chain ${parent.chainId}, but the Obelisk online service is on ${networkLabel(chain.chainId)}`);
  }
  let info: MintedSkillInfo | null = null;
  if (parent.skillId) {
    try {
      info = await client.skill(parent.skillId, { versionIndex: 0 });
    } catch (error) {
      if (error instanceof ServiceError && error.code === 'unknown_skill') {
        throw new Error(`Parent Skill #${parent.skillId} is not minted on ${networkLabel(chain.chainId)}`, { cause: error });
      }
      throw error;
    }
  } else if (parent.fingerprint) {
    info = await mintedVersion(client, parent.fingerprint);
    if (!info) throw new Error(`Parent Skill version ${parent.fingerprint} is not minted on ${networkLabel(chain.chainId)}`);
  } else if (parent.name) {
    const local = await readSkill(skillsDir, parent.name);
    const minted = local?.versions.filter((version) => version.mint?.chainId === chain.chainId).at(-1);
    if (!minted?.mint) {
      throw new Error(`Parent Skill ${parent.name} is not minted on ${networkLabel(chain.chainId)}; mint it first (\`obelisk skill mint ${parent.name}\`)`);
    }
    info = await client.skill(minted.mint.skillId, { versionIndex: 0 });
  }
  if (!info) return null;
  return { skillId: info.skillId, name: parent.name ?? info.content?.name ?? null, author: info.author };
}

function chainBirthScenes(skill: SkillView): string[] {
  // On chain, every tag is written in the current vocabulary version.
  return normalizeBirthScenes(skill.birthScenes).map((tag) => {
    const current = migrateSceneTag(tag);
    if (current === null) {
      throw new Error(`Birth scene ${tag} is no longer in the scene vocabulary; retag ${skill.name} with \`obelisk skill tag\` (see \`obelisk skill scenes\`)`);
    }
    return current;
  });
}

async function storeBody(
  client: ObeliskServiceClient,
  chain: ChainInfo,
  account: Awaited<ReturnType<typeof loadWallet>>['account'],
  skill: SkillView,
  fingerprint: string,
): Promise<{ bodyStored: boolean; bodyError?: string }> {
  const body = normalizeSkillBody(skill.draft!.body);
  const message = { author: account.address, fingerprint: fingerprintToBytes32(fingerprint), name: skill.name, description: skill.description };
  try {
    const signature = await signSkillContent(account, chain.chainId, chain.contracts.SkillRegistry, message);
    await client.storeSkillContent(message.fingerprint, { ...message, body, signature });
    return { bodyStored: true };
  } catch (error) {
    return { bodyStored: false, bodyError: error instanceof Error ? error.message : String(error) };
  }
}

async function finishMint(
  deps: SkillChainDeps,
  client: ObeliskServiceClient,
  chain: ChainInfo,
  account: Awaited<ReturnType<typeof loadWallet>>['account'],
  skill: SkillView,
  fingerprint: string,
  { txHash, status }: { txHash: string | null; status: 'minted' | 'version_published' | 'already_minted' },
) {
  const skillsDir = resolveObeliskPaths({ env: envOf(deps) }).skillsDir;
  const info = await mintedVersion(client, fingerprint);
  if (!info) throw new Error(`Transaction ${txHash ?? '(unknown)'} was confirmed, but SkillRegistry does not show fingerprint ${fingerprint} yet; run the same command again in a minute`);
  if (getAddress(info.author) !== account.address) {
    throw new Error(`Fingerprint ${fingerprint} is minted as Skill #${info.skillId} by ${info.author}, not by this wallet (${account.address})`);
  }
  const local = skill.versions.find((version) => version.fingerprint === fingerprint && version.mint?.chainId === chain.chainId);
  const mint: SkillMint = local?.mint ?? {
    chainId: chain.chainId,
    skillId: info.skillId,
    versionIndex: info.version.index,
    author: info.author,
    // null when an earlier run sent the transaction but did not see it confirmed.
    txHash,
    mintedAt: info.version.publishedAt,
  };
  if (!local) await recordMintedVersion(skillsDir, skill.name, { fingerprint, mint });
  const body = info.content ? { bodyStored: true } : await storeBody(client, chain, account, skill, fingerprint);
  const version = info.version.index + 1;
  return {
    status,
    skill: skill.name,
    skillId: info.skillId,
    version,
    fingerprint,
    author: info.author,
    network: networkLabel(chain.chainId),
    transaction: mint.txHash,
    explorer: {
      transaction: mint.txHash ? explorerLink(chain, 'tx', mint.txHash) : null,
      author: explorerLink(chain, 'address', info.author),
    },
    ...body,
    next: body.bodyStored
      ? `Minted on chain. Others fetch this version with \`obelisk skill fetch ${fingerprint}\` (or the latest version with \`obelisk skill fetch ${info.skillId}\`).`
      : `The mint is on chain, but the Skill body was not stored on the Obelisk online service, so nobody can fetch it yet. Run \`obelisk skill mint ${skill.name} --confirm ${fingerprint}\` again to retry.`,
  };
}

async function mint(name: string, confirmed: string | null, deps: SkillChainDeps) {
  const paths = resolveObeliskPaths({ env: envOf(deps) });
  const skill = await readSkill(paths.skillsDir, name);
  if (!skill) throw new Error(`Skill not found in the local library: ${name}; save a draft first (\`obelisk skill save\`)`);
  if (!skill.draft) throw new Error(`Skill ${name} has no draft to mint`);
  const fingerprint = skill.draft.fingerprint;
  if (confirmed !== null && confirmed !== fingerprint) {
    throw new Error(`Skill ${name} changed since the preview: its draft fingerprint is now ${fingerprint}, not ${confirmed}. Preview again with \`obelisk skill mint ${name}\` and show it to the user.`);
  }
  const { account } = await loadWallet({ paths, secrets: deps.secrets ?? systemSecretStore() });
  const client = skillService(deps);
  const chain = await client.chain();
  const network = networkLabel(chain.chainId);

  // Already on chain: recorded locally, or minted by an earlier run that did
  // not finish (pending transaction, body upload failed).
  const onChain = await mintedVersion(client, fingerprint);
  if (onChain) {
    if (getAddress(onChain.author) !== account.address) {
      throw new Error(`This exact Skill body is already minted as Skill #${onChain.skillId} by ${onChain.author}; a body can be minted only once. Change the draft to mint your own version.`);
    }
    if (confirmed === null) {
      return {
        status: 'already_minted',
        skill: name,
        skillId: onChain.skillId,
        version: onChain.version.index + 1,
        fingerprint,
        network,
        bodyStored: onChain.content !== null,
        recordedLocally: skill.draft.minted,
        ...(onChain.content && skill.draft.minted
          ? {}
          : { next: `Run \`obelisk skill mint ${name} --confirm ${fingerprint}\` to finish: it records the mint locally and stores the body for others to fetch. Nothing new is written on chain.` }),
      };
    }
    return finishMint(deps, client, chain, account, skill, fingerprint, { txHash: null, status: 'already_minted' });
  }

  const body = normalizeSkillBody(skill.draft.body);
  const bodyBytes = Buffer.byteLength(body, 'utf8');
  if (bodyBytes > MAX_BODY_BYTES) {
    throw new Error(`Skill ${name} body is ${bodyBytes} bytes; the Obelisk online service stores bodies up to ${MAX_BODY_BYTES} bytes`);
  }
  const warnings = findDynamicSkillContent(body).map((label) =>
    `The body contains ${label}, which Claude Code rewrites when it loads the Skill, so its invocations will not match this fingerprint.`);

  // A Skill minted before on this chain gets a new version; otherwise a new Skill.
  const previous = skill.versions.filter((version) => version.mint?.chainId === chain.chainId).at(-1)?.mint ?? null;
  let plan: { action: 'MintSkill'; birthScenes: string[]; parent: ParentPlan | null } | { action: 'PublishVersion'; skillId: string; version: number };
  if (previous) {
    const current = await client.skill(previous.skillId);
    if (getAddress(current.author) !== account.address) {
      throw new Error(`Skill #${previous.skillId} was minted by ${current.author}; this wallet (${account.address}) cannot publish its versions`);
    }
    plan = { action: 'PublishVersion', skillId: previous.skillId, version: current.versionCount + 1 };
  } else {
    plan = { action: 'MintSkill', birthScenes: chainBirthScenes(skill), parent: await resolveParent(skill, paths.skillsDir, client, chain) };
  }

  if (confirmed === null) {
    const common = {
      preview: true,
      skill: name,
      description: skill.description,
      author: account.address,
      network,
      contract: chain.contracts.SkillRegistry,
      fingerprint,
      bodyBytes,
    };
    const notes = {
      visibility: 'The Skill body is stored publicly on the Obelisk online service: anyone can fetch it and check it against the on-chain fingerprint.',
      fee: 'Paid by the Obelisk online service; this wallet is not charged.',
      ...(warnings.length > 0 ? { warnings } : {}),
      next: `Show this preview to the user. Only after they confirm, run \`obelisk skill mint ${name} --confirm ${fingerprint}\`.`,
    };
    if (plan.action === 'PublishVersion') {
      return {
        ...common,
        action: `Publish version ${plan.version} of Skill #${plan.skillId} in SkillRegistry`,
        skillId: plan.skillId,
        version: plan.version,
        permanent: 'The fingerprint and its author are written on chain and cannot be changed. Birth scenes and parent Skill stay as minted with the first version.',
        ...notes,
      };
    }
    return {
      ...common,
      action: 'Mint a new Skill in SkillRegistry',
      version: 1,
      birthScenes: plan.birthScenes.map((tag) => {
        const { label, dimension } = describeSceneTag(tag);
        return { tag, label, dimension };
      }),
      parent: plan.parent,
      provenanceSessions: new Set(skill.provenance.map((item) => item.sessionId)).size,
      permanent: 'The author, fingerprint, birth scenes, and parent Skill are written on chain and cannot be changed.',
      ...notes,
    };
  }

  const nowSeconds = Math.floor((deps.now?.() ?? new Date()).getTime() / 1000);
  const nonce = await client.nonce('SkillRegistry', account.address);
  const deadline = BigInt(nowSeconds + MINT_DEADLINE_SECONDS);
  let outcome: RelayOutcome;
  if (plan.action === 'MintSkill') {
    const message = {
      author: account.address,
      fingerprint: fingerprintToBytes32(fingerprint),
      birthScenes: plan.birthScenes,
      parentSkillId: BigInt(plan.parent?.skillId ?? 0),
      nonce,
      deadline,
    };
    const signature = await signMintSkill(account, chain.chainId, chain.contracts.SkillRegistry, message);
    outcome = await client.relay({ action: 'MintSkill', message, signature }).catch((error: unknown) => notSubmitted(error, 'The mint'));
  } else {
    const message = { author: account.address, skillId: BigInt(plan.skillId), fingerprint: fingerprintToBytes32(fingerprint), nonce, deadline };
    const signature = await signPublishVersion(account, chain.chainId, chain.contracts.SkillRegistry, message);
    outcome = await client.relay({ action: 'PublishVersion', message, signature }).catch((error: unknown) => notSubmitted(error, 'The new version'));
  }
  if (outcome.status === 'pending') {
    return {
      status: 'submitted',
      skill: name,
      fingerprint,
      network,
      transaction: outcome.txHash,
      explorer: { transaction: outcome.explorerUrl },
      next: `The transaction was sent but not yet confirmed. In a minute, run \`obelisk skill mint ${name} --confirm ${fingerprint}\` again to finish; it will not mint twice.`,
    };
  }
  return finishMint(deps, client, chain, account, skill, fingerprint, {
    txHash: outcome.txHash,
    status: plan.action === 'MintSkill' ? 'minted' : 'version_published',
  });
}

export async function runSkillMintCommand(args: string[], deps: SkillChainDeps = {}): Promise<unknown> {
  const [name, ...rest] = args;
  if (!name || name.startsWith('--')) throw new Error(SKILL_MINT_USAGE);
  if (rest.length === 0) return mint(name, null, deps);
  if (rest.length === 2 && rest[0] === '--confirm' && /^[0-9a-f]{64}$/.test(rest[1]!)) return mint(name, rest[1]!, deps);
  throw new Error(`${SKILL_MINT_USAGE} (--confirm takes the 64-hex fingerprint from the preview)`);
}
