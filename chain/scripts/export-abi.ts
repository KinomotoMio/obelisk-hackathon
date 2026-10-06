// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 tommy0103 and contributors.

// Writes each contract's ABI to abi/<Contract>.json and a typed abi/index.ts
// (`as const`, so viem infers function and event types) for consumers that
// must not depend on Hardhat: the online service and packages/cli.
//
//   npx hardhat run scripts/export-abi.ts
//
// test/abi-export.test.ts fails when the committed files drift from the
// compiled contracts, so re-run this after any ABI change.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { artifacts } from "hardhat";

import { EXPORTED_CONTRACTS, renderAbiIndex, renderAbiJson } from "./abi-format.js";

const abiDir = join(dirname(fileURLToPath(import.meta.url)), "..", "abi");
mkdirSync(abiDir, { recursive: true });

const abis: Record<string, unknown> = {};
for (const name of EXPORTED_CONTRACTS) {
  const { abi } = await artifacts.readArtifact(name);
  abis[name] = abi;
  writeFileSync(join(abiDir, `${name}.json`), renderAbiJson(abi));
}
writeFileSync(join(abiDir, "index.ts"), renderAbiIndex(abis));
console.log(`Wrote ${EXPORTED_CONTRACTS.length} ABIs to ${abiDir}`);
