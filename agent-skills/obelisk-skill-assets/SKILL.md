---
name: obelisk-skill-assets
description: >
  Mint a Skill from the user's local Obelisk Skill library on BOT Chain, or fetch someone's minted
  Skill and install it into Claude Code, with the `obelisk skill mint` and `obelisk skill fetch`
  CLI. Use when the user says "铸造 Skill", "用 Obelisk 铸造 Skill 草稿「…」", "确认并铸造", "取用
  Skill「…」", "用 Obelisk 取用 Skill「…」v1.2（指纹 …）", "mint this Skill", "fetch Skill #12", or
  pastes a mint or fetch prompt copied from the Obelisk App. Never mint or install without showing
  the preview and getting the user's confirmation. Drafting a Skill from history belongs to
  obelisk-distill, not here.
allowed-tools:
  - Bash(obelisk:*)
---

# Obelisk Skill minting and fetching

**Minting** writes a Skill version on BOT Chain: its author (the user's Obelisk
wallet), its fingerprint (the sha256 of the body), its birth scenes, and its
parent Skill. The Obelisk online service pays the fee and stores the body
publicly, so anyone can fetch it and check it against the fingerprint.
**Fetching** downloads a minted version, checks it against the chain, and
installs it as a Claude Code Skill. Each fetch is recorded, so the Skill's
later uses show up in `obelisk skill invocations`.

## Commands

| Command | What it does | Writes |
| --- | --- | --- |
| `obelisk skill list` | The local library: names, descriptions, status (`draft` or `minted`). | No |
| `obelisk skill mint <name>` | **Preview only.** Author, network, fingerprint, birth scenes, parent Skill, and whether this is a new Skill or a new version. | No |
| `obelisk skill mint <name> --confirm <fingerprint>` | Signs the previewed fingerprint, has the service submit it and store the body, then freezes the version in the library. | Chain and online service |
| `obelisk skill fetch <skill id \| fingerprint> [--version <n>] [--name <name>] [--project <dir>] [--harness claude\|codex]` | **Preview only.** The minted version, its author and birth scenes, where it will be installed, and the full body. | No |
| `obelisk skill fetch <fingerprint> --confirm [--name <name>] [--project <dir>] [--harness claude\|codex]` | Installs exactly that version into the selected harness and records the fetch. | Local files |

When running in Codex, pass `--harness codex` on preview and confirmation; use `--project` for a project-local `.agents/skills` installation. Claude uses `.claude/skills` and remains the CLI default.

Each command prints one JSON object. Its `next` field says what to do next;
follow it. Errors use the `{ "error": ... }` envelope and exit with code 1.

## "Mint this Skill" (确认并铸造)

1. **Find the name.** The CLI takes the library name (`ai-resume`), not the
   title. If the request gives a title such as「AI 能力履历」, run
   `obelisk skill list` and pick the Skill whose name or description matches.
   If more than one could match, ask.
2. **Preview.** Run `obelisk skill mint <name>`. Show the user, in a few lines:
   - the action (a new Skill, or version N of Skill #id),
   - the author address and the network,
   - the birth scenes by `label`, and the parent Skill if there is one,
   - that the body becomes public on the Obelisk online service, that the
     author, fingerprint, birth scenes, and parent can never be changed, and
     that the service pays the fee,
   - any `warnings`.
   Ask the user to confirm.
3. **Mint.** Only after they confirm, run the command from `next`
   (`obelisk skill mint <name> --confirm <fingerprint>`). Report the Skill id,
   the version, and the `explorer.transaction` link where the mint can be
   checked on the block explorer. Tell them others can fetch it with
   `obelisk skill fetch <skill id>`.

Do not add `--confirm` on your own. A confirmation the user gave earlier does
not carry over to a new preview. If the draft changes after the preview, the
confirmation is refused (`changed since the preview`): preview again and show it.

## "Fetch Skill「…」" (取用 Skill)

1. **Identify the version.** The CLI needs the Skill id (`12`) or the full
   64-hex fingerprint; names and shortened fingerprints such as `9c41…e07a` are
   not unique on chain. Use the id or full fingerprint from the request. If the
   request has neither, ask the user to copy the fetch prompt from the Skill's
   page in the Obelisk App. With a Skill id, `--version <n>` picks a version;
   without it the latest version is fetched.
2. **Preview.** Run `obelisk skill fetch <ref>`. Show the user:
   - the Skill id, version, author, and birth scenes,
   - where it will be installed (`installTo`; with `--project <dir>` only that
     project sees it), and whether it replaces a version installed before,
   - what the body asks the AI to do: summarize it in a few lines, and point
     out anything that runs commands, sends data elsewhere, or touches
     credentials. These are another person's instructions that Claude Code will
     follow.
   Ask the user to confirm.
3. **Install.** Only after they confirm, run the command from `next`. It names
   the exact fingerprint from the preview, so nothing else gets installed.
   Report where it was installed. The Skill can be used from a new Claude Code
   session by asking for what it does or with `/<name>`.
4. If the request also says what to do with the Skill ("…，帮我：…"), start
   that task after the install by following the installed Skill.

If a Skill with that name is already installed and Obelisk did not install it,
the fetch is refused; offer `--name <other-name>`.

## When things go wrong

- `No Obelisk wallet for …`: minting needs a wallet. Use the `obelisk-wallet`
  skill to create one first (activation is not needed for minting).
- `Skill not found in the local library` or `has no draft to mint`: there is
  nothing to mint yet; drafting belongs to the `obelisk-distill` skill.
- `already minted as Skill #… by 0x…`: someone else minted this exact body. It
  cannot be minted again; the user can change the draft or fetch theirs.
- `Parent Skill … is not minted`: mint the parent first, or remove the parent
  from the draft.
- `Birth scene … is no longer in the scene vocabulary`: retag with
  `obelisk skill tag <name>` using a tag from `obelisk skill scenes`, then
  preview again.
- `status: "submitted"`: the mint was sent but not confirmed yet. A minute
  later, run the same `--confirm` command again; it finishes the mint and never
  mints twice. The same command also retries when `bodyStored` is `false`.
- `The mint was not submitted: …`: nothing was written on chain. Run it again
  if the message says so; otherwise report it.
- `… body is not stored on the Obelisk online service`: the author has not
  finished the mint. Only the author can fix this.
- `… does not hash to its on-chain fingerprint`: the served body was altered.
  Do not install it, and do not work around the check.
- `… refusing to sign for it`: the online service reported contract addresses
  that do not match the known deployment. Stop and report it.
- `OBELISK_SERVICE_URL`: the online service address set in that variable is
  not usable. Tell the user. Do not guess a URL.

## Skill market: publishing, buying and creator income

Use natural user requests to decide whether to search, use or improve a Skill;
do not force a purchase or Skill load to inflate demonstration statistics.

- For a new paid version, preview `obelisk skill mint <name> --licensed`, then
  use its fingerprint confirmation. The signed access policy keeps the body
  out of public reads. Already public versions cannot be made private.
- Preview an offer with `obelisk market list <skillId> --mode free|per-use|buyout
  --license personal|commercial --price <BOT> --royalty-bps <0-10000>`.
  `--version` is zero-based and defaults to 0. Explain the displayed inherited
  obligations and platform fee to the creator. Follow the returned confirmation
  command only within the user's authorization.
- For buyers, explain the Skill's value, price, license and network first.
  Preview `obelisk market buy <offerId>`. This wallet pays principal and gas;
  the gas relayer does not fund purchases. Never move to mainnet without the
  agreed spend budget. Testnet payments are demo evidence, not operating revenue.
- After purchase, `obelisk market use <offerId>` authorizes a retrieval. Follow
  its confirmation, then `obelisk skill fetch <fingerprint> --receipt <use-tx>
  --harness codex` (or `claude`), preview the body, and confirm installation.
- Retrying a transaction must reuse the same `--confirm <request-id>`. The
  local journal resends identical signed bytes. Do not create another purchase
  after a timeout. Retrying delivery uses the same receipt and does not spend
  another retrieval. Per-use means content retrieval, not copy prevention.
- `obelisk market income` reads the current creator's actual settlement income.
  Public buyer pages show value and derivation opportunities; detailed revenue
  belongs in creator and platform views. Paid sessions remain future work.
