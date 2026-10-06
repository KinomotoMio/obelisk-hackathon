---
name: obelisk-usage
description: >
  Turn on, check, send, or turn off Obelisk's Skill usage reporting with the `obelisk usage` CLI:
  how often the user really invoked minted Skills, counted once per wallet on BOT Chain. Use when
  the user says "开启上报", "开启使用量上报", "上报 Skill 使用情况", "关闭上报", "我上报了什么",
  "turn on usage reporting", "report my Skill usage", or pastes a reporting prompt copied from the
  Obelisk App. Never turn reporting on without showing the preview and getting the user's
  confirmation.
allowed-tools:
  - Bash(obelisk:*)
---

# Obelisk usage reporting

Obelisk recognizes every time the user's AI coding assistant loaded a Skill
and which minted version it was. With reporting on, it sends each minted
version's running totals to the UsageStats contract on BOT Chain, signed by
the user's Obelisk wallet. The online service submits them and pays the fee.
The contract counts each wallet once per version, so sending again never
double counts. These numbers become the Skill's real usage on its detail page.

Only versions minted on chain are reported: the user's own minted Skills and
the ones they fetched with Obelisk. Drafts and other Skills stay local. No
session content, prompts, paths, or timestamps leave the computer. The reports
are public under the wallet address.

## Commands

| Command | What it does | Writes on chain |
| --- | --- | --- |
| `obelisk usage status` | Whether reporting is on, and per minted version: invocations, already reported, what a report would add. | No |
| `obelisk usage enable` | **Preview only.** The same numbers plus what is sent, what is never sent, that reports are public, and that the service pays. | No |
| `obelisk usage enable --confirm` | Turns reporting on and sends the first reports now. | Yes |
| `obelisk usage report` | Sends what increased since the last report. Fails while reporting is off. | Yes |
| `obelisk usage report --if-due` | The same, at most once a day; does nothing while reporting is off. For schedulers. | Yes |
| `obelisk usage disable` | Turns reporting off. Totals already reported stay on chain. | No |

Each command prints one JSON object; `next` says what to do next. Errors use
the `{ "error": ... }` envelope and exit with code 1.

## "Turn on usage reporting" (开启上报)

1. Run `obelisk usage enable`. If it returns `status: "already_enabled"`, say so
   and offer `obelisk usage report`.
2. Show the user, in a few lines:
   - which Skills would be reported (`versions`: name, Skill id and version,
     invocations, and `willAdd`),
   - `sends` and `neverSent` in plain words,
   - that the reports are public under their wallet address (`public`),
   - that the service pays the fee.
   Ask the user to confirm.
3. Only after they confirm, run `obelisk usage enable --confirm`. Report each
   entry of `reports` (Skill, added invocations) and the `explorer` links where
   they can be checked.

Do not add `--confirm` on your own. A confirmation the user gave earlier does
not carry over to a new preview.

## Other requests

- "上报一下" / "report my usage now": run `obelisk usage report` and report the
  result. `status: "nothing_new"` means every version is already up to date.
- "我上报了什么" / "what did I report": run `obelisk usage status`;
  `alreadyReported` is what is on chain for this wallet.
- "关闭上报": run `obelisk usage disable`. Mention that what was already
  reported stays on chain.

## When things go wrong

- `No Obelisk wallet for …`: reporting needs a wallet. Use the
  `obelisk-wallet` skill to create one first (activation is not needed).
- `Usage reporting is off`: the user has not turned it on. Do not turn it on
  to make a report go through; follow "Turn on usage reporting" instead.
- `status: "partial"` with a `next` hint: some reports were not sent or not
  confirmed yet. Run `obelisk usage report` again a minute later; reports send
  running totals, so nothing is counted twice.
- A report entry with `status: "failed"` and `contract_rejected`: the contract
  refused that version's report and nothing was written for it. Report the
  message.
- Invocations from the last half minute may not be counted yet: the history
  index refreshes at most every 30 seconds. They are included next time.
