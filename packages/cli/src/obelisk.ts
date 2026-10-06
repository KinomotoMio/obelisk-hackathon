#!/usr/bin/env node
// Copyright (C) 2026 tommy0103 and contributors.
// SPDX-License-Identifier: AGPL-3.0-only


import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

import {
  DB_PATH,
  buildIndex,
  searchText,
  executeQuery,
  executeAttune,
  findSkillInvocations,
} from '../../core/src/core.ts';
import { resolveObeliskPaths } from '../../core/src/paths.ts';
import {
  listSkills,
  listUserSceneTags,
  readSkill,
  saveSkillDraft,
  skillBodyFromMarkdown,
  updateSkillBirthScenes,
  skillFingerprint,
} from '../../core/src/skills.ts';
import {
  CURRENT_SCENE_VOCABULARY,
  MAX_BIRTH_SCENES,
  MAX_SCENE_TAG_BYTES,
  SCENE_DIMENSIONS,
  SCENES,
  describeSceneTag,
  vocabularyTag,
} from '../../core/src/scenes.ts';
import {
  skillUsageFor,
  skillVersionsByFingerprint,
  summarizeSkillUsage,
} from '../../core/src/skill-invocations.ts';
import { runShareCommand } from './share-command.ts';
import { runSkillFetchCommand } from './skill-fetch-command.ts';
import { runSkillMintCommand } from './skill-mint-command.ts';
import { runWalletCommand } from './wallet-command.ts';

async function main() {
  const args = process.argv.slice(2);
  const fail = (value: unknown): void => {
    const error = value instanceof Error ? value : new Error(String(value));
    process.stdout.write(JSON.stringify({ error: error.message, stack: error.stack }) + '\n');
    process.exitCode = 1;
  };
  const emit = (value: unknown): void => {
    process.stdout.write(JSON.stringify(value, null, 2) + '\n');
  };

  if (args[0] === '--version' || args[0] === '-v') {
    const packageJson = JSON.parse(
      readFileSync(new URL('../../../package.json', import.meta.url), 'utf8'),
    ) as { version: string };
    process.stdout.write(`${packageJson.version}\n`);
    return;
  }
  if (args[0] === '--build') {
    try {
      const result = buildIndex({ force: true });
      if (!('complete' in result) || result.complete !== true) {
        const reason = 'reason' in result && typeof result.reason === 'string'
          ? result.reason
          : 'incomplete_snapshot';
        const issue = 'inventoryIssues' in result && Array.isArray(result.inventoryIssues)
          ? result.inventoryIssues[0] as { provider?: unknown; path?: unknown; error?: unknown } | undefined
          : undefined;
        let detail = '';
        if ('error' in result && typeof result.error === 'string') {
          detail = ` (${result.error})`;
        } else if (
          issue
          && typeof issue.provider === 'string'
          && typeof issue.path === 'string'
          && typeof issue.error === 'string'
        ) {
          detail = ` (${issue.provider} at ${issue.path}: ${issue.error})`;
        }
        throw new Error(`Index rebuild was not published: ${reason}${detail}`);
      }
      process.stdout.write(JSON.stringify({ ok: true, db: DB_PATH }) + '\n');
    } catch (error) { fail(error); }
    return;
  }
  if (args[0] === '--search' && args[1]) {
    try {
      // --nonce <token> marks this invocation in the transcript so the query
      // layer can identify the invoking session; it is not part of the FTS text.
      let nonce: string | undefined;
      const textParts: string[] = [];
      const rest = args.slice(1);
      for (let i = 0; i < rest.length; i++) {
        if (rest[i] === '--nonce' && rest[i + 1]) { nonce = rest[i + 1]; i++; } else { textParts.push(rest[i]); }
      }
      emit(searchText(textParts.join(' '), undefined, { invocationNonce: nonce }));
    } catch (error) { fail(error); }
    return;
  }
  if (args[0] === '--query' && args[1]) {
    try {
      const script = readFileSync(resolve(args[1]), 'utf8');
      // Nonce candidates, tried in order: the file path as typed (not
      // resolved), then the script content itself. The transcript records the
      // content verbatim (Write input, heredoc command text) even when the
      // path sits behind a shell variable — the documented mktemp flow — and
      // never reaches the transcript. Short scripts are not distinctive enough
      // to safely identify a session, so the path stands alone there. Content
      // is not unique by construction, so it resolves in strict mode: exactly
      // one recent matching session that itself invoked the CLI, else null.
      const CONTENT_NONCE_MIN_CHARS = 40;
      const trimmed = script.trim();
      const nonceCandidates = trimmed.length >= CONTENT_NONCE_MIN_CHARS
        ? [args[1], { value: trimmed, strict: true }]
        : [args[1]];
      emit(await executeQuery(script, { invocationNonce: nonceCandidates }));
    } catch (error) { fail(error); }
    return;
  }
  if (args[0] === '--attune' && args[1]) {
    try { emit(await executeAttune(readFileSync(resolve(args[1]), 'utf8'))); } catch (error) { fail(error); }
    return;
  }
  if (args[0] === 'skill') {
    try {
      const skillsDir = resolveObeliskPaths().skillsDir;
      const [, action, target] = args;
      if (action === 'list') {
        emit(await listSkills(skillsDir));
      } else if (action === 'show' && target) {
        const skill = await readSkill(skillsDir, target);
        if (!skill) throw new Error(`Skill not found in the local library: ${target}`);
        emit(skill);
      } else if (action === 'save' && target) {
        // The draft is a JSON file; `bodyFile` (relative to that file) may
        // replace an inline `body` so agents can keep the Markdown as Markdown.
        const draftPath = resolve(target);
        const draft = JSON.parse(readFileSync(draftPath, 'utf8')) as Record<string, unknown>;
        if (typeof draft['bodyFile'] === 'string') {
          draft['body'] = readFileSync(resolve(dirname(draftPath), draft['bodyFile']), 'utf8');
          delete draft['bodyFile'];
        }
        const skill = await saveSkillDraft(skillsDir, draft);
        emit({ name: skill.name, fingerprint: skill.draft?.fingerprint ?? null, path: skill.draft?.path ?? null, status: skill.status });
      } else if (action === 'scenes') {
        // The current scene vocabulary, ready to copy as tags, plus the
        // user-created tags this library has recorded.
        emit({
          vocabulary: `v${CURRENT_SCENE_VOCABULARY.version}`,
          rule: 'Prefer a vocabulary tag. Only when nothing in a dimension fits, create user:<dimension>/<label> and say why.',
          limits: { perSkill: MAX_BIRTH_SCENES, bytesPerTag: MAX_SCENE_TAG_BYTES },
          dimensions: SCENE_DIMENSIONS.map((dimension) => ({
            id: dimension.id,
            label: dimension.label,
            labelEn: dimension.labelEn,
            tags: SCENES.filter((scene) => scene.dimension === dimension.id)
              .map((scene) => ({ tag: vocabularyTag(scene.id), label: scene.label, labelEn: scene.labelEn })),
          })),
          userTags: (await listUserSceneTags(skillsDir)).map(({ tag, label, skills }) => ({ tag, label, skills })),
        });
      } else if (action === 'tag' && target) {
        // obelisk skill tag <name> [--add <tag>]... [--remove <tag>]...
        const add: string[] = [];
        const remove: string[] = [];
        const rest = args.slice(3);
        for (let i = 0; i < rest.length; i += 2) {
          const value = rest[i + 1];
          if ((rest[i] !== '--add' && rest[i] !== '--remove') || value === undefined) {
            throw new Error('Usage: obelisk skill tag <name> [--add <tag>]... [--remove <tag>]...');
          }
          (rest[i] === '--add' ? add : remove).push(value);
        }
        const skill = await updateSkillBirthScenes(skillsDir, target, { add, remove });
        emit({ name: skill.name, birthScenes: skill.birthScenes.map((tag) => describeSceneTag(tag)) });
      } else if (action === 'invocations') {
        // Skill loads recognized in the index, mapped to library versions by
        // fingerprint. With a name: that Skill's versions and every load.
        const versions = await skillVersionsByFingerprint(skillsDir);
        if (target && ![...versions.values()].flat().some((match) => match.name === target) && !(await readSkill(skillsDir, target))) {
          throw new Error(`Skill not found in the local library: ${target} (nor among fetched Skills)`);
        }
        const invocations = findSkillInvocations();
        emit(target ? skillUsageFor(target, invocations, versions) : summarizeSkillUsage(invocations, versions));
      } else if (action === 'mint') {
        emit(await runSkillMintCommand(args.slice(2)));
      } else if (action === 'fetch') {
        emit(await runSkillFetchCommand(args.slice(2)));
      } else if (action === 'fingerprint' && target) {
        emit({ fingerprint: skillFingerprint(skillBodyFromMarkdown(readFileSync(resolve(target), 'utf8'))) });
      } else {
        throw new Error('Usage: obelisk skill list | show <name> | save <draft.json> | scenes | tag <name> [--add <tag>] [--remove <tag>] | invocations [<name>] | fingerprint <SKILL.md> | mint <name> [--confirm <fingerprint>] | fetch <skill id | fingerprint> [--version <n>] [--name <name>] [--project <dir>] [--confirm]');
      }
    } catch (error) { fail(error); }
    return;
  }
  if (args[0] === 'wallet') {
    try { emit(await runWalletCommand(args.slice(1))); } catch (error) { fail(error); }
    return;
  }
  if (args[0] === 'share') {
    try { emit(await runShareCommand(args.slice(1))); } catch (error) { fail(error); }
    return;
  }
  if (args[0] === 'install') {
    const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
    const child = spawnSync(
      npx,
      ['--yes', 'skills', 'add', 'tommy0103/obelisk-skill', ...args.slice(1)],
      { stdio: 'inherit', shell: process.platform === 'win32' },
    );
    if (child.error) {
      process.stderr.write(`Unable to run the skills installer: ${child.error.message}\n`);
      process.exitCode = 1;
    } else {
      process.exitCode = child.status ?? 1;
    }
    return;
  }
  process.stderr.write('Usage:\n  obelisk install [skills options]\n  obelisk --build\n  obelisk --search "text" [--nonce <token>]\n  obelisk --query <file.js>\n  obelisk --attune <file.js>\n  obelisk skill list | show <name> | save <draft.json> | scenes | tag <name> [--add <tag>] [--remove <tag>] | invocations [<name>] | fingerprint <SKILL.md> | mint <name> [--confirm <fingerprint>] | fetch <skill id | fingerprint> [--version <n>] [--name <name>] [--project <dir>] [--confirm]\n  obelisk wallet create | show | activate [--confirm]\n  obelisk share outline <session-id>\n  obelisk share draft <session-id> --to <0x address> [--messages <from>-<to>|all] [--opens <n>|unlimited] [--expires <n>m|h|d]\n  obelisk share send <draft-id> [--redact all|none|<n>,<n>…] [--confirm]\n  obelisk share list [--to <0x address>]\n  obelisk share status <draft-id|share-id>\n');
  process.exitCode = 1;
}

void main();
