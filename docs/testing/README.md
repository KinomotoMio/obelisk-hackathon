# 测试轮次

比赛期间的开发节奏是一个快速闭环：

1. **开发**：开发者持续开发；一批功能做得差不多了，就推送到 `hackathon` 分支。
2. **准备材料**：每次推送值得测试时，在这里新增一份测试说明 `round-NN.md`。它写明三件事：愿景是什么、现在做到了哪里、两者之间差什么（每项差距注明原因），以及这一轮要测哪些场景。
3. **对齐**：测试同学先读一遍测试说明，和开发者确认理解一致，再开始测试。
4. **测试**：在自己的电脑上按说明安装、逐个场景测试。
5. **反馈**：结果直接告诉开发者，写不写成文档都行。开发者再把反馈交给 AI，整理成 issue 并安排修复。

每一轮的说明只描述那一轮推送时的状态。旧的轮次保留，不回头修改，方便对照前后变化。

| 轮次 | 对应提交 | 日期 |
| --- | --- | --- |
| [第 1 轮](round-01.md) | `hackathon` 分支，见文件开头 | 2026-10-07 |

## 安装（每一轮通用）

需要：macOS（钱包私钥存在系统钥匙串里；Linux 需要 `secret-tool`），Node.js 24、git、已登录的 Claude Code，以及装了 MetaMask 的浏览器。不需要任何加密货币：测试网上的手续费都由 Obelisk 在线服务代付。

```bash
git clone -b hackathon https://github.com/KinomotoMio/obelisk-hackathon.git
cd obelisk-hackathon
sh scripts/hackathon-env.sh
```

脚本会编译这份代码，并在 `~/.obelisk-hackathon/` 下搭一个独立的测试环境。它不会碰你已经安装的 Obelisk 命令行、`~/.obelisk` 数据或 Obelisk App。环境里有两个角色，各自有独立的索引、Skill 库和钱包，用来模拟两个不同的用户：

```bash
source ~/.obelisk-hackathon/env.sh     # 角色 A，提示符前出现 [hackathon]
source ~/.obelisk-hackathon/env.sh b   # 角色 B，提示符前出现 [hackathon:b]
```

每个角色第一次进入时，先运行一次 `obelisk --build`，用你本机的 Claude Code / Codex 历史建立这个角色自己的索引。历史多的话要等几分钟。

在环境里：

- **用 Claude Code 跑流程**：`cd ~/.obelisk-hackathon/workspace && claude`。
- **用 Codex 跑流程**：`cd ~/.obelisk-hackathon/workspace && codex`。

这个目录已经为两者装好了全部 Obelisk skill：Claude Code 用 `.claude/skills/`，Codex 用 `.agents/skills/`，都只在这个目录里生效，不会改动 `~/.claude` 或 `~/.codex`。在 Claude Code 里可以用 `/obelisk-distill …` 这样的斜杠命令直接调用；在 Codex 里直接用自然语言说即可。
- **打开 App**：`cd <仓库>/app && npm run dev`。App 用的是当前角色的数据。

拉了新代码以后，重新运行一次 `sh scripts/hackathon-env.sh`。

## 反馈怎么写

反馈不需要格式，能说清下面几点就够了：

- 哪一轮、哪个场景、第几步；
- 你期望看到什么，实际看到什么，最好附截图；
- 哪里让你困惑：文案看不懂、不知道下一步该做什么、等太久，都算。

测试过程中产生的链上记录在测试网上，任何人都能查到，但只包含地址、指纹和计数，不包含对话内容。分享时请选不含真实密钥、客户信息的 session；分享前的隐私体检会帮你检查一遍，但不保证查全。
