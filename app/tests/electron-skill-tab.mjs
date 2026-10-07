// Skill tab (#18): reviewing a draft and the user's own Skills.
//
// Runs the built renderer against mocked IPC. Set OBELISK_SKILL_SCREENSHOTS to
// a directory to also save screenshots of the states it walks through.

import { app, BrowserWindow, ipcMain } from 'electron';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { createSessionPatch } from '../src/shared/session-patch.mjs';
import { assembleSessionDetail } from '../src/shared/session-detail-assembly.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const appRoot = join(here, '..');
const screenshotDir = process.env.OBELISK_SKILL_SCREENSHOTS || null;

let failures = 0;

function assert(condition, message) {
  if (condition) console.log(`PASS: ${message}`);
  else {
    failures++;
    console.error(`FAIL: ${message}`);
  }
}

async function waitFor(webContents, expression, message, timeoutMs = 8_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await webContents.executeJavaScript(`Boolean(${expression})`, true)) return;
    await delay(40);
  }
  throw new Error(`Timed out waiting for ${message}`);
}

const fingerprint = body => createHash('sha256').update(body.trim(), 'utf8').digest('hex');

// --- Fixtures -----------------------------------------------------------------

const sessions = {
  'f3a1c6d2-resume': { title: '根据提交历史整理项目经历', source: 'claude', started_at: '2026-09-12T09:20:00.000Z' },
  'rollout-retro-0919': { title: '把排障过程改写成技术复盘', source: 'codex', started_at: '2026-09-19T13:05:00.000Z' },
  '9b7e2f10-interview': { title: '为面试准备系统设计案例', source: 'claude', started_at: '2026-09-26T02:40:00.000Z' },
  'c41d8e77-rewrite': { title: '按岗位要求改写履历要点', source: 'claude', started_at: '2026-10-02T11:15:00.000Z' },
  'a9d0b3e1-incident': { title: '支付回调超时排障', source: 'claude', started_at: '2026-08-21T07:30:00.000Z' },
  '5e2c9a41-release': { title: '发布前检查清单', source: 'claude', started_at: '2026-07-30T08:00:00.000Z' },
};
const missingSessionId = '0d6f4b2a-not-indexed';

function sessionSummary(id) {
  const session = sessions[id];
  return {
    id,
    title: session.title,
    project: '-work-portfolio',
    project_path: '/work/portfolio',
    source: session.source,
    started_at: session.started_at,
    ended_at: session.started_at,
    message_count: 12,
  };
}

function sessionMessages(id) {
  return Array.from({ length: 12 }, (_, index) => ({
    uuid: index === 7 ? 'm-resume-7' : `${id}-message-${index}`,
    type: index % 2 === 0 ? 'user' : 'assistant',
    timestamp: new Date(Date.parse(sessions[id].started_at) + index * 60_000).toISOString(),
    text: `${sessions[id].title} · message ${index}`,
    content_type: 'text',
    is_meta: 0,
  }));
}

const draftBody = `# 求职材料：用证据写经历

整理简历、项目经历或面试案例时使用。

## 做法

1. 先列出要证明的能力，再回到 session 里找证据，不要从提交记录开始罗列。
2. 每段经历按「问题 → 判断 → 结果」来写，结果尽量量化。
3. 团队项目只写自己负责的部分，并写清楚和谁协作。

## 不要做

- 不要直接罗列提交记录或改动的文件。
- 不要夸大个人在团队项目中的职责。`;

const incidentBody = '# 事故复盘\n\n按现象、原因、修复、验证四段写，每段附上当时的日志片段。';
const releaseBody = '# 发布前检查\n\n逐项确认版本号、变更说明、回滚方案和监控告警。';

const jobDraft = {
  name: 'job-application-materials',
  description: '从真实工作记录里整理求职材料：按"解决了什么问题"而不是"做过什么项目"写经历，每一条都有可以核对的证据。',
  createdAt: '2026-10-06T08:00:00.000Z',
  updatedAt: '2026-10-07T03:12:00.000Z',
  birthScenes: ['v1:context/job-search', 'v1:role/engineer', 'v1:task/writing', 'v1:artifact/resume', 'user:artifact/开源贡献摘要'],
  parent: null,
  provenance: [
    {
      sessionId: 'f3a1c6d2-resume',
      reason: '按"解决了什么问题"而不是按提交归纳经历',
      excerpts: [{ messageUuid: 'm-resume-7', text: '不要按 commit 一条条列，按"它解决了什么问题"合并成三段经历。' }],
      pitfalls: ['直接罗列提交记录可读性差，改为按问题归纳'],
    },
    {
      sessionId: 'rollout-retro-0919',
      reason: '按现象、原因、修复、验证整理一次排障',
      excerpts: [{ text: '复盘里贴的日志保留原样，比如 <script>alert(1)</script> 这一行也只是文字。' }],
      pitfalls: ['只写结论、不附日志，面试时说不清楚当时怎么判断的'],
    },
    {
      sessionId: '9b7e2f10-interview',
      reason: '用真实案例说明设计取舍',
      corrections: ['案例要写清楚当时放弃了哪些方案，以及为什么'],
    },
    {
      sessionId: 'c41d8e77-rewrite',
      reason: '被纠正"不要夸大个人在团队项目中的职责"',
      excerpts: [{ text: '这里写"主导"不对，我只负责了支付回调那一块。' }],
      corrections: ['不要夸大个人在团队项目中的职责'],
    },
  ],
};

function mint(skillId, versionIndex, day, txByte) {
  return {
    chainId: 968,
    skillId: String(skillId),
    versionIndex,
    author: '0xA1c94E0b7D3f2b6E1a0C9d58F3e4b7A2c1d93be2',
    txHash: `0x${txByte.repeat(32)}`,
    mintedAt: `2026-10-0${day}T10:00:00.000Z`,
  };
}

function view(record, body, versions) {
  const draftFingerprint = fingerprint(body);
  return {
    schema: 1,
    ...record,
    dir: `/skills/${record.name}`,
    status: versions.length ? 'minted' : 'draft',
    draft: {
      fingerprint: draftFingerprint,
      path: `/skills/${record.name}/draft/SKILL.md`,
      body,
      skillMd: `---\nname: ${record.name}\ndescription: ${JSON.stringify(record.description)}\n---\n\n${body}\n`,
      minted: versions.some(version => version.fingerprint === draftFingerprint),
    },
    versions: versions.map(version => ({
      createdAt: version.mint.mintedAt,
      description: record.description,
      birthScenes: record.birthScenes,
      parent: record.parent,
      provenance: record.provenance,
      path: `/skills/${record.name}/versions/${version.fingerprint}/SKILL.md`,
      verified: true,
      ...version,
    })),
  };
}

const views = {
  [jobDraft.name]: view(jobDraft, draftBody, []),
  'incident-retro': view({
    name: 'incident-retro',
    description: '把一次排障整理成别人看得懂、能复查的复盘。',
    createdAt: '2026-09-01T08:00:00.000Z',
    updatedAt: '2026-10-06T15:40:00.000Z',
    birthScenes: ['v1:task/debug', 'v1:artifact/report'],
    parent: null,
    provenance: [
      { sessionId: 'a9d0b3e1-incident', reason: '复盘按现象、原因、修复、验证组织' },
      { sessionId: missingSessionId, reason: '被纠正"复盘不写个人责任"' },
    ],
  }, `${incidentBody}\n\n不写个人责任，只写系统和流程。`, [
    { fingerprint: fingerprint(incidentBody), mint: mint(7, 0, 3, 'b7') },
  ]),
  'release-checklist': view({
    name: 'release-checklist',
    description: '发布前逐项确认，避免漏掉回滚方案和监控。',
    createdAt: '2026-08-01T08:00:00.000Z',
    updatedAt: '2026-10-05T09:00:00.000Z',
    birthScenes: ['v1:task/release', 'v1:artifact/script', 'v1:domain/devops'],
    parent: null,
    provenance: [{ sessionId: '5e2c9a41-release', reason: '发布前检查清单的完整一次演练' }],
  }, releaseBody, [
    { fingerprint: fingerprint('# 发布前检查\n\n逐项确认版本号和变更说明。'), mint: mint(3, 0, 2, 'c3') },
    { fingerprint: fingerprint(releaseBody), mint: mint(3, 1, 5, 'd4') },
  ]),
};

function summary(skill) {
  const latest = skill.versions.at(-1) ?? null;
  return {
    name: skill.name,
    description: skill.description,
    status: skill.status,
    draftFingerprint: skill.draft?.fingerprint ?? null,
    draftMinted: skill.draft?.minted ?? false,
    versionCount: skill.versions.length,
    latestVersion: latest ? { fingerprint: latest.fingerprint, mint: latest.mint } : null,
    birthScenes: skill.birthScenes,
    parent: skill.parent,
    provenanceSessions: new Set(skill.provenance.map(entry => entry.sessionId)).size,
    updatedAt: skill.updatedAt,
  };
}

// Labels from the v1 scene vocabulary (packages/core/src/scenes.ts).
const sceneLabels = {
  'v1:context/job-search': ['context', '行业与用途', '求职与实习'],
  'v1:role/engineer': ['role', '面向人群', '工程师'],
  'v1:task/writing': ['task', '任务类型', '文档写作与沟通'],
  'v1:artifact/resume': ['artifact', '产出物', '简历与履历'],
  'v1:task/debug': ['task', '任务类型', '调试与排障'],
  'v1:artifact/report': ['artifact', '产出物', '报告与复盘'],
  'v1:task/release': ['task', '任务类型', '构建与发布'],
  'v1:artifact/script': ['artifact', '产出物', '脚本与检查清单'],
  'v1:domain/devops': ['domain', '技术领域', '运维与基础设施'],
};

function describeScene(tag) {
  if (tag.startsWith('user:')) {
    const [dimension, label] = tag.slice(5).split('/');
    return { tag, kind: 'user', dimension, dimensionLabel: '产出物', label };
  }
  const known = sceneLabels[tag];
  return known
    ? { tag, kind: 'vocabulary', dimension: known[0], dimensionLabel: known[1], label: known[2] }
    : { tag, kind: 'unknown', dimension: null, dimensionLabel: null, label: tag };
}

let library = [];

function registerHandlers() {
  ipcMain.handle('skills:list', () => library.map(name => summary(views[name])));
  ipcMain.handle('skills:get', (_event, name) => (library.includes(name) ? views[name] : null));
  ipcMain.handle('skills:describe-scenes', (_event, tags) => tags.map(describeScene));
  ipcMain.handle('db:getSessions', () => Object.keys(sessions).map(sessionSummary));
  ipcMain.handle('db:getSessionsByIds', (_event, ids) => ids.filter(id => sessions[id]).map(sessionSummary));
  ipcMain.handle('db:getSessionMessages', (_event, id) => (sessions[id] ? sessionMessages(id) : []));
  ipcMain.handle('db:getSessionToolCalls', () => []);
  ipcMain.handle('db:getSessionToolResults', () => []);
  ipcMain.handle('db:getSessionPatch', (_event, id, cursor) => {
    const patch = createSessionPatch({
      messages: assembleSessionDetail({
        messages: sessions[id] ? sessionMessages(id) : [],
        toolCalls: [],
        toolResults: [],
        subagents: [],
        workflows: [],
      }).messages,
      workflows: [],
    }, cursor);
    return { ...patch, session: sessions[id] ? sessionSummary(id) : null };
  });
  ipcMain.handle('db:getSessionSubagents', () => []);
  ipcMain.handle('db:getSessionWorkflows', () => []);
  ipcMain.handle('db:getSessionSummaries', () => []);
  ipcMain.handle('db:getMessageFullText', () => null);
  ipcMain.handle('db:getMemories', () => []);
  ipcMain.handle('db:getProjects', () => [{ project: '-work-portfolio', count: 6 }]);
  ipcMain.handle('db:getStats', () => ({}));
  ipcMain.handle('settings:get', () => ({
    sources: [
      { id: 'claude', name: 'Claude Code', color: '#d97757', status: 'ok', statusText: 'ok', sessionCount: 5 },
      { id: 'codex', name: 'Codex', color: '#10a37f', status: 'ok', statusText: 'ok', sessionCount: 1 },
    ],
  }));
}

async function screenshot(win, name) {
  if (!screenshotDir) return;
  // Let copied buttons return to their labels.
  await delay(1800);
  const image = await win.webContents.capturePage();
  mkdirSync(screenshotDir, { recursive: true });
  const path = join(screenshotDir, name);
  writeFileSync(path, image.toPNG());
  console.log(`screenshot: ${path}`);
}

const js = (win, source) => win.webContents.executeJavaScript(source, true);

// A hidden window never has focus, and the Clipboard API refuses to write
// without it; record what the page writes instead.
async function captureClipboard(win) {
  await js(win, `Object.defineProperty(navigator.clipboard, 'writeText', {
    configurable: true,
    value: async (text) => { window.__copiedPrompt = text; },
  })`);
}

async function clickCopy(win, scope, label) {
  await js(win, `window.__copiedPrompt = null; document.querySelector('.prompt-toast-close')?.click()`);
  await js(win, `document.querySelector(${JSON.stringify(scope)}).querySelector('[data-prompt-label=${JSON.stringify(label)}]').click()`);
  await waitFor(win.webContents, `window.__copiedPrompt !== null`, `copying ${label}`);
  return js(win, `window.__copiedPrompt`);
}

async function openSkill(win, name) {
  await js(win, `window.location.hash = ${JSON.stringify(`#/skills/${name}`)}`);
  await waitFor(win.webContents, `document.querySelector('.skill-detail .detail-path')?.textContent === ${JSON.stringify(name)}`, `${name} detail`);
}

async function run() {
  registerHandlers();
  const win = new BrowserWindow({
    show: false,
    x: 0,
    y: 0,
    width: 1440,
    height: 960,
    webPreferences: {
      preload: join(appRoot, 'out', 'preload', 'index.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // Empty library: the tab explains where Skills come from and offers the prompt.
  await win.loadFile(join(appRoot, 'out', 'renderer', 'index.html'), { hash: '/skills' });
  await waitFor(win.webContents, `document.querySelector('.skill-empty')`, 'empty Skill tab');
  await captureClipboard(win);
  assert(
    await js(win, `document.querySelector('.sidebar-item.active')?.textContent.includes('Skill')`),
    'the sidebar marks the Skill tab',
  );
  await screenshot(win, 'skill-tab-empty.png');
  const distill = await clickCopy(win, '.skill-empty', '复制沉淀 Skill 的 prompt');
  assert(distill.startsWith('/obelisk-distill '), `the empty state copies a distill prompt (${distill})`);
  await js(win, `document.querySelector('.prompt-toast-close')?.click()`);

  // A library change shows up without a reload.
  library = Object.keys(views);
  win.webContents.send('obelisk:skills-updated', '/skills/job-application-materials/skill.json');
  await waitFor(win.webContents, `document.querySelectorAll('.skill-card-row').length === 3`, 'Skill list after an update');
  const sections = await js(win, `[...document.querySelectorAll('.skill-section')].map(section => ({
    key: section.dataset.section,
    names: [...section.querySelectorAll('.skill-card-row')].map(row => row.dataset.skill),
  }))`);
  assert(
    JSON.stringify(sections) === JSON.stringify([
      { key: 'pending', names: ['job-application-materials', 'incident-retro'] },
      { key: 'minted', names: ['release-checklist'] },
    ]),
    `drafts waiting for review are listed apart from minted Skills (${JSON.stringify(sections)})`,
  );
  const listText = await js(win, `document.querySelector('.skill-list').innerText`);
  assert(listText.includes('求职与实习') && !listText.includes('v1:'), 'birth scenes are listed by their vocabulary labels');
  assert(listText.includes('已铸造 v2'), 'a minted Skill shows its latest version');
  assert(await js(win, `document.querySelector('.sidebar-item.active .badge')?.textContent.trim() === '3'`), 'the sidebar counts the Skills');
  await screenshot(win, 'skill-tab-list.png');

  // Draft review.
  await js(win, `document.querySelector('[data-skill="job-application-materials"]').click()`);
  await waitFor(win.webContents, `document.querySelectorAll('.evidence').length === 4`, 'draft evidence');
  const detailText = await js(win, `document.querySelector('.skill-detail').innerText`);
  for (const label of ['求职与实习', '工程师', '文档写作与沟通', '简历与履历', '开源贡献摘要']) {
    assert(detailText.includes(label), `birth scene "${label}" has a readable label`);
  }
  assert(!detailText.includes('v1:') && !detailText.includes('user:'), 'raw scene tags are not shown');
  assert(
    await js(win, `document.querySelector('.scene-tag.user')?.textContent.includes('新建')`),
    'a user-created scene tag is marked as new',
  );
  assert(detailText.includes('根据提交历史整理项目经历') && detailText.includes('Codex'), 'evidence shows session titles and sources');
  assert(detailText.includes('命中') && detailText.includes('用真实案例说明设计取舍'), 'evidence shows why each session was picked');
  assert(detailText.includes('踩过的坑') && detailText.includes('被纠正过') && detailText.includes('不要夸大个人在团队项目中的职责'), 'the provenance card lists pitfalls and corrections');
  assert(detailText.includes('来自 4 个 session，时间跨度 3 周'), 'the provenance card states how many sessions over what span');
  const excerpt = await js(win, `(() => {
    const node = [...document.querySelectorAll('.excerpt')].find(el => el.textContent.includes('alert(1)'));
    return { text: node?.textContent, scripts: node?.querySelectorAll('script').length };
  })()`);
  assert(excerpt.text?.includes('<script>alert(1)</script>') && excerpt.scripts === 0, 'transcript excerpts are shown as text, not markup');
  assert(await js(win, `document.querySelector('.skill-body h1')?.textContent === '求职材料：用证据写经历'`), 'the draft body is rendered as Markdown');

  const mintText = await clickCopy(win, '.skill-actions', '确认并铸造');
  const draftFingerprint = views['job-application-materials'].draft.fingerprint;
  assert(
    mintText.startsWith('/obelisk-skill-assets 铸造 Skill 草稿「job-application-materials」，先给我看铸造预览')
      && mintText.includes(`\`obelisk skill mint job-application-materials --confirm ${draftFingerprint}\``),
    'the mint prompt previews first, then confirms the reviewed fingerprint',
  );
  // The toast that just appeared (a dismissed one may still be fading out).
  await waitFor(
    win.webContents,
    `[...document.querySelectorAll('.prompt-toast:not(.failed) .prompt-toast-text')].some(el => el.textContent === window.__copiedPrompt)`,
    'toast with the copied prompt',
  );
  assert(true, 'the toast shows exactly the copied prompt');
  const dropText = await clickCopy(win, '[data-evidence="2"]', '去掉');
  assert(
    dropText === '/obelisk-distill 从草稿「job-application-materials」的证据中去掉 session「把排障过程改写成技术复盘」（rollout-retro-0919），重新起草',
    `"去掉" names the draft and the session (${dropText})`,
  );
  const editText = await clickCopy(win, '.skill-actions', '继续修改');
  assert(editText === '/obelisk-distill 继续修改草稿「job-application-materials」：', `"继续修改" names the draft (${editText})`);
  await js(win, `document.querySelector('.prompt-toast-close')?.click()`);
  await screenshot(win, 'skill-tab-draft.png');
  await js(win, `document.querySelector('.skill-wrap').scrollTop = 10000`);
  await screenshot(win, 'skill-tab-draft-bottom.png');

  // A provenance item points back at its evidence entry.
  await js(win, `document.querySelector('[data-group="corrections"] .evidence-ref').click()`);
  await waitFor(win.webContents, `document.querySelector('[data-evidence="3"].flash')`, 'evidence highlighted from the provenance card');
  assert(true, 'a correction points back to the session it came from');

  // Clicking a provenance excerpt opens the session at that message.
  await js(win, `document.querySelector('[data-evidence="1"] .excerpt').click()`);
  await waitFor(win.webContents, `window.location.hash.startsWith('#/sessions/f3a1c6d2-resume')`, 'session opened from an excerpt');
  assert(await js(win, `window.location.hash === '#/sessions/f3a1c6d2-resume?focus=m-resume-7'`), 'an excerpt opens its session at the quoted message');
  await waitFor(win.webContents, `document.querySelector('[data-uuid="m-resume-7"]')`, 'quoted message in the session view');

  // A minted Skill with a newer draft: versions, chain link, missing session.
  await openSkill(win, 'incident-retro');
  await waitFor(win.webContents, `document.querySelector('.version')`, 'minted versions');
  const revision = await js(win, `({
    actions: [...document.querySelectorAll('.skill-actions [data-prompt-label]')].map(el => el.dataset.promptLabel),
    link: document.querySelector('.chain-link')?.href,
    missing: document.querySelector('.evidence.missing')?.innerText,
    stage: document.querySelector('.skill-detail').dataset.stage,
  })`);
  assert(revision.stage === 'revision', 'a minted Skill with an unminted draft is in revision');
  assert(JSON.stringify(revision.actions) === JSON.stringify(['继续修改', '确认并铸造新版本']), `a revision can be minted as a new version (${revision.actions})`);
  assert(revision.link === `https://scan.bohr.life/tx/0x${'b7'.repeat(32)}`, `a minted version links to its transaction (${revision.link})`);
  assert(revision.missing?.includes('本机索引中没有这个 session'), 'a provenance session missing from the index is marked, not linked');
  assert(await js(win, `document.querySelector('.evidence.missing .evidence-title').disabled`), 'a missing session cannot be opened');
  const newVersion = await clickCopy(win, '.skill-actions', '确认并铸造新版本');
  assert(newVersion.startsWith('/obelisk-skill-assets 铸造 Skill「incident-retro」的新版本'), `the new-version prompt says so (${newVersion})`);
  await js(win, `document.querySelector('.prompt-toast-close')?.click()`);

  // A fully minted Skill: no mint button, no evidence removal.
  await openSkill(win, 'release-checklist');
  await waitFor(win.webContents, `document.querySelectorAll('.version').length === 2`, 'two minted versions');
  const minted = await js(win, `({
    actions: [...document.querySelectorAll('.skill-actions [data-prompt-label]')].map(el => el.dataset.promptLabel),
    drops: document.querySelectorAll('.evidence [data-prompt-label]').length,
    versions: [...document.querySelectorAll('.version')].map(el => el.dataset.version),
    bodyLabel: document.querySelector('.body-panel .skill-panel-title').textContent.trim(),
  })`);
  assert(JSON.stringify(minted.actions) === JSON.stringify(['继续修改']), `a minted Skill offers only further editing (${minted.actions})`);
  assert(minted.drops === 0, 'evidence of a minted Skill cannot be dropped from the App');
  assert(JSON.stringify(minted.versions) === JSON.stringify(['v2', 'v1']), `versions are listed newest first (${minted.versions})`);
  assert(minted.bodyLabel === '正文 · v2', `the body is labelled with the version it is (${minted.bodyLabel})`);
  await screenshot(win, 'skill-tab-minted.png');

  // A Skill removed from the library.
  library = library.filter(name => name !== 'release-checklist');
  win.webContents.send('obelisk:skills-updated', '/skills/release-checklist/skill.json');
  await waitFor(win.webContents, `document.querySelector('.skill-wrap .empty')?.textContent.includes('release-checklist')`, 'removed Skill');
  assert(true, 'a Skill removed from the library is reported as gone');

  win.destroy();
}

app.whenReady()
  .then(run)
  .catch((error) => {
    failures++;
    console.error(error);
  })
  .finally(() => {
    console.log(failures ? `${failures} Skill tab check(s) failed` : 'Skill tab checks passed');
    app.exit(failures ? 1 : 0);
  });
