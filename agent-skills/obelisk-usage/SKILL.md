---
name: obelisk-usage
description: >
  Turn on, check, send, or turn off Obelisk's Skill usage reporting, and judge the scenes and
  outcomes of Skill invocations, with the `obelisk usage` CLI: how often the user really invoked
  minted Skills, where, and how it went, counted once per wallet on BOT Chain. Use when the user
  says "开启上报", "开启使用量上报", "上报 Skill 使用情况", "关闭上报", "我上报了什么", "判断 Skill
  调用的结果", "统计顺利率", "turn on usage reporting", "judge my Skill invocations", or pastes a
  reporting prompt copied from the Obelisk App. Never turn reporting on or run the judge without
  showing the preview and getting the user's confirmation.
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
| `obelisk usage judge [--harness codex\|claude] [--limit <n>]` | **Preview only.** How many invocations would be judged, in how many runs of the local harness, and what each run reads. | No |
| `obelisk usage judge --confirm` | Runs the judge on the user's own Codex or Claude Code and stores scenes and outcomes locally. | No (local only) |

Each command prints one JSON object; `next` says what to do next. Errors use
the `{ "error": ... }` envelope and exit with code 1.

## "Turn on usage reporting" (开启上报)

1. Run `obelisk usage enable`. If it returns `status: "already_enabled"`, say so
   and offer `obelisk usage report`.
2. Show the user, in a few lines:
   - which Skills would be reported (`versions`: name, Skill id and version,
     invocations, and `willAdd`; if `transactions` is more than 1, that the
     per-scene results go out as that many reports),
   - `sends` and `neverSent` in plain words,
   - that the reports are public under their wallet address (`public`),
   - that the service pays the fee.
   Ask the user to confirm.
3. Only after they confirm, run `obelisk usage enable --confirm`. Report each
   entry of `reports` (Skill, added invocations) and the `explorer` links where
   they can be checked.

Do not add `--confirm` on your own. A confirmation the user gave earlier does
not carry over to a new preview.

## "Judge how my Skill invocations went" (判断 Skill 调用的结果)

Reports always carry fact signals, counted by rule: a tool error after the
Skill load, the person correcting or interrupting, one file edited three or
more times, the same Skill loaded again. Scenes and outcomes (顺利 / 有返工 /
失败 / 无法判断) need a judgment by the user's own AI coding assistant:

1. Run `obelisk usage judge`. If it returns `nothing_to_judge`, say so.
2. Show the user: how many invocations and which Skills, how many runs of
   which harness (`codex` or `claude`), that each run reads the part of the
   session after the Skill load (`reads`), that it uses their own
   subscription (`cost`), and that the text and reasons stay on this computer
   (`stays`). Ask them to confirm.
3. Only after they confirm, run the command from `next`. Report how many were
   judged and the outcomes; if `status` is `partial`, say what stopped it
   (`error`) and that running the same command continues.

Do not judge inside this conversation instead of running the command, and do
not read the sessions yourself to judge them: the command sends each slice
only to the harness, in a run that saves no session.

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
