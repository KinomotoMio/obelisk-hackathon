# BOT Chain 主网部署材料

> 草稿，对应 [KinomotoMio/obelisk-hackathon#37](https://github.com/KinomotoMio/obelisk-hackathon/issues/37) 和 [#5](https://github.com/KinomotoMio/obelisk-hackathon/issues/5)。参与主网部署协作的项目需要补充可核验的 **BOT Chain Mainnet 区块浏览器链接、交易记录，以及合约或应用地址**（选手手册 §5.2）。只部署到测试网不算有效部署（§5.1.2）。
>
> **现状：主网还没有部署**（等待主网 BOT，见 #5）。下面主网部分的 `待填` 在部署后填写；测试网部分是现在实际在用的地址。

## 网络

| | 主网 | 测试网 |
| --- | --- | --- |
| Chain ID | 677 | 968 |
| RPC | `https://rpc.botchain.ai` | `https://rpc.bohr.life` |
| 区块浏览器 | <https://scan.botchain.ai> | <https://scan.bohr.life> |
| 部署记录文件 | `chain/deployments/677.json`（部署后生成） | [`chain/deployments/968.json`](../../chain/deployments/968.json) |

部署方法见 [`chain/README.md`](../../chain/README.md)：主网（`npm run deploy:mainnet`）和测试网用同一份合约代码和同一个流程，部署脚本可以从中断处继续。部署后要在浏览器上验证源代码（路线图阶段 0 的验收条件；验证方法还没有写进文档）。

## 合约地址

### 主网（待部署）

| 合约 | 作用 | 地址 | 部署交易 | 源码已验证 |
| --- | --- | --- | --- | --- |
| KeyRegistry | 钱包的加密公钥登记 | `待填` | `待填` | ☐ |
| ShareRegistry | 分享规则、打开回执、撤回 | `待填` | `待填` | ☐ |
| SkillRegistry | Skill 资产、版本、族谱 | `待填` | `待填` | ☐ |
| UsageStats | 按版本、按钱包去重的使用统计 | `待填` | `待填` | ☐ |

浏览器链接格式：`https://scan.botchain.ai/address/<地址>`、`https://scan.botchain.ai/tx/<交易哈希>`。

### 测试网（当前在用，2026-10-06 部署）

| 合约 | 地址 | 部署交易 |
| --- | --- | --- |
| KeyRegistry | [`0x82450C2AA0aE363b363C04E5eabA6Ee1d92D1dDE`](https://scan.bohr.life/address/0x82450C2AA0aE363b363C04E5eabA6Ee1d92D1dDE) | [`0xeeb92315…2585d`](https://scan.bohr.life/tx/0xeeb92315005d4c6bf7ad5827551f36dbc1a8115c813ad89f703878e89bd2585d) |
| ShareRegistry | [`0x81B4B63d101941ffeb2Da61754981796eC2DD8dd`](https://scan.bohr.life/address/0x81B4B63d101941ffeb2Da61754981796eC2DD8dd) | [`0x2392af17…83891`](https://scan.bohr.life/tx/0x2392af17b3a12469e8aaf75a06367ec800dfc24d8f96a79a71c6670a99f83891) |
| SkillRegistry | [`0xD42208e780225e90C5DE7f56A7F007058230900b`](https://scan.bohr.life/address/0xD42208e780225e90C5DE7f56A7F007058230900b) | [`0xbf8bbb35…58ec7`](https://scan.bohr.life/tx/0xbf8bbb355763169dcb3d6da2f4afb06f68cea78e3315e1a714a769f1a4358ec7) |
| UsageStats | [`0x84b17B83C976E2b0C447A4df09c52D80e4f40B98`](https://scan.bohr.life/address/0x84b17B83C976E2b0C447A4df09c52D80e4f40B98) | [`0x484c7d6b…72542`](https://scan.bohr.life/tx/0x484c7d6b07cea1cc76c8d8ca15995b0f7fc7e4c16a8bde2ffd9202122ac72542) |

## 应用地址

| | 地址 | 说明 |
| --- | --- | --- |
| 在线服务 | `待填`（主网配置的 Worker 地址） | 代付上链、存放密文和 Skill 正文、读取链上统计 |
| 网页阅读页 | `待填`（在线服务地址下的 `/reader/`） | 接收者用浏览器钱包打开分享 |
| 代付钱包 | `待填` | 服务用它为用户的签名付手续费；可在浏览器上看到它发出的全部交易 |

## 演示中产生的交易

每一笔都是用户在本机签名、由在线服务代付提交的。演示时按 [演示脚本](demo-script.md) 的顺序记录，交易哈希填进下表。

| 演示步骤 | 合约 · 方法 | 谁签名 | 主网交易 |
| --- | --- | --- | --- |
| A、B 激活钱包（登记加密公钥） | KeyRegistry · `registerKeyBySig` | A、B | `待填` |
| A 把 session 片段分享给 B，只能打开 1 次 | ShareRegistry · `createShareBySig` | A | `待填` |
| B 打开分享，写入已读回执 | ShareRegistry · `recordOpenBySig` | B | `待填` |
| A 铸造「AI 能力履历」Skill | SkillRegistry · `mintBySig` | A | `待填` |
| （可选）A 发布新版本 | SkillRegistry · `publishVersionBySig` | A | `待填` |
| U 的调用汇总上报 | UsageStats · `reportBySig` | U | `待填` |
| D 在它基础上衍生「设计师作品集」版并铸造（链上记录父 Skill） | SkillRegistry · `mintBySig` | D | `待填` |
| U 把佐证 session 私密分享给招聘方 | ShareRegistry · `createShareBySig` | U | `待填` |
| （可选）撤回一个分享 | ShareRegistry · `revokeBySig` | 分享者 | `待填` |

C 打开转发链接被拒绝这一步不产生交易：服务按链上规则拒绝放行钥匙包。

## 部署前后检查

- [ ] 拿到主网 BOT（#5），代付钱包有余额
- [ ] `cd chain && npm run deploy:mainnet`，提交生成的 `chain/deployments/677.json`
- [ ] 在 scan.botchain.ai 上验证四个合约的源代码
- [ ] `npm run sync:chain`，把主网地址写进 `packages/core/src/chain-protocol.ts`（CLI 只信任这里固定的地址），重新构建 CLI 和 App
- [ ] 在线服务的 `CHAIN_ID` 改为 677（`service/wrangler.jsonc`），重新部署 Worker
- [ ] 按演示脚本跑一遍，把交易哈希填进上表
- [ ] 逐个打开上面的链接，确认能访问
