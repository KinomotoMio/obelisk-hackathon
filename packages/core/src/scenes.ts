// Copyright (C) 2026 tommy0103 and contributors.
// SPDX-License-Identifier: AGPL-3.0-only

// The fixed scene list. Birth scenes (where a Skill was distilled from, #15)
// and observed scenes (where an invocation happened, #25) are both picked from
// this list so tags from different users can be aggregated and compared
// (docs/vision/04-real-usage-and-scenarios.md, "场景标签").
//
// Ids are the stable contract: they are written to skill.json and, when a Skill
// is minted, to SkillRegistry.birthScenes on chain (at most 16 per Skill, each
// 1-64 bytes). Never rename or reuse an id; add new ones instead. Labels are
// display text and may change.

export type SceneDimension = 'domain' | 'task' | 'artifact';

export interface Scene {
  id: string;
  dimension: SceneDimension;
  label: string;
  labelEn: string;
}

export const SCENE_DIMENSIONS: ReadonlyArray<{ id: SceneDimension; label: string; labelEn: string }> = [
  { id: 'domain', label: '领域', labelEn: 'Domain' },
  { id: 'task', label: '任务类型', labelEn: 'Task' },
  { id: 'artifact', label: '产出物', labelEn: 'Artifact' },
];

// Mirrors SkillRegistry.MAX_BIRTH_SCENES.
export const MAX_BIRTH_SCENES = 16;

const scene = (dimension: SceneDimension, slug: string, label: string, labelEn: string): Scene => (
  { id: `${dimension}/${slug}`, dimension, label, labelEn }
);

export const SCENES: readonly Scene[] = Object.freeze([
  scene('domain', 'frontend', '前端', 'Frontend'),
  scene('domain', 'backend', '后端与服务', 'Backend and services'),
  scene('domain', 'mobile', '移动端', 'Mobile'),
  scene('domain', 'desktop', '桌面应用', 'Desktop apps'),
  scene('domain', 'data', '数据工程与分析', 'Data engineering and analytics'),
  scene('domain', 'ai-ml', 'AI 与机器学习', 'AI and machine learning'),
  scene('domain', 'devops', '运维与基础设施', 'DevOps and infrastructure'),
  scene('domain', 'security', '安全', 'Security'),
  scene('domain', 'blockchain', '区块链与智能合约', 'Blockchain and smart contracts'),
  scene('domain', 'developer-tools', '开发者工具与 CLI', 'Developer tools and CLIs'),
  scene('domain', 'design', '视觉与交互设计', 'Visual and interaction design'),
  scene('domain', 'product', '产品与项目管理', 'Product and project management'),
  scene('domain', 'career', '求职与职业发展', 'Job search and career'),
  scene('domain', 'education', '学习与教学', 'Learning and teaching'),
  scene('domain', 'content', '内容创作与运营', 'Content and marketing'),
  scene('domain', 'research', '研究与学术', 'Research and academia'),

  scene('task', 'build-feature', '开发新功能', 'Build a feature'),
  scene('task', 'debug', '排障与修复', 'Debug and fix'),
  scene('task', 'refactor', '重构', 'Refactor'),
  scene('task', 'code-review', '代码审查', 'Code review'),
  scene('task', 'testing', '测试', 'Testing'),
  scene('task', 'performance', '性能优化', 'Performance'),
  scene('task', 'migration', '迁移与升级', 'Migration and upgrade'),
  scene('task', 'release', '构建、发布与部署', 'Build, release, and deploy'),
  scene('task', 'architecture', '架构与方案设计', 'Architecture and design'),
  scene('task', 'writing', '写作与改写', 'Writing and rewriting'),
  scene('task', 'research', '调研与资料整理', 'Research and synthesis'),
  scene('task', 'analysis', '数据分析', 'Data analysis'),
  scene('task', 'planning', '规划与拆解', 'Planning and breakdown'),
  scene('task', 'learning', '学习与答疑', 'Learning and Q&A'),

  scene('artifact', 'code', '代码改动', 'Code changes'),
  scene('artifact', 'web-page', '网页与落地页', 'Web pages and landing pages'),
  scene('artifact', 'app-ui', '应用界面', 'App UI'),
  scene('artifact', 'api', '接口与服务', 'APIs and services'),
  scene('artifact', 'script', '脚本与自动化', 'Scripts and automation'),
  scene('artifact', 'config', '配置', 'Configuration'),
  scene('artifact', 'tests', '测试用例', 'Tests'),
  scene('artifact', 'docs', '技术文档', 'Technical docs'),
  scene('artifact', 'report', '报告与复盘', 'Reports and retrospectives'),
  scene('artifact', 'slides', '演示文稿', 'Slides'),
  scene('artifact', 'resume', '简历与履历', 'Resumes and profiles'),
  scene('artifact', 'portfolio', '作品集', 'Portfolios'),
  scene('artifact', 'article', '文章与帖子', 'Articles and posts'),
  scene('artifact', 'design-mockup', '设计稿与原型', 'Mockups and prototypes'),
  scene('artifact', 'dataset', '数据与图表', 'Data and charts'),
  scene('artifact', 'pull-request', 'PR 与提交说明', 'Pull requests and commit messages'),
].map((entry) => Object.freeze(entry)));

const SCENES_BY_ID = new Map(SCENES.map((entry) => [entry.id, entry]));

export function findScene(id: string): Scene | null {
  return SCENES_BY_ID.get(id) ?? null;
}

// Birth scenes as saved in a Skill draft: known ids only, duplicates dropped
// (first occurrence kept), at most MAX_BIRTH_SCENES.
export function normalizeBirthScenes(value: unknown): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new Error('birthScenes must be an array of scene ids');
  const out: string[] = [];
  value.forEach((item, index) => {
    const id = typeof item === 'string' ? item.trim() : item;
    if (typeof id !== 'string' || !SCENES_BY_ID.has(id)) {
      throw new Error(`birthScenes[${index}] ${JSON.stringify(item)} is not in the fixed scene list; pick ids from \`obelisk skill scenes\``);
    }
    if (!out.includes(id)) out.push(id);
  });
  if (out.length > MAX_BIRTH_SCENES) {
    throw new Error(`birthScenes has ${out.length} scenes; at most ${MAX_BIRTH_SCENES} fit on chain`);
  }
  return out;
}
