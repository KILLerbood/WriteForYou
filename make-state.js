// يولّد state.json (نسخة ثابتة من حالة الموقع) لصفحة GitHub Pages
const fs = require('fs'), path = require('path');
const ROOT = __dirname, JOBS = path.join(ROOT, 'jobs'), INBOX = path.join(ROOT, 'inbox');
const STAGES = ['received', 'listening', 'forms', 'review', 'approval', 'done'];
const OUTPUTS = ['transcript.txt', 'call-review.json', 'answers.json', 'form-plan.md', 'log.jsonl', 'report.pdf'];
const readJSON = (p, f = null) => { try { return JSON.parse(fs.readFileSync(p, 'utf8').replace(/^﻿/, '')); } catch { return f; } };
const readJSONL = (p, limit = 200) => { try { return fs.readFileSync(p, 'utf8').split(/\r?\n/).filter(Boolean).slice(-limit).map(l => { try { return JSON.parse(l); } catch { return { msg: l }; } }); } catch { return []; } };
const kindOf = (n) => { const e = path.extname(n).toLowerCase(); if (['.mp3','.wav','.m4a','.ogg','.aac','.flac','.webm'].includes(e)) return 'audio'; if (['.png','.jpg','.jpeg','.gif','.webp','.bmp'].includes(e)) return 'image'; return 'other'; };
function listFiles(dir) { try { return fs.readdirSync(path.join(dir, 'files'), { withFileTypes: true }).filter(d => d.isFile()).map(d => { const st = fs.statSync(path.join(dir, 'files', d.name)); return { name: d.name, size: st.size, kind: kindOf(d.name), mtime: st.mtimeMs }; }).sort((a, b) => a.mtime - b.mtime); } catch { return []; } }
function loadJob(id) {
  const dir = path.join(JOBS, id); const job = readJSON(path.join(dir, 'job.json')); if (!job) return null;
  const st = readJSON(path.join(dir, 'status.json'), {}) || {};
  const stage = STAGES.includes(st.stage) ? st.stage : (STAGES.includes(job.stage) ? job.stage : 'received');
  const outputs = {}; for (const o of OUTPUTS) { try { outputs[o] = fs.statSync(path.join(dir, o)).mtimeMs; } catch { outputs[o] = 0; } }
  return { id: job.id, jobNumber: job.jobNumber || job.id.replace(/^job-/, ''), name: job.name, notes: job.notes || '', createdAt: job.createdAt, stage,
    status: st.status || job.status || 'queued', agent: st.agent || null, task: st.task || '', progress: typeof st.progress === 'number' ? st.progress : null,
    updatedAt: st.updatedAt || job.createdAt, files: listFiles(dir), outputs, log: readJSONL(path.join(dir, 'log.jsonl'), 100) };
}
let ids = []; try { ids = fs.readdirSync(JOBS, { withFileTypes: true }).filter(d => d.isDirectory() && /^job-[A-Za-z0-9_-]{6,60}$/.test(d.name)).map(d => d.name); } catch {}
const jobs = ids.map(loadJob).filter(Boolean).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
const orders = readJSONL(path.join(INBOX, 'orders.jsonl'), 100), handled = readJSONL(path.join(INBOX, 'handled.jsonl'), 200);
const rep = new Map(handled.map(h => [h.id, h]));
const ordersOut = orders.map(o => ({ ...o, handled: rep.has(o.id), reply: rep.get(o.id)?.reply || '', repliedAt: rep.get(o.id)?.ts || null }));
fs.writeFileSync(path.join(ROOT, 'state.json'), JSON.stringify({ jobs, orders: ordersOut, serverTime: new Date().toISOString() }));
console.log('state.json:', jobs.length, 'jobs');
