// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 tommy0103 and contributors.

// The signed user actions this service relays, and how a JSON request body
// becomes the typed values the contracts and EIP-712 expect.
//
// Every `fooBySig` entry point takes the typed-data fields in declaration
// order, minus `nonce` (the contract uses the signer's current one), followed
// by the signature. That holds for all actions in chain/eip712.ts, so one
// table plus the typed-data definitions describe the whole relay surface.

import { getAddress, isAddress, isHex, size, type Address, type Hex } from 'viem';

import {
  keyRegistryTypes,
  shareRegistryTypes,
  skillRegistryTypes,
  usageStatsTypes,
} from '../../chain/eip712.ts';
import type { ContractName } from './chains.ts';

type TypedField = { readonly name: string; readonly type: string };
type TypeTable = Readonly<Record<string, readonly TypedField[]>>;

export interface RelayAction {
  contract: ContractName;
  functionName: string;
  /** Typed-data field holding the address that must have signed. */
  signerField: string;
  types: TypeTable;
}

// `RecordOpen` is deliberately absent: the online service submits it itself
// as part of releasing a key package (#9), after checking the share's rules.
export const RELAY_ACTIONS = {
  RegisterKey: { contract: 'KeyRegistry', functionName: 'registerKeyBySig', signerField: 'user', types: keyRegistryTypes },
  CreateShare: { contract: 'ShareRegistry', functionName: 'createShareBySig', signerField: 'sender', types: shareRegistryTypes },
  RevokeShare: { contract: 'ShareRegistry', functionName: 'revokeBySig', signerField: 'sender', types: shareRegistryTypes },
  MintSkill: { contract: 'SkillRegistry', functionName: 'mintBySig', signerField: 'author', types: skillRegistryTypes },
  PublishVersion: { contract: 'SkillRegistry', functionName: 'publishVersionBySig', signerField: 'author', types: skillRegistryTypes },
  ReportUsage: { contract: 'UsageStats', functionName: 'reportBySig', signerField: 'reporter', types: usageStatsTypes },
} as const satisfies Record<string, RelayAction>;

export type RelayActionName = keyof typeof RELAY_ACTIONS;

export function isRelayActionName(value: unknown): value is RelayActionName {
  return typeof value === 'string' && Object.hasOwn(RELAY_ACTIONS, value);
}

/** A request the caller got wrong; the message is safe to return verbatim. */
export class RequestError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: Record<string, unknown>;
  constructor(status: number, code: string, message: string, details?: Record<string, unknown>) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

function invalid(path: string, expected: string): RequestError {
  return new RequestError(400, 'invalid_message', `message.${path} must be ${expected}`);
}

function parseUint(value: unknown, bits: number, path: string): bigint {
  let parsed: bigint;
  if (typeof value === 'number' && Number.isSafeInteger(value)) parsed = BigInt(value);
  else if (typeof value === 'string' && /^(0|[1-9][0-9]*)$/.test(value)) parsed = BigInt(value);
  else throw invalid(path, `a uint${bits} as a decimal string`);
  if (parsed < 0n || parsed >= 1n << BigInt(bits)) throw invalid(path, `a uint${bits}`);
  return parsed;
}

function parseValue(type: string, value: unknown, types: TypeTable, path: string): unknown {
  if (type.endsWith('[]')) {
    if (!Array.isArray(value)) throw invalid(path, `an array of ${type.slice(0, -2)}`);
    return value.map((item, index) => parseValue(type.slice(0, -2), item, types, `${path}[${index}]`));
  }
  if (Object.hasOwn(types, type)) return parseStruct(types[type]!, value, types, path);
  if (type === 'address') {
    if (typeof value !== 'string' || !isAddress(value, { strict: false })) throw invalid(path, 'an address');
    return getAddress(value);
  }
  if (type === 'string') {
    if (typeof value !== 'string') throw invalid(path, 'a string');
    return value;
  }
  if (type === 'bytes') {
    if (typeof value !== 'string' || !isHex(value, { strict: true })) throw invalid(path, '0x-prefixed hex bytes');
    return value.toLowerCase();
  }
  const fixedBytes = /^bytes([0-9]+)$/.exec(type);
  if (fixedBytes) {
    const length = Number(fixedBytes[1]);
    if (typeof value !== 'string' || !isHex(value, { strict: true }) || size(value as Hex) !== length) {
      throw invalid(path, `${length} bytes of 0x-prefixed hex`);
    }
    return value.toLowerCase();
  }
  const uint = /^uint([0-9]+)$/.exec(type);
  if (uint) return parseUint(value, Number(uint[1]), path);
  throw new Error(`Unsupported typed-data type ${type}`);
}

function parseStruct(fields: readonly TypedField[], value: unknown, types: TypeTable, path: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw invalid(path || 'message', 'an object');
  const input = value as Record<string, unknown>;
  const expected = new Set(fields.map((field) => field.name));
  const extra = Object.keys(input).filter((key) => !expected.has(key));
  if (extra.length > 0) {
    throw new RequestError(400, 'invalid_message', `message${path ? `.${path}` : ''} has unexpected field(s): ${extra.join(', ')}`);
  }
  const out: Record<string, unknown> = {};
  for (const field of fields) {
    const fieldPath = path ? `${path}.${field.name}` : field.name;
    if (!Object.hasOwn(input, field.name)) throw invalid(fieldPath, `present (${field.type})`);
    out[field.name] = parseValue(field.type, input[field.name], types, fieldPath);
  }
  return out;
}

export interface ParsedRelayRequest {
  action: RelayActionName;
  definition: RelayAction;
  /** Typed values, ready for EIP-712 hashing. */
  message: Record<string, unknown>;
  signer: Address;
  nonce: bigint;
  deadline: bigint;
  signature: Hex;
  /** Contract call arguments: typed fields minus `nonce`, then the signature. */
  args: unknown[];
}

/** Validate a `POST /v1/relay` body: `{ action, message, signature }`. */
export function parseRelayRequest(body: unknown): ParsedRelayRequest {
  if (typeof body !== 'object' || body === null) throw new RequestError(400, 'invalid_request', 'Request body must be a JSON object');
  const { action, message, signature } = body as Record<string, unknown>;
  if (!isRelayActionName(action)) {
    throw new RequestError(400, 'unknown_action', `action must be one of: ${Object.keys(RELAY_ACTIONS).join(', ')}`);
  }
  if (typeof signature !== 'string' || !isHex(signature, { strict: true }) || size(signature as Hex) < 65) {
    throw new RequestError(400, 'invalid_signature', 'signature must be 0x-prefixed hex of at least 65 bytes');
  }
  const definition: RelayAction = RELAY_ACTIONS[action];
  const fields = definition.types[action]!;
  const parsed = parseStruct(fields, message, definition.types, '');
  const args = fields.filter((field) => field.name !== 'nonce').map((field) => parsed[field.name]);
  args.push(signature);
  return {
    action,
    definition,
    message: parsed,
    signer: parsed[definition.signerField] as Address,
    nonce: parsed['nonce'] as bigint,
    deadline: parsed['deadline'] as bigint,
    signature: signature as Hex,
    args,
  };
}
