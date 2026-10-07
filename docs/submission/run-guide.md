# 运行说明（给评委）

> 对应 [KinomotoMio/obelisk-hackathon#37](https://github.com/KinomotoMio/obelisk-hackathon/issues/37)。这一页把项目介绍、比赛期间的工作、试用方法和链上核对串在一起，细节都链接到原文档，不在这里重复。
>
> 撰写时的代码：`hackathon` 分支 [`ab16eb4`](https://github.com/KinomotoMio/obelisk-hackathon/commit/ab16eb4)（2026-10-07）。**现在所有链上记录都在 BOT Chain 测试网上，主网还没有部署**（[#5](https://github.com/KinomotoMio/obelisk-hackathon/issues/5)），部署后本页的网络和链接会一起更新。

- 团队：`待填`（队名与成员）
- 仓库：<https://github.com/KinomotoMio/obelisk-hackathon>，分支 `hackathon`；许可证 AGPL-3.0，沿用自 Obelisk
- 在线服务：<https://obelisk-service.kinomotomiovo.workers.dev>

## Obelisk 是什么

Obelisk 赛前就是一个开源的本地工具：把 Claude Code、Codex 等 AI 编程助手的 session 索引到你自己的电脑上，让 AI 能回头查自己当初怎么做、为什么这样做，并配有桌面 App。这是**入口**：真实的工作过程被完整地收进来，找得到。

这次比赛做的是**出口**：让这些真实的 AI 工作过程可以安全地离开你的电脑，并且被证明、被复用。具体是三件事，规则和凭证都落在 BOT Chain 上：

1. **私密分享**：把一段 session 只给指定的钱包看，限次数、限时、可撤回；对方打开时留下链上回执，转发给别人打不开。
2. **Skill 资产化**：一句话从自己的历史里沉淀出 Skill，附上出处；铸造上链后有作者、版本和族谱，别人可以取用，也可以在它的基础上衍生。
3. **真实使用证据**：统计 Skill 被真实调用了多少次、来自多少个钱包、在什么场景下用、用得顺不顺，并把这些汇成一页可以核对的「AI 能力履历」。

为谁做、解决什么问题、为什么要上链，见 [愿景 README](../vision/README.md)：[为谁做](../vision/README.md#为谁做)、[我们看到的问题](../vision/README.md#我们看到的问题)、[我们的做法](../vision/README.md#我们的做法)、[为什么要用区块链](../vision/README.md#为什么要用区块链)、[整体架构](../vision/README.md#整体架构)。

## 比赛期间做了什么

赛前已有的索引和检索没有改动，新功能都写在新文件里。按领域的对照、提交数和复核命令见 [赛前已有与比赛期间新增](before-and-during.md)。

| 部分 | 目录 | 做什么 |
| --- | --- | --- |
| 合约 | `chain/` | KeyRegistry（加密公钥）、ShareRegistry（分享规则、打开回执、撤回）、SkillRegistry（Skill、版本、族谱）、UsageStats（按版本、按钱包去重的使用统计）。用户只签名，在线服务代付手续费 |
| 在线服务 | `service/` | Cloudflare Worker：代付上链、存放分享密文和 Skill 正文、按链上规则放行钥匙包、读取链上统计，并直接提供下面的公开网页 |
| CLI 与给 AI 用的 skill | `packages/`、`agent-skills/` | `obelisk wallet / share / skill / usage / resume`，每条会改动数据或上链的命令都先预览、再确认；5 个 skill 让你在 Claude Code 或 Codex 里用一句话完成这些操作 |
| 桌面 App | `app/` | Share tab、Skill tab（草稿审阅、已铸造 Skill 的调用量、钱包数、实测场景与各场景的顺利率、族谱）；按钮只复制 prompt，可以选择复制给 Claude Code 或 Codex |
| 「AI 能力履历」Skill | `minted-skills/ai-capability-resume/` | 一个准备拿去铸造的 Skill：用你的历史和链上记录生成一页履历，数字都由 Obelisk 计算 |
| Playground | `playground/` | 在一台电脑上让多个模拟用户用自己的数据、AI 助手和钱包真实跑流程，记录每次 `obelisk` 调用和数据出处，并发布成网页 |

## 怎么体验

从轻到重三种方式，任选。

### 1. 不安装：打开公开网页

都由在线服务直接提供，用手机或电脑浏览器打开即可。

| 页面 | 看什么 | 数据 |
| --- | --- | --- |
| [/market](https://obelisk-service.kinomotomiovo.workers.dev/market) | 链上已铸造的 Skill：作者、出生场景、真实调用、钱包数、衍生数 | 链上真实数据 |
| `/market/skills/<编号>`，例如 [/market/skills/2](https://obelisk-service.kinomotomiovo.workers.dev/market/skills/2) | 一个 Skill 的调用趋势、结果分布、作者描述与实测场景并排（每个场景各自的顺利率）、族谱、版本、链上记录，以及「取用」「在此基础上修改」的 prompt | 链上真实数据 |
| [/market/stage-2](https://obelisk-service.kinomotomiovo.workers.dev/market/stage-2) | 阶段 2 预览：上架定价、收入沿族谱怎么分、收入面板、按上下文付费 | 标明「阶段 2 预览」，数字都标「示例」；从某个 Skill 打开（`?skill=<编号>`）时，分成用它在链上的真实族谱 |
| [/preview](https://obelisk-service.kinomotomiovo.workers.dev/preview) | 项目预览：9 步演示闭环，同一步里并排显示各角色看到的画面，下方是链上时间线 | 目前是**示意内容**，页面上三处标明；Playground 正式跑完后换成真实运行 |
| `/s/<分享编号>` | 私密分享的网页阅读页：用浏览器钱包打开、在页面里解密、整页水印；不是指定的人看到拒绝页 | 需要一个分享链接，见下面第 3 种方式 |
| `/runs/<运行编号>` | Playground 运行记录：剧本进度、事件、关键截图、出处记录，每笔交易旁标出链上核对结果 | 页面和交易核对接口已上线；正式完整运行数据仍待发布（[#32](https://github.com/KinomotoMio/obelisk-hackathon/issues/32)） |

### 2. 在链上核对

- 服务当前连接的网络、合约地址和代付钱包：[/v1/chain](https://obelisk-service.kinomotomiovo.workers.dev/v1/chain)、[/v1/health](https://obelisk-service.kinomotomiovo.workers.dev/v1/health)。
- 合约地址、部署交易、每类操作的交易示例，以及主网部署后的记录：[BOT Chain 部署材料](mainnet.md)。测试网的四个合约已在 [scan.bohr.life](https://scan.bohr.life) 上验证源代码，打开地址后看 Code 一栏。
- 用户在本机签名，交易由代付钱包提交，所以在浏览器上看到的发送方是代付钱包，被调用的方法是 `…BySig`，签名人写在参数里。
- 链上只有规则、回执、指纹、计数和场景标签，没有 session 和 Skill 的内容。

### 3. 在自己的电脑上跑

需要 macOS（钱包私钥存在系统钥匙串里；Linux 需要 `secret-tool`）、Node.js 24、git、已登录的 Claude Code 或 Codex，以及装了 MetaMask 的浏览器。**不需要任何加密货币**，手续费由在线服务代付。

```bash
git clone -b hackathon https://github.com/KinomotoMio/obelisk-hackathon.git
cd obelisk-hackathon
sh scripts/hackathon-env.sh             # 构建 CLI、skill 和 App，在 ~/.obelisk-hackathon/ 下建独立环境
source ~/.obelisk-hackathon/env.sh      # 角色 A；加参数 b 进入角色 B
obelisk --build                         # 每个角色第一次进入时，用本机历史建索引
```

脚本不会改动已经安装的 Obelisk、`~/.obelisk`、`~/.claude` 或 `~/.codex`。两个角色各有自己的索引、Skill 库和钱包，用来模拟两个用户；在 `~/.obelisk-hackathon/workspace` 里打开 `claude` 或 `codex`，Obelisk 的 skill 已经装好；`cd app && npm run dev` 打开 App。完整说明见 [测试轮次 · 安装](../testing/README.md#安装每一轮通用)。

建议的体验顺序，每一步都写了「应该看到」什么：

| 想看什么 | 照着做 |
| --- | --- |
| 准备两个身份，激活钱包 | [第 1 轮 · 场景 0](../testing/round-01.md#场景-0准备两个身份) |
| 私密分享给一个 MetaMask 账户：拒绝页、水印、已读回执、撤回 | [第 1 轮 · 场景 4](../testing/round-01.md#场景-4私密分享角色-a-发给-metamask-账户) |
| 一句话沉淀 Skill，铸造，查看详情 | [第 1 轮 · 场景 1、2](../testing/round-01.md#场景-1一句话沉淀-skill角色-a) |
| 铸造「AI 能力履历」，另一个角色取用、生成履历、判断结果、上报 | [第 2 轮 · 场景 1、2](../testing/round-02.md#场景-1铸造ai-能力履历skill角色-a) |
| 看每个场景的顺利率，然后在它的基础上衍生 | [第 2 轮 · 场景 3](../testing/round-02.md#场景-3看实测场景然后衍生a-看b-改) |
| 用 Codex 接 App 复制的 prompt | [第 2 轮 · 场景 5](../testing/round-02.md#场景-5用-codex-接-app-的-prompt) |

## 哪些是真实的，哪些是示意

| 真实运行 | 示意或示例（页面上都有标注） |
| --- | --- |
| 四个合约、在线服务、代付上链、网页阅读页 | `/market/stage-2` 的价格、分成比例、收入（阶段 2 才实现） |
| `/market` 和 Skill 页上的调用量、钱包数、场景、顺利率、族谱，读自链上 | `/preview` 的画面和数据，直到 Playground 正式跑完 |
| CLI、App、给 AI 用的 skill：分享、沉淀、铸造、取用、判断、上报、衍生、履历 | `docs/vision/mockups/` 下的界面示意，以及仓库里标「演示数据」的截图 |
| Playground 的流水线（两次真实的 Codex 冒烟运行） | Playground 的演示数据：**还没有正式跑**，见 [演示脚本](demo-script.md#发布与演示安排) |

愿景和现状之间每一项差距及原因，见 [第 2 轮 · 愿景和现状的差距](../testing/round-02.md#三愿景和现状的差距)。评审时常见的质疑和回答见 [问答准备](qa.md)。

## 沿用的代码与第三方组件

见 [赛前已有与比赛期间新增 · 沿用的代码、素材和第三方组件](before-and-during.md#沿用的代码素材和第三方组件)。
