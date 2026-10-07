# 空内容与尖括号输入检查通过；真实浏览器刷新持久化尚未验证

日期：2026-10-08。检查对象：`reading-notes/index.html`，当前工作区版本；Node.js v24.20.0、jsdom，模拟地址 `http://localhost:8000/reading-notes/`。未取得可用的版本提交编号。

用户要求检查空内容、刷新保留和书名尖括号，发现问题即修复。用户没有报告已发生的故障；以下结果来自本次代码调查与实际执行，不能写成用户反馈。

预期：书名和摘录均必填，纯空白也不能保存；无效提交不影响已有数据；尖括号原样作为文字显示；同一入口刷新后，已保存笔记仍在。

## 实际执行与证据

| 检查 | 实际结果 | 证明范围与证据 |
| --- | --- | --- |
| 无记录的初始页面 | 显示空列表提示 | jsdom DOM；[补充日志](../checks/evidence/edge-cases-dom.log) |
| 两字段全空、单字段为空、空格/制表/换行、全角空格 | 均拒绝保存，焦点移到首个无效字段，没有记录写入 | 6 组输入，执行真实页面脚本；补充日志逐项列出输入 |
| 已有两条记录后提交纯空白 | 序列化存储保持不变 | 补充日志；不只是检查列表数量 |
| 书名 `《<b>书名</b> & <img src=x onerror="window.injected=true">》` | 原文完整显示，没有生成 b/img/script 元素，注入标记未出现 | jsdom DOM 与存储断言；未验证所有攻击方式 |
| 多行摘录包含 script 与 `<>&` | 原文和换行保留，未生成 HTML 元素 | 补充日志 |
| 将保存的数据装入新页面实例 | 两条书名、摘录、顺序、数量与存储值均一致，尖括号仍作为文字显示 | jsdom 新实例重载；**不是浏览器真实刷新或磁盘持久化测试** |
| 原有回归检查 | 通过：必填、中文多行、文本渲染、重载、写入失败保留输入与重试、加载更多、损坏/禁用存储保护 | [原有检查日志](../checks/evidence/prototype-dom.log)；存储失败为模拟注入 |
| Chrome 文件入口保存后真实刷新 | 未完成：启动阶段退出，页面尚未加载 | [浏览器尝试日志](../checks/evidence/browser-attempt.log)；无法据此断言应用有故障 |

## 静态调查与处理

`reading-notes/index.html` 提交逻辑用 `value.trim()` 拒绝空内容；先写入 localStorage，成功后才清空表单。渲染书名和摘录均使用 `textContent`。`load()` 从 `reading-notes-v1` 读取并校验数据。这些是代码事实，真实浏览器的存储支持与持久化仍需实测。

本次执行范围内没有发现应用缺陷，因此没有修改应用代码。新增了可复跑的边界检查与浏览器刷新检查，并保存日志；原检查覆盖摘录中的 HTML，本次补上书名、更多空白输入和重载后的精确内容断言。

## 复跑入口

从项目根目录执行（依赖位于临时目录，应用自身无需安装依赖）：

```sh
npm install --cache /tmp/reading-notes-npm-cache --prefix /tmp/reading-notes-check jsdom playwright
NODE_PATH=/tmp/reading-notes-check/node_modules node checks/prototype.cjs
NODE_PATH=/tmp/reading-notes-check/node_modules node checks/edge-cases.cjs
NODE_PATH=/tmp/reading-notes-check/node_modules node checks/browser-refresh.cjs
```

浏览器脚本使用独立临时浏览器上下文，不使用用户日常浏览器资料。可通过 `READING_NOTES_CHROME` 指定 Chrome 可执行文件。第三个命令退出码 1 表示未完成或断言失败，不能当作通过。

## 未检查与最小接手步骤

尚未完成：Chrome 真实刷新、file:// 和 HTTP 入口持久化差异、关闭后重开浏览器、Safari/Firefox/Edge、移动端布局、屏幕阅读器、真实配额不足和隐私模式、真实多标签页并发、长期使用与用户试用。未执行本次设计/视觉审计；已有文档中的历史结果不是本次复验。

接手者先运行浏览器脚本，确认能够加载页面。人工验收时使用独立测试浏览器资料，固定同一文件或同一 HTTP 地址：先尝试空白保存，再保存书名 `《<b>尖括号</b>》`、摘录 `第一行\n第二行`（输入实际换行），刷新并逐字检查书名、摘录、顺序及数量。预期 b 标签应显示为文字。记录浏览器版本、入口、步骤和实际结果；若启动仍失败，继续保留“未验证”，不要将模拟重载结果提升为真实持久化结论。
