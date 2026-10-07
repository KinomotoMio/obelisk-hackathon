// Copyright (C) 2026 tommy0103 and contributors.
// SPDX-License-Identifier: AGPL-3.0-only

// How the Share tab and the share dialog present shares and message ranges
// (#12). Pure functions over the `obelisk share list` records the main
// process returns, so they are tested without Electron.

const pad2 = (n) => String(n).padStart(2, '0');

/** `10-07 21:03` in local time; the year is added when it is not this year. */
export function fmtShareTime(iso, now = new Date()) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const text = `${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  return d.getFullYear() === now.getFullYear() ? text : `${d.getFullYear()}-${text}`;
}

/** `0x7a3f…c21e`; the full address goes in the title attribute and the prompts. */
export function shortAddress(address) {
  return typeof address === 'string' && address.length > 12 ? `${address.slice(0, 6)}…${address.slice(-4)}` : address ?? '';
}

/** The status pill: label, tone (pill class), and a longer explanation for its title. */
export function shareStatus(share, now = new Date()) {
  switch (share.state) {
    case 'read': {
      const at = fmtShareTime(share.opens?.lastOpenedAt, now);
      const count = share.opens?.count ?? 1;
      return {
        label: count > 1 ? `已读 ${count} 次 · ${at}` : `已读 · ${at}`,
        tone: 'ok',
        detail: share.canOpen ? '对方已打开，还可以再打开' : '对方已打开，不能再打开',
      };
    }
    case 'unread':
      return { label: '未读', tone: 'dim', detail: `对方还没有打开；${fmtShareTime(share.expiresAt, now)} 前有效` };
    case 'expired':
      return { label: '已过期', tone: 'warn', detail: '到期前没有被打开，现在谁都打不开' };
    case 'revoked':
      return { label: '已撤回', tone: 'danger', detail: `${fmtShareTime(share.revokedAt, now)} 撤回，谁都打不开了` };
    default:
      return { label: '状态未知', tone: 'dim', detail: share.error || '暂时读不到这条分享在链上的状态' };
  }
}

/** `1 次 · 至 10-08 21:03` / `不限 · 至 …`, from the chain record or, offline, the local one. */
export function shareRules(share, now = new Date()) {
  const max = share.opens ? share.opens.max : share.rules?.opens;
  const opens = max === null || max === 'unlimited' || max === undefined ? '不限' : `${max} 次`;
  const expiresAt = share.expiresAt ?? share.rules?.expiresAt;
  return expiresAt ? `${opens} · 至 ${fmtShareTime(expiresAt, now)}` : opens;
}

/** The chain record link: the open receipt, the revocation, or the share authorization. */
export function shareRecord(share) {
  const url = share.record?.explorerUrl;
  if (!url) return null;
  const label = { open: '打开回执', revoke: '撤回记录', create: '分享授权' }[share.record.kind] ?? '链上记录';
  return { label, url };
}

/** The service could not give any share's state: one banner instead of one per row. */
export function serviceProblem(shares) {
  if (!shares.length || !shares.every((share) => share.state === 'unknown')) return null;
  const reasons = [...new Set(shares.map((share) => share.error).filter(Boolean))];
  return reasons.length === 1 ? reasons[0] : reasons.join('; ') || null;
}

/** Revoking only makes sense while the recipient could still open it. */
export function canRevoke(share) {
  return share.canOpen === true && share.state !== 'revoked';
}

export function rangeLabel(messages) {
  if (!messages) return '';
  return messages.from === messages.to ? `第 ${messages.from} 条` : `第 ${messages.from}–${messages.to} 条`;
}

const EXCERPT_CHARS = 72;

const ROLE_LABELS = { user: '你', assistant: 'AI' };

function excerptOf(message) {
  const text = typeof message?.text === 'string' ? message.text.replace(/\s+/g, ' ').trim() : '';
  if (text) return text.length > EXCERPT_CHARS ? `${text.slice(0, EXCERPT_CHARS)}…` : text;
  const tools = (message?.tool_calls ?? []).map((call) => call.name).filter(Boolean);
  return tools.length ? `（工具调用：${tools.join('、')}）` : '（无文字）';
}

/**
 * What messages `from`–`to` of the session detail contain, for the share
 * dialog: counts plus the first and last message, so the user can see the
 * range starts and ends where they meant.
 */
export function describeRange(messages, from, to) {
  const total = messages.length;
  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 1 || to > total || from > to) {
    return { valid: false, total };
  }
  const slice = messages.slice(from - 1, to);
  const toolCalls = slice.reduce((sum, message) => sum + (message.tool_calls?.length ?? 0), 0);
  const edge = (message, n) => ({ n, role: ROLE_LABELS[message.type] ?? message.type ?? '', excerpt: excerptOf(message) });
  return {
    valid: true,
    total,
    count: slice.length,
    toolCalls,
    first: edge(slice[0], from),
    last: slice.length > 1 ? edge(slice.at(-1), to) : null,
  };
}
