// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 tommy0103 and contributors.

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { network } from "hardhat";
import { getAddress, type Hex } from "viem";
import type { PrivateKeyAccount } from "viem/accounts";

import { obeliskDomain, skillRegistryTypes, usageStatsTypes } from "../eip712.js";
import { b32, deadlineAfter, offchainUser } from "../test-support/helpers.js";

const { viem, networkHelpers } = await network.create();
const publicClient = await viem.getPublicClient();
const chainId = await publicClient.getChainId();

const author = offchainUser("author");
const alice = offchainUser("alice");
const bob = offchainUser("bob");
const mallory = offchainUser("mallory");

const V1 = b32("skill-body:frontend:v1");

// Opaque bucket keys, sorted ascending as the contract requires.
const [SCENE_A, SCENE_B] = [b32("scene:creative-ppt"), b32("scene:ecommerce-admin")].sort();
const OUTCOME_OK = b32("outcome:smooth");

type Bucket = { key: Hex; cumulative: bigint };

async function deployFixture() {
  const skills = await viem.deployContract("SkillRegistry");
  const usage = await viem.deployContract("UsageStats", [skills.address]);
  const [relayer] = await viem.getWalletClients();

  const deadline = deadlineAfter(BigInt(await networkHelpers.time.latest()));
  const signature = await author.signTypedData({
    domain: obeliskDomain("SkillRegistry", chainId, skills.address),
    types: skillRegistryTypes,
    primaryType: "MintSkill",
    message: { author: author.address, fingerprint: V1, birthScenes: ["frontend"], parentSkillId: 0n, nonce: 0n, deadline },
  });
  await skills.write.mintBySig([author.address, V1, ["frontend"], 0n, deadline, signature]);
  return { skills, usage, relayer };
}

type Usage = Awaited<ReturnType<typeof deployFixture>>["usage"];

async function now() {
  return BigInt(await networkHelpers.time.latest());
}

interface ReportArgs {
  reporter: Hex;
  fingerprint: Hex;
  cumulativeInvocations: bigint;
  scenes: Bucket[];
  outcomes: Bucket[];
}

async function signedReport(
  usage: Usage,
  signer: PrivateKeyAccount,
  overrides: Partial<ReportArgs> & Pick<ReportArgs, "cumulativeInvocations">,
  deadline?: bigint,
) {
  const args: ReportArgs = { reporter: signer.address, fingerprint: V1, scenes: [], outcomes: [], ...overrides };
  const d = deadline ?? deadlineAfter(await now());
  const signature = await signer.signTypedData({
    domain: obeliskDomain("UsageStats", chainId, usage.address),
    types: usageStatsTypes,
    primaryType: "ReportUsage",
    message: { ...args, nonce: await usage.read.nonces([args.reporter]), deadline: d },
  });
  return [args.reporter, args.fingerprint, args.cumulativeInvocations, args.scenes, args.outcomes, d, signature] as const;
}

async function report(usage: Usage, signer: PrivateKeyAccount, overrides: Partial<ReportArgs> & Pick<ReportArgs, "cumulativeInvocations">) {
  await usage.write.reportBySig(await signedReport(usage, signer, overrides));
}

describe("UsageStats: per-version invocation counts deduplicated by wallet", () => {
  it("accumulates a wallet's reported invocations for a minted Skill version, relayed for the user", async () => {
    const { usage, relayer } = await networkHelpers.loadFixture(deployFixture);
    await viem.assertions.emitWithArgs(
      usage.write.reportBySig(await signedReport(usage, alice, { cumulativeInvocations: 5n })),
      usage,
      "UsageReported",
      [V1, getAddress(alice.address), 5n, 5n],
    );

    assert.deepEqual(await usage.read.versionStats([V1]), [5n, 1, await now()]);
    assert.deepEqual(await usage.read.walletReport([V1, alice.address]), [5n, await now()]);
    assert.equal(await usage.read.reporterCount([V1]), 1n);
    assert.equal(await usage.read.reporterAt([V1, 0n]), getAddress(alice.address));
    assert.equal(await usage.read.reportedFingerprintCount(), 1n);
    assert.equal(await usage.read.reportedFingerprintAt([0n]), V1);
    // The relayer submitted the report but is not a reporter.
    assert.deepEqual(await usage.read.walletReport([V1, relayer.account.address]), [0n, 0n]);
  });

  it("is idempotent: re-submitting the same cumulative total adds nothing", async () => {
    const { usage } = await networkHelpers.loadFixture(deployFixture);
    await report(usage, alice, { cumulativeInvocations: 5n });
    await report(usage, alice, { cumulativeInvocations: 5n });
    assert.deepEqual((await usage.read.versionStats([V1])).slice(0, 2), [5n, 1]);

    await report(usage, alice, { cumulativeInvocations: 8n });
    assert.deepEqual((await usage.read.versionStats([V1])).slice(0, 2), [8n, 1]);
    assert.equal(await usage.read.reporterCount([V1]), 1n);
  });

  it("rejects a report whose cumulative total decreases", async () => {
    const { usage } = await networkHelpers.loadFixture(deployFixture);
    await report(usage, alice, { cumulativeInvocations: 8n });
    await viem.assertions.revertWithCustomErrorWithArgs(
      usage.write.reportBySig(await signedReport(usage, alice, { cumulativeInvocations: 6n })),
      usage,
      "InvocationsDecreased",
      [8n, 6n],
    );
    assert.equal((await usage.read.versionStats([V1]))[0], 8n);
  });

  it("counts each wallet once in uniqueWallets however often it reports", async () => {
    const { usage } = await networkHelpers.loadFixture(deployFixture);
    await report(usage, alice, { cumulativeInvocations: 3n });
    await report(usage, bob, { cumulativeInvocations: 4n });
    await report(usage, alice, { cumulativeInvocations: 7n });
    await report(usage, alice, { cumulativeInvocations: 7n });

    const [total, uniqueWallets] = await usage.read.versionStats([V1]);
    assert.equal(total, 11n);
    assert.equal(uniqueWallets, 2);
    assert.equal(await usage.read.reporterCount([V1]), 2n);
    assert.deepEqual(
      [await usage.read.reporterAt([V1, 0n]), await usage.read.reporterAt([V1, 1n])],
      [getAddress(alice.address), getAddress(bob.address)],
    );
  });

  it("rejects a fingerprint that was never minted in the SkillRegistry", async () => {
    const { usage } = await networkHelpers.loadFixture(deployFixture);
    const unminted = b32("skill-body:never-minted");
    await viem.assertions.revertWithCustomErrorWithArgs(
      usage.write.reportBySig(await signedReport(usage, alice, { fingerprint: unminted, cumulativeInvocations: 1n })),
      usage,
      "UnknownFingerprint",
      [unminted],
    );
    assert.equal(await usage.read.reportedFingerprintCount(), 0n);
  });

  it("rejects a zero-invocation report", async () => {
    const { usage } = await networkHelpers.loadFixture(deployFixture);
    await viem.assertions.revertWithCustomError(
      usage.write.reportBySig(await signedReport(usage, alice, { cumulativeInvocations: 0n })),
      usage,
      "ZeroInvocations",
    );
  });

  it("aggregates cumulative scene and outcome buckets per version, readable by key enumeration", async () => {
    const { usage } = await networkHelpers.loadFixture(deployFixture);
    await report(usage, alice, {
      cumulativeInvocations: 3n,
      scenes: [
        { key: SCENE_A, cumulative: 2n },
        { key: SCENE_B, cumulative: 1n },
      ],
      outcomes: [{ key: OUTCOME_OK, cumulative: 2n }],
    });
    await report(usage, bob, { cumulativeInvocations: 3n, scenes: [{ key: SCENE_A, cumulative: 3n }] });
    // Alice's later report omits SCENE_B: it keeps its previous value.
    await report(usage, alice, { cumulativeInvocations: 5n, scenes: [{ key: SCENE_A, cumulative: 4n }] });

    assert.equal(await usage.read.sceneKeyCount([V1]), 2n);
    assert.deepEqual([await usage.read.sceneKeyAt([V1, 0n]), await usage.read.sceneKeyAt([V1, 1n])], [SCENE_A, SCENE_B]);
    assert.equal(await usage.read.sceneCount([V1, SCENE_A]), 7n);
    assert.equal(await usage.read.sceneCount([V1, SCENE_B]), 1n);
    assert.equal(await usage.read.outcomeKeyCount([V1]), 1n);
    assert.equal(await usage.read.outcomeKeyAt([V1, 0n]), OUTCOME_OK);
    assert.equal(await usage.read.outcomeCount([V1, OUTCOME_OK]), 2n);
    assert.equal((await usage.read.versionStats([V1]))[0], 8n);
  });

  it("rejects bucket reports that decrease, repeat or misorder keys, or exceed total invocations", async () => {
    const { usage } = await networkHelpers.loadFixture(deployFixture);
    await report(usage, alice, { cumulativeInvocations: 4n, scenes: [{ key: SCENE_A, cumulative: 3n }] });
    const cases: Array<[Partial<ReportArgs>, "BucketDecreased" | "BucketKeysNotAscending" | "BucketExceedsInvocations"]> = [
      [{ scenes: [{ key: SCENE_A, cumulative: 2n }] }, "BucketDecreased"],
      [
        {
          scenes: [
            { key: SCENE_B, cumulative: 1n },
            { key: SCENE_A, cumulative: 3n },
          ],
        },
        "BucketKeysNotAscending",
      ],
      [
        {
          outcomes: [
            { key: OUTCOME_OK, cumulative: 1n },
            { key: OUTCOME_OK, cumulative: 1n },
          ],
        },
        "BucketKeysNotAscending",
      ],
      [{ outcomes: [{ key: OUTCOME_OK, cumulative: 5n }] }, "BucketExceedsInvocations"],
    ];
    for (const [overrides, error] of cases) {
      await viem.assertions.revertWithCustomError(
        usage.write.reportBySig(await signedReport(usage, alice, { cumulativeInvocations: 4n, ...overrides })),
        usage,
        error,
      );
    }
  });

  describe("签名伪造被拒 (forged signatures are rejected)", () => {
    it("rejects a report in a wallet's name signed by another key", async () => {
      const { usage } = await networkHelpers.loadFixture(deployFixture);
      const forged = await signedReport(usage, mallory, { reporter: alice.address, cumulativeInvocations: 100n });
      await viem.assertions.revertWithCustomErrorWithArgs(usage.write.reportBySig(forged), usage, "InvalidSignature", [
        getAddress(alice.address),
      ]);
      assert.deepEqual((await usage.read.versionStats([V1])).slice(0, 2), [0n, 0]);
    });

    it("rejects a relayer that inflates the signed count or buckets", async () => {
      const { usage } = await networkHelpers.loadFixture(deployFixture);
      const [reporter, fp, count, scenes, outcomes, deadline, sig] = await signedReport(usage, alice, {
        cumulativeInvocations: 2n,
      });
      await viem.assertions.revertWithCustomError(
        usage.write.reportBySig([reporter, fp, count + 1000n, scenes, outcomes, deadline, sig]),
        usage,
        "InvalidSignature",
      );
      await viem.assertions.revertWithCustomError(
        usage.write.reportBySig([reporter, fp, count, [{ key: SCENE_A, cumulative: 2n }], outcomes, deadline, sig]),
        usage,
        "InvalidSignature",
      );
    });

    it("rejects replaying an already-used report signature (nonce consumed)", async () => {
      const { usage } = await networkHelpers.loadFixture(deployFixture);
      const signed = await signedReport(usage, alice, { cumulativeInvocations: 2n });
      await usage.write.reportBySig(signed);
      await viem.assertions.revertWithCustomError(usage.write.reportBySig(signed), usage, "InvalidSignature");
    });

    it("rejects a report signature past its deadline", async () => {
      const { usage } = await networkHelpers.loadFixture(deployFixture);
      const signed = await signedReport(usage, alice, { cumulativeInvocations: 2n }, (await now()) + 60n);
      await networkHelpers.time.increase(120);
      await viem.assertions.revertWithCustomErrorWithArgs(usage.write.reportBySig(signed), usage, "SignatureExpired", [
        signed[5],
      ]);
    });
  });
});
