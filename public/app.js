// WriteForYou — control panel, uploads, CEO orders (no dependencies)
(function () {
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const { AGENTS } = window.WFY;
  const STAGE_AR = { received: 'استلام', listening: 'مراجعة المكالمة', forms: 'كتابة الفورم', review: 'مراجعة نهائية', approval: 'اعتماد', done: 'تم' };
  const STAGE_ORDER = ['received', 'listening', 'forms', 'review', 'approval', 'done'];
  const STATUS_AR = { queued: 'في الانتظار', working: 'شغال', waiting_approval: 'مستني اعتماد', saved: 'اتحفظ على Ipsos · مستني مراجعتك', done: 'خلص', error: 'مشكلة' };
  const STATE_AR = { working: 'شغال', waiting: 'مستني', idle: 'فاضي', error: 'مشكلة' };
  const RUN_CMD = 'اشتغل على الجديد في WriteForYou';

  let state = { jobs: [], orders: [] };
  let demo = false, demoTimer = null, demoJobs = [];
  let selected = null, tab = 'overview', picked = [], uploading = false;
  let detailSig = '';

  // ---------- helpers ----------
  const hhmm = (iso) => { try { return new Date(iso).toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' }); } catch { return ''; } };
  const fmtSize = (n) => n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB';
  const api = async (url, opts) => { const r = await fetch(url, opts); if (!r.ok) throw new Error(url + ' ' + r.status); return r; };

  // ---------- derive agent state + CEO info ----------
  function derive(data) {
    const agents = {};
    AGENTS.forEach((a) => { agents[a.id] = { state: 'idle', task: '', count: 0 }; });
    data.jobs.forEach((j) => {
      if (j.stage === 'done' || j.status === 'done') return;
      const stageAgent = AGENTS.find((a) => a.stage === j.stage);
      const id = (j.agent && agents[j.agent]) ? j.agent : (stageAgent && stageAgent.id);
      if (!id) return;
      const ag = agents[id]; ag.count++;
      const rank = { idle: 0, waiting: 1, working: 2, error: 3 };
      let st = 'waiting', task = `مستني يبدأ: ${j.name}`;
      if (j.status === 'working') { st = 'working'; task = j.task || `شغال على ${j.name}`; }
      else if (j.status === 'error') { st = 'error'; task = j.task || `مشكلة في ${j.name}`; }
      else if (j.status === 'saved') { st = 'waiting'; task = `اتحفظ على Ipsos، مستني مراجعتك: ${j.name}`; }
      else if (j.status === 'waiting_approval') { st = 'waiting'; task = `مستني موافقتك: ${j.name}`; }
      if (rank[st] > rank[ag.state]) { ag.state = st; ag.task = task; }
    });
    const unhandled = (data.orders || []).filter((o) => !o.handled).length;
    const queued = data.jobs.filter((j) => j.status === 'queued').length;
    const approvals = data.jobs.filter((j) => j.stage === 'approval' && j.status !== 'done').length;
    return { agents, ceo: { pending: unhandled + queued, approvals, anyWork: data.jobs.some((j) => j.status === 'working') } };
  }

  // ---------- render: agents panel ----------
  function renderAgents(d) {
    const ceoCard = `<div class="agent" style="--c:#8b5cf6"><div class="nm"><b>المدير التنفيذي</b><span class="st"><i class="dot ${d.ceo.approvals || d.ceo.pending ? 'wait' : (d.ceo.anyWork ? 'work' : 'idle')}"></i>${d.ceo.approvals ? 'مستني اعتمادك' : d.ceo.pending ? 'فيه طلبات' : d.ceo.anyWork ? 'متابع' : 'فاضي'}</span></div><div class="role">Claude · التوزيع والاعتماد</div><div class="tk">${d.ceo.approvals ? d.ceo.approvals + ' مشروع مستني الاعتماد' : d.ceo.pending ? d.ceo.pending + ' طلب/مشروع مستني تنفيذ' : 'في انتظار أوامرك'}</div><div class="ct"></div></div>`;
    $('agents').innerHTML = ceoCard + AGENTS.map((a) => {
      const i = d.agents[a.id];
      const dot = { working: 'work', waiting: 'wait', idle: 'idle', error: 'err' }[i.state];
      return `<div class="agent" style="--c:${a.color}">
        <div class="nm"><b>${esc(a.name)}</b><span class="st"><i class="dot ${dot}"></i>${STATE_AR[i.state]}</span></div>
        <div class="role">${esc(a.role)}</div>
        <div class="tk">${esc(i.task || 'مفيش مهام دلوقتي')}</div>
        <div class="ct">${i.count ? i.count + ' مشروع عنده' : ''}</div>
      </div>`;
    }).join('');
  }

  // ---------- render: jobs list ----------
  function stepper(j) {
    const idx = STAGE_ORDER.indexOf(j.stage);
    return '<div class="stepper">' + STAGE_ORDER.map((s, n) => `<span class="${n < idx ? 'past' : n === idx ? 'now' : ''}">${STAGE_AR[s]}</span>`).join('') + '</div>';
  }
  function renderJobs() {
    const box = $('jobs');
    if (!state.jobs.length) { box.innerHTML = '<div class="empty">مفيش مشاريع لسه. ارفع أول مشروع من الفورم اللي على الجنب.</div>'; return; }
    const ae0 = document.activeElement; if (ae0 && ae0.classList && ae0.classList.contains('st-sel') && box.contains(ae0)) return;
    const q = (($('jobSearch') || {}).value || '').trim().replace(/^#/, '').toLowerCase();
    const list = q ? state.jobs.filter((j) => String(j.jobNumber || '').toLowerCase().includes(q) || String(j.name || '').toLowerCase().includes(q) || String(j.id).toLowerCase().includes(q)) : state.jobs;
    if (!list.length) { box.innerHTML = '<div class="empty">مفيش شغل بالرقم ده: ' + esc(q) + '</div>'; refreshTargets(); return; }
    box.innerHTML = list.map((j) => `
      <div class="job ${j.id === selected ? 'sel' : ''}" data-id="${esc(j.id)}">
        <div class="hd"><b>${j.jobNumber ? '#' + esc(j.jobNumber) + ' · ' : ''}${esc(j.name)}</b><span class="chipst ${esc(j.status)}">${STATUS_AR[j.status] || esc(j.status)}</span></div>
        <div class="meta">${j.files.length} ملف · ${esc(j.task || '')}</div>
        ${typeof j.progress === 'number' ? `<div class="prog"><i style="width:${Math.max(0, Math.min(100, j.progress))}%"></i></div>` : ''}
        ${stepper(j)}
        ${window.WFY_STATIC ? '' : `<div class="job-actions"><select class="st-sel" title="تغيير الحالة">${Object.entries(STATUS_AR).map(([k, v]) => `<option value="${k}" ${k === j.status ? 'selected' : ''}>${v}</option>`).join('')}</select><button type="button" class="del-job" title="حذف الأوردر">🗑 حذف</button></div>`}
      </div>`).join('');
    refreshTargets();
  }
  document.addEventListener('input', (e) => { if (e.target && e.target.id === 'jobSearch') renderJobs(); });
  document.addEventListener('keydown', (e) => {
    if (e.target && e.target.id === 'jobSearch' && e.key === 'Enter') {
      const q = e.target.value.trim().replace(/^#/, '');
      const hit = state.jobs.find((j) => String(j.jobNumber) === q) || (state.jobs.filter((j) => String(j.jobNumber || '').includes(q))[0]);
      if (hit) { selected = hit.id; detailSig = ''; tab = 'overview'; renderJobs(); renderDetail(); }
    }
  });
  function refreshTargets() {
    const sel = $('upTarget'), cur = sel.value;
    sel.innerHTML = '<option value="new">مشروع جديد</option>' + state.jobs.filter((j) => !j.demo).map((j) => `<option value="${esc(j.id)}">إضافة لـ: ${esc(j.name)}</option>`).join('');
    sel.value = [...sel.options].some((o) => o.value === cur) ? cur : 'new';
    const isNew = sel.value === 'new';
    $('nameWrap').classList.toggle('hidden', !isNew); $('nameWrap2').classList.toggle('hidden', !isNew); $('notesWrap').classList.toggle('hidden', !isNew);
  }

  // ---------- render: CEO chat ----------
  function renderChat() {
    const chat = $('chat');
    const orders = state.orders || [];
    if (!orders.length) { chat.innerHTML = '<div class="empty">لسه مفيش أوامر. اكتب أول أمر للمدير.</div>'; return; }
    chat.innerHTML = orders.map((o) => {
      let h = `<div class="msg me">${esc(o.text)}<small>${hhmm(o.ts)}${o.jobId ? ' · مشروع محدد' : ''}${o.handled ? '' : ' · مستني التنفيذ'}</small></div>`;
      if (o.handled) h += `<div class="msg ceo">${esc(o.reply || 'تم التنفيذ ✔')}<small>المدير · ${hhmm(o.repliedAt)}</small></div>`;
      return h;
    }).join('');
    chat.scrollTop = chat.scrollHeight;
  }

  // ---------- render: detail ----------
  const TABS = [['overview', 'نظرة عامة'], ['report', 'التقرير PDF'], ['files', 'الملفات'], ['callreview', 'مراجعة المكالمة'], ['transcript', 'النص المفرّغ'], ['answers', 'بيانات الفورم'], ['plan', 'خطة الفورم'], ['log', 'السجل']];
  const OUTFILE = { callreview: 'call-review.json', transcript: 'transcript.txt', answers: 'answers.json', plan: 'form-plan.md' };

  function renderDetail() {
    const j = state.jobs.find((x) => x.id === selected);
    const head = $('detailHead'), tabs = $('detailTabs'), body = $('detailBody');
    if (!j) { head.innerHTML = '<h3>تفاصيل المشروع</h3><div class="muted small">اختار مشروع من القائمة أو اضغط على ملفه في المكتب.</div>'; tabs.innerHTML = ''; body.innerHTML = ''; detailSig = ''; return; }
    head.innerHTML = `<h3>${j.jobNumber ? 'Job ' + esc(j.jobNumber) + ' · ' : ''}${esc(j.name)} <span class="chipst ${esc(j.status)}">${STATUS_AR[j.status] || esc(j.status)}</span></h3><div class="muted small">المرحلة: ${STAGE_AR[j.stage]} · اتنشأ ${hhmm(j.createdAt)}</div>`;
    tabs.innerHTML = TABS.map(([k, n]) => `<button class="tab ${k === tab ? 'on' : ''}" data-tab="${k}">${n}</button>`).join('');
    const sig = [j.id, tab, j.files.length, j.log.length, j.status, j.stage, j.outputs && (j.outputs[OUTFILE[tab]] || j.outputs['report.pdf'] || 0)].join('|');
    if (sig === detailSig) return;
    detailSig = sig;
    if (tab === 'overview') {
      body.innerHTML = `<table class="kv"><tr><th>الحالة</th><td>${STATUS_AR[j.status] || esc(j.status)}</td></tr>
        <tr><th>الوكيل الحالي</th><td>${esc((AGENTS.find((a) => a.id === j.agent) || {}).name || '—')}</td></tr>
        <tr><th>المهمة الحالية</th><td>${esc(j.task || '—')}</td></tr>
        <tr><th>ملاحظات / تعليمات</th><td>${esc(j.notes || '—')}</td></tr>
        <tr><th>عدد الملفات</th><td>${j.files.length}</td></tr>
        <tr><th>آخر تحديث</th><td>${hhmm(j.updatedAt)}</td></tr></table>${stepper(j)}`;
    } else if (tab === 'report') {
      const u = `/api/jobs/${encodeURIComponent(j.id)}/out/report.pdf`;
      body.innerHTML = (j.outputs && j.outputs['report.pdf']) ? `<div style="display:flex;gap:8px;margin-bottom:8px"><a class="btn primary" href="${u}?download=1" download="Job-${esc(j.jobNumber)}-report.pdf">⬇ تحميل الـ PDF</a><a class="btn" href="${u}" target="_blank">فتح في تبويب</a></div><iframe src="${u}" style="width:100%;height:78vh;border:1px solid var(--line);border-radius:10px;background:#fff"></iframe>` : '<div class="empty">التقرير لسه ماجهزش. بيتعمل لما المشروع يعدّي المراجعة النهائية.</div>';
    } else if (tab === 'files') {
      body.innerHTML = j.files.length ? '<div class="files">' + j.files.map((f) => {
        const u = `/api/jobs/${encodeURIComponent(j.id)}/files/${encodeURIComponent(f.name)}`;
        const media = f.kind === 'audio' ? `<audio controls preload="none" src="${u}"></audio>` : f.kind === 'image' ? `<a href="${u}" target="_blank"><img src="${u}" alt=""></a>` : `<a href="${u}" target="_blank">فتح</a>`;
        const acts = f.kind === 'image' ? `<div class="acts"><button class="btn small" data-copyimg="${u}">📋 انسخ الصورة</button><a class="btn small" href="${u}" download="${esc(f.name)}">⬇ تحميل</a></div>` : `<div class="acts"><a class="btn small" href="${u}" download="${esc(f.name)}">⬇ تحميل</a></div>`;
        return `<div class="file"><b>${esc(f.name)}</b><div class="muted">${fmtSize(f.size)}</div>${media}${acts}</div>`;
      }).join('') + '</div>' : '<div class="empty">مفيش ملفات.</div>';
    } else if (tab === 'log') {
      body.innerHTML = j.log.length ? j.log.slice().reverse().map((l) => {
        const a = AGENTS.find((x) => x.id === l.agent);
        return `<div class="logline ${esc(l.level || '')}"><time>${hhmm(l.ts)}</time><span class="ag">${esc(a ? a.name : (l.agent || ''))}</span><span>${esc(l.msg || '')}</span></div>`;
      }).join('') : '<div class="empty">مفيش خطوات متسجلة لسه.</div>';
    } else {
      body.innerHTML = '<div class="empty">جاري التحميل…</div>';
      if (j.demo) { body.innerHTML = '<div class="empty">ده مشروع تجريبي، مفيش مخرجات حقيقية.</div>'; return; }
      const myTab = tab, myId = j.id;
      api(`/api/jobs/${encodeURIComponent(j.id)}/out/${OUTFILE[tab]}`).then((r) => r.text()).then((txt) => {
        if (selected !== myId || tab !== myTab) return;
        body.innerHTML = tab === 'answers' ? renderAnswers(txt) : tab === 'callreview' ? renderCallReview(txt, j) : `<pre class="txt">${esc(txt)}</pre>`;
        if (tab === 'callreview') bindSeek(body);
      }).catch(() => { if (selected === myId && tab === myTab) body.innerHTML = '<div class="empty">لسه متكتبش. هيظهر هنا أول ما Claude يخلصه.</div>'; });
    }
  }
  const mmss = (s) => { s = Math.max(0, Math.round(Number(s) || 0)); return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0'); };
  function renderCallReview(txt, j) {
    let r; try { r = JSON.parse(txt); } catch { return `<pre class="txt">${esc(txt)}</pre>`; }
    const audio = j.files.find((f) => f.kind === 'audio');
    const player = audio ? `<audio class="player" id="cr-audio" controls preload="metadata" src="/api/jobs/${encodeURIComponent(j.id)}/files/${encodeURIComponent(audio.name)}"></audio>` : '';
    const v = r.verified === true ? '<span class="badge-ok">✔ مطابق</span>' : r.verified === false ? '<span class="badge-bad">✖ غير مطابق</span>' : '—';
    const rows = [['رقم التليفون', r.phone], ['الاسم', r.name], ['تاريخ ووقت المكالمة', r.call_time], ['مدة المكالمة', r.duration], ['موضوع المكالمة', r.subject]].filter((x) => x[1]).map((x) => `<tr><th>${x[0]}</th><td>${esc(x[1])}</td></tr>`).join('');
    const mom = (r.key_moments || []).map((m) => `<div class="moment"><button data-t="${esc(m.t)}">${mmss(m.t)}</button><div>${esc(m.note || '')}</div></div>`).join('');
    const checks = (r.checks || []).map((c) => `<div class="logline"><span class="ag">${c.ok ? '✔' : '✖'}</span><span>${esc(c.note || c)}</span></div>`).join('');
    return player + `<table class="kv"><tr><th>مطابقة الرقم مع السكرين شوت</th><td>${v}</td></tr>${rows}</table>` + (checks ? `<h4>التحقق</h4>${checks}` : '') + (mom ? `<h4>اللحظات المهمة (بالثواني)</h4><div class="moments">${mom}</div>` : '') + (r.notes ? `<h4>ملاحظات</h4><pre class="txt">${esc(r.notes)}</pre>` : '');
  }
  function bindSeek(root) {
    root.querySelectorAll('.moment button').forEach((b) => b.addEventListener('click', () => { const a = root.querySelector('#cr-audio'); if (a) { a.currentTime = Number(b.dataset.t) || 0; a.play().catch(() => {}); } }));
  }
  function renderAnswers(txt) {
    let data; try { data = JSON.parse(txt); } catch { return `<pre class="txt">${esc(txt)}</pre>`; }
    if (data && data.answers && !Array.isArray(data.answers) && Object.values(data.answers)[0] && Object.values(data.answers)[0].question) {
      const rows = Object.entries(data.answers);
      const YN = ['Yes', 'No'];
      const bar = '<div class="ans-bar"><button class="btn small primary" data-gotab="report">📄 افتح الـ PDF</button> <button class="btn small" data-copyall="1">نسخ كل الإجابات</button></div>';
      return bar + '<div class="fq-list">' + rows.map(([id, r]) => {
        const isYN = YN.includes(r.answer), why = [r.why].filter(Boolean).join(' ');
        const ctl = isYN
          ? `<div class="fq-radios">${YN.map((o, i) => `<span class="rad ${o === r.answer ? 'on ' + (o === 'Yes' ? 'y' : 'n') : ''}">${(i + 1) + '. '}${o}</span>`).join('')}<button class="btn small copy" data-copy="${esc(r.answer)}">📋 نسخ ${esc(r.answer)}</button></div>`
          : `<div class="fq-val"><input type="text" readonly value="${esc(r.answer)}"><button class="btn small copy" data-copy="${esc(r.answer)}">📋 نسخ</button></div>`;
        const cm = why ? `<div class="fq-cm"><div class="fq-cmt">${esc(why)}</div><button class="btn small copy" data-copy="${esc(why)}">📋 نسخ الكومنت</button></div>` : '';
        const cm2 = r.why2 ? `<div class="fq-cm fq-cm2"><div class="fq-cmt"><b>كومنت 2 — ${esc(r.q2_ar || r.q2 || '')}</b><br><span dir="ltr">${esc(r.q2 || '')}</span><br>${esc(r.why2)}</div><button class="btn small copy" data-copy="${esc(r.why2)}">📋 نسخ الكومنت 2</button></div>` : '';
        return `<div class="fq" data-a="${esc(r.answer)}"><div class="fq-q">${esc(r.question)}</div>${r.q_ar ? `<div class="fq-q ar" dir="rtl">${esc(r.q_ar)}</div>` : ''}${ctl}${cm}${cm2}</div>`;
      }).join('') + '</div>';
    }
    const val = (v) => (v && typeof v === 'object') ? `<pre class="txt">${esc(JSON.stringify(v, null, 2))}</pre>` : esc(v);
    if (Array.isArray(data)) data = Object.fromEntries(data.map((x, i) => [x && (x.question || x.field || x.name) || `#${i + 1}`, x && (x.answer !== undefined ? x.answer : x.value !== undefined ? x.value : x)]));
    return '<table class="kv">' + Object.entries(data).map(([k, v]) => `<tr><th>${esc(k)}</th><td>${val(v)}</td></tr>`).join('') + '</table>';
  }
  document.addEventListener('click', (e) => {
    const b = e.target.closest && e.target.closest('[data-copy],[data-copyall]'); if (!b) return;
    let text = b.dataset.copy;
    if (b.dataset.copyall) text = [...document.querySelectorAll('.fq')].map((r) => r.querySelector('.fq-q').textContent + ': ' + r.dataset.a).join('\n');
    const done = () => { const o = b.textContent; b.textContent = 'اتنسخ ✔'; setTimeout(() => { b.textContent = o; }, 1200); };
    (navigator.clipboard ? navigator.clipboard.writeText(text) : Promise.reject()).then(done).catch(() => { const t = document.createElement('textarea'); t.value = text; document.body.appendChild(t); t.select(); document.execCommand('copy'); t.remove(); done(); });
  });
  document.addEventListener('click', (e) => { const g = e.target.closest('[data-gotab]'); if (g) { tab = g.dataset.gotab; detailSig = ''; renderDetail(); } });
  function select(id) {
    selected = id; detailSig = '';
    renderJobs(); renderDetail();
    if (currentPage !== 'orders') go('orders');
  }

  // ---------- HUD (KPIs) ----------
  function renderHud(data, d) {
    const jobs = data.jobs, active = jobs.filter((j) => j.status !== 'done' && j.stage !== 'done');
    const done = jobs.filter((j) => j.status === 'done' || j.stage === 'done');
    const working = jobs.filter((j) => j.status === 'working').length, errs = jobs.filter((j) => j.status === 'error').length;
    const audio = jobs.reduce((n, j) => n + j.files.filter((f) => f.kind === 'audio').length, 0);
    const mins = done.map((j) => (new Date(j.updatedAt) - new Date(j.createdAt)) / 60000).filter((m) => m > 0 && m < 10000);
    const avg = mins.length ? Math.round(mins.reduce((a, b) => a + b, 0) / mins.length) : null;
    const k = (cls, label, v) => `<div class="kpi ${cls}"><small>${label}</small><b>${v}</b></div>`;
    $('hudKpis').innerHTML = k('', 'إجمالي المشاريع', jobs.length) + k('work', 'شغّال دلوقتي', working) + k('wait', 'مستني اعتمادك', d.ceo.approvals) + k('', 'في الطابور', active.length) + k('done', 'خلصت', done.length) + k('', 'مكالمات صوتية', audio) + k('', 'متوسط الزمن', avg == null ? '—' : avg + ' د') + (errs ? k('err', 'مشاكل', errs) : '');
  }

  // ---------- notice ----------
  function renderNotice(d) {
    const el = $('notice');
    if (demo) { el.innerHTML = '<b>وضع التجربة:</b> البيانات اللي قدامك تمثيلية عشان تشوف الوكلاء وهما بيتحركوا. مفيش حاجة حقيقية بتتنفذ.'; return; }
    const p = d.ceo.pending;
    el.innerHTML = p ? `<b>فيه ${p} حاجة مستنية التنفيذ.</b> روح للشات مع Claude وقول: «${RUN_CMD}».` : 'الموقع بيحفظ الشغل بس. التنفيذ الحقيقي (السماع والكتابة وتعبئة الفورم) بيتم لما تقول لـ Claude في الشات: «' + RUN_CMD + '».';
  }

  // ---------- state loop ----------
  // ---------- notifications ----------
  const NK = 'wfy.notifs.v1';
  let notifs = []; try { notifs = JSON.parse(localStorage.getItem(NK) || '[]'); } catch {}
  let prevJobs = null, prevHandled = null, chime = null;
  const saveN = () => { try { localStorage.setItem(NK, JSON.stringify(notifs.slice(0, 80))); } catch {} };
  const jn = (j) => '#' + (j.jobNumber || j.id);
  let quackAudio = null;
  function beep() {
    // real duck quack sample (public/quack.mp3), played twice: "quack quack"
    try {
      quackAudio = quackAudio || new Audio('quack.mp3'); quackAudio.volume = 1;
      const play = () => { const a = quackAudio.cloneNode(); a.volume = 1; return a.play(); };
      play().catch(() => {}); setTimeout(() => { try { play().catch(() => {}); } catch {} }, 330);
    } catch {}
  }
  function toast(n) {
    const t = document.createElement('div'); t.className = 'toast ' + (n.lvl || (n.good ? 'green' : 'yellow')); t.innerHTML = `<span class="ic">${n.ic}</span><div><b>${esc(n.title)}</b><small>${esc(n.sub || '')}</small></div>`;
    t.addEventListener('click', () => { openNotif(n); t.remove(); }); $('toasts').appendChild(t);
    setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 400); }, 7000);
  }
  function pushN(n, silent) {
    n.nid = Date.now() + '-' + Math.random().toString(36).slice(2, 6); n.ts = new Date().toISOString(); n.read = false; notifs.unshift(n); notifs = notifs.slice(0, 80); saveN(); renderN();
    if (silent) return; toast(n); beep(); $('btnBell').classList.remove('ring'); void $('btnBell').offsetWidth; $('btnBell').classList.add('ring');
    try { if (window.Notification && Notification.permission === 'granted') new Notification(n.title, { body: n.sub || '' }); } catch {}
  }
  function renderN() {
    const un = notifs.filter((x) => !x.read).length, bc = $('bellCount'); bc.textContent = un; bc.classList.toggle('hidden', !un);
    $('notifList').innerHTML = notifs.length ? notifs.map((n) => `<div class="nf ${n.lvl || (n.good ? 'green' : 'yellow')} ${n.read ? '' : 'unread'}" data-nid="${esc(n.nid)}"><span class="ic">${n.ic}</span><div><b>${esc(n.title)}</b><small>${esc(n.sub || '')} · ${hhmm(n.ts)}</small></div></div>`).join('') : '<div class="empty">مفيش إشعارات لسه. أول ما أوردر يتحرك هتلاقيه هنا.</div>';
  }
  function openNotif(n) { n.read = true; saveN(); renderN(); $('notifPanel').classList.add('hidden'); if (n.job && state.jobs.find((j) => j.id === n.job)) { tab = n.tab || 'overview'; select(n.job); } }
  const REC = /\.(mp3|wav|m4a|ogg|aac|flac|webm|mp4|mov|mkv|3gp|opus)$/i;
  function missingOf(j) { const m = []; if (!j.files.some((f) => f.kind === 'audio' || REC.test(f.name))) m.push('التسجيل الصوتي'); if (!j.files.some((f) => f.kind === 'image')) m.push('صور (سكرين شوتس / الفورم)'); return m; }
  function notifyDiff(data) {
    const cur = new Map(data.jobs.map((j) => [j.id, j])), handled = new Set((data.orders || []).filter((o) => o.handled).map((o) => o.id));
    if (!prevJobs) {
      prevJobs = new Map([...cur].map(([k, j]) => [k, { s: j.status, st: j.stage, pdf: j.outputs && j.outputs['report.pdf'] }])); prevHandled = handled;
      if (!notifs.length) data.jobs.filter((j) => j.status === 'waiting_approval').forEach((j) => pushN({ ic: '✅', lvl: 'green', title: `أوردر ${jn(j)} جاهز`, sub: 'المسودة في انتظار اعتمادك', job: j.id, tab: 'answers' }, true));
      return;
    }
    cur.forEach((j, id) => {
      const p = prevJobs.get(id), pdf = j.outputs && j.outputs['report.pdf'];
      if (!p) { const mf = missingOf(j); if (mf.length) pushN({ ic: '❗', lvl: 'red', title: `أوردر ${jn(j)} ناقصه ملفات`, sub: 'ناقص: ' + mf.join(' + '), job: id, tab: 'files' }); else pushN({ ic: '📥', lvl: 'yellow', title: `أوردر ${jn(j)} اتسجل`, sub: `${j.files.length} ملفات · في المراجعة`, job: id }); }
      else {
        if (j.status !== p.s) {
          if (j.status === 'working') pushN({ ic: '⚡', lvl: 'yellow', title: `أوردر ${jn(j)} في المراجعة`, sub: j.task || 'Claude شغال عليه', job: id });
          else if (j.status === 'saved') pushN({ ic: '💾', lvl: 'green', title: `أوردر ${jn(j)} اتحفظ على Ipsos`, sub: 'الاستمارة محفوظة. فاضل إنك تدخل وتراجعها', job: id });
          else if (j.status === 'waiting_approval') pushN({ ic: '✅', lvl: 'green', title: `أوردر ${jn(j)} جاهز`, sub: 'المسودة جاهزة وبتستنى اعتمادك', job: id, tab: 'answers' });
          else if (j.status === 'done') pushN({ ic: '🏁', lvl: 'green', title: `أوردر ${jn(j)} اتسلّم`, sub: 'الـ PDF جاهز', job: id, tab: 'report' });
          else if (j.status === 'error') pushN({ ic: '⚠️', lvl: 'red', title: `مشكلة في أوردر ${jn(j)}`, sub: j.task || 'محتاج مراجعة', job: id });
        }
        if (pdf && pdf !== p.pdf) pushN({ ic: '📄', lvl: 'green', title: `PDF أوردر ${jn(j)} اتحدّث`, sub: 'افتحه من تاب التقرير', job: id, tab: 'report' });
      }
      prevJobs.set(id, { s: j.status, st: j.stage, pdf });
    });
    (data.orders || []).filter((o) => o.handled && !prevHandled.has(o.id)).forEach((o) => pushN({ ic: '💬', lvl: 'yellow', title: 'رد Claude على أمرك', sub: (o.reply || '').slice(0, 90), job: o.jobId || null }));
    prevHandled = handled;
  }
  $('btnBell').addEventListener('click', (e) => {
    e.stopPropagation(); $('notifPanel').classList.toggle('hidden');
    try { if (window.Notification && Notification.permission === 'default') Notification.requestPermission(); } catch {}
  });
  $('notifReadAll').addEventListener('click', () => { notifs.forEach((n) => (n.read = true)); saveN(); renderN(); });
  $('notifList').addEventListener('click', (e) => { const el = e.target.closest('.nf'); if (!el) return; const n = notifs.find((x) => x.nid === el.dataset.nid); if (n) openNotif(n); });
  document.addEventListener('click', (e) => { if (!e.target.closest('#notifPanel,#btnBell')) $('notifPanel').classList.add('hidden'); });
  renderN();

  function apply(data) {
    state = data;
    if (!demo) notifyDiff(data);
    const nc = $('navCount'); if (nc) nc.textContent = (data.jobs || []).length;
    const d = derive(data);
    renderAgents(d); renderJobs(); renderChat(); renderDetail(); renderNotice(d); renderHud(data, d);
    window.Office.update({ jobs: data.jobs, agents: d.agents, ceo: d.ceo });
  }
  async function poll() {
    if (demo || uploading) return;
    try { apply(await (await api('/api/state')).json()); }
    catch { $('notice').innerHTML = '<b>السيرفر مش شغال.</b> شغّله تاني من start.bat.'; }
  }

  // ---------- demo mode ----------
  function startDemo() {
    demo = true; $('demoBadge').classList.remove('hidden'); $('btnDemo').textContent = '■ إيقاف التجربة';
    const mk = (n, name, stage) => ({ id: 'job-demo' + n, name, notes: 'تجربة', createdAt: new Date().toISOString(), stage, status: 'working', agent: null, task: '', progress: null, updatedAt: new Date().toISOString(), files: [], outputs: {}, log: [], demo: true });
    demoJobs = [mk(1, 'مكالمة عميل 1', 'received'), mk(2, 'مكالمة عميل 2', 'listening'), mk(3, 'مكالمة عميل 3', 'forms'), mk(4, 'مكالمة عميل 4', 'review')];
    const TASKS = { received: 'بستلم الملفات وأرتبها', listening: 'براجع المكالمة وأتأكد من الرقم', forms: 'بكتب بيانات الفورم', review: 'براجع الشغل النهائي', approval: 'مستني اعتماد المدير' };
    const tick = () => {
      demoJobs.forEach((j) => {
        const i = STAGE_ORDER.indexOf(j.stage);
        if (j.stage === 'done') { if (Math.random() < 0.25) { j.stage = 'received'; j.status = 'working'; } return; }
        j.status = j.stage === 'approval' ? 'waiting_approval' : 'working'; j.task = TASKS[j.stage]; j.agent = (AGENTS.find((a) => a.stage === j.stage) || {}).id;
        if (Math.random() < 0.6) { j.stage = STAGE_ORDER[i + 1]; j.status = j.stage === 'done' ? 'done' : (j.stage === 'approval' ? 'waiting_approval' : 'working'); j.task = TASKS[j.stage] || ''; j.agent = (AGENTS.find((a) => a.stage === j.stage) || {}).id || null; }
      });
      apply({ jobs: demoJobs, orders: [], serverTime: new Date().toISOString() });
    };
    tick(); demoTimer = setInterval(tick, 4500);
  }
  function stopDemo() {
    demo = false; clearInterval(demoTimer); selected = selected && selected.startsWith('job-demo') ? null : selected;
    $('demoBadge').classList.add('hidden'); $('btnDemo').textContent = '▶ تجربة العرض'; poll();
  }

  // ---------- upload ----------
  function renderPicked() {
    $('picked').innerHTML = picked.map((f, i) => {
      const isImg = /^image\//.test(f.type);
      const th = isImg ? `<img src="${URL.createObjectURL(f)}" alt="">` : `<div class="ic">${/^audio|^video/.test(f.type) ? '🎧' : '📄'}</div>`;
      return `<div class="pk">${th}<button type="button" data-rm="${i}" title="شيل">×</button><div class="nm">${esc(f.name)}</div><div class="sz">${fmtSize(f.size)}</div></div>`;
    }).join('');
  }
  function addFiles(list) { picked = picked.concat([...list]); renderPicked(); }
  function xhrUpload(jobId, file, onProg) {
    return new Promise((resolve, reject) => {
      const x = new XMLHttpRequest();
      x.open('POST', `/api/jobs/${encodeURIComponent(jobId)}/upload?name=${encodeURIComponent(file.name)}`);
      x.upload.onprogress = (e) => { if (e.lengthComputable) onProg(e.loaded / e.total); };
      x.onload = () => (x.status < 300 ? resolve() : reject(new Error('upload ' + x.status)));
      x.onerror = () => reject(new Error('network'));
      x.send(file);
    });
  }
  // ---------- delivery ducks ----------
  const WORK_MS = 5 * 60 * 1000;
  let dl = { id: null, phase: 'idle', t0: 0, timer: null };
  function dlSet(frac, txt, sub) {
    const lane = $('dlRun').parentElement, max = Math.max(0, lane.clientWidth - 190);
    $('dlRun').style.left = Math.round(max * Math.min(1, frac)) + 'px';
    $('dlText').innerHTML = esc(txt) + (sub ? `<small>${esc(sub)}</small>` : '');
  }
  function dlStart() {
    clearInterval(dl.timer); dl = { id: null, phase: 'carry', t0: Date.now(), timer: null };
    const d = $('deliver'); d.classList.remove('hidden', 'done'); $('dlEnd').classList.remove('arrived'); $('dlGo').classList.add('hidden');
    $('dlBar').style.width = '0%'; dlSet(0, 'البط شايل الملفات ورايح لـ Claude…', 'الشريط بيمشي مع نسبة الرفع');
  }
  function dlCarry(f) { $('dlBar').style.width = Math.round(f * 40) + '%'; dlSet(f * 0.8, `البط بيوصّل الملفات… ${Math.round(f * 100)}%`); }
  function dlArrived(id) {
    dl.id = id; dl.phase = 'work'; dl.t0 = Date.now(); $('dlEnd').classList.add('arrived'); $('dlGo').classList.remove('hidden');
    dlSet(1, 'وصل لـ Claude ✔ — روح للبطة الـ CEO في المكتب', 'Claude هياخده في الفحص الجاي. المدة التقريبية للشغل 5 دقايق.');
    clearInterval(dl.timer); dl.timer = setInterval(dlTick, 1000); dlTick();
  }
  function dlTick() {
    if (dl.phase !== 'work') return;
    const j = state && state.jobs.find((x) => x.id === dl.id), left = Math.max(0, WORK_MS - (Date.now() - dl.t0)), el = 1 - left / WORK_MS;
    const mm = String(Math.floor(left / 60000)).padStart(1, '0') + ':' + String(Math.floor(left / 1000) % 60).padStart(2, '0');
    if (j && (j.status === 'waiting_approval' || j.status === 'done') && Date.now() - dl.t0 > 5000 && j.updatedAt && Date.parse(j.updatedAt) > dl.t0) {
      dl.phase = 'done'; clearInterval(dl.timer); $('deliver').classList.add('done'); $('dlBar').style.width = '100%';
      dlSet(1, 'الشغل خلص ✔ — المسودة جاهزة في صفحة الأوردرات', ''); return;
    }
    $('dlBar').style.width = (40 + Math.min(1, el) * 60) + '%';
    const working = j && j.status === 'working';
    $('dlText').innerHTML = (working ? '⚡ Claude شغال دلوقتي' : '✔ وصل لـ Claude — في الطابور') + `<small>الوقت المتبقي التقريبي ${mm} (حوالي 5 دقايق)</small>`;
  }
  async function submitUpload(e) {
    e.preventDefault();
    if (demo) { alert('وقّف وضع التجربة الأول.'); return; }
    if (!picked.length) { alert('اختار ملف واحد على الأقل.'); return; }
    uploading = true; $('upBtn').disabled = true; dlStart();
    const prog = $('upProgress'); prog.innerHTML = '';
    try {
      let id = $('upTarget').value;
      if (id === 'new') {
        const num = String($('upJobNo').value || '').trim().replace(/[^A-Za-z0-9_-]/g, '');
        const ex = num && state.jobs.find((x) => x.id === 'job-' + num || x.jobNumber === num);
        if (ex) {
          id = ex.id;
          prog.insertAdjacentHTML('beforeend', '<div class="ln">الأوردر ' + esc(num) + ' موجود، هضيف الملفات عليه.</div>');
        } else {
          const j = await (await api('/api/jobs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jobNumber: $('upJobNo').value, name: $('upName').value || ('Job ' + $('upJobNo').value), notes: $('upNotes').value }) })).json();
          id = j.id;
        }
      }
      let doneN = 0; const totalN = picked.length;
      for (const f of picked) {
        const row = document.createElement('div');
        row.innerHTML = `<div class="ln">${esc(f.name)}</div><div class="bar"><i></i></div>`; prog.appendChild(row);
        await xhrUpload(id, f, (p) => { row.querySelector('i').style.width = Math.round(p * 100) + '%'; dlCarry((doneN + p) / totalN); });
        doneN++;
        row.querySelector('i').style.width = '100%';
      }
      picked = []; renderPicked(); $('upJobNo').value = ''; $('upName').value = ''; $('upNotes').value = '';
      const jn = (state.jobs.find((x) => x.id === id) || {}).jobNumber || id;
      try { await api('/api/orders', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: `اشتغل على الأوردر ${jn}: اسمع التسجيل وجهّز الفورم والـ PDF.`, jobId: id }) }); } catch {}
      prog.insertAdjacentHTML('beforeend', '<div class="ln">✔ اتبعت لـ Claude. الأوردر في الطابور وهيظهر رده في المكتب أول ما ياخده.</div>');
      dlArrived(id); uploading = false; await poll();
    } catch (err) {
      dl.phase = 'error'; clearInterval(dl.timer); $('deliver').classList.add('done'); $('dlText').textContent = 'الرفع فشل — جرّب تاني.';
      prog.insertAdjacentHTML('beforeend', `<div class="ln" style="color:#b91c1c">فشل الرفع: ${esc(err.message)}</div>`);
    } finally { uploading = false; $('upBtn').disabled = false; }
  }

  // ---------- CEO orders ----------
  async function sendOrder(e) {
    e.preventDefault();
    const text = $('orderText').value.trim(); if (!text) return;
    if (demo) { alert('وقّف وضع التجربة الأول.'); return; }
    try {
      await api('/api/orders', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text, jobId: selected && !selected.startsWith('job-demo') ? selected : null }) });
      $('orderText').value = ''; poll();
    } catch { alert('الأمر ماتبعتش. اتأكد إن السيرفر شغال.'); }
  }

  // ---------- pages ----------
  let currentPage = 'office';
  const PAGES = ['office', 'orders', 'upload'];
  function moveInk() {
    const a = document.querySelector('#nav a.on'), ink = $('navInk');
    if (a && ink) { ink.style.width = a.offsetWidth + 'px'; ink.style.transform = `translateX(${a.offsetLeft - 4}px)`; ink.style.left = '4px'; }
  }
  function go(p, push = true) {
    if (!PAGES.includes(p)) p = 'office';
    currentPage = p;
    PAGES.forEach((x) => $('page-' + x).classList.toggle('on', x === p));
    document.querySelectorAll('#nav a').forEach((a) => a.classList.toggle('on', a.dataset.page === p));
    if (push && location.hash !== '#' + p) history.replaceState(null, '', '#' + p);
    moveInk();
    window.scrollTo({ top: 0, behavior: 'smooth' });
    window.dispatchEvent(new CustomEvent('wfy:page', { detail: p }));
    window.dispatchEvent(new Event('resize'));
  }
  document.querySelectorAll('#nav a').forEach((a) => a.addEventListener('click', (e) => { e.preventDefault(); go(a.dataset.page); }));
  window.addEventListener('hashchange', () => go(location.hash.slice(1), false));
  window.addEventListener('resize', moveInk);
  document.addEventListener('click', async (e) => {
    const rm = e.target.closest('[data-rm]');
    if (rm) { picked.splice(+rm.dataset.rm, 1); renderPicked(); return; }
    const b = e.target.closest('[data-copyimg]'); if (!b) return;
    const old = b.textContent;
    try {
      const blob = await (await fetch(b.dataset.copyimg)).blob();
      const png = blob.type === 'image/png' ? blob : await new Promise((res) => { const im = new Image(); im.onload = () => { const c = document.createElement('canvas'); c.width = im.naturalWidth; c.height = im.naturalHeight; c.getContext('2d').drawImage(im, 0, 0); c.toBlob(res, 'image/png'); }; im.src = URL.createObjectURL(blob); });
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]);
      b.textContent = '✔ اتنسخت';
    } catch { b.textContent = 'فشل النسخ'; }
    setTimeout(() => (b.textContent = old), 1600);
  });
  document.addEventListener('paste', (e) => {
    if (currentPage !== 'upload') return;
    const fs = [...(e.clipboardData?.files || [])]; if (fs.length) { e.preventDefault(); addFiles(fs.map((f, i) => f.name === 'image.png' ? new File([f], `pasted-${Date.now()}-${i}.png`, { type: f.type }) : f)); }
  });

  // ---------- in-site Excel ----------
  let sheetTab = 'jobs', sheetData = { answers: [] };
  const STG = { received: 'استلام', listening: 'سماع', forms: 'فورم', review: 'مراجعة', approval: 'اعتماد', done: 'تم' };
  async function loadSheet() {
    const rows = [];
    for (const j of state.jobs.filter((x) => x.outputs && x.outputs['answers.json'])) {
      try {
        const r = await (await api(`/api/jobs/${encodeURIComponent(j.id)}/out/answers.json`)).json();
        Object.entries(r.answers || {}).forEach(([id, v]) => rows.push({ job: j, id, q: v.question || '', a: v.answer || '', why: v.why || v.note || '', second: v.second || '' }));
      } catch {}
    }
    sheetData.answers = rows; renderSheet();
  }
  function renderSheet() {
    const q = ($('sheetQ').value || '').trim().toLowerCase(), hit = (...v) => !q || v.join(' ').toLowerCase().includes(q);
    const head = (c) => `<tr><th class="num">#</th>${c.map((x) => `<th>${x}</th>`).join('')}</tr>`;
    let html = '';
    if (sheetTab === 'jobs') {
      const rs = state.jobs.filter((j) => hit(j.jobNumber, j.name, j.stage, j.status));
      html = head(['Job ID', 'الاسم', 'المرحلة', 'الحالة', 'التاريخ', 'ملفات', 'Yes', 'No', 'PDF']) + rs.map((j, i) => {
        const as = sheetData.answers.filter((a) => a.job.id === j.id), n = (v) => as.filter((a) => String(a.a).toLowerCase() === v).length;
        const pdf = j.outputs && j.outputs['report.pdf'] ? `<a href="/api/jobs/${encodeURIComponent(j.id)}/out/report.pdf" target="_blank" onclick="event.stopPropagation()">فتح PDF</a>` : '—';
        return `<tr class="clk" data-job="${esc(j.id)}"><td class="num">${i + 1}</td><td><b>${esc(j.jobNumber)}</b></td><td>${esc(j.name || '')}</td><td>${STG[j.stage] || j.stage}</td><td>${esc(j.status)}</td><td>${esc((j.createdAt || '').slice(0, 16).replace('T', ' '))}</td><td>${j.files.length}</td><td>${n('yes')}</td><td>${n('no')}</td><td>${pdf}</td></tr>`;
      }).join('');
    } else if (sheetTab === 'answers') {
      const rs = sheetData.answers.filter((a) => hit(a.job.jobNumber, a.id, a.q, a.a, a.why));
      html = head(['Job ID', 'السؤال', 'الإجابة', 'تفاصيل', 'ملاحظة']) + rs.map((a, i) => `<tr class="clk" data-job="${esc(a.job.id)}" data-tab="answers"><td class="num">${i + 1}</td><td>${esc(a.job.jobNumber)}</td><td dir="ltr" style="text-align:left">${esc(a.id)} — ${esc(a.q)}</td><td><b>${esc(a.a)}</b></td><td>${esc(a.second)}</td><td>${esc(a.why)}</td></tr>`).join('');
    } else {
      const rs = []; state.jobs.forEach((j) => j.files.forEach((f) => { if (hit(j.jobNumber, f.name)) rs.push([j, f]); }));
      html = head(['Job ID', 'الملف', 'النوع', 'الحجم']) + rs.map(([j, f], i) => `<tr class="clk" data-job="${esc(j.id)}" data-tab="files"><td class="num">${i + 1}</td><td>${esc(j.jobNumber)}</td><td>${esc(f.name)}</td><td>${f.kind}</td><td>${fmtSize(f.size)}</td></tr>`).join('');
    }
    $('sheetBody').innerHTML = `<table class="xl">${html}</table>`;
  }
  function openSheet() { $('sheet').classList.remove('hidden'); renderSheet(); loadSheet(); }
  $('dlGo').addEventListener('click', () => go('office'));
  $('btnSheet').addEventListener('click', openSheet);
  $('sheetClose').addEventListener('click', () => $('sheet').classList.add('hidden'));
  $('sheet').addEventListener('click', (e) => { if (e.target.id === 'sheet') $('sheet').classList.add('hidden'); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') $('sheet').classList.add('hidden'); });
  $('sheetQ').addEventListener('input', renderSheet);
  $('sheetTabs').addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; sheetTab = b.dataset.st; $('sheetTabs').querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b)); renderSheet(); });
  $('sheetBody').addEventListener('click', (e) => { const r = e.target.closest('tr[data-job]'); if (!r) return; tab = r.dataset.tab || 'report'; $('sheet').classList.add('hidden'); select(r.dataset.job); });

  // ---------- duck burst: click any empty spot ----------
  (function () {
    const layer = document.createElement('div'); layer.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:40;overflow:hidden'; document.body.appendChild(layer);
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    document.addEventListener('click', (e) => {
      if (reduce || e.target.closest('.card,button,a,input,select,textarea,label,.nav,.top,canvas,.sheet,.deliver,.notice,.notif,.toast,.job,.tab,summary')) return;
      const n = 16;
      for (let i = 0; i < n; i++) {
        const im = document.createElement('img'); im.src = 'duck.png'; const s = 28 + Math.random() * 34;
        im.style.cssText = `position:absolute;left:${e.clientX - s / 2}px;top:${e.clientY - s / 2}px;width:${s}px;height:${s}px;object-fit:contain;will-change:transform,opacity`;
        layer.appendChild(im);
        const ang = (Math.PI * 2 * i) / n + Math.random() * 0.4, d = 90 + Math.random() * 170, dx = Math.cos(ang) * d, dy = Math.sin(ang) * d - 60, rot = (Math.random() - 0.5) * 720;
        im.animate([
          { transform: 'translate(0,0) scale(.2) rotate(0deg)', opacity: 1 },
          { transform: `translate(${dx}px,${dy}px) scale(1) rotate(${rot / 2}deg)`, opacity: 1, offset: 0.55 },
          { transform: `translate(${dx * 1.1}px,${dy + 260 + Math.random() * 120}px) scale(.9) rotate(${rot}deg)`, opacity: 0 }
        ], { duration: 1300 + Math.random() * 700, easing: 'cubic-bezier(.2,.7,.4,1)' }).onfinish = () => im.remove();
      }
    });
  })();

  // ---------- wire up ----------
  window.Office.init($('office'), select);
  $('jobs').addEventListener('click', async (e) => {
    const el = e.target.closest('.job'); if (!el) return;
    if (e.target.closest('.job-actions')) {
      const id = el.dataset.id;
      const j = state.jobs.find((x) => x.id === id) || {};
      if (e.target.closest('.del-job')) {
        if (!confirm('تحذف الأوردر ' + (j.jobNumber ? '#' + j.jobNumber : id) + '؟ هيتنقل لسلة المحذوفات.')) return;
        try { await api('/api/jobs/' + encodeURIComponent(id), { method: 'DELETE' }); if (selected === id) selected = null; await poll(); } catch { alert('فشل الحذف'); }
      }
      return;
    }
    select(el.dataset.id);
  });
  $('jobs').addEventListener('change', async (e) => {
    const sel = e.target.closest && e.target.closest('.st-sel'); if (!sel) return;
    const id = sel.closest('.job').dataset.id;
    try { await api('/api/jobs/' + encodeURIComponent(id) + '/status', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: sel.value }) }); sel.blur(); await poll(); }
    catch { alert('فشل تغيير الحالة'); }
  });
  $('detailTabs').addEventListener('click', (e) => { const b = e.target.closest('.tab'); if (b) { tab = b.dataset.tab; detailSig = ''; renderDetail(); } });
  $('upTarget').addEventListener('change', refreshTargets);
  $('uploadForm').addEventListener('submit', submitUpload);
  $('orderForm').addEventListener('submit', sendOrder);
  $('orderText').addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) $('orderForm').requestSubmit(); });
  document.querySelectorAll('.chip').forEach((c) => c.addEventListener('click', () => { $('orderText').value = c.dataset.q; $('orderText').focus(); }));
  const drop = $('drop');
  drop.addEventListener('click', () => $('upFiles').click());
  $('upFiles').addEventListener('change', (e) => { addFiles(e.target.files); e.target.value = ''; });
  ['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('over'); }));
  drop.addEventListener('drop', (e) => addFiles(e.dataTransfer.files));
  let rot = false; $('btnRotate').addEventListener('click', () => { rot = !rot; window.Office.setAutoRotate(rot); $('btnRotate').classList.toggle('on', rot); });
  $('btnDemo').addEventListener('click', () => (demo ? stopDemo() : startDemo()));
  $('btnCopy').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(RUN_CMD); } catch {}
    const b = $('btnCopy'), old = b.textContent; b.textContent = '✔ اتنسخ'; setTimeout(() => (b.textContent = old), 1500);
  });

  setTimeout(() => go(location.hash.slice(1) || 'office', false), 0);
  poll(); setInterval(poll, 2000);
  if (/[?&]demo=1/.test(location.search)) startDemo();
})();
