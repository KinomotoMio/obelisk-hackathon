// Copyright (C) 2026 tommy0103 and contributors.
// SPDX-License-Identifier: AGPL-3.0-only

// `obelisk skill fetch <skill id | fingerprint> [--confirm]` (#17, vision 03 K5).
//
// Fetches a minted Skill version's body from the online service, checks it
// against the fingerprint recorded on chain, and installs it for the selected
// harness (Claude .claude/skills by default, Codex .agents/skills), globally
// or under --project. Without --confirm it only previews: the body is another
// author's instructions, so the user sees it before Claude Code can follow
// it. The next step names the exact fingerprint to install. Each install is
// recorded in the local library (skill-fetches.ts), so later invocations are
// recognized as uses of that minted version (#22).

import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

import { resolveObeliskPaths } from '../../core/src/paths.ts';
import { networkLabel } from '../../core/src/obelisk-service.ts';
import { describeSceneTag } from '../../core/src/scenes.ts';
import {
  findDynamicSkillContent,
  normalizeSkillBody,
  renderSkillMarkdown,
  skillBodyFromMarkdown,
  skillFingerprint,
} from '../../core/src/skills.ts';
import { fingerprintFromBytes32, fingerprintToBytes32 } from '../../core/src/skill-chain.ts';
import { fetchInstalledAt, recordSkillFetch } from '../../core/src/skill-fetches.ts';
import { skillService, type SkillChainDeps } from './skill-mint-command.ts';

export const SKILL_FETCH_USAGE = 'Usage: obelisk skill fetch <skill id | fingerprint> [--version <n>] [--name <name>] [--project <dir>] [--harness claude|codex] [--confirm]';

const NAME_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function envOf(deps: SkillChainDeps): NodeJS.ProcessEnv {
  return deps.env ?? process.env;
}

function harnessSkillsDir(deps: SkillChainDeps, project: string | null, harness: 'claude' | 'codex'): string {
  if (harness === 'codex') return join(project === null ? (envOf(deps)['HOME']?.trim() || homedir()) : resolve(deps.cwd ?? process.cwd(), project), '.agents', 'skills');
  if (project !== null) return join(resolve(deps.cwd ?? process.cwd(), project), '.claude', 'skills');
  const env = envOf(deps);
  const configDir = env['CLAUDE_CONFIG_DIR']?.trim() || join(env['HOME']?.trim() || homedir(), '.claude');
  return join(configDir, 'skills');
}

async function readOptional(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

interface FetchOptions {
  version: number | null;
  name: string | null;
  project: string | null;
  confirm: boolean;
  harness: 'claude' | 'codex';
}

async function fetchSkill(ref: string, options: FetchOptions, deps: SkillChainDeps) {
  const idMatch = /^#?([1-9]\d{0,30})$/.exec(ref);
  const fpMatch = /^(?:0x)?([0-9a-fA-F]{64})$/.exec(ref);
  if (!idMatch && !fpMatch) {
    throw new Error(`Cannot look up ${JSON.stringify(ref)}: pass the Skill id (for example 12) or the full 64-hex fingerprint. Names and shortened fingerprints are not unique on chain.`);
  }
  if (fpMatch && options.version !== null) throw new Error('--version applies to a Skill id; a fingerprint already names one version');
  if (options.confirm && !fpMatch) {
    throw new Error('--confirm takes the fingerprint from the preview: run `obelisk skill fetch <fingerprint> --confirm`, so what gets installed is exactly what the user saw');
  }
  const requested = fpMatch ? fpMatch[1]!.toLowerCase() : null;

  const client = skillService(deps);
  const chain = await client.chain();
  const info = requested
    ? await client.skill(fingerprintToBytes32(requested))
    : await client.skill(idMatch![1]!, options.version === null ? {} : { versionIndex: options.version - 1 });
  const fingerprint = fingerprintFromBytes32(info.version.fingerprint);
  const label = `Skill #${info.skillId} version ${info.version.index + 1}`;
  if (requested && requested !== fingerprint) throw new Error(`The Obelisk online service returned ${fingerprint} for ${requested}; refusing it`);
  if (!info.content) {
    throw new Error(`${label} is minted, but its body is not stored on the Obelisk online service; its author can store it by running \`obelisk skill mint <name> --confirm ${fingerprint}\` again`);
  }
  const { body, description } = info.content;
  if (info.content.locked || typeof body !== 'string') {
    throw new Error(`${label} requires a purchase or author access before installation; its public description is not the Skill body`);
  }
  if (normalizeSkillBody(body) !== body || skillFingerprint(body) !== fingerprint) {
    throw new Error(`The body served for ${label} does not hash to its on-chain fingerprint ${fingerprint}; refusing to install it`);
  }
  const name = options.name ?? info.content.name;
  if (name.length > 64 || !NAME_RE.test(name)) throw new Error(`--name must be 1-64 lowercase letters, digits, and single hyphens (got ${JSON.stringify(name)})`);

  const skillsDir = resolveObeliskPaths({ env: envOf(deps) }).skillsDir;
  const installDir = join(harnessSkillsDir(deps, options.project, options.harness), name);
  const installTo = join(installDir, 'SKILL.md');
  const existing = await readOptional(installTo);
  const existingFingerprint = existing === null ? null : skillFingerprint(skillBodyFromMarkdown(existing));
  const previous = existing === null ? null : await fetchInstalledAt(skillsDir, installTo);
  if (existing !== null && existingFingerprint !== fingerprint && !previous) {
    throw new Error(`${installTo} already holds a different Skill that Obelisk did not install; pass --name <other-name> to install this one under another name`);
  }
  const replaces = existing !== null && existingFingerprint !== fingerprint && previous
    ? { skillId: previous.skillId, version: previous.versionIndex + 1, fingerprint: previous.fingerprint }
    : null;

  const summary = {
    skillId: info.skillId,
    version: info.version.index + 1,
    versionCount: info.versionCount,
    fingerprint,
    author: info.author,
    parentSkillId: info.parentSkillId,
    birthScenes: info.birthScenes.map((tag) => {
      const described = describeSceneTag(tag);
      return { tag, label: described.label, dimension: described.dimension };
    }),
    mintedAt: info.version.publishedAt,
    network: networkLabel(chain.chainId),
    explorer: { author: info.explorer.author },
  };
  const harnessName = options.harness === 'codex' ? 'Codex' : 'Claude Code';
  const flags = [
    options.name ? ` --name ${name}` : '',
    options.project !== null ? ` --project ${JSON.stringify(options.project)}` : '',
    ` --harness ${options.harness}`,
  ].join('');
  const warnings = findDynamicSkillContent(body).map((item) =>
    `The body contains ${item}, which Claude Code rewrites at load time, so its invocations will not be recognized as this version.`);

  if (!options.confirm) {
    return {
      preview: true,
      action: replaces ? `Replace the installed ${name} with ${label}` : existing !== null ? `${label} is already installed` : `Install ${label} into ${harnessName}`,
      name,
      description,
      skill: summary,
      verified: 'The body hashes to the fingerprint recorded on chain.',
      installTo,
      ...(replaces ? { replaces } : {}),
      body,
      trust: `These instructions were written by ${info.author}. ${harnessName} follows them whenever the Skill is used; show the user what the body asks for before installing.`,
      ...(warnings.length > 0 ? { warnings } : {}),
      next: `Show this preview to the user. Only after they confirm, run \`obelisk skill fetch ${fingerprint} --confirm${flags}\`.`,
    };
  }

  const already = existing !== null && existingFingerprint === fingerprint;
  if (!already) {
    await mkdir(installDir, { recursive: true });
    const temporary = `${installTo}.${process.pid}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, renderSkillMarkdown({ name, description, body }));
      await rename(temporary, installTo);
    } catch (error) {
      await rm(temporary, { force: true });
      throw error;
    }
  }
  await recordSkillFetch(skillsDir, {
    name,
    fingerprint,
    chainId: chain.chainId,
    skillId: info.skillId,
    versionIndex: info.version.index,
    author: info.author,
    installedTo: installTo,
    description,
    fetchedAt: (deps.now?.() ?? new Date()).toISOString(),
  });
  return {
    status: already ? 'already_installed' : replaces ? 'updated' : 'installed',
    name,
    description,
    skill: summary,
    installedTo: installTo,
    ...(replaces ? { replaced: replaces } : {}),
    recorded: true,
    next: `Installed for ${harnessName} as ${name}${options.project === null ? ' (all projects)' : ' (this project only)'}. Use it by asking for what it does or with ${options.harness === 'codex' ? '$' : '/'}${name}; if ${harnessName} does not list it, start a new session. Its uses show up in \`obelisk skill invocations ${name}\`.`,
  };
}

export async function runSkillFetchCommand(args: string[], deps: SkillChainDeps = {}): Promise<unknown> {
  const [ref, ...rest] = args;
  if (!ref || ref.startsWith('--')) throw new Error(SKILL_FETCH_USAGE);
  const options: FetchOptions = { version: null, name: null, project: null, confirm: false, harness: 'claude' };
  for (let i = 0; i < rest.length; i++) {
    const flag = rest[i];
    const value = rest[i + 1];
    if (flag === '--confirm') { options.confirm = true; continue; }
    if (value === undefined) throw new Error(SKILL_FETCH_USAGE);
    if (flag === '--version' && /^[1-9]\d{0,8}$/.test(value)) options.version = Number(value);
    else if (flag === '--name') options.name = value;
    else if (flag === '--harness' && (value === 'codex' || value === 'claude')) options.harness = value;
    else if (flag === '--project') options.project = value;
    else throw new Error(SKILL_FETCH_USAGE);
    i++;
  }
  return fetchSkill(ref, options, deps);
}
