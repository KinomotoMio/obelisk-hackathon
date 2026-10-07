// SPDX-License-Identifier: AGPL-3.0-only
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createPublicClient, createWalletClient, encodeFunctionData, formatEther, http, keccak256, parseAbi, parseEther, type Hex } from 'viem';
import { skillMarketAbi } from '../../core/src/market-abi.ts';
import { skillMarketTypes } from '../../core/src/chain-protocol.ts';
import { resolveObeliskPaths } from '../../core/src/paths.ts';
import { systemSecretStore } from '../../core/src/keychain.ts';
import { loadWallet } from '../../core/src/wallet.ts';
import { skillService, type SkillChainDeps } from './skill-mint-command.ts';

const USAGE = 'obelisk market income | buy <offerId> | use <offerId> | list <skillId> --mode free|per-use|buyout --license personal|commercial --price <BOT> --royalty-bps <0-10000> [--version <zero-based>] [--confirm <request-id>]';
const clean = (value: unknown) => JSON.parse(JSON.stringify(value, (_, v) => typeof v === 'bigint' ? v.toString() : v)) as Record<string, unknown>;

export async function runMarketCommand(args: string[], deps: SkillChainDeps = {}) {
  const [action, target] = args;
  if (!['income', 'list', 'buy', 'use'].includes(action ?? '')) throw new Error(USAGE);
  const options: Record<string, string> = {};
  for (let i = action === 'income' ? 1 : 2; i < args.length; i += 2) {
    const key = args[i]!;
    if (!['--mode', '--license', '--price', '--royalty-bps', '--version', '--confirm'].includes(key) || !args[i + 1] || key in options) throw new Error(USAGE);
    options[key] = args[i + 1]!;
  }
  if (action !== 'income' && !/^[1-9]\d{0,30}$/.test(target ?? '')) throw new Error(USAGE);
  const paths = resolveObeliskPaths({ env: deps.env ?? process.env });
  const { account } = await loadWallet({ paths, secrets: deps.secrets ?? systemSecretStore() });
  const service = skillService(deps);
  const chain = await service.chain();
  if (!chain.market) throw new Error('Settlement is not deployed on this network');
  if (action === 'income') {
    const response = await (deps.fetch ?? fetch)(`${service.baseUrl}/v1/market/income/${account.address}`);
    if (!response.ok) throw new Error(`Income query failed (${response.status})`);
    return response.json();
  }
  const rpc = chain.chainId === 968 ? 'https://rpc.bohr.life' : chain.chainId === 677 ? 'https://rpc.botchain.ai' : chain.rpcUrl;
  if (!rpc) throw new Error('No RPC for this chain');
  const client = createPublicClient({ transport: http(rpc) });
  if (await client.getChainId() !== chain.chainId) throw new Error('RPC chain id does not match the selected service');
  const wallet = createWalletClient({ account, transport: http(rpc) });
  const contract = chain.market;
  const domain = { name: 'ObeliskSkillMarket', version: '1', chainId: chain.chainId, verifyingContract: contract };
  const id = BigInt(target!);
  let value = 0n;
  let offer: Awaited<ReturnType<typeof readOffer>> | null = null;
  async function readOffer() { return client.readContract({ address: contract, abi: skillMarketAbi, functionName: 'getOffer', args: [id] }); }
  let listing: { mode: number; license: number; price: bigint; royaltyBps: number; versionIndex: bigint } | null = null;
  const inheritance: { skillId: string; author: string; royaltyBps: number }[] = [];
  if (action === 'list') {
    const mode = ['free', 'per-use', 'buyout'].indexOf(options['--mode'] ?? '');
    const license = ['personal', 'commercial'].indexOf(options['--license'] ?? '');
    if (mode < 0 || license < 0 || !/^\d+(\.\d{1,18})?$/.test(options['--price'] ?? '')
      || !/^\d{1,5}$/.test(options['--royalty-bps'] ?? '') || Number(options['--royalty-bps']) > 10000
      || !/^\d{1,9}$/.test(options['--version'] ?? '0')) throw new Error(USAGE);
    listing = { mode, license, price: parseEther(options['--price']!), royaltyBps: Number(options['--royalty-bps']), versionIndex: BigInt(options['--version'] ?? '0') };
    if ((mode === 0) !== (listing.price === 0n)) throw new Error('Free offers require zero price; paid offers require a positive price');
    const registryAbi = parseAbi(['function getSkill(uint256) view returns (address author, uint256 parentSkillId, uint64 createdAt, uint256 versionCount, string[] birthScenes)']);
    let current = id;
    for (let depth = 0; current !== 0n && depth < 16; depth++) {
      const [author, parent] = await client.readContract({ address: chain.contracts.SkillRegistry, abi: registryAbi, functionName: 'getSkill', args: [current] });
      if (depth > 0) inheritance.push({ skillId: current.toString(), author,
        royaltyBps: await client.readContract({ address: contract, abi: skillMarketAbi, functionName: 'royaltyBps', args: [current] }) });
      current = parent;
    }
  } else {
    offer = await readOffer();
    if (action === 'buy') value = offer.price;
  }
  const platformBps = await client.readContract({ address: contract, abi: skillMarketAbi, functionName: 'platformBps' });
  const plan = clean({ action, id, chainId: chain.chainId, market: contract, wallet: account.address, listing, offer,
    ...(listing ? { platformBps, inheritance, allocationRule: 'Platform fee first; each parent receives its configured percentage of the amount passed to its child. The remainder stays with that child.' } : {}) });
  const requestId = options['--confirm'];
  if (!requestId) return { preview: true, ...plan, principalBOT: formatEther(value),
    walletBalanceBOT: formatEther(await client.getBalance({ address: account.address })),
    payment: 'This wallet pays the principal and gas. Testnet BOT is demonstration money, not operating revenue.',
    next: `obelisk market ${args.join(' ')} --confirm ${randomUUID()}` };
  if (!/^[a-zA-Z0-9-]{1,80}$/.test(requestId)) throw new Error('Invalid request id');
  const journalDir = join(paths.dataDir, 'market-transactions');
  await mkdir(journalDir, { recursive: true, mode: 0o700 });
  const journalPath = join(journalDir, `${chain.chainId}-${requestId}.json`);
  let journal: { plan: unknown; raw: Hex; hash: Hex } | null = null;
  try { journal = JSON.parse(await readFile(journalPath, 'utf8')); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  if (journal && JSON.stringify(journal.plan) !== JSON.stringify(plan)) throw new Error('This request id was already used for different terms');
  if (!journal) {
    const nonce = await client.readContract({ address: contract, abi: skillMarketAbi, functionName: 'nonces', args: [account.address] });
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 600);
    let data: Hex;
    if (listing) {
      const message = { author: account.address, skillId: id, ...listing, nonce, deadline };
      const signature = await account.signTypedData({ domain, types: skillMarketTypes, primaryType: 'ListSkill', message });
      data = encodeFunctionData({ abi: skillMarketAbi, functionName: 'listBySig', args: [account.address, id, listing.versionIndex, listing.mode, listing.license, listing.price, listing.royaltyBps, deadline, signature] });
    } else {
      const message = { buyer: account.address, offerId: id, nonce, deadline };
      const signature = await account.signTypedData({ domain, types: skillMarketTypes, primaryType: action === 'buy' ? 'BuySkill' : 'UseSkill', message });
      data = encodeFunctionData({ abi: skillMarketAbi, functionName: action === 'buy' ? 'buyBySig' : 'useBySig', args: [account.address, id, deadline, signature] });
    }
    const [estimate, gasPrice, txNonce] = await Promise.all([
      client.estimateGas({ account: account.address, to: contract, data, value }), client.getGasPrice(),
      client.getTransactionCount({ address: account.address, blockTag: 'pending' }),
    ]);
    const raw = await account.signTransaction({ type: 'legacy', chainId: chain.chainId, to: contract, data, value,
      gas: estimate * 120n / 100n, gasPrice, nonce: txNonce });
    journal = { plan, raw, hash: keccak256(raw) };
    // Persist before broadcasting. Retrying this request can only send identical bytes.
    await writeFile(journalPath, JSON.stringify(journal), { flag: 'wx', mode: 0o600 });
  }
  let receipt = await client.getTransactionReceipt({ hash: journal.hash }).catch(() => null);
  if (!receipt) {
    try { await wallet.sendRawTransaction({ serializedTransaction: journal.raw }); }
    catch (error) {
      // The first broadcast may already have succeeded. Never generate a replacement payment here.
      const known = await client.getTransaction({ hash: journal.hash }).catch(() => null);
      if (!known) throw new Error(`Transaction ${journal.hash} is not confirmed. Retry with the same --confirm ${requestId}; do not start another payment. ${error instanceof Error ? error.message.split('\n')[0] : 'Broadcast failed'}`, { cause: error });
    }
    receipt = await client.waitForTransactionReceipt({ hash: journal.hash, timeout: 60_000 });
  }
  if (receipt.status !== 'success') throw new Error(`Transaction ${journal.hash} reverted; no purchase or allocation was applied`);
  return { status: 'confirmed', ...plan, transaction: journal.hash, requestId,
    explorer: chain.explorerUrl ? `${chain.explorerUrl}/tx/${journal.hash}` : null,
    next: action === 'buy' ? `obelisk market use ${id}` : action === 'use'
      ? `obelisk skill fetch ${offer!.fingerprint.slice(2)} --receipt ${journal.hash}` : 'The offer is on chain; inspect it in the market.' };
}
