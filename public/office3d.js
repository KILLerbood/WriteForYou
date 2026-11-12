// WriteForYou — 3D cockpit office (three.js, dark, bloom)
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

const AGENTS = [
  { id: 'intake',   name: 'سارة', role: 'الاستقبال',         stage: 'received',  color: '#ff7a59', hair: 0x2a1b14 },
  { id: 'listener', name: 'سمير', role: 'مراجع المكالمات',   stage: 'listening', color: '#22d3b6', hair: 0x14110e },
  { id: 'former',   name: 'كريم', role: 'كاتب الفورم',       stage: 'forms',     color: '#a78bfa', hair: 0x3a2a1a },
  { id: 'reviewer', name: 'منى',  role: 'المراجعة النهائية', stage: 'review',    color: '#4aa8ff', hair: 0x101010 }
];
const DESKS = [
  { key: 'received',  name: 'الاستقبال',         color: '#ff7a59', agent: 'intake',   gx: -16, gz: -10 },
  { key: 'listening', name: 'مراجعة المكالمة',   color: '#22d3b6', agent: 'listener', gx: 0, gz: -10 },
  { key: 'forms',     name: 'كتابة الفورم',      color: '#a78bfa', agent: 'former',   gx: 16, gz: -10 },
  { key: 'review',    name: 'المراجعة النهائية', color: '#4aa8ff', agent: 'reviewer', gx: 16, gz: 10 },
  { key: 'approval',  name: 'الاعتماد · CEO',    color: '#fbbf24', agent: null,       gx: 0, gz: 10 },
  { key: 'done',      name: 'تم ✔',              color: '#34d399', agent: null,       gx: -16, gz: 10 }
];
window.WFY = { AGENTS, DESKS };

const STATE_COLOR = { working: '#22c55e', waiting: '#f59e0b', idle: '#64748b', error: '#ef4444' };
const STATUS_COLOR = { working: '#22c55e', queued: '#f59e0b', waiting_approval: '#fbbf24', saved: '#16a34a', done: '#38bdf8', error: '#ef4444' };
const STATUS_AR = { queued: 'في الانتظار', working: 'شغال', waiting_approval: 'مستني اعتماد', saved: 'اتحفظ على Ipsos', done: 'خلص', error: 'مشكلة' };
const FONT = '"Segoe UI", Tahoma, Arial, sans-serif';
const ROOM_W = 9, ROOM_D = 7, LANE_BACK = -5.2, LANE_FRONT = 13.8, CORRIDOR = 8;

let renderer, scene, camera, controls, composer, bloom, canvas, host;
let onSelect = null, ready = false, failed = false;
const rooms = {}, actors = {}, cards = new Map(), pulses = [];
let derived = {}, ceoInfo = { pending: 0, approvals: 0, anyWork: false };
let brain, brainLabel, firstSync = true, seq = 0, hoverCard = null;
let t = 0, lastTs = 0, monitorTimer = 0, autoRotate = false;
const hist = {}; DESKS.forEach((d) => { hist[d.key] = []; });
const raycaster = new THREE.Raycaster(), mouse = new THREE.Vector2();

const col = (c) => new THREE.Color(c);
const deskByKey = Object.fromEntries(DESKS.map((d) => [d.key, d]));

// ---------- text helpers ----------
function textCanvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d'); g.direction = 'rtl'; return [c, g]; }
function fitText(g, text, maxW) { let s = String(text); while (g.measureText(s).width > maxW && s.length > 3) s = s.slice(0, -2); return s === String(text) ? s : s + '…'; }
function roundRect(g, x, y, w, h, r) { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }
function makeSprite(w, h, scaleX) {
  const [c, g] = textCanvas(w, h); const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, toneMapped: false }));
  sp.scale.set(scaleX, scaleX * h / w, 1); sp.userData = { c, g, tex, key: '' }; return sp;
}
function drawTag(sp, lines, accent, state) {
  const key = lines.join('|') + accent + state; if (sp.userData.key === key) return; sp.userData.key = key;
  const { c, g, tex } = sp.userData; g.clearRect(0, 0, c.width, c.height);
  roundRect(g, 4, 4, c.width - 8, c.height - 8, 22); g.fillStyle = 'rgba(8,12,30,.82)'; g.fill(); g.lineWidth = 3; g.strokeStyle = accent; g.stroke();
  g.textAlign = 'center'; g.fillStyle = '#fff'; g.font = `bold ${lines.length > 1 ? 46 : 52}px ${FONT}`;
  g.fillText(fitText(g, lines[0], c.width - 90), c.width / 2, lines.length > 1 ? c.height * 0.46 : c.height * 0.64);
  if (lines[1]) { g.font = `32px ${FONT}`; g.fillStyle = '#9fb0d8'; g.fillText(fitText(g, lines[1], c.width - 90), c.width / 2, c.height * 0.8); }
  if (state) { g.fillStyle = state; g.beginPath(); g.arc(c.width - 34, 34, 11, 0, 7); g.fill(); }
  tex.needsUpdate = true;
}
function drawBubble(sp, text, accent) {
  const key = text + accent; if (sp.userData.key === key) return; sp.userData.key = key;
  const { c, g, tex } = sp.userData; g.clearRect(0, 0, c.width, c.height);
  roundRect(g, 6, 6, c.width - 12, c.height - 30, 24); g.fillStyle = 'rgba(255,255,255,.96)'; g.fill();
  g.beginPath(); g.moveTo(c.width / 2 - 16, c.height - 25); g.lineTo(c.width / 2, c.height - 4); g.lineTo(c.width / 2 + 16, c.height - 25); g.fill();
  g.lineWidth = 4; g.strokeStyle = accent; roundRect(g, 6, 6, c.width - 12, c.height - 30, 24); g.stroke();
  g.textAlign = 'center'; g.fillStyle = '#0f172a'; g.font = `bold 38px ${FONT}`; g.fillText(fitText(g, text, c.width - 70), c.width / 2, (c.height - 30) / 2 + 14);
  tex.needsUpdate = true;
}

// ---------- monitor (wall dashboard) ----------
function drawMonitor(room, time) {
  const { c, g, tex } = room.mon; const d = room.desk, W = c.width, H = c.height;
  const st = room.stats || { n: 0, work: 0, wait: 0, done: 0 };
  const grad = g.createLinearGradient(0, 0, W, H); grad.addColorStop(0, '#070b1c'); grad.addColorStop(1, '#101a3c');
  g.fillStyle = grad; g.fillRect(0, 0, W, H);
  g.strokeStyle = d.color + '55'; g.lineWidth = 1; for (let x = 0; x < W; x += 40) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, H); g.stroke(); }
  g.textAlign = 'right'; g.fillStyle = d.color; g.font = `bold 46px ${FONT}`; g.fillText(d.name, W - 28, 62);
  g.fillStyle = '#7f90bd'; g.font = `26px ${FONT}`; const ag = AGENTS.find((a) => a.id === d.agent); g.fillText(ag ? `${ag.name} · ${ag.role}` : (d.key === 'approval' ? 'مراجعة واعتماد المدير' : 'الأرشيف'), W - 28, 98);
  g.textAlign = 'left'; g.fillStyle = '#fff'; g.font = `bold 118px ${FONT}`; g.fillText(String(st.n), 30, 128);
  g.fillStyle = '#7f90bd'; g.font = `24px ${FONT}`; g.fillText('مشروع', 34, 160);
  const pill = (x, label, v, color) => { g.fillStyle = color + '33'; roundRect(g, x, 112, 118, 48, 12); g.fill(); g.strokeStyle = color; g.lineWidth = 2; g.stroke(); g.textAlign = 'center'; g.fillStyle = color; g.font = `bold 26px ${FONT}`; g.fillText(`${label} ${v}`, x + 59, 145); };
  pill(W - 396, 'شغال', st.work, '#22c55e'); pill(W - 266, 'مستني', st.wait, '#f59e0b'); pill(W - 136, 'خلص', st.done, '#38bdf8');
  const h = hist[d.key], bx = 30, by = 176, bw = W - 60, bh = 46;
  g.fillStyle = '#ffffff10'; g.fillRect(bx, by, bw, bh);
  if (h.length > 1) {
    const mx = Math.max(2, ...h); g.beginPath(); g.moveTo(bx, by + bh);
    h.forEach((v, i) => g.lineTo(bx + bw * i / (h.length - 1), by + bh - (v / mx) * (bh - 6)));
    g.lineTo(bx + bw, by + bh); g.closePath(); g.fillStyle = d.color + '44'; g.fill();
    g.beginPath(); h.forEach((v, i) => { const x = bx + bw * i / (h.length - 1), y = by + bh - (v / mx) * (bh - 6); i ? g.lineTo(x, y) : g.moveTo(x, y); }); g.strokeStyle = d.color; g.lineWidth = 3; g.stroke();
  }
  const sy = (time * 60) % H; g.fillStyle = '#ffffff12'; g.fillRect(0, sy, W, 3);
  g.fillStyle = st.work ? '#22c55e' : '#475569'; g.beginPath(); g.arc(W - 22, H - 18, 7, 0, 7); g.fill();
  tex.needsUpdate = true;
}

// ---------- build scene (warm realistic office) ----------
const WOOD = '#b98a5e', WOOD_D = '#8a6240', CREAM = '#f6efe0', WHITE = '#f4f4f2', GREY = '#4b5563';
const std = (color, o = {}) => new THREE.MeshStandardMaterial(Object.assign({ color, roughness: 0.7, metalness: 0.05 }, o));
function box(w, h, d, mat, x, y, z, parent, shadow = true) { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.position.set(x, y, z); m.castShadow = shadow; m.receiveShadow = true; parent.add(m); return m; }
function cyl(rt, rb, h, mat, x, y, z, parent, seg = 20) { const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), mat); m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true; parent.add(m); return m; }
function plant(parent, x, z, s = 1) {
  const pot = cyl(0.28 * s, 0.22 * s, 0.45 * s, std('#e8e2d4'), x, 0.42 * s, z, parent);
  const leaf = std('#3f8f4f', { roughness: 0.85 });
  for (let i = 0; i < 7; i++) { const m = new THREE.Mesh(new THREE.SphereGeometry(0.26 * s, 12, 10), leaf); m.scale.set(1, 1.5, 1); m.position.set(x + Math.cos(i * 0.9) * 0.2 * s, 0.95 * s + (i % 3) * 0.15 * s, z + Math.sin(i * 0.9) * 0.2 * s); m.castShadow = true; parent.add(m); }
}
function screenCanvas(color) {
  const c = document.createElement('canvas'); c.width = 256; c.height = 160; const g = c.getContext('2d');
  g.fillStyle = '#0f172a'; g.fillRect(0, 0, 256, 160); g.fillStyle = color; g.fillRect(0, 0, 256, 16);
  for (let i = 0; i < 9; i++) { g.fillStyle = i % 3 === 0 ? color : '#94a3b8'; g.globalAlpha = 0.85; g.fillRect(14 + (i % 3) * 10, 30 + i * 14, 40 + ((i * 53) % 150), 6); }
  g.globalAlpha = 1; const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
function buildRoom(d) {
  const accent = col(d.color), g = new THREE.Group(), r = { desk: d, group: g, slots: [] };
  g.position.set(d.gx, 0, d.gz); r.back = d.gz < 0;
  // floor: wood + coloured rug
  const floor = box(ROOM_W, 0.2, ROOM_D, std(WOOD, { roughness: 0.55 }), 0, 0.1, 0, g, false);
  for (let i = -4; i <= 4; i++) { const line = new THREE.Mesh(new THREE.PlaneGeometry(0.02, ROOM_D), new THREE.MeshBasicMaterial({ color: WOOD_D, transparent: true, opacity: 0.35 })); line.rotation.x = -Math.PI / 2; line.position.set(i * 1.0, 0.205, 0); g.add(line); }
  const rug = new THREE.Mesh(new THREE.PlaneGeometry(6.2, 4.2), new THREE.MeshStandardMaterial({ color: accent.clone().lerp(col('#ffffff'), 0.35), roughness: 1 })); rug.rotation.x = -Math.PI / 2; rug.position.set(0, 0.215, 0.2); rug.receiveShadow = true; g.add(rug);
  const glow = new THREE.Mesh(new THREE.PlaneGeometry(ROOM_W - 0.4, ROOM_D - 0.4), new THREE.MeshBasicMaterial({ color: accent, transparent: true, opacity: 0.06, depthWrite: false })); glow.rotation.x = -Math.PI / 2; glow.position.y = 0.23; g.add(glow); r.glow = glow;
  const edge = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(ROOM_W, 0.2, ROOM_D)), new THREE.LineBasicMaterial({ color: accent })); edge.position.y = 0.1; g.add(edge); r.edge = edge;
  // walls: solid back, glass sides with frames
  const wallMat = std(CREAM, { roughness: 0.9 });
  box(ROOM_W, 3.6, 0.2, wallMat, 0, 2.0, -ROOM_D / 2 + 0.1, g);
  box(ROOM_W, 0.5, 0.22, std(WOOD_D), 0, 0.45, -ROOM_D / 2 + 0.11, g);
  box(ROOM_W, 0.12, 0.26, new THREE.MeshStandardMaterial({ color: accent, roughness: 0.4 }), 0, 3.82, -ROOM_D / 2 + 0.11, g);
  const glass = new THREE.MeshPhysicalMaterial({ color: '#cfe8ff', transparent: true, opacity: 0.16, roughness: 0.05, metalness: 0, side: THREE.DoubleSide, depthWrite: false });
  [-1, 1].forEach((s) => {
    const gl = new THREE.Mesh(new THREE.BoxGeometry(0.06, 3.4, ROOM_D - 0.2), glass); gl.position.set(s * (ROOM_W / 2 - 0.05), 1.9, 0); g.add(gl);
    [-ROOM_D / 2 + 0.2, 0, ROOM_D / 2 - 0.1].forEach((z) => box(0.12, 3.5, 0.12, std('#d6d9de', { metalness: 0.6, roughness: 0.3 }), s * (ROOM_W / 2 - 0.05), 1.85, z, g));
    box(0.12, 0.1, ROOM_D, std('#d6d9de', { metalness: 0.6, roughness: 0.3 }), s * (ROOM_W / 2 - 0.05), 3.62, 0, g);
  });
  // wall dashboard (screen on wall)
  const [mc, mg] = textCanvas(640, 240); const mtex = new THREE.CanvasTexture(mc); mtex.colorSpace = THREE.SRGBColorSpace;
  box(6.7, 2.6, 0.12, std('#111827', { roughness: 0.4 }), 0, 2.45, -ROOM_D / 2 + 0.27, g);
  const mon = new THREE.Mesh(new THREE.PlaneGeometry(6.4, 2.4), new THREE.MeshBasicMaterial({ map: mtex, toneMapped: false })); mon.position.set(0, 2.45, -ROOM_D / 2 + 0.34); g.add(mon);
  r.mon = { c: mc, g: mg, tex: mtex };
  // ceiling lamp (visual) + light
  const lamp = cyl(0.5, 0.5, 0.12, std('#ffffff', { emissive: '#fff1c9', emissiveIntensity: 0.7 }), 0, 4.15, 0.6, g); box(0.04, 0.6, 0.04, std(GREY), 0, 4.45, 0.6, g, false);
  const pl = new THREE.PointLight('#ffe8c2', 14, 14, 1.8); pl.position.set(0, 3.7, 0.6); g.add(pl); r.lamp = pl;
  // "live" beacon: a soft column of light + a badge that appear only while this room is working
  const bm = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 2.2, 7, 24, 1, true), new THREE.MeshBasicMaterial({ color: accent, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending }));
  bm.position.y = 3.6; g.add(bm); r.beacon = bm;
  const lv = makeSprite(300, 80, 2.8); lv.position.set(0, 7.6, 0); lv.visible = false; g.add(lv); r.live = lv;
  plant(g, -ROOM_W / 2 + 0.7, -ROOM_D / 2 + 0.7, 1.3);
  const wood = std(WOOD_D, { roughness: 0.5 }), white = std(WHITE, { roughness: 0.5 }), dark = std('#1f2937', { roughness: 0.4, metalness: 0.3 });
  if (d.agent) {
    // desk with two monitors
    box(3.8, 0.12, 1.6, wood, 0, 1.05, -1.7, g); box(0.1, 1.0, 1.4, white, -1.75, 0.55, -1.7, g); box(0.1, 1.0, 1.4, white, 1.75, 0.55, -1.7, g); box(3.5, 0.5, 0.06, white, 0, 0.8, -2.4, g);
    const tex = screenCanvas(d.color); r.screenTex = tex;
    [-0.78, 0.78].forEach((x, i) => {
      box(1.4, 0.85, 0.07, dark, x, 1.72, -2.25, g); box(0.12, 0.35, 0.1, dark, x, 1.3, -2.25, g);
      const sc = new THREE.Mesh(new THREE.PlaneGeometry(1.3, 0.75), new THREE.MeshBasicMaterial({ map: tex, color: '#6b7280', toneMapped: false })); sc.position.set(x, 1.72, -2.2); sc.rotation.y = x < 0 ? 0.12 : -0.12; g.add(sc); if (i === 0) r.screen = sc; else r.screen2 = sc;
    });
    box(1.0, 0.04, 0.34, std('#d1d5db'), 0, 1.13, -1.4, g); cyl(0.12, 0.1, 0.18, std('#ffffff'), 1.4, 1.2, -1.45, g);
    // chair
    const cm = std('#374151', { roughness: 0.8 });
    box(0.95, 0.14, 0.9, cm, 0, 0.78, -0.35, g); box(0.95, 0.95, 0.12, cm, 0, 1.3, 0.15, g); cyl(0.06, 0.06, 0.5, dark, 0, 0.5, -0.35, g);
    for (let i = 0; i < 5; i++) { const a = i * 1.2566; const leg = box(0.7, 0.05, 0.07, dark, Math.cos(a) * 0.3, 0.25, -0.35 + Math.sin(a) * 0.3, g, false); leg.rotation.y = -a; }
    // bookshelf on the side
    box(0.5, 2.2, 1.8, wood, ROOM_W / 2 - 0.9, 1.2, -1.2, g);
    ['#ef4444', '#facc15', '#38bdf8', '#22c55e', '#f97316'].forEach((c, i) => box(0.3, 0.45, 0.12, std(c), ROOM_W / 2 - 0.9, 0.55 + (i % 4) * 0.5, -1.7 + (i % 3) * 0.45, g, false));
    for (let i = 0; i < 8; i++) r.slots.push(new THREE.Vector3(-1.5 + (i % 4) * 0.8, 1.2, -1.85 + Math.floor(i / 4) * 0.45));
    r.home = new THREE.Vector3(0, 0, -0.35);
  } else if (d.key === 'approval') {
    // executive table + banner
    box(4.8, 0.14, 1.9, wood, 0, 1.05, -1.4, g); cyl(0.12, 0.12, 1.0, white, -1.9, 0.55, -1.4, g); cyl(0.12, 0.12, 1.0, white, 1.9, 0.55, -1.4, g);
    const holo = new THREE.Mesh(new THREE.RingGeometry(0.9, 1.0, 60), new THREE.MeshBasicMaterial({ color: accent, transparent: true, opacity: 0.5, side: THREE.DoubleSide })); holo.rotation.x = -Math.PI / 2; holo.position.set(0, 1.13, -1.4); g.add(holo); r.holo = holo;
    for (let i = 0; i < 8; i++) r.slots.push(new THREE.Vector3(-1.5 + (i % 4) * 1.0, 1.2, -1.7 + Math.floor(i / 4) * 0.6));
    [-1, 0, 1].forEach((k) => { box(0.8, 0.14, 0.8, std('#374151'), k * 1.4, 0.7, 0.2, g); box(0.8, 0.8, 0.12, std('#374151'), k * 1.4, 1.1, 0.6, g); });
  } else {
    // archive shelves
    const sh = std('#d8cdb6');
    box(6.4, 2.6, 0.7, sh, 0, 1.5, -2.5, g);
    const cubes = new THREE.InstancedMesh(new THREE.BoxGeometry(0.5, 0.38, 0.5), new THREE.MeshStandardMaterial({ color: accent.clone().lerp(col('#ffffff'), 0.2), roughness: 0.6 }), 40); r.cubes = cubes; cubes.castShadow = true;
    const m4 = new THREE.Matrix4(); let k = 0; for (let y = 0; y < 4; y++) for (let x = 0; x < 10; x++) { m4.makeTranslation(-2.8 + x * 0.62, 0.55 + y * 0.58, -2.12); cubes.setMatrixAt(k++, m4); } cubes.count = 0; g.add(cubes);
    box(4.4, 0.14, 1.4, wood, 0, 0.95, -0.7, g); cyl(0.1, 0.1, 0.8, white, -2, 0.5, -0.7, g); cyl(0.1, 0.1, 0.8, white, 2, 0.5, -0.7, g);
    for (let i = 0; i < 8; i++) r.slots.push(new THREE.Vector3(-1.5 + (i % 4) * 1.0, 1.1, -1.0 + Math.floor(i / 4) * -0.5));
  }
  const tag = makeSprite(512, 128, 5.6); tag.position.set(0, 5.4, -0.5); g.add(tag); drawTag(tag, [d.name], d.color, null); r.tag = tag;
  g.updateMatrixWorld(true); scene.add(g);
  r.entrance = new THREE.Vector3(d.gx, 0, r.back ? LANE_BACK : LANE_FRONT);
  r.homeWorld = r.home ? g.localToWorld(r.home.clone()) : r.entrance.clone();
  r.facing = Math.PI;
  r.slotWorld = (i) => g.localToWorld((r.slots[i % r.slots.length] || new THREE.Vector3()).clone());
  rooms[d.key] = r; return r;
}

const LOOKS = {
  intake:   { skin: '#e9b98f', hair: '#2b1a12', style: 'long' },
  listener: { skin: '#d9a47a', hair: '#15110e', style: 'short', beard: true },
  former:   { skin: '#f0c9a4', hair: '#6b3f1d', style: 'short', glasses: true },
  reviewer: { skin: '#e4b48c', hair: '#101010', style: 'bun' }
};
function buildAgent(a) {
  const L = LOOKS[a.id], g = new THREE.Group(), c = col(a.color);
  const skin = std(L.skin, { roughness: 0.65 }), hairM = std(L.hair, { roughness: 0.55 }), shirt = std(c, { roughness: 0.6 }), pants = std('#2b3350', { roughness: 0.7 });
  const mk = (geo, mat, x, y, z, p = g) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = true; p.add(m); return m; };
  const torso = mk(new THREE.CapsuleGeometry(0.33, 0.55, 6, 16), shirt, 0, 1.25, 0);
  const head = mk(new THREE.SphereGeometry(0.26, 24, 20), skin, 0, 1.98, 0);
  // face
  [-0.09, 0.09].forEach((x) => mk(new THREE.SphereGeometry(0.03, 8, 8), std('#111'), x, 0.03, 0.235, head));
  mk(new THREE.SphereGeometry(0.035, 8, 8), std('#c98f6b'), 0, -0.04, 0.255, head);
  const mouth = mk(new THREE.TorusGeometry(0.05, 0.008, 6, 14, Math.PI), std('#8a3b3b'), 0, -0.1, 0.24, head); mouth.rotation.z = Math.PI;
  // hair
  mk(new THREE.SphereGeometry(0.285, 24, 16, 0, Math.PI * 2, 0, Math.PI * 0.55), hairM, 0, 0.02, -0.01, head);
  if (L.style === 'long') mk(new THREE.BoxGeometry(0.5, 0.55, 0.16), hairM, 0, -0.2, -0.17, head);
  if (L.style === 'bun') mk(new THREE.SphereGeometry(0.13, 12, 10), hairM, 0, 0.27, -0.12, head);
  if (L.beard) mk(new THREE.SphereGeometry(0.2, 14, 10, 0, Math.PI * 2, Math.PI * 0.5, Math.PI * 0.4), hairM, 0, -0.1, 0.06, head);
  if (L.glasses) { [-0.09, 0.09].forEach((x) => mk(new THREE.TorusGeometry(0.06, 0.01, 6, 16), std('#222', { metalness: 0.6 }), x, 0.03, 0.24, head)); }
  // arms (pivot at shoulder)
  const arm = (sx) => { const p = new THREE.Group(); p.position.set(sx * 0.42, 1.55, 0); const m = mk(new THREE.CapsuleGeometry(0.085, 0.45, 4, 10), shirt, 0, -0.3, 0, p); mk(new THREE.SphereGeometry(0.09, 10, 8), skin, 0, -0.62, 0, p); g.add(p); return p; };
  const armL = arm(-1), armR = arm(1);
  // legs (pivot at hip)
  const leg = (sx) => { const p = new THREE.Group(); p.position.set(sx * 0.16, 0.92, 0); mk(new THREE.CapsuleGeometry(0.115, 0.55, 4, 10), pants, 0, -0.42, 0, p); mk(new THREE.BoxGeometry(0.2, 0.1, 0.32), std('#1a1a1a'), 0, -0.82, 0.07, p); g.add(p); return p; };
  const legL = leg(-1), legR = leg(1);
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.62, 0.74, 40), new THREE.MeshBasicMaterial({ color: STATE_COLOR.idle, transparent: true, opacity: 0.85, side: THREE.DoubleSide })); ring.rotation.x = -Math.PI / 2; ring.position.y = 0.04; g.add(ring);
  const tag = makeSprite(360, 120, 2.7); tag.position.y = 2.95; g.add(tag);
  const bub = makeSprite(560, 150, 3.9); bub.position.y = 3.85; bub.visible = false; g.add(bub);
  const N = 30, pos = new Float32Array(N * 3), pts = new THREE.Points(new THREE.BufferGeometry(), new THREE.PointsMaterial({ color: c, size: 0.12, transparent: true, opacity: 0.9, depthWrite: false }));
  pts.geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3)); pts.userData.seed = Array.from({ length: N }, () => Math.random()); scene.add(pts);
  const room = rooms[a.stage]; g.position.copy(room.homeWorld); g.rotation.y = room.facing; scene.add(g);
  actors[a.id] = { ...a, g, torso, head, legL, legR, armL, armR, ring, tag, bub, pts, room, steps: [], missions: [], walking: false, home: room.homeWorld.clone(), phase: Math.random() * 6 };
  drawTag(tag, [a.name, a.role], a.color, STATE_COLOR.idle);
}

function buildBrain() {
  // CEO = the brand duck on a round podium in the centre
  brain = new THREE.Group();
  cyl(2.3, 2.5, 0.3, std('#efe6d2'), 0, 0.15, 0, brain, 48); cyl(1.9, 1.9, 0.12, std('#d62828', { roughness: 0.5 }), 0, 0.36, 0, brain, 48); cyl(1.6, 1.6, 0.1, std('#ffd400', { roughness: 0.5 }), 0, 0.46, 0, brain, 48);
  const duck = new THREE.Group(); duck.position.y = 1.5; brain.add(duck);
  // the brand duck picture, stacked in thin layers so it has a little volume; always turns to face the viewer
  const dtex = new THREE.TextureLoader().load('duck.png'); dtex.colorSpace = THREE.SRGBColorSpace; dtex.anisotropy = 8;
  const face = new THREE.Group(); face.position.y = 1.0; duck.add(face);
  for (let i = 0; i < 7; i++) {
    const k = i / 6, m = new THREE.Mesh(new THREE.PlaneGeometry(3.6, 3.6), new THREE.MeshBasicMaterial({ map: dtex, color: new THREE.Color().setScalar(0.6 + 0.4 * k), transparent: true, alphaTest: 0.4, side: THREE.DoubleSide }));
    m.position.z = (i - 3) * 0.06; face.add(m);
  }
  const sh = new THREE.Mesh(new THREE.CircleGeometry(1.2, 32), new THREE.MeshBasicMaterial({ color: '#000', transparent: true, opacity: 0.18 })); sh.rotation.x = -Math.PI / 2; sh.position.set(0, 0.52, 0); brain.add(sh);
  const lbl = makeSprite(640, 150, 6.4); lbl.position.y = 5.4; drawTag(lbl, ['المدير التنفيذي · CLAUDE', 'يوزّع الشغل ويعتمد النتايج'], '#d62828', null); brain.add(lbl); brainLabel = lbl;
  const badge = makeSprite(420, 110, 3.4); badge.position.y = 6.7; badge.visible = false; brain.add(badge);
  const ring1 = new THREE.Mesh(new THREE.TorusGeometry(2.55, 0.05, 8, 80), new THREE.MeshBasicMaterial({ color: '#ffd400' })); ring1.rotation.x = Math.PI / 2; ring1.position.y = 0.1; brain.add(ring1);
  const light = new THREE.PointLight('#fff1c9', 22, 20, 1.8); light.position.set(0, 4.5, 2); brain.add(light);
  brain.userData = { core: duck, w1: duck, w2: duck, orbit: duck, ring1, badge, light, duck, face };
  scene.add(brain);
}

function buildBeams() {
  DESKS.forEach((d) => {
    const r = rooms[d.key], a = new THREE.Vector3(0, 0.3, 0), b = new THREE.Vector3(d.gx, 0.3, d.gz);
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([a, b]), new THREE.LineBasicMaterial({ color: col(d.color), transparent: true, opacity: 0.35 })); scene.add(line); r.beam = line;
    for (let i = 0; i < 3; i++) {
      const m = new THREE.Mesh(new THREE.SphereGeometry(0.14, 10, 8), new THREE.MeshBasicMaterial({ color: col(d.color) }));
      m.userData = { room: r, off: i / 3, a, b }; scene.add(m); pulses.push(m);
    }
  });
}

function buildEnvironment() {
  const bg = col('#efe7d6'); scene.background = bg; scene.fog = new THREE.Fog(bg, 90, 220);
  scene.add(new THREE.HemisphereLight('#fff6e4', '#9a8a72', 1.15));
  const dir = new THREE.DirectionalLight('#fff0d6', 1.5); dir.position.set(-22, 46, 30); dir.castShadow = true;
  dir.shadow.mapSize.set(2048, 2048); const sc = dir.shadow.camera; sc.left = -38; sc.right = 38; sc.top = 32; sc.bottom = -32; sc.near = 5; sc.far = 130; dir.shadow.bias = -0.0005; dir.shadow.radius = 4;
  scene.add(dir);
  const floor = new THREE.Mesh(new THREE.CircleGeometry(85, 80), std('#cfc4ad', { roughness: 0.95 })); floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; scene.add(floor);
  const grid = new THREE.GridHelper(150, 75, '#bfb299', '#d8cfba'); grid.position.y = 0.02; grid.material.transparent = true; grid.material.opacity = 0.5; scene.add(grid);
  // walkway carpet strips between room rows
  const walk = new THREE.Mesh(new THREE.PlaneGeometry(58, 7), std('#8d8f98', { roughness: 1 })); walk.rotation.x = -Math.PI / 2; walk.position.set(0, 0.03, 4); walk.receiveShadow = true; scene.add(walk);
}

// ---------- cards ----------
function cardTexture(card) {
  const [c, g] = textCanvas(300, 210); const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; card.tex = { c, g, tex }; return tex;
}
function drawCard(card) {
  const key = card.name + card.status; if (card.drawKey === key) return; card.drawKey = key;
  const { c, g, tex } = card.tex, sc = STATUS_COLOR[card.status] || '#f59e0b';
  g.clearRect(0, 0, c.width, c.height); g.fillStyle = '#0b1230'; g.fillRect(0, 0, c.width, c.height);
  g.fillStyle = sc; g.fillRect(0, 0, c.width, 26);
  g.textAlign = 'center'; g.fillStyle = '#fff'; g.font = `bold 38px ${FONT}`;
  const words = String(card.name).split(' '); let l1 = '', l2 = '';
  words.forEach((w) => { if (g.measureText((l1 + ' ' + w).trim()).width < 250 && !l2) l1 = (l1 + ' ' + w).trim(); else l2 = (l2 + ' ' + w).trim(); });
  g.fillText(fitText(g, l1 || card.name, 270), c.width / 2, 92); if (l2) g.fillText(fitText(g, l2, 270), c.width / 2, 140);
  g.font = `28px ${FONT}`; g.fillStyle = sc; g.fillText(STATUS_AR[card.status] || card.status, c.width / 2, 190);
  tex.needsUpdate = true;
}
function makeCard(j, stage) {
  const g = new THREE.Group();
  const geo = new THREE.BoxGeometry(1.2, 0.08, 0.84);
  const body = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: '#0b1230', emissive: '#223', roughness: 0.4 })); g.add(body);
  const card = { id: j.id, g, body, name: j.name, status: j.status, stage, desk: stage, alpha: 1, order: seq++, bob: Math.random() * 6 };
  const top = new THREE.Mesh(new THREE.PlaneGeometry(1.16, 0.81), new THREE.MeshBasicMaterial({ map: cardTexture(card), toneMapped: false })); top.rotation.x = -Math.PI / 2; top.position.y = 0.045; g.add(top);
  const edge = new THREE.LineSegments(new THREE.EdgesGeometry(geo), new THREE.LineBasicMaterial({ color: '#7dd3fc' })); g.add(edge); card.edge = edge;
  [body, top, edge].forEach((m) => { m.userData.cardId = j.id; });
  drawCard(card); scene.add(g); return card;
}

// ---------- missions ----------
function pairPath(a, b) {
  const ra = rooms[a], rb = rooms[b];
  if (ra.back === rb.back) return [ra.entrance.clone(), rb.entrance.clone()];
  const cx = (ra.entrance.x + rb.entrance.x) / 2 >= 0 ? CORRIDOR : -CORRIDOR;
  const back = ra.back ? ra : rb;
  return ra.back
    ? [ra.entrance.clone(), new THREE.Vector3(cx, 0, LANE_BACK), new THREE.Vector3(cx, 0, LANE_FRONT), rb.entrance.clone()]
    : [ra.entrance.clone(), new THREE.Vector3(cx, 0, LANE_FRONT), new THREE.Vector3(cx, 0, LANE_BACK), rb.entrance.clone()];
}
function ringPath(fromKey, toKey) {
  const order = DESKS.map((d) => d.key), i = order.indexOf(fromKey), j = order.indexOf(toKey);
  const fwd = i <= j, lo = Math.min(i, j), hi = Math.max(i, j), pts = [];
  for (let k = lo; k < hi; k++) pairPath(order[k], order[k + 1]).forEach((p, n) => { if (!(n === 0 && pts.length)) pts.push(p); });
  if (!pts.length) pts.push(rooms[fromKey].entrance.clone());
  return fwd ? pts : pts.reverse();
}
function buildSteps(ag, m) {
  const s = [], from = rooms[m.from], to = rooms[m.to];
  s.push({ t: 'move', p: ag.home.clone() }); s.push({ t: 'pick', card: m.card });
  ringPath(m.from, m.to).forEach((p) => s.push({ t: 'move', p }));
  s.push({ t: 'drop', card: m.card, to: m.to }); s.push({ t: 'wait', left: 0.4 });
  ringPath(m.to, m.from).forEach((p) => s.push({ t: 'move', p })); s.push({ t: 'move', p: ag.home.clone() });
  return s;
}
function transfer(card, fromKey, toKey) {
  const ag = Object.values(actors).find((a) => a.stage === fromKey);
  if (!ag) { card.desk = toKey; return; }
  card.desk = 'pending'; ag.missions.push({ card, from: fromKey, to: toKey });
}
function stepActor(ag, dt) {
  ag.walking = false;
  if (!ag.steps.length && ag.missions.length) ag.steps = buildSteps(ag, ag.missions.shift());
  const st = ag.steps[0]; if (!st) return;
  if (st.t === 'move') {
    const d = st.p.clone().sub(ag.g.position); d.y = 0; const dist = d.length(), sp = 7.5 * dt;
    if (dist <= sp) { ag.g.position.x = st.p.x; ag.g.position.z = st.p.z; ag.steps.shift(); }
    else { d.normalize(); ag.g.position.addScaledVector(d, sp); ag.walking = true; const target = Math.atan2(d.x, d.z); let diff = target - ag.g.rotation.y; diff = Math.atan2(Math.sin(diff), Math.cos(diff)); ag.g.rotation.y += diff * Math.min(1, dt * 10); }
  } else if (st.t === 'pick') { st.card.desk = 'carried'; st.card.carrier = ag.id; ag.steps.shift(); }
  else if (st.t === 'drop') { st.card.desk = st.card.stage === st.to ? st.to : st.card.stage; st.card.carrier = null; ag.steps.shift(); }
  else if (st.t === 'wait') { st.left -= dt; if (st.left <= 0) ag.steps.shift(); }
}

// ---------- data sync ----------
function update(data) {
  if (!ready) return;
  const jobs = data.jobs || []; derived = data.agents || {}; ceoInfo = Object.assign({ pending: 0, approvals: 0, anyWork: false }, data.ceo || {});
  const seen = new Set(), stats = {}; DESKS.forEach((d) => { stats[d.key] = { n: 0, work: 0, wait: 0, done: 0 }; });
  jobs.forEach((j) => {
    seen.add(j.id); const stage = deskByKey[j.stage] ? j.stage : 'received';
    const s = stats[stage]; s.n++; if (j.status === 'working') s.work++; else if (j.status === 'done') s.done++; else s.wait++;
    let c = cards.get(j.id);
    if (!c) { c = makeCard(j, stage); cards.set(j.id, c); const sl = rooms[stage].slotWorld(0); c.g.position.copy(sl); if (!firstSync) c.g.scale.setScalar(0.01); }
    c.name = j.name; c.status = j.status; drawCard(c);
    if (c.stage !== stage) { const from = c.stage; c.stage = stage; if (c.desk === from) transfer(c, from, stage); else if (c.desk !== 'carried' && c.desk !== 'pending') c.desk = stage; }
  });
  cards.forEach((c, id) => { if (!seen.has(id)) { scene.remove(c.g); cards.delete(id); } });
  DESKS.forEach((d) => { rooms[d.key].stats = stats[d.key]; const h = hist[d.key]; h.push(stats[d.key].n); if (h.length > 40) h.shift(); });
  firstSync = false;
}

// ---------- init / loop ----------
function init(c, selectCb) {
  canvas = c; host = c.parentElement; onSelect = selectCb;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  } catch (e) { fail('المتصفح مش قادر يشغّل رسومات ثلاثية الأبعاد (WebGL).'); return; }
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1)); renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap; renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 0.95;
  scene = new THREE.Scene(); camera = new THREE.PerspectiveCamera(30, 16 / 9, 0.5, 400); camera.position.set(22, 40, 62);
  controls = new OrbitControls(camera, canvas); controls.target.set(0, 0.5, 1.5); controls.enableDamping = true; controls.dampingFactor = 0.08; controls.maxPolarAngle = 1.38; controls.minDistance = 16; controls.maxDistance = 120; controls.autoRotateSpeed = 0.6;
  buildEnvironment(); DESKS.forEach(buildRoom); AGENTS.forEach(buildAgent); buildBrain(); buildBeams();
  composer = new EffectComposer(renderer); composer.addPass(new RenderPass(scene, camera));
  bloom = new UnrealBloomPass(new THREE.Vector2(512, 288), 0.12, 0.4, 0.95); composer.addPass(bloom); composer.addPass(new OutputPass());
  const resize = () => {
    const w = host.clientWidth || 960, h = host.clientHeight || 540;
    renderer.setSize(w, h, false); composer.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix();
  };
  resize(); if (window.ResizeObserver) new ResizeObserver(resize).observe(host); else window.addEventListener('resize', resize);
  let down = null;
  canvas.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY }; });
  canvas.addEventListener('pointerup', (e) => { if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) < 5) { const c2 = pick(e); if (c2 && onSelect) onSelect(c2); } down = null; });
  canvas.addEventListener('pointermove', (e) => { const id = pick(e); hoverCard = id; canvas.style.cursor = id ? 'pointer' : 'grab'; });
  ready = true; renderer.setAnimationLoop(loop);
}
function fail(msg) { failed = true; host.insertAdjacentHTML('beforeend', `<div class="gl-fail">${msg}</div>`); }
function pick(e) {
  const r = canvas.getBoundingClientRect(); mouse.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  raycaster.setFromCamera(mouse, camera); const meshes = []; cards.forEach((c) => c.g.children.forEach((m) => meshes.push(m)));
  const hit = raycaster.intersectObjects(meshes, false)[0]; return hit ? hit.object.userData.cardId : null;
}

function loop(ts) {
  try { frame(ts); } catch (e) { if (!failed) fail('خطأ في رسم المكتب: ' + (e && e.message || e)); console.error(e); }
}
function frame(ts) {
  const dt = Math.min(0.05, (ts / 1000 - (lastTs || ts / 1000))); lastTs = ts / 1000; t += dt; monitorTimer -= dt;
  const bu = brain.userData, pending = ceoInfo.pending || 0, appr = ceoInfo.approvals || 0, busy = ceoInfo.anyWork || pending > 0;
  bu.duck.position.y = 1.5 + Math.abs(Math.sin(t * (busy ? 3 : 1.2))) * (busy ? 0.22 : 0.07); bu.duck.rotation.y = 0; bu.face.rotation.y = Math.atan2(camera.position.x - brain.position.x, camera.position.z - brain.position.z) + Math.sin(t * 0.6) * 0.25; bu.duck.rotation.z = Math.sin(t * (busy ? 6 : 1.5)) * 0.04;
  bu.ring1.rotation.z += dt * 0.3;
  if (pending || appr) { drawTag(bu.badge, [appr ? `${appr} مستني اعتمادك` : `${pending} مستني تنفيذ`], '#d62828', '#d62828'); bu.badge.visible = true; bu.badge.position.y = 6.7 + Math.sin(t * 3) * 0.12; } else bu.badge.visible = false;

  DESKS.forEach((d) => {
    const r = rooms[d.key], ag = d.agent ? derived[d.agent] : null, st = ag ? ag.state : (d.key === 'approval' ? (appr ? 'waiting' : 'idle') : 'idle');
    const active = st === 'working' || (d.key === 'approval' && appr > 0);
    r.glow.material.opacity = 0.05 + (active ? 0.12 + 0.05 * Math.sin(t * 4) : 0);
    r.edge.material.color.set(d.color).multiplyScalar(active ? 1 : 0.7);
    r.beam.material.opacity = active ? 0.8 : 0.25;
    if (r.lamp) { const tl = active ? 26 + 6 * Math.sin(t * 5) : 11; r.lamp.intensity += (tl - r.lamp.intensity) * Math.min(1, dt * 4); }
    if (r.beacon) { const to = active ? 0.16 + 0.06 * Math.sin(t * 3) : 0; r.beacon.material.opacity += (to - r.beacon.material.opacity) * Math.min(1, dt * 4); r.beacon.visible = r.beacon.material.opacity > 0.01; }
    if (r.live) { r.live.visible = !!active; if (active) { if (!r.liveDrawn) { drawTag(r.live, ['● شغال دلوقتي'], '#16a34a', '#16a34a'); r.liveDrawn = true; } r.live.position.y = 7.6 + Math.sin(t * 3) * 0.15; } }
    if (r.screen) { const c2 = st === 'working' ? (Math.sin(t * 7) > -0.5 ? '#ffffff' : '#c7c9d1') : '#5b6070'; r.screen.material.color.set(c2); r.screen2.material.color.set(c2); }
    if (r.holo) r.holo.material.opacity = appr ? 0.6 + 0.3 * Math.sin(t * 3) : 0.25;
    if (r.cubes) { const n = Math.min(40, (r.stats ? r.stats.n : 0) * 4); r.cubes.count = n; }
  });
  pulses.forEach((m) => {
    const r = m.userData.room, d = r.desk, ag = d.agent ? derived[d.agent] : null;
    const active = (ag && ag.state === 'working') || (d.key === 'approval' && (ceoInfo.approvals || 0) > 0);
    m.visible = !!active; if (!active) return;
    let p = (t * 0.45 + m.userData.off) % 1; if (d.key === 'approval') p = 1 - p;
    m.position.lerpVectors(m.userData.a, m.userData.b, p); m.scale.setScalar(0.8 + 0.5 * Math.sin(p * Math.PI));
  });

  Object.values(actors).forEach((ag) => {
    stepActor(ag, dt); const info = derived[ag.id] || { state: 'idle' }, atHome = !ag.steps.length && ag.g.position.distanceTo(ag.home) < 0.3;
    const working = atHome && info.state === 'working', sit = atHome ? 0.38 : 0, sw = ag.walking ? Math.sin(t * 10 + ag.phase) : 0;
    ag.torso.position.y = 1.25 - sit + (ag.walking ? Math.abs(sw) * 0.07 : Math.sin(t * 1.5 + ag.phase) * 0.012);
    ag.head.position.y = ag.torso.position.y + 0.73; ag.head.rotation.y = atHome && !working ? Math.sin(t * 0.7 + ag.phase) * 0.3 : 0;
    ag.legL.position.y = ag.legR.position.y = 0.92 - sit; ag.legL.rotation.x = ag.walking ? sw * 0.7 : (atHome ? -1.45 : 0); ag.legR.rotation.x = ag.walking ? -sw * 0.7 : (atHome ? -1.45 : 0);
    ag.armL.position.y = ag.armR.position.y = ag.torso.position.y + 0.3;
    if (working) { ag.armL.rotation.x = -1.1 + Math.sin(t * 14 + ag.phase) * 0.12; ag.armR.rotation.x = -1.1 + Math.cos(t * 13 + ag.phase) * 0.12; }
    else if (ag.walking) { ag.armL.rotation.x = -sw * 0.6; ag.armR.rotation.x = sw * 0.6; }
    else { ag.armL.rotation.x = ag.armR.rotation.x = atHome ? -0.7 : 0; }
    if (atHome) { const diff = ag.room.facing - ag.g.rotation.y; ag.g.rotation.y += Math.atan2(Math.sin(diff), Math.cos(diff)) * Math.min(1, dt * 6); }
    const sc = STATE_COLOR[info.state] || STATE_COLOR.idle; ag.ring.material.color.set(sc); ag.ring.scale.setScalar(1 + (info.state === 'working' ? 0.08 * Math.sin(t * 5) : 0));
    drawTag(ag.tag, [ag.name, ag.role], ag.color, sc);
    const txt = info.state === 'working' ? (info.task || 'شغال..') : info.state === 'waiting' ? (info.task || 'فيه شغل مستني') : info.state === 'error' ? (info.task || 'فيه مشكلة!') : '';
    ag.bub.visible = !!txt && atHome; if (txt) drawBubble(ag.bub, txt, sc);
    // data particles rising from the desk when working
    const attr = ag.pts.geometry.attributes.position, seeds = ag.pts.userData.seed, base = ag.room.group.localToWorld(new THREE.Vector3(0, 1.4, -1.9));
    for (let i = 0; i < seeds.length; i++) {
      const life = (t * 0.6 + seeds[i]) % 1; attr.setXYZ(i, base.x + Math.sin(seeds[i] * 40 + t) * 0.7, base.y + life * 1.8, base.z + Math.cos(seeds[i] * 33) * 0.4);
    }
    attr.needsUpdate = true; ag.pts.visible = working;
  });

  const byDesk = {}; [...cards.values()].sort((a, b) => a.order - b.order).forEach((c) => { if (rooms[c.desk]) (byDesk[c.desk] = byDesk[c.desk] || []).push(c); });
  Object.keys(byDesk).forEach((k) => byDesk[k].forEach((c, i) => { c.target = rooms[k].slotWorld(i); }));
  cards.forEach((c) => {
    c.g.scale.x += (1 - c.g.scale.x) * Math.min(1, dt * 6); c.g.scale.y = c.g.scale.z = c.g.scale.x;
    const hov = hoverCard === c.id; c.edge.material.color.set(STATUS_COLOR[c.status] || '#7dd3fc').multiplyScalar(hov ? 2.2 : 1.2);
    if (c.desk === 'carried') { const a = actors[c.carrier]; if (a) c.g.position.set(a.g.position.x, a.g.position.y + 2.5 + Math.sin(t * 5) * 0.06, a.g.position.z); return; }
    if (c.desk === 'pending' || !c.target) return;
    const tgt = c.target.clone(); tgt.y += 0.1 + Math.sin(t * 2 + c.bob) * 0.04 + (hov ? 0.25 : 0);
    c.g.position.lerp(tgt, Math.min(1, dt * 7));
  });

  if (monitorTimer <= 0) { monitorTimer = 0.5; DESKS.forEach((d) => drawMonitor(rooms[d.key], t)); }
  controls.autoRotate = autoRotate; controls.update(); composer.render();
}

window.Office = { init, update, setAutoRotate: (v) => { autoRotate = !!v; }, isReady: () => ready && !failed };
