# Obelisk CLI

The local Obelisk runtime used by coding agents. It indexes Claude Code, Codex,
Kimi Code, and Pi transcripts into `~/.obelisk/obelisk.sqlite` and exposes the
stable `build`, `search`, `query`, and `attune` process interface. Set
`OBELISK_HOME` to an absolute path to keep the index and settings somewhere
other than `~/.obelisk`.

```bash
npm install --global @obelisk-apps/cli
obelisk --version
obelisk install
obelisk --query /tmp/query.mjs
```

`obelisk install` installs the separate docs-only agent skill from
`tommy0103/obelisk-skill`. The CLI itself remains daemon-free: each command
refreshes the local index when write ownership is available, then exits.

## Local Skill library

`obelisk skill` manages Skills kept under `<data dir>/skills/<name>/`
(`skill.json`, `draft/SKILL.md`, `versions/<fingerprint>/SKILL.md`):

```bash
obelisk skill save draft.json        # create or replace a draft
obelisk skill list                   # newest first
obelisk skill show <name>            # draft, provenance, versions
obelisk skill scenes                 # the scene vocabulary for birthScenes
obelisk skill tag <name> --add <tag> --remove <tag>   # edit a Skill's birth scenes
obelisk skill invocations [<name>]   # Skill loads found in history, by version
obelisk skill fingerprint SKILL.md   # version fingerprint of a body
```

`draft.json` carries `name`, `description`, `body` (or `bodyFile`, relative
to the JSON file), `birthScenes` (at most 16 tags: `v1:<dimension>/<slug>`
from `obelisk skill scenes`, or `user:<dimension>/<label>` when nothing fits;
each at most 64 bytes), `parent`, and `provenance`
(`[{ sessionId, reason, excerpts?: [{ messageUuid?, text }], pitfalls?: [string], corrections?: [string] }]`). The version
fingerprint is the lowercase hex sha256 of the body without frontmatter,
trimmed, with LF line endings — the same value usage recognition derives from
the text Claude Code loads. Bodies that Claude Code would rewrite on load
(`$ARGUMENTS`, `$0`, `${CLAUDE_*}`, `` !`cmd` ``) are refused.

`obelisk skill invocations` refreshes the index like `--query`, finds every
Skill load Claude Code and Codex recorded, fingerprints the loaded text with the
same rule, and maps it to library versions: `library` lists invoked versions
(`minted`, `draft`, or `fetched`) with invocation and session counts, `other` lists loaded
Skills that are not in the library, and `unresolved` lists loads whose full
text could no longer be read (the index keeps 10,000 characters; longer loads
are re-read from the transcript). With a name it prints that Skill's versions,
including ones never invoked, and every load.

## Wallet

`obelisk wallet` manages the data directory's BOT Chain wallet (#4). The private
key is kept in the system keychain (macOS Keychain or the Linux Secret Service,
service `obelisk-wallet`, account = the absolute data directory), so every
`OBELISK_HOME` has its own wallet. It is never printed.

```bash
obelisk wallet create              # new wallet, or report the existing one
obelisk wallet show                # address and activation status
obelisk wallet activate            # preview registering the encryption key
obelisk wallet activate --confirm  # sign it; the online service submits and pays
```

Activation goes through the Obelisk online service (`service/`). The CLI uses
the deployed service by default; set `OBELISK_SERVICE_URL` to point it at
another one, such as `http://127.0.0.1:8787` under `wrangler dev`. The CLI signs only for the contract addresses
pinned from `chain/deployments/` (`npm run sync:chain` refreshes them).

## Private sharing

`obelisk share` shares a range of one session with one wallet (#8). Content is
redacted and encrypted on this computer; the online service stores only
ciphertext and records the rules (who, how many opens, until when) on BOT Chain.

```bash
obelisk share outline <session-id>                  # numbered messages, sensitive values masked
obelisk share draft <session-id> --to 0x… \
  [--messages 12-48] [--opens 1|unlimited] [--expires 24h]   # privacy check: types and locations only
obelisk share send <draft-id> --redact all          # preview (or --redact 1,3 / --redact none)
obelisk share send <draft-id> --confirm             # encrypt, upload, write the share on chain
```

Message numbers are positions in the session detail as the App shows it. The
recipient must have activated their wallet. Drafts and sent-share records live
in `<data dir>/shares/`; once a share is sent, only its redacted copy is kept.
