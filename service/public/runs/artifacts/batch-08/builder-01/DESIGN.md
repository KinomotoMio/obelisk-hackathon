---
version: alpha
name: "页间"
description: "以书签边缘为识别元素的本地读书摘录工具"
colors:
  primary: "#28564a"
  hover: "#1c4037"
  background: "#eef2f0"
  surface: "#ffffff"
  text: "#243831"
  muted: "#53685f"
  border: "#c2cec8"
  danger: "#a12626"
typography:
  sans:
    fontFamily: 'system-ui, -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif'
  display:
    fontFamily: '"Songti SC", "STSong", serif'
rounded:
  DEFAULT: "12px"
spacing:
  section-gap: "32px"
  page-max: "1060px"
components:
  button:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.surface}"
  button-hover:
    backgroundColor: "{colors.hover}"
    textColor: "{colors.surface}"
  field:
    textColor: "{colors.text}"
  field-border:
    backgroundColor: "{colors.border}"
  field-error:
    textColor: "{colors.danger}"
  note:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
  note-caption:
    textColor: "{colors.muted}"
---

# 页间 Design System

## Overview

### Creative North Star

读者夹在书页边缘的绿色书签。表达只集中在笔记左侧的短绿色边缘和页字书签，不添加营销大屏或虚构示例笔记。

### Product context and register

用户要在浏览器记录书名与摘录，并在本机回看。简体中文工具界面，桌面与手机均可用；没有日本市场或其他市场业务要求。依据本轮用户指令与 COLLABORATION_PLAN.md 的记录/列表范围。没有既有 UI 或兄弟页面。

颜色和尺度以 reading-notes/index.html 的 :root 为运行时唯一来源，本文件镜像已接受的值（Model B）。colors.* 对应同名 CSS 变量；typography.sans/display 对应 --font-body/--font-display；rounded.DEFAULT 对应 --radius；spacing.section-gap/page-max 对应 --gap/--page-max。无框架适配层。

## Colors

低饱和绿色背景、白色输入与笔记表面，深绿色作为主操作和书签。正文 text，辅助说明 muted，边框 border，字段与存储失败 danger。错误同时提供文字，不只依赖颜色。仅浅色主题，系统高对比度使用系统颜色。

## Typography

中文宋体用于品牌和书名，系统无衬线用于正文和输入；无需在线字体。正文 16px、行高 1.7，摘录 1.9；用户换行与长词完整显示，不截断全文。

## Layout

最大宽度 1060px，表单和列表并排，间距 32px。720px 以下垂直排列。页面自然滚动，长摘录输入自动增高到 480px 后内部滚动。状态区预留高度，不把输入框移走。列表每批 20 条显式加载更多。

## Elevation & Depth

使用边框和白色表面区分内容，不使用阴影或浮动覆盖层。

## Shapes

笔记与表单 12px 圆角，输入和按钮 6px。左侧书签短线只表示一条摘录，不编码假序号。

## Components

表单由 note-form 统一拥有验证与提交；输入必须关联 label、错误与 aria-invalid。唯一主按钮「保存笔记」，hover 使用 hover 色，focus-visible 3px 主色轮廓，disabled 不可点击。

列表由 render 拥有，成功后原地更新、清空表单并把焦点放回书名；新增在前，重复内容也新增，不自动去重。正文通过 textContent 写入。feedback 是唯一 live region，失败保留输入，读取失败暂停保存以保护数据。scrollbar 由全局样式拥有，标准属性与 WebKit 回退覆盖所有滚动区域。

## Iconography

只有装饰性「页」书签，aria-hidden；动作全部有文本，不使用图标独占按钮。

## Motion

没有动画；按钮按压位移在 reduced-motion 下禁用。

## Canonical UI Map

| Capability | Canonical owner | Source of truth | Allowed variants | Verification |
| --- | --- | --- | --- | --- |
| Form | note-form submit handler | index.html | create only | browser empty/success checks |
| Scrollbar | global stylesheet | :root and global CSS | forced-colors | narrow viewport check |
| Toast | message and feedback live region | index.html | success/error | browser storage failure |
| CRUD | readNotes, submit handler, render | current request | create/read only | browser save and reload |
