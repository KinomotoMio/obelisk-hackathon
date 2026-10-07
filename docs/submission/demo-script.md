# 演示脚本

> 草稿，对应 [KinomotoMio/obelisk-hackathon#37](https://github.com/KinomotoMio/obelisk-hackathon/issues/37)。完整流程来自 [路线图 · 阶段 1 · 黑客松演示](../vision/07-roadmap.md#阶段-1--黑客松演示)，这里按评审的时间重新排了顺序，并标出每一步现在能不能跑。

## 时间限制（选手手册 §6.1）

- **全体项目展示**：每队约 6 分钟，含演示和问答。建议演示 4 分钟，留 2 分钟给问答。
- **重点项目终评**（最多 8 队）：4 分钟展示，3 分钟问答。
- 评委要求：说明解决的问题，演示主要流程，**区分已实现的功能和后续计划**；已有项目还要说明这次比赛新增了什么，见 [赛前已有与比赛期间新增](before-and-during.md)。

一次 Claude Code 运行要几十秒到几分钟，4 分钟内不可能把 9 步都现场跑一遍。建议这样分工：

- **演示视频**（提交材料要求「演示视频或可运行链接」）：录下完整的 9 步，每笔交易都能在区块浏览器上查到。
- **现场**：提前准备好每一步的状态，只现场操作最能说明问题的几个瞬间（下表标「现场」），其余展示已经跑出来的结果。

## 每一步现在的状态

图例：✅ 已在测试网或本地链跑通 · ⚠ 能跑，但依赖还没有生成的数据，或与路线图描述不完全一致 · ✗ 还没做

| # | 步骤（路线图原文简写） | 用到的功能 | 状态 | 依据 |
| --- | --- | --- | --- | --- |
| 1 | **分享**：A 在 Session 详情页选片段，填 B 的钱包和「只能打开 1 次」，复制成 prompt，在 Claude Code 里完成隐私体检并确认 | App 分享入口、CLI 分享（体检、打码、加密、上传、上链） | ✅ | [#8](https://github.com/KinomotoMio/obelisk-hackathon/issues/8)、[#12](https://github.com/KinomotoMio/obelisk-hackathon/issues/12) |
| 2 | **转发无效**：C 打开同一个链接，被拒绝 | 网页阅读页的拒绝页 | ✅ | [#9](https://github.com/KinomotoMio/obelisk-hackathon/issues/9)、[#10](https://github.com/KinomotoMio/obelisk-hackathon/issues/10) |
| 3 | **已读**：B 在网页上打开，看到带水印的对话；A 的 Share tab 显示「已读」和链上记录；B 再次打开被拒绝 | 阅读页、打开回执、Share tab | ✅ | [#9](https://github.com/KinomotoMio/obelisk-hackathon/issues/9)、[#10](https://github.com/KinomotoMio/obelisk-hackathon/issues/10)、[#11](https://github.com/KinomotoMio/obelisk-hackathon/issues/11)、[#12](https://github.com/KinomotoMio/obelisk-hackathon/issues/12) |
| 4 | **沉淀与铸造**：A 用「沉淀 Skill」说一句话，从历史中找证据、展示用到的 session，起草 Skill；在 Skill tab 审阅草稿，复制「确认并铸造」，在 Claude Code 里看过预览后铸造 | 沉淀 Skill、Skill tab 草稿审阅、铸造 | ✅ / ⚠ | [#15](https://github.com/KinomotoMio/obelisk-hackathon/issues/15)、[#16](https://github.com/KinomotoMio/obelisk-hackathon/issues/16)、[#18](https://github.com/KinomotoMio/obelisk-hackathon/issues/18)。⚠ 流程本身都能跑。但第 6、8 步用的「AI 能力履历」Skill 是写好的 [`minted-skills/ai-capability-resume`](../../minted-skills/ai-capability-resume/SKILL.md)，不是从 A 的历史里沉淀出来的。演示时可以沉淀另一个 Skill 来展示第 4 步，再单独铸造履历 Skill；或者明确说明这一点 |
| 5 | **场景与调用量**：在 Skill tab 对比两个履历 Skill 的实测场景、调用量和顺利率；数据来自 Playground 的真实运行，界面标明来源，点开可以查看产生方法 | Skill 详情页（调用量、钱包数、趋势、族谱、实测场景、按场景的结果）、结果判断、Playground | ⚠ | 页面和判断：[#19](https://github.com/KinomotoMio/obelisk-hackathon/issues/19)、[#25](https://github.com/KinomotoMio/obelisk-hackathon/issues/25)；Playground：[#31](https://github.com/KinomotoMio/obelisk-hackathon/issues/31)、[#32](https://github.com/KinomotoMio/obelisk-hackathon/issues/32)。**依赖 Playground 数据，还没有生成**：剧本执行器和实时页面已经有了，但还没跑出两个履历 Skill 的调用量、场景和顺利率。没有这批数据，页面只能显示少量真实操作的数字，场景和顺利率会显示「尚未开启」 |
| 6 | **使用**：U 在 Claude Code 中调用「AI 能力履历」生成履历，这次调用计入统计 | 履历 Skill、识别调用、汇总上报 | ✅ | [#22](https://github.com/KinomotoMio/obelisk-hackathon/issues/22)、[#23](https://github.com/KinomotoMio/obelisk-hackathon/issues/23)、[#28](https://github.com/KinomotoMio/obelisk-hackathon/issues/28)（本地链验证：调用被识别并上报，统计显示 1 次 / 1 个钱包） |
| 7 | **衍生**：D 在 Skill 详情页复制「在此基础上修改」，在 Claude Code 里改出「设计师作品集」版并铸造，族谱新增分支 | 沉淀 Skill 的衍生流程、铸造记录父 Skill、族谱 | ✅ | [#20](https://github.com/KinomotoMio/obelisk-hackathon/issues/20)（本地链验证：#2 记录父 Skill #1，两个 Skill 的族谱都显示新分支） |
| 8 | **出示**：U 把佐证 session 私密分享给招聘方 | 履历页的佐证 prompt、私密分享 | ✅ | [#28](https://github.com/KinomotoMio/obelisk-hackathon/issues/28)、[#12](https://github.com/KinomotoMio/obelisk-hackathon/issues/12) |
| 9 | **截图**：上架、分成、收入、上下文付费；团队版愿景 | App 里的演示页面（标「演示数据」）；团队版一页愿景 | ✗ / ✅ | 市场与收益页面 [#35](https://github.com/KinomotoMio/obelisk-hackathon/issues/35) 还没做；团队版愿景已有 [08](../vision/08-team-edition.md)；界面示意见 [`mockups/market-and-revenue.html`](../vision/mockups/market-and-revenue.html)（示意，不是 App 截图） |

另外两件和演示有关、还没做的事：

- **主网部署**（[#5](https://github.com/KinomotoMio/obelisk-hackathon/issues/5)）：现在所有交易都在测试网上。赛道要求主网，见 [主网部署材料](mainnet.md)。
- **投资人预览页**（[#33](https://github.com/KinomotoMio/obelisk-hackathon/issues/33)）：路线图阶段 1 要求能通过链接访问，还没部署。

## 4 分钟现场版

| 时间 | 讲什么 | 屏幕上 | 现场还是预先准备 |
| --- | --- | --- | --- |
| 0:00–0:30 | 问题与做法：AI 编程的真实工作过程留在本机，没法安全地给别人看、没法证明、没法复用。Obelisk 原本是记忆层（入口），这次做的是出口：私密分享、Skill 资产化、真实使用证据，都落在 BOT Chain 上 | 一页架构图（[README · 整体架构](../vision/README.md#整体架构)） | — |
| 0:30–1:30 | 私密分享（步骤 1–3） | A 的 Session 详情页 → 分享对话框 → Claude Code 里的体检和确认（预先跑完，展示结果）；C 打开链接被拒（**现场**）；B 打开看到水印（**现场**）；A 的 Share tab 变成「已读」并带链上链接（**现场**刷新） | 分享在演示前创建好，留一次打开机会给 B |
| 1:30–2:30 | Skill 资产（步骤 4、7） | Skill tab 的草稿：证据、出处卡、出生场景；铸造预览（**现场**确认一次铸造，或展示已铸造的结果）；Skill 详情页的族谱，D 衍生的分支 | 沉淀和衍生都预先跑完 |
| 2:30–3:30 | 真实使用与履历（步骤 5、6、8） | Skill 详情页：真实调用、钱包数、实测场景、顺利率（⚠ 依赖 Playground 数据）；U 生成的履历页：统计、能力维度、代表性问题、链上可核对的 Skill；佐证 prompt → 分享给招聘方 | 履历预先生成；调用已上报 |
| 3:30–4:00 | 可以核对的证据，以及哪些是这次新做的 | 区块浏览器上的合约和演示交易（[主网材料](mainnet.md)）；一句话说明赛前已有与新增；后续计划（市场与分成、团队版） | — |

## 准备与彩排清单

- [ ] 角色：A、D、U 各用一个 CLI 钱包和独立的数据目录。`scripts/hackathon-env.sh` 只准备 A、B 两个角色，第三个要用 Playground 的角色（[#31](https://github.com/KinomotoMio/obelisk-hackathon/issues/31)）或再建一个数据目录（[#30](https://github.com/KinomotoMio/obelisk-hackathon/issues/30)）；B、C 和招聘方用浏览器里的 MetaMask 账户，不需要 BOT
- [ ] 钱包都已激活（加密公钥上链）；B 的激活流程见 [第 1 轮测试 · 场景 4](../testing/round-01.md)
- [ ] 用不含敏感信息的 session 做分享演示
- [ ] 第 5 步要用的 Playground 数据已经生成，并在页面上标明来源（⚠ 还没有）
- [ ] 演示视频录完整的 9 步，交易哈希记进 [主网材料](mainnet.md#演示中产生的交易)
- [ ] 现场网络不稳时的备用方案：手机热点；每一步的截图
- [ ] 按 4 分钟现场版计时彩排至少一遍，准备问答：数据怎么防篡改（[质疑与回应](../vision/10-challenges.md)）、和普通 Skill 市场的区别、隐私怎么保证
