# Obelisk online service

A Cloudflare Worker that sits between local Obelisk and BOT Chain
(see [docs/vision/01 · I4](../docs/vision/01-identity-and-chain.md)):

- **Fee relay.** Users only sign. The service checks a signed action and
  submits it from its own relay wallet, which pays the gas. The contracts
  always treat the signer as the actor, never the relay wallet.
- **Chain reads.** BOT Chain does not serve `eth_getLogs`, so the service reads
  state through the contracts' view functions and serves it to the CLI, the
  App, and the web reader.
- **Storage.** R2 (`BLOBS`) holds share ciphertext and key packages and
  minted Skill bodies, and KV (`INDEX`) holds small indexes: relayed
  transactions, each share's transaction hashes, and what each relayed usage
  report added (for usage trends, see [Skill usage](#skill-usage)).

The service never sees plaintext session content and does nothing that needs
AI. Minted Skill bodies are the exception by design: they are public, so
anyone can fetch one and check it against its on-chain fingerprint.

## API

All responses are JSON. Errors are `{ "error": { "code", "message", "details"? } }`
with a matching HTTP status. CORS is open, because no cookies or credentials
are involved.

| Route | Returns |
| --- | --- |
| `GET /v1/health` | chain, relay wallet address and balance, which storage bindings exist |
| `GET /v1/chain` | `chainId`, `name`, `explorerUrl`, contract addresses, relay wallet |
| `GET /v1/keys/:address` | `KeyRegistry` record (`registered`, `pubKey`, `version`, `updatedAt`) and the `nonce` the next `RegisterKey` must sign |
| `GET /v1/nonces/:contract/:address` | the signer's next nonce on any Obelisk contract |
| `GET /v1/tx/:hash` | `confirmed`, `reverted`, or `pending`, with the explorer link and the relay record if this service sent it |
| `POST /v1/relay` | submits `{ action, message, signature }` and returns `200 confirmed` with the explorer link, or `202 pending` if the receipt took longer than about 25 s (poll `/v1/tx/:hash`) |
| `POST /v1/shares` | stores a private share's ciphertext and key package, then relays its `CreateShare`; see [Private shares](#private-shares) |
| `GET /v1/shares/:id` | a share's on-chain rules and `status` (`active`, `exhausted`, `expired`, `revoked`), open receipts, transaction links, and whether its content is stored |
| `POST /v1/shares/:id/open` | the recipient's signed `RecordOpen`: checks the rules, puts the open receipt on chain, then returns the key package and ciphertext; see [Opening and revoking](#opening-and-revoking) |
| `POST /v1/shares/:id/revoke` | the sender's signed `RevokeShare`: relayed like `/v1/relay`, and its transaction is kept with the share |

`action` is the EIP-712 primary type: `RegisterKey`, `CreateShare`,
`RevokeShare`, `MintSkill`, `PublishVersion`, or `ReportUsage`. `message` is
exactly the signed typed-data message from [`chain/eip712.ts`](../chain/eip712.ts),
including `nonce` and `deadline`. Integers may be JSON numbers or decimal
strings, and bytes are `0x` hex. `RecordOpen` is not relayed here: only
`POST /v1/shares/:id/open` submits it, after checking the share's rules.

Before any gas is spent, the relay rejects:

- malformed fields (`400 invalid_message`)
- a deadline less than 30 s away (`400 deadline_too_soon`)
- a nonce that is not the signer's current one (`409 stale_nonce`; read it
  again and re-sign)
- a signature from someone other than the named user (`401 invalid_signature`)
- anything the contract itself would revert (`422 contract_rejected`, with
  the contract's error name, for example `InvalidPublicKeyLength(0)`)

It also returns `429 rate_limited` (default limits: 20 actions per signer per
hour and 300 for the whole service), `503 relay_unavailable` (no relay wallet
configured), or `503 relay_out_of_funds`.

One Durable Object (`RelayQueue`) sends every relayed transaction, one at a
time. The relay wallet's nonces therefore never collide, and one user's
actions on a contract reach the chain in the order they were signed.

## Private shares

A share (docs/vision/02) is encrypted on the sender's machine
(`packages/core/src/share-crypto.ts`). The service stores what it cannot
read and enforces the on-chain rules.

`POST /v1/shares` takes `{ message, signature, keyPackage, ciphertext }`:
`message` and `signature` are the sender's signed `CreateShare`, `ciphertext`
is base64 (at most 8 MiB decoded), and `keyPackage` is the content key sealed
to the recipient. Before storing anything or spending gas it checks that the
SHA-256 of the ciphertext is the signed `contentHash` (`400
content_hash_mismatch`), that the recipient has activated a wallet (`422
recipient_not_activated`) and that the key package is sealed to the key it
has registered now (`409 recipient_key_changed`), that the share id is new
(`409 share_exists`), and that the signature is the sender's (`401`). Then it
stores the upload and relays `CreateShare` like `/v1/relay`, answering with
the relay result plus `shareId`. If the relay refuses, the upload is deleted.

### Opening and revoking

The recipient opens a share by signing `RecordOpen { recipient, shareId,
nonce, deadline }` (nonce from `GET /v1/nonces/ShareRegistry/:address`,
deadline at most one hour away) and posting `{ message, signature }` to
`POST /v1/shares/:id/open`. The signature proves who is opening. The service
then reads `ShareRegistry.checkOpen` and refuses, without spending gas:

| Status | `code` | When |
| --- | --- | --- |
| 403 | `not_recipient` | the signer is not the share's recipient (a forwarded link); this takes precedence over the share's state, so a forwarded link always reads "not yours" |
| 410 | `share_revoked` / `share_expired` / `opens_exhausted` | the sender revoked it, it expired, or every allowed open is used |
| 404 | `unknown_share` | no such share on chain |
| 401 | `invalid_signature` | the signature is not the named recipient's |

Refusals carry `details: { recipient, opener, explorerUrl }` for the
reader's refusal page (`explorerUrl` links the share's on-chain record).

Otherwise the service relays the same `RecordOpen`; the contract checks the
rules again and appends the receipt. Only when that receipt is confirmed does
the service answer `200` with `status: "opened"`, `openCount`, `maxOpens` and
`remainingOpens` (`null` when unlimited), `openedAt` (block time, for the
watermark), `receipt: { txHash, blockNumber, explorerUrl }`, `keyPackage`,
and `ciphertext` (base64). Every release is therefore counted on chain. If
the receipt takes longer than about 25 s, the answer is `202` with `status:
"pending"`; posting the same signed request again resumes that open (it
never counts twice) and returns the key package once confirmed.

`POST /v1/shares/:id/revoke` takes the sender's signed `RevokeShare { sender,
shareId, nonce, deadline }`. It refuses a signer other than the sender (`403
not_sender`) and a share already revoked (`409 already_revoked`) before
relaying, and keeps the transaction so `GET /v1/shares/:id` links it. Once
the revoke is confirmed the stored ciphertext and key package are deleted
(`contentStored: false`); a revoke that was still pending, or one relayed
through `/v1/relay`, is cleaned up the next time the share is read or opened.
The share's rules, status, and receipts stay readable from chain.

### Formats

The web reader (#10) implements these with WebCrypto:

| Item | Format |
| --- | --- |
| ciphertext | `0x01` ‖ nonce (12 bytes) ‖ AES-256-GCM(content key, snapshot JSON, AAD = share id bytes) ‖ tag (16 bytes) |
| `contentHash` | SHA-256 of the ciphertext |
| `keyPackage` | `{ version: 1, algorithm: "x25519-hkdf-sha256-aes-256-gcm", recipientKey, ephemeralPublicKey, nonce, wrappedKey }`. The X25519 shared secret of the ephemeral key and the recipient's registered key (`0x01` ‖ public key, derived as in `packages/core/src/wallet.ts`) goes through HKDF-SHA256 with salt = ephemeral public key ‖ recipient public key and info `obelisk/share-key/x25519/v1` to 32 bytes; `wrappedKey` is AES-256-GCM of the content key under it, AAD = share id bytes, tag appended |
| snapshot | UTF-8 JSON, `format: "obelisk.share.snapshot/v1"` (`packages/core/src/share-snapshot.ts`) |

## Minted Skills

| Route | Returns |
| --- | --- |
| `GET /v1/skills/:ref` | a minted Skill version: `skillId`, `author`, `parentSkillId`, `birthScenes`, `versionCount`, `version { index, fingerprint, publishedAt }`, and `content { name, description, body }` (or `null` if no body is stored) |
| `POST /v1/skills/:fingerprint/content` | stores that version's body: `{ author, name, description, body, signature }` |
| `GET /v1/skills/:skillId/lineage` | the family tree the Skill belongs to (族谱), from its root ancestor down |

`:ref` is a Skill id (decimal) or a version fingerprint (`0x` + 64 hex). With
a Skill id, `?versionIndex=N` picks a version; the default is the latest.

A Skill is minted with `MintSkill` (or a new version published with
`PublishVersion`) through `POST /v1/relay`; its body is stored afterwards
(`obelisk skill mint` does both). The service stores a body only when:

- `body` is normalized (LF line endings, no surrounding whitespace, no
  frontmatter) and its sha256 is the fingerprint (`422 fingerprint_mismatch`)
- the fingerprint is minted on chain (`409 not_minted`)
- `signature` is the `SkillContent` typed data from
  [`chain/eip712.ts`](../chain/eip712.ts), signed by `author`
  (`401 invalid_signature`), and `author` minted that version
  (`403 not_author`)

`name` and `description` become the fetched Skill's `SKILL.md` frontmatter.
Content is written once per fingerprint: storing the same content again
returns `created: false`, and different content returns `409 content_exists`.
Requests are limited to 256 KiB.

`GET /v1/skills/:skillId/lineage` walks up the `parentSkillId` chain to the
root, then lists the root's descendants breadth first through
`SkillRegistry.childAt`:

```jsonc
{
  "chainId": 968,
  "contract": "0x…",                       // SkillRegistry
  "skillId": "12",                         // the Skill asked about
  "rootSkillId": "1",
  "path": ["1", "3", "12"],                // root -> … -> skillId
  "nodes": [                               // root first, then each level in mint order
    {
      "skillId": "1", "parentSkillId": null, "depth": 0,
      "author": "0x…",
      "name": "ai-resume",                 // from the stored body of its latest version; null if none is stored
      "versionCount": 2, "latestFingerprint": "0x…", "createdAt": "…",
      "childSkillIds": ["3", "7"]
    }
  ],
  "truncated": false                       // true past 64 nodes or 32 ancestors
}
```

## Skill usage

Real usage per Skill version, as wallets report it to `UsageStats` (#23,
`obelisk usage`). Reports are running totals per (wallet, version), so each
wallet counts once per version however often it reports. Everything except
the trend is read from the contract's views.

| Route | Returns |
| --- | --- |
| `GET /v1/skills/:skillId/usage[?weeks=8]` | a Skill's usage across all its versions, for the Skill detail page |
| `GET /v1/usage/:fingerprint[?wallet=0x…][&weeks=8]` | one version's usage; `wallet` adds that wallet's own report |

`GET /v1/skills/:skillId/usage`:

```jsonc
{
  "chainId": 968,
  "contract": "0x…",                 // UsageStats
  "skillId": "12",
  "author": "0x…",
  "parentSkillId": "3",              // or null
  "birthScenes": [{ "tag": "v1:artifact/resume", "label": "简历与履历", "dimension": "artifact" }],
  "totalInvocations": 1284,          // 真实调用: sum over versions
  "uniqueWallets": 312,              // distinct wallets that reported any version
  "uniqueWalletsExact": true,        // false: more than 1000 reporters, so this is the largest version's count (a lower bound)
  "lastReportAt": "2026-10-07T…Z",   // or null
  "scenes": [                        // 实测场景, largest first
    { "key": "0x…", "tag": "v1:role/engineer", "label": "工程师", "dimension": "role", "invocations": 918 }
  ],
  "outcomes": [{ "key": "0x…", "id": "outcome/smooth", "invocations": 742 }],
  "results": {                       // outcomes in the shape the page shows
    "smooth": 742, "rework": 120, "failed": 40, "unknown": 252,
    "judged": 902,                   // smooth + rework + failed
    "smoothRate": 0.82,              // 顺利率 = smooth / judged; null when judged is 0
    "signals": { "tool-error": 77, "user-correction": 180, "repeated-edit": 0, "repeated-invocation": 0 }
  },
  "trend": {
    "unit": "week", "source": "relayed_reports",
    "available": true,               // false when this service has no KV bound
    "weeks": [{ "start": "2026-08-17", "invocations": 41 }]   // oldest first, the last entry is the current week
  },
  "versions": [
    { "index": 0, "fingerprint": "0x…", "publishedAt": "…", "totalInvocations": 1000, "uniqueWallets": 300, "lastReportAt": "…" }
  ]
}
```

`GET /v1/usage/:fingerprint` has the same `totalInvocations`, `uniqueWallets`,
`lastReportAt`, `scenes`, `outcomes`, `results`, and `trend` for that one
version, plus `fingerprint`, `skillId`, `versionIndex`, and with `?wallet=`,
`wallet: { address, cumulative, reportedAt }`. A fingerprint that is not
minted answers `404 unknown_skill`.

How to read the fields:

- **Scenes.** Bucket keys are `keccak256` of a scene tag in the current
  vocabulary version (`sceneBucketKey` in
  [`packages/core/src/scenes.ts`](../packages/core/src/scenes.ts)). The service
  names every vocabulary tag and the Skill's own birth scenes; other user tags
  come back with `tag`, `label`, and `dimension` set to `null`.
- **Outcomes.** One distribution holds the judged results (`outcome/smooth`,
  `outcome/rework`, `outcome/failed`, `outcome/unknown`) and the fact signals
  (`signal/tool-error`, `signal/user-correction`, `signal/repeated-edit`,
  `signal/repeated-invocation`); keys are `keccak256` of those ids
  ([`packages/core/src/usage-buckets.ts`](../packages/core/src/usage-buckets.ts)).
  Show `judged` and `unknown` next to `smoothRate`. Scene and outcome counts
  are filled in by #25; until then they are empty arrays and zeros.
- **Trend.** The chain keeps no history that a view can return and BOT Chain
  has no `eth_getLogs`, so the trend comes from this service's own record of
  the reports it relayed: each confirmed `ReportUsage` adds the invocations it
  added to the week it was confirmed in (weeks start Monday 00:00 UTC). It
  follows when usage was reported, not when each invocation happened, and
  leaves out reports sent to the contract directly. `weeks` is 1–52.
- Up to 64 scene and 64 outcome keys are read per version.

## Configuration

| Name | Kind | Meaning |
| --- | --- | --- |
| `CHAIN_ID` | var | `968` (testnet, default) or `677` (mainnet, once `chain/deployments/677.json` is committed) |
| `RPC_URL` | var, optional | overrides the chain's public RPC |
| `RELAYER_PRIVATE_KEY` | secret | relay wallet key; never commit it |
| `RELAY_LIMIT_PER_SIGNER_HOURLY`, `RELAY_LIMIT_GLOBAL_HOURLY` | var, optional | relay limits |

Contract addresses come from `chain/deployments/<chainId>.json`, and only a
record with `complete: true` is used. To change contracts, redeploy them and
commit the record. Do not hard-code addresses.

## Deploy

Requires a Cloudflare account with R2 enabled. `wrangler` creates the KV
namespace and R2 bucket on the first deploy.

```sh
cd service
npm ci
npx wrangler login                          # once, in a browser
npx wrangler secret put RELAYER_PRIVATE_KEY # paste the relay wallet key
npm run deploy                              # prints https://obelisk-service.<subdomain>.workers.dev
curl https://obelisk-service.<subdomain>.workers.dev/v1/health
```

Fund the relay wallet address shown by `/v1/health` from the faucet
(<https://faucet.botchain.ai/basic> for the testnet). One `RegisterKey` costs
about 0.004 BOT at 20 gwei (about 190k gas for a first registration).

## Develop and test

```sh
npm test          # unit tests + end-to-end relay against a local Hardhat node
npm run typecheck
npm run dev       # local Worker at http://127.0.0.1:8787 (reads the testnet)
```

The end-to-end tests start `npx hardhat node` from `chain/` and deploy the
contracts from `chain/artifacts`, so first run `npm ci && npx hardhat build`
in `chain/`. Without them, the end-to-end tests are skipped.

To run the Worker against that local chain, put this in `service/.dev.vars`
(git-ignored):

```sh
CHAIN_ID=31337
RPC_URL=http://127.0.0.1:8545
LOCAL_CONTRACTS={"KeyRegistry":"0x…","ShareRegistry":"0x…","SkillRegistry":"0x…","UsageStats":"0x…"}
RELAYER_PRIVATE_KEY=0x…   # a funded local account
```
