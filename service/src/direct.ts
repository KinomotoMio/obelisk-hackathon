// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 tommy0103 and contributors.

// Direct submission: the user's own browser wallet sends a signed action and
// pays its gas, instead of the fee relay. The contracts accept a `…BySig`
// call from anyone, so the transaction is the same one the relay would send;
// only its sender differs. The service still runs every check that can fail
// without spending gas, then hands the wallet the exact call to send.
//
//   POST /v1/direct/prepare   { action, message, signature } -> { to, data, gas, … } for eth_sendTransaction
//   POST /v1/direct           { txHash } -> a confirmed wallet-sent Obelisk transaction, indexed
//   GET  /v1/direct           wallet-sent transactions on this network, newest first
//   GET  /v1/stats            live counters for the landing page, read from the contracts

import { decodeFunctionData, encodeFunctionData, formatEther, getAddress, isHash, toHex, type Abi, type Address, type Hex, type PublicClient } from 'viem';

import { skillMarketAbi } from '../../chain/abi/index.ts';
import { RELAY_ACTIONS, RequestError, WALLET_ACTIONS } from './actions.ts';
import { CONTRACT_NAMES, explorerAddressUrl, explorerTxUrl, type ServiceChainConfig } from './chains.ts';
import { checkSignedAction, CONTRACT_ABIS, contractRejection } from './relayer.ts';

export interface WalletTxEntry {
  txHash: Hex;
  from: Address;
  contract: string;
  /** The EIP-712 action (RegisterKey, …) or, for the market, the function name. */
  action: string;
  blockNumber: string;
  /** Block time, ISO 8601. */
  timestamp: string;
}

export interface WalletTxStore {
  add(chainId: number, entry: WalletTxEntry): Promise<void>;
  list(chainId: number): Promise<WalletTxEntry[]>;
}

export interface DirectDeps {
  config: ServiceChainConfig;
  publicClient: PublicClient;
  relayerAddress: Address | null;
  walletTxs?: WalletTxStore | null;
  now?: () => number;
}

const ACTION_BY_FUNCTION: Record<string, string> = Object.fromEntries(
  Object.entries({ ...RELAY_ACTIONS, ...WALLET_ACTIONS }).map(([action, definition]) => [definition.functionName, action]),
);

/**
 * The call a browser wallet sends itself, after the relay's own pre-checks and
 * a gas estimate from the signer. A purchase (BuySkill) is wallet-only and
 * carries the offer's price as its value.
 */
export async function prepareDirect(deps: DirectDeps, body: unknown) {
  const { config, publicClient } = deps;
  const { request, address, abi } = await checkSignedAction(publicClient, config, body, { wallet: true, now: deps.now });
  const { functionName } = request.definition;
  let value = 0n;
  if (request.action === 'BuySkill') {
    const offer = await publicClient.readContract({ address, abi, functionName: 'getOffer', args: [request.message['offerId']] }) as { price: bigint };
    value = offer.price;
  }
  let gas: bigint;
  try {
    gas = await publicClient.estimateContractGas({ address, abi, functionName, args: request.args, account: request.signer, value });
  } catch (error) {
    throw contractRejection(error, request) ?? error;
  }
  const [gasPrice, balance] = await Promise.all([publicClient.getGasPrice(), publicClient.getBalance({ address: request.signer })]);
  const gasLimit = (gas * 12n) / 10n;
  const fee = gasLimit * gasPrice;
  return {
    chainId: config.chain.id,
    action: request.action,
    from: request.signer,
    to: address,
    data: encodeFunctionData({ abi, functionName, args: request.args }),
    value: toHex(value),
    price: formatEther(value),
    gas: toHex(gasLimit),
    gasPrice: toHex(gasPrice),
    estimatedFee: formatEther(fee),
    balance: formatEther(balance),
    enoughBalance: balance >= fee + value,
    symbol: config.chain.nativeCurrency.symbol,
  };
}

function contractOf(config: ServiceChainConfig, to: Address | null): { name: string; abi: Abi } | null {
  if (!to) return null;
  for (const name of CONTRACT_NAMES) {
    if (getAddress(config.contracts[name]) === getAddress(to)) return { name, abi: CONTRACT_ABIS[name] };
  }
  if (config.market && getAddress(config.market) === getAddress(to)) return { name: 'SkillMarket', abi: skillMarketAbi as Abi };
  return null;
}

/**
 * Index a confirmed Obelisk transaction that a user's own wallet sent. Only
 * chain facts are kept, so anyone can submit a hash and nobody can invent one.
 */
export async function recordWalletTx(deps: DirectDeps, body: unknown) {
  const { config, publicClient } = deps;
  const hash = body && typeof body === 'object' ? (body as Record<string, unknown>).txHash : null;
  if (typeof hash !== 'string' || !isHash(hash)) throw new RequestError(400, 'invalid_hash', 'Expected { txHash } with a 32-byte transaction hash');
  if (!deps.walletTxs) throw new RequestError(503, 'storage_unavailable', 'This service has no index for wallet transactions (KV is not bound)');
  const txHash = hash.toLowerCase() as Hex;
  const receipt = await publicClient.getTransactionReceipt({ hash: txHash }).catch(() => null);
  if (!receipt) throw new RequestError(409, 'not_confirmed', `Transaction ${txHash} is not confirmed yet; post it again once it is`);
  if (receipt.status !== 'success') throw new RequestError(422, 'transaction_reverted', `Transaction ${txHash} was mined but reverted`);
  const target = contractOf(config, receipt.to);
  if (!target) throw new RequestError(422, 'not_obelisk', `Transaction ${txHash} did not call an Obelisk contract on this network`);
  if (deps.relayerAddress && getAddress(receipt.from) === getAddress(deps.relayerAddress)) {
    throw new RequestError(422, 'relayed', `Transaction ${txHash} was sent by the relay wallet, not by a user's wallet`);
  }
  const [transaction, block] = await Promise.all([
    publicClient.getTransaction({ hash: txHash }),
    publicClient.getBlock({ blockNumber: receipt.blockNumber }),
  ]);
  let functionName = 'unknown';
  try { functionName = decodeFunctionData({ abi: target.abi, data: transaction.input }).functionName; } catch { /* kept as unknown */ }
  const entry: WalletTxEntry = {
    txHash,
    from: getAddress(receipt.from),
    contract: target.name,
    action: ACTION_BY_FUNCTION[functionName] ?? functionName,
    blockNumber: receipt.blockNumber.toString(),
    timestamp: new Date(Number(block.timestamp) * 1000).toISOString(),
  };
  await deps.walletTxs.add(config.chain.id, entry);
  return withLinks(config, entry);
}

function withLinks(config: ServiceChainConfig, entry: WalletTxEntry) {
  return { ...entry, explorerUrl: explorerTxUrl(config, entry.txHash), fromUrl: explorerAddressUrl(config, entry.from) };
}

export async function listWalletTxs(deps: DirectDeps, limit = 20) {
  const entries = deps.walletTxs ? await deps.walletTxs.list(deps.config.chain.id) : [];
  entries.sort((a, b) => Number(BigInt(b.blockNumber) - BigInt(a.blockNumber)));
  return {
    chainId: deps.config.chain.id,
    total: entries.length,
    wallets: new Set(entries.map((entry) => entry.from)).size,
    transactions: entries.slice(0, limit).map((entry) => withLinks(deps.config, entry)),
  };
}

/** Counters read from the contracts' view functions; a missing market reads as null. */
export async function readStats(deps: DirectDeps) {
  const { config, publicClient } = deps;
  const read = (address: Address, abi: Abi, functionName: string) =>
    publicClient.readContract({ address, abi, functionName }) as Promise<bigint>;
  const market = config.market ?? null;
  const [skills, wallets, versionsWithUsage, offers, purchases, block, direct] = await Promise.all([
    read(config.contracts.SkillRegistry, CONTRACT_ABIS.SkillRegistry, 'skillCount'),
    read(config.contracts.KeyRegistry, CONTRACT_ABIS.KeyRegistry, 'registeredCount'),
    read(config.contracts.UsageStats, CONTRACT_ABIS.UsageStats, 'reportedFingerprintCount'),
    market ? read(market, skillMarketAbi as Abi, 'offerCount') : null,
    market ? read(market, skillMarketAbi as Abi, 'receiptCount') : null,
    publicClient.getBlockNumber(),
    deps.walletTxs ? deps.walletTxs.list(config.chain.id) : Promise.resolve([]),
  ]);
  return {
    chainId: config.chain.id,
    name: config.chain.name,
    testnet: config.chain.testnet === true,
    blockNumber: block.toString(),
    skills: skills.toString(),
    activatedWallets: wallets.toString(),
    versionsWithUsage: versionsWithUsage.toString(),
    offers: offers === null ? null : offers.toString(),
    purchases: purchases === null ? null : purchases.toString(),
    walletSentTransactions: direct.length,
  };
}

export async function handleDirectRoute(request: Request, route: string[], deps: DirectDeps, readBody: () => Promise<unknown>) {
  if (route[0] === 'stats' && route.length === 1 && request.method === 'GET') return readStats(deps);
  if (route[0] !== 'direct') return null;
  if (route.length === 2 && route[1] === 'prepare' && request.method === 'POST') return prepareDirect(deps, await readBody());
  if (route.length === 1 && request.method === 'POST') return recordWalletTx(deps, await readBody());
  if (route.length === 1 && request.method === 'GET') return listWalletTxs(deps);
  return null;
}
