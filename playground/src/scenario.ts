// Copyright (C) 2026 tommy0103 and contributors.
// SPDX-License-Identifier: AGPL-3.0-only

// A scenario is data: which simulated users exist, which harness each one
// uses, and in what order they say which prompt (or type which obelisk
// command). The same file runs on testnet or mainnet; only `network` (or the
// runner's --service-url) changes.
//
// {
//   "schema": "obelisk.playground.scenario/1",
//   "name": "smoke", "title": "…",
//   "network": { "serviceUrl": null, "chainId": 968 },
//   "defaults": { "harness": "claude-code", "model": null, "maxTurns": 8, "timeoutMinutes": 10 },
//   "roles": [{ "id": "A", "label": "作者 A", "harness": "codex", "skills": ["obelisk", "obelisk-distill"] }],
//   "steps": [
//     { "id": "a-task", "role": "A", "title": "…", "prompt": "…", "scenes": ["v1:task/writing"] },
//     { "id": "a-wallet", "role": "A", "title": "…", "cli": ["wallet", "show"] }
//   ]
// }
//
// A prompt step may carry `prompts: { "codex": "…" }` when the wording differs
// per harness, and `fake: { "commands": [["skill", "scenes"]] }`: the obelisk
// commands the fake harness runs for it in a dry run.

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import type { HarnessKind } from './provenance.ts';

export const SCENARIO_SCHEMA = 'obelisk.playground.scenario/1';

export type RealHarness = Exclude<HarnessKind, 'fake'>;

export interface ScenarioRole {
  id: string;
  label: string;
  harness: RealHarness;
  model: string | null;
  /** Skill directory names to install; null installs every built skill. */
  skills: string[] | null;
}

export interface ScenarioStep {
  id: string;
  role: string;
  title: string;
  scenes: string[];
  /** Exactly one of prompt / cli is set. */
  prompt: string | null;
  prompts: Partial<Record<RealHarness, string>>;
  cli: string[] | null;
  model: string | null;
  maxTurns: number;
  timeoutMinutes: number;
  fakeCommands: string[][];
}

export interface Scenario {
  name: string;
  title: string;
  network: { serviceUrl: string | null; chainId: number | null };
  roles: ScenarioRole[];
  steps: ScenarioStep[];
}

export interface LoadedScenario {
  scenario: Scenario;
  file: string;
  sha256: string;
}

const HARNESSES: RealHarness[] = ['claude-code', 'codex'];
const ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

type Obj = Record<string, unknown>;
const isObject = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const isStringArray = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === 'string');

export function parseScenario(value: unknown): Scenario {
  const problems: string[] = [];
  const need = (ok: boolean, message: string) => { if (!ok) problems.push(message); };
  if (!isObject(value)) throw new Error('Scenario must be a JSON object');
  need(value['schema'] === SCENARIO_SCHEMA, `schema must be ${SCENARIO_SCHEMA}`);
  need(typeof value['name'] === 'string' && ID.test(value['name']), 'name must be letters, digits, - or _');
  const network = isObject(value['network']) ? value['network'] : {};
  const serviceUrl = network['serviceUrl'] ?? null;
  const chainId = network['chainId'] ?? null;
  need(serviceUrl === null || typeof serviceUrl === 'string', 'network.serviceUrl must be a string or null');
  need(chainId === null || Number.isInteger(chainId), 'network.chainId must be an integer or null');

  const defaults = isObject(value['defaults']) ? value['defaults'] : {};
  const defaultHarness = (defaults['harness'] ?? 'claude-code') as RealHarness;
  need(HARNESSES.includes(defaultHarness), `defaults.harness must be one of ${HARNESSES.join(', ')}`);
  const positive = (v: unknown, fallback: number, what: string) => {
    if (v === undefined) return fallback;
    need(Number.isInteger(v) && (v as number) > 0, `${what} must be a positive integer`);
    return v as number;
  };
  const defaultTurns = positive(defaults['maxTurns'], 8, 'defaults.maxTurns');
  const defaultTimeout = positive(defaults['timeoutMinutes'], 10, 'defaults.timeoutMinutes');
  const defaultModel = typeof defaults['model'] === 'string' ? defaults['model'] : null;

  const roles: ScenarioRole[] = [];
  const roleIds = new Set<string>();
  if (!Array.isArray(value['roles']) || value['roles'].length === 0) problems.push('roles must be a non-empty array');
  for (const [i, raw] of (Array.isArray(value['roles']) ? value['roles'] : []).entries()) {
    if (!isObject(raw)) { problems.push(`roles[${i}] must be an object`); continue; }
    const id = raw['id'];
    need(typeof id === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,31}$/.test(id) && !roleIds.has(id), `roles[${i}].id must be a unique id of 1-32 letters, digits, - or _`);
    const harness = (raw['harness'] ?? defaultHarness) as RealHarness;
    need(HARNESSES.includes(harness), `roles[${i}].harness must be one of ${HARNESSES.join(', ')}`);
    need(raw['skills'] === undefined || isStringArray(raw['skills']), `roles[${i}].skills must be an array of skill names`);
    if (typeof id === 'string') roleIds.add(id);
    roles.push({
      id: String(id),
      label: typeof raw['label'] === 'string' ? raw['label'] : String(id),
      harness,
      model: typeof raw['model'] === 'string' ? raw['model'] : defaultModel,
      skills: isStringArray(raw['skills']) ? raw['skills'] : null,
    });
  }

  const steps: ScenarioStep[] = [];
  const stepIds = new Set<string>();
  if (!Array.isArray(value['steps']) || value['steps'].length === 0) problems.push('steps must be a non-empty array');
  for (const [i, raw] of (Array.isArray(value['steps']) ? value['steps'] : []).entries()) {
    if (!isObject(raw)) { problems.push(`steps[${i}] must be an object`); continue; }
    const id = raw['id'];
    need(typeof id === 'string' && ID.test(id) && !stepIds.has(id), `steps[${i}].id must be a unique id`);
    if (typeof id === 'string') stepIds.add(id);
    need(typeof raw['role'] === 'string' && roleIds.has(raw['role']), `steps[${i}].role must name a role`);
    const hasPrompt = typeof raw['prompt'] === 'string' && raw['prompt'].trim() !== '';
    const hasCli = isStringArray(raw['cli']) && raw['cli'].length > 0;
    need(hasPrompt !== hasCli, `steps[${i}] needs exactly one of prompt (a string) or cli (an array of obelisk arguments)`);
    const prompts = isObject(raw['prompts']) ? raw['prompts'] : {};
    need(Object.entries(prompts).every(([k, v]) => HARNESSES.includes(k as RealHarness) && typeof v === 'string'), `steps[${i}].prompts must map ${HARNESSES.join(' / ')} to strings`);
    need(raw['scenes'] === undefined || isStringArray(raw['scenes']), `steps[${i}].scenes must be an array of strings`);
    const fake = isObject(raw['fake']) ? raw['fake'] : {};
    const fakeCommands = Array.isArray(fake['commands']) ? fake['commands'] : [];
    need(fakeCommands.every(isStringArray), `steps[${i}].fake.commands must be arrays of obelisk arguments`);
    steps.push({
      id: String(id),
      role: String(raw['role']),
      title: typeof raw['title'] === 'string' ? raw['title'] : String(id),
      scenes: isStringArray(raw['scenes']) ? raw['scenes'] : [],
      prompt: hasPrompt ? (raw['prompt'] as string) : null,
      prompts: prompts as Partial<Record<RealHarness, string>>,
      cli: hasCli ? (raw['cli'] as string[]) : null,
      model: typeof raw['model'] === 'string' ? raw['model'] : null,
      maxTurns: positive(raw['maxTurns'], defaultTurns, `steps[${i}].maxTurns`),
      timeoutMinutes: positive(raw['timeoutMinutes'], defaultTimeout, `steps[${i}].timeoutMinutes`),
      fakeCommands: fakeCommands as string[][],
    });
  }

  if (problems.length) throw new Error(`Invalid scenario:\n- ${problems.join('\n- ')}`);
  return {
    name: value['name'] as string,
    title: typeof value['title'] === 'string' ? value['title'] : (value['name'] as string),
    network: { serviceUrl: serviceUrl as string | null, chainId: chainId as number | null },
    roles,
    steps,
  };
}

export function loadScenario(file: string): LoadedScenario {
  const text = readFileSync(file, 'utf8');
  let json: unknown;
  try { json = JSON.parse(text); } catch (error) { throw new Error(`${file} is not valid JSON: ${(error as Error).message}`, { cause: error }); }
  return { scenario: parseScenario(json), file, sha256: createHash('sha256').update(text).digest('hex') };
}

/** The prompt a step speaks to the given harness. */
export function promptFor(step: ScenarioStep, harness: RealHarness): string {
  return step.prompts[harness] ?? step.prompt ?? '';
}
