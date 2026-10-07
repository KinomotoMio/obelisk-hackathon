# 赛前已有与比赛期间新增

> 对应 [KinomotoMio/obelisk-hackathon#37](https://github.com/KinomotoMio/obelisk-hackathon/issues/37)。选手手册第 1 节要求：已有项目可以参赛，但要说明并展示比赛期间新增的内容，清楚区分赛前已有部分和本次新增功能，并注明沿用的代码、素材和第三方组件的来源。
>
> 下面的数字和日期都取自 git 历史，可以用文末的命令复核。提交前请把「撰写时」的提交换成最终提交，并重跑一遍命令。

## 一句话

Obelisk 赛前是一个本地的 AI 编程会话记忆工具：把 Claude Code、Codex 等工具的 session 索引进本机数据库，供 AI 检索，并配有桌面 App。比赛期间我们没有改动这部分，而是在它之上新增了「出口」：私密分享、Skill 资产化、真实使用统计、AI 能力履历。为此新写了 BOT Chain 合约、在线服务、网页阅读页、公开网页和 Playground。

## 分界点与提交范围

| | 提交 | 时间（北京时间） | 说明 |
| --- | --- | --- | --- |
| 分界点（赛前最后一个提交） | [`b5a7696`](https://github.com/KinomotoMio/obelisk-hackathon/commit/b5a76965480ee2acd54153fc4600599d6b55937c) | 2026-09-18 22:36 | `hackathon` 分支与上游 `main`（[tommy0103/obelisk](https://github.com/tommy0103/obelisk)）的共同祖先 |
| 比赛期间第一个提交 | [`7e06e68`](https://github.com/KinomotoMio/obelisk-hackathon/commit/7e06e68) | 2026-10-07 01:17 | 开发计时从 2026-10-06 20:00 开始 |
| 撰写时的最后一个提交 | [`ab16eb4`](https://github.com/KinomotoMio/obelisk-hackathon/commit/ab16eb4) | 2026-10-07 16:20 | 提交前更新 |

- **赛前已有**：分界点及之前的 189 个提交，最早一个在 2026-05-30。
- **比赛期间新增**：`b5a7696..hackathon` 共 208 个提交（撰写时），没有合并提交，每个提交都在 2026-10-07 01:17 之后。
- 变更规模：279 个文件，新增约 45,500 行，删除 117 行，不含 `package-lock.json`。其中 240 个是新文件，改动的原有文件 39 个。删除这么少，是因为新功能几乎都写在新文件里，原有代码只在接入点改了几处，见下表。
- 上游 `main` 在分界点之后另有 22 个提交，是上游维护者做的索引性能等工作，**不在** `hackathon` 分支上，也不属于本次提交。

## 按领域区分

| 领域 | 赛前已有 | 比赛期间新增 | 依据 |
| --- | --- | --- | --- |
| Session 索引与检索 | Claude Code、Codex、DeepSeek Harness、Kimi Code、OMP、Pi 的 session 索引进同一个本地 SQLite 数据库；AI 通过 CLI（`obelisk --search`、`--query`）和 `obelisk` skill 检索 | 索引本身没有改动，作为所有新功能的数据来源。只在接入点做了小改动：可以指定数据目录、按时间段汇总历史（给履历用）、读取分享片段 | [#30](https://github.com/KinomotoMio/obelisk-hackathon/issues/30)、[#28](https://github.com/KinomotoMio/obelisk-hackathon/issues/28)；`packages/core/src/core.ts`、`db.ts` 的修改 |
| 记忆 | 人工确认的 markdown 记忆，可以撤销 | 无 | — |
| Skill 调用记录 | 索引已记录每次调用的 skill 名称和当时加载的全文 | 按内容指纹对应到已铸造的版本；读出调用之后发生了什么，统计事实信号；由本机的 AI 编程助手（Codex 优先，也可用 Claude Code）判断场景和结果，并算出每个场景各自的顺利率；签名后汇总上报 | [#22](https://github.com/KinomotoMio/obelisk-hackathon/issues/22)、[#23](https://github.com/KinomotoMio/obelisk-hackathon/issues/23)、[#25](https://github.com/KinomotoMio/obelisk-hackathon/issues/25) |
| 链上合约 | 无 | `chain/`：KeyRegistry（加密公钥登记）、ShareRegistry（分享规则、打开回执、撤回）、SkillRegistry（Skill 资产、版本、族谱）、UsageStats（按版本、按钱包去重的使用统计）。全部操作由用户签名、服务代付；已部署到 BOT Chain 测试网，并在浏览器上验证了源代码；主网的部署和验证脚本已就绪 | [#2](https://github.com/KinomotoMio/obelisk-hackathon/issues/2)、[#5](https://github.com/KinomotoMio/obelisk-hackathon/issues/5)；`74e4e21`…`aab0b3e`、`6e21237`…`da46ef2` |
| 在线服务 | 无 | `service/`：Cloudflare Worker，负责代付上链、存放分享密文和已铸造的 Skill 正文、按链上规则放行钥匙包、读取链上统计（含每个场景的结果）、列出已铸造的 Skill、批量核对交易是否上链 | [#3](https://github.com/KinomotoMio/obelisk-hackathon/issues/3)、[#9](https://github.com/KinomotoMio/obelisk-hackathon/issues/9)、[#16](https://github.com/KinomotoMio/obelisk-hackathon/issues/16)、[#24](https://github.com/KinomotoMio/obelisk-hackathon/issues/24)、[#25](https://github.com/KinomotoMio/obelisk-hackathon/issues/25)、[#32](https://github.com/KinomotoMio/obelisk-hackathon/issues/32)、[#35](https://github.com/KinomotoMio/obelisk-hackathon/issues/35) |
| 网页阅读页 | 无 | `service/public/reader/`：用浏览器钱包打开分享，在页面里解密，整页水印；不是指定的人会看到拒绝页 | [#10](https://github.com/KinomotoMio/obelisk-hackathon/issues/10) |
| 公开网页 | 无 | 由在线服务直接提供，不需要 App：`/market` Skill 市场，展示链上真实的调用量、钱包数、实测场景与各场景的顺利率、族谱、版本；`/market/stage-2` 标明「阶段 2 预览」的上架、分成、收入、上下文付费；`/preview` 项目预览，按角色逐步播放演示闭环，目前是示意内容；`/runs` Playground 运行记录（还没有部署）；`service/public/site/` 是共用的顶栏、样式和标志 | [#35](https://github.com/KinomotoMio/obelisk-hackathon/issues/35)、[#33](https://github.com/KinomotoMio/obelisk-hackathon/issues/33)、[#32](https://github.com/KinomotoMio/obelisk-hackathon/issues/32) |
| CLI | `obelisk` 命令：建索引、检索、查询、安装 skill | 新增 `wallet`、`share`、`skill`（保存、铸造、取用、场景标签、调用识别）、`usage`（判断、上报）、`resume`（履历统计与页面）子命令；会改动数据或上链的命令都先预览再确认 | [#4](https://github.com/KinomotoMio/obelisk-hackathon/issues/4)、[#8](https://github.com/KinomotoMio/obelisk-hackathon/issues/8)、[#11](https://github.com/KinomotoMio/obelisk-hackathon/issues/11)、[#14](https://github.com/KinomotoMio/obelisk-hackathon/issues/14)、[#16](https://github.com/KinomotoMio/obelisk-hackathon/issues/16)、[#17](https://github.com/KinomotoMio/obelisk-hackathon/issues/17)、[#23](https://github.com/KinomotoMio/obelisk-hackathon/issues/23)、[#25](https://github.com/KinomotoMio/obelisk-hackathon/issues/25)、[#28](https://github.com/KinomotoMio/obelisk-hackathon/issues/28) |
| 给 AI 用的 skill | `obelisk` skill：教 AI 检索历史（`skill-doc/`） | `agent-skills/` 下 5 个独立 skill：沉淀 Skill（含在已有 Skill 上衍生）、私密分享、Skill 铸造与取用、钱包、使用上报与判断，Claude Code 和 Codex 都能用；`minted-skills/` 下「AI 能力履历」Skill | [#15](https://github.com/KinomotoMio/obelisk-hackathon/issues/15)、[#20](https://github.com/KinomotoMio/obelisk-hackathon/issues/20)、[#25](https://github.com/KinomotoMio/obelisk-hackathon/issues/25)、[#28](https://github.com/KinomotoMio/obelisk-hackathon/issues/28) |
| 桌面 App | Electron + Vue：Sessions、Memory、Activity、Recaps、Settings；「生成」按钮复制命令交给 Claude Code 执行 | 新增 Share tab、Skill tab（草稿审阅、我的 Skill、已铸造 Skill 详情：调用量、钱包数、趋势、族谱、实测场景与各场景的顺利率、「来源：Playground」标记）、Session 详情页的分享入口、无界面截图模式；操作按钮沿用「复制成 prompt」，并可以在设置里选择复制给 Claude Code 或 Codex；侧栏、回顾卡片和 App 图标换成 Obelisk 的正式标志 | [#12](https://github.com/KinomotoMio/obelisk-hackathon/issues/12)、[#18](https://github.com/KinomotoMio/obelisk-hackathon/issues/18)、[#19](https://github.com/KinomotoMio/obelisk-hackathon/issues/19)、[#25](https://github.com/KinomotoMio/obelisk-hackathon/issues/25)、[#32](https://github.com/KinomotoMio/obelisk-hackathon/issues/32)；`aa193ba`、`9738ca5`…`a93041e` |
| Playground | 无 | `playground/`：在一台电脑上准备多个角色（各自的数据、AI 助手登录和钱包），按剧本让它们用 Codex 或 Claude Code 真实运行，记录每次 `obelisk` 调用和数据出处，截取 App 关键画面；`publish` 去掉本机路径和可疑内容后发布成网页，`serve` 在本机实时查看 | [#30](https://github.com/KinomotoMio/obelisk-hackathon/issues/30)、[#31](https://github.com/KinomotoMio/obelisk-hackathon/issues/31)、[#32](https://github.com/KinomotoMio/obelisk-hackathon/issues/32) |
| 文档 | 使用说明、贡献指南、ADR、性能测量与调研记录 | `docs/vision/`（产品愿景、各能力设计、路线图、界面示意）、`docs/testing/`（两轮测试说明）、本目录 | [`docs/vision/README.md`](../vision/README.md)、[`docs/testing/README.md`](../testing/README.md) |
| 测试与 CI | 87 个测试文件（`*.test.*`）、7 个 App 的 Electron 测试脚本；CLI 的 CI | 新增 49 个测试文件（合约、服务、CLI、Playground、App 页面）和 4 个 Electron 用例（Skill tab、Share tab、Playground 来源标记、截图）。测试用本地 Hardhat 链和假的 AI 助手，从不连真实的在线服务。CI 配置增加了合约的测试和类型检查、服务的类型检查和测试；但 CI 只在 PR 和 `main` 上触发，`hackathon` 分支的推送不会自动运行 | [`.github/workflows/cli.yml`](../../.github/workflows/cli.yml) |

## 沿用的代码、素材和第三方组件

| 来源 | 用在哪里 | 赛前已有？ |
| --- | --- | --- |
| Obelisk 本身（[tommy0103/obelisk](https://github.com/tommy0103/obelisk)，AGPL-3.0） | 索引、检索、CLI、桌面 App 的原有部分 | 是 |
| Obelisk 的标志、字标和 App 图标（取自上游 [tommy0103/obelisk#208](https://github.com/tommy0103/obelisk/pull/208) 和 Obelisk 官方落地页） | 公开网页、阅读页、App 侧栏、回顾卡片、履历页；App 图标按 macOS 规范重新排版 | 否，比赛期间从上游引入 |
| Electron、electron-vite、Vue、vue-router、@tanstack/vue-virtual、better-sqlite3、@parcel/watcher | 桌面 App | 是 |
| TypeScript、ESLint | 全仓库 | 是 |
| [viem](https://viem.sh) | CLI、core、在线服务：签名、合约调用、地址处理 | 否，比赛期间引入 |
| [OpenZeppelin Contracts](https://github.com/OpenZeppelin/openzeppelin-contracts)（`EIP712`、`SignatureChecker`、`Nonces`） | 合约的签名校验 | 否，比赛期间引入 |
| [Hardhat 3](https://hardhat.org) 及 `hardhat-toolbox-viem` | 合约编译、测试、部署、源码验证 | 否，比赛期间引入 |
| [Cloudflare Workers](https://developers.cloudflare.com/workers/)（Wrangler、R2、KV、Durable Objects） | 在线服务的运行环境和存储 | 否，比赛期间引入 |
| 浏览器 WebCrypto（X25519、HKDF、AES-GCM） | 网页阅读页解密，不依赖第三方库 | 否 |
| Claude Code、Codex CLI | 用户本机已安装的 AI 编程助手：执行 Obelisk 的 skill、判断调用结果、Playground 的模拟用户。只在本机调用，不打包、不随仓库分发 | 否（Obelisk 赛前已能索引它们的 session） |
| 界面配色和字体 | 取自 App 原有的 `app/src/renderer/styles/base.css` | 是 |

界面示意（`docs/vision/mockups/`）和演示数据均为本团队制作；标有「演示数据」「示意内容」「示例」的截图和页面不是真实数据。

## 复核命令

```bash
git fetch origin && git fetch https://github.com/tommy0103/obelisk.git main:refs/remotes/upstream/main
git merge-base origin/hackathon upstream/main             # 分界点 b5a7696
git rev-list --count b5a7696                               # 赛前提交数
git rev-list --count b5a7696..origin/hackathon             # 比赛期间提交数
git log --reverse --format='%h %ad %s' --date=iso b5a7696..origin/hackathon | head -1
git rev-list --merges --count b5a7696..origin/hackathon    # 0
git diff --shortstat b5a7696 origin/hackathon -- . ':!**/package-lock.json' ':!package-lock.json'
git diff --name-status b5a7696 origin/hackathon -- . ':!**/package-lock.json' ':!package-lock.json' | cut -f1 | sort | uniq -c   # A 新文件，M 改动的原有文件
git rev-list --count b5a7696..upstream/main                # 上游在分界点之后的提交数
```
