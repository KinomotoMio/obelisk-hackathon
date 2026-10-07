// SPDX-License-Identifier: AGPL-3.0-only
import { formatEther, type Address } from 'viem';
import { skillMarketAbi } from '../../chain/abi/index.ts';
import { RequestError } from './actions.ts';
import { parseAddressParam } from './reads.ts';
import { parseFingerprint, type SkillRouteDeps } from './skills.ts';

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
  if (route[0] !== 'market' || request.method !== 'GET') return null;
  if (route.length === 3 && route[1] === 'offers') return { offer: await readOffer(deps, route[2]!) };
  if (route.length === 3 && route[1] === 'income') return readIncome(deps, parseAddressParam(route[2]!), new URL(request.url).searchParams);
  return null;
}
