// SPDX-License-Identifier: AGPL-3.0-only
import { decodeFunctionData, formatEther, getAddress, recoverTypedDataAddress, type Address, type Hex } from 'viem';
import { skillMarketAbi } from '../../chain/abi/index.ts';
import { skillAccessTypes } from '../../chain/eip712.ts';
import { RequestError } from './actions.ts';
import { parseAddressParam } from './reads.ts';
import { parseFingerprint, readStored, readSkillContentPayload, type SkillRouteDeps } from './skills.ts';

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
    return { receiptId: receiptId.toString(), offerId: receipt.offerId.toString(), buyer: receipt.buyer,
      paidWei: receipt.amount.toString(), timestamp: Number(receipt.timestamp),
      incomeWei: mine.reduce((sum, part) => sum + part.amount, 0n).toString(),
      allocations: parts.map(part => ({ recipient: part.recipient, amountWei: part.amount.toString(), skillId: part.skillId.toString() })),
    };
  }));
  return { chainId: deps.config.chain.id, contract, wallet, platform, totalWei: total.toString(), total: formatEther(total),
    testnet: deps.config.chain.testnet === true, count: count.toString(), rows,
    nextBefore: start > BigInt(size) ? (start - BigInt(size)).toString() : null };
}

export async function handleSettlementRoute(request: Request, route: string[], deps: SkillRouteDeps) {
  if (route[0] !== 'market') return null;
  if (request.method === 'POST' && route.length === 3 && route[1] === 'content') {
    return deliverContent(deps, route[2]!, await readSkillContentPayload(request));
  }
  if (request.method !== 'GET') return null;
  if (route.length === 3 && route[1] === 'offers') return { offer: await readOffer(deps, route[2]!) };
  if (route.length === 3 && route[1] === 'income') return readIncome(deps, parseAddressParam(route[2]!), new URL(request.url).searchParams);
  return null;
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
