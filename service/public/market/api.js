// Reads of this service's public API (same origin). Everything it returns is
// checked before it reaches the page: ids, addresses, and fingerprints by
// pattern, numbers as finite, text as strings.

import { loadChain } from '/site/site.js';

const SKILL_ID = /^[1-9]\d{0,30}$/;
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const HEX32 = /^0x[0-9a-fA-F]{64}$/;

export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

async function getJson(path) {
  let response;
  try {
    response = await fetch(path, { headers: { accept: 'application/json' } });
  } catch {
    throw new ApiError(0, '连不上 Obelisk 在线服务，请检查网络后刷新。');
  }
  let body = null;
  try {
    body = await response.json();
  } catch {
    // Left null; reported below.
  }
  if (!response.ok) throw new ApiError(response.status, typeof body?.error?.message === 'string' ? body.error.message : `在线服务返回 HTTP ${response.status}`);
  if (!body || typeof body !== 'object') throw new ApiError(response.status, '在线服务返回了无法读取的数据');
  return body;
}

export const isSkillId = (value) => typeof value === 'string' && SKILL_ID.test(value);
export const isAddress = (value) => typeof value === 'string' && ADDRESS.test(value);
export const isHex32 = (value) => typeof value === 'string' && HEX32.test(value);
export const num = (value) => (typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0);
export const str = (value, max = 2048) => (typeof value === 'string' ? value.slice(0, max) : null);
export const list = (value) => (Array.isArray(value) ? value : []);

export const chain = () => loadChain();
export const skills = (before) => getJson(`/v1/skills?limit=24${before ? `&before=${encodeURIComponent(before)}` : ''}`);
export const skill = (id) => getJson(`/v1/skills/${id}`);
export const usage = (id) => getJson(`/v1/skills/${id}/usage?weeks=8`);
export const lineage = (id) => getJson(`/v1/skills/${id}/lineage`);
export const offer = (fingerprint) => getJson(`/v1/market/offers/${encodeURIComponent(fingerprint)}`);

/** An explorer page for an address or transaction, when the chain has an explorer. */
export function explorer(chainInfo, kind, value) {
  const base = str(chainInfo?.explorerUrl, 200);
  if (!base || !/^https:\/\//.test(base)) return null;
  if (kind === 'address' && !isAddress(value)) return null;
  if (kind === 'tx' && !isHex32(value)) return null;
  return `${base.replace(/\/+$/, '')}/${kind}/${value}`;
}
