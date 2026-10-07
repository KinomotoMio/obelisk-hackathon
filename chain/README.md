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
npm run verify:testnet # verify the committed testnet contracts' source on the explorer
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
bound to one registry.

## Verifying the source on the explorer

Both explorers are Blockscout instances with a public API, so verifying needs
no key and no account:

```sh
cd chain
npm run verify:testnet   # every contract in deployments/968.json, on scan.bohr.life
npm run verify:mainnet   # every contract in deployments/677.json, on scan.botchain.ai
```

It runs with the production build profile, the one the deploy used (solc
0.8.28, cancun, optimizer 200 runs, viaIR), so the explorer rebuilds the same
bytecode. Contracts that are already verified are skipped. The testnet
contracts were verified this way on 2026-10-07, for example
<https://scan.bohr.life/address/0x84b17B83C976E2b0C447A4df09c52D80e4f40B98#code>.

## Switching to mainnet (#5)

Release order (confirmed 2026-10-08): finish and verify the contracts and
business flows on testnet first, record the accepted Git commit, contract
list, compiler settings and ABI, then deploy that version on mainnet.
Changes to contracts or business logic require another testnet acceptance
before updating the release version. Network deployment records and runtime
configuration are recorded separately.

Keep the existing testnet Worker and Playground data available for the demo.
Prepare and deploy a separate mainnet Worker with its own network
configuration and storage bindings; do not change the testnet Worker's
`CHAIN_ID` or overwrite its data. The mainnet Worker configuration is still
to be implemented. Mainnet verification uses a small number of real business
operations; bulk Playground runs remain on testnet and are labeled as such.

Mainnet is chain id 677, RPC `https://rpc.botchain.ai`, explorer
<https://scan.botchain.ai/>. One address, `0x2f8A318ad91cBa234Af92ad6029F9bE395a20F9f`,
both deploys the contracts and relays for the online service (its key is the
Hardhat keystore entry and the Worker's `RELAYER_PRIVATE_KEY`). The deploy
uses about 4.2M gas, which is about 0.084 BOT at 20 gwei for the current four
contracts. Relayed action costs vary with the operation and storage writes;
estimate each operation and reserve a budget for the chosen mainnet checks.
Any additional market contract must enter the testnet acceptance and the
final deployment list before the release version is fixed.

| # | Who | Step |
| --- | --- | --- |
| 1 | Owner | Get mainnet BOT sent to `0x2f8A…0F9f` and check it arrived: `curl -s -X POST https://rpc.botchain.ai -H 'content-type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"eth_getBalance","params":["0x2f8A318ad91cBa234Af92ad6029F9bE395a20F9f","latest"]}'` |
| 2 | Owner | `cd chain && npm run deploy:mainnet` and enter the keystore password. If it stops for any reason, run it again: it resumes. It is done when it prints `Wrote …/deployments/677.json` (`complete: true`). |
| 3 | Agent | `npm run verify:mainnet` in `chain/` (no key), then open the four `#code` links it prints. |
| 4 | Agent | Run `npm run sync:chain` at the repository root, then `node --test tests/chain-protocol-sync.test.mjs` and `cd service && npm test`. Record `chain/deployments/677.json`, the synced `packages/core/src/chain-protocol.ts`, and the separate mainnet Worker configuration. Keep the default testnet Worker configuration on 968. The service and CLI read addresses from the synced copy. |
| 5 | Owner | Deploy the separate mainnet Worker using its prepared configuration and configure its relayer secret. Its `/v1/health` must show `chainId: 677` and a funded relayer; the existing testnet Worker's health must still show 968. Record both URLs. |
| 6 | Agent | Rebuild the CLI and the App from the recorded version (`npm run build:cli`, App build). A CLI built before step 4 refuses a service on 677 with "which this CLI has no deployment for". Use the mainnet service URL and an isolated data directory for the selected small business smoke test. Record transaction links and actual fees for the submission. |

What does not carry over from the testnet: encryption keys (each wallet runs
`obelisk wallet activate` again on mainnet), minted Skills (mint them again;
local records of testnet mints stay, but they are not reported on 677),
shares, and usage totals. Keep bulk Playground scenarios on `chainId: 968`
and the testnet service URL. Any small mainnet verification scenario must
explicitly select 677 and the separate mainnet service URL. Preserve the
testnet environment when changing or rolling back the mainnet deployment.

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
