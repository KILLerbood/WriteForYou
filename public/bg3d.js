// WriteForYou — 3D background: little ducks with curly red hair that swim between pages
import * as THREE from 'three';
const canvas = document.getElementById('bg');
let renderer;
try { renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true }); } catch (e) { renderer = null; }
if (renderer) {
  renderer.setPixelRatio(Math.min(1.5, window.devicePixelRatio || 1)); renderer.setClearColor(0x000000, 0);
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.0;
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(35, 1, 0.1, 100); camera.position.set(0, 0, 20);
  scene.add(new THREE.HemisphereLight('#fff6e4', '#c9b28d', 1.5));
  const key = new THREE.DirectionalLight('#fff3d9', 2.2); key.position.set(-6, 9, 10); scene.add(key);
  const rim = new THREE.DirectionalLight('#ffb27a', 1.0); rim.position.set(8, -2, -4); scene.add(rim);
  const tex = new THREE.TextureLoader().load('duck.png'); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
  // a "thick" duck: stacked copies of the logo picture so it has volume when it turns
  const duckGeo = new THREE.PlaneGeometry(2.3, 2.3);
  function makeDuck() {
    const wrap = new THREE.Group(), d = new THREE.Group(); wrap.add(d);
    const N = 6;
    for (let i = 0; i < N; i++) {
      const k = i / (N - 1), c = new THREE.Color().setScalar(0.62 + 0.38 * k);
      const m = new THREE.Mesh(duckGeo, new THREE.MeshBasicMaterial({ map: tex, color: c, transparent: true, alphaTest: 0.35, side: THREE.DoubleSide }));
      m.position.z = (i - (N - 1) / 2) * 0.07; d.add(m);
    }
    return wrap;
  }
  const FALL = Array.from({ length: 6 }, (_, i) => ({ g: makeDuck(), x: -9 + i * 3.7 + (i % 2) * 0.8, y: 8 + i * 2.6, z: -3 - (i % 3) * 3, s: 0.45 + (i % 3) * 0.18, v: 0.55 + (i % 4) * 0.12, ph: i * 1.3 }));
  FALL.forEach((f) => { scene.add(f.g); f.g.scale.setScalar(f.s); });
  // layouts per page: x,y,z(depth),scale,rotY,rotZ  (camera sees about ±9 x, ±5.2 y at z=0)
  const L = {
    office: [[-10.5, -3.2, -1, 1.5, 0.9, 0.1], [10.8, 2.8, -2, 1.7, -0.9, -0.15], [0, 9, -8, 1.2, 0.2, 0], [-9.8, 4.6, -4, 0.8, 0.6, 0.2], [9.5, -4.6, -3, 0.7, -0.5, 0.1], [4.5, 6.5, -10, 0.9, 0.3, 0.1], [-4.5, -7, -6, 0.9, 0.4, 0]],
    orders: [[-9.5, -4.6, 0, 0.8, 1.57, 0], [-6.5, -4.7, -1, 0.7, 1.57, 0], [-3.5, -4.8, -2, 0.62, 1.57, 0], [-0.5, -4.9, -3, 0.55, 1.57, 0], [9.8, 0.5, -4, 1.9, -0.7, -0.1], [-10.5, 3.6, -5, 1.1, 0.8, 0.1], [3, 9, -8, 1.1, 0.2, 0]],
    upload: [[7.5, 2.0, -3, 2.0, -0.5, -0.1], [-10.2, 1.0, -3, 1.6, 0.8, 0.1], [-6.5, 8, -5, 1.0, 0.2, 0], [3.5, 9, -6, 0.8, 0.3, 0], [9.5, -4.2, -2, 0.9, -0.6, 0.1], [-9.5, -4.6, -2, 0.8, 0.5, 0], [0, -8, -6, 1.2, 0.3, 0]]
  };
  const ducks = L.office.map((p, i) => { const g = makeDuck(); scene.add(g); return { g, cur: new THREE.Vector3(p[0], p[1], p[2]), s: p[3], ry: p[4], rz: p[5], tgt: p.slice(), delay: 0, phase: i * 1.7, t0: 0 }; });
  ducks.forEach((d) => { d.g.position.copy(d.cur); d.g.scale.setScalar(d.s); d.g.rotation.y = d.ry * 0.3; });
  // bubbles
  const bubbles = new THREE.InstancedMesh(new THREE.SphereGeometry(0.12, 10, 8), new THREE.MeshStandardMaterial({ color: '#ffffff', transparent: true, opacity: 0.45, roughness: 0.1 }), 40);
  scene.add(bubbles); const bd = Array.from({ length: 40 }, () => ({ x: (Math.random() - 0.5) * 22, y: (Math.random() - 0.5) * 12, z: -2 - Math.random() * 8, s: 0.4 + Math.random() * 1.4, v: 0.15 + Math.random() * 0.35, ph: Math.random() * 6 }));
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sv = new THREE.Vector3(), pv = new THREE.Vector3();
  let page = 'office', last = performance.now() / 1000, t = 0, px = 0, py = 0, scrollY = 0;
  window.addEventListener('pointermove', (e) => { px = e.clientX / innerWidth - 0.5; py = e.clientY / innerHeight - 0.5; });
  window.addEventListener('scroll', () => { scrollY = window.scrollY; }, { passive: true });
  window.addEventListener('wfy:page', (e) => {
    const p = e.detail; if (!L[p] || p === page) return; page = p;
    ducks.forEach((d, i) => { const n = L[p][i]; d.tgt = n; d.delay = i * 0.07; d.t0 = t; d.fly = 1; d.fromY = d.cur.y; });
  });
  function resize() { const w = innerWidth, h = innerHeight; renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); }
  resize(); addEventListener('resize', resize);
  let vis = true; document.addEventListener('visibilitychange', () => { vis = !document.hidden; });
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  renderer.setAnimationLoop(() => {
    if (!vis) return; const now = performance.now() / 1000, dt = Math.min(0.05, now - last); last = now; t += dt;
    ducks.forEach((d) => {
      const tg = d.tgt, k = Math.min(1, dt * (reduce ? 8 : 2.6)); const active = t - d.t0 >= d.delay;
      if (active) {
        const tx = tg[0], ty = tg[1], tz = tg[2];
        const dist = Math.hypot(tx - d.cur.x, ty - d.cur.y); d.cur.x += (tx - d.cur.x) * k; d.cur.y += (ty - d.cur.y) * k; d.cur.z += (tz - d.cur.z) * k;
        // swoop arc: lift mid-flight
        const lift = reduce ? 0 : Math.min(2.5, dist * 0.18) * Math.sin(Math.min(1, dist / 14) * Math.PI);
        d.g.position.set(d.cur.x + px * -0.9 * (1 + (-d.cur.z) * 0.08), d.cur.y + lift + Math.sin(t * 1.3 + d.phase) * 0.18 - scrollY * 0.002 + py * -0.6, d.cur.z);
        d.g.scale.setScalar(d.g.scale.x + (tg[3] - d.g.scale.x) * k);
        const ty2 = tg[4] * 0.3 + Math.sin(t * 0.7 + d.phase) * 0.25 + (dist > 0.4 ? 0.9 * Math.sign(tx - d.cur.x) : 0);
        d.g.rotation.y += (ty2 - d.g.rotation.y) * k; d.g.rotation.z += ((tg[5] || 0) + Math.sin(t * 1.1 + d.phase) * 0.06 + (dist > 0.4 ? -0.25 * Math.sign(tx - d.cur.x) : 0) - d.g.rotation.z) * k;
      } else { d.g.position.y += Math.sin(t * 1.3 + d.phase) * 0.002; }
    });
    FALL.forEach((f) => {
      f.y -= f.v * dt * (reduce ? 0.3 : 1); if (f.y < -8) { f.y = 9 + Math.random() * 3; f.x = (Math.random() - 0.5) * 22; }
      f.g.position.set(f.x + Math.sin(t * 0.8 + f.ph) * 0.8 + px * -0.8, f.y, f.z);
      f.g.rotation.y = Math.sin(t * 0.9 + f.ph) * 0.7; f.g.rotation.z = Math.sin(t * 1.2 + f.ph) * 0.22;
    });
    for (let i = 0; i < bd.length; i++) { const b = bd[i]; b.y += b.v * dt; if (b.y > 7) { b.y = -7; b.x = (Math.random() - 0.5) * 22; } pv.set(b.x + Math.sin(t * 0.6 + b.ph) * 0.4, b.y, b.z); sv.setScalar(b.s); m4.compose(pv, q, sv); bubbles.setMatrixAt(i, m4); }
    bubbles.instanceMatrix.needsUpdate = true;
    renderer.render(scene, camera);
  });
}
