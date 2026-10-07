// SPDX-License-Identifier: AGPL-3.0-only
import { formatEther, type Address } from 'viem';
import { ObeliskServiceClient, explorerAddressUrl, networkNameZh } from '../../../packages/core/src/obelisk-service.ts';

const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const text = (value: unknown, max = 160): string => typeof value === 'string' ? value.slice(0, max) : '';
function integer(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{1,78}$/.test(value)) throw new Error('Invalid settlement amount or identifier');
  return value;
}
const list = (value: unknown): unknown[] => Array.isArray(value) ? value.slice(0, 50) : [];

export async function readCreatorMarket(service: ObeliskServiceClient, wallet: Address) {
  try {
    const chain = await service.chain();
    if (!chain.market) return { ok: false, message: '当前网络尚未开放上架结算。你的已铸造 Skill 仍在下方。' };
    const raw = object(await service.creatorMarket(wallet));
    if (raw.wallet !== wallet || raw.chainId !== chain.chainId) throw new Error('Settlement response belongs to another wallet or network');
    const assets = list(raw.assets).map(value => {
      const asset = object(value);
      const offer = object(asset.offer);
      return { skillId: integer(asset.skillId), name: text(asset.name),
        royaltyPercent: typeof asset.royaltyBps === 'number' && asset.royaltyBps >= 0 && asset.royaltyBps <= 10000 ? asset.royaltyBps / 100 : null,
        offer: asset.offer ? { price: formatEther(BigInt(integer(offer.priceWei))),
          mode: ({ free: '免费', 'per-use': '按次取用', buyout: '版本买断' } as Record<string, string>)[String(offer.mode)] ?? '未知',
          license: offer.license === 'commercial' ? '商用许可' : '个人使用' } : null };
    });
    const rows = list(raw.rows).map(value => {
      const row = object(value);
      return { receiptId: integer(row.receiptId), offerId: integer(row.offerId),
        income: formatEther(BigInt(integer(row.incomeWei))),
        direct: formatEther(BigInt(integer(row.directWei))), derived: formatEther(BigInt(integer(row.derivedWei))),
        transactionUrl: typeof row.transaction === 'string' && /^0x[0-9a-fA-F]{64}$/.test(row.transaction)
          ? explorerAddressUrl(chain.chainId, row.transaction)?.replace('/address/', '/tx/') ?? null : null,
        paid: formatEther(BigInt(integer(row.paidWei))),
        date: typeof row.timestamp === 'number' && Number.isFinite(row.timestamp) && row.timestamp > 0 && row.timestamp < 1e11 ? new Date(row.timestamp * 1000).toISOString() : null };
    });
    return { ok: true, wallet, network: networkNameZh(chain.chainId), testnet: chain.chainId !== 677,
      total: formatEther(BigInt(integer(raw.totalWei))), count: integer(raw.count),
      platformPercent: typeof raw.platformBps === 'number' && raw.platformBps >= 0 && raw.platformBps <= 2000 ? raw.platformBps / 100 : null,
      contractUrl: explorerAddressUrl(chain.chainId, chain.market), assets, rows,
      truncated: raw.assetsTruncated === true || raw.nextBefore !== null };
  } catch (error) { return { ok: false, message: error instanceof Error ? error.message : '收入暂时无法读取' }; }
}
