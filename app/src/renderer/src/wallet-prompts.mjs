// Copyright (C) 2026 tommy0103 and contributors.
// SPDX-License-Identifier: AGPL-3.0-only

// Prompts the Settings 钱包 section copies (#6, docs/vision/01 I1–I2). The
// wallet is created and activated by the obelisk-wallet skill through the
// Obelisk CLI, which keeps the private key out of the conversation and asks
// before anything is written on chain; assistant-prompts.mjs renders each
// prompt as a slash command for Claude Code or a sentence for Codex.
// Importing an existing wallet is not a prompt: it happens in Settings.

import { skillPrompt } from './assistant-prompts.mjs';

export const WALLET_SKILL = 'obelisk-wallet';

/** docs/vision/01: 在 AI 编程助手里说"帮我创建 Obelisk 钱包"（"生成钱包"按钮会复制这句 prompt）. */
export const CREATE_WALLET_PROMPT = skillPrompt(WALLET_SKILL, '帮我创建 Obelisk 钱包');

/** Register this wallet's encryption key, or replace a different one; the skill previews before confirming. */
export const ACTIVATE_WALLET_PROMPT = skillPrompt(WALLET_SKILL, '激活我的 Obelisk 钱包');
