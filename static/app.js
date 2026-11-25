import { initHero, Viewer, Constellation, Atlas, PALETTE, reduced } from './scenes.js';
import { burst, countUp, drawSpectrum, drawGridHeat, esc, clamp, toast, thumbnail } from './charts.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const THEMES = { aurora: ['#8b5cf6', '#22d3ee', '#34d399'], sunset: ['#fb7185', '#fb923c', '#fbbf24'], neon: ['#f472b6', '#a3e635', '#22d3ee'], ocean: ['#3b82f6', '#22d3ee', '#a78bfa'] };
const SIG = { provenance: '#a78bfa', v1: '#60a5fa', v2: '#22d3ee', ela: '#fbbf24', file: '#34d399', spectrum: '#f472b6', noise: '#a3e635', stress: '#fb923c' };
const state = { files: [], urls: [], viewer: null, constellation: null, atlas: null, gallery: [], card: null, last: null, history: JSON.parse(localStorage.getItem('pt_history') || '[]'), hero: null, busy: false };

/* ---------- theme, hero, pointer effects ---------- */
function setTheme(name) { if (!THEMES[name]) name = 'aurora'; document.body.dataset.theme = name; $$('#theme-dots button').forEach((b) => b.classList.toggle('on', b.dataset.theme === name)); state.hero && state.hero.setTheme(THEMES[name]); localStorage.setItem('pt_theme', name); }
state.hero = initHero($('#bg3d'), THEMES[localStorage.getItem('pt_theme') || 'aurora']);
setTheme(localStorage.getItem('pt_theme') || 'aurora');
$('#theme-dots').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) { setTheme(b.dataset.theme); state.hero && state.hero.pop(); burst(e.clientX, e.clientY, THEMES[b.dataset.theme], 30, 0.7); } });
addEventListener('scroll', () => { const k = clamp(1 - scrollY / (innerHeight * 0.9), 0.1, 1); state.hero && state.hero.dim(k); }, { passive: true });
$('.hero').addEventListener('click', (e) => { if (e.target.closest('a,button')) return; state.hero && state.hero.pop(); burst(e.clientX, e.clientY, PALETTE, 70); });
const glow = $('.cursor-glow');
addEventListener('pointermove', (e) => {
  glow.style.opacity = 1; glow.style.left = e.clientX + 'px'; glow.style.top = e.clientY + 'px';
  const spot = e.target.closest('.glow, .tile'); if (spot) { const r = spot.getBoundingClientRect(); spot.style.setProperty('--mx', e.clientX - r.left + 'px'); spot.style.setProperty('--my', e.clientY - r.top + 'px'); }
  const tilt = e.target.closest('.tilt'); if (tilt && !reduced) { const r = tilt.getBoundingClientRect(), x = (e.clientX - r.left) / r.width - 0.5, y = (e.clientY - r.top) / r.height - 0.5; tilt.style.transform = `perspective(900px) rotateX(${(-y * 9).toFixed(2)}deg) rotateY(${(x * 11).toFixed(2)}deg) translateZ(6px)`; }
  const mag = e.target.closest('.magnetic'); if (mag && !reduced) { const r = mag.getBoundingClientRect(); mag.style.transform = `translate(${((e.clientX - r.left - r.width / 2) * 0.12).toFixed(1)}px,${((e.clientY - r.top - r.height / 2) * 0.2).toFixed(1)}px)`; }
});
addEventListener('pointerout', (e) => { const t = e.target.closest && e.target.closest('.tilt, .magnetic'); if (t && !t.contains(e.relatedTarget)) t.style.transform = ''; });
document.addEventListener('click', (e) => { const b = e.target.closest('.btn'); if (!b) return; const r = b.getBoundingClientRect(), s = document.createElement('span'); s.className = 'rip'; const d = Math.max(r.width, r.height); Object.assign(s.style, { width: d + 'px', height: d + 'px', left: e.clientX - r.left - d / 2 + 'px', top: e.clientY - r.top - d / 2 + 'px' }); b.appendChild(s); setTimeout(() => s.remove(), 650); });
const reveal = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { e.target.classList.add('in'); reveal.unobserve(e.target); } }), { threshold: 0.06 }); $$('.reveal').forEach((el) => reveal.observe(el));

/* ---------- data: status, gallery, model card ---------- */
const getJson = async (u) => { try { const r = await fetch(u); return r.ok ? await r.json() : null; } catch { return null; } };
async function boot() {
  const [status, gallery, card] = await Promise.all([getJson('/api/status'), getJson('/api/gallery'), getJson('/api/model-card')]);
  if (status) $('#ver').textContent = status.version;
  state.gallery = (gallery && gallery.items) || []; state.card = card;
  countUp($('#st-signals'), 8); countUp($('#st-gallery'), state.gallery.length); countUp($('#st-scans'), state.history.length);
  const v2 = card && card.models.find((m) => m.id === 'v2'); const seen = (v2 && v2.training_generators) || [], unseen = (v2 && v2.unseen_generators) || [];
  countUp($('#st-gens'), seen.length || 60);
  const pills = [...seen.map((n, i) => `<span class="gpill" style="--c:${PALETTE[i % PALETTE.length]}">${esc(n)}</span>`), ...unseen.map((n, i) => `<span class="gpill unseen" style="--c:${PALETTE[(i + 3) % PALETTE.length]}">${esc(n)} · unseen</span>`)];
  if (!pills.length) pills.push(...['sdxl', 'flux', 'gpt-image', 'dalle-3', 'ideogram', 'kolors'].map((n, i) => `<span class="gpill" style="--c:${PALETTE[i]}">${n}</span>`));
  const half = Math.ceil(pills.length / 2), fill = (a) => (a.join('') + a.join(''));
  $('#marq1').innerHTML = fill(pills.slice(0, half)); $('#marq2').innerHTML = fill(pills.slice(half));
  buildSamples(); buildAtlas(); buildTrust(); buildExternal(); renderHistory();
}
function buildSamples() {
  const pick = (t, n) => state.gallery.filter((g) => g.truth === t).sort(() => Math.random() - 0.5).slice(0, n);
  const items = [...pick('ai', 4), ...pick('real', 2)].sort(() => Math.random() - 0.5);
  $('#sample-row').innerHTML = items.map((g, i) => `<button class="sample" style="--c:${PALETTE[(i * 2 + 1) % PALETTE.length]}" data-file="${g.file}" data-name="${g.id}${g.file.slice(g.file.lastIndexOf('.'))}">${esc(g.truth === 'ai' ? g.family : 'Real photo')}</button>`).join('');
}
$('#sample-row').addEventListener('click', async (e) => { const b = e.target.closest('.sample'); if (b) setFiles([await fetchFile(b.dataset.file, b.dataset.name)]); });
async function fetchFile(path, name) { const r = await fetch('/' + path); const blob = await r.blob(); return new File([blob], name, { type: blob.type || (path.endsWith('.png') ? 'image/png' : 'image/jpeg') }); }

/* ---------- file selection ---------- */
const setError = (m) => { $('#error').textContent = m || ''; };
function setFiles(list) {
  setError(''); const ok = []; for (const f of list) { if (!['image/jpeg', 'image/png'].includes(f.type)) { setError(`${f.name}: please use JPEG or PNG.`); continue; } if (f.size > 10 * 1024 * 1024) { setError(`${f.name}: larger than 10 MB.`); continue; } ok.push(f); }
  if (!ok.length) return; if (ok.length > 12) { toast('Only the first 12 images are used.', 'warn'); ok.length = 12; }
  state.urls.forEach((u) => URL.revokeObjectURL(u)); state.files = ok; state.urls = ok.map((f) => URL.createObjectURL(f));
  const strip = $('#preview-strip'); strip.className = 'preview-strip' + (ok.length === 1 ? ' single' : ''); strip.innerHTML = state.urls.map((u) => `<img src="${u}" alt="">`).join(''); strip.hidden = false; $('#drop-empty').hidden = true;
  $('#file-name').textContent = ok.length === 1 ? `${ok[0].name} · ${(ok[0].size / 1048576).toFixed(2)} MB` : `${ok.length} images selected`; $('#file-row').hidden = false; $('#scan-btn').disabled = false; $('#scan-btn').textContent = ok.length > 1 ? `Scan ${ok.length} images` : 'Run analysis';
  resetSteps(); log(`> loaded ${ok.length} image${ok.length > 1 ? 's' : ''}`, true); $('#console-title').textContent = 'PIPELINE · READY'; $('#lab').scrollIntoView({ behavior: 'smooth', block: 'start' });
}
$('#file-input').addEventListener('change', (e) => setFiles([...e.target.files]));
$('#remove').addEventListener('click', (e) => { e.preventDefault(); state.files = []; $('#file-input').value = ''; $('#preview-strip').hidden = true; $('#drop-empty').hidden = false; $('#file-row').hidden = true; $('#scan-btn').disabled = true; resetSteps(); log('> ready. choose an image.', true); $('#console-title').textContent = 'PIPELINE · AWAITING INPUT'; });
['dragenter', 'dragover'].forEach((t) => $('#dropzone').addEventListener(t, (e) => { e.preventDefault(); $('#dropzone').classList.add('drag'); }));
['dragleave', 'drop'].forEach((t) => $('#dropzone').addEventListener(t, (e) => { e.preventDefault(); $('#dropzone').classList.remove('drag'); }));
$('#dropzone').addEventListener('drop', (e) => setFiles([...e.dataTransfer.files]));
$('#quality').addEventListener('input', (e) => { $('#quality-value').textContent = e.target.value; });
$('#scan-btn').addEventListener('click', () => (state.files.length > 1 ? runBatch() : runSingle(state.files[0], state.urls[0])));

/* ---------- pipeline console ---------- */
const STEPS = ['provenance', 'ela', 'model', 'extended', 'visuals', 'stress'];
const setStep = (n, c) => { const li = $(`#steps li[data-step="${n}"]`); if (li) li.className = li.className.replace(/\b(active|done|skip|fail)\b/g, '').trim() + (c ? ' ' + c : ''); };
const resetSteps = () => STEPS.forEach((s) => setStep(s, ''));
const log = (line, reset = false) => { const el = $('#log'); el.textContent = (reset ? '' : el.textContent + '\n') + line; el.scrollTop = el.scrollHeight; };
function startSteps(count) { let i = 0; setStep(STEPS[0], 'active'); return setInterval(() => { if (i < count - 1) { setStep(STEPS[i], 'done'); i++; setStep(STEPS[i], 'active'); } }, 600); }

/* ---------- single analysis ---------- */
async function runSingle(file, url) {
  if (!file || state.busy) return; state.busy = true; const btn = $('#scan-btn'); btn.disabled = true; btn.textContent = 'Analysing…'; setError(''); resetSteps(); $('#console-title').textContent = 'PIPELINE · RUNNING'; log('> uploading to /api/analyze', true);
  const timer = startSteps($('#stress-toggle').checked ? 6 : 5);
  try {
    const form = new FormData(); form.append('file', file); form.append('ela_quality', $('#quality').value); form.append('stress', $('#stress-toggle').checked ? 'true' : 'false');
    const res = await fetch('/api/analyze', { method: 'POST', body: form }); const data = await res.json().catch(() => ({})); clearInterval(timer);
    if (!res.ok) { resetSteps(); setStep('provenance', 'fail'); throw new Error(data.detail || `Request failed (${res.status})`); }
    finishSteps(data); await renderReport(data, url || URL.createObjectURL(file)); saveHistory(file, data);
  } catch (err) { clearInterval(timer); setError(err.message); log(`> error: ${err.message}`); $('#console-title').textContent = 'PIPELINE · ERROR'; }
  finally { state.busy = false; btn.disabled = false; btn.textContent = state.files.length > 1 ? `Scan ${state.files.length} images` : 'Run analysis'; }
}
function finishSteps(r) {
  const m = r.model_analysis || {}, x = r.extended_model_analysis || {}, p = r.provenance || {};
  setStep('provenance', 'done'); setStep('ela', 'done'); setStep('model', m.prediction ? 'done' : 'skip'); setStep('extended', x.prediction ? 'done' : 'skip'); setStep('visuals', 'done'); setStep('stress', r.stress ? 'done' : 'skip'); $('#console-title').textContent = 'PIPELINE · COMPLETE';
  log(`> provenance: ${p.declared_origin ? 'declares ' + p.declared_origin + (p.generator_hints.length ? ' (' + p.generator_hints.join(', ') + ')' : '') : 'no AI declaration in file'}`);
  log(`> ela: ${r.forensic_evidence[0].evidence_level} · ${r.ela.high_error_ratio}% pixels at or above error 8`);
  if (m.prediction) log(`> classifier V1: ${m.prediction} (AI ${(m.class_probabilities.ai_generated * 100).toFixed(1)}%)`);
  if (x.prediction) log(`> classifier V2: ${x.prediction} (AI ${(x.class_probabilities.ai_generated * 100).toFixed(1)}%)`);
  if (r.timing_ms) log(`> done in ${(r.timing_ms.total_ms / 1000).toFixed(1)} s · report ready ↓`);
}

/* ---------- verdict text ---------- */
function verdictOf(r) {
  const h = r.headline || { status: 'unknown', basis: 'forensic_only', label: 'Evidence only' }, p = r.provenance || {}, hints = (p.generator_hints || []).slice(0, 3).join(' · ');
  if (h.status === 'ai') {
    const t = { metadata: ['DECLARED BY THE FILE', `Declared in file metadata${hints ? ' · ' + hints : ''}`, 'The file itself says it was created by an AI system. This is a provenance declaration read from the image, not an opinion from pixels, and it outranks the classifiers below.'],
      extended_classifier: ['FLAGGED BY THE EXTENDED CLASSIFIER', 'Extended classifier (trained on 60+ generators)', 'The extended classifier leans AI. It is a lead, not proof: it can misjudge real photographs unlike its training data and it does not cover charts, diagrams or screenshots.'],
      classifier: ['FLAGGED BY THE CLASSIFIER', 'Paper classifier (V1, trained on ADM)', 'The V1 classifier recognises ADM-style images. It is strong on that generator and weak on others, so check the other signals.'] }[h.basis];
    return { tone: 'ai', icon: 'AI', fill: h.basis === 'metadata' ? 1 : 0.85, kicker: t[0], title: h.label, sub: t[1], explain: t[2] };
  }
  if (h.status === 'real') return { tone: 'real', icon: '○', fill: 0.4, kicker: 'NO AI SIGNAL FOUND', title: 'Looks real', sub: 'Nothing declared in the file · no classifier flags it', explain: 'No AI declaration was found and neither classifier flags this image. This is not proof of authenticity: screenshots and re-saves remove metadata, and about one in eight real photographs is wrongly flagged by V2, so a miss is also possible.' };
  return { tone: 'neutral', icon: '•', fill: 0.2, kicker: 'FORENSIC SIGNAL ONLY', title: 'Evidence only', sub: 'No trained model is available', explain: 'Only compression evidence is available for this image.' };
}

/* ---------- report ---------- */
const sigRow = (s) => `<div class="sign ${s.level === 'strong' ? 'strong' : ''}"><b>${esc(s.title)}</b>${esc(s.text)}</div>`;
function gauge(p, color, threshold = 0.5, left = 'AI', right = 'real') { return `<div class="gauge" style="--c:${color};--w:${(p * 100).toFixed(1)}%;--t:${(threshold * 100).toFixed(0)}%"><div class="bar"></div><div class="scale"><span>${left} <b>${(p * 100).toFixed(1)}%</b></span><span>${right} <b>${((1 - p) * 100).toFixed(1)}%</b></span></div></div>`; }
function card(id, i, tag, title, chip, chipClass, body) { return `<article class="card glow signal" id="sig-${id}" style="--c:${SIG[id]};--i:${i}"><header><span class="tag">${tag}</span><h4>${title}</h4><span class="chip ${chipClass}">${chip}</span></header>${body}</article>`; }
async function renderReport(r, url) {
  state.last = r; const v = verdictOf(r), p = r.provenance || {}, m = r.model_analysis || {}, x = r.extended_model_analysis || {}, e = r.forensic_evidence[0], f = r.forensics || {};
  $('#batch').classList.add('hidden'); $('#report').classList.remove('hidden');
  const vc = $('#verdict'); vc.dataset.tone = v.tone; vc.classList.remove('pop-in'); void vc.offsetWidth; vc.classList.add('pop-in');
  $('#ring-icon').textContent = v.icon; $('#verdict-kicker').textContent = v.kicker; $('#verdict-title').textContent = v.title; $('#verdict-sub').textContent = v.sub; $('#verdict-explain').textContent = v.explain; $('#verdict-thumb').src = url;
  const fg = $('#ring-fg'); fg.style.strokeDashoffset = 327; requestAnimationFrame(() => requestAnimationFrame(() => { fg.style.strokeDashoffset = 327 * (1 - v.fill); }));
  const dis = $('#disagree'); if (p.declared_origin && (m.prediction === 'real' || x.prediction === 'real')) { dis.hidden = false; const who = [m.prediction === 'real' ? `V1 says real (${(m.class_probabilities.real * 100).toFixed(1)}%)` : null, x.prediction === 'real' ? `V2 says real (AI ${(x.class_probabilities.ai_generated * 100).toFixed(1)}%)` : null].filter(Boolean).join(' and '); dis.textContent = `The signals differ, and that is why they are shown separately. The file declares AI origin, while ${who}. The declaration wins here: the classifiers do not recognise every generator.`; } else dis.hidden = true;

  const cards = []; let i = 0;
  cards.push(card('provenance', i++, 'SIGNAL 1 · VOTES', 'File provenance', p.declared_origin ? 'AI declared' : 'No declaration', p.declared_origin ? 'ai' : '',
    `<dl class="kv"><dt>Content Credentials (C2PA)</dt><dd>${p.c2pa_manifest_present ? 'present' : 'not found'}</dd><dt>Generation parameters</dt><dd>${p.tool_parameters_found ? 'found' : 'none'}</dd><dt>Declared origin</dt><dd>${p.declared_origin ? ({ ai_generated: 'AI generated', ai_edited: 'AI edited', synthetic: 'Synthetic' })[p.declared_origin] : '—'}</dd></dl>${p.generator_hints.length ? `<div class="hints">${p.generator_hints.map((h) => `<span>${esc(h)}</span>`).join('')}</div>` : ''}<p class="note ${p.declared_origin ? '' : 'caution'}">${p.declared_origin ? 'Read from the file. The signature is not verified here, and metadata can be stripped or forged.' : 'Nothing found. Screenshots, re-saves and chat apps remove metadata, so absence is not evidence of a real photo.'}</p>`));
  if (m.prediction) { const ai = m.class_probabilities.ai_generated; cards.push(card('v1', i++, 'SIGNAL 2 · VOTES', 'Paper classifier V1', m.prediction === 'ai_generated' ? 'AI signal' : 'No AI signal', m.prediction === 'ai_generated' ? 'ai' : '', `${gauge(ai, SIG.v1)}<p class="note caution">Trained on one generator (ADM). On ADM test images: 95.8% accuracy. On unseen Midjourney images it found only 2.2% of AI images.${ai < 0.001 || ai > 0.999 ? ' A score this close to 0% or 100% means the network is saturated, not certain.' : ''}</p>`)); }
  if (x.prediction) { const ea = x.class_probabilities.ai_generated; cards.push(card('v2', i++, 'SIGNAL 3 · VOTES', 'Extended classifier V2', x.prediction === 'ai_generated' ? 'AI signal' : 'No AI signal', x.prediction === 'ai_generated' ? 'ai' : '', `${gauge(ea, SIG.v2, x.decision_threshold)}<p class="note caution">${esc(x.limitation)}</p>`)); }
  else if (x.message) cards.push(card('v2', i++, 'SIGNAL 3', 'Extended classifier V2', 'Unavailable', '', `<p class="note">${esc(x.message)}</p>`));
  const lvl = e.evidence_level; cards.push(card('ela', i++, 'SIGNAL 4 · SUPPORT', 'Compression (ELA)', lvl[0].toUpperCase() + lvl.slice(1), lvl === 'low' ? 'ok' : 'warn', `<dl class="kv"><dt>High-error pixels</dt><dd>${r.ela.high_error_ratio}%</dd><dt>Mean error</dt><dd>${r.ela.mean_error}</dd><dt>P99 error</dt><dd>${r.ela.p99_error}</dd></dl><p>${esc(e.interpretation)}</p><p class="note caution">${esc(e.limitation)} ELA statistics overlap strongly between real and AI images.</p>`));
  const ctx = (f.context_signals || []); cards.push(card('file', i++, 'SIGNAL 5 · CONTEXT', 'File forensics', f.tool_hints && f.tool_hints.length ? 'Tool names found' : f.exif && f.exif.present ? 'Camera tags' : 'No camera tags', f.tool_hints && f.tool_hints.length ? 'ai' : '', `<dl class="kv"><dt>Format</dt><dd>${esc(f.format || '—')} ${f.width ? f.width + '×' + f.height : ''}</dd><dt>EXIF</dt><dd>${f.exif && f.exif.present ? esc(f.exif.camera || 'present') : 'none'}</dd>${f.jpeg_quality_estimate ? `<dt>JPEG quality</dt><dd>≈ ${f.jpeg_quality_estimate}</dd>` : ''}${f.exif && f.exif.has_gps ? '<dt>GPS tag</dt><dd>present</dd>' : ''}</dl><div class="signs">${ctx.map(sigRow).join('')}</div>`));
  if (r.spectrum) { const s = r.spectrum; cards.push(card('spectrum', i++, 'SIGNAL 6 · EXPLORATORY', 'Spectrum fingerprint', `peak ${s.peak_score}σ`, '', `<canvas class="chart" id="spec-chart"></canvas><div class="spec2d"><canvas id="spec-2d" width="64" height="64"></canvas><dl class="kv" style="flex:1;margin:0"><dt>Slope</dt><dd>${s.slope}</dd><dt>High-freq share</dt><dd>${s.high_frequency_share}%</dd></dl></div><p class="note">${esc(s.note)}</p>`)); }
  if (r.noise) cards.push(card('noise', i++, 'SIGNAL 7 · EXPLORATORY', 'Noise residual', `mean ${r.noise.mean_residual}`, '', `<img class="noise-thumb" src="${r.noise.overlay_data_url}" alt="Noise residual"><p class="note">${esc(r.noise.note)}</p>`));
  if (r.stress) { const st = r.stress, th = st.v2_threshold; const rows = st.variants.filter((q) => 'v2_p_ai' in q).map((q) => { const flip = (q.v2_p_ai >= th) !== (st.variants[0].v2_p_ai >= th); return `<div class="stress-row ${flip ? 'flip' : ''}" style="--c:${SIG.stress};--w:${(q.v2_p_ai * 100).toFixed(0)}%;--t:${(th * 100).toFixed(0)}%"><span>${esc(q.name)}</span><div class="bar"><i></i></div><b>${(q.v2_p_ai * 100).toFixed(0)}%</b></div>`; }).join('');
    cards.push(card('stress', i++, 'SIGNAL 8 · ROBUSTNESS', 'Stress test', st.v2_stable === true ? 'Stable' : st.v2_range == null ? (st.v1_stable ? 'V1 stable' : 'V1 flips') : 'Verdict flips', st.v2_stable ? 'ok' : st.v2_range == null ? '' : 'ai', `${rows || '<p class="note">V2 is not loaded, so only V1 was stressed.</p>'}<p class="note">${rows ? 'Bars show V2’s AI probability on each degraded copy; the white tick is its decision threshold.' : ''} ${esc(st.note)}</p>`)); }
  $('#signals').innerHTML = cards.join('');
  requestAnimationFrame(() => { if (r.spectrum) { drawSpectrum($('#spec-chart'), r.spectrum, SIG.spectrum); drawGridHeat($('#spec-2d'), r.spectrum.grid); } });

  const constellation = [
    { label: 'Provenance', color: SIG.provenance, score: p.declared_origin ? 1 : 0.1, verdict: true, text: p.declared_origin ? 'Provenance: AI declared in the file' : 'Provenance: nothing declared (no information)' },
    ...(m.prediction ? [{ label: 'V1', color: SIG.v1, score: m.class_probabilities.ai_generated, verdict: true, text: `Classifier V1: AI ${(m.class_probabilities.ai_generated * 100).toFixed(1)}%` }] : []),
    ...(x.prediction ? [{ label: 'V2', color: SIG.v2, score: x.class_probabilities.ai_generated, verdict: true, text: `Classifier V2: AI ${(x.class_probabilities.ai_generated * 100).toFixed(1)}%` }] : []),
    { label: 'ELA', color: SIG.ela, score: clamp(r.ela.high_error_ratio / 20, 0.05, 1), verdict: false, text: `ELA: ${r.ela.high_error_ratio}% of pixels at or above error 8` },
    { label: 'File', color: SIG.file, score: f.tool_hints && f.tool_hints.length ? 1 : f.exif && f.exif.present ? 0.2 : 0.08, verdict: false, text: f.tool_hints && f.tool_hints.length ? 'File names a generator' : f.exif && f.exif.present ? 'Camera tags present' : 'No camera tags' },
    ...(r.spectrum ? [{ label: 'Spectrum', color: SIG.spectrum, score: clamp(r.spectrum.peak_score / 6, 0.05, 1), verdict: false, text: `Spectrum peak score ${r.spectrum.peak_score}σ` }] : []),
    ...(r.noise ? [{ label: 'Noise', color: SIG.noise, score: clamp(r.noise.mean_residual / 6, 0.05, 1), verdict: false, text: `Mean noise residual ${r.noise.mean_residual}` }] : []),
    ...(r.stress && r.stress.v2_range != null ? [{ label: 'Stress', color: SIG.stress, score: clamp(r.stress.v2_range * 1.4, 0.05, 1), verdict: false, text: `V2 probability range under stress: ${r.stress.v2_range}` }] : []),
  ];
  const tone = { ai: '#fb7185', real: '#34d399', neutral: '#a78bfa' }[v.tone];
  try { if (!state.constellation) state.constellation = new Constellation($('#constellation'), $('#const-tip'), $('#const-labels')); state.constellation.set(constellation, tone); $('#const-fallback').hidden = true; } catch { $('#const-fallback').hidden = false; }
  try { if (!state.viewer) state.viewer = new Viewer($('#viewer'), $('#viewer-tip')); state.viewer.load(r, url); $('#viewer-fallback').hidden = true; } catch { $('#viewer-fallback').hidden = false; }
  $('#cmp-original').src = url; state.cmpMode = 'ela'; $$('#cmp-mode button').forEach((b) => { b.classList.toggle('on', b.dataset.mode === 'ela'); if (b.dataset.mode === 'gradcam') b.disabled = !r.gradcam; }); setCmpImage(); setCompare(50);

  const mets = [['MEAN ERROR', r.ela.mean_error, 32, 'amber'], ['P95 ERROR', r.ela.p95_error, 64, 'orange'], ['P99 ERROR', r.ela.p99_error, 96, 'rose'], ['PEAK ERROR', r.ela.max_error, 255, 'pink'], ['HIGH-ERROR PIXELS', r.ela.high_error_ratio + '%', 100, 'cyan']];
  $('#metrics').innerHTML = mets.map(([n, val, max, c]) => `<div class="metric c-${c}"><span>${n}</span><b>${val}</b><i><em data-w="${clamp(parseFloat(val) / max * 100, 2, 100)}"></em></i></div>`).join('') + `<div class="metric c-green"><span>PROCESSED SIZE</span><b>${r.image.width}×${r.image.height}</b></div>`;
  requestAnimationFrame(() => $$('#metrics em').forEach((el) => { el.style.width = el.dataset.w + '%'; }));
  const t = r.timing_ms || {}, parts = [['file_ms', 'file', SIG.file], ['ela_ms', 'ELA', SIG.ela], ['classifier_ms', 'V1', SIG.v1], ['gradcam_ms', 'Grad-CAM', '#818cf8'], ['extended_ms', 'V2', SIG.v2], ['visuals_ms', 'visuals', SIG.spectrum], ['stress_ms', 'stress', SIG.stress]].filter(([k]) => t[k]); const sum = parts.reduce((a, [k]) => a + t[k], 0) || 1;
  $('#timing').innerHTML = parts.map(([k, , c]) => `<i style="width:${(t[k] / sum * 100).toFixed(1)}%;background:${c}"></i>`).join(''); $('#timing-legend').innerHTML = parts.map(([k, n, c]) => `<span style="--c:${c}">${n} ${t[k]} ms</span>`).join('') + `<span style="--c:#fff">total ${t.total_ms} ms</span>`;
  $('#raw').textContent = JSON.stringify(r, (k, val) => typeof val === 'string' && val.length > 120 ? `${val.slice(0, 48)}… [${val.length} characters]` : (k === 'values' && Array.isArray(val) ? `[${val.length} numbers]` : k === 'radial' ? '[48 numbers]' : val), 2);
  $('#report').scrollIntoView({ behavior: 'smooth' });
  setTimeout(() => { const b = $('#ring-icon').getBoundingClientRect(); burst(b.left + b.width / 2, b.top + b.height / 2, v.tone === 'ai' ? ['#fb7185', '#fb923c', '#fbbf24', '#f472b6'] : v.tone === 'real' ? ['#34d399', '#22d3ee', '#a3e635', '#60a5fa'] : PALETTE, 90); }, 700);
}

/* ---------- compare slider, viewer controls ---------- */
function setCmpImage() { const r = state.last; if (!r) return; const src = state.cmpMode === 'noise' ? r.noise && r.noise.overlay_data_url : state.cmpMode === 'gradcam' ? r.gradcam && r.gradcam.overlay_data_url : r.ela_overlay_data_url; $('#cmp-ela').src = src || r.ela_overlay_data_url; }
function setCompare(pct) { const stage = $('#compare'); $('#cmp-reveal').style.width = pct + '%'; $('#cmp-handle').style.left = pct + '%'; $('#cmp-ela').style.width = stage.clientWidth + 'px'; $('#cmp-range').value = pct; }
$('#cmp-range').addEventListener('input', (e) => setCompare(e.target.value)); addEventListener('resize', () => setCompare($('#cmp-range').value));
$('#cmp-mode').addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b || b.disabled) return; $$('#cmp-mode button').forEach((x) => x.classList.remove('on')); b.classList.add('on'); state.cmpMode = b.dataset.mode; setCmpImage(); });
$$('#tex-seg button').forEach((b) => b.addEventListener('click', () => { if (b.disabled || !state.viewer) return; $$('#tex-seg button').forEach((x) => x.classList.remove('on')); b.classList.add('on'); state.viewer.setTexture(b.dataset.tex); }));
$('#height-src').addEventListener('change', (e) => state.viewer && state.viewer.setSource(e.target.value)); $('#height-scale').addEventListener('input', (e) => state.viewer && state.viewer.setScale(parseFloat(e.target.value)));
$('#wire').addEventListener('change', (e) => state.viewer && state.viewer.setWire(e.target.checked)); $('#spin').addEventListener('change', (e) => state.viewer && state.viewer.setSpin(e.target.checked)); $('#reset-cam').addEventListener('click', () => state.viewer && state.viewer.reset());
$('#again').addEventListener('click', () => $('#lab').scrollIntoView({ behavior: 'smooth' })); $('#save-pdf').addEventListener('click', () => print());
$('#copy-json').addEventListener('click', async () => { try { await navigator.clipboard.writeText(JSON.stringify(state.last, (k, v) => (typeof v === 'string' && v.length > 300 ? '[image data omitted]' : k === 'values' ? '[numbers omitted]' : v), 2)); toast('JSON copied to the clipboard.', 'good'); } catch { toast('Copy is blocked in this browser.', 'warn'); } });

/* ---------- batch ---------- */
async function runBatch() {
  if (state.busy || state.files.length < 2) return; state.busy = true; const btn = $('#scan-btn'); btn.disabled = true; btn.textContent = 'Scanning…'; setError(''); resetSteps(); $('#console-title').textContent = 'PIPELINE · BATCH'; log(`> uploading ${state.files.length} images to /api/analyze-batch`, true);
  const timer = startSteps(5);
  try {
    const form = new FormData(); state.files.forEach((f) => form.append('files', f)); form.append('ela_quality', $('#quality').value);
    const res = await fetch('/api/analyze-batch', { method: 'POST', body: form }); const data = await res.json().catch(() => ({})); clearInterval(timer); if (!res.ok) throw new Error(data.detail || `Request failed (${res.status})`);
    STEPS.forEach((s, k) => setStep(s, k < 4 ? 'done' : 'skip')); $('#console-title').textContent = 'PIPELINE · COMPLETE'; log(`> ${data.summary.total} images in ${data.summary.seconds} s · ${data.summary.ai} AI · ${data.summary.real} real · ${data.summary.errors} errors`);
    renderBatch(data); for (let k = 0; k < data.results.length; k++) if (data.results[k].status === 'completed') saveHistory(state.files[k], data.results[k]);
  } catch (err) { clearInterval(timer); setError(err.message); log(`> error: ${err.message}`); } finally { state.busy = false; btn.disabled = false; btn.textContent = `Scan ${state.files.length} images`; }
}
function renderBatch(data) {
  state.batch = data; $('#report').classList.add('hidden'); $('#batch').classList.remove('hidden'); const s = data.summary;
  $('#batch-summary').innerHTML = `<span class="bchip" style="--c:var(--rose)">${s.ai} AI</span><span class="bchip" style="--c:var(--green)">${s.real} look real</span>${s.errors ? `<span class="bchip" style="--c:var(--amber)">${s.errors} errors</span>` : ''}<span class="bchip" style="--c:var(--cyan)">${s.seconds} s</span>`;
  $('#batch-grid').innerHTML = data.results.map((r, k) => { if (r.status !== 'completed') return `<div class="btile" style="--c:var(--amber);--i:${k}"><div class="bt"><b>Error ${r.status_code}</b><span>${esc(r.file_name)}</span><span>${esc(r.detail)}</span></div></div>`; const ai = r.headline.status === 'ai', pAi = (r.extended_model_analysis && r.extended_model_analysis.class_probabilities) ? r.extended_model_analysis.class_probabilities.ai_generated : (r.model_analysis.class_probabilities || {}).ai_generated || 0;
    return `<div class="btile" data-k="${k}" style="--c:${ai ? 'var(--rose)' : 'var(--green)'};--w:${(pAi * 100).toFixed(0)}%;animation-delay:${k * 0.05}s"><img src="${state.urls[k]}" alt=""><div class="bt"><b>${esc(r.headline.label)}</b><span>${esc(r.file_name)}</span><div class="bar"><i></i></div></div></div>`; }).join('');
  $('#batch').scrollIntoView({ behavior: 'smooth' }); burst(innerWidth / 2, 160, PALETTE, 60, 0.9);
}
$('#batch-grid').addEventListener('click', (e) => { const t = e.target.closest('.btile[data-k]'); if (!t) return; const k = +t.dataset.k; runSingle(state.files[k], state.urls[k]); });
$('#batch-csv').addEventListener('click', () => download('pixeltrace_batch.csv', toCsv(state.batch.results.map((r) => r.status === 'completed' ? { file: r.file_name, verdict: r.headline.label, basis: r.headline.basis, declared: r.provenance.declared_origin || '', v1_p_ai: (r.model_analysis.class_probabilities || {}).ai_generated ?? '', v2_p_ai: ((r.extended_model_analysis || {}).class_probabilities || {}).ai_generated ?? '', ela_level: r.forensic_evidence[0].evidence_level, ela_high_error_pct: r.ela.high_error_ratio } : { file: r.file_name, verdict: 'error ' + r.status_code, basis: r.detail }))));
function toCsv(rows) { const keys = [...new Set(rows.flatMap((r) => Object.keys(r)))]; return [keys.join(','), ...rows.map((r) => keys.map((k) => JSON.stringify(r[k] ?? '')).join(','))].join('\n'); }
function download(name, text) { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv' })); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000); }

/* ---------- history ---------- */
async function saveHistory(file, r) {
  let thumb = ''; try { thumb = await thumbnail(file, 112); } catch {}
  state.history.unshift({ t: Date.now(), name: file.name, thumb, status: r.headline.status, label: r.headline.label, basis: r.headline.basis, v1: (r.model_analysis.class_probabilities || {}).ai_generated ?? null, v2: ((r.extended_model_analysis || {}).class_probabilities || {}).ai_generated ?? null });
  state.history = state.history.slice(0, 30); try { localStorage.setItem('pt_history', JSON.stringify(state.history)); } catch { state.history.forEach((h) => { h.thumb = ''; }); } renderHistory();
}
function renderHistory() {
  $('#hist-count').textContent = state.history.length; $('#st-scans').textContent = state.history.length;
  $('#drawer-list').innerHTML = state.history.length ? state.history.map((h) => `<div class="hrow" style="--c:${h.status === 'ai' ? 'var(--rose)' : h.status === 'real' ? 'var(--green)' : 'var(--violet)'}">${h.thumb ? `<img src="${h.thumb}" alt="">` : ''}<div><b>${esc(h.label)}</b><span>${esc(h.name)}</span><span>${new Date(h.t).toLocaleString()} · ${esc(h.basis)}</span></div></div>`).join('') : '<p class="muted">No scans yet.</p>';
}
$('#history-btn').addEventListener('click', () => { $('#drawer').classList.toggle('open'); }); $('#drawer-close').addEventListener('click', () => $('#drawer').classList.remove('open'));
$('#hist-clear').addEventListener('click', () => { state.history = []; localStorage.removeItem('pt_history'); renderHistory(); toast('History cleared.'); });
$('#hist-csv').addEventListener('click', () => state.history.length ? download('pixeltrace_history.csv', toCsv(state.history.map(({ thumb, ...rest }) => rest))) : toast('Nothing to export yet.', 'warn'));

/* ---------- arena ---------- */
const arena = { deck: [], i: 0, you: 0, pt: 0, streak: 0, busy: false, answered: false, total: 10 };
const shuffle = (a) => a.map((v) => [Math.random(), v]).sort((x, y) => x[0] - y[0]).map((x) => x[1]);
function startArena() {
  const ai = shuffle(state.gallery.filter((g) => g.truth === 'ai')).slice(0, 5), real = shuffle(state.gallery.filter((g) => g.truth === 'real')).slice(0, 5); arena.deck = shuffle([...ai, ...real]); arena.total = arena.deck.length;
  Object.assign(arena, { i: 0, you: 0, pt: 0, streak: 0, busy: false, answered: false }); updateScore(); $('#round-dots').innerHTML = arena.deck.map(() => '<i></i>').join(''); $('#arena-q').textContent = 'Real photo, or AI?'; $('.guess-btns').hidden = false; renderRound();
}
function updateScore() { $('#sc-you').textContent = arena.you; $('#sc-pt').textContent = arena.pt; $('#sc-streak').textContent = arena.streak; }
function renderRound() {
  const g = arena.deck[arena.i]; if (!g) return; $('#flip').classList.remove('flipped'); const im = $('#arena-img'), msg = $('#arena-msg'); im.classList.remove('ready'); msg.hidden = false; msg.textContent = 'Loading image…'; im.onload = () => { im.classList.add('ready'); msg.hidden = true; }; im.onerror = () => { msg.textContent = 'This image could not be loaded. Press Next.'; $('#arena-next').hidden = false; }; im.src = '/' + g.file; $('#round-badge').textContent = `Round ${arena.i + 1} of ${arena.total}`; $$('#round-dots i').forEach((d, k) => d.classList.toggle('cur', k === arena.i));
  $('#g-real').disabled = $('#g-ai').disabled = false; $('#arena-next').hidden = true; $('#arena-result').innerHTML = '<p class="muted">Study the image, then make your call.</p>'; arena.answered = false; arena.busy = false;
}
async function guess(choice) {
  if (arena.busy || arena.answered) return; arena.busy = true; $('#g-real').disabled = $('#g-ai').disabled = true; $('#arena-result').innerHTML = '<p class="muted">PixelTrace is looking…</p>';
  const g = arena.deck[arena.i]; let r = null;
  try { const form = new FormData(); form.append('files', await fetchFile(g.file, 'arena' + g.file.slice(g.file.lastIndexOf('.')))); const res = await fetch('/api/analyze-batch', { method: 'POST', body: form }); r = (await res.json()).results[0]; } catch {}
  const truthAi = g.truth === 'ai', youRight = (choice === 'ai') === truthAi, ptAi = r && r.status === 'completed' ? r.headline.status === 'ai' : null, ptRight = ptAi === null ? false : ptAi === truthAi;
  arena.answered = true; arena.busy = false; if (youRight) { arena.you++; arena.streak++; } else arena.streak = 0; if (ptRight) arena.pt++; updateScore();
  $$('#round-dots i')[arena.i].classList.add(youRight ? 'win' : 'lose'); const tone = truthAi ? '#fb7185' : '#34d399', p2 = r && r.extended_model_analysis && r.extended_model_analysis.class_probabilities ? r.extended_model_analysis.class_probabilities.ai_generated : null;
  const back = $('#arena-back'); back.style.setProperty('--tone', tone); back.innerHTML = `<div class="truth">${truthAi ? 'AI generated' : 'Real photograph'}</div><div class="row"><span>Source</span><b>${esc(g.generator)}</b></div><div class="row"><span>PixelTrace said</span><b>${r && r.status === 'completed' ? esc(r.headline.label) : 'error'}</b></div>${p2 != null ? `<div class="row"><span>V2 AI probability</span><b>${(p2 * 100).toFixed(0)}%</b></div>` : ''}<a href="${esc(g.source_url)}" target="_blank" rel="noopener">View original source ↗</a>`;
  $('#flip').classList.add('flipped'); $('#arena-result').innerHTML = `<p class="res-line ${youRight ? 'win' : 'lose'}"><b>You: ${youRight ? 'correct' : 'wrong'}</b> (you said ${choice === 'ai' ? 'AI' : 'real'})</p><p class="res-line ${ptRight ? 'win' : 'lose'}"><b>PixelTrace: ${ptAi === null ? 'error' : ptRight ? 'correct' : 'wrong'}</b></p>`;
  const rect = $('#arena-card').getBoundingClientRect(); if (youRight && !ptRight) { burst(rect.left + rect.width / 2, rect.top + 80, PALETTE, 110, 1.2); toast('You beat the detector this round!', 'good'); } else if (youRight) burst(rect.left + rect.width / 2, rect.top + 80, ['#34d399', '#22d3ee', '#a3e635'], 50, 0.8);
  const last = arena.i === arena.total - 1; $('#arena-next').hidden = false; $('#arena-next').textContent = last ? 'See final score' : 'Next round →';
}
function nextRound() {
  if (arena.i === arena.total - 1) { const w = arena.you > arena.pt ? 'You beat PixelTrace!' : arena.you === arena.pt ? 'A tie with PixelTrace.' : 'PixelTrace wins this time.'; $('#arena-q').textContent = w; $('#arena-result').innerHTML = `<p><b>You ${arena.you}/${arena.total}</b> · <b>PixelTrace ${arena.pt}/${arena.total}</b>. The detector is a research prototype and misses some modern images. That is exactly what the evaluation below measures.</p>`; $('.guess-btns').hidden = true; $('#arena-next').textContent = 'Play again'; $('#arena-next').onclick = () => { $('#arena-next').onclick = nextRound; startArena(); }; burst(innerWidth / 2, innerHeight / 2, PALETTE, 140, 1.4); return; }
  arena.i++; renderRound();
}
$('#g-real').addEventListener('click', () => guess('real')); $('#g-ai').addEventListener('click', () => guess('ai')); $('#arena-next').onclick = nextRound;
new IntersectionObserver(([e], io) => { if (e.isIntersecting && state.gallery.length) { startArena(); io.disconnect(); } }, { threshold: 0.12 }).observe($('#arena'));

/* ---------- atlas, wild check, trust ---------- */
const rk = (b) => (b && b.confusion ? b.confusion[1][1] / (b.confusion[1][0] + b.confusion[1][1]) : null);
function buildAtlas() {
  const card = state.card; if (!card) return; const [v1, v2, ela] = card.models, t1 = v1.tests, t2 = v2.tests, tela = ela.tests;
  const mk = (b) => b ? [b.accuracy, b.recall, rk(b), b.roc_auc] : [null, null, null, null];
  const cfgs = {
    v2: { metrics: ['Accuracy', 'Recall (AI)', 'Real kept', 'ROC-AUC'], sets: ['Same generators', 'Unseen generators'], models: [{ name: 'Extended V2', color: '#22d3ee' }], metricColors: ['#22d3ee', '#fb7185', '#34d399', '#a78bfa'], values: [[mk(t2.same_generators_held_out), mk(t2.unseen_generators)]],
      legend: [['#22d3ee', 'Accuracy'], ['#fb7185', 'Recall of AI images'], ['#34d399', 'Real photos kept as real'], ['#a78bfa', 'ROC-AUC']], note: `Held-out sets from OpenFake: ${(t2.same_generators_held_out || {}).n} images from generators seen in training, ${(t2.unseen_generators || {}).n} from Midjourney-6 and Imagen, which were kept out of training. Threshold chosen on validation data.` },
    paper: { metrics: ['Accuracy', 'Recall (AI)', 'ROC-AUC'], sets: ['ADM (seen)', 'Midjourney (unseen)'], models: [{ name: 'Classifier V1', color: '#60a5fa' }, { name: 'ELA-only baseline', color: '#fbbf24' }], values: [[[t1.adm_held_out.accuracy, t1.adm_held_out.recall, t1.adm_held_out.roc_auc], [t1.midjourney_unseen.accuracy, t1.midjourney_unseen.recall, t1.midjourney_unseen.roc_auc]], [[tela.adm_held_out.accuracy, tela.adm_held_out.recall, tela.adm_held_out.roc_auc], [tela.midjourney_unseen.accuracy, tela.midjourney_unseen.recall, tela.midjourney_unseen.roc_auc]]],
      legend: [['#60a5fa', 'Classifier V1 (paper)'], ['#fbbf24', 'ELA-only baseline']], note: 'The published evaluation: held-out sets of 1,000 images each from Tiny-GenImage. V1 is excellent on the generator it was trained on (ADM) and finds 2.2% of AI images from Midjourney.' },
  };
  const render = (key) => { const c = cfgs[key]; $$('#atlas-tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === key));
    try { if (!state.atlas) state.atlas = new Atlas($('#atlas-stage'), $('#atlas-tip'), $('#atlas-labels')); state.atlas.setData(c); $('#atlas-fallback').hidden = true; } catch { $('#atlas-fallback').hidden = false; }
    $('#atlas-legend').innerHTML = c.legend.map(([col, t]) => `<li><i class="sw" style="background:${col}"></i>${t}</li>`).join('') + `<li class="muted">Back row: ${c.sets[0]} · Front row: ${c.sets[1]}</li>`; $('#atlas-note').textContent = c.note;
    const rows = []; c.models.forEach((m, k) => c.sets.forEach((s, j) => rows.push(`<tr><td>${esc(m.name)} · ${esc(s)}</td>${c.values[k][j].map((v) => `<td>${v == null ? '—' : v.toFixed(3)}</td>`).join('')}</tr>`))); $('#atlas-table').innerHTML = `<thead><tr><th>Model · test set</th>${c.metrics.map((m) => `<th>${m}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody>`; };
  $('#atlas-tabs').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) render(b.dataset.tab); }); render('v2');
}
function buildExternal() {
  const ext = state.card && state.card.external_check; if (!ext) return; $('#ext-rule').textContent = ext.rule + ' ' + ext.caveat;
  $('#ext-summary').innerHTML = `<span class="bchip" style="--c:var(--cyan)">V2 caught ${ext.v2_ai_flagged} of ${ext.n_ai} AI</span><span class="bchip" style="--c:var(--green)">V2 kept ${ext.v2_real_ok} of ${ext.n_real} real</span><span class="bchip" style="--c:var(--blue)">V1 caught ${ext.v1_ai_flagged} of ${ext.n_ai}</span>`;
  const fam = {}; ext.items.forEach((it) => { const k = it.truth === 'ai' ? it.family : 'Real photographs'; (fam[k] = fam[k] || []).push(it); });
  $('#ext-dots').innerHTML = Object.entries(fam).map(([k, arr]) => `<div class="ext-row"><label>${esc(k)}</label>${arr.map((it) => { const good = (it.v2 === 'ai_generated') === (it.truth === 'ai'); return `<button class="edot ${good ? 'good' : 'bad'} ${it.truth === 'real' ? 'real' : ''}" data-id="${it.id}" title="${esc(k)} · V2 AI ${(it.v2_p_ai * 100).toFixed(0)}% · ${good ? 'correct' : 'wrong'}"></button>`; }).join('')}</div>`).join('');
}
$('#ext-dots').addEventListener('click', async (e) => { const d = e.target.closest('.edot'); if (!d) return; const g = state.gallery.find((x) => x.id === d.dataset.id); if (g) { setFiles([await fetchFile(g.file, g.id + g.file.slice(g.file.lastIndexOf('.')))]); } });
function buildTrust() {
  const card = state.card; if (!card) return; const [v1, v2, ela] = card.models, ext = card.external_check, a = v1.tests.adm_held_out, m = v1.tests.midjourney_unseen, s = v2.tests.same_generators_held_out, u = v2.tests.unseen_generators, ea = ela.tests.adm_held_out, em = ela.tests.midjourney_unseen;
  const items = [
    ['violet', 'File provenance', 'Strong when present', 1, `A declaration (C2PA, XMP, generation parameters) is direct evidence of the origin it states.`, ext ? `But 0 of ${ext.n_ai} wild AI images carried one.` : 'Often missing.', 'Signature not verified; easily stripped.'],
    ['blue', 'Classifier V1 (paper)', `AUC ${a.roc_auc.toFixed(2)} → ${m.roc_auc.toFixed(2)}`, m.roc_auc, `Excellent on ADM (${(a.accuracy * 100).toFixed(1)}% accuracy), but found only ${(m.recall * 100).toFixed(1)}% of Midjourney images.`, 'Trained on one generator.', 'Does not generalise.'],
    ['cyan', 'Classifier V2 (extended)', `AUC ${s.roc_auc.toFixed(2)} → ${u.roc_auc.toFixed(2)}`, u.roc_auc, `${(s.accuracy * 100).toFixed(1)}% accuracy on seen generators, ${(u.recall * 100).toFixed(0)}% recall on unseen ones.`, `${((1 - rk(s)) * 100).toFixed(0)}% of real photos flagged as AI.`, 'Moderate, not strong.'],
    ['amber', 'ELA', `baseline AUC ${ea.roc_auc.toFixed(2)} → ${em.roc_auc.toFixed(2)}`, em.roc_auc, 'A simple model on ELA statistics reaches roughly 70% accuracy.', 'Statistics overlap strongly between real and AI.', 'Support only; never decides.'],
    ['pink', 'Spectrum and noise', 'Exploratory', 0.3, 'Visual evidence for a human to inspect.', 'No measured detection power in this project.', 'No weight in the verdict.'],
    ['orange', 'Stress test', 'Per-image check', 0.6, 'Shows whether the V1 and V2 verdicts survive JPEG q75 and q50, blur, resize and crop.', 'Measures fragility, not truth.', 'A flip is a warning.'],
  ];
  $('#trust-grid').innerHTML = items.map(([c, t, grade, meter, l1, l2, l3], i) => `<article class="tcard c-${c}" style="animation-delay:${i * 0.07}s"><h4>${t}</h4><div class="grade">${grade}</div><div class="meter"><i style="--w:${clamp(meter, 0.05, 1) * 100}%"></i></div><p>${l1}</p><p>${l2}</p><small>${l3}</small></article>`).join('');
}
boot();
