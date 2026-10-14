// Shared top bar for every public page: one canonical set of links, the
// network switch, and the wallet control (wallet.js).
import { mountWalletControl } from './wallet.js';

const MAINNET = 'obelisk-service-mainnet.kinomotomiovo.workers.dev';
const TESTNET = 'obelisk-service.kinomotomiovo.workers.dev';

const PAGES = [
  ['/', '首页'],
  ['/activate', '链上体验'],
  ['/market', 'Skill 市场'],
  ['/preview', '产品导览'],
  ['/runs', '运行记录'],
  ['/docs', '文档与安装'],
];

// Network-local IDs never carry over to the other chain.
export function networkPath(pathname) {
  const section = pathname.split('/').filter(Boolean)[0];
  if (['market', 'runs', 'preview', 'docs', 'operations', 'slides'].includes(section)) return '/' + section;
  if (section === 'activate' || section === 's') return '/activate';
  return '/';
}

function current(pathname, href) {
  if (href === '/') return pathname === '/' || pathname === '/start' || pathname === '/start/';
  return pathname === href || pathname.startsWith(href + '/');
}

export function startNavigation() {
  const header = document.querySelector('.site-top, .topbar');
  if (!header) return;
  const mainnet = location.hostname === MAINNET;
  const brand = header.querySelector('.ob-brand');
  if (brand) {
    if (brand.tagName === 'A') brand.href = '/';
  }

  // Share pages (/s/…) keep their focused reader bar; everything else gets the full set of links.
  const reading = /^\/s\//.test(location.pathname);
  let siteNav = header.querySelector('.site-nav');
  if (!siteNav && !reading) {
    siteNav = document.createElement('nav'); siteNav.className = 'site-nav'; siteNav.setAttribute('aria-label', '页面');
    (header.querySelector('.topbar-title') ?? brand)?.after(siteNav);
    header.querySelector('.topbar-title')?.setAttribute('hidden', '');
  }
  if (siteNav) {
    siteNav.replaceChildren(...PAGES.map(([href, label]) => {
      const link = document.createElement('a'); link.href = href; link.textContent = label;
      if (current(location.pathname, href)) link.setAttribute('aria-current', 'page');
      return link;
    }));
  }

  const nav = document.createElement('nav'); nav.className = 'network-switch'; nav.setAttribute('aria-label', '网络');
  for (const [main, label] of [[true, '主网 · 677'], [false, '测试网 · 968']]) {
    const link = document.createElement('a'); link.textContent = label;
    const url = new URL(networkPath(location.pathname), `https://${main ? MAINNET : TESTNET}`);
    const language = new URLSearchParams(location.search).get('lang');
    if (language === 'en' || language === 'zh') url.searchParams.set('lang', language);
    link.href = url.href;
    if (main === mainnet) link.setAttribute('aria-current', 'true');
    nav.append(link);
  }
  header.querySelector('[data-site-network]')?.remove();
  header.querySelector('.topbar-wallet')?.classList.add('superseded');
  header.append(nav);
  mountWalletControl(header);

  if (!mainnet && location.hostname === TESTNET) {
    const strip = document.createElement('aside'); strip.className = 'entry-strip';
    const label = document.createElement('span'); label.textContent = '这里是测试网演示数据。评审核验与主网体验请前往 BOT Chain 主网（677）。';
    const entry = document.createElement('a'); entry.href = new URL(networkPath(location.pathname), `https://${MAINNET}`).href; entry.textContent = '前往主网 →';
    strip.append(label, entry); header.after(strip);
  }
}
