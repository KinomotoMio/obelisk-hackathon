// Copyright (C) 2026 tommy0103 and contributors.
// SPDX-License-Identifier: AGPL-3.0-only

// Signatures for minting Skills (#16): MintSkill and PublishVersion go through
// the online service's fee relay to SkillRegistry; SkillContent lets the
// service store the minted body under the name and description the author
// chose. All three sign in the SkillRegistry domain (chain-protocol.ts).

import type { Address, Hex } from 'viem';
import type { PrivateKeyAccount } from 'viem/accounts';

import { obeliskDomain, skillContentTypes, skillRegistryTypes } from './chain-protocol.ts';

type Signer = Pick<PrivateKeyAccount, 'signTypedData'>;

export interface MintSkillMessage {
  author: Address;
  fingerprint: Hex;
  birthScenes: string[];
  parentSkillId: bigint;
  nonce: bigint;
  deadline: bigint;
}

export interface PublishVersionMessage {
  author: Address;
  skillId: bigint;
  fingerprint: Hex;
  nonce: bigint;
  deadline: bigint;
}

export interface SkillContentMessage {
  author: Address;
  fingerprint: Hex;
  name: string;
  description: string;
}

/** The local library's 64-hex fingerprint as the contract's bytes32. */
export function fingerprintToBytes32(fingerprint: string): Hex {
  if (!/^[0-9a-f]{64}$/.test(fingerprint)) throw new Error(`Not a Skill fingerprint: ${fingerprint}`);
  return `0x${fingerprint}`;
}

/** The contract's bytes32 back to the library's 64-hex form. */
export function fingerprintFromBytes32(value: string): string {
  const match = /^0x([0-9a-fA-F]{64})$/.exec(value);
  if (!match) throw new Error(`Not a bytes32 fingerprint: ${value}`);
  return match[1]!.toLowerCase();
}

export function signMintSkill(signer: Signer, chainId: number, skillRegistry: Address, message: MintSkillMessage): Promise<Hex> {
  return signer.signTypedData({
    domain: obeliskDomain('SkillRegistry', chainId, skillRegistry),
    types: skillRegistryTypes,
    primaryType: 'MintSkill',
    message,
  });
}

export function signPublishVersion(signer: Signer, chainId: number, skillRegistry: Address, message: PublishVersionMessage): Promise<Hex> {
  return signer.signTypedData({
    domain: obeliskDomain('SkillRegistry', chainId, skillRegistry),
    types: skillRegistryTypes,
    primaryType: 'PublishVersion',
    message,
  });
}

export function signSkillContent(signer: Signer, chainId: number, skillRegistry: Address, message: SkillContentMessage): Promise<Hex> {
  return signer.signTypedData({
    domain: obeliskDomain('SkillRegistry', chainId, skillRegistry),
    types: skillContentTypes,
    primaryType: 'SkillContent',
    message,
  });
}
