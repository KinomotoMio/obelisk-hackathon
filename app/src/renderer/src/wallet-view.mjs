// Copyright (C) 2026 tommy0103 and contributors.
// SPDX-License-Identifier: AGPL-3.0-only

// Wording for the Settings 钱包 section (#6). The main process reports codes
// (main/wallet.ts); this module turns them into the Chinese the page shows.

export function shortAddress(address) {
  return typeof address === 'string' && address.length > 12 ? `${address.slice(0, 6)}…${address.slice(-4)}` : address ?? '';
}

/** Where the key is kept, in the page's words (keychain.ts descriptions). */
export function keyStoreLabel(storedIn) {
  if (storedIn === 'macOS Keychain') return 'macOS 钥匙串';
  if (storedIn === 'Secret Service keyring') return '系统密钥环';
  return storedIn || '系统钥匙串';
}

/** The status pill for an activation reading; `null` while it is being read. */
export function activationPill(activation) {
  switch (activation?.activation) {
    case 'active': return { tone: 'ok', text: '已激活' };
    case 'not_activated': return { tone: 'warn', text: '未激活' };
    case 'different_key': return { tone: 'warn', text: '需要重新激活' };
    case 'unknown': return { tone: 'dim', text: '激活状态未知' };
    default: return { tone: 'dim', text: '正在查询激活状态…' };
  }
}

/** Why an import was refused, for the line under the field. */
export function importErrorText(error, { keyMissing = false } = {}) {
  switch (error?.code) {
    case 'empty': return '请输入私钥或助记词。';
    case 'private-key-format': return '私钥应为 64 位十六进制字符（可带 0x），请检查是否复制完整。';
    case 'mnemonic-length': return '助记词应为 12、15、18、21 或 24 个英文单词，用空格分开。';
    case 'mnemonic-word': return `第 ${error.wordIndex ?? '?'} 个词不在 BIP-39 英文词表里，请检查拼写。`;
    case 'mnemonic-checksum': return '助记词校验没有通过：可能有词拼错，或顺序不对。';
    case 'unrecognized': return '无法识别：请输入私钥（64 位十六进制）或助记词（12–24 个英文单词）。';
    case 'wallet_exists': return keyMissing
      ? `这里只能导入 ${shortAddress(error.address)} 的私钥或助记词，它和 wallet.json 记录的地址不一致。`
      : `这个数据目录已经有钱包 ${shortAddress(error.address)}，Obelisk 不会替换已有钱包。`;
    case 'busy': return '正在导入，请稍候。';
    default: return `导入失败：${error?.message || '未知错误'}`;
  }
}

/** What happened, once an import succeeded. */
export function importDoneText(result) {
  if (result.status === 'restored') return '已找回私钥，钱包恢复可用。';
  if (result.status === 'exists') return '这个钱包已经在本机了，无需重复导入。';
  return result.kind === 'mnemonic' ? '已从助记词导入钱包。' : '已从私钥导入钱包。';
}

/** "10-07 21:03", in local time, like the Share tab. */
export function formatActivatedAt(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
