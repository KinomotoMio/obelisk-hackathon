import assert from "node:assert/strict";
import { it } from "node:test";
import { network } from "hardhat";
import { getAddress } from "viem";
import { obeliskDomain, skillRegistryTypes, skillMarketTypes } from "../eip712.js";
import { b32, offchainUser } from "../test-support/helpers.js";

it("pays three generations and the platform, preserves licenses, and rejects replay/unpaid use", async () => {
  const { viem, networkHelpers } = await network.create();
  const client = await viem.getPublicClient();
  const chainId = await client.getChainId();
  const skills = await viem.deployContract("SkillRegistry");
  const platform = offchainUser("platform");
  const authors = [offchainUser("root"), offchainUser("child"), offchainUser("grandchild")];
  const buyer = offchainUser("buyer");
  const market = await viem.deployContract("SkillMarket", [skills.address, platform.address, 500]);
  const deadline = BigInt(await networkHelpers.time.latest()) + 3600n;
  const domain = { name: "ObeliskSkillMarket", version: "1", chainId, verifyingContract: market.address };
  for (let i = 0; i < authors.length; i++) {
    const author = authors[i];
    const fingerprint = b32(`market-${i}`);
    const mint = { author: author.address, fingerprint, birthScenes: [], parentSkillId: BigInt(i), nonce: await skills.read.nonces([author.address]), deadline };
    const signature = await author.signTypedData({ domain: obeliskDomain("SkillRegistry", chainId, skills.address), types: skillRegistryTypes, primaryType: "MintSkill", message: mint });
    await skills.write.mintBySig([author.address, fingerprint, [], BigInt(i), deadline, signature]);
    const message = { author: author.address, skillId: BigInt(i + 1), versionIndex: 0n, mode: i === 2 ? 1 : 2, license: 1, price: 10000n, royaltyBps: 2000, nonce: await market.read.nonces([author.address]), deadline };
    const sig = await author.signTypedData({ domain, types: skillMarketTypes, primaryType: "ListSkill", message });
    await market.write.listBySig([author.address, message.skillId, 0n, message.mode, 1, 10000n, 2000, deadline, sig]);
  }
  const message = { buyer: buyer.address, offerId: 3n, nonce: await market.read.nonces([buyer.address]), deadline };
  const signature = await buyer.signTypedData({ domain, types: skillMarketTypes, primaryType: "BuySkill", message });
  const args = [buyer.address, 3n, deadline, signature] as const;
  await assert.rejects(market.write.buyBySig(args, { value: 9999n }));
  const wallets = [platform, authors[2], authors[1], authors[0]];
  const before = await Promise.all(wallets.map(w => client.getBalance({ address: w.address })));
  await market.write.buyBySig(args, { value: 10000n });
  const after = await Promise.all(wallets.map(w => client.getBalance({ address: w.address })));
  assert.deepEqual(after.map((n, i) => n - before[i]), [500n, 7600n, 1520n, 380n]);
  assert.equal(await market.read.receiptCount(), 1n);
  assert.equal(await market.read.credits([buyer.address, 3n]), 1n);
  assert.deepEqual((await market.read.allocations([1n])).map(a => a.recipient), wallets.map(w => getAddress(w.address)));
  await assert.rejects(market.write.buyBySig(args, { value: 10000n }));
  assert.equal(await market.read.receiptCount(), 1n);
  const use = async () => {
    const sig = await buyer.signTypedData({ domain, types: skillMarketTypes, primaryType: "UseSkill", message: { buyer: buyer.address, offerId: 3n, nonce: await market.read.nonces([buyer.address]), deadline } });
    return market.write.useBySig([buyer.address, 3n, deadline, sig]);
  };
  await use();
  assert.equal(await market.read.credits([buyer.address, 3n]), 0n);
  await assert.rejects(use());
  // Buyout survives repeated retrievals, but cannot accidentally be purchased twice.
  const buyout = async () => {
    const sig = await buyer.signTypedData({ domain, types: skillMarketTypes, primaryType: "BuySkill", message: { buyer: buyer.address, offerId: 1n, nonce: await market.read.nonces([buyer.address]), deadline } });
    return market.write.buyBySig([buyer.address, 1n, deadline, sig], { value: 10000n });
  };
  await buyout();
  assert.equal(await market.read.licensed([buyer.address, 1n]), true);
  await assert.rejects(buyout());
  // A creator can publish a free personal license without changing inherited royalties.
  const root = authors[0];
  const free = { author: root.address, skillId: 1n, versionIndex: 0n, mode: 0, license: 0, price: 0n, royaltyBps: 2000, nonce: await market.read.nonces([root.address]), deadline };
  const freeSig = await root.signTypedData({ domain, types: skillMarketTypes, primaryType: "ListSkill", message: free });
  await market.write.listBySig([root.address, 1n, 0n, 0, 0, 0n, 2000, deadline, freeSig]);
  const freeBuy = await buyer.signTypedData({ domain, types: skillMarketTypes, primaryType: "BuySkill", message: { buyer: buyer.address, offerId: 4n, nonce: await market.read.nonces([buyer.address]), deadline } });
  await market.write.buyBySig([buyer.address, 4n, deadline, freeBuy]);
  assert.equal(await market.read.perpetual([buyer.address, b32("market-0"), 0]), true);
  assert.equal(await market.read.perpetual([buyer.address, b32("market-0"), 1]), true);
  // Old purchased offers remain usable even after the author replaces a listing.
  const oldUse = await buyer.signTypedData({ domain, types: skillMarketTypes, primaryType: "UseSkill", message: { buyer: buyer.address, offerId: 1n, nonce: await market.read.nonces([buyer.address]), deadline } });
  await market.write.useBySig([buyer.address, 1n, deadline, oldUse]);
});
