// Copyright (C) 2026 tommy0103 and contributors.
// SPDX-License-Identifier: AGPL-3.0-only

// `obelisk wallet create | show | activate [--confirm]` (#4).
//
// Agent-facing: each command prints one JSON object that says what happened
// and, in `next`, what to do next. Activation writes on chain, so without
// --confirm it only previews. The private key is never printed.

import { resolveObeliskPaths } from '../../core/src/paths.ts';
import { systemSecretStore, type SecretStore } from '../../core/src/keychain.ts';
import {
  createWallet,
  deriveEncryptionKey,
  loadWallet,
  signRegisterKey,
  type WalletContext,
} from '../../core/src/wallet.ts';
import {
  ObeliskServiceClient,
  networkLabel,
  resolveServiceUrl,
  ServiceError,
  type ChainInfo,
  type KeyInfo,
} from '../../core/src/obelisk-service.ts';

export const WALLET_USAGE = 'Usage: obelisk wallet create | show | activate [--confirm]';

/** How long a RegisterKey signature stays valid for the relay. */
const ACTIVATION_DEADLINE_SECONDS = 600;

export interface WalletCommandDeps {
  env?: NodeJS.ProcessEnv;
  secrets?: SecretStore;
  fetch?: typeof fetch;
  now?: () => Date;
}

function context(deps: WalletCommandDeps): WalletContext {
  const paths = resolveObeliskPaths({ env: deps.env ?? process.env });
  return { paths, secrets: deps.secrets ?? systemSecretStore(), now: deps.now };
}

function service(deps: WalletCommandDeps): ObeliskServiceClient {
  return new ObeliskServiceClient(resolveServiceUrl(deps.env ?? process.env), deps.fetch);
}

function addressUrl(chain: ChainInfo, address: string): string | null {
  return chain.explorerUrl ? `${chain.explorerUrl}/address/${address}` : null;
}

type Activation = 'active' | 'not_activated' | 'different_key';

function activationOf(key: KeyInfo, registeredKey: string): Activation {
  if (!key.registered || !key.pubKey) return 'not_activated';
  return key.pubKey.toLowerCase() === registeredKey.toLowerCase() ? 'active' : 'different_key';
}

async function create(deps: WalletCommandDeps) {
  const ctx = context(deps);
  const { status, address } = await createWallet(ctx);
  return {
    status,
    address,
    storedIn: ctx.secrets.description,
    dataDir: ctx.paths.dataDir,
    next: status === 'exists'
      ? 'This data directory already has a wallet. Run `obelisk wallet show` to see whether it is activated.'
      : 'Run `obelisk wallet activate` to preview activation (registers this wallet\'s encryption public key on BOT Chain so others can share with you; the Obelisk online service pays the fee).',
  };
}

async function show(deps: WalletCommandDeps) {
  const ctx = context(deps);
  const { account } = await loadWallet(ctx);
  const base = { address: account.address, storedIn: ctx.secrets.description, dataDir: ctx.paths.dataDir };
  const { registeredKey } = await deriveEncryptionKey(account);
  try {
    const client = service(deps);
    const chain = await client.chain();
    const key = await client.key(account.address);
    const activation = activationOf(key, registeredKey);
    return {
      ...base,
      network: networkLabel(chain.chainId),
      activation,
      encryptionPublicKey: registeredKey,
      ...(activation === 'active' ? { keyVersion: key.version, activatedAt: key.updatedAt } : {}),
      explorer: addressUrl(chain, account.address),
      ...(activation === 'active' ? {} : { next: 'Run `obelisk wallet activate` to preview activation.' }),
    };
  } catch (error) {
    return {
      ...base,
      activation: 'unknown',
      encryptionPublicKey: registeredKey,
      serviceError: error instanceof Error ? error.message : String(error),
    };
  }
}

async function activate(deps: WalletCommandDeps, confirm: boolean) {
  const ctx = context(deps);
  const { account } = await loadWallet(ctx);
  const { registeredKey } = await deriveEncryptionKey(account);
  const client = service(deps);
  const chain = await client.chain();
  const keyRegistry = chain.contracts.KeyRegistry;
  const network = networkLabel(chain.chainId);
  const current = await client.key(account.address);
  const state = activationOf(current, registeredKey);

  if (state === 'active') {
    return {
      status: 'already_active',
      wallet: account.address,
      network,
      encryptionPublicKey: registeredKey,
      keyVersion: current.version,
      explorer: addressUrl(chain, account.address),
    };
  }
  if (!confirm) {
    return {
      preview: true,
      action: state === 'different_key'
        ? 'Replace the encryption public key registered for this wallet in KeyRegistry'
        : 'Register this wallet\'s encryption public key in KeyRegistry',
      wallet: account.address,
      network,
      contract: keyRegistry,
      encryptionPublicKey: registeredKey,
      replaces: state === 'different_key' ? current.pubKey : null,
      fee: 'Paid by the Obelisk online service; this wallet is not charged.',
      next: 'Show this preview to the user. Only after they confirm, run `obelisk wallet activate --confirm`.',
    };
  }

  const nowSeconds = Math.floor((deps.now?.() ?? new Date()).getTime() / 1000);
  const message = {
    user: account.address,
    pubKey: registeredKey,
    nonce: BigInt(current.nonce),
    deadline: BigInt(nowSeconds + ACTIVATION_DEADLINE_SECONDS),
  };
  const signature = await signRegisterKey(account, chain.chainId, keyRegistry, message);
  let outcome;
  try {
    outcome = await client.relay({ action: 'RegisterKey', message, signature });
  } catch (error) {
    // The relay answers 4xx and these 503s before any transaction exists.
    const refused = error instanceof ServiceError
      && ((error.status >= 400 && error.status < 500) || ['relay_unavailable', 'relay_out_of_funds'].includes(error.code));
    if (refused) {
      const retry = error.code === 'stale_nonce' ? '; run the command again' : '';
      throw new Error(`Activation was not submitted: ${error.message}${retry}`, { cause: error });
    }
    throw error;
  }
  if (outcome.status === 'pending') {
    return {
      status: 'submitted',
      wallet: account.address,
      network,
      transaction: outcome.txHash,
      explorer: outcome.explorerUrl,
      next: 'The transaction was sent but not yet confirmed. Run `obelisk wallet show` in a minute to check activation.',
    };
  }

  const after = await client.key(account.address);
  if (activationOf(after, registeredKey) !== 'active') {
    throw new Error(`Transaction ${outcome.txHash} was confirmed, but KeyRegistry does not show this wallet's key yet; run \`obelisk wallet show\` to check again`);
  }
  return {
    status: 'activated',
    wallet: account.address,
    network,
    encryptionPublicKey: registeredKey,
    keyVersion: after.version,
    transaction: outcome.txHash,
    explorer: outcome.explorerUrl,
  };
}

export async function runWalletCommand(args: string[], deps: WalletCommandDeps = {}): Promise<unknown> {
  const [action, ...rest] = args;
  const flags = new Set(rest);
  const unknown = rest.filter((flag) => flag !== '--confirm');
  if (unknown.length > 0 || (action !== 'activate' && flags.size > 0)) throw new Error(WALLET_USAGE);
  if (action === 'create') return create(deps);
  if (action === 'show') return show(deps);
  if (action === 'activate') return activate(deps, flags.has('--confirm'));
  throw new Error(WALLET_USAGE);
}
