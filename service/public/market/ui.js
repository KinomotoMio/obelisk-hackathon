// Small pieces every market view uses: numbers, dates, addresses, scene
// chips, empty and error states, and prompts to copy into an AI coding
// assistant (the App's "复制成 prompt", app/src/renderer/src/assistant-prompts.mjs).

import { h, link } from './dom.js';
import { explorer, str } from './api.js';

export const count = (value) => Number(value ?? 0).toLocaleString('zh-CN');
export const percent = (rate) => `${Math.round(rate * 100)}%`;
export const shortAddress = (address) => (typeof address === 'string' && address.length > 12 ? `${address.slice(0, 6)}…${address.slice(-4)}` : address ?? '');
export const shortHex = (hex) => (typeof hex === 'string' && hex.length > 18 ? `${hex.slice(0, 10)}…${hex.slice(-6)}` : hex ?? '');

export function day(iso) {
  const time = Date.parse(iso ?? '');
  if (Number.isNaN(time)) return '—';
  const date = new Date(time);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function ago(iso) {
  const time = Date.parse(iso ?? '');
  if (Number.isNaN(time)) return null;
  const minutes = Math.max(0, Math.round((Date.now() - time) / 60000));
  if (minutes < 60) return minutes <= 1 ? '刚刚' : `${minutes} 分钟前`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} 小时前`;
  return `${Math.round(hours / 24)} 天前`;
}

export function skillName(skill) {
  return str(skill?.name, 120) ?? str(skill?.content?.name, 120);
}

export function title(skill) {
  return skillName(skill) ?? `未命名 Skill #${skill.skillId}`;
}

const DIMENSIONS = { domain: '技术领域', task: '任务类型', artifact: '产出物', context: '行业与用途', role: '面向人群' };
export const dimensionLabel = (dimension) => DIMENSIONS[dimension] ?? '';

/** A scene chip; a tag outside the shared vocabulary is marked 新建, as in the App. */
export function sceneChip(scene, { declared = false } = {}) {
  const tag = str(scene?.tag, 200) ?? '';
  const created = scene?.kind === 'user' || tag.startsWith('user:');
  const label = str(scene?.label, 80) ?? (tag.replace(/^user:[a-z]+\//, '').replace(/^v\d+:/, '') || '未命名场景');
  return h('span', { class: 'chip', title: [dimensionLabel(scene?.dimension), tag].filter(Boolean).join(' · ') },
    created ? h('span', { class: 'new' }, '新建') : null,
    label,
    declared ? h('span', { class: 'chip-mark' }, '作者声明') : null);
}

export function addressLink(chainInfo, address, label = shortAddress(address)) {
  return link(explorer(chainInfo, 'address', address), { class: 'mono' }, label);
}

export function empty(titleText, ...lines) {
  return h('div', { class: 'empty' }, h('div', { class: 'empty-title' }, titleText), ...lines.map((line) => h('p', { class: 'muted' }, line)));
}

export function failure(error) {
  return h('section', { class: 'panel failure', role: 'alert' },
    h('div', { class: 'empty-title' }, error?.status === 404 ? '没有找到' : '暂时读不到数据'),
    h('p', { class: 'muted' }, error?.message ?? String(error)));
}

export function loading(text = '正在从链上读取…') {
  return h('div', { class: 'loading' }, h('span', { class: 'spinner', 'aria-hidden': 'true' }), h('span', { class: 'muted' }, text));
}

// --- Prompts --------------------------------------------------------------

const ASSISTANTS = [{ id: 'claude-code', label: 'Claude Code' }, { id: 'codex', label: 'Codex' }];
let assistant = 'claude-code';
try {
  if (localStorage.getItem('obelisk.market.assistant') === 'codex') assistant = 'codex';
} catch {
  // Storage may be blocked; Claude Code stays the default.
}

const render = (prompt) => (assistant === 'codex' ? `用 ${prompt.skill} ${prompt.text}` : `/${prompt.skill} ${prompt.text}`);

/**
 * A prompt the visitor copies into their AI coding assistant, with a switch
 * between Claude Code and Codex. Needs Obelisk installed on their computer.
 */
export function promptBox(label, prompt) {
  const code = h('code', null, render(prompt));
  const status = h('span', { class: 'copy-status', 'aria-live': 'polite' });
  const button = h('button', {
    type: 'button', class: 'btn',
    onclick: async () => {
      try {
        await navigator.clipboard.writeText(render(prompt));
        status.textContent = '已复制';
      } catch {
        const range = document.createRange();
        range.selectNodeContents(code);
        getSelection()?.removeAllRanges();
        getSelection()?.addRange(range);
        status.textContent = '已选中，按 ⌘C / Ctrl+C 复制';
      }
      setTimeout(() => { status.textContent = ''; }, 2400);
    },
  }, '复制');
  const switcher = h('span', { class: 'seg', role: 'group', 'aria-label': '粘贴到' }, ASSISTANTS.map(({ id, label: name }) => h('button', {
    type: 'button', 'aria-pressed': String(id === assistant),
    onclick: () => {
      assistant = id;
      try { localStorage.setItem('obelisk.market.assistant', id); } catch { /* ignored */ }
      for (const other of document.querySelectorAll('[data-prompt]')) other.dispatchEvent(new Event('assistant'));
    },
  }, name)));
  const box = h('div', { class: 'prompt', 'data-prompt': '' },
    h('div', { class: 'prompt-head' }, h('span', { class: 'prompt-label' }, label), switcher),
    h('div', { class: 'prompt-body' }, code, h('span', { class: 'prompt-actions' }, status, button)));
  box.addEventListener('assistant', () => {
    code.textContent = render(prompt);
    for (const option of switcher.children) option.setAttribute('aria-pressed', String(option.textContent === ASSISTANTS.find((entry) => entry.id === assistant).label));
  });
  return box;
}
