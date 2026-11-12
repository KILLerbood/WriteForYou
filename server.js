// WriteForYou v1 — zero-dependency local server (plain Node.js)
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = __dirname;
const JOBS = path.join(ROOT, 'jobs');
const INBOX = path.join(ROOT, 'inbox');
const PUB = path.join(ROOT, 'public');
const DATA = path.join(ROOT, 'data');
const KNOW = path.join(ROOT, 'knowledge');
const PORT = parseInt(process.env.PORT || '3000', 10);
const MAX_UPLOAD = 2 * 1024 * 1024 * 1024; // 2GB per file

const STAGES = ['received', 'listening', 'forms', 'review', 'approval', 'done'];
const OUTPUTS = ['transcript.txt', 'call-review.json', 'answers.json', 'form-plan.md', 'log.jsonl', 'report.pdf'];
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.webp': 'image/webp', '.mp3': 'audio/mpeg', '.wav': 'audio/wav',
  '.m4a': 'audio/mp4', '.ogg': 'audio/ogg', '.aac': 'audio/aac', '.mp4': 'video/mp4',
  '.txt': 'text/plain; charset=utf-8', '.md': 'text/plain; charset=utf-8', '.jsonl': 'text/plain; charset=utf-8',
  '.pdf': 'application/pdf', '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
};

fs.mkdirSync(JOBS, { recursive: true });
fs.mkdirSync(INBOX, { recursive: true });
fs.mkdirSync(DATA, { recursive: true });

const readJSON = (p, fallback = null) => {
  try { return JSON.parse(fs.readFileSync(p, 'utf8').replace(/^﻿/, '')); } catch { return fallback; }
};
const writeJSON = (p, obj) => fs.writeFileSync(p, JSON.stringify(obj, null, 2));
const readJSONL = (p, limit = 200) => {
  try {
    const lines = fs.readFileSync(p, 'utf8').split(/\r?\n/).filter(Boolean);
    return lines.slice(-limit).map(l => { try { return JSON.parse(l); } catch { return { msg: l }; } });
  } catch { return []; }
};
const safeName = (n) => {
  let s = String(n || 'file').replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').replace(/^\.+/, '').trim();
  if (!s) s = 'file';
  return s.slice(0, 180);
};
const validId = (id) => /^job-[A-Za-z0-9_-]{6,60}$/.test(id || '');
const jobDir = (id) => path.join(JOBS, id);
const kindOf = (name) => {
  const e = path.extname(name).toLowerCase();
  if (['.mp3', '.wav', '.m4a', '.ogg', '.aac', '.flac', '.webm'].includes(e)) return 'audio';
  if (['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp'].includes(e)) return 'image';
  return 'other';
};
const send = (res, code, body, headers = {}) => {
  const isObj = typeof body === 'object' && !Buffer.isBuffer(body);
  res.writeHead(code, { 'Content-Type': isObj ? 'application/json; charset=utf-8' : 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  res.end(isObj ? JSON.stringify(body) : body);
};
const readBody = (req, limit = 1024 * 1024) => new Promise((resolve, reject) => {
  let size = 0; const chunks = [];
  req.on('data', c => { size += c.length; if (size > limit) { reject(new Error('too large')); req.destroy(); } else chunks.push(c); });
  req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
  req.on('error', reject);
});

function listFiles(id) {
  const dir = path.join(jobDir(id), 'files');
  try {
    return fs.readdirSync(dir, { withFileTypes: true }).filter(d => d.isFile()).map(d => {
      const st = fs.statSync(path.join(dir, d.name));
      return { name: d.name, size: st.size, kind: kindOf(d.name), mtime: st.mtimeMs };
    }).sort((a, b) => a.mtime - b.mtime);
  } catch { return []; }
}

function loadJob(id) {
  const dir = jobDir(id);
  const job = readJSON(path.join(dir, 'job.json'));
  if (!job) return null;
  const st = readJSON(path.join(dir, 'status.json'), {}) || {};
  const stage = STAGES.includes(st.stage) ? st.stage : (STAGES.includes(job.stage) ? job.stage : 'received');
  const outputs = {};
  for (const o of OUTPUTS) {
    try { outputs[o] = fs.statSync(path.join(dir, o)).mtimeMs; } catch { outputs[o] = 0; }
  }
  return {
    id: job.id, jobNumber: job.jobNumber || job.id.replace(/^job-/, ''), name: job.name, notes: job.notes || '', createdAt: job.createdAt,
    stage,
    status: st.status || job.status || 'queued',   // queued | working | waiting_approval | done | error
    agent: st.agent || null,
    task: st.task || '',
    progress: typeof st.progress === 'number' ? st.progress : null,
    updatedAt: st.updatedAt || job.createdAt,
    files: listFiles(id),
    outputs,
    log: readJSONL(path.join(dir, 'log.jsonl'), 100)
  };
}

function loadState() {
  let ids = [];
  try { ids = fs.readdirSync(JOBS, { withFileTypes: true }).filter(d => d.isDirectory() && validId(d.name)).map(d => d.name); } catch {}
  const jobs = ids.map(loadJob).filter(Boolean).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  const orders = readJSONL(path.join(INBOX, 'orders.jsonl'), 100);
  const handled = readJSONL(path.join(INBOX, 'handled.jsonl'), 200);
  const replies = new Map(handled.map(h => [h.id, h]));
  const ordersOut = orders.map(o => ({ ...o, handled: replies.has(o.id), reply: replies.get(o.id)?.reply || '', repliedAt: replies.get(o.id)?.ts || null }));
  return { jobs, orders: ordersOut, serverTime: new Date().toISOString() };
}

function newJobId() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `job-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}-${crypto.randomBytes(2).toString('hex')}`;
}

function serveFile(req, res, file, download = false) {
  let st;
  try { st = fs.statSync(file); if (!st.isFile()) throw 0; } catch { return send(res, 404, { error: 'not found' }); }
  const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
  const headers = { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-store' };
  if (download) headers['Content-Disposition'] = 'attachment';
  const range = req.headers.range;
  if (range) {
    const m = /bytes=(\d*)-(\d*)/.exec(range);
    let start = m && m[1] ? parseInt(m[1], 10) : 0;
    let end = m && m[2] ? parseInt(m[2], 10) : st.size - 1;
    if (isNaN(start) || isNaN(end) || start > end || start >= st.size) { res.writeHead(416, { 'Content-Range': `bytes */${st.size}` }); return res.end(); }
    end = Math.min(end, st.size - 1);
    res.writeHead(206, { ...headers, 'Content-Range': `bytes ${start}-${end}/${st.size}`, 'Content-Length': end - start + 1 });
    return fs.createReadStream(file, { start, end }).pipe(res);
  }
  res.writeHead(200, { ...headers, 'Content-Length': st.size });
  fs.createReadStream(file).pipe(res);
}

async function handleApi(req, res, u) {
  const parts = u.pathname.split('/').filter(Boolean); // ['api', ...]
  const m = req.method;

  if (m === 'POST' && parts[1] === 'github-push' && parts.length === 2) {
    const { execFile } = require('child_process');
    return execFile('cmd.exe', ['/c', path.join(__dirname, 'github-push.bat')], { cwd: __dirname, timeout: 120000, windowsHide: true }, (err, so, se) => {
      send(res, err ? 500 : 200, { ok: !err, output: String(so || '').slice(-2000), error: String(se || (err && err.message) || '').slice(-2000) });
    });
  }

  if (m === 'GET' && parts[1] === 'state' && parts.length === 2) return send(res, 200, loadState());

  if (m === 'POST' && parts[1] === 'jobs' && parts.length === 2) {
    let body = {};
    try { body = JSON.parse(await readBody(req)); } catch {}
    const name = String(body.name || '').trim().slice(0, 120) || 'مشروع بدون اسم';
    let jobNumber = String(body.jobNumber || '').trim().replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40);
    let id = jobNumber.length >= 3 ? 'job-' + jobNumber : newJobId();
    if (fs.existsSync(jobDir(id))) return send(res, 409, { error: 'Job ID موجود بالفعل' });
    const dir = jobDir(id);
    fs.mkdirSync(path.join(dir, 'files'), { recursive: true });
    const now = new Date().toISOString();
    writeJSON(path.join(dir, 'job.json'), { id, jobNumber: id.replace(/^job-/, ''), name, notes: String(body.notes || '').slice(0, 5000), createdAt: now, stage: 'received', status: 'queued' });
    writeJSON(path.join(dir, 'status.json'), { stage: 'received', status: 'queued', agent: 'intake', task: 'المشروع وصل وفي انتظار البدء', progress: 0, updatedAt: now });
    fs.appendFileSync(path.join(dir, 'log.jsonl'), JSON.stringify({ ts: now, agent: 'intake', level: 'info', msg: `استلمت المشروع: ${name}` }) + '\n');
    return send(res, 201, loadJob(id));
  }

  if (parts[1] === 'jobs' && parts[2] && validId(parts[2])) {
    const id = parts[2];
    if (!fs.existsSync(path.join(jobDir(id), 'job.json'))) return send(res, 404, { error: 'job not found' });

    if (m === 'GET' && parts.length === 3) return send(res, 200, loadJob(id));

    if (m === 'POST' && parts[3] === 'status' && parts.length === 4) {
      let body = {};
      try { body = JSON.parse(await readBody(req)); } catch {}
      const ALLOWED = ['queued', 'working', 'waiting_approval', 'saved', 'done', 'error'];
      const status = String(body.status || '');
      if (!ALLOWED.includes(status)) return send(res, 400, { error: 'bad status' });
      const sf = path.join(jobDir(id), 'status.json');
      const cur = readJSON(sf, {}) || {};
      const now = new Date().toISOString();
      const next = { ...cur, status, updatedAt: now };
      if (status === 'done') { next.stage = 'done'; next.progress = 100; }
      if (status === 'saved') { next.ipsosSaved = true; next.ipsosSavedAt = cur.ipsosSavedAt || now; }
      writeJSON(sf, next);
      fs.appendFileSync(path.join(jobDir(id), 'log.jsonl'), JSON.stringify({ ts: now, agent: 'user', level: 'info', msg: `الحالة اتغيّرت بإيدك من لوحة التحكم: ${status}` }) + '\n');
      return send(res, 200, loadJob(id));
    }

    if (m === 'DELETE' && parts.length === 3) {
      const trash = path.join(JOBS, '_trash');
      fs.mkdirSync(trash, { recursive: true });
      let dest = path.join(trash, id);
      if (fs.existsSync(dest)) dest = path.join(trash, id + '-' + Date.now());
      fs.renameSync(jobDir(id), dest);
      return send(res, 200, { ok: true, trashed: path.basename(dest) });
    }


    // Raw-body upload: POST /api/jobs/:id/upload?name=<file name>
    if (m === 'POST' && parts[3] === 'upload') {
      const name = safeName(u.searchParams.get('name'));
      const declared = parseInt(req.headers['content-length'] || '0', 10);
      if (declared > MAX_UPLOAD) return send(res, 413, { error: 'file too large' });
      const dir = path.join(jobDir(id), 'files');
      fs.mkdirSync(dir, { recursive: true });
      let target = path.join(dir, name);
      if (fs.existsSync(target)) {
        const ext = path.extname(name), base = path.basename(name, ext);
        target = path.join(dir, `${base}-${Date.now()}${ext}`);
      }
      const out = fs.createWriteStream(target);
      let written = 0, aborted = false;
      req.on('data', c => { written += c.length; if (written > MAX_UPLOAD && !aborted) { aborted = true; out.destroy(); req.destroy(); try { fs.unlinkSync(target); } catch {} } });
      req.pipe(out);
      out.on('finish', () => {
        if (aborted) return;
        const now = new Date().toISOString();
        fs.appendFileSync(path.join(jobDir(id), 'log.jsonl'), JSON.stringify({ ts: now, agent: 'intake', level: 'info', msg: `ملف جديد اترفع: ${path.basename(target)}` }) + '\n');
        send(res, 201, { ok: true, name: path.basename(target), size: written });
      });
      out.on('error', () => { if (!res.headersSent) send(res, 500, { error: 'write failed' }); });
      req.on('error', () => { try { out.destroy(); fs.unlinkSync(target); } catch {} });
      return;
    }

    if (m === 'GET' && parts[3] === 'files' && parts[4]) {
      const name = decodeURIComponent(parts.slice(4).join('/'));
      if (name.includes('..') || name.includes('/') || name.includes('\\')) return send(res, 400, { error: 'bad name' });
      return serveFile(req, res, path.join(jobDir(id), 'files', name));
    }

    if (m === 'GET' && parts[3] === 'out' && parts[4]) {
      const name = decodeURIComponent(parts[4]);
      if (!OUTPUTS.includes(name)) return send(res, 404, { error: 'unknown output' });
      const f = path.join(jobDir(id), name);
      if (!fs.existsSync(f)) return send(res, 404, { error: 'not written yet' });
      if (name.endsWith('.pdf')) return serveFile(req, res, f, u.searchParams.get('download') === '1');
      const buf = fs.readFileSync(f);
      const text = buf.length > 1024 * 1024 ? buf.slice(0, 1024 * 1024).toString('utf8') + '\n…(مقطوع)' : buf.toString('utf8');
      return send(res, 200, text.replace(/^﻿/, ''));
    }
  }

  if (m === 'GET' && parts[1] === 'excel') {
    const f = path.join(DATA, 'WriteForYou.xlsx');
    if (!fs.existsSync(f)) return send(res, 404, { error: 'ملف الإكسل لسه ماتعملش. بيتعمل لما Claude يعالج أول مشروع.' });
    return serveFile(req, res, f, true);
  }

  if (m === 'POST' && parts[1] === 'orders' && parts.length === 2) {
    let body = {};
    try { body = JSON.parse(await readBody(req)); } catch {}
    const text = String(body.text || '').trim().slice(0, 4000);
    if (!text) return send(res, 400, { error: 'empty order' });
    const jobId = validId(body.jobId) ? body.jobId : null;
    const order = { id: 'ord-' + Date.now().toString(36) + crypto.randomBytes(2).toString('hex'), ts: new Date().toISOString(), text, jobId };
    fs.appendFileSync(path.join(INBOX, 'orders.jsonl'), JSON.stringify(order) + '\n');
    return send(res, 201, order);
  }

  return send(res, 404, { error: 'not found' });
}

const server = http.createServer(async (req, res) => {
  try {
    const u = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    if (u.pathname.startsWith('/api/')) return await handleApi(req, res, u);
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method Not Allowed');
    if (u.pathname.startsWith('/knowledge/')) {
      const kf = path.normalize(path.join(KNOW, decodeURIComponent(u.pathname.slice(11))));
      if (!kf.startsWith(KNOW + path.sep)) return send(res, 403, 'Forbidden');
      return serveFile(req, res, kf);
    }
    let rel = decodeURIComponent(u.pathname);
    if (rel === '/') rel = '/index.html';
    const file = path.normalize(path.join(PUB, rel));
    if (!file.startsWith(PUB + path.sep)) return send(res, 403, 'Forbidden');
    return serveFile(req, res, file);
  } catch (e) {
    if (!res.headersSent) send(res, 500, { error: String(e && e.message || e) });
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`\n  WriteForYou شغال على:  http://localhost:${PORT}\n  (اقفل النافذة دي لإيقاف الموقع)\n`);
});
