# 原型技术验证

2026-10-08。入口：`reading-notes/index.html`。技术自检完成；真实浏览器体验与人工试用待执行。

## 已执行

- `NODE_PATH=/tmp/reading-notes-check/node_modules node checks/prototype.cjs`：通过。使用 jsdom 执行真实页面脚本，检查空列表、必填提示与首个错误焦点、中文多行保留、安全文本渲染、新记录在前、存储数据重新加载、写入失败保留输入、重试成功、25 条记录的加载更多、损坏数据不覆盖及存储被禁用时暂停保存。
- `python3 <frontend-design-premium技能目录>/scripts/audit_project.py . --mode strict`：通过，0 错误、0 警告，产物为项目根目录 `premium-audit.json`。
- `npx --cache /tmp/reading-notes-npm-cache --yes -p @google/design.md designmd lint DESIGN.md`：通过，0 错误、0 警告。
- 源码检查：未使用外部资源、网络请求、HTML 注入或原生 alert/confirm/prompt；表单标签、错误关联、live region、键盘焦点样式、手机单列与 reduced-motion 样式存在。该检查不能证明实际可访问性或视觉表现。

验证依赖只安装到 `/tmp/reading-notes-check`，应用本身无需依赖或构建。复跑 DOM 检查时先执行 `npm install --cache /tmp/reading-notes-npm-cache --prefix /tmp/reading-notes-check jsdom`。隔离测试存储在 jsdom 内存中，未写入用户浏览器笔记。

## 尚未验证

尝试用 Playwright 启动本机 `/Applications/Google Chrome.app`，Chrome 在当前环境以 SIGABRT 退出，未能加载页面。因此没有真实浏览器截图、文件入口存储实测、移动端实测、布局视觉验收或屏幕阅读器结果。DOM 环境重新加载通过不等同于真实浏览器 `file://` 持久化通过。

用户可按 README 的快速验收检查双击打开、保存两条笔记和刷新保留。文件入口存储取决于浏览器与隐私设置；若不可用，README 已提供固定 localhost 入口。无实际同学试用、长期使用或上线结果。

## 本次边界专项复验（2026-10-08）

空内容与书名尖括号的新增 DOM 检查及原回归检查通过；Chrome 再次在启动阶段退出，真实刷新持久化仍未验证。详见 [专项报告](edge-case-check-report.md)，其中分别保存实际执行、静态调查、未检查范围及复跑入口。
