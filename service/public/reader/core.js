// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 tommy0103 and contributors.

// The web reader's logic that does not touch the page (#10): deriving the
// recipient's encryption key from a wallet signature, opening the key
// package and the content with WebCrypto, the typed data the wallet signs,
// and small formatting helpers. No dependencies, so the page can load it as
// is; service/test/reader.test.mjs checks it against packages/core.
//
// The private key never leaves the browser wallet. What the page derives is
// the X25519 key that `obelisk wallet activate` derives from the same
// signature (packages/core/src/wallet.ts), and it lives only in memory.

/** Must equal ENCRYPTION_KEY_MESSAGE in packages/core/src/wallet.ts. */
export const ENCRYPTION_KEY_MESSAGE = [
  'Obelisk encryption key v1',
  '',
  'Signing this derives the key that opens content shared with this wallet.',
  'Only sign it in Obelisk: anyone who gets this signature can read what is shared with you.',
].join('\n');

const ENCRYPTION_KEY_HKDF_INFO = 'obelisk/encryption-key/x25519/v1';
const SHARE_KEY_HKDF_INFO = 'obelisk/share-key/x25519/v1';
const KEY_PACKAGE_ALGORITHM = 'x25519-hkdf-sha256-aes-256-gcm';
const X25519_ALGORITHM_BYTE = 0x01;
const SHARE_CONTENT_VERSION = 0x01;
const SECP256K1_N = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
// PKCS#8 wrapper for a raw 32-byte X25519 private key (RFC 8410).
const X25519_PKCS8_PREFIX = hexToBytes('0x302e020100300506032b656e04220420');

const subtle = () => globalThis.crypto.subtle;
const utf8 = new TextEncoder();

// --- bytes -----------------------------------------------------------------

export function hexToBytes(hex) {
  if (typeof hex !== 'string' || !/^0x([0-9a-fA-F]{2})*$/.test(hex)) throw new Error(`Not 0x-prefixed hex: ${String(hex).slice(0, 20)}`);
  const out = new Uint8Array((hex.length - 2) / 2);
  for (let i = 0; i < out.length; i += 1) out[i] = parseInt(hex.slice(2 + i * 2, 4 + i * 2), 16);
  return out;
}

export function bytesToHex(bytes) {
  return `0x${Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')}`;
}

function concat(...parts) {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) { out.set(part, offset); offset += part.length; }
  return out;
}

export function base64ToBytes(value) {
  const binary = atob(value);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
}

function base64UrlToBytes(value) {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (value.length % 4)) % 4);
  return base64ToBytes(padded);
}

/** The message `personal_sign` takes: the UTF-8 bytes as hex. */
export function personalSignPayload(message = ENCRYPTION_KEY_MESSAGE) {
  return bytesToHex(utf8.encode(message));
}

function shareIdBytes(shareId) {
  const bytes = hexToBytes(shareId);
  if (bytes.length !== 32) throw new Error('A share id is 32 bytes');
  return bytes;
}

// --- crypto ----------------------------------------------------------------

/** Whether this browser's WebCrypto has X25519 (Chrome 133+, Safari 17+, Firefox 130+). */
export async function supportsX25519() {
  try {
    await subtle().generateKey({ name: 'X25519' }, false, ['deriveBits']);
    return true;
  } catch {
    return false;
  }
}

async function hkdf(ikm, salt, info, length = 32) {
  const key = await subtle().importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await subtle().deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info: utf8.encode(info) }, key, length * 8));
}

/** r || s of a 65-byte signature, with s normalized to the low half. */
function keyMaterial(signature) {
  const bytes = hexToBytes(signature);
  if (bytes.length !== 65) throw new Error(`Expected a 65-byte signature, got ${bytes.length} bytes`);
  let s = BigInt(bytesToHex(bytes.slice(32, 64)));
  if (s > SECP256K1_N / 2n) s = SECP256K1_N - s;
  return concat(bytes.slice(0, 32), hexToBytes(`0x${s.toString(16).padStart(64, '0')}`));
}

/**
 * The recipient's X25519 key pair from their signature of
 * ENCRYPTION_KEY_MESSAGE. `registeredKey` is what KeyRegistry stores
 * (0x01 || public key), so it can be compared before anything is spent.
 */
export async function deriveEncryptionKey(signature) {
  const privateKey = await hkdf(keyMaterial(signature), new Uint8Array(0), ENCRYPTION_KEY_HKDF_INFO);
  const key = await subtle().importKey('pkcs8', concat(X25519_PKCS8_PREFIX, privateKey), { name: 'X25519' }, true, ['deriveBits']);
  const publicKey = base64UrlToBytes((await subtle().exportKey('jwk', key)).x);
  return { key, publicKey, registeredKey: bytesToHex(concat(new Uint8Array([X25519_ALGORITHM_BYTE]), publicKey)) };
}

async function aesGcmOpen(rawKey, nonce, sealed, aad) {
  const key = await subtle().importKey('raw', rawKey, 'AES-GCM', false, ['decrypt']);
  return new Uint8Array(await subtle().decrypt({ name: 'AES-GCM', iv: nonce, additionalData: aad, tagLength: 128 }, key, sealed));
}

/** Recover the content key from a key package with the derived X25519 key. */
export async function openKeyPackage(keyPackage, encryptionKey, shareId) {
  if (keyPackage.version !== 1 || keyPackage.algorithm !== KEY_PACKAGE_ALGORITHM) {
    throw new Error(`Unsupported key package ${keyPackage.algorithm} v${keyPackage.version}`);
  }
  const recipient = hexToBytes(keyPackage.recipientKey);
  if (recipient.length !== 33 || recipient[0] !== X25519_ALGORITHM_BYTE) throw new Error('The key package is not sealed to an Obelisk X25519 key');
  const recipientPublic = recipient.slice(1);
  const ephemeralPublic = hexToBytes(keyPackage.ephemeralPublicKey);
  const ephemeral = await subtle().importKey('raw', ephemeralPublic, { name: 'X25519' }, false, []);
  const shared = new Uint8Array(await subtle().deriveBits({ name: 'X25519', public: ephemeral }, encryptionKey.key, 256));
  const wrapKey = await hkdf(shared, concat(ephemeralPublic, recipientPublic), SHARE_KEY_HKDF_INFO);
  return aesGcmOpen(wrapKey, hexToBytes(keyPackage.nonce), hexToBytes(keyPackage.wrappedKey), shareIdBytes(shareId));
}

/** Decrypt the uploaded ciphertext into the snapshot object. */
export async function decryptSnapshot(ciphertext, contentKey, shareId) {
  if (ciphertext[0] !== SHARE_CONTENT_VERSION) throw new Error(`Unknown share content version ${ciphertext[0]}`);
  const plain = await aesGcmOpen(contentKey, ciphertext.slice(1, 13), ciphertext.slice(13), shareIdBytes(shareId));
  const snapshot = JSON.parse(new TextDecoder().decode(plain));
  if (snapshot?.format !== 'obelisk.share.snapshot/v1') throw new Error('This share is not an Obelisk session snapshot');
  return snapshot;
}

// --- typed data ------------------------------------------------------------

const EIP712_DOMAIN = [
  { name: 'name', type: 'string' },
  { name: 'version', type: 'string' },
  { name: 'chainId', type: 'uint256' },
  { name: 'verifyingContract', type: 'address' },
];

/** Must match chain/eip712.ts. */
export const TYPES = {
  RecordOpen: [
    { name: 'recipient', type: 'address' },
    { name: 'shareId', type: 'bytes32' },
    { name: 'nonce', type: 'uint256' },
    { name: 'deadline', type: 'uint256' },
  ],
  RegisterKey: [
    { name: 'user', type: 'address' },
    { name: 'pubKey', type: 'bytes' },
    { name: 'nonce', type: 'uint256' },
    { name: 'deadline', type: 'uint256' },
  ],
};

const DOMAIN_NAMES = { ShareRegistry: 'ObeliskShareRegistry', KeyRegistry: 'ObeliskKeyRegistry' };

/** What `eth_signTypedData_v4` takes for one action; integers as decimal strings. */
export function typedData(action, contract, chain, message) {
  return {
    types: { EIP712Domain: EIP712_DOMAIN, [action]: TYPES[action] },
    primaryType: action,
    domain: { name: DOMAIN_NAMES[contract], version: '1', chainId: chain.chainId, verifyingContract: chain.contracts[contract] },
    message,
  };
}

// --- presentation ----------------------------------------------------------

export function shortAddress(address) {
  return typeof address === 'string' && address.length > 12 ? `${address.slice(0, 6)}…${address.slice(-4)}` : String(address);
}

/** The short share number printed on the page and in the watermark. */
export function shareNumber(shareId) {
  return `S-${shareId.slice(2, 6).toUpperCase()}`;
}

const pad = (n) => String(n).padStart(2, '0');

/** `2026-10-07 21:03` in the reader's local time. */
export function formatDateTime(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** `10-07 21:03`, for the watermark. */
export function formatShortDateTime(iso) {
  return formatDateTime(iso).slice(5);
}

const REDACTION_LABELS = {
  'Private key': '私钥',
  'API key': 'API 密钥',
  'Access token': '访问令牌',
  'Password or secret': '密码或密钥',
  'Connection string with credentials': '带凭据的连接串',
  'Local path with username': '含用户名的本地路径',
  'Email address': '邮箱',
  'Phone number': '电话号码',
  credentials: '凭据',
};

export function redactionLabel(label) {
  return REDACTION_LABELS[label] ?? label;
}

/**
 * Split text into plain strings and `{ redacted: label }` parts, so the page
 * can mark `[redacted: …]` placeholders (packages/core/src/privacy-scan.ts).
 */
export function splitRedactions(text) {
  const parts = [];
  const pattern = /\[redacted: ([^\]\n]{1,60})\]/g;
  let last = 0;
  for (const match of text.matchAll(pattern)) {
    if (match.index > last) parts.push(text.slice(last, match.index));
    parts.push({ redacted: redactionLabel(match[1]) });
    last = match.index + match[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

/**
 * Split message text into paragraphs and fenced code blocks. Everything is
 * rendered as text nodes; nothing in a snapshot is ever parsed as HTML.
 */
export function splitBlocks(text) {
  const blocks = [];
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  let code = null;
  let para = [];
  const flush = () => {
    const joined = para.join('\n').trim();
    if (joined) blocks.push({ kind: 'text', text: joined });
    para = [];
  };
  for (const line of lines) {
    const fence = /^\s*```(.*)$/.exec(line);
    if (code) {
      if (fence) { blocks.push({ kind: 'code', lang: code.lang, text: code.lines.join('\n') }); code = null; } else code.lines.push(line);
    } else if (fence) {
      flush();
      code = { lang: fence[1].trim(), lines: [] };
    } else if (line.trim() === '') {
      flush();
    } else {
      para.push(line);
    }
  }
  if (code) blocks.push({ kind: 'code', lang: code.lang, text: code.lines.join('\n') });
  flush();
  return blocks;
}

/** Inline `code` and **bold** spans inside a paragraph. */
export function splitInline(text) {
  const parts = [];
  const pattern = /`([^`\n]+)`|\*\*([^*\n]+)\*\*/g;
  let last = 0;
  for (const match of text.matchAll(pattern)) {
    if (match.index > last) parts.push({ kind: 'text', text: text.slice(last, match.index) });
    parts.push(match[1] !== undefined ? { kind: 'code', text: match[1] } : { kind: 'bold', text: match[2] });
    last = match.index + match[0].length;
  }
  if (last < text.length) parts.push({ kind: 'text', text: text.slice(last) });
  return parts;
}

function parseInput(input) {
  if (typeof input !== 'string') return null;
  try {
    const value = JSON.parse(input);
    return value && typeof value === 'object' ? value : null;
  } catch {
    return null;
  }
}

const basename = (path) => String(path).split(/[\\/]/).filter(Boolean).pop() ?? String(path);

/** One line describing a tool call, as the mockup's tool rows do. */
export function summarizeToolCall(call) {
  const input = parseInput(call.input) ?? {};
  const name = call.name ?? 'tool';
  const pick = (...keys) => keys.map((k) => input[k]).find((v) => typeof v === 'string' && v.trim());
  switch (name) {
    case 'Bash': return { verb: '运行', detail: pick('command') ?? '' };
    case 'Read': return { verb: '读取', detail: pick('file_path', 'path') ?? '' };
    case 'Edit': case 'MultiEdit': return { verb: '编辑', detail: pick('file_path', 'path') ?? '' };
    case 'Write': return { verb: '写入', detail: pick('file_path', 'path') ?? '' };
    case 'Grep': return { verb: '搜索', detail: [pick('pattern'), pick('path')].filter(Boolean).join(' · ') };
    case 'Glob': return { verb: '查找文件', detail: pick('pattern') ?? '' };
    case 'WebFetch': return { verb: '访问网页', detail: pick('url') ?? '' };
    case 'WebSearch': return { verb: '搜索网页', detail: pick('query') ?? '' };
    case 'Task': case 'Agent': return { verb: '子任务', detail: pick('description', 'prompt') ?? '' };
    case 'TodoWrite': return { verb: '更新待办', detail: '' };
    case 'exec_command': case 'shell': return { verb: '运行', detail: pick('cmd', 'command') ?? (Array.isArray(input.command) ? input.command.join(' ') : '') };
    case 'apply_patch': return { verb: '修改文件', detail: '' };
    default: return { verb: name, detail: pick('file_path', 'path', 'command', 'query', 'pattern', 'url', 'description') ?? '' };
  }
}

export { basename };

const PROVIDER_NAMES = { claude: 'Claude Code', codex: 'Codex', kimi: 'Kimi', pi: 'Pi', deepseek: 'DeepSeek' };

export function providerName(provider) {
  return PROVIDER_NAMES[provider] ?? provider ?? 'AI';
}

/** Who said it, for the label above a message. */
export function speaker(role, provider) {
  if (role === 'user') return '用户';
  if (role === 'assistant') return providerName(provider) === 'Claude Code' ? 'Claude' : providerName(provider);
  return role;
}
