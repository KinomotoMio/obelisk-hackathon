# 提交材料（草稿）

> 汉客松 S1 & ETH Wuhan 2026 · BOT Chain BUILD BEYOND 2026 分赛道。对应 [KinomotoMio/obelisk-hackathon#37](https://github.com/KinomotoMio/obelisk-hackathon/issues/37)。
>
> **截止时间：2026-10-08 12:00（北京时间）**，开发窗口满 40 小时。提交入口在选手群公布。依据是赛事的选手手册，下文的 §编号指手册章节。
>
> 状态按 `hackathon` 分支 [`ab16eb4`](https://github.com/KinomotoMio/obelisk-hackathon/commit/ab16eb4) 和 2026-10-07 下午的线上情况更新。

| 文件 | 内容 |
| --- | --- |
| [run-guide.md](run-guide.md) | **给评委的运行说明**：项目是什么、比赛期间做了什么、怎么体验（公开网页、链上核对、本机安装）、哪些是真实的哪些是示意 |
| [before-and-during.md](before-and-during.md) | 赛前已有与比赛期间新增：分界点、提交范围、按领域对照、沿用组件来源 |
| [mainnet.md](mainnet.md) | BOT Chain 主网合约地址、浏览器链接、演示交易（主网待部署；测试网地址和交易示例已列出） |
| [demo-script.md](demo-script.md) | 演示脚本：两个待定前提、每一步的状态、6 分钟版和 4 分钟版、演示视频、备用方案、彩排清单 |
| [qa.md](qa.md) | 问答准备：可能被问到的问题和有依据的回答 |

## 必须提交的内容

### 所有项目（§5.2、§5.3）

作品形态不限，但**必须能实际运行，并提供可以体验的交互方式**。

- [ ] **项目介绍**：队名与成员、项目名称、目标用户、解决的问题、核心功能、比赛期间完成的工作
  - 队名与成员：`待填`
  - 项目名称：Obelisk（`待填`：提交时是否另起中文名）
  - 目标用户、问题、核心功能：[运行说明 · Obelisk 是什么](run-guide.md#obelisk-是什么)，素材见 [愿景 README](../vision/README.md)（「为谁做」「我们看到的问题」「我们的做法」）
  - 比赛期间完成的工作：[运行说明 · 比赛期间做了什么](run-guide.md#比赛期间做了什么)、[before-and-during.md](before-and-during.md)
- [x] **代码与运行说明**：代码仓库、环境依赖、启动步骤、使用方法，并注明沿用组件的来源
  - 仓库：<https://github.com/KinomotoMio/obelisk-hackathon>，分支 `hackathon`
  - 运行说明：[run-guide.md](run-guide.md)，安装细节在 [测试轮次 · 安装](../testing/README.md#安装每一轮通用)
  - 沿用组件来源：[before-and-during.md · 沿用的代码、素材和第三方组件](before-and-during.md#沿用的代码素材和第三方组件)
- [ ] **演示材料**：演示视频或可运行链接，展示核心功能和主要使用流程
  - [x] 可运行链接：公开网页 [/market](https://obelisk-service.kinomotomiovo.workers.dev/market)、[/market/stage-2](https://obelisk-service.kinomotomiovo.workers.dev/market/stage-2)、[/preview](https://obelisk-service.kinomotomiovo.workers.dev/preview)（目前是示意内容），不需要安装
  - [ ] 演示视频：`待录`，要求见 [demo-script.md · 演示视频](demo-script.md#演示视频)
  - [ ] `/runs/<运行编号>` 运行记录：代码已完成，等重新部署 Worker 并发布一次真实运行
- [ ] **提交前检查**：材料齐全、链接能打开、作品能运行，并注明活动期间新增的内容 → [demo-script.md · 彩排清单](demo-script.md#彩排清单)

### 已有项目（§1 参赛要求）

- [x] 说明并**展示**比赛期间新增的内容，清楚区分赛前已有部分和本次新增 → [before-and-during.md](before-and-during.md)（提交前把「撰写时的最后一个提交」换成最终提交，重跑复核命令）
- [x] 注明沿用的代码、素材和第三方组件的来源 → 同上

### BOT Chain 主网部署协作（§5.1.2、§5.2）

- [ ] BOT Chain Mainnet 区块浏览器链接
- [ ] 交易记录
- [ ] 合约或应用地址

→ [mainnet.md](mainnet.md)。**只部署到测试网，或只是创建钱包、领测试币，都不算有效部署。** 主网 Chain ID 677，浏览器 scan.botchain.ai。撰写时：主网 BOT 还没到账（[#5](https://github.com/KinomotoMio/obelisk-hackathon/issues/5)）；切换脚本、源码验证脚本、服务按链切换都已就绪，到账后约 30 分钟。

## 评审方式（§6）

两步评审，都在 10 月 8 日下午：

| 环节 | 时间 | 每队 |
| --- | --- | --- |
| 全体项目展示 | 13:30–15:30 | 约 6 分钟演示与问答，另约 2 分钟转场 |
| 重点项目终评（最多 8 队） | 16:00–17:00 | 4 分钟展示，3 分钟问答 |

评委会结合演示、提交材料和现场问答打分，要求：说明解决的问题，演示主要流程，**区分已实现的功能和后续计划**；已有项目还要说明这次比赛新增了什么。

### 五个维度，各占 20%

| 维度 | 评委关注 | 我们拿什么回应 | 现在的缺口 |
| --- | --- | --- | --- |
| 技术完成度 | 核心功能能否实际运行，主要流程是否完整，演示是否反映真实能力 | 激活、分享、打开（已读回执）、撤回、铸造、上报（含场景和结果）在测试网上都有交易，见 [mainnet.md](mainnet.md#测试网上已有的交易示例)；衍生、履历调用的识别与上报在本地链上跑通；四个合约在测试网上验证了源代码；公开网页 `/market`、`/market/stage-2`、`/preview` 已上线；各 issue 的完成评论附有验收步骤。状态逐步见 [demo-script.md](demo-script.md#每一步现在的状态) | 主网未部署（[#5](https://github.com/KinomotoMio/obelisk-hackathon/issues/5)）；Playground 的「演示闭环」剧本和真实运行还没有，第 5 步缺对比数据；`/runs` 未部署；测试网上还没有衍生 Skill 和履历 Skill 的调用 |
| 创新性 | 解决思路、技术应用、功能设计或产品体验上的有价值改进 | Skill 附出处：它来自哪些真实 session；调用量按内容指纹识别版本，按钱包去重上链；用户本机的 AI 助手判断场景和结果，算出每个场景各自的顺利率，内容不离开本机；分享规则和打开回执在链上；Playground 的数据带出处记录，网页上逐笔核对交易；「命令行优先，App 只复制 prompt」，Claude Code 和 Codex 都能用 | — |
| 场景价值 | 目标用户和问题是否明确，是否回应真实需求 | 愿景 README 的「为谁做」「我们看到的问题」；AI 能力履历：用真实工作过程和链上可核对的数字证明能力；两轮队内测试（[docs/testing](../testing/README.md)） | 还没有赛外的真实用户数据（路线图阶段 2） |
| 赛道结合度 | 是否回应赛道的核心问题，相关技术是否体现在实际功能里 | 4 个合约承载身份、分享授权、Skill 资产和使用统计；激活、分享、打开、撤回、铸造、上报都在链上留下记录；用户只签名，服务代付手续费；市场页和履历页的数字都读自链上 | 主网部署（赛道硬要求） |
| 表达质量 | 能否讲清项目、展示核心功能，并用事实和证据回答提问 | [运行说明](run-guide.md)、[演示脚本](demo-script.md)（6 分钟版和 4 分钟版）、[问答准备](qa.md)、区块浏览器链接、git 历史中的新增范围 | 演示视频；彩排；队名与成员 |

赛道要求（§5.1）不另加权重，是上面五个维度的判断依据。完成主网部署本身不代表获奖。

## 只有 owner 能补的

| 项 | 在哪里 |
| --- | --- |
| 队名与成员；项目是否另起中文名 | 本页、[run-guide.md](run-guide.md) |
| 拿到主网 BOT，部署并部署 Worker | [mainnet.md · 部署前后检查](mainnet.md#部署前后检查) |
| Playground 演示要什么效果、在哪条链上跑 | [demo-script.md · 两个还没定的前提](demo-script.md#两个还没定的前提) |
| 第 4 步怎么讲：另沉淀一个 Skill，还是照实说明履历 Skill 是写好的 | [demo-script.md · 每一步现在的状态](demo-script.md#每一步现在的状态) |
| 演示视频的时长和上传位置；讲解人与操作人分工 | [demo-script.md](demo-script.md#演示视频) |
| 和上游 Obelisk 的关系怎么介绍；队内测试的参与人数 | [qa.md](qa.md) |
