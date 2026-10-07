# 路演素材与证据目录

按真实过程挑选素材，多个运行组合讲述时明确标注。下表前期素材来自测试网，新增主网片段单独标明；历史采集来自已有用户，Playground 角色是模拟身份，任务由真实 AI 执行。模拟钱包数量不等于市场用户规模。

| 片段 | 角色 / 资产 | 来源及入口 | 可以说明什么 |
| --- | --- | --- | --- |
| 从历史留下协作方法 | 原历史使用者，#10 | [四份资产采集记录](../testing/playground-batch-01.md)，市场 #10–#13 | 四个不同主题，出处经核对；不是四位新作者 |
| 不编造求职成绩 | job-seeker-01，#9 | [自然运行](https://obelisk-service.kinomotomiovo.workers.dev/runs/run-20261007T192824Z-92b5)，步骤 job-materials | 自主搜索、读预览、形成材料；没有安装，不算原生加载 |
| 选择适用方法 | designer-01，#6 / #11 | 同一自然运行，设计师任务 | 阅读作品集方法；没有因市场里有问题报告方法就强行采用 |
| 未选择市场也保留 | maintainer-01 | 同一自然运行，维护者任务 | 独立排障笔记，未发生市场取用 |
| 失败不改写 | builder-01 | 同一自然运行，构建者任务 | 共享 CLI 重建导致命令失败；模型说明边界并完成计划 |
| 改成每天半小时验收的方法 | builder-01，#10 → #14 | `run-20261007T194022Z-9de4`，builder-derive；[修正边界](../testing/playground-batch-02.md) | 真实生成草稿，另行审阅发布；原运行安装错位、加载为零，不称作成功调用 |
| 知识价值回流 | 原作者、衍生作者、买家、平台 | [真实结算报告](../testing/market-settlement-testnet.md)，含交易、指纹与两张 App 截图 | 测试币购买、授权正文交付、0.001 BOT 三方到账；不是运营营收 |
| 修正后的正文读取 | builder-01 / job-seeker-01 | `run-20261007T200538Z-7a4e` | 两个任务完成、实际通过工具读取正文；现有计量不识别该形式，尚未上报，不作为已完成统计素材 |

## 可直接放入 PPT 的现有图片

- [衍生作者 App：直接销售收入](../testing/assets/market-settlement/derived-author.png)。来自真实测试网与隔离作者钱包。
- [原作者 App：衍生收入](../testing/assets/market-settlement/original-author.png)。同一购买交易的上游收入。
- [平台运营页](https://obelisk-service.kinomotomiovo.workers.dev/operations)：可现场打开核对三方分配。
- [买家详情页](https://obelisk-service.kinomotomiovo.workers.dev/market/skills/14)：价格、许可、族谱与衍生邀请。购买与实际使用分别核对；最新使用结果见下方闭环记录。

## 原始材料与公开边界

每个运行的 `provenance.json` 保留实际提示词、模型、原生 session ID、代码提交和命令；`events.jsonl` 保留事件时刻及纠正注记。本机运行目录另有原生执行日志、命令结果和各角色工作文件。公开发布经过路径脱敏，完整历史、凭据和授权正文不进入此目录。

首轮模型为 `gpt-6.1-sol`，执行器 `codex-cli 0.160.0`；具体版本以各运行记录为准。材料中的“完成任务”“安装正文”“原生加载”“判断结果”“链上上报”“购买结算”是不同事实，不互相替代。

本目录服务于 #47 → #31 / #37。付费 session 是后续方向，已有分享不等于付费交付。最终叙事落脚：**AI-Native should be context native first**。

## 最新使用闭环与实际产物

[本轮记录](../testing/playground-usage-closure.md)将用户主动选用与之前的自主发现分开记录。结果由本机 AI 按真实会话判断，上报后市场直接从链上读取。

| 素材 | 入口 | 讲述角度 |
| --- | --- | --- |
| 测试网协作方法：多人复用、结果、族谱 | [Skill #10](https://obelisk-service.kinomotomiovo.workers.dev/market/skills/10) | 同一方法被构建者、设计师、维护者用于各自任务 |
| 原型验证方法跨角色复用 | [Skill #16](https://obelisk-service.kinomotomiovo.workers.dev/market/skills/16) | 设计师与求职者选用同一方法准备不同验证任务 |
| 主网协作方法 | [主网 #1](https://obelisk-service-mainnet.kinomotomiovo.workers.dev/market/skills/1) | 独立服务、真实主网发布、主网角色调用，不搬测试网数字 |
| 发给招聘方的消息 | [真实 AI 产物](https://obelisk-service.kinomotomiovo.workers.dev/runs/artifacts/selected-use-05/recruiter-message.md) | 从模拟项目事实形成可用文字，不编造性能成绩 |
| 周末交接 | [真实 AI 产物](https://obelisk-service.kinomotomiovo.workers.dev/runs/artifacts/selected-use-05/weekend-handoff.md) | 方法帮助接手者分清已知证据和未确定问题 |
| 十分钟访谈与记录表 | [提纲](https://obelisk-service.kinomotomiovo.workers.dev/runs/artifacts/selected-use-05/interview-guide.md)、[记录表](https://obelisk-service.kinomotomiovo.workers.dev/runs/artifacts/selected-use-05/observation-sheet.md) | 已完成的是准备材料，实际访谈尚未执行 |

运行列表 [测试网入口](https://obelisk-service.kinomotomiovo.workers.dev/runs) / [主网入口](https://obelisk-service-mainnet.kinomotomiovo.workers.dev/runs) 保留每批链 ID，不能因为从主网域名打开就把历史测试网运行说成主网交易。

完整的调用判定与上报交易见 [本轮结果](../testing/playground-usage-results.json)，公开副本为 `/runs/usage-results.json`。

## 第八批：从方法到实际原型

[测试网产物目录](https://obelisk-service.kinomotomiovo.workers.dev/runs/batch-08.html)：5 个模拟角色的 14 次真实 AI 任务，新增/更新 30 份文件，包括读书笔记和失物招领 HTML 原型。对应 [判断与交易](../testing/playground-batch-08-results.json)。原型、检查报告和未执行的线下试用边界分别保留。
