# Obelisk online service

A Cloudflare Worker that sits between local Obelisk and BOT Chain
(see [docs/vision/01 · I4](../docs/vision/01-identity-and-chain.md)):

- **Fee relay.** Users only sign. The service checks a signed action and
  submits it from its own relay wallet, which pays the gas. The contracts
  always treat the signer as the actor, never the relay wallet.
- **Chain reads.** BOT Chain does not serve `eth_getLogs`, so the service reads
  state through the contracts' view functions and serves it to the CLI, the
  App, and the web reader.
- **Storage.** R2 (`BLOBS`) holds share ciphertext and key packages (and Skill
  bodies, with #16), and KV (`INDEX`) holds small indexes: relayed
  transactions and each share's transaction hashes.

The service never sees plaintext and does nothing that needs AI.

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

`action` is the EIP-712 primary type: `RegisterKey`, `CreateShare`,
`RevokeShare`, `MintSkill`, `PublishVersion`, or `ReportUsage`. `message` is
exactly the signed typed-data message from [`chain/eip712.ts`](../chain/eip712.ts),
including `nonce` and `deadline`. Integers may be JSON numbers or decimal
strings, and bytes are `0x` hex. `RecordOpen` is not relayed here. The
key-release flow (#9) submits it after checking the share's rules.

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

Formats, which the web reader (#10) implements with WebCrypto:

| Item | Format |
| --- | --- |
| ciphertext | `0x01` ‖ nonce (12 bytes) ‖ AES-256-GCM(content key, snapshot JSON, AAD = share id bytes) ‖ tag (16 bytes) |
| `contentHash` | SHA-256 of the ciphertext |
| `keyPackage` | `{ version: 1, algorithm: "x25519-hkdf-sha256-aes-256-gcm", recipientKey, ephemeralPublicKey, nonce, wrappedKey }`. The X25519 shared secret of the ephemeral key and the recipient's registered key (`0x01` ‖ public key, derived as in `packages/core/src/wallet.ts`) goes through HKDF-SHA256 with salt = ephemeral public key ‖ recipient public key and info `obelisk/share-key/x25519/v1` to 32 bytes; `wrappedKey` is AES-256-GCM of the content key under it, AAD = share id bytes, tag appended |
| snapshot | UTF-8 JSON, `format: "obelisk.share.snapshot/v1"` (`packages/core/src/share-snapshot.ts`) |

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
