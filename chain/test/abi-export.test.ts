// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 tommy0103 and contributors.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { artifacts } from "hardhat";

import { EXPORTED_CONTRACTS, renderAbiIndex, renderAbiJson } from "../scripts/abi-format.js";

const abiDir = join(dirname(fileURLToPath(import.meta.url)), "..", "abi");

describe("exported ABIs for the online service and CLI", () => {
  it("match the compiled contracts (run `npm run export-abi` after an ABI change)", async () => {
    const abis: Record<string, unknown> = {};
    for (const name of EXPORTED_CONTRACTS) {
      const { abi } = await artifacts.readArtifact(name);
      abis[name] = abi;
      assert.equal(readFileSync(join(abiDir, `${name}.json`), "utf8"), renderAbiJson(abi), `abi/${name}.json is stale`);
    }
    assert.equal(readFileSync(join(abiDir, "index.ts"), "utf8"), renderAbiIndex(abis), "abi/index.ts is stale");
  });
});
