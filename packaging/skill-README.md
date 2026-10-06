# Obelisk Skill

Explicit memory infrastructure for coding agents — a queryable SQLite evidence
layer over local Claude Code, Codex, Kimi Code, and Pi session history.

## Install with your agent (recommended)

Paste this into a coding agent with shell access:

```text
Install Obelisk by fetching and following this guide:
curl -fsSL https://raw.githubusercontent.com/tommy0103/obelisk/main/SKILL.md
```

The agent installs and verifies the CLI first, then asks whether this skill
should be installed for the current project or globally.

## Install manually

```bash
npm install --global @obelisk-apps/cli
obelisk install
```

The CLI is the executable runtime. This repository contains only the agent
instructions and progressive-disclosure references.

Then in any Claude Code session:

```
/obelisk <your question>
```

The repository also carries standalone skills that use the same CLI. Pick
them when the installer asks which skills to install:

- `obelisk-distill` (「沉淀 Skill」): distill a Skill draft with a provenance
  card from your own session history, e.g. "把我最近准备求职材料的做法沉淀成一个 Skill".
  In Claude Code you can also start it directly with `/obelisk-distill <request>`.
- `obelisk-wallet`: create and activate your Obelisk wallet (your BOT Chain
  identity), e.g. "帮我创建 Obelisk 钱包".
- `obelisk-share`: privately share part of a session with one wallet, with a
  privacy check before anything leaves your computer, e.g. "把这段 session
  分享给 0x…，只能打开 1 次"; then see whether it was read, or revoke it.
- `obelisk-skill-assets`: mint a Skill from your library on BOT Chain, or fetch
  someone's minted Skill into Claude Code, previewing both first, e.g.
  "用 Obelisk 铸造 Skill 草稿「AI 能力履历」" or "取用 Skill #12".
- `obelisk-usage`: report how often you really used minted Skills, counted
  once per wallet on BOT Chain; off until you turn it on after a preview,
  e.g. "开启上报".

## Source

This repository is **auto-published** from the docs-only skill artifact of
[tommy0103/obelisk](https://github.com/tommy0103/obelisk). Do not open pull
requests here — contribute to the source repo instead.

## License

MIT — see [LICENSE](LICENSE) in this repository. The
[source repository](https://github.com/tommy0103/obelisk) is AGPL-3.0; this
skill documentation artifact is explicitly relicensed under MIT by the copyright
holder.
