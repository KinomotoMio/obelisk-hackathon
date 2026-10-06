// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 tommy0103 and contributors.

// Fee relay: take a user-signed action, check it, and submit it from the
// service's own wallet, which pays the gas. The user is always the address
// that signed; the relay wallet only carries the transaction.
//
// Every check that can fail without spending gas runs first: field shapes,
// deadline, the signer's current contract nonce, the signature itself, and a
// gas estimate (which executes the call and surfaces the contract's custom
// error). Submission is serialized so the relay wallet's own transaction
// nonces never collide, and so one user's actions on one contract reach the
// chain in the order they were signed (their contract nonces are sequential).

import {
  BaseError,
  ContractFunctionRevertedError,
  formatEther,
  recoverTypedDataAddress,
  type Abi,
  type Account,
  type Address,
  type Hex,
  type PublicClient,
  type WalletClient,
} from 'viem';

import { keyRegistryAbi, shareRegistryAbi, skillRegistryAbi, usageStatsAbi } from '../../chain/abi/index.ts';
import { obeliskDomain } from '../../chain/eip712.ts';
import { parseRelayRequest, RequestError, type ParsedRelayRequest } from './actions.ts';
import { explorerTxUrl, type ContractName, type ServiceChainConfig } from './chains.ts';

export const CONTRACT_ABIS: Record<ContractName, Abi> = {
  KeyRegistry: keyRegistryAbi,
  ShareRegistry: shareRegistryAbi,
  SkillRegistry: skillRegistryAbi,
  UsageStats: usageStatsAbi,
};

/** Seconds a signature must still be valid for when it reaches the relay. */
export const MIN_DEADLINE_HEADROOM_SECONDS = 30n;

export interface RateLimiter {
  /** Count one relay for `signer`; false when it or the service is over its limit. */
  take(signer: Address): Promise<boolean>;
}

export interface RelayRecord {
  action: string;
  contract: ContractName;
  signer: Address;
  submittedAt: string;
}

export interface RelayerDeps {
  config: ServiceChainConfig;
  publicClient: PublicClient;
  /** Null when the service has no relay wallet configured; reads still work. */
  walletClient: (WalletClient & { account: Account }) | null;
  limits: RateLimiter;
  /** Persist a small record of a submitted transaction (best effort). */
  recordTx?: (hash: Hex, record: RelayRecord) => Promise<void>;
  now?: () => number;
  receiptTimeoutMs?: number;
  pollingIntervalMs?: number;
}

export type RelayResult =
  | { status: 'confirmed'; action: string; signer: Address; txHash: Hex; blockNumber: string; explorerUrl: string | null }
  | { status: 'pending'; action: string; signer: Address; txHash: Hex; explorerUrl: string | null };

function stringifyArg(value: unknown): string {
  return typeof value === 'bigint' ? value.toString() : JSON.stringify(value);
}

/** Turn a revert from estimateGas into the contract's own error name. */
function contractRejection(error: unknown, request: ParsedRelayRequest): RequestError | null {
  if (!(error instanceof BaseError)) return null;
  const reverted = error.walk((cause) => cause instanceof ContractFunctionRevertedError);
  if (!(reverted instanceof ContractFunctionRevertedError)) return null;
  const name = reverted.data?.errorName ?? reverted.reason ?? 'unknown revert';
  const args = (reverted.data?.args ?? []).map(stringifyArg).join(', ');
  return new RequestError(
    422,
    'contract_rejected',
    `${request.definition.contract} rejected ${request.action}: ${name}${reverted.data ? `(${args})` : ''}`,
    { error: name },
  );
}

function isNonceConflict(error: unknown): boolean {
  const text = error instanceof Error ? `${error.message} ${(error as BaseError).details ?? ''}` : String(error);
  return /nonce too low|already known|replacement transaction underpriced|nonce has already been used/i.test(text);
}

/** Reject a signature not made by the action's named signer (401). */
export async function verifyActionSignature(publicClient: PublicClient, config: ServiceChainConfig, request: ParsedRelayRequest): Promise<void> {
  const contract = request.definition.contract;
  const address = config.contracts[contract];
  const recovered = await recoverTypedDataAddress({
    domain: obeliskDomain(contract, config.chain.id, address),
    types: request.definition.types as Record<string, { name: string; type: string }[]>,
    primaryType: request.action,
    message: request.message,
    signature: request.signature,
  }).catch(() => null);
  if (recovered === request.signer) return;
  // A contract wallet (ERC-1271) signs without an ECDSA key; the contract
  // checks those itself, so only plain accounts are rejected here.
  const code = await publicClient.getCode({ address: request.signer });
  if (!code || code === '0x') {
    throw new RequestError(401, 'invalid_signature', `The signature was not made by ${request.signer}`);
  }
}

export class Relayer {
  readonly #deps: RelayerDeps;
  #tail: Promise<unknown> = Promise.resolve();
  #nextNonce: number | null = null;

  constructor(deps: RelayerDeps) {
    this.#deps = deps;
  }

  get relayerAddress(): Address | null {
    return this.#deps.walletClient?.account.address ?? null;
  }

  /** `internal` admits the service's own actions (RecordOpen, #9); see actions.ts. */
  async relay(body: unknown, { internal = false }: { internal?: boolean } = {}): Promise<RelayResult> {
    const { config, publicClient } = this.#deps;
    const request = parseRelayRequest(body, { internal });
    const contract = request.definition.contract;
    const address = config.contracts[contract];
    const abi = CONTRACT_ABIS[contract];

    const nowSeconds = BigInt(Math.floor((this.#deps.now?.() ?? Date.now()) / 1000));
    if (request.deadline <= nowSeconds + MIN_DEADLINE_HEADROOM_SECONDS) {
      throw new RequestError(400, 'deadline_too_soon', `Signature deadline ${request.deadline} has passed or is less than ${MIN_DEADLINE_HEADROOM_SECONDS}s away; sign again with a later deadline`);
    }

    const expectedNonce = await publicClient.readContract({ address, abi, functionName: 'nonces', args: [request.signer] }) as bigint;
    if (request.nonce !== expectedNonce) {
      throw new RequestError(
        409,
        'stale_nonce',
        `Signed with nonce ${request.nonce}, but ${contract} expects ${expectedNonce} for ${request.signer}; read the nonce again and re-sign`,
        { expectedNonce: expectedNonce.toString() },
      );
    }

    await verifyActionSignature(publicClient, config, request);

    const txHash = await this.#serialized(() => this.#submit(request, address, abi));
    const explorerUrl = explorerTxUrl(config, txHash);
    try {
      const receipt = await publicClient.waitForTransactionReceipt({
        hash: txHash,
        timeout: this.#deps.receiptTimeoutMs ?? 25_000,
        pollingInterval: this.#deps.pollingIntervalMs ?? 1_000,
      });
      if (receipt.status !== 'success') {
        throw new RequestError(502, 'transaction_reverted', `Transaction ${txHash} was mined but reverted`, { txHash, explorerUrl });
      }
      return { status: 'confirmed', action: request.action, signer: request.signer, txHash, blockNumber: receipt.blockNumber.toString(), explorerUrl };
    } catch (error) {
      if (error instanceof RequestError) throw error;
      // The transaction is out; a slow or flaky receipt lookup must not be
      // reported as a failure the caller might retry. They poll /v1/tx.
      return { status: 'pending', action: request.action, signer: request.signer, txHash, explorerUrl };
    }
  }

  /** Run `task` after every earlier submission has finished. */
  #serialized<T>(task: () => Promise<T>): Promise<T> {
    const run = this.#tail.then(task, task);
    this.#tail = run.catch(() => undefined);
    return run;
  }

  async #submit(request: ParsedRelayRequest, address: Address, abi: Abi, retried = false): Promise<Hex> {
    const { config, publicClient, walletClient, limits } = this.#deps;
    if (!walletClient) {
      throw new RequestError(503, 'relay_unavailable', 'This service has no relay wallet configured (RELAYER_PRIVATE_KEY is not set)');
    }
    const relayer = walletClient.account;
    if (!retried && !(await limits.take(request.signer))) {
      throw new RequestError(429, 'rate_limited', `Too many relayed actions for ${request.signer}; try again later`);
    }

    let gas: bigint;
    try {
      gas = await publicClient.estimateContractGas({
        address,
        abi,
        functionName: request.definition.functionName,
        args: request.args,
        account: relayer,
      });
    } catch (error) {
      throw contractRejection(error, request) ?? error;
    }

    const [gasPrice, balance, pendingNonce] = await Promise.all([
      publicClient.getGasPrice(),
      publicClient.getBalance({ address: relayer.address }),
      publicClient.getTransactionCount({ address: relayer.address, blockTag: 'pending' }),
    ]);
    const gasLimit = (gas * 12n) / 10n;
    const cost = gasLimit * gasPrice;
    if (balance < cost) {
      throw new RequestError(
        503,
        'relay_out_of_funds',
        `The relay wallet ${relayer.address} has ${formatEther(balance)} ${config.chain.nativeCurrency.symbol} but this action needs about ${formatEther(cost)}; top it up`,
      );
    }

    // The public RPC can lag behind a transaction it just accepted, so keep
    // our own count and never reuse a nonce we already sent.
    const nonce = Math.max(pendingNonce, this.#nextNonce ?? 0);
    try {
      const hash = await walletClient.writeContract({
        address,
        abi,
        functionName: request.definition.functionName,
        args: request.args,
        account: relayer,
        chain: config.chain,
        gas: gasLimit,
        gasPrice,
        nonce,
      });
      this.#nextNonce = nonce + 1;
      await this.#deps.recordTx?.(hash, {
        action: request.action,
        contract: request.definition.contract,
        signer: request.signer,
        submittedAt: new Date(this.#deps.now?.() ?? Date.now()).toISOString(),
      }).catch(() => undefined);
      return hash;
    } catch (error) {
      if (!retried && isNonceConflict(error)) {
        this.#nextNonce = null;
        return this.#submit(request, address, abi, true);
      }
      throw error;
    }
  }
}
