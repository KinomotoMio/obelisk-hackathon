(() => {
  const W = 1920, H = 1080;
  const stage = document.getElementById('stage');
  const slides = [...document.querySelectorAll('.slide')];
  const bar = document.getElementById('bar');
  const help = document.getElementById('help');
  let cur = 0, overview = false, idleT;

  // page numbers
  slides.forEach((s, i) => {
    const br = s.querySelector('.chrome .br');
    if (br) br.textContent = String(i + 1).padStart(2, '0') + ' / ' + String(slides.length).padStart(2, '0');
  });

  function fit() {
    const k = Math.min(innerWidth / W, innerHeight / H);
    stage.style.transform = `translate(${-W * k / 2}px,${-H * k / 2}px) scale(${k})`;
  }

  function layoutOverview() {
    const gap = 24, cols = slides.length > 12 ? 4 : 3, rows = Math.ceil(slides.length / cols);
    const s = Math.min((W - gap * (cols + 1)) / cols, (H - gap * (rows + 1)) / rows * W / H);
    const left = (W - cols * s - (cols - 1) * gap) / 2;
    const top = (H - rows * (s * H / W) - (rows - 1) * gap) / 2;
    slides.forEach((el, i) => {
      const x = left + (i % cols) * (s + gap);
      const y = top + Math.floor(i / cols) * (s * H / W + gap);
      el.style.transformOrigin = '0 0';
      el.style.transform = `translate(${x}px,${y}px) scale(${s / W})`;
    });
  }
  function clearOverview() { slides.forEach(el => { el.style.transform = ''; el.style.transformOrigin = ''; }); }

  function go(n, push = true) {
    cur = Math.max(0, Math.min(slides.length - 1, n));
    slides.forEach((s, i) => s.classList.toggle('active', i === cur));
    bar.style.width = ((cur + 1) / slides.length * 100) + '%';
    if (push) history.replaceState(null, '', '#' + (cur + 1));
  }
  function toggleOverview(on = !overview) {
    overview = on;
    document.body.classList.toggle('overview', on);
    on ? layoutOverview() : clearOverview();
  }
  function fullscreen() {
    document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen?.();
  }

  addEventListener('keydown', e => {
    if (e.metaKey || e.ctrlKey || e.altKey || e.target.closest('a,button,input,textarea')) return;
    const k = e.key;
    if (overview) {
      if (k === 'Escape' || k === 'o' || k === 'O' || k === 'Enter') return toggleOverview(false);
      const cols = slides.length > 12 ? 4 : 3;
      if (k === 'ArrowRight') return go(cur + 1);
      if (k === 'ArrowLeft') return go(cur - 1);
      if (k === 'ArrowDown') return go(cur + cols);
      if (k === 'ArrowUp') return go(cur - cols);
      return;
    }
    if (['ArrowRight', 'ArrowDown', 'PageDown', ' ', 'Enter'].includes(k)) { e.preventDefault(); go(cur + 1); }
    else if (['ArrowLeft', 'ArrowUp', 'PageUp', 'Backspace'].includes(k)) { e.preventDefault(); go(cur - 1); }
    else if (k === 'Home') go(0);
    else if (k === 'End') go(slides.length - 1);
    else if (k === 'o' || k === 'O' || k === 'Escape') toggleOverview(true);
    else if (k === 'f' || k === 'F') fullscreen();
    else if (k === 'p' || k === 'P') print();
    else if (k === 'l' || k === 'L') setLang(document.documentElement.lang === 'zh' ? 'en' : 'zh');
    else if (k === '?') help.classList.toggle('show');
  });
  slides.forEach((s, i) => s.addEventListener('click', e => {
    if (overview) { go(i); toggleOverview(false); e.stopPropagation(); }
  }));
  document.addEventListener('click', e => {
    if (overview || e.target.closest('a,button,input,textarea')) return;
    e.clientX > innerWidth * .3 ? go(cur + 1) : go(cur - 1);
  });
  let tx = null;
  addEventListener('touchstart', e => tx = e.touches[0].clientX, { passive: true });
  addEventListener('touchend', e => {
    if (tx == null) return; const dx = e.changedTouches[0].clientX - tx; tx = null;
    if (Math.abs(dx) > 50) go(cur + (dx < 0 ? 1 : -1));
  });
  addEventListener('resize', () => { fit(); if (overview) layoutOverview(); });
  addEventListener('hashchange', () => go((parseInt(location.hash.slice(1)) || 1) - 1, false));
  addEventListener('mousemove', () => {
    document.body.classList.remove('idle'); clearTimeout(idleT);
    idleT = setTimeout(() => document.body.classList.add('idle'), 2500);
  });

  // language toggle (L): swaps <img data-zh> sources; coded text uses [data-en]/[data-zh-text]
  function setLang(l) {
    document.documentElement.lang = l;
    document.querySelectorAll('img[data-zh]').forEach(i => { i.dataset.en ??= i.getAttribute('src'); i.src = l === 'zh' ? i.dataset.zh : i.dataset.en; });
    document.querySelectorAll('[data-t-zh]').forEach(e => { e.dataset.tEn ??= e.innerHTML; e.innerHTML = l === 'zh' ? e.dataset.tZh : e.dataset.tEn; });
    try { localStorage.setItem('obelisk-deck-lang', l); } catch {}
  }
  try { const q = (location.search.match(/[?&]lang=(\w+)/) || [])[1]; const l = q || localStorage.getItem('obelisk-deck-lang'); if (l === 'zh') setLang('zh'); } catch {}

  fit();
  go((parseInt(location.hash.slice(1)) || 1) - 1, false);
  help.classList.add('show'); setTimeout(() => help.classList.remove('show'), 3500);
})();

