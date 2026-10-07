// Shared, local-only UI localization. Never translates or sends user content.
import { EN } from './translations.js';

const KEY = 'obelisk.site.language';
const escapeRE = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const patterns = Object.entries(EN).filter(([key]) => /\{\d+\}/.test(key))
  .sort((a, b) => b[0].replace(/\{\d+\}/g, '').length - a[0].replace(/\{\d+\}/g, '').length)
  .map(([key, value]) => {
    const ids = [...key.matchAll(/\{(\d+)\}/g)].map(match => match[1]);
    return { re: new RegExp('^' + key.trim().split(/\{\d+\}/).map(escapeRE).join('([\\s\\S]*?)') + '$'), value: value.trim(), ids };
  });

export function translate(text, language = 'en', depth = 0) {
  if (language !== 'en' || typeof text !== 'string' || depth > 3) return text;
  if (Object.hasOwn(EN, text)) return EN[text];
  const core = text.trim();
  if (Object.hasOwn(EN, core)) return text.replace(core, () => EN[core]);
  if (!/[\u3400-\u9fff]/.test(core)) return text;
  for (const { re, value, ids } of patterns) {
    const match = core.match(re);
    if (!match) continue;
    return text.replace(core, () => value.replace(/\{(\d+)\}/g, (_, id) => translate(match[ids.indexOf(id) + 1] ?? '', language, depth + 1)));
  }
  return text;
}

export function initialLanguage(search, stored, browserLanguage) {
  const requested = new URLSearchParams(search).get('lang');
  if (requested === 'en' || requested === 'zh') return requested;
  if (stored === 'en' || stored === 'zh') return stored;
  return browserLanguage?.toLowerCase().startsWith('zh') ? 'zh' : 'en';
}

export const CONTENT_SELECTOR = '[translate="no"], [data-original-content], pre, code, textarea, script, style, .skill-card-name, .skill-card-desc, .rn-prompt, .pv-msg, #rn-title';

export function startLanguageSwitch() {
  let stored;
  try { stored = localStorage.getItem(KEY); } catch { /* storage is optional */ }
  let language = initialLanguage(location.search, stored, navigator.language);
  const texts = new WeakMap();
  const attributes = new WeakMap();
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'site-language';
  button.setAttribute('translate', 'no');
  button.setAttribute('aria-label', 'Switch language / 切换语言');
  (document.querySelector('.site-top, .topbar') ?? document.body).append(button);

  function updateValue(node, key, value, records, write) {
    const previous = records.get(node) ?? {};
    const record = previous[key];
    const source = record && value === record.rendered ? record.source : value;
    const rendered = translate(source, language);
    previous[key] = { source, rendered };
    records.set(node, previous);
    if (value !== rendered) write(rendered);
  }

  function apply() {
    observer.disconnect();
    document.documentElement.lang = language === 'zh' ? 'zh-CN' : 'en';
    button.textContent = language === 'zh' ? 'English' : '中文';
    button.title = language === 'zh' ? 'Switch to English' : '切换到中文';
    document.querySelectorAll('[data-language]').forEach(node => { node.hidden = node.dataset.language !== language; });
    const walker = document.createTreeWalker(document.documentElement, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node = walker.currentNode;
      if (node.parentElement?.closest(CONTENT_SELECTOR)) continue;
      updateValue(node, 'text', node.nodeValue, texts, next => { node.nodeValue = next; });
    }
    for (const node of document.querySelectorAll('[aria-label], [title], [placeholder]')) {
      if (node.closest(CONTENT_SELECTOR) || node === button) continue;
      for (const key of ['aria-label', 'title', 'placeholder']) {
        if (node.hasAttribute(key)) updateValue(node, key, node.getAttribute(key), attributes, next => node.setAttribute(key, next));
      }
    }
    observer.observe(document.documentElement, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['title', 'aria-label', 'placeholder'] });
  }
  const observer = new MutationObserver(apply);
  button.addEventListener('click', () => {
    language = language === 'zh' ? 'en' : 'zh';
    try { localStorage.setItem(KEY, language); } catch { /* storage is optional */ }
    const url = new URL(location.href); url.searchParams.set('lang', language);
    history.replaceState(history.state, '', url);
    apply();
  });
  // Carry the choice across networks too, without changing content or fetching translations.
  document.addEventListener('click', event => {
    const anchor = event.target.closest?.('a[href]');
    if (!anchor || anchor.getAttribute('href').startsWith('#') || anchor.hasAttribute('download')) return;
    const url = new URL(anchor.href);
    if ((url.origin === location.origin || url.hostname.endsWith('.kinomotomiovo.workers.dev')) && /^\/(market|preview|runs|docs|operations|reader)(\/|$)/.test(url.pathname) && !/\.[a-z0-9]+$/i.test(url.pathname)) {
      url.searchParams.set('lang', language); anchor.href = url.href;
    }
  });
  apply();
}

if (typeof document !== 'undefined') startLanguageSwitch();
