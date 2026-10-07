// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 tommy0103 and contributors.

// Verifies the source of every contract in deployments/<chainId>.json on the
// chain's Blockscout explorer (scan.bohr.life for the testnet,
// scan.botchain.ai for mainnet). Needs no key: it connects through the
// read-only botTestnetPublic / botMainnetPublic networks.
//
//   npm run verify:testnet    # or verify:mainnet
//
// It must run with the production build profile, which is what deploy.ts
// deployed, so the explorer recompiles the same bytecode (solc 0.8.28,
// cancun, optimizer 200 runs, viaIR). Contracts already verified are
// skipped, so re-running is safe.

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { verifyContract } from "@nomicfoundation/hardhat-verify/verify";
import hre from "hardhat";

const { viem, networkName } = await hre.network.create();
const chainId = await (await viem.getPublicClient()).getChainId();
const recordPath = join(dirname(fileURLToPath(import.meta.url)), "..", "deployments", `${chainId}.json`);
if (!existsSync(recordPath)) throw new Error(`No deployment record at ${recordPath}; deploy first.`);
const record = JSON.parse(readFileSync(recordPath, "utf8")) as {
  complete: boolean;
  contracts: Record<string, { address: string } | undefined>;
};
if (!record.complete) throw new Error(`${recordPath} is not complete; finish the deployment first (re-run the deploy).`);

const address = (name: string) => {
  const entry = record.contracts[name];
  if (!entry) throw new Error(`${recordPath} has no ${name}`);
  return entry.address;
};

const contracts: { name: string; constructorArgs: unknown[] }[] = [
  { name: "KeyRegistry", constructorArgs: [] },
  { name: "ShareRegistry", constructorArgs: [] },
  { name: "SkillRegistry", constructorArgs: [] },
  { name: "UsageStats", constructorArgs: [address("SkillRegistry")] },
];

console.log(`Verifying ${recordPath} on ${networkName} (chainId ${chainId})`);
let failed = 0;
for (const { name, constructorArgs } of contracts) {
  try {
    await verifyContract(
      { address: address(name), constructorArgs, contract: `contracts/${name}.sol:${name}`, provider: "blockscout" },
      hre,
    );
    console.log(`${name}: verified at ${address(name)}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/already verified/i.test(message)) {
      console.log(`${name}: already verified at ${address(name)}`);
      continue;
    }
    failed += 1;
    console.error(`${name}: ${message}`);
  }
}
if (failed > 0) {
  process.exitCode = 1;
  console.error(`${failed} contract(s) not verified; re-run to retry.`);
}
