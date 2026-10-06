---
name: obelisk-wallet
description: >
  Create, show, or activate the user's Obelisk wallet, their identity on BOT Chain, with the
  `obelisk wallet` CLI. Use when the user says "帮我创建 Obelisk 钱包", "创建钱包", "激活钱包",
  "我的 Obelisk 地址", "create my Obelisk wallet", "activate my wallet", or asks whether their
  wallet is activated. Never scaffold a wallet project, never ask for or print a private key, and
  never import an existing wallet in conversation (that happens in the Obelisk App).
allowed-tools:
  - Bash(obelisk:*)
---

# Obelisk wallet

Obelisk gives each user a wallet address as their identity on BOT Chain. Shares,
Skills, and usage reports are signed with it. The Obelisk online service submits
these signed actions and pays the fees, so the user never needs to buy coins.

The private key is generated locally and kept in the system keychain (macOS
Keychain, or the Secret Service keyring on Linux). It never appears in command
output. Never ask the user for a private key or recovery phrase, and never try to
read one from the keychain yourself. Importing an existing wallet happens in the
Obelisk App, not in conversation.

## Commands

| Command | What it does | Writes on chain |
| --- | --- | --- |
| `obelisk wallet create` | Creates this data directory's wallet, or reports the existing one (`status`: `created`, `exists`, or `recovered`). Never replaces a wallet. | No |
| `obelisk wallet show` | Shows the address and whether the wallet is activated (`activation`: `active`, `not_activated`, `different_key`, or `unknown` with `serviceError`). | No |
| `obelisk wallet activate` | **Preview only.** Shows the wallet, network, contract, and the encryption public key that would be registered. | No |
| `obelisk wallet activate --confirm` | Signs the registration and submits it through the online service. Returns the transaction and an explorer link. | Yes |

Each command prints one JSON object. When there is a follow-up step, the object
has a `next` field that says what to run next. Errors use the usual
`{ "error": ... }` envelope and exit with code 1.

## "Create my Obelisk wallet" (帮我创建 Obelisk 钱包)

1. Run `obelisk wallet create`. Tell the user the address. If `status` is
   `exists`, say that they already have a wallet and continue with step 2.
2. Run `obelisk wallet activate`. If it returns `status: "already_active"`, say
   so and stop.
3. Show the preview in a few lines: the network, the contract, that this
   registers their encryption public key so that others can share content with
   them, and that the online service pays the fee. Ask the user to confirm.
4. Only after they confirm, run `obelisk wallet activate --confirm`. Report
   `status`, and give the `explorer` link so they can see the registration on
   the block explorer.

Do not add `--confirm` on your own. A confirmation the user gave earlier in the
conversation does not carry over to a new preview.

If `--confirm` returns `status: "submitted"`, the transaction was sent but had
not been confirmed yet. Run `obelisk wallet show` again a little later. Do
**not** run `activate --confirm` again just to check.

## Errors worth recognizing

- `No Obelisk wallet for <dir>`: run `obelisk wallet create` first.
- `OBELISK_SERVICE_URL`: the online service address is not configured. Tell
  the user. Do not guess a URL.
- `Activation was not submitted: … relay wallet … top it up` or `… no relay
  wallet configured`: the problem is on the online service's side, and nothing
  was signed on chain. Tell the user to try later or contact the service
  operator.
- `Activation was not submitted: … expects nonce …`: another registration landed
  in the meantime. Running the same command again is safe.
- `… refusing to sign for it`: the service reported contract addresses that do
  not match the known deployment. Stop and report it. Do not work around it.
- `… private key is not in the …`: `wallet.json` exists, but the keychain entry is
  missing. Do not create a new wallet over it. Tell the user.

## Data directories

The wallet belongs to the Obelisk data directory: `~/.obelisk`, or
`OBELISK_HOME` when that is set. The keychain entry uses service
`obelisk-wallet`, and its account is that directory's absolute path, so each
`OBELISK_HOME` has its own wallet on the same computer (Playground roles rely on
this). `<data dir>/wallet.json` stores only the address and where the key is.
