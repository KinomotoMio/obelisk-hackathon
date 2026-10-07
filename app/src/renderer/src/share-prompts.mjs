// Copyright (C) 2026 tommy0103 and contributors.
// SPDX-License-Identifier: AGPL-3.0-only

// Prompts the Share tab and the Session detail share dialog copy (#12,
// docs/vision/02 S1–S3). The App never sends or revokes a share itself: its
// buttons copy a prompt for the user's AI coding assistant, where the
// obelisk-share skill runs the privacy check and asks for confirmation before
// the CLI encrypts, uploads, or writes to the chain. Each prompt names the
// obelisk-share skill; assistant-prompts.mjs renders it as a slash command for
// Claude Code or a sentence for Codex.
//
// Prompts name the full recipient address (an abbreviated one could match
// another wallet) and the share number the reader page watermark shows, which
// `obelisk share revoke S-…` resolves.

import { skillPrompt } from './assistant-prompts.mjs';

export const SHARE_SKILL = 'obelisk-share';

export const OPENS_CHOICES = Object.freeze([
  { value: 1, label: '1 次' },
  { value: 3, label: '3 次' },
  { value: 'unlimited', label: '不限' },
]);

export const EXPIRY_CHOICES = Object.freeze([
  { value: '1h', label: '1 小时' },
  { value: '24h', label: '24 小时' },
  { value: '7d', label: '7 天' },
]);

export const SHARE_EXAMPLE_PROMPT = skillPrompt(SHARE_SKILL, '把这个 session 里……的部分分享给 0x…，限 1 次，24 小时内有效');

const WALLET_ADDRESS = /^0x[0-9a-fA-F]{40}$/;

export function isWalletAddress(value) {
  return typeof value === 'string' && WALLET_ADDRESS.test(value.trim());
}

function sessionReference({ id, title }) {
  const name = typeof title === 'string' ? title.trim() : '';
  return name ? `session「${name}」（${id}）` : `session ${id} `;
}

function rangeText(from, to) {
  return from === to ? `第 ${from} 条` : `第 ${from}–${to} 条`;
}

function opensText(opens) {
  return opens === 'unlimited' ? '不限次数' : `限 ${opens} 次`;
}

function expiryText(expires) {
  const choice = EXPIRY_CHOICES.find((entry) => entry.value === expires);
  if (!choice) throw new Error(`Unknown expiry ${expires}`);
  return `${choice.label}内有效`;
}

/**
 * Share messages `from`–`to` (1-based, as the session detail numbers them)
 * with one wallet, e.g. `把 session「…」（…）第 12–17 条分享给 0x…，限 1 次，
 * 24 小时内有效` for obelisk-share.
 */
export function sharePrompt({ session, from, to, recipient, opens, expires }) {
  if (!isWalletAddress(recipient)) throw new Error('A share needs a wallet address (0x followed by 40 hex characters)');
  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 1 || to < from) throw new Error(`Not a message range: ${from}–${to}`);
  return skillPrompt(SHARE_SKILL, `把 ${sessionReference(session)}${rangeText(from, to)}分享给 ${recipient.trim()}，`
    + `${opensText(opens)}，${expiryText(expires)}`);
}

/** Revoke one sent share, named by recipient and share number (and title when known). */
export function revokePrompt(share) {
  const title = typeof share.title === 'string' && share.title.trim() ? `「${share.title.trim()}」` : '';
  return skillPrompt(SHARE_SKILL, `撤回我发给 ${share.recipient} 的分享 #${share.number}${title}`);
}
