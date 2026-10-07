# 两网发布与回退

对应 #44。测试网持续保留演示数据；主网只做冻结版本的少量验证。

| 配置 | 测试网 | 主网（尚未发布） |
| --- | --- | --- |
| Worker | `obelisk-service` | `obelisk-service-mainnet` |
| URL | https://obelisk-service.kinomotomiovo.workers.dev | https://obelisk-service-mainnet.kinomotomiovo.workers.dev |
| Chain ID | 968 | 677 |
| Wrangler 配置 | `service/wrangler.jsonc` | `service/wrangler.mainnet.json` |
| R2 | `obelisk-service-blobs` | `obelisk-service-mainnet-blobs` |
| KV | 已固定测试网 ID | 新 Worker 首次发布独立创建，随后将返回 ID 固定到主网配置 |
| RelayQueue | 测试网 Worker 自有对象 | 主网 Worker 自有对象，无跨脚本绑定 |

主网配置没有测试网 KV ID、凭据或 R2 名称。首次发布时核对 Wrangler 资源分配，禁止选用测试网资源；将主网 KV ID 固定后再后续更新。`RELAYER_PRIVATE_KEY` 必须针对主网 Worker 独立设置，不复制 `.dev.vars` 或测试网 secret。此处创建配置并不表示已创建云资源。

## 发布

在 `service/` 中：

- `npm run deploy` 继续更新测试网。
- `npm run build:mainnet` 只构建主网 bundle，不上传或发送链交易。
- `npm run preflight:mainnet` 检查独立配置及完整 677 地址（含 SkillMarket），并核对生成代码与部署记录一致。缺失记录时退出非零，绝不回退 968。
- 测试网业务验收后，记录冻结 Git SHA、`chain/hardhat.config.ts`、五份 `chain/abi/*.json` 的哈希，以及测试网部署记录。当前编译配置：solc 0.8.28、cancun、optimizer 200、viaIR；主网沿用同一业务及合约源码。
- #5 在确认预算后部署主网五份合约、验证源码、同步 677 地址；部署记录/生成地址的差异单独提交，不能混入业务变更。
- 针对独立配置设置主网凭据，再运行 `npm run deploy:mainnet`。记录 Worker version ID、资源 ID、冻结业务 SHA 与配置 SHA。读回 `/v1/health` 和 `/v1/chain` 的 677、合约与交易；同时确认测试网仍是 968。主网发布及在线读回仍由 #5 完成。

## 本机与 Playground

`scripts/hackathon-env.sh` 生成的环境入口支持：

```sh
source ~/.obelisk-hackathon/env.sh a testnet
source ~/.obelisk-hackathon/env.sh a mainnet
```

测试网沿用原 `home` / `home-b`，主网使用 `mainnet/home` / `mainnet/home-b`，不复制钱包和旧上报队列。CLI 与从该终端启动的 App 继承 `OBELISK_HOME`、`OBELISK_SERVICE_URL`；已运行的 App 不会因另一个终端切换而改变环境，应退出后重新启动。主网未上线时使用主网入口会报连接/部署错误。

Playground 每次运行必须显式记录 service URL、chain ID、角色 home 与样本类别。大量自然任务保持测试网；主网运行使用独立目录，禁止复用测试网运行的发布清单。执行前先读 `/v1/chain`，网络不符即停止。

## 回退

分别记录两网部署返回的 version ID。只回退发生问题的 Worker 到它自己的上一版本，不改变另一个配置；存储不清空，链交易不能回滚。涉及 ABI 或合约变化时，先检查旧 Worker 与当前合约是否兼容；不兼容则修复后重新发布，不能靠回退界面撤销交易。

## 本轮冻结与用户调整

2026-10-08，用户要求停止复杂计量 QA，优先将现有功能部署主网并留时间做 PPT。冻结业务提交为 `bbe06198b5722bf8452382d4ef16f565c94375e8`；五份合约源码、ABI、编译配置和测试网记录哈希见 [release-freeze.json](release-freeze.json)。后续主网部署记录、地址同步和资源绑定单独提交，不混入计量修复。

#42 购买交付与分账已有真实测试网证据；Playground 已有真实任务和产物。工具读取 Skill 尚未计入原生加载统计，作为已知限制后置，不再阻止发布，也不填写虚构调用数。#46/#47 的未完成项保留，不把冻结表述为所有统计验收通过。主网交易仍等待明确预算和部署钱包到账。
