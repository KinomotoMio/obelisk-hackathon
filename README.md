# Obelisk · Context-native first

**AI-Native should be context native first.**

汉客松 S1 & ETH Wuhan 2026 参赛项目。在 [Obelisk](https://github.com/tommy0103/obelisk) 的本地会话检索与显式记忆之上，把真实 AI 工作沉淀为有出处、可复用、可计量、可变现的知识。链上的作者、版本、族谱、使用记录与收入分配，让知识付费从介绍走向证据。

Our entry for ETH Wuhan 2026 builds on Obelisk's local session history and explicit memory. It turns real AI work into reusable knowledge with provenance, measurable usage and on-chain revenue sharing.

## 直接体验 / Try it online

无需安装即可浏览。测试网用于丰富的演示与 Playground 数据，主网提供实际部署与少量业务交易；两网数据独立。

| 入口 / Entry | 链接 / Link | 内容 / What to explore |
| --- | --- | --- |
| 文档与安装 / Docs & setup | [在线文档 / Open docs](https://obelisk-service.kinomotomiovo.workers.dev/docs) | 项目说明与一键复制 Agent 安装 Prompt / Project guide and copyable setup prompts |
| **主网市场 / Mainnet market** | [BOT Chain · Chain ID 677](https://obelisk-service-mainnet.kinomotomiovo.workers.dev/market) | 赛事主网入口，查看已铸造 Skill 与链上记录 / Live competition entry |
| 剧本演示 / Guided demo | [打开演示 / Open demo](https://obelisk-service.kinomotomiovo.workers.dev/preview) | 按角色演示完整流程，包含真实 Skill 市场数据和运行记录；示意步骤与示例金额以页面标注为准 / Role-based walkthrough with live data and labeled illustrative steps |
| 测试网市场 / Testnet market | [BOT Chain · Chain ID 968](https://obelisk-service.kinomotomiovo.workers.dev/market) | 更丰富的使用、场景与衍生记录 / Usage, scenes and derivations |
| Playground | [运行记录与产物 / Runs and outputs](https://obelisk-service.kinomotomiovo.workers.dev/runs) | 模拟角色、真实 AI 执行、测试网交易 / Simulated roles, real AI execution, testnet transactions |
| Obelisk 官网 / Website | [obelisk.antinomie.org](https://obelisk.antinomie.org) | 上游项目介绍与通用安装 / Upstream project and installation |

## 本次参赛做了什么 / What we built

- **有出处的 Skill / Skills with provenance**：从会话中沉淀方法，记录作者、内容指纹、版本与衍生族谱。
- **用真实使用说话 / Evidence of use**：展示调用、钱包、场景及顺利率，保留失败、返工与无法判断的结果。
- **创作者变现 / Creator earnings**：免费或定价发布，购买授权与沿族谱分账；市场关注价值与价格，创作者与平台分别核对收入。
- **可控的上下文分享 / Controlled context sharing**：加密分享、访问限制、打开回执与撤回。

上游提供会话索引、检索与桌面 App 的基础。本仓库是黑客松版本，包含 BOT Chain 合约、在线服务、链上 Skill 与分享流程、收入闭环及 Playground。上游安装包不等同于本次参赛版本。

The upstream project provides the session index, retrieval and desktop foundation. This repository adds the hackathon's BOT Chain integration and demo workflows. Installing the upstream package alone does not install this hackathon build.

## 复制给 Agent，安装参赛版 / Let your agent set it up

将下面的 prompt 复制给有终端访问能力的 coding agent。参赛版可以直接在本机运行，无需创建隔离环境，也不需要我们的部署私钥或云服务凭据。

The hackathon build runs natively on your computer. No separate environment or deployment credentials are required.

**中文 prompt**

```text
帮我在本机安装 Obelisk 黑客松版本：
https://github.com/KinomotoMio/obelisk-hackathon
使用 hackathon 分支，先阅读 README.md 和 AGENTS.md，检查 Node.js 与 npm。
按 README 从源码构建并原生运行 CLI；默认使用测试网和正常的 ~/.obelisk 数据目录。
将本仓库构建出的 Obelisk 与配套 skills 安装到我正在使用的 Agent；不要用上游发行版替代参赛版。
如果已有 Obelisk，先说明命令将指向哪个版本，保留现有数据和可恢复的旧 Skill 文件。
完成后建立本地会话索引，演示一次只读查询，并告诉我如何启动桌面 App。
上传、公开分享或链上交易等我提出时再执行。
```

**English prompt**

```text
Set up the Obelisk hackathon build locally from:
https://github.com/KinomotoMio/obelisk-hackathon
Use the hackathon branch. Read README.md and AGENTS.md, and check Node.js and npm.
Build and run the CLI natively from source as described in the README, using testnet and the normal ~/.obelisk data directory by default.
Install this repository's built Obelisk skill and companion skills for my coding agent. Do not substitute the upstream release for the hackathon build.
If Obelisk is already installed, explain which version the command will use; preserve existing data and recoverable copies of replaced skill files.
Index my local sessions, demonstrate a read-only query, and explain how to launch the desktop app.
Only upload, publish or send on-chain transactions when I request them.
```

### 从源码运行 / Run from source

需要 Node.js 22.13+ 与 npm。以下命令构建本仓库，并将 `obelisk` 命令指向本地构建；若已安装上游 CLI，`npm link` 会改变该命令指向。已有数据保留在 `~/.obelisk`，默认连接测试网。

Requires Node.js 22.13+ and npm. `npm link` points the `obelisk` command at this checkout, replacing an existing CLI command link. Existing data remains in `~/.obelisk`; the default service is testnet.

```sh
git clone --branch hackathon https://github.com/KinomotoMio/obelisk-hackathon.git
cd obelisk-hackathon
npm ci
npm run build:core
npm run build:cli
npm run build:skill
cd packages/cli
npm link
cd ../..
obelisk --help
obelisk --build
```

**Agent skills：** 将 `dist/obelisk-skill/` 安装为 Agent 的 `obelisk` skill，将 `dist/agent-skills/` 下的每个目录作为配套 skill 安装。Claude Code 使用 `~/.claude/skills/`，Codex 使用 `~/.agents/skills/`；也可以安装到你当前项目的同名目录。替换已有同名 skill 前保留副本。这里不要运行通用 `obelisk install`，它会安装上游 Skill，而非本仓库的全部参赛扩展。

**Agent skills:** Install `dist/obelisk-skill/` as `obelisk`, plus each directory under `dist/agent-skills/`, in your agent's skill directory (`~/.claude/skills/` for Claude Code, `~/.agents/skills/` for Codex, or the corresponding project directory). Keep copies before replacing existing skills. The generic `obelisk install` command installs the upstream skill, not all hackathon extensions.

本地钱包密钥存储目前支持 macOS Keychain 与 Linux Secret Service；Windows 原生钱包存储尚未实现。此限制与是否隔离无关。

Local wallet key storage currently supports macOS Keychain and Linux Secret Service; native Windows wallet storage is not implemented yet. This is independent of environment isolation.

**桌面 App / Desktop app:** 从本仓库启动，使用相同的本机数据与测试网服务 / Launch this checkout's app with the same local data and testnet service:

```sh
cd app
npm ci
npm run dev
```

## 团队 / Team

| 成员 / Member | 学校 / University | 本次分工 / Role |
| --- | --- | --- |
| [KinomotoMio](https://github.com/KinomotoMio) | 华中科技大学 / Huazhong University of Science and Technology | 团队发起人 · 创意与工程 / Team Lead · Concept & Engineering |
| [z652011350](https://github.com/z652011350) | 中国科学院大学 / University of Chinese Academy of Sciences | 体验与价值验证 / Experience & Value Validation：通过测试与体验，确认 AI 产出兑现预期价值 |
| [Gazerrr03](https://github.com/Gazerrr03) | 深圳大学 / Shenzhen University | 视觉设计负责人 / Visual Design Lead |
| Shen Tuo | — | Hackathon / Vibe Coding 新锐 / Hackathon & Vibe Coding Newcomer |
| [Yuu](https://github.com/tommy0103) | 上游开源项目 / Upstream open-source project | Obelisk 创始人 / Obelisk Founder |

上游 Obelisk 由 **[Yuu](https://github.com/tommy0103) 创立，与 KinomotoMio 共同维护 / founded by Yuu, co-maintained with KinomotoMio**。上游维护身份与本次参赛团队分工分别表述。

- 参赛仓库 / Hackathon repository: [KinomotoMio/obelisk-hackathon](https://github.com/KinomotoMio/obelisk-hackathon)
- 上游仓库 / Upstream repository: [tommy0103/obelisk](https://github.com/tommy0103/obelisk)
- 合约部署记录 / Contract deployments: [Mainnet 677](chain/deployments/677.json) · [Testnet 968](chain/deployments/968.json)
- 许可证 / License: [AGPL-3.0](LICENSE)，沿用上游许可证 / inherited from upstream

<details>
<summary>上游功能与开发参考 / Upstream features and development reference</summary>

以下保留上游通用介绍。安装参赛版本请使用上方源码安装指引；这里的通用 npm 安装指向上游发行版。

<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset=".github/assets/obelisk-wordmark-d.svg">
  <img src=".github/assets/obelisk-wordmark-l2.svg" alt="Obelisk" width="540">
</picture>

[![stars](https://img.shields.io/github/stars/tommy0103/obelisk?style=flat-square)](https://github.com/tommy0103/obelisk/stargazers)
[![version](https://img.shields.io/github/v/tag/tommy0103/obelisk?label=version&style=flat-square)](https://github.com/tommy0103/obelisk/releases)
[![license](https://img.shields.io/badge/license-AGPL--3.0-blue.svg?style=flat-square)](LICENSE)

Past Claude Code, Codex, DeepSeek Harness, Kimi Code, OMP, and Pi sessions -- queryable by your agent, browsable by you.

</div>

<br />

## Two sides of the same index

Obelisk has two sides that share one SQLite index:

**Agent side** — the `obelisk` CLI owns the local runtime, while a separate
agent skill teaches coding agents how to search and query their session history.
The agent writes JS queries, runs them locally, and answers in plain language.

**App side** — an Electron desktop app for humans to browse sessions, manage memories, view usage stats, and see weekly recap cards.

Both read from the same `~/.obelisk/obelisk.sqlite` database (see [Data directory](#data-directory) to move it). The indexer reads Claude Code transcripts from `~/.claude/projects`, Codex transcripts from `~/.codex/sessions` and `~/.codex/archived_sessions`, DeepSeek Harness sessions from `~/.dsh/sessions` (or `$DSH_HOME/sessions`), Kimi Code sessions from `~/.kimi-code/sessions` (or `$KIMI_CODE_HOME/sessions`), OMP sessions from `~/.omp/agent/sessions`, and Pi sessions from `~/.pi/agent/sessions`.

## Data directory

Obelisk keeps its own state — `obelisk.sqlite`, `writer.lock.sqlite`,
`settings.json`, and `recap/` — in `~/.obelisk`. Set `OBELISK_HOME` to an
absolute path (a leading `~` is expanded) to use a different directory; the CLI
and the app both honor it, so two processes with different `OBELISK_HOME`
values never share an index, settings, or memories. A custom `OBELISK_HOME`
never copies the legacy `~/.claude/obelisk.sqlite` forward, and a relative
value is rejected. Provider transcript roots are not affected; point them at
other directories through that data directory's `settings.json`
(`providerRoots`) or **Settings**.

```bash
OBELISK_HOME=~/obelisk-roles/alice obelisk --build
OBELISK_HOME=~/obelisk-roles/alice npm run dev   # from app/
```

## Multi-provider support

Obelisk indexes every provider into the same SQLite schema instead of keeping separate databases. Rows carry a `source` value, and non-Claude IDs are provider-prefixed so they cannot collide.

Codex root threads become normal Obelisk sessions. Codex child threads are attached through the same `subagents` table when parent-thread metadata is available. Codex does not emit Claude-style workflow metadata, so workflow tables may be empty for Codex-only history.

Kimi session directories become one Obelisk session each. Main and child-agent
`wire.jsonl` streams are projected into the same messages, tools, summaries and
subagents tables. Undo/clear is handled as a full session replay, so retracted
wire records do not remain in the index.

OMP's Pi-compatible JSONL v3 sessions use a dedicated adapter and `source='omp'` identity. The adapter consumes OMP's mutable title prelude as session metadata while preserving the underlying tree, messages, tools, usage, visibility, and raw evidence semantics. OMP and Pi roots are independent, so both histories can be indexed at the same time.

Pi JSONL v1-v3 sessions are projected through the same provider contract. Pi's tree, branch summaries, compactions, durable leaf, retained checkpoint tail, custom messages, bash records, tool calls, token usage, and raw JSONL evidence stay inside the adapter; no Pi-specific database or renderer branch is needed. Active visibility follows Pi's own context rules: a retained tail replaces pre-compaction ancestors even when those physical entries still exist and bounds any later legacy compaction, while a legacy-only chain retains ancestors beginning at `firstKeptEntryId`. Missing parents form orphan branch roots, matching Pi's recovery behavior. Pi entries that the source explicitly superseded are stored as `inactive`: the app and normal agent queries omit them, while supported query helpers can include them with `includeInactive: true`. Display-suppressed or transport-only records remain `hidden` and are never returned by those helpers.

| Provider | Superseded-history support |
| --- | --- |
| Pi | Branch, leaf, and compaction state attests inactive history |
| OMP | Branch, leaf, and compaction state attests inactive history |
| Kimi Code | Undo/clear can attest supersession; preservation is a follow-up |
| Claude Code | The source does not attest rewind or current-leaf state |
| Codex | Sessions have no branching semantics |

Because Pi and OMP explicit session IDs are project-local, Obelisk combines each provider's header ID with a deterministic hash of the normalized header `cwd`; this keeps identities stable across file moves while allowing two projects to use the same custom ID. Replacement and deletion replay is provenance-aware, so stale session snapshots are retracted atomically; compaction and branch-summary model usage is included in usage totals.

For live app refresh, Obelisk watches the roots declared by every registered provider, including `~/.claude/projects`, `~/.codex/sessions`, `~/.codex/archived_sessions`, `~/.kimi-code/sessions`, `~/.omp/agent/sessions`, and `~/.pi/agent/sessions`. Codex's `session_index.jsonl` is used as lightweight title/update metadata during indexing, not as the message transcript source.

Pi chooses its session directory in this order: `--session-dir`, `PI_CODING_AGENT_SESSION_DIR`, `sessionDir` in settings, then the default under `~/.pi/agent/sessions`. Obelisk automatically follows absolute or `~`-prefixed environment/global settings and the project setting for Obelisk's launch cwd; a relative project setting is resolved against that cwd. CLI-only roots, relative environment/global settings, and project settings from another launch cwd cannot be inferred safely, so select the resolved directory in Obelisk **Settings** instead of letting Obelisk guess.

OMP uses `~/.omp/agent/sessions` by default. Select another absolute session directory in Obelisk **Settings** when OMP is configured with a custom root.

## Skill: agent-first retrieval

<div align="center">
  <img src=".github/assets/demo.png" alt="Obelisk App" width="720">
</div>

You can use obelisk like:

```
/obelisk 上次 auth bug 最后到底改了哪些文件，为什么这么改
/obelisk 这个文件最近在哪些 sessions 里被反复修改
/obelisk 找出最近失败的 tool calls，它们分别发生在哪些任务里
/obelisk 那个 review workflow 的 subagents 各自结论是什么
/obelisk recap this week
```

### Install

#### Let your agent install it (recommended)

The shortest path is to give the bootstrap guide directly to a coding agent
with shell access. Paste this as a prompt into Claude Code, Codex, or another
agent — not into your terminal:

```text
Install Obelisk by fetching and following this guide:
curl -fsSL https://raw.githubusercontent.com/tommy0103/obelisk/main/SKILL.md
```

The agent will ask before changing your machine, install and verify the CLI,
then ask whether the formal `/obelisk` skill should be installed for the current
project or globally. The bootstrap guide is only for one-time setup; it is not
the query skill itself.

#### Install manually

Obelisk requires Node.js 22.13 or newer. Install the platform-neutral CLI:

```bash
npm install --global @obelisk-apps/cli
obelisk --version
```

On macOS, Linux, or WSL, the CLI-only installer is equivalent:

```bash
curl -fsSL https://raw.githubusercontent.com/tommy0103/obelisk/main/install.sh | sh
```

Then install the agent skill:

```bash
obelisk install
```

`obelisk install` delegates to the standard skills installer for
`tommy0103/obelisk-skill`.

Then in any Claude Code session:

```
/obelisk <your question>
```

First run builds the index (~5 seconds for 100 sessions). After that it rebuilds incrementally.

### How it works

```
You ask a question
  ↓
Agent writes a JS query against the SQLite index
  ↓
Runs it via obelisk --query <script>
  ↓
Reads the JSON result, answers in natural language
```

Core API: `search()`, `context()`, `sql()`, plus structured helpers (`sessions`, `memories`, `summaries`, `workflows`, `failures`, `fileHistory`, etc).

### Memory layer

When a retrieval produces a conclusion worth keeping, the agent proposes a markdown memory file. After user approval, it registers the file with `obelisk --attune <script>`. Memories are recalled via `memories()` in future sessions — a synthesis cache, not a replacement for raw evidence.

## App: A surface for humans

A companion desktop app for browsing the same index maintained by the CLI or
the app daemon.

<div align="center">
  <img src=".github/assets/app-screenshot.png" alt="Obelisk App" width="720">
</div>

- **Sessions** — browse all sessions with search, project filtering, readable tool calls (diffs, terminal output, file viewers)
- **Memory** — list and detail views for registered memory files
- **Activity** — GitHub-style heatmap, weekly/cumulative token charts
- **Recap** — shareable weekly/monthly recap cards with archetype theming
- **Settings** — data source configuration, auto-refresh, rebuild index

Prebuilt releases are currently available for macOS from
[Releases](https://github.com/tommy0103/obelisk/releases). The source app can be
run locally on macOS, Windows, and Linux.

### Run locally

Install [Node.js 22](https://nodejs.org/) and npm, then run the app from its own
package directory:

```bash
git clone https://github.com/tommy0103/obelisk.git
cd obelisk/app
npm ci
npm run dev
```

`electron-vite` starts the renderer dev server and launches Electron. On first run, Obelisk creates `~/.obelisk/obelisk.sqlite`, indexes the available registered-provider transcripts, and then watches them for changes. The default sources include `~/.claude/projects`, `~/.codex/sessions`, `~/.codex/archived_sessions`, `~/.kimi-code/sessions`, `~/.omp/agent/sessions`, and `~/.pi/agent/sessions`; use **Settings** to point the app at different directories. On Windows, Obelisk also checks common WSL distributions for the Claude Code directory.

### Debug the app

- Renderer changes use Vite hot module replacement. Open Electron DevTools with
  `Cmd+Option+I` on macOS or `Ctrl+Shift+I` on Windows/Linux.
- Main-process and preload logs appear in the terminal running `npm run dev`;
  their source changes are rebuilt by electron-vite.
- To attach a Node debugger to the Electron main process, start it with
  `npm run dev -- --inspect=5858`, then attach your debugger to port `5858`.
- The development app reads and updates the real `~/.obelisk` index. Back it up
  before testing destructive rebuilds, or set `OBELISK_HOME` to a disposable
  directory. For a fully isolated run, launch with a
  disposable home directory (`HOME=/tmp/obelisk-dev npm run dev` on
  macOS/Linux, or set a temporary `USERPROFILE` first on Windows), then select
  fixture source directories in **Settings**.

`better-sqlite3` provides prebuilt binaries for common platforms. If `npm ci`
falls back to compiling it locally, install the platform's C/C++ build tools and
run `npm ci` again.

### Capture a page headlessly

The built App can render one page of a data directory to a PNG and exit,
without a window on screen, an indexer, or a watcher. The Playground runner
uses it for a run's key screenshots.

```bash
cd app && npx electron-vite build          # once per checkout
OBELISK_HOME=<role data dir> npm run capture -- \
  --route '#/share' --out <file>.png \
  [--wait-for '<css selector>'] [--scroll-to '<css selector>'] \
  [--width 1440] [--height 900] [--scale 2] [--timeout 20000]
```

- `--route` is any App route (`#/share`, `#/skills/minted/12`,
  `#/playground/runs/<run id>`). The page reads that `OBELISK_HOME` as it is;
  index it first (`obelisk --build`) if it should show new sessions.
- The capture waits until the page has rendered its data: the App stayed on
  the route, every call the page made to the main process has returned, and
  the page has not changed for 500 ms. `--wait-for` adds a selector that must
  be present, for pages whose content you want to be sure of (for example
  `'.share-table tr[data-state="read"]'` for a read receipt). `--scroll-to`
  scrolls an element to the top before capturing.
- The PNG is `width × scale` by `height × scale` pixels. The App has one
  theme (dark); `--theme dark` is accepted.
- Exit code 0 prints the written path on stdout. 1 means the page did not
  render in time (an unknown route, a `--wait-for` selector that never
  appeared) or the file could not be written, with the reason on stderr;
  nothing is written. 2 means bad arguments.
- Electron needs a display session on macOS and Windows; on Linux without one,
  run it under `xvfb-run`.

## What gets indexed

| Layer | Source | What's captured |
|-------|--------|----------------|
| **Sessions** | Claude `<project>/<sessionId>.jsonl`; Codex `sessions/YYYY/MM/DD/*.jsonl` and `archived_sessions/*.jsonl`; Kimi session directories; Pi recursive `*.jsonl`; DeepSeek Harness `<project>/<sessionId>/session.jsonl[.zstd]` | Title, project, timestamps, git branch, source |
| **Messages** | user + assistant turns | Full text, model, token usage, parent chain |
| **Tool calls** | every tool invocation | Tool name, input, file paths |
| **Subagents** | Claude `subagents/agent-<id>.jsonl`; Codex child threads; DeepSeek Harness child sessions (folded into the root session) | Agent type, description, full conversation |
| **Workflows** | Claude `workflows/wf_<runId>.json` | Script, result, agent count |
| **Workflow agents** | Claude `subagents/workflows/wf_<runId>/` | Per-agent transcripts |
| **Memories** | registered markdown files | Conclusions linked to source sessions |

Full-text search via FTS5 covers all layers.

## Structure

```
packages/core/                # @obelisk/core npm workspace (TypeScript + ESM)
├── src/
│   ├── providers/
│   │   ├── types.ts          # Provider + TranscriptRecord contract
│   │   ├── claude.ts         # Claude Code adapter (line-incremental)
│   │   ├── codex.ts          # Codex adapter (full-reparse)
│   │   ├── kimi.ts           # Kimi Code adapter (session projection)
│   │   └── pi.ts             # Pi adapter (tree-aware full-reparse)
│   ├── session-detail.ts     # Provider-independent transcript projection
│   ├── persist.ts            # Binding-agnostic record writer (upsert/merge)
│   ├── tx.ts                 # Write transaction + connection config
│   ├── write-coordinator.ts  # Bounded retry policy
│   ├── writer-lease.ts       # Cross-process single-writer lease (SQLite lock DB)
│   ├── core.ts               # buildIndex / searchText / executeQuery / executeAttune
│   ├── indexer.ts            # Skill orchestration (discover → persist → finalize)
│   ├── parsing.ts            # Pure helpers (node:sqlite-free, app-consumable)
│   ├── db.ts                 # node:sqlite lifecycle + migrations
│   ├── query.ts              # Query/attune sandbox API (helpers)
│   └── schema.sql            # SQLite schema (single source of truth)
├── package.json
└── dist/                     # Generated package JS, declarations, and schema

packages/cli/                 # @obelisk-apps/cli npm workspace
├── src/obelisk.ts            # CLI shell + skill installer delegation
├── scripts/build.mjs         # Compiles CLI + readable Core into one package
├── package.json
└── dist/                     # Generated platform-neutral npm payload

skill-doc/                    # Source for the docs-only obelisk agent skill
├── SKILL.md                  # Query and memory workflow
└── references/               # Progressive-disclosure API/schema/pattern docs
    └── recap/                # Per-card recap retrieval + writing references

agent-skills/                 # Standalone docs-only skills shipped with obelisk
├── obelisk-distill/          # 「沉淀 Skill」: distill a Skill draft from history
└── obelisk-wallet/           # Create and activate the BOT Chain wallet

app/                          # Electron desktop app (electron-vite + Vue)
├── src/main/                 # TypeScript main process (consumes shared core)
├── src/preload/              # CJS preload (sandbox)
├── src/renderer/             # Vue renderer
└── electron.vite.config.ts

packaging/                    # Skill publish infrastructure
├── build-skill.mjs           # Builds the docs-only skill artifact
├── skill-package.json
├── skill-README.md
├── skill-LICENSE             # MIT (relicensed for the skill artifact)
└── publish-skill.sh

SKILL.md                      # Remote one-time CLI + skill bootstrap guide
install.sh                    # POSIX CLI-only installer
CONTEXT.md                    # Project glossary
docs/adr/                     # Architecture decision records (0001–0013)
```

The optional `/obelisk recap` flow is loaded only for explicit `/obelisk recap` intent.
It starts at `skill-doc/references/recap/overview.md` and proceeds card-by-card:

- `skill-doc/references/recap/pattern1-cover.md` + `skill-doc/references/recap/writing1-cover.md`
- `skill-doc/references/recap/pattern2-thinking.md` + `skill-doc/references/recap/writing2-thinking.md`
- `skill-doc/references/recap/pattern3-vibe.md` + `skill-doc/references/recap/writing3-vibe.md`
- `skill-doc/references/recap/pattern4-workflow.md` + `skill-doc/references/recap/writing4-workflow.md`
- `skill-doc/references/recap/pattern5-closing.md` + `skill-doc/references/recap/writing5-closing.md`

### Generated build outputs

- `packages/core/dist/` is produced by `npm run build:core`. It is the compiled
  internal `@obelisk/core` workspace: JavaScript, type declarations, and
  `schema.sql`.
- `packages/cli/dist/` is produced by `npm run build:cli`. It is the publishable
  `@obelisk-apps/cli` payload: the thin command shell, readable compiled Core,
  and `schema.sql`.
- `dist/obelisk-skill/` is produced by `npm run build:skill`. It is the
  docs-only skill artifact: `SKILL.md`, references, and skill package metadata.
- `dist/agent-skills/<name>/` is also produced by `npm run build:skill`: one
  docs-only artifact per standalone skill in `agent-skills/`.
- Skill publishing stages the obelisk artifact at `skills/obelisk/` and each
  standalone skill at `skills/<name>/` in the `obelisk-skill` repository; only
  `README.md` and `LICENSE` remain at the repository root for `npx skills`
  discovery.

Both directories are generated and should not be edited by hand. The Electron
app imports `packages/core/src/` directly so electron-vite can bundle Core.

## Implementation Notes

The index rebuilds incrementally — only new or modified JSONL files are re-parsed.
When the optional app is running, it is the active indexer: it watches Claude
project files and builds in a worker thread. A fresh `__app_heartbeat__` alone
means the daemon owns writes, so CLI invocations remain read-only; a separate SQLite
writer lease prevents cross-process writes from overlapping. The
`__app_last_successful_build__` marker records index freshness, not ownership.

The CLI has zero runtime npm dependencies and uses Node 22's built-in
`node:sqlite` with FTS5. The formal skill contains instructions and references,
not a second executable runtime.

20K lines of scattered JSONL → something the agent can search() and sql() against in milliseconds.

## Contributing

Contributions are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md) before opening
a PR — it is short, and it is written from what actually blocked past PRs rather
than from generic style rules.

The parts worth knowing up front:

- **Run every claim in your PR description end to end.** The most common reason a
  PR stalls here is a capability that is advertised but unreachable — including
  inputs shown in screenshots.
- **Assert the requirement, not the implementation.** Copy the sentence from the
  issue into your test name.
- **Transcript content is attacker-controlled.** Obelisk indexes third-party
  agent logs; anything reaching `shell.*`, `fs.*`, `innerHTML`, or DDL is
  deny-by-default.
- **Re-run verification after merging main.** A merge voids every result above
  it, including your own noted limitations.

`CONTRIBUTING.md` also carries hard constraints per area — renderer/Electron,
provider adapters, schema migrations, main process, and indexing/daemon
ownership. The PR template mirrors them as per-area checklists.

---

## Star History

<a href="https://www.star-history.com/?repos=tommy0103%2Fobelisk&type=date&legend=top-left">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/chart?repos=tommy0103/obelisk&type=date&theme=dark&legend=top-left&sealed_token=zGsTpxirzDypxpaSUQ4aiPpCQFVFbII1Xl68UlRRpVdaTr6NoPY_cEvprnA9kMMdmXnERYZn3uXo20PkKEiuoGQ8d-qD3nPDanawRUrZuFYnNPytlC2iTw" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/chart?repos=tommy0103/obelisk&type=date&legend=top-left&sealed_token=zGsTpxirzDypxpaSUQ4aiPpCQFVFbII1Xl68UlRRpVdaTr6NoPY_cEvprnA9kMMdmXnERYZn3uXo20PkKEiuoGQ8d-qD3nPDanawRUrZuFYnNPytlC2iTw" />
   <img alt="Star History Chart" src="https://api.star-history.com/chart?repos=tommy0103/obelisk&type=date&legend=top-left&sealed_token=zGsTpxirzDypxpaSUQ4aiPpCQFVFbII1Xl68UlRRpVdaTr6NoPY_cEvprnA9kMMdmXnERYZn3uXo20PkKEiuoGQ8d-qD3nPDanawRUrZuFYnNPytlC2iTw" />
 </picture>
</a>

## License

Copyright (C) 2026 tommy0103 and contributors.

Obelisk is licensed under the GNU Affero General Public License v3.0 (AGPL-3.0-only); see [LICENSE](LICENSE). Derivative works are welcome: if you distribute a modified version, please keep the per-file copyright notices intact and mark your modifications prominently with a date, as AGPL-3.0 §5 requires.

</details>
