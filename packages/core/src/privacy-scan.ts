// Copyright (C) 2026 tommy0103 and contributors.
// SPDX-License-Identifier: AGPL-3.0-only

// Privacy check before sharing (#8, docs/vision/02 S6): find secrets and
// personal details in common formats, and replace the ones the user chooses.
//
// Callers report a finding by its type and where it occurs, never by its
// value: the CLI runs inside an AI coding assistant, and a value printed there
// has already left the machine. Matching is pattern-based (phase 1); it does
// not try to recognize names or customer data.

export type FindingType =
  | 'private_key'
  | 'api_key'
  | 'access_token'
  | 'password'
  | 'connection_string'
  | 'local_path'
  | 'email'
  | 'phone';

export const FINDING_LABELS: Readonly<Record<FindingType, string>> = {
  private_key: 'Private key',
  api_key: 'API key',
  access_token: 'Access token',
  password: 'Password or secret',
  connection_string: 'Connection string with credentials',
  local_path: 'Local path with username',
  email: 'Email address',
  phone: 'Phone number',
};

export interface TextMatch {
  type: FindingType;
  start: number;
  end: number;
  /** The matched value; used to group repeats. Never print it. */
  value: string;
  replacement: string;
}

export interface ScanHints {
  /** The local account name, to catch Claude Code's `-Users-<name>-…` project directories. */
  username?: string | null;
}

interface Detector {
  type: FindingType;
  pattern: RegExp;
  /** Capture group holding the sensitive part; the whole match when absent. */
  group?: number;
  accept?: (value: string, match: RegExpExecArray) => boolean;
  replacement?: (value: string) => string;
}

const placeholder = (type: FindingType) => `[redacted: ${FINDING_LABELS[type]}]`;

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Values on the right of `password = …` that are code or placeholders, not
// secrets: identifiers, member accesses, env lookups, templates, masks.
function looksLikeSecretValue(value: string): boolean {
  if (/^(?:true|false|null|none|undefined|string|number|required|optional)$/i.test(value)) return false;
  if (/^[$<{%[]|^process\.|^os\.|^env\.|^import\.meta/.test(value)) return false;
  if (/^(.)\1+$/.test(value) || /^(?:x{3,}|\*{3,}|\.{3,}|…|redacted|changeme|example|placeholder|your[-_])/i.test(value)) return false;
  // A bare identifier or dotted member access with no digit is code.
  if (/^[A-Za-z_][\w]*(?:\.[A-Za-z_][\w]*)*\(?$/.test(value) && !/\d/.test(value)) return false;
  return true;
}

const NON_PERSONAL_EMAIL = /^(?:no-?reply|noreply\+?.*|git|example|test|user|name|you|someone)@|@(?:example\.(?:com|org|net)|users\.noreply\.github\.com|localhost)$/i;

const DETECTORS: readonly Detector[] = [
  {
    type: 'private_key',
    pattern: /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----(?:[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----|[A-Za-z0-9+/=\s\\]*)/g,
  },
  {
    type: 'private_key',
    pattern: /(?:private[_ -]?key|priv[_ -]?key|secret[_ -]?key|mnemonic|seed)[\w"' ]{0,24}?[:=\s]\s*["'`]?(0x[0-9a-fA-F]{64}|[0-9a-fA-F]{64})(?![0-9a-fA-F])/gi,
    group: 1,
  },
  {
    type: 'connection_string',
    pattern: /\b[a-z][a-z0-9+.-]{1,20}:\/\/([^\s:/@'"`]+:[^\s@/'"`]+)@[^\s'"`]+/gi,
    group: 1,
    replacement: () => '[redacted: credentials]',
  },
  {
    type: 'api_key',
    pattern: new RegExp([
      String.raw`\bsk-ant-[A-Za-z0-9_-]{20,}`,
      String.raw`\bsk-(?:proj-|live-|test-)?[A-Za-z0-9_-]{32,}`,
      String.raw`\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}`,
      String.raw`\bgithub_pat_[A-Za-z0-9_]{40,}`,
      String.raw`\bglpat-[A-Za-z0-9_-]{20,}`,
      String.raw`\bxox[abposr]-[A-Za-z0-9-]{10,}`,
      String.raw`\b(?:AKIA|ASIA)[0-9A-Z]{16}\b`,
      String.raw`\bAIza[0-9A-Za-z_-]{35}`,
      String.raw`\bnpm_[A-Za-z0-9]{36}\b`,
      String.raw`\b[rs]k_(?:live|test)_[A-Za-z0-9]{16,}`,
      String.raw`\bhf_[A-Za-z0-9]{30,}`,
    ].join('|'), 'g'),
  },
  {
    type: 'access_token',
    pattern: /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g,
  },
  {
    type: 'access_token',
    pattern: /\b(?:Bearer|Basic|token)\s+([A-Za-z0-9._~+/=-]{20,})/g,
    group: 1,
    accept: (value) => /\d/.test(value) && /[A-Za-z]/.test(value),
  },
  {
    type: 'password',
    pattern: /\b[\w.-]*(?:password|passwd|pwd|passphrase|secret|token|api[_-]?key|apikey|access[_-]?key|auth[_-]?key|client[_-]?secret)["']?\s*[:=]\s*["']?([^\s"'`,;()[\]{}<>]{6,})/gi,
    group: 1,
    accept: looksLikeSecretValue,
  },
  {
    type: 'email',
    pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}\b/g,
    accept: (value) => !NON_PERSONAL_EMAIL.test(value),
  },
  {
    type: 'local_path',
    pattern: /(?:\/Users\/|\/home\/)(?!Shared\b)[^/\s'"`:;,)\]}]+|\b[A-Za-z]:\\Users\\(?!Public\b)[^\\\s'"`:;,)\]}]+/g,
    replacement: () => '~',
  },
  {
    type: 'phone',
    pattern: /(?<![\w+.-])(?:\+?86[ -]?)?1[3-9]\d{9}(?![\w])|(?<![\w+])\+\d{1,3}[ .-]?\(?\d{1,4}\)?(?:[ .-]?\d{2,4}){2,4}(?![\w])/g,
    accept: (value) => {
      const digits = value.replace(/\D/g, '').length;
      return digits >= 8 && digits <= 15;
    },
  },
];

function detectorsFor(hints: ScanHints): Detector[] {
  const username = hints.username?.trim();
  if (!username || username.length < 3) return [...DETECTORS];
  // Claude Code stores projects under `~/.claude/projects/-Users-<name>-…`.
  return [
    ...DETECTORS,
    {
      type: 'local_path',
      pattern: new RegExp(`-(?:Users|home)-${escapeRegExp(username)}(?=-|\\b)`, 'g'),
      replacement: () => '~',
    },
  ];
}

/** Sensitive spans in `text`, non-overlapping, in order. */
export function scanText(text: string, hints: ScanHints = {}): TextMatch[] {
  if (!text) return [];
  const found: TextMatch[] = [];
  detectorsFor(hints).forEach((detector) => {
    const pattern = new RegExp(detector.pattern.source, detector.pattern.flags.includes('d') ? detector.pattern.flags : `${detector.pattern.flags}d`);
    for (const match of text.matchAll(pattern)) {
      const indices = match.indices?.[detector.group ?? 0];
      const value = match[detector.group ?? 0];
      if (!indices || !value) continue;
      if (detector.accept && !detector.accept(value, match as RegExpExecArray)) continue;
      found.push({
        type: detector.type,
        start: indices[0],
        end: indices[1],
        value,
        replacement: detector.replacement?.(value) ?? placeholder(detector.type),
      });
    }
  });
  // Earlier detectors are more specific; on overlap the earlier one wins.
  const order = new Map(found.map((match, index) => [match, index]));
  found.sort((a, b) => a.start - b.start || order.get(a)! - order.get(b)!);
  const kept: TextMatch[] = [];
  for (const match of found) {
    const previous = kept.at(-1);
    if (previous && match.start < previous.end) {
      if (order.get(match)! < order.get(previous)!) kept[kept.length - 1] = match;
      continue;
    }
    kept.push(match);
  }
  return kept;
}

/** `text` with every span for which `redact(match)` is true replaced. */
export function redactText(text: string, matches: readonly TextMatch[], redact: (match: TextMatch) => boolean): string {
  let out = '';
  let cursor = 0;
  for (const match of matches) {
    if (!redact(match)) continue;
    out += text.slice(cursor, match.start) + match.replacement;
    cursor = match.end;
  }
  return out + text.slice(cursor);
}

/** Every span replaced: for short excerpts shown in conversation. */
export function maskText(text: string, hints: ScanHints = {}): string {
  return redactText(text, scanText(text, hints), () => true);
}
