// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 tommy0103 and contributors.

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { network } from "hardhat";
import { getAddress, type Hex } from "viem";
import type { PrivateKeyAccount } from "viem/accounts";

import { obeliskDomain, skillRegistryTypes } from "../eip712.js";
import { b32, deadlineAfter, offchainUser } from "../test-support/helpers.js";

const { viem, networkHelpers } = await network.create();
const publicClient = await viem.getPublicClient();
const chainId = await publicClient.getChainId();

const authorA = offchainUser("author-a");
const authorD = offchainUser("author-d");
const authorE = offchainUser("author-e");
const authorF = offchainUser("author-f");
const mallory = offchainUser("mallory");

const SCENES = ["React", "landing page", "marketing site"];

async function deployFixture() {
  const skills = await viem.deployContract("SkillRegistry");
  const [relayer] = await viem.getWalletClients();
  return { skills, relayer };
}

type Skills = Awaited<ReturnType<typeof deployFixture>>["skills"];

async function now() {
  return BigInt(await networkHelpers.time.latest());
}

interface MintArgs {
  author: Hex;
  fingerprint: Hex;
  birthScenes: string[];
  parentSkillId: bigint;
}

async function signedMint(
  skills: Skills,
  signer: PrivateKeyAccount,
  args: Partial<MintArgs> & Pick<MintArgs, "fingerprint">,
  deadline?: bigint,
) {
  const full: MintArgs = { author: signer.address, birthScenes: SCENES, parentSkillId: 0n, ...args };
  const d = deadline ?? deadlineAfter(await now());
  const signature = await signer.signTypedData({
    domain: obeliskDomain("SkillRegistry", chainId, skills.address),
    types: skillRegistryTypes,
    primaryType: "MintSkill",
    message: { ...full, nonce: await skills.read.nonces([full.author]), deadline: d },
  });
  return [full.author, full.fingerprint, full.birthScenes, full.parentSkillId, d, signature] as const;
}

/** Mint and return the new Skill id read back through the views. */
async function mint(skills: Skills, signer: PrivateKeyAccount, fingerprint: Hex, parentSkillId = 0n) {
  await skills.write.mintBySig(await signedMint(skills, signer, { fingerprint, parentSkillId }));
  return skills.read.skillCount();
}

async function signedPublish(skills: Skills, signer: PrivateKeyAccount, author: Hex, skillId: bigint, fingerprint: Hex) {
  const deadline = deadlineAfter(await now());
  const signature = await signer.signTypedData({
    domain: obeliskDomain("SkillRegistry", chainId, skills.address),
    types: skillRegistryTypes,
    primaryType: "PublishVersion",
    message: { author, skillId, fingerprint, nonce: await skills.read.nonces([author]), deadline },
  });
  return [author, skillId, fingerprint, deadline, signature] as const;
}

describe("SkillRegistry: Skill assets, versions, and genealogy", () => {
  it("mints a Skill with author, version fingerprint, birth scenes, and no parent", async () => {
    const { skills, relayer } = await networkHelpers.loadFixture(deployFixture);
    const fp = b32("skill-body:ai-resume:v1");
    await viem.assertions.emitWithArgs(
      skills.write.mintBySig(await signedMint(skills, authorA, { fingerprint: fp })),
      skills,
      "SkillMinted",
      [1n, getAddress(authorA.address), 0n, fp],
    );

    assert.equal(await skills.read.skillCount(), 1n);
    const [author, parentSkillId, createdAt, versionCount, birthScenes] = await skills.read.getSkill([1n]);
    assert.equal(author, getAddress(authorA.address));
    assert.equal(parentSkillId, 0n);
    assert.equal(createdAt, await now());
    assert.equal(versionCount, 1n);
    assert.deepEqual(birthScenes, SCENES);
    assert.deepEqual(await skills.read.versionAt([1n, 0n]), [fp, await now()]);
    assert.deepEqual(await skills.read.skillOfFingerprint([fp]), [1n, 0n]);
    assert.equal(await skills.read.skillsByAuthorCount([authorA.address]), 1n);
    assert.equal(await skills.read.skillsByAuthorAt([authorA.address, 0n]), 1n);
    // The relayer paid for the mint but is not its author.
    assert.equal(await skills.read.skillsByAuthorCount([relayer.account.address]), 0n);
  });

  it("rejects minting a fingerprint someone already minted, proving who minted it first", async () => {
    const { skills } = await networkHelpers.loadFixture(deployFixture);
    const fp = b32("skill-body:copied");
    await mint(skills, authorA, fp);
    await viem.assertions.revertWithCustomErrorWithArgs(
      skills.write.mintBySig(await signedMint(skills, mallory, { fingerprint: fp })),
      skills,
      "FingerprintTaken",
      [fp, 1n],
    );
    // A new version cannot reuse any minted fingerprint either.
    await viem.assertions.revertWithCustomError(
      skills.write.publishVersionBySig(await signedPublish(skills, authorA, authorA.address, 1n, fp)),
      skills,
      "FingerprintTaken",
    );
  });

  it("rejects a parent Skill that does not exist", async () => {
    const { skills } = await networkHelpers.loadFixture(deployFixture);
    await viem.assertions.revertWithCustomErrorWithArgs(
      skills.write.mintBySig(await signedMint(skills, authorA, { fingerprint: b32("orphan"), parentSkillId: 7n })),
      skills,
      "UnknownSkill",
      [7n],
    );
  });

  it("answers genealogy queries by parent and by author (族谱)", async () => {
    const { skills } = await networkHelpers.loadFixture(deployFixture);
    // R (A) -> C1 (D) -> G1 (F); R -> C2 (E); plus a second root by A.
    const root = await mint(skills, authorA, b32("ai-resume"));
    const c1 = await mint(skills, authorD, b32("designer-portfolio"), root);
    const c2 = await mint(skills, authorE, b32("annual-review"), root);
    const g1 = await mint(skills, authorF, b32("illustrator-portfolio"), c1);
    const root2 = await mint(skills, authorA, b32("unrelated"));

    assert.equal(await skills.read.childrenCount([root]), 2n);
    assert.deepEqual([await skills.read.childAt([root, 0n]), await skills.read.childAt([root, 1n])], [c1, c2]);
    assert.equal(await skills.read.childrenCount([c1]), 1n);
    assert.equal(await skills.read.childAt([c1, 0n]), g1);
    assert.equal(await skills.read.childrenCount([c2]), 0n);
    assert.equal((await skills.read.getSkill([g1]))[1], c1);

    assert.equal(await skills.read.skillsByAuthorCount([authorA.address]), 2n);
    assert.deepEqual(
      [await skills.read.skillsByAuthorAt([authorA.address, 0n]), await skills.read.skillsByAuthorAt([authorA.address, 1n])],
      [root, root2],
    );
    assert.equal(await skills.read.skillsByAuthorCount([authorF.address]), 1n);
  });

  it("only the Skill's author can publish a new version", async () => {
    const { skills } = await networkHelpers.loadFixture(deployFixture);
    const id = await mint(skills, authorA, b32("ai-resume:v1"));
    const v2 = b32("ai-resume:v2");

    await viem.assertions.revertWithCustomErrorWithArgs(
      skills.write.publishVersionBySig(await signedPublish(skills, mallory, mallory.address, id, v2)),
      skills,
      "NotAuthor",
      [id, getAddress(mallory.address)],
    );

    await viem.assertions.emitWithArgs(
      skills.write.publishVersionBySig(await signedPublish(skills, authorA, authorA.address, id, v2)),
      skills,
      "SkillVersionPublished",
      [id, 1n, v2],
    );
    assert.equal((await skills.read.getSkill([id]))[3], 2n);
    assert.deepEqual(await skills.read.versionAt([id, 1n]), [v2, await now()]);
    assert.deepEqual(await skills.read.skillOfFingerprint([v2]), [id, 1n]);
    await viem.assertions.revertWithCustomError(
      skills.write.publishVersionBySig(await signedPublish(skills, authorA, authorA.address, 99n, b32("x"))),
      skills,
      "UnknownSkill",
    );
  });

  it("reports unknown fingerprints and Skills as absent", async () => {
    const { skills } = await networkHelpers.loadFixture(deployFixture);
    assert.deepEqual(await skills.read.skillOfFingerprint([b32("never")]), [0n, 0n]);
    await viem.assertions.revertWithCustomError(skills.read.getSkill([0n]), skills, "UnknownSkill");
    await viem.assertions.revertWithCustomError(skills.read.getSkill([1n]), skills, "UnknownSkill");
  });

  it("rejects birth scene lists that are too long or contain empty/oversized tags", async () => {
    const { skills } = await networkHelpers.loadFixture(deployFixture);
    const cases: Array<[string[], "TooManyBirthScenes" | "InvalidBirthScene"]> = [
      [Array.from({ length: 17 }, (_, i) => `scene-${i}`), "TooManyBirthScenes"],
      [["ok", ""], "InvalidBirthScene"],
      [["x".repeat(65)], "InvalidBirthScene"],
    ];
    for (const [birthScenes, error] of cases) {
      await viem.assertions.revertWithCustomError(
        skills.write.mintBySig(await signedMint(skills, authorA, { fingerprint: b32("bounds"), birthScenes })),
        skills,
        error,
      );
    }
    // An empty list is allowed.
    await skills.write.mintBySig(await signedMint(skills, authorA, { fingerprint: b32("bounds"), birthScenes: [] }));
    assert.deepEqual((await skills.read.getSkill([1n]))[4], []);
  });

  describe("签名伪造被拒 (forged signatures are rejected)", () => {
    it("rejects a mint in an author's name signed by another key", async () => {
      const { skills } = await networkHelpers.loadFixture(deployFixture);
      const forged = await signedMint(skills, mallory, { author: authorA.address, fingerprint: b32("stolen") });
      await viem.assertions.revertWithCustomErrorWithArgs(skills.write.mintBySig(forged), skills, "InvalidSignature", [
        getAddress(authorA.address),
      ]);
      assert.equal(await skills.read.skillCount(), 0n);
    });

    it("rejects a relayer that tampers with signed birth scenes or parent", async () => {
      const { skills } = await networkHelpers.loadFixture(deployFixture);
      await mint(skills, authorA, b32("parent"));
      const [author, fp, scenes, parent, deadline, sig] = await signedMint(skills, authorD, { fingerprint: b32("child") });
      await viem.assertions.revertWithCustomError(
        skills.write.mintBySig([author, fp, [...scenes, "e-commerce admin"], parent, deadline, sig]),
        skills,
        "InvalidSignature",
      );
      await viem.assertions.revertWithCustomError(
        skills.write.mintBySig([author, fp, scenes, 1n, deadline, sig]),
        skills,
        "InvalidSignature",
      );
    });

    it("rejects a signature whose nonce was already consumed, and an expired one", async () => {
      const { skills } = await networkHelpers.loadFixture(deployFixture);
      // Both are signed against the same nonce; once one lands the other is stale.
      // (A byte-identical resubmission is already stopped by FingerprintTaken.)
      const first = await signedMint(skills, authorA, { fingerprint: b32("a") });
      const stale = await signedMint(skills, authorA, { fingerprint: b32("b") });
      await skills.write.mintBySig(first);
      await viem.assertions.revertWithCustomError(skills.write.mintBySig(stale), skills, "InvalidSignature");
      assert.equal(await skills.read.skillCount(), 1n);

      const late = await signedMint(skills, authorA, { fingerprint: b32("c") }, (await now()) + 60n);
      await networkHelpers.time.increase(120);
      await viem.assertions.revertWithCustomErrorWithArgs(skills.write.mintBySig(late), skills, "SignatureExpired", [
        late[4],
      ]);
    });
  });
});
