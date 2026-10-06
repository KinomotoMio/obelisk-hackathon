// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 tommy0103 and contributors.

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { network } from "hardhat";
import { getAddress, type Hex } from "viem";
import type { PrivateKeyAccount } from "viem/accounts";

import { OpenStatus, obeliskDomain, shareRegistryTypes } from "../eip712.js";
import { b32, deadlineAfter, offchainUser } from "../test-support/helpers.js";

const { viem, networkHelpers } = await network.create();
const publicClient = await viem.getPublicClient();
const chainId = await publicClient.getChainId();

const alice = offchainUser("alice"); // sender
const bob = offchainUser("bob"); // the one recipient
const mallory = offchainUser("mallory"); // holds a forwarded link

const SHARE = b32("share:payment-bug-session");
const CONTENT = b32("ciphertext:payment-bug-session");
const DAY = 86_400n;

async function deployFixture() {
  const shares = await viem.deployContract("ShareRegistry");
  const [relayer] = await viem.getWalletClients();
  return { shares, relayer };
}

type Shares = Awaited<ReturnType<typeof deployFixture>>["shares"];

async function now() {
  return BigInt(await networkHelpers.time.latest());
}

async function sign<P extends keyof typeof shareRegistryTypes>(
  shares: Shares,
  signer: PrivateKeyAccount,
  primaryType: P,
  message: Record<string, unknown> & { nonce: bigint; deadline: bigint },
): Promise<Hex> {
  return signer.signTypedData({
    domain: obeliskDomain("ShareRegistry", chainId, shares.address),
    types: shareRegistryTypes,
    primaryType,
    message,
  } as Parameters<PrivateKeyAccount["signTypedData"]>[0]);
}

interface CreateArgs {
  sender: Hex;
  shareId: Hex;
  recipient: Hex;
  contentHash: Hex;
  maxOpens: number;
  expiresAt: bigint;
}

async function signedCreate(
  shares: Shares,
  signer: PrivateKeyAccount,
  overrides: Partial<CreateArgs> & { deadline?: bigint } = {},
) {
  const args: CreateArgs = {
    sender: alice.address,
    shareId: SHARE,
    recipient: bob.address,
    contentHash: CONTENT,
    maxOpens: 1,
    expiresAt: (await now()) + DAY,
    ...overrides,
  };
  const deadline = overrides.deadline ?? deadlineAfter(await now());
  const nonce = await shares.read.nonces([args.sender]);
  const signature = await sign(shares, signer, "CreateShare", { ...args, nonce, deadline });
  return { args, deadline, signature };
}

function submitCreate(shares: Shares, c: Awaited<ReturnType<typeof signedCreate>>, args = c.args) {
  return shares.write.createShareBySig([
    args.sender,
    args.shareId,
    args.recipient,
    args.contentHash,
    args.maxOpens,
    args.expiresAt,
    c.deadline,
    c.signature,
  ]);
}

async function createShare(shares: Shares, overrides: Partial<CreateArgs> = {}) {
  const c = await signedCreate(shares, alice, overrides);
  await submitCreate(shares, c);
  return c.args;
}

async function signedOpen(shares: Shares, signer: PrivateKeyAccount, recipient: Hex, shareId = SHARE, deadline?: bigint) {
  const d = deadline ?? deadlineAfter(await now());
  const nonce = await shares.read.nonces([recipient]);
  const signature = await sign(shares, signer, "RecordOpen", { recipient, shareId, nonce, deadline: d });
  return [recipient, shareId, d, signature] as const;
}

async function signedRevoke(shares: Shares, signer: PrivateKeyAccount, sender: Hex, shareId = SHARE) {
  const deadline = deadlineAfter(await now());
  const nonce = await shares.read.nonces([sender]);
  const signature = await sign(shares, signer, "RevokeShare", { sender, shareId, nonce, deadline });
  return [sender, shareId, deadline, signature] as const;
}

describe("ShareRegistry: share authorization, open receipts, and revocation", () => {
  it("records a share and an open receipt from user signatures while the relayer pays gas", async () => {
    const { shares, relayer } = await networkHelpers.loadFixture(deployFixture);
    const created = await signedCreate(shares, alice, { maxOpens: 3 });
    await viem.assertions.emitWithArgs(submitCreate(shares, created), shares, "ShareCreated", [
      SHARE,
      getAddress(alice.address),
      getAddress(bob.address),
      CONTENT,
      3,
      created.args.expiresAt,
    ]);
    const createdAt = await now();

    const [sender, recipient, contentHash, maxOpens, openCount, createdAtRead, expiresAt, revoked, revokedAt] =
      await shares.read.getShare([SHARE]);
    assert.equal(sender, getAddress(alice.address));
    assert.equal(recipient, getAddress(bob.address));
    assert.equal(contentHash, CONTENT);
    assert.equal(maxOpens, 3);
    assert.equal(openCount, 0);
    assert.equal(createdAtRead, createdAt);
    assert.equal(expiresAt, created.args.expiresAt);
    assert.equal(revoked, false);
    assert.equal(revokedAt, 0n);
    assert.equal(await shares.read.checkOpen([SHARE, bob.address]), OpenStatus.Ok);

    const hash = await shares.write.recordOpenBySig(await signedOpen(shares, bob, bob.address));
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    // msg.sender was the relayer, yet the share and the open belong to the signers.
    assert.equal(getAddress(receipt.from), getAddress(relayer.account.address));
    assert.notEqual(getAddress(relayer.account.address), getAddress(bob.address));

    assert.equal((await shares.read.getShare([SHARE]))[4], 1);
    assert.equal(await shares.read.receiptCount([SHARE]), 1n);
    const [openedAt, blockNumber] = await shares.read.receiptAt([SHARE, 0n]);
    assert.equal(openedAt, await now());
    assert.equal(blockNumber, receipt.blockNumber);

    assert.equal(await shares.read.sharesBySenderCount([alice.address]), 1n);
    assert.equal(await shares.read.sharesBySenderAt([alice.address, 0n]), SHARE);
    assert.equal(await shares.read.sharesByRecipientCount([bob.address]), 1n);
    assert.equal(await shares.read.sharesByRecipientAt([bob.address, 0n]), SHARE);
    assert.equal(await shares.read.sharesBySenderCount([relayer.account.address]), 0n);
  });

  it("非指定接收者打开被拒: a non-recipient's own valid signature cannot open the share", async () => {
    const { shares, relayer } = await networkHelpers.loadFixture(deployFixture);
    await createShare(shares);
    assert.equal(await shares.read.checkOpen([SHARE, mallory.address]), OpenStatus.NotRecipient);

    await viem.assertions.revertWithCustomErrorWithArgs(
      shares.write.recordOpenBySig(await signedOpen(shares, mallory, mallory.address)),
      shares,
      "NotRecipient",
      [SHARE, getAddress(mallory.address)],
    );
    // Nor can the relayer that submits transactions open it as itself.
    assert.equal(await shares.read.checkOpen([SHARE, relayer.account.address]), OpenStatus.NotRecipient);
    assert.equal(await shares.read.receiptCount([SHARE]), 0n);
  });

  it("超过次数被拒: opening beyond the open limit is rejected", async () => {
    const { shares } = await networkHelpers.loadFixture(deployFixture);
    await createShare(shares, { maxOpens: 2 });
    await shares.write.recordOpenBySig(await signedOpen(shares, bob, bob.address));
    await shares.write.recordOpenBySig(await signedOpen(shares, bob, bob.address));
    assert.equal(await shares.read.checkOpen([SHARE, bob.address]), OpenStatus.Exhausted);

    await viem.assertions.revertWithCustomErrorWithArgs(
      shares.write.recordOpenBySig(await signedOpen(shares, bob, bob.address)),
      shares,
      "OpensExhausted",
      [SHARE],
    );
    assert.equal(await shares.read.receiptCount([SHARE]), 2n);
    assert.equal((await shares.read.getShare([SHARE]))[4], 2);
  });

  it("过期被拒: opening after the share expires is rejected", async () => {
    const { shares } = await networkHelpers.loadFixture(deployFixture);
    const { expiresAt } = await createShare(shares, { maxOpens: 5 });
    await networkHelpers.time.increaseTo(expiresAt);
    assert.equal(await shares.read.checkOpen([SHARE, bob.address]), OpenStatus.Expired);

    // Sign with a deadline that is still valid so the expiry is what rejects it.
    const open = await signedOpen(shares, bob, bob.address, SHARE, (await now()) + 3600n);
    await viem.assertions.revertWithCustomErrorWithArgs(shares.write.recordOpenBySig(open), shares, "ShareExpired", [
      SHARE,
    ]);
    assert.equal(await shares.read.receiptCount([SHARE]), 0n);
  });

  it("撤回后被拒: opening after the sender revokes is rejected", async () => {
    const { shares } = await networkHelpers.loadFixture(deployFixture);
    await createShare(shares, { maxOpens: 5 });
    await shares.write.recordOpenBySig(await signedOpen(shares, bob, bob.address));

    await viem.assertions.emitWithArgs(
      shares.write.revokeBySig(await signedRevoke(shares, alice, alice.address)),
      shares,
      "ShareRevocation",
      [SHARE, getAddress(alice.address)],
    );
    const share = await shares.read.getShare([SHARE]);
    assert.equal(share[7], true);
    assert.equal(share[8], await now());
    assert.equal(await shares.read.checkOpen([SHARE, bob.address]), OpenStatus.Revoked);

    await viem.assertions.revertWithCustomErrorWithArgs(
      shares.write.recordOpenBySig(await signedOpen(shares, bob, bob.address)),
      shares,
      "ShareRevoked",
      [SHARE],
    );
    assert.equal(await shares.read.receiptCount([SHARE]), 1n);
  });

  it("only the share's sender can revoke it, and only once", async () => {
    const { shares } = await networkHelpers.loadFixture(deployFixture);
    await createShare(shares);
    await viem.assertions.revertWithCustomErrorWithArgs(
      shares.write.revokeBySig(await signedRevoke(shares, bob, bob.address)),
      shares,
      "NotSender",
      [SHARE, getAddress(bob.address)],
    );
    await shares.write.revokeBySig(await signedRevoke(shares, alice, alice.address));
    await viem.assertions.revertWithCustomError(
      shares.write.revokeBySig(await signedRevoke(shares, alice, alice.address)),
      shares,
      "ShareRevoked",
    );
  });

  it("rejects opening or revoking a share that was never created", async () => {
    const { shares } = await networkHelpers.loadFixture(deployFixture);
    const unknown = b32("share:never-created");
    assert.equal(await shares.read.checkOpen([unknown, bob.address]), OpenStatus.Unknown);
    await viem.assertions.revertWithCustomErrorWithArgs(
      shares.write.recordOpenBySig(await signedOpen(shares, bob, bob.address, unknown)),
      shares,
      "UnknownShare",
      [unknown],
    );
    await viem.assertions.revertWithCustomError(
      shares.write.revokeBySig(await signedRevoke(shares, alice, alice.address, unknown)),
      shares,
      "UnknownShare",
    );
  });

  it("rejects malformed share rules: reused id, zero id, zero recipient, zero opens, past expiry", async () => {
    const { shares } = await networkHelpers.loadFixture(deployFixture);
    await createShare(shares);
    const cases: Array<[Partial<CreateArgs>, "ShareExists" | "InvalidShareId" | "InvalidRecipient" | "InvalidMaxOpens" | "InvalidExpiry"]> = [
      [{}, "ShareExists"],
      [{ shareId: `0x${"00".repeat(32)}` }, "InvalidShareId"],
      [{ shareId: b32("s2"), recipient: "0x0000000000000000000000000000000000000000" }, "InvalidRecipient"],
      [{ shareId: b32("s3"), maxOpens: 0 }, "InvalidMaxOpens"],
      [{ shareId: b32("s4"), expiresAt: 1n }, "InvalidExpiry"],
    ];
    for (const [overrides, error] of cases) {
      const c = await signedCreate(shares, alice, overrides);
      await viem.assertions.revertWithCustomError(submitCreate(shares, c), shares, error);
    }
  });

  describe("签名伪造被拒 (forged signatures are rejected)", () => {
    it("rejects a share created in alice's name but signed by another key", async () => {
      const { shares } = await networkHelpers.loadFixture(deployFixture);
      const forged = await signedCreate(shares, mallory, { sender: alice.address });
      await viem.assertions.revertWithCustomErrorWithArgs(submitCreate(shares, forged), shares, "InvalidSignature", [
        getAddress(alice.address),
      ]);
      assert.equal(await shares.read.checkOpen([SHARE, bob.address]), OpenStatus.Unknown);
    });

    it("rejects an open recorded for the recipient but signed by another key", async () => {
      const { shares } = await networkHelpers.loadFixture(deployFixture);
      await createShare(shares);
      await viem.assertions.revertWithCustomError(
        shares.write.recordOpenBySig(await signedOpen(shares, mallory, bob.address)),
        shares,
        "InvalidSignature",
      );
      assert.equal(await shares.read.receiptCount([SHARE]), 0n);
    });

    it("rejects a relayer that tampers with a signed field (recipient, open limit, expiry)", async () => {
      const { shares } = await networkHelpers.loadFixture(deployFixture);
      const c = await signedCreate(shares, alice);
      for (const tampered of [
        { ...c.args, recipient: mallory.address },
        { ...c.args, maxOpens: 1000 },
        { ...c.args, expiresAt: c.args.expiresAt + 365n * DAY },
      ]) {
        await viem.assertions.revertWithCustomError(submitCreate(shares, c, tampered), shares, "InvalidSignature");
      }
      await submitCreate(shares, c);
      assert.equal((await shares.read.getShare([SHARE]))[1], getAddress(bob.address));
    });

    it("rejects replaying an already-used open signature (nonce consumed)", async () => {
      const { shares } = await networkHelpers.loadFixture(deployFixture);
      await createShare(shares, { maxOpens: 5 });
      const open = await signedOpen(shares, bob, bob.address);
      await shares.write.recordOpenBySig(open);
      await viem.assertions.revertWithCustomError(shares.write.recordOpenBySig(open), shares, "InvalidSignature");
      assert.equal(await shares.read.receiptCount([SHARE]), 1n);
    });

    it("rejects a signature submitted after its deadline", async () => {
      const { shares } = await networkHelpers.loadFixture(deployFixture);
      await createShare(shares, { maxOpens: 5 });
      const open = await signedOpen(shares, bob, bob.address, SHARE, (await now()) + 60n);
      await networkHelpers.time.increase(120);
      await viem.assertions.revertWithCustomErrorWithArgs(shares.write.recordOpenBySig(open), shares, "SignatureExpired", [
        open[2],
      ]);
    });
  });
});
