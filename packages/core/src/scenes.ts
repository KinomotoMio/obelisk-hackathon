// Copyright (C) 2026 tommy0103 and contributors.
// SPDX-License-Identifier: AGPL-3.0-only

// Scene tags. Birth scenes (where a Skill was distilled from, #15) and observed
// scenes (where an invocation happened, #25) use the same tags so tags from
// different users can be aggregated and compared (docs/vision/04, "场景标签").
//
// The vocabulary is curated and versioned, like a tag catalogue. Each version is
// a complete list; a later version may add, remove, or merge tags, and
// SCENE_TAG_SYNONYMS records how a tag of version N reads in version N+1 (like
// tag synonyms on Q&A sites). Nothing already written is rewritten: old tags are
// translated when they are read for comparison or aggregation.
//
// A written tag is one of (each at most 64 UTF-8 bytes, the SkillRegistry limit
// for a birth scene, and at most 16 per Skill):
//
//   v<version>:<dimension>/<slug>   a vocabulary tag, e.g. "v1:artifact/resume"
//   user:<dimension>/<label>        a tag created by an agent or a user because
//                                   nothing in the vocabulary fitted, e.g.
//                                   "user:artifact/插画作品集"; recorded locally
//                                   (skills.ts) as a candidate for the next
//                                   vocabulary version
//
// Ids without a prefix ("artifact/resume") are accepted as input for the current
// version and read as v1 when found in older records.
//
// Usage reports (UsageStats, #25) bucket by opaque bytes32 keys. The key of a
// tag is sceneBucketKey(tag): keccak256 of the UTF-8 bytes of the tag after it
// is translated to the current vocabulary version (user tags and retired tags
// as written). Reports from users on different vocabulary versions therefore
// land in the same bucket, and anyone can recompute a key from its tag, on or
// off chain (keccak256(bytes(tag)) in Solidity).

import { keccak256, stringToBytes, type Hex } from 'viem';

export type SceneDimension = 'domain' | 'task' | 'artifact' | 'context' | 'role';

export interface Scene {
  id: string;
  dimension: SceneDimension;
  label: string;
  labelEn: string;
}

export interface SceneVocabulary {
  version: number;
  dimensions: ReadonlyArray<{ id: SceneDimension; label: string; labelEn: string }>;
  scenes: readonly Scene[];
}

// Mirrors SkillRegistry.MAX_BIRTH_SCENES and MAX_SCENE_LENGTH.
export const MAX_BIRTH_SCENES = 16;
export const MAX_SCENE_TAG_BYTES = 64;
export const USER_TAG_PREFIX = 'user:';

const scene = (dimension: SceneDimension, slug: string, label: string, labelEn: string): Scene => (
  { id: `${dimension}/${slug}`, dimension, label, labelEn }
);

// v1 is a starter set sized for the first demo: every scene the demo shows maps
// to one tag or a pair (工程师求职 = context/job-search + role/engineer, 设计作品集
// = role/designer + artifact/portfolio, 电商后台 = context/ecommerce +
// artifact/admin-dashboard, 创意 PPT = context/creative-visual + artifact/slides).
// The domain and task labels double as the AI capability resume's dimensions.
const V1: SceneVocabulary = {
  version: 1,
  dimensions: [
    { id: 'domain', label: '技术领域', labelEn: 'Domain' },
    { id: 'task', label: '任务类型', labelEn: 'Task' },
    { id: 'artifact', label: '产出物', labelEn: 'Artifact' },
    { id: 'context', label: '行业与用途', labelEn: 'Industry and purpose' },
    { id: 'role', label: '面向人群', labelEn: 'Audience' },
  ],
  scenes: [
    scene('domain', 'frontend', '前端与交互', 'Frontend and interaction'),
    scene('domain', 'backend', '后端与数据', 'Backend and data'),
    scene('domain', 'mobile', '移动端', 'Mobile'),
    scene('domain', 'automation', '自动化与脚本', 'Automation and scripting'),
    scene('domain', 'devops', '运维与基础设施', 'DevOps and infrastructure'),
    scene('domain', 'ai-ml', 'AI 与机器学习', 'AI and machine learning'),
    scene('domain', 'security', '安全', 'Security'),
    scene('domain', 'blockchain', '区块链与智能合约', 'Blockchain and smart contracts'),
    scene('domain', 'design', '视觉设计', 'Visual design'),

    scene('task', 'build-feature', '开发新功能', 'Build a feature'),
    scene('task', 'debug', '调试与排障', 'Debugging and troubleshooting'),
    scene('task', 'refactor', '重构与迁移', 'Refactoring and migration'),
    scene('task', 'code-review', '代码审查', 'Code review'),
    scene('task', 'testing', '测试', 'Testing'),
    scene('task', 'performance', '性能优化', 'Performance'),
    scene('task', 'release', '构建与发布', 'Build and release'),
    scene('task', 'architecture', '系统设计', 'System design'),
    scene('task', 'writing', '文档写作与沟通', 'Writing and communication'),
    scene('task', 'research', '调研与分析', 'Research and analysis'),
    scene('task', 'planning', '规划与拆解', 'Planning and breakdown'),

    scene('artifact', 'code', '代码改动', 'Code changes'),
    scene('artifact', 'web-page', '网页与落地页', 'Web pages and landing pages'),
    scene('artifact', 'admin-dashboard', '管理后台', 'Admin dashboards'),
    scene('artifact', 'app-ui', '应用界面', 'App UI'),
    scene('artifact', 'api', '接口与服务', 'APIs and services'),
    scene('artifact', 'script', '脚本与检查清单', 'Scripts and checklists'),
    scene('artifact', 'tests', '测试用例', 'Tests'),
    scene('artifact', 'docs', '技术文档', 'Technical docs'),
    scene('artifact', 'report', '报告与复盘', 'Reports and retrospectives'),
    scene('artifact', 'slides', '演示文稿', 'Slides'),
    scene('artifact', 'resume', '简历与履历', 'Resumes and profiles'),
    scene('artifact', 'portfolio', '作品集', 'Portfolios'),
    scene('artifact', 'article', '文章与帖子', 'Articles and posts'),
    scene('artifact', 'design-mockup', '设计稿与原型', 'Mockups and prototypes'),

    scene('context', 'job-search', '求职与实习', 'Job search and internships'),
    scene('context', 'performance-review', '年终述职与晋升', 'Performance reviews and promotion'),
    scene('context', 'ecommerce', '电商', 'E-commerce'),
    scene('context', 'corporate-site', '商业官网与品牌', 'Corporate sites and branding'),
    scene('context', 'creative-visual', '创意视觉', 'Creative visuals'),
    scene('context', 'payments', '支付与交易', 'Payments and transactions'),

    scene('role', 'engineer', '工程师', 'Engineers'),
    scene('role', 'designer', '设计师', 'Designers'),
    scene('role', 'illustrator', '插画师', 'Illustrators'),
    scene('role', 'product-manager', '产品经理', 'Product managers'),
    scene('role', 'student', '学生', 'Students'),
  ],
};

// Every vocabulary version, oldest first. The last one is current.
export const SCENE_VOCABULARIES: readonly SceneVocabulary[] = [V1];

// version N -> { tag id in N -> tag id in N+1 } for merged or renamed tags. An id
// that is missing from N+1 and from this table is retired.
export const SCENE_TAG_SYNONYMS: Readonly<Record<number, Readonly<Record<string, string>>>> = {};

export const CURRENT_SCENE_VOCABULARY = SCENE_VOCABULARIES[SCENE_VOCABULARIES.length - 1]!;
// The current vocabulary's scenes and dimensions.
export const SCENES = CURRENT_SCENE_VOCABULARY.scenes;
export const SCENE_DIMENSIONS = CURRENT_SCENE_VOCABULARY.dimensions;

export interface SceneCatalogue {
  vocabularies: readonly SceneVocabulary[];
  synonyms: Readonly<Record<number, Readonly<Record<string, string>>>>;
}

const DEFAULT_CATALOGUE: SceneCatalogue = { vocabularies: SCENE_VOCABULARIES, synonyms: SCENE_TAG_SYNONYMS };

function vocabulary(catalogue: SceneCatalogue, version: number): SceneVocabulary | null {
  return catalogue.vocabularies.find((entry) => entry.version === version) ?? null;
}

function latest(catalogue: SceneCatalogue): SceneVocabulary {
  return catalogue.vocabularies[catalogue.vocabularies.length - 1]!;
}

export function findScene(id: string, version = CURRENT_SCENE_VOCABULARY.version, catalogue = DEFAULT_CATALOGUE): Scene | null {
  return vocabulary(catalogue, version)?.scenes.find((entry) => entry.id === id) ?? null;
}

export function vocabularyTag(id: string, version = CURRENT_SCENE_VOCABULARY.version): string {
  return `v${version}:${id}`;
}

export type ParsedSceneTag =
  | { kind: 'vocabulary'; tag: string; version: number; scene: Scene }
  | { kind: 'user'; tag: string; dimension: SceneDimension; label: string };

const VOCABULARY_TAG_RE = /^v([1-9]\d*):(.+)$/;
const USER_LABEL_FORBIDDEN = /[:/\\\p{Cc}]/u;

function utf8Length(text: string): number {
  return Buffer.byteLength(text, 'utf8');
}

function sceneTagError(input: unknown, version: number): Error {
  return new Error(
    `${JSON.stringify(input)} is not a tag in scene vocabulary v${version}; use a tag from \`obelisk skill scenes\`, `
    + 'or create one as user:<dimension>/<label>',
  );
}

// Any accepted input form -> the canonical written tag. Throws with the reason
// when the input is not a tag.
export function parseSceneTag(input: unknown, catalogue = DEFAULT_CATALOGUE): ParsedSceneTag {
  const current = latest(catalogue);
  if (typeof input !== 'string') throw sceneTagError(input, current.version);
  const text = input.normalize('NFC').trim();
  if (text.startsWith(USER_TAG_PREFIX)) {
    const rest = text.slice(USER_TAG_PREFIX.length);
    const slash = rest.indexOf('/');
    const dimension = rest.slice(0, slash).trim().toLowerCase() as SceneDimension;
    const label = rest.slice(slash + 1).trim().replace(/\s+/gu, '-').toLowerCase();
    if (slash < 0 || !current.dimensions.some((entry) => entry.id === dimension)) {
      throw new Error(`${JSON.stringify(input)}: a new tag is user:<dimension>/<label> with dimension one of ${current.dimensions.map((entry) => entry.id).join(', ')}`);
    }
    if (label === '' || USER_LABEL_FORBIDDEN.test(label)) {
      throw new Error(`${JSON.stringify(input)}: the label of a new tag must be non-empty and contain no ":", "/", "\\", or control characters`);
    }
    const tag = `${USER_TAG_PREFIX}${dimension}/${label}`;
    if (utf8Length(tag) > MAX_SCENE_TAG_BYTES) {
      throw new Error(`${JSON.stringify(input)} is ${utf8Length(tag)} bytes as a tag; at most ${MAX_SCENE_TAG_BYTES} fit on chain, so shorten the label`);
    }
    return { kind: 'user', tag, dimension, label };
  }
  const versioned = VOCABULARY_TAG_RE.exec(text);
  const version = versioned ? Number(versioned[1]) : current.version;
  const id = versioned ? versioned[2]! : text;
  if (!vocabulary(catalogue, version)) {
    throw new Error(`${JSON.stringify(input)}: scene vocabulary v${version} does not exist (current is v${current.version})`);
  }
  const found = findScene(id, version, catalogue);
  if (!found) throw sceneTagError(input, version);
  return { kind: 'vocabulary', tag: vocabularyTag(id, version), version, scene: found };
}

// A written tag with its display label, for listings. Tags that no longer
// parse (free text from before versioning) come back as kind 'unknown'.
export function describeSceneTag(tag: string, catalogue = DEFAULT_CATALOGUE): { tag: string; kind: 'vocabulary' | 'user' | 'unknown'; dimension: string | null; label: string } {
  try {
    const parsed = parseSceneTag(tag.startsWith(USER_TAG_PREFIX) || VOCABULARY_TAG_RE.test(tag) ? tag : `v1:${tag}`, catalogue);
    return parsed.kind === 'user'
      ? { tag, kind: 'user', dimension: parsed.dimension, label: parsed.label }
      : { tag, kind: 'vocabulary', dimension: parsed.scene.dimension, label: parsed.scene.label };
  } catch {
    return { tag, kind: 'unknown', dimension: null, label: tag };
  }
}

export function normalizeSceneTag(input: unknown, catalogue = DEFAULT_CATALOGUE): string {
  return parseSceneTag(input, catalogue).tag;
}

// A written tag read in the target vocabulary version (current by default):
// vocabulary tags follow SCENE_TAG_SYNONYMS one version at a time; a tag
// retired on the way returns null. User tags are returned unchanged. Bare ids
// from records written before versioning are read as v1.
export function migrateSceneTag(tag: string, { to, catalogue = DEFAULT_CATALOGUE }: { to?: number; catalogue?: SceneCatalogue } = {}): string | null {
  if (tag.startsWith(USER_TAG_PREFIX)) return tag;
  const target = to ?? latest(catalogue).version;
  const versioned = VOCABULARY_TAG_RE.exec(tag);
  let version = versioned ? Number(versioned[1]) : 1;
  let id = versioned ? versioned[2]! : tag;
  if (!findScene(id, version, catalogue)) return null;
  while (version < target) {
    const next = vocabulary(catalogue, version + 1);
    if (!next) return null;
    const mapped: string | undefined = catalogue.synonyms[version]?.[id];
    if (mapped !== undefined) id = mapped;
    else if (!next.scenes.some((entry) => entry.id === id)) return null;
    version += 1;
  }
  return vocabularyTag(id, version);
}

// The UsageStats bucket key for a scene tag (see the header).
export function sceneBucketKey(tag: string, catalogue = DEFAULT_CATALOGUE): Hex {
  return keccak256(stringToBytes(migrateSceneTag(tag, { catalogue }) ?? tag));
}

// Birth scenes as saved in a Skill draft: canonical tags, duplicates dropped
// (first occurrence kept), at most MAX_BIRTH_SCENES.
export function normalizeBirthScenes(value: unknown, catalogue = DEFAULT_CATALOGUE): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new Error('birthScenes must be an array of scene tags');
  const out: string[] = [];
  value.forEach((item, index) => {
    let tag: string;
    try {
      tag = normalizeSceneTag(item, catalogue);
    } catch (error) {
      throw new Error(`birthScenes[${index}] ${(error as Error).message}`, { cause: error });
    }
    if (!out.includes(tag)) out.push(tag);
  });
  if (out.length > MAX_BIRTH_SCENES) {
    throw new Error(`birthScenes has ${out.length} scenes; at most ${MAX_BIRTH_SCENES} fit on chain`);
  }
  return out;
}
