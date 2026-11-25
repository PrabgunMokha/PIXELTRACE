import * as THREE from 'three';
import { OrbitControls } from './vendor/OrbitControls.js';

export const PALETTE = ['#8b5cf6', '#3b82f6', '#22d3ee', '#34d399', '#a3e635', '#fbbf24', '#fb923c', '#fb7185', '#f472b6'];
export const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const col = (c) => new THREE.Color(c);

export function makeRenderer(canvas, opts = {}) {
  try {
    const r = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'low-power', ...opts });
    r.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
    return r;
  } catch (e) { return null; }
}
const watch = (el, fn) => { const ro = new ResizeObserver(() => fn(el.clientWidth, el.clientHeight)); ro.observe(el); return ro; };
const visible = (el, cb) => { const io = new IntersectionObserver(([e]) => cb(e.isIntersecting), { threshold: 0.02 }); io.observe(el); return io; };

function fresnel(c1, c2, c3) {
  return new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, c1: { value: col(c1) }, c2: { value: col(c2) }, c3: { value: col(c3) } },
    vertexShader: 'varying vec3 vN; varying vec3 vV; varying vec3 vP; void main(){ vN=normalize(normalMatrix*normal); vec4 mv=modelViewMatrix*vec4(position,1.); vV=normalize(-mv.xyz); vP=position; gl_Position=projectionMatrix*mv; }',
    fragmentShader: 'uniform vec3 c1; uniform vec3 c2; uniform vec3 c3; uniform float uTime; varying vec3 vN; varying vec3 vV; varying vec3 vP; void main(){ float f=pow(1.-max(dot(normalize(vN),normalize(vV)),0.),2.2); float b=sin(vP.y*4.+vP.x*2.+uTime*1.2)*.5+.5; vec3 base=mix(c1,c2,b); vec3 c=mix(base,c3,f); c+=f*.55; gl_FragColor=vec4(c,1.); }',
  });
}

/* ================= HERO ================= */
export function initHero(canvas, colors) {
  const renderer = makeRenderer(canvas); if (!renderer) return null;
  const scene = new THREE.Scene(); scene.fog = new THREE.FogExp2(0x070a12, 0.045);
  const camera = new THREE.PerspectiveCamera(48, 1, 0.1, 80); camera.position.set(0, 0, 10.5);
  const group = new THREE.Group(); scene.add(group);
  const mats = [];
  const mk = (c1, c2, c3) => { const m = fresnel(c1, c2, c3); mats.push(m); return m; };
  const knot = new THREE.Mesh(new THREE.TorusKnotGeometry(1.0, 0.32, 240, 36, 2, 3), mk(...colors)); group.add(knot);
  const shell = new THREE.LineSegments(new THREE.WireframeGeometry(new THREE.IcosahedronGeometry(2.3, 1)), new THREE.LineBasicMaterial({ color: col(colors[1]), transparent: true, opacity: 0.32 })); group.add(shell);
  const rings = [];
  [[3.4, 0.4, 0.2, colors[0]], [3.9, 1.2, -0.3, colors[1]], [4.4, -0.8, 0.9, colors[2]]].forEach(([r, rx, ry, c]) => {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(r, 0.012, 8, 200), new THREE.MeshBasicMaterial({ color: col(c), transparent: true, opacity: 0.7 })); ring.rotation.set(rx, ry, 0); group.add(ring); rings.push(ring);
    const bead = new THREE.Mesh(new THREE.SphereGeometry(0.09, 16, 16), new THREE.MeshBasicMaterial({ color: col(c) })); ring.add(bead); bead.userData.r = r; bead.userData.phase = Math.random() * 6;
  });
  const geos = [new THREE.TetrahedronGeometry(0.4), new THREE.OctahedronGeometry(0.4), new THREE.DodecahedronGeometry(0.38), new THREE.BoxGeometry(0.5, 0.5, 0.5), new THREE.ConeGeometry(0.34, 0.7, 5), new THREE.IcosahedronGeometry(0.4, 0)];
  const floaters = [];
  for (let i = 0; i < 22; i++) {
    const a = PALETTE[i % PALETTE.length], b = PALETTE[(i * 3 + 2) % PALETTE.length], c = PALETTE[(i * 5 + 4) % PALETTE.length];
    const m = new THREE.Mesh(geos[i % geos.length], fresnel(a, b, c)); mats.push(m.material);
    const r = 4.6 + Math.random() * 3.4, th = Math.random() * Math.PI * 2, ph = Math.acos(2 * Math.random() - 1);
    m.position.set(r * Math.sin(ph) * Math.cos(th), r * Math.sin(ph) * Math.sin(th) * 0.7, r * Math.cos(ph) * 0.6 - 1);
    m.userData = { spin: new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(0.8), base: m.position.clone(), phase: Math.random() * 6, s: 0.6 + Math.random() * 0.9 };
    m.scale.setScalar(m.userData.s); scene.add(m); floaters.push(m);
  }
  const N = 900, pos = new Float32Array(N * 3), cols = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) { const r = 5 + Math.random() * 9, th = Math.random() * Math.PI * 2, ph = Math.acos(2 * Math.random() - 1); pos.set([r * Math.sin(ph) * Math.cos(th), r * Math.sin(ph) * Math.sin(th), r * Math.cos(ph) - 2], i * 3); const c = col(PALETTE[i % PALETTE.length]); cols.set([c.r, c.g, c.b], i * 3); }
  const pg = new THREE.BufferGeometry(); pg.setAttribute('position', new THREE.BufferAttribute(pos, 3)); pg.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  const points = new THREE.Points(pg, new THREE.PointsMaterial({ size: 0.045, vertexColors: true, transparent: true, opacity: 0.8 })); scene.add(points);
  const pointer = { x: 0, y: 0, tx: 0, ty: 0 }; let pulse = 0, running = true;
  addEventListener('pointermove', (e) => { pointer.tx = (e.clientX / innerWidth) * 2 - 1; pointer.ty = (e.clientY / innerHeight) * 2 - 1; });
  const resize = () => { renderer.setSize(innerWidth, innerHeight, false); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); camera.position.x = innerWidth < 900 ? 0 : -3.1; };
  resize(); addEventListener('resize', resize);
  const clock = new THREE.Clock();
  const frame = () => {
    requestAnimationFrame(frame); if (document.hidden || !running) return;
    const t = clock.getElapsedTime(); pointer.x += (pointer.tx - pointer.x) * 0.05; pointer.y += (pointer.ty - pointer.y) * 0.05; pulse *= 0.92;
    mats.forEach((m) => { m.uniforms.uTime.value = t; });
    knot.rotation.set(t * 0.22 + pointer.y * 0.5, t * 0.31 + pointer.x * 0.7, 0); knot.scale.setScalar(1 + pulse * 0.35);
    shell.rotation.set(-t * 0.1, t * 0.14, 0); group.rotation.y = pointer.x * 0.25; group.rotation.x = pointer.y * 0.15;
    rings.forEach((r, i) => { r.rotation.z = t * (0.15 + i * 0.07); const b = r.children[0]; const a = t * (0.8 + i * 0.3) + b.userData.phase; b.position.set(Math.cos(a) * b.userData.r, Math.sin(a) * b.userData.r, 0); });
    floaters.forEach((m) => { const d = m.userData; m.rotation.x += d.spin.x * 0.01; m.rotation.y += d.spin.y * 0.01; m.position.y = d.base.y + Math.sin(t * 0.6 + d.phase) * 0.35; m.scale.setScalar(d.s * (1 + pulse * 0.4)); });
    points.rotation.y = t * 0.012; renderer.render(scene, camera);
  };
  if (reduced) { renderer.render(scene, camera); } else frame();
  return {
    setTheme(c) { mats.slice(0, 1).forEach((m) => { m.uniforms.c1.value.set(c[0]); m.uniforms.c2.value.set(c[1]); m.uniforms.c3.value.set(c[2]); }); shell.material.color.set(c[1]); rings.forEach((r, i) => r.material.color.set(c[i % 3])); },
    pop() { pulse = 1; },
    dim(v) { canvas.style.opacity = v; running = v > 0.02; },
  };
}

/* ================= EVIDENCE VIEWER (terrain) ================= */
export function heatPalette(v) { // multi-colour ramp: deep violet, blue, cyan, green, lime, amber, red
  const stops = [[0, [24, 8, 80]], [0.18, [60, 60, 230]], [0.38, [20, 210, 230]], [0.55, [60, 220, 120]], [0.72, [190, 240, 70]], [0.88, [250, 180, 40]], [1, [250, 70, 80]]];
  v = clamp(v, 0, 1); for (let i = 1; i < stops.length; i++) if (v <= stops[i][0]) { const [a, ca] = stops[i - 1], [b, cb] = stops[i], f = (v - a) / (b - a); return ca.map((x, k) => Math.round(x + (cb[k] - x) * f)); } return stops.at(-1)[1];
}
export function gridToCanvas(grid, scale = 4) {
  const c = document.createElement('canvas'); c.width = grid.width * scale; c.height = grid.height * scale; const ctx = c.getContext('2d'); const id = ctx.createImageData(grid.width, grid.height);
  for (let i = 0; i < grid.values.length; i++) { const [r, g, b] = heatPalette(grid.values[i]); id.data.set([r, g, b, 255], i * 4); }
  const tmp = document.createElement('canvas'); tmp.width = grid.width; tmp.height = grid.height; tmp.getContext('2d').putImageData(id, 0, 0);
  ctx.imageSmoothingEnabled = true; ctx.drawImage(tmp, 0, 0, c.width, c.height); return c;
}
function smooth(grid, passes = 2) {
  if (!grid) return grid; let src = Float32Array.from(grid.values); const { width: w, height: h } = grid;
  for (let p = 0; p < passes; p++) { const out = new Float32Array(src.length); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { let s = 0, n = 0; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const X = x + dx, Y = y + dy; if (X >= 0 && X < w && Y >= 0 && Y < h) { s += src[Y * w + X]; n++; } } out[y * w + x] = s / n; } src = out; }
  return { ...grid, values: src };
}
export class Viewer {
  constructor(stage, tip) {
    this.stage = stage; this.tip = tip; this.canvas = document.createElement('canvas'); stage.prepend(this.canvas);
    this.renderer = makeRenderer(this.canvas); if (!this.renderer) throw new Error('webgl');
    this.scene = new THREE.Scene(); this.camera = new THREE.PerspectiveCamera(42, 1, 0.05, 50);
    this.controls = new OrbitControls(this.camera, this.canvas); Object.assign(this.controls, { enableDamping: true, dampingFactor: 0.07, autoRotateSpeed: 0.9, maxPolarAngle: Math.PI * 0.49, minDistance: 1.2, maxDistance: 9 });
    this.scene.add(new THREE.AmbientLight(0xffffff, 1.15)); const key = new THREE.DirectionalLight(0xffffff, 2.1); key.position.set(3, 5, 2.5); this.scene.add(key);
    const rim = new THREE.DirectionalLight(0x22d3ee, 0.9); rim.position.set(-4, 2, -3); this.scene.add(rim);
    this.ray = new THREE.Raycaster(); this.mouse = new THREE.Vector2(); this.visible = true; this.loader = new THREE.TextureLoader(); this.tex = {}; this.mesh = null; this.scale = 0.9; this.src = 'ela'; this.texKey = 'photo';
    watch(stage, (w, h) => { if (!w || !h) return; this.renderer.setSize(w, h, false); this.camera.aspect = w / h; this.camera.updateProjectionMatrix(); }); visible(stage, (v) => { this.visible = v; });
    this.canvas.addEventListener('pointermove', (e) => this.hover(e)); this.canvas.addEventListener('pointerleave', () => { this.tip.hidden = true; });
    this.controls.addEventListener('start', () => { this.controls.autoRotate = false; const s = document.querySelector('#spin'); if (s) s.checked = false; });
    const loop = () => { requestAnimationFrame(loop); if (!this.visible || document.hidden) return; this.controls.update(); this.renderer.render(this.scene, this.camera); }; loop();
  }
  clear() { if (this.mesh) { this.scene.remove(this.mesh); this.mesh.geometry.dispose(); this.mesh.material.dispose(); this.mesh = null; } Object.values(this.tex).forEach((t) => t && t.dispose()); this.tex = {}; }
  load(result, photoUrl) {
    this.clear(); this.result = result; const v = result.visuals || {}; this.grids = { ela: smooth(v.ela_grid, 2), gradcam: smooth(v.gradcam_grid, 1), noise: smooth(v.noise_grid, 2), spectrum: v.spectrum_grid };
    const ratio = result.image.width / result.image.height; const W = ratio >= 1 ? 3.2 : 3.2 * ratio, H = ratio >= 1 ? 3.2 / ratio : 3.2; const g = this.grids.ela; const sx = Math.min(180, g.width * 2), sy = Math.max(4, Math.round(sx * H / W)); this.dims = { sx, sy };
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(W, H, sx, sy), new THREE.MeshStandardMaterial({ roughness: 0.88, metalness: 0.04, side: THREE.DoubleSide })); this.mesh.rotation.x = -Math.PI / 2; this.scene.add(this.mesh);
    const prep = (url, key) => url && this.loader.load(url, (t) => { t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; this.tex[key] = t; if (this.texKey === key) this.applyTexture(); });
    prep(photoUrl, 'photo'); prep(result.ela_overlay_data_url, 'ela'); if (result.gradcam) prep(result.gradcam.overlay_data_url, 'gradcam'); if (result.noise) prep(result.noise.overlay_data_url, 'noise');
    $$('#tex-seg button').forEach((b) => { if (b.dataset.tex === 'gradcam') b.disabled = !this.grids.gradcam; });
    const gs = document.querySelector('#hs-gradcam'); if (gs) gs.disabled = !this.grids.gradcam;
    this.texKey = 'photo'; this.src = 'ela'; document.querySelector('#height-src').value = 'ela'; $$('#tex-seg button').forEach((b) => b.classList.toggle('on', b.dataset.tex === 'photo'));
    this.applyHeights(); this.reset(); this.controls.autoRotate = document.querySelector('#spin').checked && !reduced;
  }
  sample(grid, u, v) { const x = clamp(u, 0, 1) * (grid.width - 1), y = clamp(v, 0, 1) * (grid.height - 1); const x0 = Math.floor(x), y0 = Math.floor(y), x1 = Math.min(x0 + 1, grid.width - 1), y1 = Math.min(y0 + 1, grid.height - 1); const fx = x - x0, fy = y - y0, a = grid.values; const i = (X, Y) => a[Y * grid.width + X]; return (i(x0, y0) * (1 - fx) + i(x1, y0) * fx) * (1 - fy) + (i(x0, y1) * (1 - fx) + i(x1, y1) * fx) * fy; }
  grid() { return this.src === 'flat' ? null : (this.grids[this.src] || this.grids.ela); }
  applyHeights() { if (!this.mesh) return; const pos = this.mesh.geometry.attributes.position; const { sx, sy } = this.dims; const grid = this.grid(); for (let i = 0; i < pos.count; i++) { const ix = i % (sx + 1), iy = Math.floor(i / (sx + 1)); pos.setZ(i, grid ? this.sample(grid, ix / sx, iy / sy) * this.scale : 0); } pos.needsUpdate = true; this.mesh.geometry.computeVertexNormals(); if (this.texKey === 'height') this.applyTexture(); }
  applyTexture() {
    if (!this.mesh) return; let t = this.tex[this.texKey];
    if (this.texKey === 'height') { const grid = this.grid() || this.grids.ela; if (this.tex.height) this.tex.height.dispose(); t = new THREE.CanvasTexture(gridToCanvas(grid, 4)); t.colorSpace = THREE.SRGBColorSpace; this.tex.height = t; }
    if (!t) return; this.mesh.material.map = t; this.mesh.material.needsUpdate = true;
  }
  setTexture(k) { this.texKey = k; this.applyTexture(); } setSource(s) { this.src = s; this.applyHeights(); } setScale(v) { this.scale = v; this.applyHeights(); }
  setWire(b) { if (this.mesh) this.mesh.material.wireframe = b; } setSpin(b) { this.controls.autoRotate = b && !reduced; }
  reset() { this.camera.position.set(0, 2.0, 3.0); this.controls.target.set(0, 0.1, 0); this.controls.update(); }
  hover(e) {
    if (!this.mesh) return; const r = this.canvas.getBoundingClientRect(); this.mouse.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1); this.ray.setFromCamera(this.mouse, this.camera);
    const hit = this.ray.intersectObject(this.mesh)[0]; if (!hit) { this.tip.hidden = true; return; } const grid = this.grid() || this.grids.ela; const val = this.sample(grid, hit.uv.x, 1 - hit.uv.y);
    const label = { ela: `ELA error ≈ ${(val * grid.reference).toFixed(1)} / 255`, gradcam: `Grad-CAM attention ${Math.round(val * 100)}%`, noise: `Noise residual ${Math.round(val * 100)}% of the 99th percentile`, flat: `ELA error ≈ ${(val * grid.reference).toFixed(1)} / 255` }[this.src] || '';
    this.tip.textContent = label; const box = this.stage.getBoundingClientRect(); this.tip.style.left = `${e.clientX - box.left}px`; this.tip.style.top = `${e.clientY - box.top}px`; this.tip.hidden = false;
  }
}
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

/* ================= SIGNAL CONSTELLATION ================= */
export class Constellation {
  constructor(stage, tip, labelsEl) {
    this.stage = stage; this.tip = tip; this.labelsEl = labelsEl; this.canvas = document.createElement('canvas'); stage.prepend(this.canvas); this.renderer = makeRenderer(this.canvas); if (!this.renderer) throw new Error('webgl');
    this.scene = new THREE.Scene(); this.camera = new THREE.PerspectiveCamera(40, 1, 0.1, 50); this.camera.position.set(0, 3.2, 6.2);
    this.controls = new OrbitControls(this.camera, this.canvas); Object.assign(this.controls, { enableDamping: true, autoRotate: !reduced, autoRotateSpeed: 1.1, minDistance: 3.5, maxDistance: 11, maxPolarAngle: Math.PI * 0.62 });
    this.scene.add(new THREE.AmbientLight(0xffffff, 1.3)); const d = new THREE.DirectionalLight(0xffffff, 2); d.position.set(3, 6, 4); this.scene.add(d);
    this.group = new THREE.Group(); this.scene.add(this.group); this.orbs = []; this.labels = []; this.visible = true; this.ray = new THREE.Raycaster(); this.mouse = new THREE.Vector2();
    watch(stage, (w, h) => { if (!w || !h) return; this.renderer.setSize(w, h, false); this.camera.aspect = w / h; this.camera.updateProjectionMatrix(); }); visible(stage, (v) => { this.visible = v; });
    this.canvas.addEventListener('pointermove', (e) => this.hover(e)); this.canvas.addEventListener('pointerleave', () => { this.tip.hidden = true; });
    const v3 = new THREE.Vector3(); const clock = new THREE.Clock();
    const loop = () => { requestAnimationFrame(loop); if (!this.visible || document.hidden) return; const t = clock.getElapsedTime();
      this.orbs.forEach((o, i) => { o.position.y = o.userData.y + Math.sin(t * 1.1 + i) * 0.12; const k = 1 + Math.sin(t * 2 + i) * 0.04 * (o.userData.verdict ? 2 : 1); o.scale.setScalar(k); });
      if (this.core) { this.core.rotation.y = t * 0.6; this.core.rotation.x = t * 0.3; }
      this.controls.update(); this.renderer.render(this.scene, this.camera); const w = stage.clientWidth, h = stage.clientHeight;
      this.labels.forEach(({ el, obj }) => { v3.copy(obj.position).project(this.camera); el.style.display = v3.z > 1 ? 'none' : 'block'; el.style.left = `${(v3.x * 0.5 + 0.5) * w}px`; el.style.top = `${(-v3.y * 0.5 + 0.5) * h + 30}px`; }); }; loop();
  }
  set(signals, toneColor) {
    this.orbs.forEach((o) => { o.geometry.dispose(); o.material.dispose(); }); while (this.group.children.length) this.group.remove(this.group.children[0]); this.labelsEl.innerHTML = ''; this.orbs = []; this.labels = [];
    const core = new THREE.Mesh(new THREE.IcosahedronGeometry(0.55, 1), fresnel(toneColor, '#ffffff', toneColor)); this.core = core; this.group.add(core);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(2.3, 0.008, 8, 160), new THREE.MeshBasicMaterial({ color: 0x3a4a68 })); ring.rotation.x = Math.PI / 2; this.group.add(ring);
    signals.forEach((s, i) => {
      const a = (i / signals.length) * Math.PI * 2, r = 2.3, size = 0.2 + 0.42 * clamp(s.score, 0.04, 1);
      const orb = new THREE.Mesh(new THREE.SphereGeometry(size, 40, 28), new THREE.MeshStandardMaterial({ color: col(s.color), roughness: 0.25, metalness: 0.35, emissive: col(s.color), emissiveIntensity: s.verdict ? 0.55 : 0.25, wireframe: !s.verdict }));
      orb.position.set(Math.cos(a) * r, (i % 2 ? 0.35 : -0.25), Math.sin(a) * r); orb.userData = { y: orb.position.y, text: s.text, verdict: s.verdict }; this.group.add(orb); this.orbs.push(orb);
      const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), orb.position.clone()]), new THREE.LineBasicMaterial({ color: col(s.color), transparent: true, opacity: 0.25 + 0.55 * s.score })); this.group.add(line);
      const el = document.createElement('span'); el.textContent = s.label; el.style.color = s.color; this.labelsEl.appendChild(el); this.labels.push({ el, obj: orb });
    });
  }
  hover(e) {
    const r = this.canvas.getBoundingClientRect(); this.mouse.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1); this.ray.setFromCamera(this.mouse, this.camera);
    const hit = this.ray.intersectObjects(this.orbs)[0]; if (!hit) { this.tip.hidden = true; return; } this.tip.textContent = hit.object.userData.text; this.tip.style.left = `${e.clientX - r.left}px`; this.tip.style.top = `${e.clientY - r.top}px`; this.tip.hidden = false;
  }
}

/* ================= 3D BAR ATLAS ================= */
export class Atlas {
  constructor(stage, tip, labelsEl) {
    this.stage = stage; this.tip = tip; this.labelsEl = labelsEl; this.canvas = document.createElement('canvas'); stage.prepend(this.canvas); this.renderer = makeRenderer(this.canvas); if (!this.renderer) throw new Error('webgl');
    this.scene = new THREE.Scene(); this.camera = new THREE.PerspectiveCamera(40, 1, 0.1, 60); this.camera.position.set(5.6, 4.4, 7.4);
    this.controls = new OrbitControls(this.camera, this.canvas); Object.assign(this.controls, { enableDamping: true, autoRotate: !reduced, autoRotateSpeed: 0.7, maxPolarAngle: Math.PI * 0.49, minDistance: 5, maxDistance: 16 }); this.controls.target.set(0, 1.3, 0); this.controls.addEventListener('start', () => { this.controls.autoRotate = false; });
    this.scene.add(new THREE.AmbientLight(0xffffff, 1.2)); const d = new THREE.DirectionalLight(0xffffff, 2.2); d.position.set(4, 8, 5); this.scene.add(d); this.scene.add(new THREE.GridHelper(9, 18, 0x3b4a63, 0x1b2535));
    this.H = 3.2; const frame = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(8, this.H, 4.6)), new THREE.LineBasicMaterial({ color: 0x2c3a52, transparent: true, opacity: 0.6 })); frame.position.y = this.H / 2; this.scene.add(frame);
    this.bars = []; this.labels = []; this.started = 0; this.visible = false; this.ray = new THREE.Raycaster(); this.mouse = new THREE.Vector2(); this.hovered = null;
    watch(stage, (w, h) => { if (!w || !h) return; this.renderer.setSize(w, h, false); this.camera.aspect = w / h; this.camera.updateProjectionMatrix(); });
    visible(stage, (v) => { this.visible = v; if (v && !this.started) this.started = performance.now(); });
    this.canvas.addEventListener('pointermove', (e) => this.hover(e)); this.canvas.addEventListener('pointerleave', () => { this.tip.hidden = true; });
    const v3 = new THREE.Vector3();
    const loop = () => { requestAnimationFrame(loop); if (!this.visible || document.hidden) return; const e = reduced ? 1 : clamp((performance.now() - this.started) / 1400, 0, 1), k = 1 - Math.pow(1 - e, 3);
      this.bars.forEach((b) => { b.scale.y = Math.max(0.001, b.userData.target * k); b.position.y = b.scale.y / 2; }); this.controls.update(); this.renderer.render(this.scene, this.camera); const w = stage.clientWidth, h = stage.clientHeight;
      this.labels.forEach(({ el, pos }) => { v3.copy(pos).project(this.camera); el.style.display = v3.z > 1 ? 'none' : 'block'; el.style.left = `${(v3.x * 0.5 + 0.5) * w}px`; el.style.top = `${(-v3.y * 0.5 + 0.5) * h}px`; }); }; loop();
  }
  setData(cfg) { // cfg: {metrics, sets, models:[{name,color}], values[m][s][k]}
    this.bars.forEach((b) => { this.scene.remove(b); b.geometry.dispose(); b.material.dispose(); }); this.bars = []; this.labelsEl.innerHTML = ''; this.labels = []; this.started = performance.now();
    const addLabel = (text, pos, cls = '') => { const el = document.createElement('span'); el.textContent = text; if (cls) el.className = cls; this.labelsEl.appendChild(el); this.labels.push({ el, pos }); };
    const nm = cfg.models.length; const spread = 0.85;
    cfg.models.forEach((model, k) => cfg.sets.forEach((set, j) => cfg.metrics.forEach((metric, i) => {
      const v = cfg.values[k][j][i]; if (v == null) return; const c = col(cfg.metricColors ? cfg.metricColors[i] : model.color);
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.62, 1, 0.62), new THREE.MeshStandardMaterial({ color: c, roughness: 0.4, metalness: 0.2, emissive: 0x000000 }));
      const x = (i - (cfg.metrics.length - 1) / 2) * 2.1 + (k - (nm - 1) / 2) * spread, z = (j - (cfg.sets.length - 1) / 2) * 2.5; m.position.set(x, 0.001, z); m.scale.y = 0.001;
      m.userData = { target: Math.max(v * this.H, 0.02), text: `${model.name} · ${set} · ${metric} = ${v.toFixed(3)}` }; this.scene.add(m); this.bars.push(m);
    })));
    cfg.metrics.forEach((m, i) => addLabel(m, new THREE.Vector3((i - (cfg.metrics.length - 1) / 2) * 2.1, 0, 2.9))); cfg.sets.forEach((s, j) => addLabel(s, new THREE.Vector3(-4.7, 0.1, (j - (cfg.sets.length - 1) / 2) * 2.5), 'row')); [0, 0.5, 1].forEach((t) => addLabel(t.toFixed(1), new THREE.Vector3(-4.3, t * this.H, -2.5)));
  }
  hover(e) {
    const r = this.canvas.getBoundingClientRect(); this.mouse.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1); this.ray.setFromCamera(this.mouse, this.camera); const hit = this.ray.intersectObjects(this.bars)[0];
    if (this.hovered && (!hit || hit.object !== this.hovered)) { this.hovered.material.emissive.setHex(0); this.hovered = null; }
    if (hit) { this.hovered = hit.object; this.hovered.material.emissive.setHex(0x22303d); this.tip.textContent = this.hovered.userData.text; this.tip.style.left = `${e.clientX - r.left}px`; this.tip.style.top = `${e.clientY - r.top}px`; this.tip.hidden = false; } else this.tip.hidden = true;
  }
}
