// List the mainnet Skills on SkillMarket. Each author signs ListSkill with
// their own local Obelisk wallet (macOS Keychain); the service relay submits
// it and pays the gas, so authors need no BOT. Read-only unless --confirm.
// Royalty is locked by the contract at a Skill's first listing.
//
//   node --experimental-strip-types scripts/mainnet-list-offers.mjs            # preview
//   node --experimental-strip-types scripts/mainnet-list-offers.mjs --confirm  # sign and submit
import { parseEther } from 'viem';
import { loadWallet } from '../../packages/core/src/wallet.ts';
import { resolveObeliskPaths } from '../../packages/core/src/paths.ts';
import { systemSecretStore } from '../../packages/core/src/keychain.ts';
import { skillMarketTypes } from '../../chain/eip712.ts';
const base = 'https://obelisk-service-mainnet.kinomotomiovo.workers.dev';
const H = process.env.HOME + '/.obelisk-hackathon';
const plan = [
  { skillId: '1', home: `${H}/mainnet/home`, mode: 0, price: '0', royaltyBps: 1000 },
  { skillId: '2', home: `${H}/playground/roles/mainnet-builder/obelisk`, mode: 2, price: '0.002', royaltyBps: 1000 },
  { skillId: '3', home: `${H}/playground/roles/mainnet-designer/obelisk`, mode: 0, price: '0', royaltyBps: 1000 },
  { skillId: '4', home: `${H}/playground/roles/mainnet-builder/obelisk`, mode: 2, price: '0.003', royaltyBps: 0 },
];
const confirm = process.argv[2] === '--confirm';
const chain = await (await fetch(`${base}/v1/chain`)).json();
for (const item of plan) {
  const { account } = await loadWallet({ paths: resolveObeliskPaths({ env: { ...process.env, OBELISK_HOME: item.home } }), secrets: systemSecretStore() });
  const skill = await (await fetch(`${base}/v1/skills/${item.skillId}`)).json();
  const ok = skill.author.toLowerCase() === account.address.toLowerCase();
  console.log(`#${item.skillId} ${skill.content?.name} author ${skill.author} wallet ${account.address} ${ok ? 'MATCH' : 'MISMATCH'} -> ${item.mode === 0 ? 'free' : item.price + ' BOT buyout'}, royalty ${item.royaltyBps / 100}%`);
  if (!ok || !confirm) continue;
  const { nonce } = await (await fetch(`${base}/v1/nonces/SkillMarket/${account.address}`)).json();
  const message = { author: account.address, skillId: item.skillId, versionIndex: '0', mode: item.mode, license: 0, price: parseEther(item.price).toString(), royaltyBps: item.royaltyBps, nonce, deadline: String(Math.floor(Date.now() / 1000) + 600) };
  const signature = await account.signTypedData({ domain: { name: 'ObeliskSkillMarket', version: '1', chainId: chain.chainId, verifyingContract: chain.market }, types: skillMarketTypes, primaryType: 'ListSkill', message: { ...message, skillId: BigInt(message.skillId), versionIndex: 0n, price: BigInt(message.price), nonce: BigInt(nonce), deadline: BigInt(message.deadline) } });
  const r = await fetch(`${base}/v1/relay`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'ListSkill', message, signature }) });
  const body = await r.json();
  console.log('   ', r.status, body.status ?? body.error?.code, body.txHash ?? body.error?.message);
}
