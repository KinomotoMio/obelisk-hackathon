# 演示脚本

> **2026-10-08 调整**：先积累真实历史资产、模拟市场搜索与使用，并从发生时记录重要过程；以下九步和讲述时间表是候选，不作为大量数据的前置或预设结果。#31 从实际数据中选故事，#45/#46 积累数据，#47 提供素材。模拟用户发言使用自然日常请求；显式格式/计量诊断和操作 SOP 不作为自然使用样本。

> 对应 [KinomotoMio/obelisk-hackathon#37](https://github.com/KinomotoMio/obelisk-hackathon/issues/37)。完整流程来自 [路线图 · 阶段 1 · 黑客松演示](../vision/07-roadmap.md#阶段-1--黑客松演示)，这里按评审的时间重新排了顺序，并标出每一步现在能不能跑。
>
> 状态依据：`hackathon` 分支 [`ab16eb4`](https://github.com/KinomotoMio/obelisk-hackathon/commit/ab16eb4)，以及 2026-10-07 下午在线服务和测试网上的实际情况。

## 时间限制（选手手册 §6.1）

| 环节 | 每队 | 用哪个版本 |
| --- | --- | --- |
| 全体项目展示（13:30–15:30） | 约 6 分钟，含演示和问答 | [6 分钟版](#6-分钟版全体展示)：演示 4:30，留 1:30 问答 |
| 重点项目终评（16:00–17:00，最多 8 队） | 4 分钟展示，3 分钟问答 | [4 分钟版](#4-分钟版终评) |

评委要求：说明解决的问题，演示主要流程，**区分已实现的功能和后续计划**；已有项目还要说明这次比赛新增了什么，见 [赛前已有与比赛期间新增](before-and-during.md)。

一次 AI 编程助手的运行要几十秒到几分钟，判断调用结果还要等 session 安静 30 分钟，所以 9 步不可能都在台上从头跑。分工如下：

- **演示视频**（提交材料要求「演示视频或可运行链接」）：录下完整的 9 步，每笔交易都能在区块浏览器上查到。
- **可运行链接**：公开网页，评委用浏览器打开，不用安装，见 [运行说明](run-guide.md#1-不安装打开公开网页)。
- **现场**：提前把每一步跑到「只差最后一下」，台上只做最能说明问题的几个瞬间（下表标「现场」），其余展示已经跑出来的结果，并说明是预先跑好的。

## 发布与演示安排

2026-10-08 已确认：先在测试网完成本轮功能、合约和 Playground 的真实闭环，固定验收版本后部署主网并跑少量真实验证。主网和测试网使用独立 Worker，主要演示和大量数据保留在测试网。下面区分已确定的安排与仍待完成的工作。

### 主网

[#5](https://github.com/KinomotoMio/obelisk-hackathon/issues/5)

- **现状**：尚未部署。先完成测试网验收和版本固定，再按 [部署流程](../../chain/README.md#switching-to-mainnet-5) 发布；独立主网 Worker 配置仍待实现。
- **对演示的影响**：主网部署不覆盖测试网 Worker。主要流程、Playground 数据和演示视频在测试网完成，明确标注网络；主网地址、源码验证和少量真实业务交易单独出示。两网使用各自的服务地址和数据目录，CLI 和 App 在同步主网部署记录后重新构建。
- **提交边界**：测试网上的操作不能填进主网部署证明；手册没有要求整批演示数据全部跑在主网。参与部署协作仍需提交可核验的主网材料（选手手册 §5.2）。

### Playground 的真实运行

[#31](https://github.com/KinomotoMio/obelisk-hackathon/issues/31)、[#32](https://github.com/KinomotoMio/obelisk-hackathon/issues/32)

- **现状**：流水线已经打通（角色隔离、Codex 执行器、出处记录、截图、发布、网页运行页），只做过两次 Codex 冒烟运行，没有链上交易。**「演示闭环」剧本还没有写**，`playground/scenarios/` 里只有 `smoke.json`；没有发布过正式的完整运行；`/runs` 页面和 `/v1/txs` 已于 2026-10-07 部署并验证。
- **受影响的**：第 5 步「对比两个履历 Skill 的实测场景、调用量和顺利率」；`/preview` 从「示意内容」换成「真实运行」；App 里「来源：Playground」的「查看产生方法」。
- **已确定的**：正式演示数据在测试网跑，见 [09 · 本轮数据积累方式](../vision/09-playground.md#本轮数据积累方式2026-10-08-确认)。任务配置记录角色、自然请求和预算，保留实际结果，不预设顺利率差异。先校准执行与计量，再从真实历史发现资产、模拟市场使用、持续记录和扩量。每批运行可以独立发布；路演故事从这些数据中选择，选好后再填项目预览与现场片段，不需要先写固定九步剧情。
- **还没做、演示时要口头说明的**：链上的统计不区分数据是否来自 Playground（[09 · 上线步骤](../vision/09-playground.md#上线步骤) G5 第 2、3 项）。

## 每一步现在的状态

图例：✅ 已在测试网跑通 · ✅ 本地链：已在本地 Hardhat 链加 `wrangler dev` 上跑通，测试网上还没有对应数据 · ⚠ 能跑，但有表中写明的原因

| # | 步骤（路线图原文简写） | 状态 | 原因与依据 | 演示方式 |
| --- | --- | --- | --- | --- |
| 1 | **分享**：A 在 Session 详情页选片段，填 B 的钱包和「只能打开 1 次」，复制成 prompt，在 Claude Code 里完成隐私体检并确认 | ✅ | App 分享入口和 CLI 分享（体检、打码、加密、上传、上链）都已在测试网跑通，交易示例见 [主网材料](mainnet.md#测试网上已有的交易示例)。[#8](https://github.com/KinomotoMio/obelisk-hackathon/issues/8)、[#12](https://github.com/KinomotoMio/obelisk-hackathon/issues/12)。prompt 也可以复制给 Codex | 预先跑完，台上展示对话框和体检结果 |
| 2 | **转发无效**：C 打开同一个链接，被拒绝 | ✅ | 服务按链上规则拒绝放行钥匙包，不产生交易。[#9](https://github.com/KinomotoMio/obelisk-hackathon/issues/9)、[#10](https://github.com/KinomotoMio/obelisk-hackathon/issues/10) | **现场** |
| 3 | **已读**：B 在网页上打开，看到带水印的对话；A 的 Share tab 显示「已读」和链上记录；B 再次打开被拒绝 | ✅ | 打开时服务提交 `recordOpenBySig`，最多等约 25 秒确认。[#9](https://github.com/KinomotoMio/obelisk-hackathon/issues/9)–[#12](https://github.com/KinomotoMio/obelisk-hackathon/issues/12) | **现场**：B 打开、A 刷新 Share tab、B 再开被拒 |
| 4 | **沉淀与铸造**：A 用「沉淀 Skill」说一句话，从历史中找证据、展示用到的 session，起草「AI 能力履历」；在 Skill tab 审阅草稿，复制「确认并铸造」，在 Claude Code 里看过预览后铸造 | ⚠ | 沉淀（[#15](https://github.com/KinomotoMio/obelisk-hackathon/issues/15)）、草稿审阅（[#18](https://github.com/KinomotoMio/obelisk-hackathon/issues/18)）、铸造（[#16](https://github.com/KinomotoMio/obelisk-hackathon/issues/16)）都已在测试网跑通，「AI 能力履历」已在测试网铸造为 Skill #4。⚠ 但它是团队写好的 [`minted-skills/ai-capability-resume`](../../minted-skills/ai-capability-resume/SKILL.md)，不是从 A 的历史里沉淀出来的，和路线图原文不一致。演示时二选一：沉淀另一个 Skill 来展示「沉淀」，再单独铸造履历 Skill；或者照实说明履历 Skill 是写好的 | 沉淀预先跑完；铸造可以**现场**确认一次（预览已出，台上只确认） |
| 5 | **场景与调用量**：在 Skill tab 对比两个履历 Skill 的实测场景、调用量和顺利率；数据来自 Playground 的真实运行，界面标明来源，点开可以查看产生方法 | ⚠ | 能力本身已完成并上线：本机判断场景和结果（[#25](https://github.com/KinomotoMio/obelisk-hackathon/issues/25)，Codex 优先），每个场景各自的顺利率在 App 详情页和 `/market/skills/<编号>` 上都能显示；测试网上 Skill #2 已有真实的按场景结果（[/v1/skills/2/usage](https://obelisk-service.kinomotomiovo.workers.dev/v1/skills/2/usage)）。⚠ **依赖 Playground 的真实运行，还没有跑**，见 [上面](#playground-的真实运行)。撰写时测试网上只有一个履历 Skill（#4），调用为 0，没有可以对比的第二个 | 依赖 owner 的决定。没有数据时页面如实显示「尚未开启」「样本不足」 |
| 6 | **使用**：U 在 Claude Code 中调用「AI 能力履历」生成履历，这次调用计入统计 | ✅ 本地链 | [#22](https://github.com/KinomotoMio/obelisk-hackathon/issues/22)、[#23](https://github.com/KinomotoMio/obelisk-hackathon/issues/23)、[#28](https://github.com/KinomotoMio/obelisk-hackathon/issues/28)：本地链上调用被识别并上报，统计显示 1 次 / 1 个钱包。测试网上 Skill #4 还没有上报（[第 2 轮 · 场景 2](../testing/round-02.md#场景-2取用生成履历判断结果角色-b) 会产生）。**调用和上报请在 Claude Code 里做**：Codex 的 Skill 调用识别会漏记或重复记（[#38](https://github.com/KinomotoMio/obelisk-hackathon/issues/38)、[#39](https://github.com/KinomotoMio/obelisk-hackathon/issues/39)） | 预先跑完（判断要等 30 分钟），台上打开生成的履历页 |
| 7 | **衍生**：D 在 Skill 详情页复制「在此基础上修改」，在 Claude Code 里改出「设计师作品集」版并铸造，族谱新增分支 | ✅ 本地链 | [#20](https://github.com/KinomotoMio/obelisk-hackathon/issues/20)：本地链上 #2 记录父 Skill #1，两个 Skill 的族谱都显示新分支。测试网上还没有衍生 Skill（[第 2 轮 · 场景 3](../testing/round-02.md#场景-3看实测场景然后衍生a-看b-改) 会产生） | 预先跑完，台上在 `/market/skills/<编号>` 展示族谱 |
| 8 | **出示**：U 把佐证 session 私密分享给招聘方 | ✅ | 履历页每个代表性问题附一条佐证 prompt，复用第 1 步的分享流程（[#28](https://github.com/KinomotoMio/obelisk-hackathon/issues/28) R3、[#12](https://github.com/KinomotoMio/obelisk-hackathon/issues/12)） | 预先跑完，台上展示 prompt 和招聘方打开的页面 |
| 9 | **市场与收益**：上架、分成、收入、上下文付费；团队版愿景 | ✅ | 路线图原文是「截图」，现在做成了公开网页（[#35](https://github.com/KinomotoMio/obelisk-hackathon/issues/35)）：`/market` 是链上真实数据；`/market/stage-2` 标明「阶段 2 预览」，数字都标「示例」，分成用所选 Skill 的真实族谱，并讲 M6「正文可以复制时价值从哪里来」。团队版是一页愿景文档 [08](../vision/08-team-edition.md)，没有页面 | **现场**，链接可以直接给评委 |

另外两个和演示有关的网页：

| 页面 | 状态 |
| --- | --- |
| [/preview](https://obelisk-service.kinomotomiovo.workers.dev/preview) 项目预览（[#33](https://github.com/KinomotoMio/obelisk-hackathon/issues/33)） | ✅ 已上线：9 步、7 个角色、链上时间线，手机可用。⚠ 目前是**示意内容**，页面上三处标明；运行记录链接的代码已随 2026-10-07 的 Worker 更新部署，仍需发布正式运行并替换预览数据，见 [上面](#playground-的真实运行)。 |
| `/runs/<运行编号>` Playground 运行记录（[#32](https://github.com/KinomotoMio/obelisk-hackathon/issues/32)） | ✅ `/runs` 页面和 `/v1/txs` 接口已上线并验证。⚠ 正式完整运行数据尚未发布；在那之前可以用 `npm run playground -- fixture <目录>` 生成标明「示例数据」的运行，或用 `npm run playground -- serve` 在本机查看。 |

## 6 分钟版（全体展示）

演示 4:30，问答 1:30。到 4:30 还没讲完，直接跳到最后一段。

| 时间 | 讲什么 | 屏幕上 | 现场 / 预先 |
| --- | --- | --- | --- |
| 0:00–0:30 | 问题与做法：AI 编程的真实工作过程留在本机，没法安全地给别人看、没法证明、没法复用。Obelisk 原本是记忆层（入口，赛前已有）；这次做的是出口：私密分享、Skill 资产化、真实使用证据，规则和凭证落在 BOT Chain 上 | [整体架构](../vision/README.md#整体架构) 一页；一句话说明赛前已有和新增的分界 | — |
| 0:30–1:45 | 私密分享（1–3） | A 的分享对话框和 Claude Code 里的体检结果（预先）；C 用钱包打开链接被拒；B 打开看到水印；A 的 Share tab 刷新为「已读」，点链上记录打开浏览器；B 再开被拒 | 2、3 **现场** |
| 1:45–2:45 | Skill 资产（4、7） | Skill tab 的草稿：证据、出处卡、出生场景；铸造预览，**现场**确认一次；`/market/skills/<编号>` 的族谱和 D 衍生的分支 | 铸造**现场**，其余预先 |
| 2:45–3:45 | 真实使用与履历（5、6、8） | Skill 详情页：真实调用、钱包数、实测场景、每个场景的顺利率（⚠ 依赖 Playground 数据）；U 的履历页：统计、能力维度、代表性问题、链上可核对的 Skill；一条佐证 prompt | 预先 |
| 3:45–4:30 | 可以核对的证据和接下来做什么 | `/market` → 「阶段 2 预览」讲钱怎么沿族谱流动（标明示例）；区块浏览器上的合约和演示交易；一句话：已实现的是 1–8 步，上架和分成是阶段 2 | `/market` **现场** |
| 4:30–6:00 | 问答 | 准备好的标签页：`/market`、区块浏览器、[问答准备](qa.md) | — |

## 4 分钟版（终评）

只讲一条线：**一段真实的工作过程，怎样安全地出去、被证明、被复用**。

| 时间 | 讲什么 | 屏幕上 | 现场 / 预先 |
| --- | --- | --- | --- |
| 0:00–0:25 | 问题、做法、赛前已有与新增，各一句 | 架构图 | — |
| 0:25–1:25 | 私密分享 | C 被拒 → B 打开有水印 → A 看到「已读」和链上回执 | **现场** |
| 1:25–2:25 | Skill 资产 | 草稿和出处（截图）→ 已铸造的 Skill 页：族谱和衍生分支 | 预先 |
| 2:25–3:25 | 真实使用与履历 | Skill 页的调用量、钱包数、各场景顺利率（⚠ 依赖 Playground 数据）→ 履历页 | 预先 |
| 3:25–4:00 | 证据与后续 | `/market` 和区块浏览器；阶段 2 预览一句带过 | **现场** |

## 演示视频

- 在主网切换之后录（见 [主网](#主网)）；如果截止前没有主网，就在测试网上录，并在画面上写明网络。
- 9 步按顺序录完整，包括台上省掉的部分：Claude Code 里的体检、预览、确认，以及判断和上报。
- 每笔交易出现时切到浏览器停一下，并把交易哈希记进 [主网材料 · 演示中产生的交易](mainnet.md#主网验证交易按预算选取)。
- 用不含真实密钥、客户信息的 session；录完逐帧检查终端和页面上有没有本机用户名、路径和邮箱。
- 时长、上传位置：`待填`。

## 网络或链慢时的备用方案

| 情况 | 会看到什么 | 怎么办 |
| --- | --- | --- |
| 现场网络不通或很慢 | 网页打不开，钱包签名卡住 | 切手机热点；仍然不行就放演示视频的对应片段。每一步都提前截好图，按顺序放在一个文件夹里 |
| 链确认慢 | CLI 返回 `submitted`；阅读页打开时等待超过约 25 秒，服务返回 `202 pending` | 都可以重试，不会重复：再运行一次同样的命令或再点一次打开，会接着完成同一笔（[#8](https://github.com/KinomotoMio/obelisk-hackathon/issues/8)、[#9](https://github.com/KinomotoMio/obelisk-hackathon/issues/9)、[#11](https://github.com/KinomotoMio/obelisk-hackathon/issues/11)）。台上不等，先讲下一步，回头刷新 |
| 在线服务出错 | 页面显示看得懂的中文错误说明 | 先看 `/v1/health`；服务不可用时放截图和视频，链上记录仍然可以在区块浏览器上直接看 |
| 代付钱包余额不足 | 服务返回 503，并提示补充余额 | 演示前确认余额（见下面的清单）；主网建议至少 0.5 BOT |
| MetaMask 弹窗没出现或网络不对 | 阅读页提示切换网络 | 演示前在 B、C 两个浏览器配置里各打开一次阅读页，确认网络已添加 |
| 第 3 步 B 唯一的一次打开机会被提前用掉 | B 打开时被拒绝 | 多准备一个备用分享，同样只能打开 1 次 |

## 彩排清单

### 提交前（10 月 8 日 12:00 之前）

- [ ] 主网：按 [主网材料 · 部署前后检查](mainnet.md#部署前后检查) 走完；`curl -s https://obelisk-service.kinomotomiovo.workers.dev/v1/health` 返回 `"chainId": 677`，代付钱包有余额
- [ ] 重新部署 Worker（`cd service && npm run deploy`），让 `/runs`、`/v1/txs` 和 `/preview` 的新链接上线；之后 `curl -s -o /dev/null -w '%{http_code}' https://obelisk-service.kinomotomiovo.workers.dev/runs` 应返回 200
- [ ] Playground：owner 决定演示效果 → 写「演示闭环」剧本 → `npm run playground -- auth status` 显示已登录 → `npm run playground -- run <剧本> --dry-run` → 真实运行 → `npm run playground -- publish <运行编号>` → 填 `service/public/preview/story.json` → 再部署一次 Worker
- [ ] 拉取最新代码后运行 `sh scripts/hackathon-env.sh`，重新构建 CLI 和 App
- [ ] 角色：A、D、U 各用一个 CLI 钱包和独立的数据目录。`scripts/hackathon-env.sh` 只有 A、B 两个角色，另外的用 Playground 的角色（`npm run playground -- roles env <角色>`）；B、C 和招聘方用浏览器里的 MetaMask 账户，不需要 BOT
- [ ] 每个 CLI 钱包 `obelisk wallet show` 显示已激活；MetaMask 账户的激活见 [第 1 轮 · 场景 4](../testing/round-01.md#场景-4私密分享角色-a-发给-metamask-账户)
- [ ] 第 1 步的分享已创建（`obelisk share list` 能看到，状态未读），另有一个备用分享
- [ ] 第 4、7 步的 Skill 已铸造，`/market` 上能看到，衍生的那个显示「基于 #父 Skill」
- [ ] 第 6 步：U 已生成履历，`obelisk usage judge --confirm` 判断过（调用后要等 30 分钟），`obelisk usage report` 已上报；`/market/skills/<编号>` 的调用量不为 0
- [ ] 演示视频录完，交易哈希填进 [主网材料](mainnet.md#主网验证交易按预算选取)
- [ ] 提交材料里的每个链接逐个打开一遍：[README](README.md) 列出的所有文件

### 演示前一小时

- [ ] `curl -s https://obelisk-service.kinomotomiovo.workers.dev/v1/health`：`ok: true`，网络正确，代付钱包余额足够
- [ ] 浏览器标签页按演示顺序打开：C 的阅读页链接、B 的阅读页链接（**不要提前点打开**）、`/market`、`/market/skills/<编号>`、`/market/stage-2?skill=<编号>`、`/preview`、区块浏览器上的合约地址
- [ ] App 在角色 A 下运行（`source ~/.obelisk-hackathon/env.sh` 后 `cd app && npm run dev`），Share tab 和 Skill tab 已打开过一次
- [ ] 截图文件夹和演示视频在本机，不依赖网络就能打开
- [ ] 手机热点可用
- [ ] 关掉通知，终端清屏，确认屏幕上没有本机用户名、路径、邮箱

### 彩排

- [ ] 按 6 分钟版和 4 分钟版各计时完整跑一遍，记下超时的段落
- [ ] 断网跑一遍备用方案：只用截图和视频讲完
- [ ] 过一遍 [问答准备](qa.md)，每个回答控制在 30 秒内；答不了的照实说是赛后要解决的问题
- [ ] 讲解人与操作人分工：`待填`
