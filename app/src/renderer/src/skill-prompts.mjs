// Copyright (C) 2026 tommy0103 and contributors.
// SPDX-License-Identifier: AGPL-3.0-only

// Prompts the Skill tab copies. The App only displays the Skill library; its
// buttons copy a prompt for the user's AI coding assistant, which does the work
// through the Obelisk CLI (docs/vision/README.md, "CLI 优先，App 负责展示").
// Each prompt opens with the phrase its agent skill is triggered by:
// 「沉淀 Skill」 for drafting (agent-skills/obelisk-distill) and "用 Obelisk
// 铸造" for minting (agent-skills/obelisk-skill-assets).

export const DISTILL_EXAMPLE_PROMPT = '用「沉淀 Skill」把我最近……的做法沉淀成一个 Skill';

function sessionReference({ sessionId, title }) {
  const name = typeof title === 'string' ? title.trim() : '';
  return name ? `session「${name}」（${sessionId}）` : `session ${sessionId}`;
}

/** Continue editing the draft; the user types what to change after the colon. */
export function continueEditingPrompt(skill) {
  if (skill.versions?.length && skill.draft?.minted) {
    return `用「沉淀 Skill」继续修改 Skill「${skill.name}」，改好后保存成新的草稿：`;
  }
  return `用「沉淀 Skill」继续修改草稿「${skill.name}」：`;
}

/** Drop one source session from the draft's evidence and redraft without it. */
export function dropEvidencePrompt(skill, session) {
  return `用「沉淀 Skill」从草稿「${skill.name}」的证据中去掉 ${sessionReference(session)}，重新起草`;
}

/**
 * Mint the draft the user reviewed. The prompt leads to the CLI's two steps:
 * a preview, then `--confirm` with the fingerprint shown in the App. If the
 * draft changes after the review, that confirmation is refused, so what gets
 * minted is exactly what the user read here.
 */
export function mintPrompt(skill) {
  const fingerprint = skill.draft?.fingerprint;
  if (!fingerprint) throw new Error(`Skill ${skill.name} has no draft to mint`);
  const what = skill.versions?.some(version => version.mint)
    ? `Skill「${skill.name}」的新版本`
    : `Skill 草稿「${skill.name}」`;
  return [
    `用 Obelisk 铸造 ${what}。`,
    `先运行 \`obelisk skill mint ${skill.name}\` 给我看铸造预览；我在 App 里审阅的版本指纹是 ${fingerprint}，预览里的指纹不一样就停下告诉我。`,
    `我确认之后，再运行 \`obelisk skill mint ${skill.name} --confirm ${fingerprint}\`。`,
  ].join('\n');
}
