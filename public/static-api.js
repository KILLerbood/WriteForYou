// وضع القراءة فقط لصفحة GitHub Pages: بيحوّل نداءات /api/ لملفات ثابتة في الريبو
(() => {
  window.WFY_STATIC = true;
  const R = '../';
  const map = (u) => {
    let m;
    if (/^\/api\/state/.test(u)) return R + 'state.json';
    if ((m = u.match(/^\/api\/jobs\/([^/]+)\/out\/([^?]+)/))) return R + 'jobs/' + m[1] + '/' + m[2];
    if ((m = u.match(/^\/api\/jobs\/([^/]+)\/files\/([^?]+)/))) return R + 'jobs/' + m[1] + '/files/' + m[2];
    return null;
  };
  const orig = window.fetch.bind(window);
  window.fetch = (input, opts) => {
    const url = typeof input === 'string' ? input : (input && input.url) || '';
    if (url.startsWith('/api/')) {
      if (opts && opts.method && opts.method !== 'GET') return Promise.resolve(new Response(JSON.stringify({ error: 'النسخة دي للعرض فقط' }), { status: 403, headers: { 'Content-Type': 'application/json' } }));
      const t = map(url);
      return t ? orig(t, { cache: 'no-store' }) : Promise.resolve(new Response('{}', { status: 404 }));
    }
    return orig(input, opts);
  };
  const fix = (el) => {
    for (const a of ['src', 'href']) { const v = el.getAttribute && el.getAttribute(a); if (v && v.startsWith('/api/')) { const t = map(v); if (t) el.setAttribute(a, t); } }
  };
  new MutationObserver((ms) => { for (const m of ms) { if (m.type === 'attributes') fix(m.target); m.addedNodes && m.addedNodes.forEach((n) => { if (n.nodeType === 1) { fix(n); n.querySelectorAll && n.querySelectorAll('[src^="/api/"],[href^="/api/"]').forEach(fix); } }); } })
    .observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ['src', 'href'] });

  // <base href="public/"> بيخلّي روابط #tab تنقل لـ /public/ — نمنع ده ونغيّر الـ hash بس
  const root = location.pathname.replace(/public\/?$/, '');
  document.addEventListener('click', (e) => {
    const a = e.target.closest && e.target.closest('a[href^="#"]');
    if (!a) return;
    e.preventDefault();
    history.replaceState(null, '', root + a.getAttribute('href'));
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  }, true);
})();
