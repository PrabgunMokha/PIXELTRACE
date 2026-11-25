import { PALETTE, heatPalette } from './scenes.js';
export const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ---------- confetti / burst on a 2D overlay canvas ---------- */
const fx = { canvas: null, ctx: null, parts: [], running: false };
function ensureFx() {
  if (fx.canvas) return; fx.canvas = document.createElement('canvas'); fx.canvas.id = 'fx'; document.body.appendChild(fx.canvas); fx.ctx = fx.canvas.getContext('2d');
  const size = () => { fx.canvas.width = innerWidth; fx.canvas.height = innerHeight; }; size(); addEventListener('resize', size);
}
export function burst(x, y, colors = PALETTE, count = 70, power = 1) {
  if (reduced) return; ensureFx();
  for (let i = 0; i < count; i++) { const a = Math.random() * Math.PI * 2, s = (2 + Math.random() * 7) * power; fx.parts.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 3 * power, r: 3 + Math.random() * 5, c: colors[i % colors.length], life: 1, rot: Math.random() * 6, vr: (Math.random() - 0.5) * 0.4, shape: Math.random() < 0.5 ? 'rect' : 'circle' }); }
  if (!fx.running) { fx.running = true; requestAnimationFrame(stepFx); }
}
function stepFx() {
  const { ctx, canvas } = fx; ctx.clearRect(0, 0, canvas.width, canvas.height);
  fx.parts = fx.parts.filter((p) => p.life > 0.02);
  for (const p of fx.parts) { p.x += p.vx; p.y += p.vy; p.vy += 0.22; p.vx *= 0.99; p.life *= 0.975; p.rot += p.vr; ctx.save(); ctx.globalAlpha = Math.min(1, p.life * 1.4); ctx.fillStyle = p.c; ctx.translate(p.x, p.y); ctx.rotate(p.rot); if (p.shape === 'rect') ctx.fillRect(-p.r, -p.r / 2, p.r * 2, p.r); else { ctx.beginPath(); ctx.arc(0, 0, p.r * 0.7, 0, 7); ctx.fill(); } ctx.restore(); }
  if (fx.parts.length) requestAnimationFrame(stepFx); else { fx.running = false; ctx.clearRect(0, 0, canvas.width, canvas.height); }
}

/* ---------- animated number ---------- */
export function countUp(el, to, { decimals = 0, suffix = '', duration = 1200 } = {}) {
  if (reduced) { el.textContent = to.toFixed(decimals) + suffix; return; }
  const t0 = performance.now(); const tick = (now) => { const k = Math.min(1, (now - t0) / duration), e = 1 - Math.pow(1 - k, 3); el.textContent = (to * e).toFixed(decimals) + suffix; if (k < 1) requestAnimationFrame(tick); }; requestAnimationFrame(tick);
}

/* ---------- radial spectrum chart + 2D spectrum ---------- */
export function drawSpectrum(canvas, spectrum, color = '#f472b6') {
  const dpr = Math.min(devicePixelRatio || 1, 2), w = canvas.clientWidth || 320, h = canvas.clientHeight || 150; canvas.width = w * dpr; canvas.height = h * dpr; const ctx = canvas.getContext('2d'); ctx.scale(dpr, dpr); ctx.clearRect(0, 0, w, h);
  const data = spectrum.radial, n = data.length, pad = 8; const X = (i) => pad + (i / (n - 1)) * (w - pad * 2), Y = (v) => h - pad - v * (h - pad * 2 - 6);
  ctx.strokeStyle = 'rgba(255,255,255,.07)'; ctx.lineWidth = 1; for (let g = 0; g <= 4; g++) { const y = pad + (g / 4) * (h - pad * 2); ctx.beginPath(); ctx.moveTo(pad, y); ctx.lineTo(w - pad, y); ctx.stroke(); }
  const grad = ctx.createLinearGradient(0, 0, 0, h); grad.addColorStop(0, color + 'aa'); grad.addColorStop(1, color + '00');
  ctx.beginPath(); ctx.moveTo(X(0), h - pad); data.forEach((v, i) => ctx.lineTo(X(i), Y(v))); ctx.lineTo(X(n - 1), h - pad); ctx.closePath(); ctx.fillStyle = grad; ctx.fill();
  ctx.beginPath(); data.forEach((v, i) => (i ? ctx.lineTo(X(i), Y(v)) : ctx.moveTo(X(i), Y(v)))); ctx.strokeStyle = color; ctx.lineWidth = 2.2; ctx.shadowColor = color; ctx.shadowBlur = 10; ctx.stroke(); ctx.shadowBlur = 0;
  ctx.fillStyle = 'rgba(255,255,255,.45)'; ctx.font = '10px ui-monospace,monospace'; ctx.fillText('low frequency', pad, h - 1); ctx.textAlign = 'right'; ctx.fillText('high frequency', w - pad, h - 1);
}
export function drawGridHeat(canvas, grid) {
  canvas.width = grid.width; canvas.height = grid.height; const ctx = canvas.getContext('2d'); const id = ctx.createImageData(grid.width, grid.height);
  for (let i = 0; i < grid.values.length; i++) { const [r, g, b] = heatPalette(grid.values[i]); id.data.set([r, g, b, 255], i * 4); } ctx.putImageData(id, 0, 0);
}

/* ---------- tiny helpers ---------- */
export const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
export function toast(message, tone = 'info') {
  const host = document.querySelector('#toasts'); const el = document.createElement('div'); el.className = `toast ${tone}`; el.textContent = message; host.appendChild(el);
  requestAnimationFrame(() => el.classList.add('in')); setTimeout(() => { el.classList.remove('in'); setTimeout(() => el.remove(), 400); }, 3600);
}
export async function thumbnail(file, size = 112) {
  const url = URL.createObjectURL(file); const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
  const c = document.createElement('canvas'); const s = Math.min(1, size / Math.max(img.width, img.height)); c.width = Math.max(1, Math.round(img.width * s)); c.height = Math.max(1, Math.round(img.height * s)); c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url); return c.toDataURL('image/jpeg', 0.7);
}
