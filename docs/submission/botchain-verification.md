# BOT Chain 赛道最终核验材料

> 对应评审组 2026-10 提出的七项核验要求。线上页面 [/#verify](https://obelisk-service-mainnet.kinomotomiovo.workers.dev/#verify) 按同样的七项排列，每一项都可以直接操作或打开区块浏览器核对。

## 项目意义

AI 编程时代，最有价值的经验藏在一次次真实的协作会话里：怎么拆任务、怎么验收、踩过哪些坑。它们很快被遗忘，就算被整理成「提示词」「技能包」分享出去，买的人也无从判断它是否真的好用，最初分享的人也得不到回报。

Obelisk 原本是给 coding agent 用的显式记忆基础设施：在本地索引 Claude Code、Codex 等会话，让回答可以追溯到原始上下文。这次参赛版本在它之上加了一层 **BOT Chain 上的知识价值流转**，让「知识付费」从描述走向证据：

- **出处可查**：经验沉淀成 Skill 时，作者、版本、内容指纹和父 Skill 写进 SkillRegistry；正文任何改动都会让指纹对不上。
- **效果可证**：使用者本机的 AI 判断每次调用的场景和结果，按版本、按钱包去重上报到 UsageStats。市场上的调用量和顺利率读自链上，平台没法刷高，也没法删掉差评。
- **回报可分**：在 SkillMarket 上，一次购买按链上族谱自动拆分给作者、上游作者和平台。在别人方法上改进的人得到收入，最初愿意分享的人也一起受益。
- **分享可控**：私密分享的打开次数、有效期和撤回规则写在 ShareRegistry，每次打开都留下回执，转发的链接打不开。

用户只做签名：可以自己发送交易，也可以由服务代付手续费，合约只认签名者。

> AI-Native should be context native first.

## 项目与链接

| 项目 | 链接 |
| --- | --- |
| 线上产品（BOT Chain 主网） | <https://obelisk-service-mainnet.kinomotomiovo.workers.dev> |
| 评审核验（七项一页核对） | <https://obelisk-service-mainnet.kinomotomiovo.workers.dev/#verify> |
| 链上体验：连接钱包并发起主网交易 | <https://obelisk-service-mainnet.kinomotomiovo.workers.dev/activate> |
| Skill 市场（主网数据） | <https://obelisk-service-mainnet.kinomotomiovo.workers.dev/market> |
| Demo 录屏（4:55） | <https://obelisk-service-mainnet.kinomotomiovo.workers.dev/#demo> |
| GitHub 仓库（公开） | <https://github.com/KinomotoMio/obelisk-hackathon/tree/hackathon> |
| 测试网站点（Playground 演示数据） | <https://obelisk-service.kinomotomiovo.workers.dev> |

## 七项核验要求逐项对应

| # | 评审要求 | 我们的回应 |
| --- | --- | --- |
| 1 | 最新可访问的产品或 Demo 链接 | 主网站点即线上产品；首页含 Demo 录屏、产品导览、Skill 市场 |
| 2 | GitHub 仓库或可审核的代码 | 公开仓库 `KinomotoMio/obelisk-hackathon`，`hackathon` 分支；合约源码在 `chain/contracts/` |
| 3 | 明确的 Connect Wallet 入口，支持 MetaMask、OKX Wallet 等 | 每个页面右上角「连接钱包」；EIP-6963 自动识别已安装的 EVM 钱包（MetaMask、OKX Wallet、Rabby 等），未安装时给出安装入口 |
| 4 | 可切换至 BOT Chain Mainnet（Chain ID 677） | 钱包菜单、首页核验区和链上体验页都有「切换到 BOT Chain 主网」；钱包里没有该网络时自动以 `https://rpc.botchain.ai`、`https://scan.botchain.ai` 添加 |
| 5 | 主网合约地址及区块浏览器链接 | 见下方「主网合约」，五份合约源码均已验证 |
| 6 | 至少一笔用户钱包签名并成功发起的主网交易 | MetaMask 钱包 `0x13E2…8261` 在 Skill 市场签名并**自己发送**两笔 `SkillMarket.buyBySig`（领取 #1、以 0.003 BOT 购买 #4），`from` 即用户地址；#4 的付款在同一笔交易里按族谱分给四方。链上体验页同样支持钱包自己发送 `registerKeyBySig`。服务按链上回执核对后收录，首页实时列出。见下方「用户钱包发起的主网交易」 |
| 7 | BOT Chain 在产品中的实际应用说明 | 见上方「项目意义」与下方「BOT Chain 在产品中做什么」；Skill 市场可直接用钱包购买或领取 |

## 主网合约（BOT Chain Mainnet · Chain ID 677）

| 合约 | 作用 | 地址 | 部署交易 |
| --- | --- | --- | --- |
| KeyRegistry | 钱包加密公钥登记 | [0xB4Ce21215B5391BE78eE57B06bc62565A15612Fc](https://scan.botchain.ai/address/0xB4Ce21215B5391BE78eE57B06bc62565A15612Fc) | [0x28e99b2d…](https://scan.botchain.ai/tx/0x28e99b2d0f486518d472cf0e5f8058f9802712c5500d3632720d2814a9fa9c21) |
| ShareRegistry | 私密分享规则、打开回执、撤回 | [0x09d4E24eF0b1A40bBEC8077a5604cD9b9bBa28A6](https://scan.botchain.ai/address/0x09d4E24eF0b1A40bBEC8077a5604cD9b9bBa28A6) | [0xa439d58f…](https://scan.botchain.ai/tx/0xa439d58f88cba74c919bb33ddeb73b3d922e2c84a2453d402a8540ca298b70de) |
| SkillRegistry | Skill 资产、版本、族谱 | [0x5B883c195AfE86f7D380a1f7d5a305f1807B5702](https://scan.botchain.ai/address/0x5B883c195AfE86f7D380a1f7d5a305f1807B5702) | [0xe73c5b60…](https://scan.botchain.ai/tx/0xe73c5b60206cef3b7e61c894842c2681ea524fc5598bdb81110029eef66069e6) |
| UsageStats | 按版本、按钱包去重的真实使用统计 | [0xa36A4775840b4C5730fA6c3d87D6F877c48ce2aB](https://scan.botchain.ai/address/0xa36A4775840b4C5730fA6c3d87D6F877c48ce2aB) | [0xa492c047…](https://scan.botchain.ai/tx/0xa492c047b427ea5fbd9dc59a5a606429e4124c8fcd7b7a9f7ba7ff53beb356da) |
| SkillMarket | 定价、授权取用、多层收入分配 | [0x58C501431532E0e69703587194E3376A804F4A23](https://scan.botchain.ai/address/0x58C501431532E0e69703587194E3376A804F4A23) | [0x7bea027c…](https://scan.botchain.ai/tx/0x7bea027cdbd5d296cdb189ea751a06c5625b7365aa5fa265c9472be753bff892) |

## 用户钱包发起的主网交易

在 [Skill 市场](https://obelisk-service-mainnet.kinomotomiovo.workers.dev/market/skills/1) 用浏览器钱包（MetaMask）完成：连接 → 切换到 677 → EIP-712 签名 `BuySkill` → **钱包自己发送** `SkillMarket.buyBySig` → 页面取回正文并给出安装 prompt。[链上体验](https://obelisk-service-mainnet.kinomotomiovo.workers.dev/activate) 同样支持钱包自己发送 `KeyRegistry.registerKeyBySig`。

| 事项 | 发起钱包 | 交易 |
| --- | --- | --- |
| MetaMask 领取 Skill #1，钱包自己发送 `SkillMarket.buyBySig` | [0x13E2…8261](https://scan.botchain.ai/address/0x13E23Bf9567e15Dc3DeFd14adD6AE96B99598261) | [0x644495d2…38a8](https://scan.botchain.ai/tx/0x644495d222f111a9eeca5f993a6a0234080b0dc4564d2a4942962c9af45a38a8) |
| MetaMask 以 0.003 BOT 购买 Skill #4，钱包自己发送 `SkillMarket.buyBySig` | [0x13E2…8261](https://scan.botchain.ai/address/0x13E23Bf9567e15Dc3DeFd14adD6AE96B99598261) | [0xeeee3529…2dc4](https://scan.botchain.ai/tx/0xeeee3529d6c70710c1a0c7546ffc39b878241d47d3dc4fce6f7dc4ff7f6c2dc4) |

两次购买之后，同一钱包各签了一次 `UseSkill`，由服务代付记录取用：[#1 0x2ab49e66…9220](https://scan.botchain.ai/tx/0x2ab49e66a12dbe71898449e75a6397c60b1c108ffcc93d6cf6b6f16f46b99220)、[#4 0xe0a6cb5b…4aee](https://scan.botchain.ai/tx/0xe0a6cb5ba50b5722525b405c4608995efd1389dc693ecf4858312b1839034aee)。

#4 购买交易里的 4 条 `Allocated` 事件（合约直接转账，0.003 BOT 全部分完）：

| 收款方 | 依据 | 金额 |
| --- | --- | --- |
| 平台 `0x9107…2EcB` | 平台抽成 5% | 0.00015 BOT |
| #4 作者 `0x095E…AeD5F` | 余下 0.00285 的 90%（10% 作为版税上交父 Skill #2） | 0.002565 BOT |
| #2 作者 `0x095E…AeD5F` | 收到 0.000285，再把其中 10% 上交父 Skill #1 | 0.0002565 BOT |
| #1 作者 `0xACb1…69C8` | 族谱根节点 | 0.0000285 BOT |

收录记录可通过 `GET /v1/direct` 读取（只收录 `from` 不是代付钱包、调用 Obelisk 合约且回执成功的交易）。

### 其他主网业务交易（用户签名、服务代付）

这些交易由用户钱包做 EIP-712 签名，由在线服务的代付钱包 [`0x9107…2EcB`](https://scan.botchain.ai/address/0x9107284f2301E9084d8c43b9D6379dfAA6d72EcB) 提交；合约以签名者为行为人。

| 事项 | 合约 · 方法 | 交易 |
| --- | --- | --- |
| 激活钱包（登记加密公钥） | KeyRegistry · `registerKeyBySig` | [0x544aa99a…](https://scan.botchain.ai/tx/0x544aa99ae13fc4d8a7ef29978ccbd6b55de8dc85272cbf5b9d264d5efaef1161) |
| 铸造 Skill #1 | SkillRegistry · `mintBySig` | [0xc75eb72f…](https://scan.botchain.ai/tx/0xc75eb72fed195d9f5887448ea62688bec76e31b7f24509f3e7d5f9d34c4af8fc) |
| 上报真实使用 · Skill #1 | UsageStats · `reportBySig` | [0xc3ccc4a0…](https://scan.botchain.ai/tx/0xc3ccc4a0aa3ee1bd2440a107be152c5dc3506c1776099bdbf3fbc6e4dc4a6787) |
| 上报真实使用 · Skill #2 | UsageStats · `reportBySig` | [0xe92de504…](https://scan.botchain.ai/tx/0xe92de504d9965830ca328d86ad2108010142e1712f07b830524525aa57ee1b58) |
| 上报真实使用 · Skill #3 | UsageStats · `reportBySig` | [0x5dd68af1…](https://scan.botchain.ai/tx/0x5dd68af18304c09a8eacda4fcc27c44345420f4371bc26544cb62b42a3b10e01) |
| 上报真实使用 · Skill #4 | UsageStats · `reportBySig` | [0x152c6bc8…](https://scan.botchain.ai/tx/0x152c6bc8b9933c930bde2e45782f52a32f56b5f122399902090abbc9cc3c178f) |

## 在网页上用钱包购买 Skill，并交给自己的 Agent

Skill 详情页（例如 [主网 Skill #2](https://obelisk-service-mainnet.kinomotomiovo.workers.dev/market/skills/2)）提供「用钱包购买 / 免费领取」：

1. 钱包签名 `BuySkill`，**由买家自己的钱包**发送 `SkillMarket.buyBySig` 并支付价格；合约当场按族谱分账（平台 5%，其余按上游版税分给各级作者）。免费 Skill 只付手续费。
2. 钱包签名 `UseSkill`，由服务代付把这次取用记录到链上（`useBySig`）。
3. 钱包签名 `SkillAccess`，服务凭链上取用回执放出正文；浏览器用 SHA-256 核对正文与链上版本指纹一致后才显示。
4. 页面给出 SKILL.md 下载和一段可直接粘贴给 Claude Code / Codex 的 prompt：装有 Obelisk 时用 `obelisk skill fetch <指纹> --receipt <取用回执> --access <浏览器签好的授权>` 安装，会核对指纹并记录安装，之后的真实使用能上报回 UsageStats，形成「购买 → 使用 → 效果上链」的闭环；没有 Obelisk 也可以直接保存 SKILL.md。

已持有授权的钱包或作者本人跳过付款，只需重新签名取用。

| Skill | 方案 | 状态 |
| --- | --- | --- |
| #1 ai-building-collaboration | 免费领取，上游版税 10% | 已上架 · [0x028de29c…](https://scan.botchain.ai/tx/0x028de29c18c4d9f7021a433d9aec30d64d4fae68ef6a8a65f534ee716551dda4) |
| #2 ai-building-half-hour-review（基于 #1） | 0.002 BOT 买断，上游版税 10% | 已上架 · [0x129fd557…](https://scan.botchain.ai/tx/0x129fd55798586e7b3db65472c8018df99b9cc71a39abc88835c3f7538ff0a2da) |
| #3 small-project-evidence-loop | 免费领取 | 已上架 · [0xb2fd96c1…](https://scan.botchain.ai/tx/0xb2fd96c184f498117901c805394b368dd02d353db9675e3b39dbd9ef0140cd9c) |
| #4 scope-change-handoff（基于 #2） | 0.003 BOT 买断 | 已上架 · [0xc27b8f99…](https://scan.botchain.ai/tx/0xc27b8f99e8aa1c4ed077aa5139b3fa33dcc8b97e37b36a45bee9e4fd5a657f1b) |

上架由各作者的本机钱包签名 `ListSkill`、服务代付提交（`service/scripts/mainnet-list-offers.mjs`）。主网四个 Skill 的正文本来就公开，购买获得的是链上授权与对作者、上游作者的回报；付费正文（licensed）的完整流程已在本地链测试中验证（`service/test/market-web-local-chain.test.mjs`）。

## BOT Chain 在产品中做什么

| 用户动作 | 合约 | 在哪里发生 |
| --- | --- | --- |
| 激活钱包，之后才能接收加密分享 | KeyRegistry | 网页「链上体验」、CLI、桌面 App |
| 把 session 片段私密分享给指定钱包，限定打开次数和有效期；打开留回执；撤回 | ShareRegistry | CLI / App 发送，网页阅读页 `/s/<分享编号>` 打开 |
| 把方法沉淀为 Skill：作者、版本、内容指纹、父 Skill | SkillRegistry | CLI / App 铸造，市场页读取 |
| 本机 AI 判断场景和结果，按版本、按钱包去重上报 | UsageStats | CLI 上报，市场页的调用量、顺利率读自链上 |
| 定价发布、购买、按族谱多层分成 | SkillMarket | 网页 Skill 详情页用钱包购买、CLI / App，平台运营页 `/operations` 核对 |

用户只做签名（EIP-712），可以自己发送交易，也可以由服务代付手续费；合约只认签名者。BOT Chain 不提供 `eth_getLogs`，所以页面上的数字通过合约的 view 函数读取（`GET /v1/stats`）。

## 代码位置

| 层 | 路径 | 作用 |
| --- | --- | --- |
| 合约 | `chain/contracts/*.sol`、`chain/deployments/677.json` | 源码与主网部署记录 |
| 钱包连接 | `service/public/site/wallet.js` | EIP-6963 发现、连接、切换/添加 677、顶栏钱包菜单 |
| 链上体验 | `service/public/reader/app.js`（`bootActivate`） | 四步引导：连接、切网、解锁密钥、签名并由钱包发送 |
| 首页 | `service/public/start/` | Landing Page 与七项核验区 |
| 网页购买 | `service/public/market/buy.js` | 钱包购买、链上取用、正文核对、Agent 安装 prompt |
| CLI | `packages/cli/src/skill-fetch-command.ts` | `--access`：用浏览器钱包签好的授权安装已购 Skill |
| 服务端 | `service/src/direct.ts` | `POST /v1/direct/prepare`（与代付相同的预检后返回钱包要发送的调用）、`POST/GET /v1/direct`（收录钱包直发交易）、`GET /v1/stats` |
| 服务端 | `service/src/relayer.ts`、`service/src/actions.ts` | 签名预检与代付提交；`ListSkill`、`UseSkill` 可代付，`BuySkill` 只能由买家钱包发送 |
| 测试 | `service/test/direct-local-chain.test.mjs`、`service/test/market-web-local-chain.test.mjs` | 本地链上：钱包自付发送与收录；代付交易与伪造签名不计入；上架代付、买家付款、族谱分账、取用与付费正文交付 |
