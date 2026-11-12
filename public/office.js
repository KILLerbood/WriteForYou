// WriteForYou — top-down animated office (canvas, no dependencies)
(function () {
  const W = 960, H = 540;
  const DESK_Y = 390, HOME_DY = 46, AISLE = 506;

  const AGENTS = [
    { id: 'intake',   name: 'سارة', role: 'الاستقبال',      stage: 'received',  color: '#e76f51', hair: '#3b2a20' },
    { id: 'listener', name: 'سمير', role: 'سامع المكالمات', stage: 'listening', color: '#2a9d8f', hair: '#1f1b16' },
    { id: 'writer',   name: 'ليلى', role: 'الكاتبة',        stage: 'writing',   color: '#e9a820', hair: '#5a3b1e' },
    { id: 'former',   name: 'كريم', role: 'معبّي الفورمز',  stage: 'forms',     color: '#8e7dbe', hair: '#2b2118' },
    { id: 'reviewer', name: 'منى',  role: 'المراجعة',       stage: 'review',    color: '#3b82c4', hair: '#1c1c1c' }
  ];
  const DESKS = [
    { key: 'received',  name: 'الاستقبال', cx: 830, w: 110, agent: 'intake',   color: '#e76f51' },
    { key: 'listening', name: 'السماع',    cx: 670, w: 110, agent: 'listener', color: '#2a9d8f' },
    { key: 'writing',   name: 'الكتابة',   cx: 510, w: 110, agent: 'writer',   color: '#e9a820' },
    { key: 'forms',     name: 'الفورمز',   cx: 350, w: 110, agent: 'former',   color: '#8e7dbe' },
    { key: 'review',    name: 'المراجعة',  cx: 190, w: 110, agent: 'reviewer', color: '#3b82c4' },
    { key: 'done',      name: 'تم ✔',      cx: 60,  w: 76,  agent: null,       color: '#16a34a' }
  ];
  const deskByKey = Object.fromEntries(DESKS.map(d => [d.key, d]));
  const STATE_COLOR = { working: '#16a34a', waiting: '#f59e0b', idle: '#9ca3af', error: '#dc2626' };
  window.WFY = { AGENTS, DESKS };

  let canvas, ctx, scale = 1, dpr = 1, onSelect = null;
  const cards = new Map();
  const actors = {};
  let derived = {};
  let ceoInfo = { pending: 0, lastOrder: '' };
  let firstSync = true, seq = 0, hover = null;
  let t = 0, last = 0;

  AGENTS.forEach(a => {
    const d = deskByKey[a.stage];
    actors[a.id] = { ...a, x: d.cx, y: DESK_Y + HOME_DY, hx: d.cx, hy: DESK_Y + HOME_DY, steps: [], missions: [], walking: false, face: 1 };
  });

  function init(c, selectCb) {
    canvas = c; ctx = canvas.getContext('2d'); onSelect = selectCb;
    const resize = () => {
      dpr = window.devicePixelRatio || 1;
      const w = canvas.clientWidth || W;
      canvas.width = Math.round(w * dpr); canvas.height = Math.round(w * dpr * H / W);
      scale = canvas.width / W;
    };
    resize();
    if (window.ResizeObserver) new ResizeObserver(resize).observe(canvas); else window.addEventListener('resize', resize);
    canvas.addEventListener('mousemove', e => { hover = hitCard(pt(e)); canvas.style.cursor = hover ? 'pointer' : 'default'; });
    canvas.addEventListener('mouseleave', () => { hover = null; });
    canvas.addEventListener('click', e => { const c2 = hitCard(pt(e)); if (c2 && onSelect) onSelect(c2.id); });
    requestAnimationFrame(loop);
  }
  const pt = e => { const r = canvas.getBoundingClientRect(); return { x: (e.clientX - r.left) / r.width * W, y: (e.clientY - r.top) / r.height * H }; };
  const hitCard = p => { let hit = null; cards.forEach(c => { if (c.alpha > .5 && Math.abs(p.x - c.x) < c.cw / 2 + 2 && Math.abs(p.y - c.y) < 13) hit = c; }); return hit; };

  // ---- data sync -------------------------------------------------------
  function update(data) {
    const jobs = data.jobs || [];
    derived = data.agents || {};
    ceoInfo = data.ceo || ceoInfo;
    const seen = new Set();
    jobs.forEach(j => {
      seen.add(j.id);
      let c = cards.get(j.id);
      const stage = deskByKey[j.stage] ? j.stage : 'received';
      if (!c) {
        const d = deskByKey[stage];
        c = { id: j.id, name: j.name, desk: stage, stage, x: d.cx, y: DESK_Y, tx: d.cx, ty: DESK_Y, alpha: firstSync ? 1 : 0, order: seq++, cw: 32, status: j.status };
        cards.set(j.id, c);
      }
      c.name = j.name; c.status = j.status;
      if (c.stage !== stage) {
        const from = c.stage; c.stage = stage;
        if (c.desk === from) transfer(c, from, stage);
        else if (c.desk !== 'carried' && c.desk !== 'pending') c.desk = stage;
        // carried/pending: the running mission drops the card at its latest stage
      }
    });
    cards.forEach((c, id) => { if (!seen.has(id)) cards.delete(id); });
    firstSync = false;
  }

  function transfer(card, fromKey, toKey) {
    const from = deskByKey[fromKey], to = deskByKey[toKey];
    const ag = from && from.agent ? actors[from.agent] : null;
    if (!ag) { card.desk = toKey; return; }
    card.desk = 'pending';
    ag.missions.push({ card, from, to });
  }

  // ---- simulation ------------------------------------------------------
  function buildSteps(ag, m) {
    const s = [];
    s.push({ t: 'move', x: ag.hx, y: ag.hy });
    s.push({ t: 'pick', card: m.card });
    s.push({ t: 'move', x: m.from.cx, y: AISLE });
    s.push({ t: 'move', x: m.to.cx, y: AISLE });
    s.push({ t: 'drop', card: m.card, to: m.to });
    s.push({ t: 'wait', left: 0.35 });
    s.push({ t: 'move', x: m.from.cx, y: AISLE });
    s.push({ t: 'move', x: ag.hx, y: ag.hy });
    return s;
  }
  function stepActor(ag, dt) {
    ag.walking = false;
    if (!ag.steps.length && ag.missions.length) ag.steps = buildSteps(ag, ag.missions.shift());
    const st = ag.steps[0];
    if (!st) return;
    if (st.t === 'move') {
      const dx = st.x - ag.x, dy = st.y - ag.y, dist = Math.hypot(dx, dy), sp = 190 * dt;
      if (dist <= sp) { ag.x = st.x; ag.y = st.y; ag.steps.shift(); }
      else { ag.x += dx / dist * sp; ag.y += dy / dist * sp; ag.walking = true; if (Math.abs(dx) > 2) ag.face = dx > 0 ? 1 : -1; }
    } else if (st.t === 'pick') { st.card.desk = 'carried'; st.card.carrier = ag.id; ag.steps.shift(); }
    else if (st.t === 'drop') { st.card.desk = st.card.stage === st.to.key ? st.to.key : st.card.stage; st.card.carrier = null; ag.steps.shift(); }
    else if (st.t === 'wait') { st.left -= dt; if (st.left <= 0) ag.steps.shift(); }
  }
  function slotFor(deskKey, idx) {
    const d = deskByKey[deskKey], sp = d.w / 3;
    const col = idx % 3, row = Math.floor(idx / 3) % 2, extra = Math.floor(idx / 6) * 3;
    return { x: d.cx - sp + col * sp + extra, y: DESK_Y + 12 - row * 14 - extra };
  }
  function stepCards(dt) {
    const byDesk = {};
    [...cards.values()].sort((a, b) => a.order - b.order).forEach(c => { if (deskByKey[c.desk]) (byDesk[c.desk] = byDesk[c.desk] || []).push(c); });
    Object.keys(byDesk).forEach(k => byDesk[k].forEach((c, i) => { const s = slotFor(k, i); c.tx = s.x; c.ty = s.y; c.cw = k === 'done' ? 22 : 32; }));
    cards.forEach(c => {
      if (c.alpha < 1) c.alpha = Math.min(1, c.alpha + dt * 2);
      if (c.desk === 'carried') { const a = actors[c.carrier]; if (a) { c.x = a.x + 17 * a.face; c.y = a.y - 4; c.cw = 32; } return; }
      if (c.desk === 'pending') return;
      const k = Math.min(1, dt * 9);
      c.x += (c.tx - c.x) * k; c.y += (c.ty - c.y) * k;
    });
  }

  // ---- drawing helpers -------------------------------------------------
  const FONT = 'Tahoma, "Segoe UI", Arial, sans-serif';
  function rr(x, y, w, h, r, fill, stroke, lw) {
    ctx.beginPath(); ctx.roundRect ? ctx.roundRect(x, y, w, h, r) : ctx.rect(x, y, w, h);
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    if (stroke) { ctx.lineWidth = lw || 1; ctx.strokeStyle = stroke; ctx.stroke(); }
  }
  function circ(x, y, r, fill) { ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fillStyle = fill; ctx.fill(); }
  function ell(x, y, rx, ry, fill) { ctx.beginPath(); ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2); ctx.fillStyle = fill; ctx.fill(); }
  function txt(s, x, y, size, color, weight, align, dir) {
    ctx.font = `${weight || 600} ${size}px ${FONT}`; ctx.fillStyle = color; ctx.textAlign = align || 'center'; ctx.textBaseline = 'middle';
    ctx.direction = dir || 'rtl'; ctx.fillText(s, x, y);
  }
  function fit(s, maxW, size, weight) {
    ctx.font = `${weight || 600} ${size}px ${FONT}`;
    if (ctx.measureText(s).width <= maxW) return s;
    while (s.length > 1 && ctx.measureText(s + '…').width > maxW) s = s.slice(0, -1);
    return s + '…';
  }
  function bubble(x, y, text, accent) {
    const s = fit(text, 200, 12, 600);
    ctx.font = `600 12px ${FONT}`;
    const w = Math.max(36, ctx.measureText(s).width + 18), h = 24, bx = Math.min(W - w / 2 - 4, Math.max(w / 2 + 4, x));
    ctx.save(); ctx.shadowColor = 'rgba(0,0,0,.18)'; ctx.shadowBlur = 6; ctx.shadowOffsetY = 2;
    rr(bx - w / 2, y - h, w, h, 9, '#fff', accent || '#d6ccb8', 1.5); ctx.restore();
    ctx.beginPath(); ctx.moveTo(x - 5, y - 1); ctx.lineTo(x, y + 6); ctx.lineTo(x + 5, y - 1); ctx.fillStyle = '#fff'; ctx.fill();
    txt(s, bx, y - h / 2 + 1, 12, '#1f2937', 600);
  }
  function person(x, y, o) {
    ell(x, y + 16, 14, 5, 'rgba(0,0,0,.16)');
    const sw = o.walking ? Math.sin(t * 13) * 4 : 0;
    if (o.walking) { rr(x - 8 + sw, y + 8, 6, 9, 2, '#374151'); rr(x + 2 - sw, y + 8, 6, 9, 2, '#374151'); }
    else { rr(x - 8, y + 8, 6, 6, 2, '#374151'); rr(x + 2, y + 8, 6, 6, 2, '#374151'); }
    rr(x - 11, y - 8, 22, 19, 7, o.shirt);
    ctx.fillStyle = 'rgba(255,255,255,.28)'; ctx.fillRect(x - 3, y - 7, 6, 3);
    const bob = o.working ? Math.sin(t * 15) * 1.8 : (o.walking ? sw * .3 : 0);
    circ(x - 12, y + 2 + (o.working ? bob : -bob), 3.6, o.skin || '#f1c9a5');
    circ(x + 12, y + 2 + (o.working ? -bob : bob), 3.6, o.skin || '#f1c9a5');
    circ(x, y - 17, 9.5, o.skin || '#f1c9a5');
    ctx.beginPath(); ctx.arc(x, y - 19, 10, Math.PI, 0); ctx.fillStyle = o.hair; ctx.fill();
    ctx.fillRect(x - 10, y - 20, 20, 3);
    circ(x - 3.3, y - 16, 1.2, '#1f2937'); circ(x + 3.3, y - 16, 1.2, '#1f2937');
    if (o.working) { ctx.beginPath(); ctx.arc(x, y - 12.5, 2.2, 0.1, Math.PI - 0.1); ctx.lineWidth = 1; ctx.strokeStyle = '#7c2d12'; ctx.stroke(); }
    else { ctx.fillStyle = '#9a3412'; ctx.fillRect(x - 1.6, y - 12.5, 3.2, 1); }
  }

  // ---- scene -----------------------------------------------------------
  function drawScene() {
    // floor
    ctx.fillStyle = '#efe6d8'; ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = 'rgba(120,100,70,.08)'; ctx.lineWidth = 1;
    for (let x = 0; x <= W; x += 40) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
    for (let y = 0; y <= H; y += 40) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
    // workspace rug
    rr(12, 262, W - 24, 266, 18, '#e3d6bf', '#cdbd9c', 1.5);
    // wall band
    ctx.fillStyle = '#dfe7ee'; ctx.fillRect(330, 0, W - 330, 132);
    ctx.fillStyle = '#c4d0dc'; ctx.fillRect(330, 128, W - 330, 5);
    // windows
    [372, 500, 760, 860].forEach((wx, i) => {
      const g = ctx.createLinearGradient(0, 18, 0, 108); g.addColorStop(0, '#9fd0ee'); g.addColorStop(1, '#e7f4fb');
      rr(wx, 18, 76, 90, 6, g, '#8aa4b8', 3);
      ctx.strokeStyle = '#8aa4b8'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(wx + 38, 18); ctx.lineTo(wx + 38, 108); ctx.moveTo(wx, 63); ctx.lineTo(wx + 76, 63); ctx.stroke();
    });
    // board
    rr(596, 16, 296, 100, 8, '#1f4d44', '#8b6b43', 5);
    txt('WriteForYou', 744, 44, 24, '#f5f1e6', 800, 'center', 'ltr');
    txt('استقبال ← سماع ← كتابة ← فورم ← مراجعة ← تم', 744, 76, 12.5, '#cfe7de', 600);
    txt('نسمع.. نكتب.. نملي الفورم.. وانت ترتاح', 744, 98, 11.5, '#e9c46a', 600);
    // plants
    plant(342, 196); plant(948, 196); plant(320, 470);
    // aisle guide (flow goes right → left)
    ctx.strokeStyle = 'rgba(15,118,110,.35)'; ctx.setLineDash([10, 9]); ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(880, AISLE + 14); ctx.lineTo(40, AISLE + 14); ctx.stroke(); ctx.setLineDash([]);
    for (let x = 700; x > 100; x -= 220) { ctx.beginPath(); ctx.moveTo(x, AISLE + 8); ctx.lineTo(x - 9, AISLE + 14); ctx.lineTo(x, AISLE + 20); ctx.strokeStyle = 'rgba(15,118,110,.55)'; ctx.lineWidth = 2; ctx.stroke(); }
  }
  function plant(x, y) {
    rr(x - 9, y - 4, 18, 14, 3, '#a8643a'); circ(x, y - 10, 11, '#3f8f4f'); circ(x - 8, y - 5, 7, '#2f7a3f'); circ(x + 8, y - 6, 7, '#4aa05a');
  }
  function drawCEO() {
    rr(14, 14, 300, 214, 14, '#e8eef6', '#8fa6bd', 4);
    rr(22, 22, 284, 198, 10, '#d7e0eb');
    // carpet + decor
    rr(60, 130, 210, 80, 12, '#c3cfdf');
    plant(40, 56); plant(290, 205);
    rr(238, 36, 56, 40, 5, '#fff', '#9fb3c8', 2); txt('صندوق', 266, 48, 11, '#475569', 700);
    const pend = ceoInfo.pending || 0;
    txt(String(pend), 266, 64, 17, pend ? '#dc2626' : '#16a34a', 800);
    // ceo
    const st = ceoInfo.pending ? 'waiting' : 'idle';
    person(162, 92, { shirt: '#1f2937', hair: '#2a2118', working: false, walking: false });
    // tie
    ctx.fillStyle = '#dc2626'; ctx.fillRect(160, 86, 4, 12);
    // desk
    rr(84, 112, 156, 50, 8, '#6b4a2b', '#4b321c', 2);
    rr(96, 118, 36, 22, 3, '#111827'); rr(100, 121, 28, 15, 2, pend ? '#fbbf24' : '#34d399');
    rr(190, 122, 32, 20, 3, '#f8fafc', '#cbd5e1'); rr(194, 126, 24, 3, 1, '#94a3b8'); rr(194, 132, 18, 3, 1, '#94a3b8');
    rr(116, 146, 92, 14, 6, '#e9c46a'); txt('المدير التنفيذي', 162, 153, 11.5, '#3b2a14', 800);
    // bubble
    const msg = pend ? `فيه ${pend} طلب مستنيك — قولي «اشتغل على الجديد»` : (ceoInfo.anyWork ? 'الفريق شغال.. متابع الوضع' : 'في انتظار أوامرك');
    bubble(162, 54, msg, pend ? '#f59e0b' : '#cbd5e1');
    circ(228, 100, 5, STATE_COLOR[st]);
  }
  function drawDesk(d) {
    const cx = d.cx, top = DESK_Y - 28, w = d.w, a = d.agent ? actors[d.agent] : null;
    const info = a ? (derived[a.id] || { state: 'idle' }) : null;
    // plaque
    rr(cx - 48, top - 36, 96, 22, 8, d.color); txt(d.name, cx, top - 25, 13, '#fff', 800);
    if (d.key === 'done') {
      rr(cx - w / 2, top - 6, w, 94, 6, '#8d9aa8', '#667385', 2);
      rr(cx - w / 2 + 6, top, w - 12, 82, 4, '#aab6c3');
      return;
    }
    // chair
    rr(cx - 17, DESK_Y + 22, 34, 40, 10, '#3f4a59');
    // desk top
    rr(cx - w / 2, top, w, 56, 7, '#c79a68', '#8f6a40', 2);
    // monitor + keyboard
    const working = info && info.state === 'working';
    rr(cx - 15, top + 3, 30, 15, 2, '#111827');
    rr(cx - 12, top + 5, 24, 11, 1, working ? ((Math.floor(t * 4) % 2) ? '#34d399' : '#6ee7b7') : (info && info.state === 'error' ? '#f87171' : '#334155'));
    rr(cx - 12, top + 40, 24, 8, 2, '#e5e7eb', '#9ca3af');
  }
  function drawActor(ag) {
    const info = derived[ag.id] || { state: 'idle' };
    const sitting = !ag.walking && ag.steps.length === 0;
    const working = sitting && info.state === 'working';
    person(ag.x, ag.y, { shirt: ag.color, hair: ag.hair, working, walking: ag.walking });
    // name tag
    rr(ag.x - 22, ag.y + 20, 44, 15, 7, 'rgba(255,255,255,.92)', ag.color, 1.5); txt(ag.name, ag.x, ag.y + 28, 11.5, '#1f2937', 800);
    circ(ag.x + 17, ag.y - 33, 5, STATE_COLOR[info.state] || STATE_COLOR.idle);
    if (sitting) {
      let b = '';
      if (info.state === 'working') b = info.task || 'شغال..';
      else if (info.state === 'waiting') b = info.task || 'فيه شغل مستني';
      else if (info.state === 'error') b = info.task || 'فيه مشكلة!';
      if (b) bubble(ag.x, ag.y - 42, b, STATE_COLOR[info.state]);
    }
  }
  function drawCard(c) {
    if (c.alpha <= 0) return;
    ctx.save(); ctx.globalAlpha = c.alpha;
    const w = c.cw, h = c.cw > 26 ? 22 : 17, x = c.x - w / 2, y = c.y - h / 2;
    ctx.shadowColor = 'rgba(0,0,0,.25)'; ctx.shadowBlur = 3; ctx.shadowOffsetY = 1;
    rr(x, y, w, h, 3, '#fffef8', hover === c ? '#0f766e' : '#bfae8d', hover === c ? 2 : 1);
    ctx.shadowColor = 'transparent';
    const col = c.status === 'error' ? '#dc2626' : c.status === 'done' ? '#16a34a' : c.status === 'working' ? '#16a34a' : '#f59e0b';
    ctx.fillStyle = col; ctx.fillRect(x + 1, y + 1, w - 2, 4);
    if (c.cw > 26) txt(fit(c.name, w - 4, 8.5, 700), c.x, c.y + 4, 8.5, '#374151', 700);
    ctx.restore();
  }

  function loop(ts) {
    const dt = Math.min(0.05, (ts - (last || ts)) / 1000); last = ts; t += dt;
    Object.values(actors).forEach(a => stepActor(a, dt));
    stepCards(dt);
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    drawScene(); drawCEO();
    DESKS.forEach(drawDesk);
    // sort actors by y for overlap
    const cardsArr = [...cards.values()];
    cardsArr.filter(c => c.desk !== 'carried').forEach(drawCard);
    Object.values(actors).sort((a, b) => a.y - b.y).forEach(drawActor);
    cardsArr.filter(c => c.desk === 'carried').forEach(drawCard);
    requestAnimationFrame(loop);
  }

  window.Office = { init, update };
})();
