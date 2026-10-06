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
obelisk skill scenes                 # the fixed scene list for birthScenes
obelisk skill fingerprint SKILL.md   # version fingerprint of a body
```

`draft.json` carries `name`, `description`, `body` (or `bodyFile`, relative
to the JSON file), `birthScenes` (ids from `obelisk skill scenes`, at most
16), `parent`, and `provenance`
(`[{ sessionId, reason, excerpts?: [{ messageUuid?, text }], pitfalls?: [string], corrections?: [string] }]`). The version
fingerprint is the lowercase hex sha256 of the body without frontmatter,
trimmed, with LF line endings — the same value usage recognition derives from
the text Claude Code loads. Bodies that Claude Code would rewrite on load
(`$ARGUMENTS`, `$0`, `${CLAUDE_*}`, `` !`cmd` ``) are refused.

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

Activation goes through the Obelisk online service (`service/`); set
`OBELISK_SERVICE_URL` to its URL. The CLI signs only for the contract addresses
pinned from `chain/deployments/` (`npm run sync:chain` refreshes them).
