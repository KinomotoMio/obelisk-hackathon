// Copyright (C) 2026 tommy0103 and contributors.
// SPDX-License-Identifier: AGPL-3.0-only

// Prompts the Skill tab copies. The App only displays the Skill library; its
// buttons copy a prompt for the user's AI coding assistant, which does the work
// through the Obelisk CLI (docs/vision/README.md, "CLI 优先，App 负责展示").
// In Claude Code a prompt starts with its skill's slash command, so pasting it
// always runs that skill instead of relying on the model to pick one:
// /obelisk-distill drafts (agent-skills/obelisk-distill), /obelisk-skill-assets
// mints and fetches (agent-skills/obelisk-skill-assets). A minted Skill is
// named by its Skill id, never by an abbreviated fingerprint, which is not
// unique on chain.

export const DISTILL_COMMAND = '/obelisk-distill';
export const SKILL_ASSETS_COMMAND = '/obelisk-skill-assets';

export const DISTILL_EXAMPLE_PROMPT = `${DISTILL_COMMAND} 把我最近……的做法沉淀成一个 Skill`;

function sessionReference({ sessionId, title }) {
  const name = typeof title === 'string' ? title.trim() : '';
  return name ? `session「${name}」（${sessionId}）` : `session ${sessionId}`;
}

/** Continue editing the draft; the user types what to change after the colon. */
export function continueEditingPrompt(skill) {
  if (skill.versions?.length && skill.draft?.minted) {
    return `${DISTILL_COMMAND} 继续修改 Skill「${skill.name}」，改好后保存成新的草稿：`;
  }
  return `${DISTILL_COMMAND} 继续修改草稿「${skill.name}」：`;
}

/** Drop one source session from the draft's evidence and redraft without it. */
export function dropEvidencePrompt(skill, session) {
  return `${DISTILL_COMMAND} 从草稿「${skill.name}」的证据中去掉 ${sessionReference(session)}，重新起草`;
}

/**
 * Mint the draft the user reviewed. The skill previews first; the prompt also
 * names the fingerprint shown in the App, and the confirmation uses it, so a
 * draft that changed after the review is refused by `--confirm` and what gets
 * minted is exactly what the user read here.
 */
export function mintPrompt(skill) {
  const fingerprint = skill.draft?.fingerprint;
  if (!fingerprint) throw new Error(`Skill ${skill.name} has no draft to mint`);
  const what = skill.versions?.some(version => version.mint)
    ? `Skill「${skill.name}」的新版本`
    : `Skill 草稿「${skill.name}」`;
  return `${SKILL_ASSETS_COMMAND} 铸造 ${what}，先给我看铸造预览。`
    + `我在 App 里审阅的版本指纹是 ${fingerprint}，预览里的指纹不一样就停下告诉我；`
    + `一样的话等我确认，再运行 \`obelisk skill mint ${skill.name} --confirm ${fingerprint}\`。`;
}

// `Skill #7「ai-resume」v2`, or `Skill #7 v2` when no body (and so no name) is stored.
function mintedVersion(skill, versionIndex) {
  const version = `v${versionIndex + 1}`;
  return skill.name ? `Skill #${skill.skillId}「${skill.name}」${version}` : `Skill #${skill.skillId} ${version}`;
}

/** Fetch a minted version into Claude Code; the user says what to do with it after the colon. */
export function fetchPrompt(skill, versionIndex) {
  return `${SKILL_ASSETS_COMMAND} 取用 ${mintedVersion(skill, versionIndex)}，帮我：`;
}

/** Derive a new Skill from a minted one, recording it as the parent when minted. */
export function derivePrompt(skill, versionIndex) {
  return `${DISTILL_COMMAND} 在 ${mintedVersion(skill, versionIndex)} 的基础上改出一个新版本，铸造时记录父 Skill。我想改成：`;
}
