// Loaded synchronously in <head> (before first paint). When the page will be
// shown in English, keep it hidden until i18n.js has translated it, so a
// navigation never flashes the Chinese source text. Same rule as
// initialLanguage() in i18n.js; never blocks longer than 1.5 s.
(function () {
  try {
    var requested = new URLSearchParams(location.search).get('lang');
    var stored = null;
    try { stored = localStorage.getItem('obelisk.site.language'); } catch (e) { /* storage is optional */ }
    var language = requested === 'en' || requested === 'zh' ? requested
      : stored === 'en' || stored === 'zh' ? stored
      : (navigator.language || '').toLowerCase().indexOf('zh') === 0 ? 'zh' : 'en';
    if (language !== 'en') return;
    var root = document.documentElement;
    root.lang = 'en';
    root.setAttribute('data-lang-pending', '');
    setTimeout(function () { root.removeAttribute('data-lang-pending'); }, 1500);
  } catch (e) { /* show the page as authored */ }
})();
