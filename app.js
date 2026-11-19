'use strict';
(() => {
const $ = s => document.querySelector(s);
const kitty = $('#kitty'), fx = $('#fx'), earBadge = $('#ear');

/* ---------- settings (per device) ---------- */
const DEF = { pitch: '1.6', sens: 'normal', mic: 'on', who: 'cat' };
let S = { ...DEF };
try { S = { ...DEF, ...JSON.parse(localStorage.getItem('mishu') || '{}') }; } catch (e) {}
const save = () => { try { localStorage.setItem('mishu', JSON.stringify(S)); } catch (e) {} };
const SENS = { quiet: 0.010, normal: 0.018, noisy: 0.035 };

/* ---------- audio ---------- */
let ctx, master, voiceBus, analyser, talkGain, stream, proc;
let state = 'off';            // off | listen | record | play
let busyUntil = 0;            // mic ignored until then (own sounds)
let lastActive = performance.now();

function initAudio() {
  ctx = new (window.AudioContext || window.webkitAudioContext)();
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -14; comp.ratio.value = 6;
  master = ctx.createGain(); master.gain.value = 1;
  master.connect(comp); comp.connect(ctx.destination);
  analyser = ctx.createAnalyser(); analyser.fftSize = 512;
  voiceBus = ctx.createGain(); voiceBus.connect(analyser); analyser.connect(master);
  talkGain = ctx.createGain(); talkGain.gain.value = 2.4; talkGain.connect(voiceBus);
}

async function initMic() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw new Error('nomic');
  stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
  const src = ctx.createMediaStreamSource(stream);
  proc = ctx.createScriptProcessor(2048, 1, 1);
  const mute = ctx.createGain(); mute.gain.value = 0;
  src.connect(proc); proc.connect(mute); mute.connect(ctx.destination);
  proc.onaudioprocess = onMic;
  state = 'listen';
}

const PRE = 8;
let ring = [], rec = [], voicedMs = 0, silentMs = 0, floor = 0.006, loudRun = 0;
function onMic(e) {
  const d = e.inputBuffer.getChannelData(0);
  let s = 0; for (let i = 0; i < d.length; i++) s += d[i] * d[i];
  const rms = Math.sqrt(s / d.length);
  const ms = d.length / ctx.sampleRate * 1000;
  const now = performance.now();
  earBadge.classList.toggle('on', S.mic === 'on' && state !== 'off');
  if (S.mic !== 'on' || state === 'off' || state === 'play' || now < busyUntil) {
    ring.length = 0; loudRun = 0; if (state === 'record') { state = 'listen'; endHear(); } return;
  }
  const thr = Math.max(SENS[S.sens] || SENS.normal, floor * 3);
  earBadge.style.setProperty('--lvl', Math.min(1, rms / thr).toFixed(2));
  if (state === 'listen') {
    ring.push(new Float32Array(d)); if (ring.length > PRE) ring.shift();
    if (rms > thr) {
      if (++loudRun >= 2) { state = 'record'; rec = ring.slice(); ring = []; voicedMs = loudRun * ms; silentMs = 0; startHear(); }
    } else { loudRun = 0; floor = Math.min(0.08, floor * 0.97 + rms * 0.03); }
  } else if (state === 'record') {
    rec.push(new Float32Array(d));
    if (rms > thr * 0.6) { voicedMs += ms; silentMs = 0; } else silentMs += ms;
    if (silentMs > 850 || rec.length * ms > 8000) finishRecording(ms);
  }
}

function startHear() { wake(); earBadge.classList.add('hear'); pose('listen', 0); }
function endHear() { earBadge.classList.remove('hear'); if (cur === 'listen') pose(null); }

function finishRecording(chunkMs) {
  endHear();
  if (voicedMs < 260) { state = 'listen'; rec = []; return; }
  const keep = Math.max(1, rec.length - Math.floor(Math.max(0, silentMs - 200) / chunkMs));
  const parts = rec.slice(0, keep); rec = [];
  const len = parts.reduce((a, p) => a + p.length, 0);
  const data = new Float32Array(len); let o = 0;
  for (const p of parts) { data.set(p, o); o += p.length; }
  // fade edges to avoid clicks
  const f = Math.min(400, len >> 3);
  for (let i = 0; i < f; i++) { data[i] *= i / f; data[len - 1 - i] *= i / f; }
  playVoice(data);
}

function playVoice(data) {
  state = 'play';
  const buf = ctx.createBuffer(1, data.length, ctx.sampleRate);
  buf.getChannelData(0).set(data);
  const src = ctx.createBufferSource();
  src.buffer = buf; src.playbackRate.value = parseFloat(S.pitch) || 1.6;
  src.connect(talkGain);
  pose('talk', 0);
  src.onended = () => { pose(null); busyUntil = performance.now() + 450; state = stream ? 'listen' : 'off'; };
  src.start();
}
window.__mishuPlay = playVoice; // test hook

/* ---------- synthesised sounds (all original) ---------- */
function env(g, t, a, peak, d) { g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(peak, t + a); g.gain.exponentialRampToValueAtTime(0.0001, t + a + d); }
function busy(sec) { busyUntil = Math.max(busyUntil, performance.now() + sec * 1000 + 450); }

const isBoy = () => S.who === 'boy';
// the boy's "voice": a happy vowel ("ya-ay" / "hee") instead of a meow
function yay(opts = {}) {
  const t = ctx.currentTime + (opts.delay || 0), dur = opts.dur || 0.5, base = (opts.f || 520) * 0.7;
  const o = ctx.createOscillator(); o.type = 'sawtooth';
  o.frequency.setValueAtTime(base, t);
  o.frequency.exponentialRampToValueAtTime(base * 1.35, t + dur * 0.5);
  o.frequency.exponentialRampToValueAtTime(base * (opts.end || 1.1), t + dur);
  const g = ctx.createGain(); env(g, t, 0.04, opts.vol || 0.55, dur);
  const mix = ctx.createGain(); mix.gain.value = 1;
  for (const [a, b, q] of [[650, 850, 6], [1900, 2300, 9]]) {
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = q;
    f.frequency.setValueAtTime(a, t); f.frequency.linearRampToValueAtTime(b, t + dur);
    o.connect(f); f.connect(mix);
  }
  mix.connect(g); g.connect(voiceBus);
  o.start(t); o.stop(t + dur + 0.1); busy(dur + (opts.delay || 0));
}
function hum(sec) {
  const t = ctx.currentTime;
  const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = 300;
  const vib = ctx.createOscillator(); vib.frequency.value = 5; const vg = ctx.createGain(); vg.gain.value = 8;
  vib.connect(vg); vg.connect(o.frequency);
  const g = ctx.createGain(); env(g, t, 0.15, 0.4, sec);
  o.connect(g); g.connect(voiceBus); o.start(t); vib.start(t); o.stop(t + sec + 0.2); vib.stop(t + sec + 0.2); busy(sec);
}

function meow(opts = {}) {
  if (isBoy()) return yay(opts);
  const t = ctx.currentTime + (opts.delay || 0), dur = opts.dur || 0.6, base = opts.f || 520;
  const o = ctx.createOscillator(); o.type = 'sawtooth';
  o.frequency.setValueAtTime(base * 0.8, t);
  o.frequency.exponentialRampToValueAtTime(base * 1.5, t + dur * 0.35);
  o.frequency.exponentialRampToValueAtTime(base * (opts.end || 0.9), t + dur);
  const f1 = ctx.createBiquadFilter(); f1.type = 'bandpass'; f1.Q.value = 3;
  f1.frequency.setValueAtTime(700, t); f1.frequency.linearRampToValueAtTime(1600, t + dur * 0.4); f1.frequency.linearRampToValueAtTime(900, t + dur);
  const g = ctx.createGain(); env(g, t, 0.05, opts.vol || 0.6, dur);
  o.connect(f1); f1.connect(g); g.connect(voiceBus);
  o.start(t); o.stop(t + dur + 0.1); busy(dur + (opts.delay || 0));
}
function blip(f, t, dur, vol = 0.3, type = 'sine', dest = voiceBus) {
  const o = ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(f, t);
  const g = ctx.createGain(); env(g, t, 0.02, vol, dur);
  o.connect(g); g.connect(dest); o.start(t); o.stop(t + dur + 0.05);
  return o;
}
function giggleSnd() {
  const t = ctx.currentTime;
  for (let i = 0; i < 6; i++) { const o = blip(900 - i * 50, t + i * 0.13, 0.1, 0.35, 'triangle'); o.frequency.exponentialRampToValueAtTime(1300 - i * 60, t + i * 0.13 + 0.06); }
  busy(0.9);
}
function purr(sec = 1.6) {
  if (isBoy()) return hum(sec);
  const t = ctx.currentTime;
  const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = 52;
  const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 380;
  const g = ctx.createGain(); g.gain.value = 0;
  const lfo = ctx.createOscillator(); lfo.frequency.value = 2.2;
  const lg = ctx.createGain(); lg.gain.value = 0.22;
  lfo.connect(lg); lg.connect(g.gain);
  const out = ctx.createGain(); env(out, t, 0.2, 0.9, sec);
  o.connect(lp); lp.connect(g); g.connect(out); out.connect(master);
  o.start(t); lfo.start(t); o.stop(t + sec + 0.3); lfo.stop(t + sec + 0.3); busy(sec);
}
function noise(t, dur, freq, q, vol, sweepTo) {
  const n = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * dur), ctx.sampleRate);
  const d = n.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  const s = ctx.createBufferSource(); s.buffer = n;
  const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = q; bp.frequency.setValueAtTime(freq, t);
  if (sweepTo) bp.frequency.exponentialRampToValueAtTime(sweepTo, t + dur);
  const g = ctx.createGain(); env(g, t, 0.02, vol, dur);
  s.connect(bp); bp.connect(g); g.connect(master); s.start(t);
}
function munch(n = 4) { const t = ctx.currentTime; for (let i = 0; i < n; i++) noise(t + i * 0.32, 0.12, 1800, 1.5, 0.5); busy(n * 0.32); }
function slurp(n = 3) { const t = ctx.currentTime; for (let i = 0; i < n; i++) noise(t + i * 0.42, 0.3, 500, 6, 0.6, 2200); busy(n * 0.42); }
function boing(dest = master) { const t = ctx.currentTime; const o = blip(180, t, 0.35, 0.5, 'sine', dest); o.frequency.exponentialRampToValueAtTime(700, t + 0.3); busy(0.4); }
function bonk() { const t = ctx.currentTime; const o = blip(320, t, 0.18, 0.5, 'square', master); o.frequency.exponentialRampToValueAtTime(90, t + 0.15); busy(0.3); }

const SONG = [ // original little tune: [semitones from C5, beats]
  [4,1],[7,1],[4,1],[0,1],[2,1],[4,1],[2,2],
  [0,1],[2,1],[4,1],[7,1],[9,1],[7,1],[4,2],
  [7,1],[4,1],[2,1],[0,1],[2,1],[4,1],[0,2]];
function song() {
  const beat = 0.26; let t = ctx.currentTime + 0.05;
  for (const [st, b] of SONG) {
    const f = 523.25 * Math.pow(2, st / 12), d = b * beat * 0.92;
    const o = ctx.createOscillator(); o.type = 'sawtooth';
    o.frequency.setValueAtTime(f * 0.94, t); o.frequency.exponentialRampToValueAtTime(f, t + 0.05);
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 2.5; bp.frequency.setValueAtTime(900, t); bp.frequency.linearRampToValueAtTime(1500, t + d * 0.5);
    const g = ctx.createGain(); env(g, t, 0.03, 0.45, d);
    o.connect(bp); bp.connect(g); g.connect(voiceBus); o.start(t); o.stop(t + d + 0.05);
    blip(f / 2, t, d, 0.12, 'triangle', master);
    t += b * beat;
  }
  const total = t - ctx.currentTime; busy(total); return total;
}

/* ---------- poses ---------- */
const POSES = ['listen','talk','ouch','giggle','happy','jump','wave','eat','eat-done','play','sing','sleep'];
let cur = null, poseTimer = 0;
function pose(name, ms) {
  clearTimeout(poseTimer);
  kitty.classList.remove(...POSES);
  cur = name;
  if (name) kitty.classList.add(...name.split(' '));
  if (name && ms) poseTimer = setTimeout(() => pose(null), ms);
}
function locked() { return state === 'play' || ['eat','play','sing'].includes(cur); }

/* mouth follows the voice */
const tbuf = new Uint8Array(512);
let mouthOpenEl;
function frame() {
  if (analyser && (cur === 'talk' || cur === 'sing')) {
    analyser.getByteTimeDomainData(tbuf);
    let s = 0; for (let i = 0; i < tbuf.length; i++) { const v = (tbuf[i] - 128) / 128; s += v * v; }
    const a = Math.min(1, Math.sqrt(s / tbuf.length) * 6);
    mouthOpenEl.style.transform = `scale(${0.8 + a * 0.35},${0.15 + a * 1.1})`;
  } else if (mouthOpenEl.style.transform) mouthOpenEl.style.transform = '';
  requestAnimationFrame(frame);
}

function blinkLoop() {
  if (cur !== 'sleep') { kitty.classList.add('blink'); setTimeout(() => kitty.classList.remove('blink'), 140); }
  setTimeout(blinkLoop, 2000 + Math.random() * 3500);
}

/* eyes follow a finger */
function look(x, y) {
  const r = kitty.getBoundingClientRect();
  const cx = r.left + r.width / 2, cy = r.top + r.height * 0.36;
  const dx = Math.max(-1, Math.min(1, (x - cx) / (r.width / 2))), dy = Math.max(-1, Math.min(1, (y - cy) / (r.height / 2)));
  document.querySelectorAll('.pupil').forEach(p => p.style.transform = `translate(${dx * 8}px,${dy * 8}px)`);
}

/* ---------- effects ---------- */
function anchor(el) { const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }
function burst(emoji, x, y, n = 5) {
  for (let i = 0; i < n; i++) {
    const s = document.createElement('span');
    s.className = 'pop'; s.textContent = Array.isArray(emoji) ? emoji[i % emoji.length] : emoji;
    s.style.left = (x + (Math.random() - 0.5) * 80) + 'px'; s.style.top = (y + (Math.random() - 0.5) * 40) + 'px';
    s.style.setProperty('--dx', ((Math.random() - 0.5) * 120) + 'px');
    s.style.animationDelay = (i * 0.09) + 's';
    s.addEventListener('animationend', () => s.remove());
    fx.appendChild(s);
  }
}

/* ---------- interactions ---------- */
let bellyTaps = 0, bellyTimer = 0;
function touchZone(zone, x, y) {
  wake();
  if (locked()) return;
  const mouth = anchor($('#mouthAnchor'));
  switch (zone) {
    case 'head': bonk(); meow({ f: 700, dur: 0.35, end: 0.6, delay: 0.08 }); pose('ouch', 900); burst(['⭐','✨'], x, y - 20, 4); break;
    case 'belly':
      bellyTaps++; clearTimeout(bellyTimer); bellyTimer = setTimeout(() => bellyTaps = 0, 2500);
      if (bellyTaps >= 3) { purr(1.8); pose('happy', 1900); burst('💗', mouth.x, mouth.y - 60, 6); bellyTaps = 0; }
      else { giggleSnd(); pose('giggle', 1000); burst(['💗','😆'], x, y, 3); }
      break;
    case 'tail': boing(); meow({ f: 640, dur: 0.5, delay: 0.15 }); pose('jump', 750); burst('❗', mouth.x + 60, mouth.y - 160, 1); break;
    case 'paw': meow({ f: 760, dur: 0.3, end: 1.1 }); pose('wave happy', 1100); burst(isBoy() ? '👍' : '👋', x, y - 30, 1); break;
  }
}

function flyTo(emoji, done) {
  const btn = document.querySelector(`[data-act]:focus`) ;
  const m = anchor($('#mouthAnchor'));
  const s = document.createElement('div'); s.className = 'fly'; s.textContent = emoji;
  s.style.left = (window.innerWidth / 2) + 'px'; s.style.top = (window.innerHeight - 70) + 'px';
  fx.appendChild(s);
  requestAnimationFrame(() => requestAnimationFrame(() => { s.style.left = m.x + 'px'; s.style.top = (m.y + 30) + 'px'; s.style.transform = 'translate(-50%,-50%) scale(.8)'; }));
  setTimeout(() => { done(s); }, 650);
}

const ACTS = {
  milk() {
    flyTo('🥛', s => {
      pose('eat'); slurp(3);
      setTimeout(() => { s.style.opacity = 0; setTimeout(() => s.remove(), 300); pose('eat-done happy', 1800); meow({ f: 480, dur: 0.5 }); purr(1.4); const m = anchor($('#mouthAnchor')); burst(['💗','🥛'], m.x, m.y - 40, 5); }, 1300);
    });
  },
  fish() {
    flyTo(isBoy() ? '🍪' : '🐟', s => {
      pose('eat'); munch(4); let k = 0;
      const shrink = setInterval(() => { s.style.transform = `translate(-50%,-50%) scale(${0.8 - (++k) * 0.18})`; }, 320);
      setTimeout(() => { clearInterval(shrink); s.remove(); pose('eat-done happy', 1600); meow({ f: 420, dur: 0.7, end: 0.7 }); const m = anchor($('#mouthAnchor')); burst(['😋','💗'], m.x, m.y - 40, 4); }, 1300);
    });
  },
  yarn() {
    const r = kitty.getBoundingClientRect();
    const y = r.bottom - r.height * 0.1;
    const b = document.createElement('div'); b.className = 'yarn spin'; b.textContent = isBoy() ? '⚽' : '🧶';
    b.style.left = '-60px'; b.style.top = y + 'px'; fx.appendChild(b);
    requestAnimationFrame(() => requestAnimationFrame(() => b.style.left = (r.left + r.width * 0.5) + 'px'));
    setTimeout(() => {
      pose('play'); b.classList.remove('spin');
      let n = 0; const t = setInterval(() => { boing(); b.style.top = (y - (n % 2 ? 0 : 50)) + 'px'; if (++n >= 5) clearInterval(t); }, 300);
      setTimeout(() => {
        b.style.top = y + 'px'; b.classList.add('spin'); b.style.left = (window.innerWidth + 80) + 'px';
        pose('happy', 1200); meow({ f: 600, dur: 0.45 });
        setTimeout(() => b.remove(), 800);
      }, 1700);
    }, 720);
  },
  song() {
    pose('sing', 0);
    const total = song();
    const r = kitty.getBoundingClientRect();
    const ni = setInterval(() => burst(['🎵','🎶'], r.left + r.width * (0.25 + Math.random() * 0.5), r.top + r.height * 0.2, 1), 450);
    setTimeout(() => { clearInterval(ni); pose('happy', 900); }, total * 1000);
  }
};

/* ---------- sleep when left alone ---------- */
let zzzTimer = 0;
function wake() {
  lastActive = performance.now();
  if (cur === 'sleep') { clearInterval(zzzTimer); pose('happy', 800); }
}
setInterval(() => {
  if (state !== 'off' && cur === null && performance.now() - lastActive > 60000) {
    pose('sleep', 0);
    zzzTimer = setInterval(() => {
      const m = anchor($('#mouthAnchor'));
      const z = document.createElement('span'); z.className = 'zzz'; z.textContent = 'z';
      z.style.left = (m.x + 70) + 'px'; z.style.top = (m.y - 120) + 'px'; z.style.setProperty('--dx', '40px');
      z.addEventListener('animationend', () => z.remove()); fx.appendChild(z);
    }, 1200);
  }
}, 2000);

/* ---------- wiring ---------- */
kitty.addEventListener('pointerdown', e => {
  look(e.clientX, e.clientY);
  const z = e.target.closest('[data-zone]');
  if (z) touchZone(z.dataset.zone, e.clientX, e.clientY);
});
document.addEventListener('pointermove', e => look(e.clientX, e.clientY));
document.querySelectorAll('[data-act]').forEach(b => b.addEventListener('click', () => {
  if (!ctx) return; wake(); if (locked()) return; ACTS[b.dataset.act]();
}));
document.addEventListener('gesturestart', e => e.preventDefault());
document.addEventListener('dblclick', e => e.preventDefault());
document.addEventListener('contextmenu', e => e.preventDefault());

let wakeLock = null;
async function keepAwake() { try { if ('wakeLock' in navigator) wakeLock = await navigator.wakeLock.request('screen'); } catch (e) {} }

function setWho(w) {
  S.who = w === 'boy' ? 'boy' : 'cat'; save();
  kitty.classList.toggle('as-boy', isBoy());
  document.querySelectorAll('[data-cat]').forEach(b => b.textContent = isBoy() ? b.dataset.boy : b.dataset.cat);
  $('#swap').textContent = isBoy() ? '🐱' : '👦🏽';
}
setWho(S.who);
$('#swap').addEventListener('click', () => {
  if (!ctx || locked()) return;
  wake(); setWho(isBoy() ? 'cat' : 'boy');
  pose('jump', 750); meow({ f: 600, dur: 0.5 });
});

document.querySelectorAll('.go').forEach(btn => btn.addEventListener('click', async () => {
  setWho(btn.dataset.who);
  const msg = $('#startMsg');
  try {
    if (!ctx) initAudio();
    await ctx.resume();
    if (!stream || stream.getAudioTracks().every(t => t.readyState === 'ended')) await initMic();
    else state = 'listen';
    $('#start').hidden = true;
  } catch (err) {
    msg.innerHTML = 'I can\'t hear you yet. To let me listen, a grown-up can allow the <b>Microphone</b> in iPhone Settings → Apps → Safari → Microphone. <br><br>Tap a friend again to play without talking.';
    if (msg.dataset.tried) { $('#start').hidden = true; state = 'off'; }
    msg.dataset.tried = '1';
  }
  keepAwake();
  meow({ f: 560, dur: 0.6 }); pose('happy wave', 1200);
}));

document.addEventListener('visibilitychange', () => {
  if (!ctx) return;
  if (document.hidden) { ctx.suspend(); }
  else {
    keepAwake();
    const dead = stream && stream.getAudioTracks().every(t => t.readyState === 'ended');
    if (dead) { state = 'off'; $('#start').hidden = false; }
    else ctx.resume();
  }
});
document.addEventListener('pointerdown', () => { if (ctx && ctx.state !== 'running' && !document.hidden) ctx.resume(); });

/* grown-up settings: hold the gear */
const gear = $('#gear'); let holdT = 0;
gear.addEventListener('pointerdown', () => { gear.classList.add('holding'); holdT = setTimeout(openSettings, 1500); });
['pointerup','pointerleave','pointercancel'].forEach(ev => gear.addEventListener(ev, () => { clearTimeout(holdT); gear.classList.remove('holding'); }));
function paintSettings() {
  document.querySelectorAll('.seg').forEach(seg => seg.querySelectorAll('button').forEach(b => b.classList.toggle('sel', S[seg.dataset.key] === b.dataset.v)));
}
function openSettings() { gear.classList.remove('holding'); paintSettings(); $('#settings').hidden = false; }
document.querySelectorAll('.seg button').forEach(b => b.addEventListener('click', () => {
  S[b.parentElement.dataset.key] = b.dataset.v; save(); paintSettings();
  if (b.parentElement.dataset.key === 'pitch' && ctx) { const d = new Float32Array(ctx.sampleRate * 0.4); for (let i = 0; i < d.length; i++) d[i] = Math.sin(i / ctx.sampleRate * 2 * Math.PI * 220 * (1 + i / d.length)) * 0.3; }
}));
$('#closeSettings').addEventListener('click', () => { $('#settings').hidden = true; });

mouthOpenEl = $('#mouthOpen');
requestAnimationFrame(frame);
blinkLoop();

if ('serviceWorker' in navigator && location.protocol === 'https:' || location.hostname === 'localhost') {
  navigator.serviceWorker && navigator.serviceWorker.register('sw.js').catch(() => {});
}
})();
