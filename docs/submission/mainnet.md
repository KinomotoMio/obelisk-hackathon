# BOT Chain 主网部署材料

> 草稿，对应 [KinomotoMio/obelisk-hackathon#37](https://github.com/KinomotoMio/obelisk-hackathon/issues/37) 和 [#5](https://github.com/KinomotoMio/obelisk-hackathon/issues/5)。参与主网部署协作的项目需要补充可核验的 **BOT Chain Mainnet 区块浏览器链接、交易记录，以及合约或应用地址**（选手手册 §5.2）。只部署到测试网不算有效部署（§5.1.2）。
>
> **现状：五份主网合约已部署并验证源码，独立 Worker 已发布；少量业务交易验证进行中**。按 2026-10-08 确认的顺序，先在测试网完成本轮功能和合约验收，固定代码版本，再部署主网并跑少量真实业务验证。路演和大量 Playground 数据保留在测试网，两网使用独立的 Worker。下面主网部分的 `待填` 在部署后填写。

## 网络

| | 主网 | 测试网 |
| --- | --- | --- |
| Chain ID | 677 | 968 |
| RPC | `https://rpc.botchain.ai` | `https://rpc.bohr.life` |
| 区块浏览器 | <https://scan.botchain.ai> | <https://scan.bohr.life> |
| 部署记录文件 | `chain/deployments/677.json`（部署后生成） | [`chain/deployments/968.json`](../../chain/deployments/968.json) |

部署方法见 [`chain/README.md`](../../chain/README.md)：主网（`npm run deploy:mainnet`）和测试网用同一份合约代码和同一个流程，部署脚本可以从中断处继续。部署后在浏览器上验证源代码（路线图阶段 0 的验收条件）：`npm run verify:mainnet`，不需要私钥，已验证过的合约会跳过，见 [Verifying the source on the explorer](../../chain/README.md#verifying-the-source-on-the-explorer)。切换步骤和分工见 [Switching to mainnet (#5)](../../chain/README.md#switching-to-mainnet-5)。

## 合约地址

### 主网（五份合约已部署并验证源码）

| 合约 | 作用 | 地址 | 部署交易 | 源码已验证 |
| --- | --- | --- | --- | --- |
| KeyRegistry | 钱包的加密公钥登记 | [0xB4Ce21215B5391BE78eE57B06bc62565A15612Fc](https://scan.botchain.ai/address/0xB4Ce21215B5391BE78eE57B06bc62565A15612Fc) | [交易](https://scan.botchain.ai/tx/0x28e99b2d0f486518d472cf0e5f8058f9802712c5500d3632720d2814a9fa9c21) | ✓ |
| ShareRegistry | 分享规则、打开回执、撤回 | [0x09d4E24eF0b1A40bBEC8077a5604cD9b9bBa28A6](https://scan.botchain.ai/address/0x09d4E24eF0b1A40bBEC8077a5604cD9b9bBa28A6) | [交易](https://scan.botchain.ai/tx/0xa439d58f88cba74c919bb33ddeb73b3d922e2c84a2453d402a8540ca298b70de) | ✓ |
| SkillRegistry | Skill 资产、版本、族谱 | [0x5B883c195AfE86f7D380a1f7d5a305f1807B5702](https://scan.botchain.ai/address/0x5B883c195AfE86f7D380a1f7d5a305f1807B5702) | [交易](https://scan.botchain.ai/tx/0xe73c5b60206cef3b7e61c894842c2681ea524fc5598bdb81110029eef66069e6) | ✓ |
| UsageStats | 按版本、按钱包去重的使用统计 | [0xa36A4775840b4C5730fA6c3d87D6F877c48ce2aB](https://scan.botchain.ai/address/0xa36A4775840b4C5730fA6c3d87D6F877c48ce2aB) | [交易](https://scan.botchain.ai/tx/0xa492c047b427ea5fbd9dc59a5a606429e4124c8fcd7b7a9f7ba7ff53beb356da) | ✓ |
| SkillMarket | 定价、授权取用与多层收入分配 | [0x58C501431532E0e69703587194E3376A804F4A23](https://scan.botchain.ai/address/0x58C501431532E0e69703587194E3376A804F4A23) | [交易](https://scan.botchain.ai/tx/0x7bea027cdbd5d296cdb189ea751a06c5625b7365aa5fa265c9472be753bff892) | ✓ |

浏览器链接格式：`https://scan.botchain.ai/address/<地址>`、`https://scan.botchain.ai/tx/<交易哈希>`。

### 测试网（当前在用，2026-10-06 部署）

五个合约均已验证源码；SkillMarket 在 2026-10-08 新增部署。编译参数及本轮冻结版本见 [发布清单](release-freeze.json)。

| 合约 | 地址 | 部署交易 |
| --- | --- | --- |
| KeyRegistry | [`0x82450C2AA0aE363b363C04E5eabA6Ee1d92D1dDE`](https://scan.bohr.life/address/0x82450C2AA0aE363b363C04E5eabA6Ee1d92D1dDE) | [`0xeeb92315…2585d`](https://scan.bohr.life/tx/0xeeb92315005d4c6bf7ad5827551f36dbc1a8115c813ad89f703878e89bd2585d) |
| ShareRegistry | [`0x81B4B63d101941ffeb2Da61754981796eC2DD8dd`](https://scan.bohr.life/address/0x81B4B63d101941ffeb2Da61754981796eC2DD8dd) | [`0x2392af17…83891`](https://scan.bohr.life/tx/0x2392af17b3a12469e8aaf75a06367ec800dfc24d8f96a79a71c6670a99f83891) |
| SkillRegistry | [`0xD42208e780225e90C5DE7f56A7F007058230900b`](https://scan.bohr.life/address/0xD42208e780225e90C5DE7f56A7F007058230900b) | [`0xbf8bbb35…58ec7`](https://scan.bohr.life/tx/0xbf8bbb355763169dcb3d6da2f4afb06f68cea78e3315e1a714a769f1a4358ec7) |
| UsageStats | [`0x84b17B83C976E2b0C447A4df09c52D80e4f40B98`](https://scan.bohr.life/address/0x84b17B83C976E2b0C447A4df09c52D80e4f40B98) | [`0x484c7d6b…72542`](https://scan.bohr.life/tx/0x484c7d6b07cea1cc76c8d8ca15995b0f7fc7e4c16a8bde2ffd9202122ac72542) |

## 应用地址

2026-10-08 用户调整：现有数据用于 Demo，工具读取计量缺口后置，不再阻止主网发布。业务冻结 `bbe06198b5722bf8452382d4ef16f565c94375e8`；主网五份合约已部署，实际手续费 0.12109314 BOT；独立 Worker 已发布。测试网 SkillMarket 为 [`0x69a63ceCB9753CAe115Ae9a272586568e871d360`](https://scan.bohr.life/address/0x69a63ceCB9753CAe115Ae9a272586568e871d360)，[部署交易](https://scan.bohr.life/tx/0x6c855aa6f315d4af742e0099ade23a4e8c1e90b56802e81a372e55ea04b51750)。

| | 地址 | 说明 |
| --- | --- | --- |
| 在线服务 | `待填`（主网配置的 Worker 地址） | 代付上链、存放密文和 Skill 正文、读取链上统计 |
| 网页阅读页 | `待填`（在线服务地址下的 `/s/<分享编号>`） | 接收者用浏览器钱包打开分享 |
| Skill 市场 | `待填`（在线服务地址下的 `/market`） | 已铸造的 Skill、真实调用量、场景、族谱；`/market/stage-2` 是阶段 2 预览 |
| 代付钱包 | `待填` | 服务用它为用户的签名付手续费；可在浏览器上看到它发出的全部交易 |
| Playground 运行记录 | `待填`（在线服务地址下的 `/runs/<运行编号>`） | 演示数据从哪次运行来、每笔交易的链上核对结果；需要发布一次真实运行（[#32](https://github.com/KinomotoMio/obelisk-hackathon/issues/32)） |
| 项目预览 | `待填`（在线服务地址下的 `/preview`） | 演示闭环逐步播放；换成真实运行后，每笔交易链接到浏览器 |

测试网上，以上页面都在 `https://obelisk-service.kinomotomiovo.workers.dev` 下，`/runs` 页面和 `/v1/txs` 已于 2026-10-07 部署并验证；正式 Playground 运行数据仍待发布。测试网代付钱包是 [`0x2f8A318ad91cBa234Af92ad6029F9bE395a20F9f`](https://scan.bohr.life/address/0x2f8A318ad91cBa234Af92ad6029F9bE395a20F9f)。主网使用独立的 Worker，其服务地址和代付配置在发布时记录。

### 测试网上已有的交易示例

主网部署前，评委可以用这些测试网交易核对「用户签名、服务代付」的方式。每类操作取一笔，时间为北京时间 2026-10-07，取自 scan.bohr.life。

| 操作 | 合约 · 方法 | 交易 | 时间 |
| --- | --- | --- | --- |
| 激活钱包（登记加密公钥） | KeyRegistry · `registerKeyBySig` | [`0x81c2032c…6ae56`](https://scan.bohr.life/tx/0x81c2032c6ddfd5346abb459e8bdd4c448edf116df3bb4dfcf13b073812f6ae56) | 14:01 |
| 创建私密分享 | ShareRegistry · `createShareBySig` | [`0xdd195c25…54e9f`](https://scan.bohr.life/tx/0xdd195c25e33bbe813297b3a6d0b687feeda74b87bbc27c8572ac28863df54e9f) | 14:21 |
| 打开分享，写入已读回执 | ShareRegistry · `recordOpenBySig` | [`0xeaca66fd…ffb05`](https://scan.bohr.life/tx/0xeaca66fd7dddbf27059a69c0f8c79b2f576b64d273daa3a6d01baeee991ffb05) | 14:23 |
| 撤回分享 | ShareRegistry · `revokeBySig` | [`0x1407958e…0a59f`](https://scan.bohr.life/tx/0x1407958e91871cd4c645b0957914b434a092f34ebb07fe6e4dba3ccf1620a59f) | 14:40 |
| 铸造「AI 能力履历」（Skill #4） | SkillRegistry · `mintBySig` | [`0xfecf6cb0…6104a`](https://scan.bohr.life/tx/0xfecf6cb0e45b3cca2e15c93607f32f4921e50d060eac430cc3aa5614b2f6104a) | 16:00 |
| 上报使用情况（Skill #2，带场景和结果） | UsageStats · `reportBySig` | [`0xf7c88f08…7de93`](https://scan.bohr.life/tx/0xf7c88f08488f3c26db023ad2390303d48b32ba0969e7894967fb2991cdc7de93) | 14:39 |

测试网上还没有衍生 Skill（`parentSkillId` 不为空的铸造）；本地链上已验证过（[#20](https://github.com/KinomotoMio/obelisk-hackathon/issues/20)）。

## 主网验证交易（按预算选取）

每一笔都是用户在本机签名、由在线服务代付提交的。下面列出可选的验证操作；根据预算选取能够证明真实业务可用的一组，填写对应哈希，不要求把整套路演和所有 Playground 调用重跑到主网。未执行的操作注明未执行，不用测试网交易填进主网列。

| 演示步骤 | 合约 · 方法 | 谁签名 | 主网交易 |
| --- | --- | --- | --- |
| A、B 激活钱包（登记加密公钥） | KeyRegistry · `registerKeyBySig` | A、B | `待填` |
| A 把 session 片段分享给 B，只能打开 1 次 | ShareRegistry · `createShareBySig` | A | `待填` |
| B 打开分享，写入已读回执 | ShareRegistry · `recordOpenBySig` | B | `待填` |
| A 铸造「AI 能力履历」Skill | SkillRegistry · `mintBySig` | A | `待填` |
| （可选）A 发布新版本 | SkillRegistry · `publishVersionBySig` | A | `待填` |
| U 的调用汇总上报（场景和结果的桶超过 32 个时分成几笔） | UsageStats · `reportBySig` | U | `待填` |
| D 在它基础上衍生「设计师作品集」版并铸造（链上记录父 Skill） | SkillRegistry · `mintBySig` | D | `待填` |
| U 把佐证 session 私密分享给招聘方 | ShareRegistry · `createShareBySig` | U | `待填` |
| （可选）撤回一个分享 | ShareRegistry · `revokeBySig` | 分享者 | `待填` |

C 打开转发链接被拒绝这一步不产生交易：服务按链上规则拒绝放行钥匙包。

## 部署前后检查

- [ ] 测试网完成本轮功能和合约验收，包括收入分账及 Playground 的真实 AI 数据；记录验收范围和结果
- [ ] 固定发布提交、最终合约清单、编译参数和 ABI；新增市场合约如纳入本轮，必须先在测试网验收并更新部署清单
- [ ] 拿到主网 BOT（#5），代付钱包有余额
- [ ] `cd chain && npm run deploy:mainnet`，提交生成的 `chain/deployments/677.json`
- [ ] `npm run verify:mainnet`，在 scan.botchain.ai 上确认四个合约都显示已验证
- [ ] `npm run sync:chain`，把主网地址写进 `packages/core/src/chain-protocol.ts`（CLI 只信任这里固定的地址），重新构建 CLI 和 App
- [ ] 准备并部署独立的主网 Worker，配置 `CHAIN_ID: 677` 和独立的数据绑定；主网 `/v1/health` 返回 677，原测试网 Worker 仍返回 968，记录两个地址
- [ ] 主网验证使用独立的数据目录及主网服务地址：仅为参与主网验证的钱包重新激活、重新铸造所需 Skill；测试网记录和数据继续保留
- [ ] 大量 Playground 数据和主要演示剧本保持测试网 968；如用剧本验证主网，另建少量操作的主网剧本并明确选择主网服务
- [ ] 跑预算内选定的主网业务验证，把交易哈希填进上表并记录实际费用
- [ ] 逐个打开上面的链接，确认能访问

## 已完成的少量主网业务

激活钱包与发布 Skill #1 均已确认；含五份合约部署的总花费为 **0.13229802 BOT**，初始 0.5 BOT 剩余 **0.36770198 BOT**。[交易和费用记录](mainnet-smoke.json)。[主网 Skill #1](https://obelisk-service-mainnet.kinomotomiovo.workers.dev/market/skills/1) 已在线可读。测试网继续保留全部演示数据。
