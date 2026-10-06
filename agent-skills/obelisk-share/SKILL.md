---
name: obelisk-share
description: >
  Privately share part of a past Claude Code or Codex session with one wallet address, using the
  `obelisk share` CLI: privacy check, redaction, encryption, and the share rules on BOT Chain. Use
  when the user says "分享 session", "把这段 session 分享给 0x…", "用 Obelisk 分享 session「…」第 12–48 条给
  0x…", "只能打开 1 次", "share this session with 0x…", or pastes a share prompt copied from the
  Obelisk App. Never paste session content into the conversation, never print or look up the values
  the privacy check finds, and never send without the user's confirmation.
allowed-tools:
  - Bash(obelisk:*)
  - Write
---

# Obelisk private sharing

A share sends a range of messages from one session to one wallet address. Only
that wallet can open it, on a web page, and only within the rules: how many
times it can be opened and until when. The content is redacted and encrypted on
this computer; the Obelisk online service stores only ciphertext, and the rules
are recorded on BOT Chain, where anyone can check them. The reader page always
shows a watermark with the recipient's address, so the user does not need to
ask for one.

## Commands

| Command | What it does | Sends anything |
| --- | --- | --- |
| `obelisk share outline <session-id>` | Numbered messages with short excerpts, sensitive values already masked. Use it to pick a range. | No |
| `obelisk share draft <session-id> --to <0x address> [--messages <from>-<to>] [--opens <n>\|unlimited] [--expires <n>m\|h\|d]` | Takes a snapshot of the range, runs the privacy check, and saves a draft. Defaults: all messages, 1 open, 24h. | No |
| `obelisk share send <draft-id> --redact all\|none\|<n>,<n>` | **Preview only.** Records the redaction choice and shows recipient, rules, and redactions. | No |
| `obelisk share send <draft-id> --confirm` | Sends exactly what the last preview showed: redacts, encrypts for the recipient, uploads, and writes the share on chain. Returns the link. | Yes |

Each command prints one JSON object; `next` says what to do next. Errors use the
`{ "error": ... }` envelope and exit with code 1. Message numbers are the
positions in the session detail as the Obelisk App shows it, so a range copied
from the App means the same messages here.

## "Share this session with 0x…" (分享给 0x…)

1. **Find the session id.** If the request contains one, use it (a unique
   prefix of 8+ characters works). If it names the session by title, look it up
   by writing a query file at a unique temporary path and running
   `obelisk --query <file>`:

   ```js
   return sql("SELECT id, title, source, started_at FROM sessions WHERE title LIKE ? ORDER BY started_at DESC LIMIT 5", '%payment callback%');
   ```

   For "this session" (the current conversation), return
   `overview({ limit: 1 }).current.session_id` from a query file instead. If
   more than one session matches, ask the user which one.
2. **Pick the range.** Use the message numbers the user gave. If they described
   the part in words ("the part where we fixed the callback"), run
   `obelisk share outline <session-id>` and propose a range; confirm it with the
   user if it is not obvious.
3. **Draft.** Run `obelisk share draft <session-id> --to <address> --messages
   <from>-<to> --opens <n> --expires <duration>` with the user's rules ("只能打开
   1 次" is `--opens 1`, "24 小时内有效" is `--expires 24h`, "不限次数" is
   `--opens unlimited`).
4. **Privacy check.** Show the findings as a short numbered list: the label and
   `where` of each, nothing else. Ask whether to redact all of them ("全部打码")
   or which ones. Recommend redacting all.
5. **Preview.** Run `obelisk share send <draft-id> --redact all` (or
   `--redact 1,3` for only those, or `--redact none`). Show the user: the
   recipient and whether they are activated, the rules, how many findings are
   redacted, and that the service pays the fee. Ask them to confirm.
6. **Send.** Only after they confirm, run `obelisk share send <draft-id>
   --confirm`. Give the user the `link`, and say that only the recipient's
   wallet can open it, how many times, and until when. Mention the `explorer`
   link where the share record can be checked.

Do not add `--confirm` on your own. A confirmation the user gave earlier does
not carry over to a new preview. If the user changes the redaction choice after
the preview, preview again before confirming.

## Never expose the values

- Report privacy findings only by label and location, as the CLI prints them.
- Do not open, quote, `grep`, or summarize the flagged messages to find out what
  a value is, and do not read files under `<data dir>/shares/`. If the user
  wants to see a value, they can look at that message in the Obelisk App.
- Do not paste session content into the conversation to "check" the redaction;
  the preview's redaction summary is the check.

## When things go wrong

- `recipient.activated: false`, or `… has not activated an Obelisk wallet yet`:
  nothing can be encrypted to that address until its owner activates their
  wallet (`obelisk wallet activate`, or "帮我创建 Obelisk 钱包" in their own AI
  coding assistant). Tell the user; do not send.
- `No Obelisk wallet for …`: the user has no wallet yet; use the
  `obelisk-wallet` skill to create one first (sharing does not need it to be
  activated).
- `status: "submitted"`: the share was sent to the chain but not confirmed yet.
  Run the same `obelisk share send <draft-id> --confirm` again a minute later;
  it finishes the same share and never creates a second one.
- `status: "already_shared"`: this draft was sent before; the output has its
  link.
- `The share was not created: …`: nothing was written on chain. If the message
  says to run the command again (another action used the same signature
  nonce, or the recipient changed their key), do so; otherwise report it.
- `Message range … is outside this session` or `… more than one share can
  hold`: pick a valid or narrower range.
- `… refusing to sign for it`: the online service reported contract addresses
  that do not match the known deployment. Stop and report it.
