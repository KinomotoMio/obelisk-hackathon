// SPDX-License-Identifier: AGPL-3.0-only
import { decodeEventLog, decodeFunctionData, formatEther, getAddress, recoverTypedDataAddress, type Address, type Hex } from 'viem';
import { skillMarketAbi } from '../../chain/abi/index.ts';
import { skillAccessTypes } from '../../chain/eip712.ts';
import { RequestError } from './actions.ts';
import { parseAddressParam } from './reads.ts';
import { parseFingerprint, readStored, readSkillContentPayload, readSkillRecord, readVersion, type SkillRouteDeps } from './skills.ts';
import { skillRegistryAbi } from '../../chain/abi/index.ts';

function address(deps: SkillRouteDeps): Address {
  if (!deps.config.market) throw new RequestError(503, 'market_not_deployed', 'Skill settlement is not deployed on this network yet');
  return deps.config.market;
}

/** Buyer-facing data deliberately omits income and split details. */
export async function readOffer(deps: SkillRouteDeps, fingerprint: string) {
  const fp = parseFingerprint(fingerprint);
  if (!fp) throw new RequestError(400, 'invalid_fingerprint', 'Expected a Skill version fingerprint');
  if (!deps.config.market) return null;
  const contract = address(deps);
  const offerId = await deps.publicClient.readContract({ address: contract, abi: skillMarketAbi, functionName: 'latestOffer', args: [fp] });
  if (offerId === 0n) return null;
  const offer = await deps.publicClient.readContract({ address: contract, abi: skillMarketAbi, functionName: 'getOffer', args: [offerId] });
  return {
    offerId: offerId.toString(), contract, chainId: deps.config.chain.id,
    skillId: offer.skillId.toString(), versionIndex: Number(offer.versionIndex),
    fingerprint: offer.fingerprint, author: offer.author,
    mode: ['free', 'per-use', 'buyout'][offer.mode], license: ['personal', 'commercial'][offer.license],
    priceWei: offer.price.toString(), price: formatEther(offer.price), symbol: deps.config.chain.nativeCurrency.symbol,
    testnet: deps.config.chain.testnet === true,
  };
}

/** Creator/operations view of public settlement receipts, newest first. */
export async function readIncome(deps: SkillRouteDeps, wallet: Address, query: URLSearchParams) {
  const contract = address(deps);
  const limitText = query.get('limit') ?? '20';
  const beforeText = query.get('before');
  if (!/^\d{1,2}$/.test(limitText) || Number(limitText) < 1 || Number(limitText) > 50
    || (beforeText !== null && !/^\d{1,12}$/.test(beforeText))) {
    throw new RequestError(400, 'invalid_page', 'limit must be 1–50 and before a non-negative index');
  }
  const [count, total, platform] = await Promise.all([
    deps.publicClient.readContract({ address: contract, abi: skillMarketAbi, functionName: 'incomeCount', args: [wallet] }),
    deps.publicClient.readContract({ address: contract, abi: skillMarketAbi, functionName: 'totalIncome', args: [wallet] }),
    deps.publicClient.readContract({ address: contract, abi: skillMarketAbi, functionName: 'platform' }),
  ]);
  const start = beforeText === null ? count : (BigInt(beforeText) < count ? BigInt(beforeText) : count);
  const size = Math.min(Number(start), Number(limitText));
  const rows = await Promise.all(Array.from({ length: size }, async (_, i) => {
    const receiptId = await deps.publicClient.readContract({ address: contract, abi: skillMarketAbi, functionName: 'incomeAt', args: [wallet, start - 1n - BigInt(i)] });
    const [receipt, parts] = await Promise.all([
      deps.publicClient.readContract({ address: contract, abi: skillMarketAbi, functionName: 'getReceipt', args: [receiptId] }),
      deps.publicClient.readContract({ address: contract, abi: skillMarketAbi, functionName: 'allocations', args: [receiptId] }),
    ]);
    const mine = parts.filter(part => part.recipient.toLowerCase() === wallet.toLowerCase());
    const soldSkillId = parts.find(part => part.skillId !== 0n)?.skillId;
    const txRecord = await deps.skillContent?.get(`market-receipts/${deps.config.chain.id}/${receiptId}`);
    const transaction = txRecord ? JSON.parse(txRecord).transaction : null;
    return { receiptId: receiptId.toString(), offerId: receipt.offerId.toString(), buyer: receipt.buyer,
      paidWei: receipt.amount.toString(), timestamp: Number(receipt.timestamp),
      incomeWei: mine.reduce((sum, part) => sum + part.amount, 0n).toString(),
      directWei: mine.filter(part => part.skillId === soldSkillId).reduce((sum, part) => sum + part.amount, 0n).toString(),
      derivedWei: mine.filter(part => part.skillId !== 0n && part.skillId !== soldSkillId).reduce((sum, part) => sum + part.amount, 0n).toString(),
      transaction,
      allocations: parts.map(part => ({ recipient: part.recipient, amountWei: part.amount.toString(), skillId: part.skillId.toString() })),
    };
  }));
  return { chainId: deps.config.chain.id, contract, wallet, platform, totalWei: total.toString(), total: formatEther(total),
    testnet: deps.config.chain.testnet === true, count: count.toString(), rows,
    nextBefore: start > BigInt(size) ? (start - BigInt(size)).toString() : null };
}

export async function handleSettlementRoute(request: Request, route: string[], deps: SkillRouteDeps) {
  if (route[0] !== 'market') return null;
  if (request.method === 'POST' && route.length === 2 && route[1] === 'receipts') {
    return recordPurchase(deps, await readSkillContentPayload(request));
  }
  if (request.method === 'POST' && route.length === 3 && route[1] === 'content') {
    return deliverContent(deps, route[2]!, await readSkillContentPayload(request));
  }
  if (request.method !== 'GET') return null;
  if (route.length === 2 && route[1] === 'operations') {
    const contract = address(deps);
    const [platform, fee] = await Promise.all([
      deps.publicClient.readContract({ address: contract, abi: skillMarketAbi, functionName: 'platform' }),
      deps.publicClient.readContract({ address: contract, abi: skillMarketAbi, functionName: 'platformBps' }),
    ]);
    return { ...await readIncome(deps, platform, new URL(request.url).searchParams), platformBps: fee };
  }
  if (route.length === 3 && route[1] === 'offers') return { offer: await readOffer(deps, route[2]!) };
  if (route.length === 3 && route[1] === 'access') {
    if (!/^[1-9]\d{0,30}$/.test(route[2]!)) throw new RequestError(400, 'invalid_offer', 'Expected an offer id');
    const wallet = parseAddressParam(new URL(request.url).searchParams.get('wallet') ?? '');
    const offerId = BigInt(route[2]!);
    const contract = address(deps);
    const offer = await deps.publicClient.readContract({ address: contract, abi: skillMarketAbi, functionName: 'getOffer', args: [offerId] });
    const [perpetual, credits] = await Promise.all([
      deps.publicClient.readContract({ address: contract, abi: skillMarketAbi, functionName: 'perpetual', args: [wallet, offer.fingerprint, offer.license] }),
      deps.publicClient.readContract({ address: contract, abi: skillMarketAbi, functionName: 'credits', args: [wallet, offerId] }),
    ]);
    return { wallet, offerId: offerId.toString(), author: getAddress(offer.author) === wallet, perpetual, credits: credits.toString() };
  }
  if (route.length === 3 && route[1] === 'income') return readIncome(deps, parseAddressParam(route[2]!), new URL(request.url).searchParams);
  if (route.length === 3 && route[1] === 'creator') return readCreator(deps, parseAddressParam(route[2]!));
  return null;
}

/** Index only chain-proven public receipts; transaction links need no trusted uploader. */
export async function recordPurchase(deps: SkillRouteDeps, payload: unknown) {
  const contract = address(deps);
  const hash = payload && typeof payload === 'object' ? (payload as Record<string, unknown>).transaction : null;
  if (typeof hash !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(hash)) throw new RequestError(400, 'invalid_transaction', 'Expected a transaction hash');
  if (!deps.skillContent) throw new RequestError(503, 'storage_unavailable', 'Receipt index unavailable');
  const receipt = await deps.publicClient.getTransactionReceipt({ hash: hash as Hex });
  if (receipt.status !== 'success' || !receipt.to || getAddress(receipt.to) !== getAddress(contract)) throw new RequestError(403, 'not_purchase', 'Expected a successful market transaction');
  for (const log of receipt.logs) {
    if (getAddress(log.address) !== getAddress(contract)) continue;
    let event;
    try { event = decodeEventLog({ abi: skillMarketAbi, data: log.data, topics: log.topics }); } catch { continue; }
    if (event.eventName !== 'Purchased') continue;
    const receiptId = event.args.receiptId.toString();
    await deps.skillContent.putIfAbsent(`market-receipts/${deps.config.chain.id}/${receiptId}`, JSON.stringify({ transaction: hash.toLowerCase() }));
    return { indexed: true, receiptId, transaction: hash.toLowerCase() };
  }
  throw new RequestError(403, 'not_purchase', 'No purchase receipt in this transaction');
}

export async function readCreator(deps: SkillRouteDeps, wallet: Address) {
  const contract = address(deps);
  const total = await deps.publicClient.readContract({ address: deps.config.contracts.SkillRegistry, abi: skillRegistryAbi, functionName: 'skillsByAuthorCount', args: [wallet] });
  const assets = await Promise.all(Array.from({ length: Math.min(24, Number(total)) }, async (_, i) => {
    const id = await deps.publicClient.readContract({ address: deps.config.contracts.SkillRegistry, abi: skillRegistryAbi, functionName: 'skillsByAuthorAt', args: [wallet, total - 1n - BigInt(i)] });
    const skill = (await readSkillRecord(deps, id))!;
    const version = await readVersion(deps, id, skill.versionCount - 1);
    const [stored, offer, royalty] = await Promise.all([
      readStored(deps, version.fingerprint), readOffer(deps, version.fingerprint),
      deps.publicClient.readContract({ address: contract, abi: skillMarketAbi, functionName: 'royaltyBps', args: [id] }),
    ]);
    return { skillId: id.toString(), name: stored?.name ?? `Skill #${id}`, fingerprint: version.fingerprint,
      versionIndex: skill.versionCount - 1, parentSkillId: skill.parentSkillId.toString(), royaltyBps: royalty, offer };
  }));
  const [income, platformBps] = await Promise.all([
    readIncome(deps, wallet, new URLSearchParams()),
    deps.publicClient.readContract({ address: contract, abi: skillMarketAbi, functionName: 'platformBps' }),
  ]);
  return { ...income, assets, assetCount: total.toString(), assetsTruncated: total > 24n, platformBps };
}

/** A successful UseSkill transaction is a durable delivery receipt. Retrying
 * this endpoint with that receipt never consumes another paid retrieval. */
export async function deliverContent(deps: SkillRouteDeps, fingerprint: string, payload: unknown) {
  const contract = address(deps);
  const fp = parseFingerprint(fingerprint);
  if (!fp || !payload || typeof payload !== 'object') throw new RequestError(400, 'invalid_request', 'Expected fingerprint and signed access request');
  const raw = payload as Record<string, unknown>;
  const buyer = parseAddressParam(String(raw.buyer ?? ''));
  const tx = String(raw.useTransaction ?? '');
  const signature = String(raw.signature ?? '');
  const deadlineText = String(raw.deadline ?? '');
  if (!/^0x[0-9a-fA-F]{64}$/.test(tx) || !/^0x[0-9a-fA-F]{130}$/.test(signature) || !/^\d{1,12}$/.test(deadlineText)) {
    throw new RequestError(400, 'invalid_request', 'Expected useTransaction, signature and deadline');
  }
  const deadline = BigInt(deadlineText);
  const now = BigInt(Math.floor(Date.now() / 1000));
  if (deadline < now || deadline > now + 3600n) throw new RequestError(401, 'expired_access', 'Sign an access request valid for at most one hour');
  const signer = await recoverTypedDataAddress({
    domain: { name: 'ObeliskSkillMarket', version: '1', chainId: deps.config.chain.id, verifyingContract: contract },
    types: skillAccessTypes, primaryType: 'SkillAccess',
    message: { buyer, fingerprint: fp, useTransaction: tx as Hex, deadline }, signature: signature as Hex,
  });
  if (getAddress(signer) !== buyer) throw new RequestError(401, 'invalid_signature', 'Access must be signed by the buyer');
  const stored = await readStored(deps, fp);
  if (!stored) throw new RequestError(404, 'content_unavailable', 'This service has no content for that version');
  // Authors retain access to their own stored work without buying it.
  if (getAddress(stored.author) !== buyer && stored.visibility === 'licensed') {
    const [receipt, transaction] = await Promise.all([
      deps.publicClient.getTransactionReceipt({ hash: tx as Hex }),
      deps.publicClient.getTransaction({ hash: tx as Hex }),
    ]);
    if (receipt.status !== 'success' || !transaction.to || getAddress(transaction.to) !== getAddress(contract)) {
      throw new RequestError(403, 'no_access', 'A successful retrieval transaction on this market is required');
    }
    let decoded;
    try { decoded = decodeFunctionData({ abi: skillMarketAbi, data: transaction.input }); }
    catch { throw new RequestError(403, 'no_access', 'Not a Skill retrieval transaction'); }
    if (decoded.functionName !== 'useBySig' || getAddress(decoded.args[0]) !== buyer) {
      throw new RequestError(403, 'no_access', 'The retrieval receipt belongs to another buyer or action');
    }
    const offer = await deps.publicClient.readContract({ address: contract, abi: skillMarketAbi, functionName: 'getOffer', args: [decoded.args[1]] });
    if (offer.fingerprint.toLowerCase() !== fp) throw new RequestError(403, 'no_access', 'The receipt authorizes a different version');
  }
  return { chainId: deps.config.chain.id, fingerprint: fp,
    content: { name: stored.name, description: stored.description, body: stored.body },
    deliveryReceipt: tx, retryable: true };
}
