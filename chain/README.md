# Obelisk contracts on BOT Chain

Four contracts that hold Obelisk's public ledger
(see [docs/vision/01](../docs/vision/01-identity-and-chain.md)):

| Contract | Records | Vision |
| --- | --- | --- |
| `KeyRegistry` | wallet address → encryption public key (re-registering rotates it; `version` counts rotations) | I2 |
| `ShareRegistry` | share id → sender, recipient, content hash, open limit, open count, expiry, revocation; one receipt per open | S1, S2 |
| `SkillRegistry` | Skill id → author, version fingerprints, birth scenes, parent Skill; queries by author and by parent (genealogy) | K2, K3 |
| `UsageStats` | per Skill version: total invocations, distinct reporting wallets, scene and outcome buckets | U4 |

There is no owner, admin key, or upgrade path.

## Users sign, the online service submits

Every write is `fooBySig(..., deadline, signature)`. Anyone may submit it (in
practice the online service, which pays gas); the actor is always the address
that signed the EIP-712 message, never `msg.sender`. Signatures are checked with
OpenZeppelin `SignatureChecker`, so EOAs (65-byte ECDSA) and ERC-1271 contract
wallets both work.

- **Domain:** `{ name, version: "1", chainId, verifyingContract }`.
- **Nonce:** read `nonces(user)` from the same contract. Nonces are sequential
  per user per contract, so submit one user's actions on a contract in order;
  two actions signed against the same nonce cannot both land.
- **Deadline:** unix seconds; the transaction must be mined by then.
- Failures are custom errors: `InvalidSignature(user)` (wrong signer, a field
  changed after signing, or a nonce already used) and `SignatureExpired(deadline)`.

| Domain `name` | Primary type |
| --- | --- |
| `ObeliskKeyRegistry` | `RegisterKey(address user,bytes pubKey,uint256 nonce,uint256 deadline)` |
| `ObeliskShareRegistry` | `CreateShare(address sender,bytes32 shareId,address recipient,bytes32 contentHash,uint32 maxOpens,uint64 expiresAt,uint256 nonce,uint256 deadline)` |
| | `RecordOpen(address recipient,bytes32 shareId,uint256 nonce,uint256 deadline)` |
| | `RevokeShare(address sender,bytes32 shareId,uint256 nonce,uint256 deadline)` |
| `ObeliskSkillRegistry` | `MintSkill(address author,bytes32 fingerprint,string[] birthScenes,uint256 parentSkillId,uint256 nonce,uint256 deadline)` |
| | `PublishVersion(address author,uint256 skillId,bytes32 fingerprint,uint256 nonce,uint256 deadline)` |
| `ObeliskUsageStats` | `ReportUsage(address reporter,bytes32 fingerprint,uint64 cumulativeInvocations,Bucket[] scenes,Bucket[] outcomes,uint256 nonce,uint256 deadline)` with `Bucket(bytes32 key,uint64 cumulative)` |

[`eip712.ts`](eip712.ts) has these as viem-ready typed-data objects plus
`obeliskDomain()`. The tests sign through that file, so it cannot drift from the
contracts.

Rules worth knowing before calling:

- **Shares.** `shareId` is a nonzero `bytes32` chosen by the sender off-chain,
  so the link can exist before the transaction. `checkOpen(shareId, opener)`
  returns `0` OK, `1` unknown, `2` not the recipient, `3` opens used up,
  `4` expired (`block.timestamp >= expiresAt`), `5` revoked. Not-the-recipient
  wins over every other status, so a forwarded link never reveals a share's
  state. Call it before releasing a key package. Then submit the recipient's
  `RecordOpen` signature, which re-checks the same rules on-chain. That
  signature also proves who the opener is.
- **Skills.** Ids start at 1, and `parentSkillId = 0` means no parent. A
  fingerprint (sha256 of the normalized Skill body) can be used once across all
  Skills and versions. At most 16 birth scenes, each 1 to 64 bytes.
- **Usage.** Reports are running totals per (wallet, fingerprint). The
  contract adds only the increase and rejects decreases. A retried report
  changes nothing and a wallet is never counted twice. Bucket keys are opaque
  `bytes32` values that must be strictly ascending. Each bucket can be at most
  `cumulativeInvocations`, and an omitted key keeps its previous value. In P0,
  send empty bucket arrays. Only fingerprints minted in the paired
  `SkillRegistry` are accepted.

## Reading state

BOT Chain's documentation says `eth_getLogs` is unavailable, so nothing depends
on events. Every record and every list can be read through `view` functions.
Each list has a `…Count` and an `…At(index)` function, for example
`registeredCount`, `sharesByRecipientCount`, `receiptCount`, `childrenCount`,
`reporterCount`, `sceneKeyCount`, and `reportedFingerprintCount`. The contracts
still emit events for block explorers.

## Commands

```sh
cd chain
npm ci
npm test            # compile + all contract tests (node:test, in-process chain)
npm run typecheck   # compile + tsc
npm run export-abi  # rewrite abi/ after an ABI change (a test fails if you forget)
npm run deploy:local   # full deploy into a throwaway in-process chain (chainId 31337)
```

Solidity 0.8.28 with `evmVersion: cancun`, the optimizer, and the IR pipeline.
Tests and deploys use the same settings.

## Deploying to the BOT Chain testnet

Testnet: chain id 968, RPC `https://rpc.bohr.life`, explorer
<https://scan.bohr.life/>, faucet <https://faucet.botchain.ai/basic>.

1. Fund a deployer address from the faucet. Deploying all four contracts uses
   about 4.2M gas. At the testnet's 20 gwei gas price (observed 2026-10-07),
   that is about 0.084 BOT.
2. Provide its private key as the `BOT_DEPLOYER_PRIVATE_KEY` configuration
   variable. Never commit it. Use either:
   - `npx hardhat keystore set BOT_DEPLOYER_PRIVATE_KEY` (encrypted at rest;
     Hardhat asks for the keystore password on use), or
   - an environment variable for a single run, as in step 3.
3. Run:

   ```sh
   cd chain
   BOT_DEPLOYER_PRIVATE_KEY=0x… npm run deploy:testnet   # or just `npm run deploy:testnet` with the keystore
   ```

4. Commit the `deployments/968.json` file this command writes.

Re-running is safe. Each contract is recorded as soon as its deployment is
mined, and a later run reuses recorded contracts that still have code. An
interrupted run therefore resumes instead of deploying everything again. If
`SkillRegistry` is redeployed, `UsageStats` is redeployed as well, because it is
bound to one registry. Mainnet (`npm run deploy:mainnet`, chain id 677) uses the
same flow and is tracked in #5.

## Outputs for the online service and CLI

These files are committed and none of them need Hardhat:

| Path | Contents |
| --- | --- |
| `abi/<Contract>.json` | the ABI as plain JSON |
| `abi/index.ts` | the same ABIs as `as const` exports (`keyRegistryAbi`, `shareRegistryAbi`, `skillRegistryAbi`, `usageStatsAbi`) for viem type inference |
| `eip712.ts` | domain names, typed-data definitions, `obeliskDomain()`, `OpenStatus` codes |
| `deployments/<chainId>.json` | `{ chainId, network, complete, updatedAt, contracts: { <Name>: { address, txHash, blockNumber, deployer } } }` |

Only use a deployment file whose `complete` is `true`. `deployments/31337.json`
comes from local runs and is git-ignored.
