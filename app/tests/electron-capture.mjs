// Headless capture (`--capture`): the built App renders one page of a given
// OBELISK_HOME to a PNG and exits, failing with a non-zero code when the page
// does not render.
//
// Starts the built App the way a script would. Runs under Electron like the
// other suites, or under plain Node.

import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Under Electron, `electron` is the API, not the binary; the binary is this process.
const electronBin = process.versions.electron ? process.execPath : (await import('electron')).default;
const appRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const home = mkdtempSync(join(tmpdir(), 'obelisk-capture-home-'));
const out = mkdtempSync(join(tmpdir(), 'obelisk-capture-out-'));
let failures = 0;

function assert(condition, message) {
  if (condition) console.log(`PASS: ${message}`);
  else {
    failures++;
    console.error(`FAIL: ${message}`);
  }
}

function capture(...args) {
  const result = spawnSync(electronBin, ['--no-sandbox', '.', '--capture', ...args], {
    cwd: appRoot,
    env: { ...process.env, OBELISK_HOME: home, OBELISK_PLAYGROUND_HOME: join(home, 'playground'), OBELISK_SERVICE_URL: 'http://127.0.0.1:9' },
    encoding: 'utf8',
    timeout: 60_000,
  });
  return { code: result.status, stdout: result.stdout.trim(), stderr: result.stderr.trim() };
}

function pngSize(file) {
  const bytes = readFileSync(file);
  if (bytes.toString('latin1', 1, 4) !== 'PNG') return null;
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

try {
  // A Skill draft in this data directory, so the page has data to wait for.
  const skill = join(home, 'skills', 'release-checklist');
  mkdirSync(join(skill, 'draft'), { recursive: true });
  const body = '# 发布前检查\n\n逐项确认版本号、变更说明、回滚方案和监控告警。\n';
  writeFileSync(join(skill, 'draft', 'SKILL.md'), `---\nname: release-checklist\ndescription: "发布前逐项确认"\n---\n\n${body}`);
  writeFileSync(join(skill, 'skill.json'), JSON.stringify({
    schema: 1, name: 'release-checklist', description: '发布前逐项确认', createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-01T00:00:00.000Z',
    birthScenes: [], parent: null, provenance: [], versions: [],
  }));

  const list = capture('--route', '#/skills', '--out', join(out, 'skills.png'), '--width', '1280', '--height', '800', '--scale', '1');
  assert(list.code === 0 && list.stdout.endsWith('skills.png'), `a page is captured (${list.code} ${list.stderr})`);
  const size = existsSync(join(out, 'skills.png')) ? pngSize(join(out, 'skills.png')) : null;
  assert(size?.width === 1280 && size?.height === 800, `the PNG has the requested size (${JSON.stringify(size)})`);

  const waited = capture('--route', '#/skills', '--out', join(out, 'waited.png'), '--wait-for', '.skill-card-row[data-skill="release-checklist"]');
  assert(waited.code === 0, `--wait-for waits for the page's data (${waited.stderr})`);
  assert(pngSize(join(out, 'waited.png'))?.width === 2880, 'the default scale is 2');

  const unknown = capture('--route', '#/no-such-page', '--out', join(out, 'unknown.png'), '--timeout', '4000');
  assert(unknown.code === 1 && /did not stay on the route/.test(unknown.stderr), `an unknown route fails (${unknown.code} ${unknown.stderr})`);
  assert(!existsSync(join(out, 'unknown.png')), 'nothing is written on failure');

  const missing = capture('--route', '#/skills', '--out', join(out, 'missing.png'), '--wait-for', '.never', '--timeout', '3000');
  assert(missing.code === 1 && /--wait-for selector never appeared/.test(missing.stderr), `a selector that never appears fails (${missing.code})`);

  const usage = capture('--route', '#/skills', '--out', join(out, 'x.jpg'));
  assert(usage.code === 2 && /\.png/.test(usage.stderr), `bad arguments exit 2 (${usage.code} ${usage.stderr})`);
} catch (error) {
  failures++;
  console.error(error);
} finally {
  rmSync(home, { recursive: true, force: true });
  rmSync(out, { recursive: true, force: true });
}

console.log(failures ? `${failures} capture check(s) failed` : 'Capture checks passed');
process.exit(failures ? 1 : 0);
