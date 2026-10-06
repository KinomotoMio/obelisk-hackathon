// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 tommy0103 and contributors.

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { network } from "hardhat";
import type { Hex } from "viem";
import type { PrivateKeyAccount } from "viem/accounts";

import { keyRegistryTypes, obeliskDomain } from "../eip712.js";
import { deadlineAfter, offchainUser } from "./helpers.js";

const { viem, networkHelpers } = await network.create();
const publicClient = await viem.getPublicClient();
const chainId = await publicClient.getChainId();

const alice = offchainUser("alice");
const bob = offchainUser("bob");
const KEY_1: Hex = `0x${"11".repeat(32)}`;
const KEY_2: Hex = `0x${"22".repeat(32)}`;

async function deployFixture() {
  const registry = await viem.deployContract("KeyRegistry");
  const [relayer] = await viem.getWalletClients();
  return { registry, relayer };
}

type Registry = Awaited<ReturnType<typeof deployFixture>>["registry"];

async function signRegister(
  registry: Registry,
  signer: PrivateKeyAccount,
  message: { user: Hex; pubKey: Hex; nonce?: bigint; deadline?: bigint },
) {
  const nonce = message.nonce ?? (await registry.read.nonces([message.user]));
  const deadline = message.deadline ?? deadlineAfter(BigInt(await networkHelpers.time.latest()));
  const signature = await signer.signTypedData({
    domain: obeliskDomain("KeyRegistry", chainId, registry.address),
    types: keyRegistryTypes,
    primaryType: "RegisterKey",
    message: { user: message.user, pubKey: message.pubKey, nonce, deadline },
  });
  return { deadline, signature };
}

describe("KeyRegistry: wallet address -> encryption public key", () => {
  it("registers a user's key from the user's signature while the relayer pays gas", async () => {
    const { registry, relayer } = await networkHelpers.loadFixture(deployFixture);
    const { deadline, signature } = await signRegister(registry, alice, { user: alice.address, pubKey: KEY_1 });

    await viem.assertions.emitWithArgs(
      registry.write.registerKeyBySig([alice.address, KEY_1, deadline, signature]),
      registry,
      "KeyRegistered",
      [alice.address, 1, KEY_1],
    );

    const [pubKey, updatedAt, version] = await registry.read.keyOf([alice.address]);
    assert.equal(pubKey, KEY_1);
    assert.equal(updatedAt, BigInt(await networkHelpers.time.latest()));
    assert.equal(version, 1);
    assert.equal(await registry.read.isRegistered([alice.address]), true);
    // The relayer submitted the transaction but is not the registrant.
    assert.equal(await registry.read.isRegistered([relayer.account.address]), false);
    assert.equal(await registry.read.registeredCount(), 1n);
    assert.equal((await registry.read.registeredAt([0n])).toLowerCase(), alice.address.toLowerCase());
  });

  it("rotates the key on re-registration, bumping the version without re-listing the wallet", async () => {
    const { registry } = await networkHelpers.loadFixture(deployFixture);
    const first = await signRegister(registry, alice, { user: alice.address, pubKey: KEY_1 });
    await registry.write.registerKeyBySig([alice.address, KEY_1, first.deadline, first.signature]);
    const second = await signRegister(registry, alice, { user: alice.address, pubKey: KEY_2 });
    await registry.write.registerKeyBySig([alice.address, KEY_2, second.deadline, second.signature]);

    const [pubKey, , version] = await registry.read.keyOf([alice.address]);
    assert.equal(pubKey, KEY_2);
    assert.equal(version, 2);
    assert.equal(await registry.read.registeredCount(), 1n);
  });

  it("lists every registered wallet through count and index views (no event indexing needed)", async () => {
    const { registry } = await networkHelpers.loadFixture(deployFixture);
    for (const user of [alice, bob]) {
      const { deadline, signature } = await signRegister(registry, user, { user: user.address, pubKey: KEY_1 });
      await registry.write.registerKeyBySig([user.address, KEY_1, deadline, signature]);
    }
    assert.equal(await registry.read.registeredCount(), 2n);
    const listed = [await registry.read.registeredAt([0n]), await registry.read.registeredAt([1n])];
    assert.deepEqual(
      listed.map((a) => a.toLowerCase()),
      [alice.address.toLowerCase(), bob.address.toLowerCase()],
    );
  });

  describe("签名伪造被拒 (forged signatures are rejected)", () => {
    it("rejects a key registration for alice signed by bob's key", async () => {
      const { registry } = await networkHelpers.loadFixture(deployFixture);
      const { deadline, signature } = await signRegister(registry, bob, { user: alice.address, pubKey: KEY_1 });
      await viem.assertions.revertWithCustomErrorWithArgs(
        registry.write.registerKeyBySig([alice.address, KEY_1, deadline, signature]),
        registry,
        "InvalidSignature",
        [alice.address],
      );
      assert.equal(await registry.read.isRegistered([alice.address]), false);
    });

    it("rejects a relayer that swaps in a different key than the user signed", async () => {
      const { registry } = await networkHelpers.loadFixture(deployFixture);
      const { deadline, signature } = await signRegister(registry, alice, { user: alice.address, pubKey: KEY_1 });
      await viem.assertions.revertWithCustomError(
        registry.write.registerKeyBySig([alice.address, KEY_2, deadline, signature]),
        registry,
        "InvalidSignature",
      );
    });

    it("rejects replaying a signature that was already used", async () => {
      const { registry } = await networkHelpers.loadFixture(deployFixture);
      const { deadline, signature } = await signRegister(registry, alice, { user: alice.address, pubKey: KEY_1 });
      await registry.write.registerKeyBySig([alice.address, KEY_1, deadline, signature]);
      await viem.assertions.revertWithCustomError(
        registry.write.registerKeyBySig([alice.address, KEY_1, deadline, signature]),
        registry,
        "InvalidSignature",
      );
      assert.equal((await registry.read.keyOf([alice.address]))[2], 1);
    });

    it("rejects a signature past its deadline", async () => {
      const { registry } = await networkHelpers.loadFixture(deployFixture);
      const now = BigInt(await networkHelpers.time.latest());
      const { deadline, signature } = await signRegister(registry, alice, {
        user: alice.address,
        pubKey: KEY_1,
        deadline: now + 60n,
      });
      await networkHelpers.time.increase(120);
      await viem.assertions.revertWithCustomErrorWithArgs(
        registry.write.registerKeyBySig([alice.address, KEY_1, deadline, signature]),
        registry,
        "SignatureExpired",
        [deadline],
      );
    });
  });

  it("rejects an empty or oversized public key", async () => {
    const { registry } = await networkHelpers.loadFixture(deployFixture);
    for (const pubKey of ["0x", `0x${"ab".repeat(257)}`] as Hex[]) {
      const { deadline, signature } = await signRegister(registry, alice, { user: alice.address, pubKey });
      await viem.assertions.revertWithCustomError(
        registry.write.registerKeyBySig([alice.address, pubKey, deadline, signature]),
        registry,
        "InvalidPublicKeyLength",
      );
    }
  });
});
