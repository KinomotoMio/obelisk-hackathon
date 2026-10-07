// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 tommy0103 and contributors.

// Deploys KeyRegistry, ShareRegistry, SkillRegistry, and UsageStats (wired to
// that SkillRegistry) to the selected network and records the result in
// deployments/<chainId>.json for the online service and CLI.
//
//   npx hardhat run --build-profile production --network botTestnet scripts/deploy.ts
//
// Re-running converges: each contract is written to the record as soon as
// its deployment is mined, and a later run reuses any recorded contract that
// still has code on-chain instead of deploying it again. An interrupted run
// therefore resumes; a run against a fresh chain (e.g. the in-process
// `hardhat` network) redeploys everything.
//
// The deployment transaction hash is recorded under `pending` before waiting
// for its receipt. BOT Chain's public RPC can briefly answer "transaction not
// found" right after accepting a transaction (hardhat-viem's
// sendDeploymentTransaction fails on exactly that), so a crash or timeout
// while waiting must not lose a contract that was in fact mined.

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { artifacts, network } from "hardhat";
import { getAddress, type Hex } from "viem";

import type { EXPORTED_CONTRACTS } from "./abi-format.js";

type ContractName = (typeof EXPORTED_CONTRACTS)[number];

interface DeployedContract {
  address: Hex;
  txHash: Hex;
  blockNumber: number;
  deployer: Hex;
}

interface DeploymentRecord {
  chainId: number;
  network: string;
  /** False while a run is in progress or was interrupted; re-run to finish. */
  complete: boolean;
  updatedAt: string;
  contracts: Partial<Record<ContractName, DeployedContract>>;
  /** Deployment transactions sent but not yet confirmed by a receipt. */
  pending?: Partial<Record<ContractName, Hex>>;
  marketConfig?: { platform: Hex; feeBps: number };
}

const deploymentsDir = join(dirname(fileURLToPath(import.meta.url)), "..", "deployments");

const { viem, networkName } = await network.create();
const publicClient = await viem.getPublicClient();
const [deployer] = await viem.getWalletClients();
if (deployer === undefined) {
  throw new Error(`No deployer account for network "${networkName}". Set BOT_DEPLOYER_PRIVATE_KEY (see chain/README.md).`);
}
const chainId = await publicClient.getChainId();
const recordPath = join(deploymentsDir, `${chainId}.json`);

function load(): DeploymentRecord {
  if (existsSync(recordPath)) {
    const previous = JSON.parse(readFileSync(recordPath, "utf8")) as DeploymentRecord;
    if (previous.chainId !== chainId) throw new Error(`${recordPath} records chainId ${previous.chainId}, connected to ${chainId}`);
    return { ...previous, network: networkName };
  }
  return {
    chainId,
    network: networkName,
    complete: false,
    updatedAt: new Date().toISOString(),
    contracts: {},
  };
}

function save(record: DeploymentRecord) {
  mkdirSync(deploymentsDir, { recursive: true });
  record.updatedAt = new Date().toISOString();
  // Write-then-rename so an interrupted write never leaves a truncated record.
  const tmp = `${recordPath}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(record, null, 2)}\n`);
  renameSync(tmp, recordPath);
}

async function hasCode(address: Hex) {
  const code = await publicClient.getCode({ address });
  return code !== undefined && code !== "0x";
}

const record = load();

async function ensure(name: ContractName, args: readonly unknown[] = []): Promise<Hex> {
  const existing = record.contracts[name];
  if (existing && (await hasCode(existing.address))) {
    console.log(`${name}: reusing ${existing.address}`);
    return existing.address;
  }
  // UsageStats is bound to a SkillRegistry at construction; a new
  // SkillRegistry invalidates the recorded UsageStats.
  if (name === "SkillRegistry") {
    delete record.contracts.UsageStats;
    delete record.contracts.SkillMarket;
  }
  delete record.contracts[name];
  record.complete = false;

  // A deployment sent by an earlier, interrupted run may have been mined.
  const pendingHash = record.pending?.[name];
  if (pendingHash) {
    const previous = await publicClient.getTransactionReceipt({ hash: pendingHash }).catch(() => null);
    if (previous?.status === "success" && previous.contractAddress && (await hasCode(previous.contractAddress))) {
      return confirm(name, pendingHash, previous.contractAddress, previous.blockNumber, previous.gasUsed);
    }
    if (previous === null) {
      throw new Error(`${name} deployment tx ${pendingHash} has no receipt yet; re-run once it is mined or dropped (remove it from "pending" in ${recordPath} if dropped)`);
    }
    delete record.pending?.[name];
  }

  const artifact = await artifacts.readArtifact(name);
  const hash = await deployer.deployContract({
    abi: artifact.abi,
    bytecode: artifact.bytecode as Hex,
    args: args as never,
  });
  record.pending = { ...record.pending, [name]: hash };
  save(record);
  // Polls through transient "not found" answers until the receipt exists.
  const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 300_000 });
  if (receipt.status !== "success" || !receipt.contractAddress) throw new Error(`${name} deployment reverted in tx ${hash}`);
  return confirm(name, hash, receipt.contractAddress, receipt.blockNumber, receipt.gasUsed);
}

function confirm(name: ContractName, txHash: Hex, address: Hex, blockNumber: bigint, gasUsed: bigint): Hex {
  record.contracts[name] = {
    address: getAddress(address),
    txHash,
    blockNumber: Number(blockNumber),
    deployer: getAddress(deployer!.account.address),
  };
  delete record.pending?.[name];
  save(record);
  console.log(`${name}: deployed ${address} (tx ${txHash}, block ${blockNumber}, gas ${gasUsed})`);
  return getAddress(address);
}

console.log(`Deploying to ${networkName} (chainId ${chainId}) from ${deployer.account.address}`);
await ensure("KeyRegistry");
await ensure("ShareRegistry");
const skillRegistry = await ensure("SkillRegistry");
const usageStats = await ensure("UsageStats", [skillRegistry]);

// UsageStats must point at the SkillRegistry recorded beside it.
const stats = await viem.getContractAt("UsageStats", usageStats);
const wired = await stats.read.skillRegistry();
if (getAddress(wired) !== getAddress(skillRegistry)) {
  throw new Error(`UsageStats at ${usageStats} reads SkillRegistry ${wired}, expected ${skillRegistry}`);
}

// Explicit configuration adds settlement without replacing the existing registries.
// Keep this in the deployment record so restart and source verification use identical arguments.
const platformInput = process.env.MARKET_PLATFORM_ADDRESS;
if (platformInput || record.marketConfig) {
  const platform = platformInput ? getAddress(platformInput) : record.marketConfig!.platform;
  const feeBps = Number(process.env.MARKET_FEE_BPS ?? record.marketConfig?.feeBps ?? '500');
  if (!Number.isInteger(feeBps) || feeBps < 0 || feeBps > 2000) throw new Error('MARKET_FEE_BPS must be 0–2000');
  if (record.marketConfig && (getAddress(record.marketConfig.platform) !== platform || record.marketConfig.feeBps !== feeBps)) {
    throw new Error('Market configuration differs from the recorded deployment; do not silently replace settlement rules');
  }
  record.marketConfig = { platform, feeBps };
  save(record);
  const marketAddress = await ensure('SkillMarket', [skillRegistry, platform, feeBps]);
  const market = await viem.getContractAt('SkillMarket', marketAddress);
  if (getAddress(await market.read.registry()) !== getAddress(skillRegistry)
    || getAddress(await market.read.platform()) !== platform || await market.read.platformBps() !== feeBps) {
    throw new Error('SkillMarket configuration does not match the deployment record');
  }
}

record.complete = true;
save(record);
console.log(`Wrote ${recordPath}`);
