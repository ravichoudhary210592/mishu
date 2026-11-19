'use strict';
(() => {
const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
const kitty = $('#kitty'), fx = $('#fx'), gameLayer = $('#game'), voiceBtn = $('#voiceBtn');
const rnd = (a, b) => a + Math.random() * (b - a);
const pick = a => a[Math.floor(Math.random() * a.length)];

/* ---------- settings + progress (per device) ---------- */
const DEF = { pace: '1.2', sens: 'normal', mic: 'on', who: 'cat' };
const PDEF = { stars: 0, unlocked: 0, world: 0, voice: 'squeaky', hat: '' };
function load(k, d) { try { return { ...d, ...JSON.parse(localStorage.getItem(k) || '{}') }; } catch (e) { return { ...d }; } }
let S = load('mishu', DEF), P = load('mishu-progress', PDEF);
const save = () => { try { localStorage.setItem('mishu', JSON.stringify(S)); localStorage.setItem('mishu-progress', JSON.stringify(P)); } catch (e) {} };
const SENS = { quiet: 0.010, normal: 0.018, noisy: 0.035 };

/* ---------- voices ---------- */
const VOICES = [
  { id: 'squeaky', icon: '🐭', pitch: 1.5 },
  { id: 'chip',    icon: '🐿️', pitch: 1.85 },
  { id: 'baby',    icon: '👶', pitch: 1.35, vib: [6, 0.025] },
  { id: 'giant',   icon: '🦕', pitch: 0.72, pace: 1.1 },
  { id: 'robot',   icon: '🤖', pitch: 1.1, ring: 70 },
  { id: 'echo',    icon: '🏔️', pitch: 1.3, echo: true },
  { id: 'under',   icon: '🐠', pitch: 1.3, water: true },
  { id: 'jelly',   icon: '🍮', pitch: 1.45, vib: [9, 0.08] },
  { id: 'monster', icon: '👹', pitch: 0.62, growl: true },
  { id: 'alien',   icon: '👽', pitch: 1.6, ring: 35, flange: true },
];

/* ---------- worlds (stages) ---------- */
const PER = 20; // stars per new world
const WORLDS = [
  { id: 'home',   icon: '🏠', game: ['🫧'], voices: ['squeaky', 'chip', 'baby', 'giant'], hat: '🎀', decor: [] },
  { id: 'garden', icon: '🌳', game: ['🦋'], voices: ['robot', 'echo'], hat: '🎩',
    decor: [['🌳', 10, 50, 96], ['🌷', 28, 60, 40], ['🌼', 72, 61, 36], ['🌻', 90, 54, 60], ['☀️', 82, 14, 64], ['🐝', 24, 24, 30], ['☁️', 50, 12, 56]] },
  { id: 'beach',  icon: '🏖️', game: ['🐠', '🐟', '🐡'], voices: ['under', 'jelly'], hat: '👒',
    decor: [['🌴', 9, 44, 110], ['☀️', 82, 12, 64], ['⛵', 64, 46, 42], ['🐚', 84, 84, 34], ['🦀', 14, 86, 40], ['🐬', 40, 50, 34]] },
  { id: 'space',  icon: '🚀', game: ['⭐', '🌟'], voices: ['monster', 'alien'], hat: '👑',
    decor: [['🪐', 78, 16, 70], ['🌙', 14, 14, 56], ['🚀', 88, 46, 52], ['✨', 32, 26, 30], ['🛸', 46, 34, 40], ['🌍', 12, 48, 44]] },
  { id: 'party',  icon: '🎉', game: ['🎈'], voices: [], hat: '🧢',
    decor: [['🎈', 8, 24, 60], ['🎈', 90, 30, 60], ['🎁', 12, 80, 46], ['🎊', 80, 14, 50], ['🧁', 86, 80, 40], ['🎉', 30, 12, 40]] },
];
const unlockedVoices = () => WORLDS.slice(0, P.unlocked + 1).flatMap(w => w.voices);
const unlockedHats = () => WORLDS.slice(0, P.unlocked + 1).map(w => w.hat);
const VOICE = () => VOICES.find(v => v.id === P.voice && unlockedVoices().includes(v.id)) || VOICES[0];

/* ---------- audio ---------- */
let ctx, master, voiceBus, analyser, talkGain, stream, proc;
let state = 'off';            // off | listen | record | play
let busyUntil = 0;            // mic ignored until then (own sounds)
let actUntil = 0;             // no new action until then
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
  voiceBtn.classList.toggle('on', S.mic === 'on' && state !== 'off');
  if (S.mic !== 'on' || state === 'off' || state === 'play' || now < busyUntil) {
    ring.length = 0; loudRun = 0; if (state === 'record') { state = 'listen'; endHear(); } return;
  }
  const thr = Math.max(SENS[S.sens] || SENS.normal, floor * 3);
  voiceBtn.style.setProperty('--lvl', Math.min(1, rms / thr).toFixed(2));
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

function startHear() { wake(); voiceBtn.classList.add('hear'); if (!busyPose()) pose('listen', 0); }
function endHear() { voiceBtn.classList.remove('hear'); if (cur === 'listen') pose(null); }

function finishRecording(chunkMs) {
  endHear();
  if (voicedMs < 260) { state = 'listen'; rec = []; return; }
  const keep = Math.max(1, rec.length - Math.floor(Math.max(0, silentMs - 200) / chunkMs));
  const parts = rec.slice(0, keep); rec = [];
  const len = parts.reduce((a, p) => a + p.length, 0);
  const data = new Float32Array(len); let o = 0;
  for (const p of parts) { data.set(p, o); o += p.length; }
  const f = Math.min(400, len >> 3);
  for (let i = 0; i < f; i++) { data[i] *= i / f; data[len - 1 - i] *= i / f; }
  playVoice(data, true);
}

/* Time-stretch without changing pitch (WSOLA). Lets us raise the pitch
   while keeping the words at a calm, child-friendly pace. */
function stretch(x, factor, sr) {
  const N = (Math.round(sr * 0.04) >> 1) << 1, Hs = N >> 1, tol = Math.round(sr * 0.01);
  if (Math.abs(factor - 1) < 0.02 || x.length < N * 2) return x;
  const win = new Float32Array(N);
  for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / N);
  const outLen = Math.floor(x.length * factor);
  const out = new Float32Array(outLen + N);
  let prev = 0;
  for (let o = 0; o < outLen; o += Hs) {
    const nominal = Math.round(o / factor);
    let best = nominal;
    if (o > 0) {
      const nat = prev + Hs; let bestC = -Infinity;
      const lo = Math.max(0, nominal - tol), hi = Math.min(x.length - N, nominal + tol);
      for (let p = lo; p <= hi; p += 2) {
        let c = 0;
        for (let i = 0; i < N; i += 8) c += x[p + i] * (x[nat + i] || 0);
        if (c > bestC) { bestC = c; best = p; }
      }
    }
    best = Math.max(0, Math.min(x.length - N, best));
    for (let i = 0; i < N; i++) out[o + i] += x[best + i] * win[i];
    prev = best;
  }
  return out.subarray(0, outLen);
}

function buildFx(v, src, dest) {
  const nodes = [], mk = n => (nodes.push(n), n);
  let head = src, tail = 0;
  if (v.vib) {
    const l = mk(ctx.createOscillator()); l.frequency.value = v.vib[0];
    const g = mk(ctx.createGain()); g.gain.value = v.vib[1] * v.pitch;
    l.connect(g); g.connect(src.playbackRate); l.start();
  }
  if (v.ring) {
    const o = mk(ctx.createOscillator()); o.frequency.value = v.ring;
    const rg = mk(ctx.createGain()); rg.gain.value = 0; o.connect(rg.gain); o.start();
    const dry = mk(ctx.createGain()); dry.gain.value = 0.35;
    const mix = mk(ctx.createGain());
    head.connect(rg); rg.connect(mix); head.connect(dry); dry.connect(mix); head = mix;
  }
  if (v.growl) {
    const ws = mk(ctx.createWaveShaper()); const c = new Float32Array(1024);
    for (let i = 0; i < c.length; i++) { const x = i / 512 - 1; c[i] = Math.tanh(3 * x); }
    ws.curve = c;
    const lp = mk(ctx.createBiquadFilter()); lp.type = 'lowpass'; lp.frequency.value = 2000;
    const g = mk(ctx.createGain()); g.gain.value = 0.6;
    head.connect(ws); ws.connect(lp); lp.connect(g); head = g;
  }
  if (v.water) {
    const lp = mk(ctx.createBiquadFilter()); lp.type = 'lowpass'; lp.frequency.value = 1100; lp.Q.value = 7;
    const l = mk(ctx.createOscillator()); l.frequency.value = 3;
    const lg = mk(ctx.createGain()); lg.gain.value = 500; l.connect(lg); lg.connect(lp.frequency); l.start();
    head.connect(lp); head = lp;
  }
  if (v.flange) {
    const d = mk(ctx.createDelay(0.02)); d.delayTime.value = 0.004;
    const l = mk(ctx.createOscillator()); l.frequency.value = 0.8;
    const lg = mk(ctx.createGain()); lg.gain.value = 0.003; l.connect(lg); lg.connect(d.delayTime); l.start();
    const mix = mk(ctx.createGain()); head.connect(mix); head.connect(d); d.connect(mix); head = mix;
  }
  if (v.echo) {
    const d = mk(ctx.createDelay(1)); d.delayTime.value = 0.28;
    const fb = mk(ctx.createGain()); fb.gain.value = 0.45;
    const mix = mk(ctx.createGain());
    head.connect(mix); head.connect(d); d.connect(fb); fb.connect(d); d.connect(mix); head = mix; tail = 1.3;
  }
  head.connect(dest);
  return { tail, stop() { nodes.forEach(n => { try { if (n.stop) n.stop(); } catch (e) {} try { n.disconnect(); } catch (e) {} }); } };
}

let lastClip = null;
function playVoice(data, fresh) {
  if (fresh) lastClip = data;
  const v = VOICE();
  const pace = (parseFloat(S.pace) || 1.2) * (v.pace || 1);
  const st = stretch(data, v.pitch * pace, ctx.sampleRate);
  state = 'play';
  const buf = ctx.createBuffer(1, st.length, ctx.sampleRate);
  buf.getChannelData(0).set(st);
  const src = ctx.createBufferSource();
  src.buffer = buf; src.playbackRate.value = v.pitch;
  const chain = buildFx(v, src, talkGain);
  pose('talk', 0);
  src.onended = () => {
    setTimeout(() => {
      chain.stop(); if (cur === 'talk') pose(null);
      busyUntil = performance.now() + 450; state = stream ? 'listen' : 'off';
    }, chain.tail * 1000);
  };
  src.start();
  if (fresh) addStars(1);
}
window.__mishuPlay = d => playVoice(d, true); // test hook

/* ---------- synthesised sounds (all original) ---------- */
function env(g, t, a, peak, d) { g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(peak, t + a); g.gain.exponentialRampToValueAtTime(0.0001, t + a + d); }
function busy(sec) { busyUntil = Math.max(busyUntil, performance.now() + sec * 1000 + 450); }
const isBoy = () => S.who === 'boy';

function yay(opts = {}) {
  const t = ctx.currentTime + (opts.delay || 0), dur = opts.dur || 0.5, base = (opts.f || 520) * 0.7;
  const o = ctx.createOscillator(); o.type = 'sawtooth';
  o.frequency.setValueAtTime(base, t);
  o.frequency.exponentialRampToValueAtTime(base * 1.35, t + dur * 0.5);
  o.frequency.exponentialRampToValueAtTime(base * (opts.end || 1.1), t + dur);
  const g = ctx.createGain(); env(g, t, 0.04, opts.vol || 0.55, dur);
  const mix = ctx.createGain();
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
function boing() { const t = ctx.currentTime; const o = blip(180, t, 0.35, 0.5, 'sine', master); o.frequency.exponentialRampToValueAtTime(700, t + 0.3); busy(0.4); }
function bonk() { const t = ctx.currentTime; const o = blip(320, t, 0.18, 0.5, 'square', master); o.frequency.exponentialRampToValueAtTime(90, t + 0.15); busy(0.3); }
function popSnd() { const t = ctx.currentTime; const o = blip(rnd(600, 1000), t, 0.09, 0.45, 'square', master); o.frequency.exponentialRampToValueAtTime(140, t + 0.08); noise(t, 0.06, 2500, 1, 0.4); busy(0.2); }
function bang() { const t = ctx.currentTime; noise(t, 0.35, 900, 0.6, 1); const o = blip(140, t, 0.25, 0.8, 'sine', master); o.frequency.exponentialRampToValueAtTime(40, t + 0.25); busy(0.5); }
function brr() { const t = ctx.currentTime; for (let i = 0; i < 8; i++) blip(isBoy() ? 260 : 330, t + i * 0.07, 0.06, 0.35, 'sawtooth'); busy(0.7); }
function drumHit(t, low) {
  const o = blip(low ? 110 : 190, t, 0.2, 0.9, 'sine', master); o.frequency.exponentialRampToValueAtTime(45, t + 0.18);
  noise(t, 0.06, low ? 400 : 3000, 1, 0.35);
}
function inflate(sec) { noise(ctx.currentTime, sec, 300, 3, 0.25, 1500); busy(sec); }
function fanfare() {
  const t = ctx.currentTime;
  [523, 659, 784, 1047].forEach((f, i) => { blip(f, t + i * 0.13, 0.16, 0.35, 'triangle', master); blip(f * 2, t + i * 0.13, 0.12, 0.08, 'square', master); });
  [523, 659, 784].forEach(f => blip(f, t + 0.6, 0.9, 0.22, 'triangle', master));
  busy(1.6);
}
function lullaby() {
  const t = ctx.currentTime + 0.1;
  [784, 659, 698, 587, 659, 523].forEach((f, i) => blip(f, t + i * 0.45, 0.5, 0.12, 'sine', master));
  busy(2.8);
}

const SONG = [ // original little tune: [semitones from C5, beats]
  [4,1],[7,1],[4,1],[0,1],[2,1],[4,1],[2,2],
  [0,1],[2,1],[4,1],[7,1],[9,1],[7,1],[4,2],
  [7,1],[4,1],[2,1],[0,1],[2,1],[4,1],[0,2]];
function song() {
  const beat = 0.28; let t = ctx.currentTime + 0.05;
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
const POSES = ['listen','talk','ouch','giggle','happy','jump','wave','eat','eat-done','play','sing','sleep','hot','shiver','blow'];
let cur = null, poseTimer = 0;
function pose(name, ms) {
  clearTimeout(poseTimer);
  kitty.classList.remove(...POSES);
  cur = name;
  if (name) kitty.classList.add(...name.split(' '));
  if (name && ms) poseTimer = setTimeout(() => pose(null), ms);
}
const busyPose = () => cur && cur !== 'listen' && cur !== 'sleep';
function locked() { return state === 'play' || performance.now() < actUntil; }
function hold(sec) { actUntil = performance.now() + sec * 1000; }

const tbuf = new Uint8Array(512);
const mouthOpenEl = $('#mouthOpen');
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
function look(x, y) {
  const r = kitty.getBoundingClientRect();
  const cx = r.left + r.width / 2, cy = r.top + r.height * 0.36;
  const dx = Math.max(-1, Math.min(1, (x - cx) / (r.width / 2))), dy = Math.max(-1, Math.min(1, (y - cy) / (r.height / 2)));
  $$('.pupil').forEach(p => p.style.transform = `translate(${dx * 8}px,${dy * 8}px)`);
}

/* ---------- effects ---------- */
function anchor(el) { const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }
const mouthPt = () => anchor($('#mouthAnchor'));
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
function confetti(n = 40) {
  for (let i = 0; i < n; i++) {
    const s = document.createElement('span'); s.className = 'confetti';
    s.textContent = pick(['🎉', '✨', '⭐', '🎊', '💖', '🌈']);
    s.style.left = rnd(0, 100) + 'vw'; s.style.setProperty('--dur', rnd(2, 3.6) + 's'); s.style.setProperty('--rot', rnd(-540, 540) + 'deg');
    s.style.animationDelay = rnd(0, 0.8) + 's';
    s.addEventListener('animationend', () => s.remove());
    document.body.appendChild(s);
  }
}
function item(emoji, x, y, size = 64) {
  const s = document.createElement('div'); s.className = 'big-item'; s.textContent = emoji;
  s.style.left = x + 'px'; s.style.top = y + 'px'; s.style.fontSize = size + 'px';
  fx.appendChild(s); return s;
}
function flyTo(emoji, done) {
  const m = mouthPt();
  const s = document.createElement('div'); s.className = 'fly'; s.textContent = emoji;
  s.style.left = (window.innerWidth / 2) + 'px'; s.style.top = (window.innerHeight - 70) + 'px';
  fx.appendChild(s);
  requestAnimationFrame(() => requestAnimationFrame(() => { s.style.left = m.x + 'px'; s.style.top = (m.y + 30) + 'px'; s.style.transform = 'translate(-50%,-50%) scale(.8)'; }));
  setTimeout(() => done(s), 650);
}

/* ---------- stars + worlds ---------- */
function paintStars() {
  $('#starCount').textContent = P.stars;
  const last = P.unlocked >= WORLDS.length - 1;
  const frac = last ? 1 : Math.min(1, (P.stars - P.unlocked * PER) / PER);
  $('#starBar').style.width = (Math.max(0, frac) * 100) + '%';
}
function addStars(n, x, y) {
  const pill = $('#starPill');
  if (x === undefined) { const m = mouthPt(); x = m.x; y = m.y - 60; }
  const s = document.createElement('span'); s.className = 'starfly'; s.textContent = '⭐';
  s.style.left = x + 'px'; s.style.top = y + 'px'; document.body.appendChild(s);
  const t = anchor(pill.querySelector('.st'));
  requestAnimationFrame(() => requestAnimationFrame(() => { s.style.left = t.x + 'px'; s.style.top = t.y + 'px'; s.style.transform = 'translate(-50%,-50%) scale(.7)'; }));
  setTimeout(() => {
    s.remove(); P.stars += n; pill.classList.remove('bump'); void pill.offsetWidth; pill.classList.add('bump');
    blip(1320, ctx.currentTime, 0.08, 0.15, 'triangle', master);
    if (P.unlocked < WORLDS.length - 1 && P.stars >= (P.unlocked + 1) * PER) { P.unlocked++; save(); paintStars(); setTimeout(() => celebrate(P.unlocked), 700); }
    save(); paintStars();
  }, 720);
}
function celebrate(i) {
  const w = WORLDS[i];
  confetti(46); fanfare(); pose('jump happy', 900);
  $('#partyIcon').textContent = w.icon;
  $('#partyGifts').textContent = [...w.voices.map(id => VOICES.find(v => v.id === id).icon), w.hat].join('');
  $('#party').hidden = false;
  $('#partyGo').onclick = () => { $('#party').hidden = true; setWorld(i); };
}
function setWorld(i) {
  P.world = Math.max(0, Math.min(P.unlocked, i)); save();
  const w = WORLDS[P.world];
  document.body.dataset.world = w.id;
  $('#gameBtn').textContent = w.game[0];
  const dec = $('#decor'); dec.innerHTML = '';
  for (const [e, l, t, sz] of w.decor) {
    const s = document.createElement('span'); s.textContent = e;
    s.style.left = l + '%'; s.style.top = t + '%'; s.style.fontSize = sz + 'px'; s.style.animationDelay = rnd(0, 3) + 's';
    dec.appendChild(s);
  }
}
function openMap() {
  closeTray();
  const box = $('#worlds'); box.innerHTML = '';
  WORLDS.forEach((w, i) => {
    const b = document.createElement('button'); b.textContent = w.icon;
    if (i > P.unlocked) b.classList.add('locked');
    if (i === P.world) b.classList.add('here');
    b.onclick = () => {
      if (i > P.unlocked) { b.classList.add('nope'); setTimeout(() => b.classList.remove('nope'), 400); bonk(); return; }
      $('#map').hidden = true; setWorld(i); if (ctx) { boing(); pose('jump happy', 800); }
    };
    box.appendChild(b);
  });
  $('#map').hidden = false;
}

/* ---------- trays: food, toys, hats, voices ---------- */
let trayName = null;
function closeTray() { $('#tray').hidden = true; trayName = null; $$('#toys button').forEach(b => b.classList.remove('open')); }
function openTray(name) {
  if (trayName === name) return closeTray();
  closeTray(); trayName = name;
  const inner = $('#tray .tray-inner'); inner.innerHTML = '';
  let items = [];
  if (name === 'food') items = [['🥛', 'milk'], [isBoy() ? '🍪' : '🐟', 'fish'], ['🍌', 'banana'], ['🍦', 'icecream'], ['🎂', 'cake'], ['🌶️', 'chili']];
  if (name === 'toys') items = [[isBoy() ? '⚽' : '🧶', 'yarn'], ['🥁', 'drum'], ['🪶', 'feather'], ['🎁', 'gift'], ['🎈', 'balloon'], ['🎵', 'song']];
  if (name === 'hats') {
    const have = unlockedHats();
    items = [['🚫', 'hat:', false, P.hat === '']].concat(WORLDS.map(w => [w.hat, 'hat:' + w.hat, !have.includes(w.hat), P.hat === w.hat]));
  }
  if (name === 'voices') {
    const have = unlockedVoices();
    items = VOICES.map(v => [v.icon, 'voice:' + v.id, !have.includes(v.id), VOICE().id === v.id]);
  }
  for (const [emoji, act, isLocked, sel] of items) {
    const b = document.createElement('button'); b.textContent = emoji;
    if (isLocked) b.classList.add('locked'); if (sel) b.classList.add('sel');
    b.onclick = () => {
      if (isLocked) { b.classList.add('nope'); setTimeout(() => b.classList.remove('nope'), 400); if (ctx) bonk(); return; }
      closeTray(); doAct(act);
    };
    inner.appendChild(b);
  }
  $('#tray').hidden = false;
  const btn = document.querySelector(`[data-tray="${name}"]`); if (btn) btn.classList.add('open');
}

function doAct(act) {
  if (!ctx) return;
  wake();
  if (act.startsWith('hat:')) return setHat(act.slice(4));
  if (act.startsWith('voice:')) return setVoice(act.slice(6));
  if (locked() || gameOn) return;
  ACTS[act]();
}
function setHat(h) {
  P.hat = h; save(); $('#hat').textContent = h;
  if (ctx) { boing(); pose('happy', 900); burst('✨', window.innerWidth / 2, mouthPt().y - 170, 4); }
}
function setVoice(id) {
  P.voice = id; save(); $('#voiceIcon').textContent = VOICE().icon;
  if (state === 'play') return;
  if (lastClip) playVoice(lastClip, false);
  else { meow({ f: 600, dur: 0.5 }); pose('happy', 800); }
}

const ACTS = {
  milk() {
    hold(3.4);
    flyTo('🥛', s => {
      pose('eat'); slurp(3);
      setTimeout(() => { s.remove(); pose('eat-done happy', 1600); meow({ f: 480, dur: 0.5 }); purr(1.2); const m = mouthPt(); burst(['💗', '🥛'], m.x, m.y - 40, 5); addStars(1); }, 1300);
    });
  },
  fish() { eatThing(isBoy() ? '🍪' : '🐟', () => { meow({ f: 420, dur: 0.7, end: 0.7 }); return ['😋', '💗']; }); },
  banana() { eatThing('🍌', () => { meow({ f: 560, dur: 0.5, end: 1.2 }); return ['🍌', '😋']; }); },
  cake() { eatThing('🎂', () => { fanfare(); confetti(18); return ['🎉', '💖']; }); },
  icecream() {
    hold(4);
    flyTo('🍦', s => {
      pose('eat'); slurp(2);
      setTimeout(() => {
        s.remove(); pose('shiver', 1500); brr(); const m = mouthPt(); burst('❄️', m.x, m.y - 80, 6);
        setTimeout(() => { pose('happy', 900); meow({ f: 520, dur: 0.4 }); addStars(1); }, 1600);
      }, 900);
    });
  },
  chili() {
    hold(4.4);
    flyTo('🌶️', s => {
      pose('eat'); munch(2);
      setTimeout(() => {
        s.remove(); pose('hot', 2000); meow({ f: 900, dur: 0.9, end: 1.4 });
        let k = 0; const iv = setInterval(() => { const m = mouthPt(); burst('🔥', m.x, m.y, 2); if (++k > 5) clearInterval(iv); }, 300);
        setTimeout(() => { flyTo('🥛', g => { pose('eat'); slurp(2); setTimeout(() => { g.remove(); pose('happy', 900); addStars(1); }, 800); }); }, 2000);
      }, 700);
    });
  },
  yarn() {
    hold(3.4);
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
        pose('happy', 1200); meow({ f: 600, dur: 0.45 }); addStars(1);
        setTimeout(() => b.remove(), 800);
      }, 1700);
    }, 720);
  },
  drum() {
    hold(3.2);
    const r = kitty.getBoundingClientRect();
    const d = item('🥁', r.left + r.width / 2, r.top + r.height * 0.8, 90);
    pose('play');
    const t = ctx.currentTime + 0.05;
    [1, 0, 0, 1, 0, 0, 1, 0, 1, 1].forEach((low, i) => {
      drumHit(t + i * 0.24, low);
      setTimeout(() => { d.style.transform = 'translate(-50%,-50%) scale(1.15)'; setTimeout(() => d.style.transform = '', 100); }, i * 240 + 50);
    });
    busy(2.6);
    setTimeout(() => { d.remove(); pose('happy', 1000); meow({ f: 640, dur: 0.4 }); burst(['🎶', '⭐'], r.left + r.width / 2, r.top + r.height * 0.5, 4); addStars(1); }, 2500);
  },
  feather() {
    hold(2.8);
    const r = kitty.getBoundingClientRect();
    const f = item('🪶', r.left + r.width / 2, r.top + r.height * 0.78, 70);
    let k = 0; const iv = setInterval(() => { f.style.transform = `translate(-50%,-50%) rotate(${k++ % 2 ? 30 : -30}deg)`; }, 140);
    pose('giggle'); giggleSnd(); setTimeout(giggleSnd, 900);
    setTimeout(() => { clearInterval(iv); f.remove(); pose('happy', 900); burst(['😆', '💗'], r.left + r.width / 2, r.top + r.height * 0.6, 4); addStars(1); }, 2000);
  },
  gift() {
    hold(3.6);
    const r = kitty.getBoundingClientRect();
    const x = r.left + r.width / 2, y = r.top + r.height * 0.82;
    const g = item('🎁', x, y, 96);
    let k = 0; const iv = setInterval(() => { g.style.transform = `translate(-50%,-50%) rotate(${k++ % 2 ? 12 : -12}deg)`; }, 110);
    pose('listen');
    setTimeout(() => {
      clearInterval(iv); g.remove(); popSnd(); boing();
      const s = document.createElement('div'); s.className = 'surprise';
      s.textContent = pick(['🦄', '🌈', '🐣', '🧸', '🍭', '🐶', '🦖', '🚂', '🐘', '🦋']);
      s.style.left = x + 'px'; s.style.top = (y - 60) + 'px'; fx.appendChild(s);
      requestAnimationFrame(() => requestAnimationFrame(() => s.style.transform = 'translate(-50%,-50%) scale(1)'));
      pose('jump happy', 900); meow({ f: 700, dur: 0.6, end: 1.3, delay: 0.1 }); confetti(14);
      setTimeout(() => { s.style.opacity = 0; setTimeout(() => s.remove(), 400); addStars(1); }, 1900);
    }, 1200);
  },
  balloon() {
    hold(4.2);
    const m = mouthPt();
    const b = item('🎈', m.x, m.y + 10, 30);
    pose('blow'); inflate(1.8);
    let sz = 30; const iv = setInterval(() => { sz += 7; b.style.fontSize = sz + 'px'; b.style.top = (m.y + 10 - sz * 0.35) + 'px'; }, 70);
    setTimeout(() => {
      clearInterval(iv); b.remove(); bang(); burst(['💥', '✨'], m.x, m.y - 50, 5);
      pose('ouch', 800);
      setTimeout(() => { pose('giggle', 1100); giggleSnd(); addStars(1); }, 850);
    }, 1900);
  },
  song() {
    pose('sing', 0);
    const total = song(); hold(total);
    const r = kitty.getBoundingClientRect();
    const ni = setInterval(() => burst(['🎵', '🎶'], r.left + r.width * (0.25 + Math.random() * 0.5), r.top + r.height * 0.2, 1), 450);
    setTimeout(() => { clearInterval(ni); pose('happy', 900); addStars(1); }, total * 1000);
  },
};
function eatThing(emoji, after) {
  hold(3.2);
  flyTo(emoji, s => {
    pose('eat'); munch(4); let k = 0;
    const shrink = setInterval(() => { s.style.transform = `translate(-50%,-50%) scale(${0.8 - (++k) * 0.18})`; }, 320);
    setTimeout(() => { clearInterval(shrink); s.remove(); pose('eat-done happy', 1500); const m = mouthPt(); burst(after(), m.x, m.y - 40, 4); addStars(1); }, 1300);
  });
}

/* ---------- mini-game: things float up, tap to pop ---------- */
let gameOn = false;
function startGame() {
  if (!ctx || gameOn || locked()) return;
  closeTray(); wake(); gameOn = true;
  const w = WORLDS[P.world]; let spawned = 0;
  pose('happy', 800); meow({ f: 640, dur: 0.5 });
  const iv = setInterval(() => {
    if (spawned++ >= 14) { clearInterval(iv); setTimeout(endGame, 5500); return; }
    const g = document.createElement('div'); g.className = 'gitem';
    const sp = document.createElement('span'); sp.textContent = pick(w.game); g.appendChild(sp);
    g.style.left = rnd(14, 86) + '%';
    g.style.setProperty('--dur', rnd(5.5, 7.5) + 's'); sp.style.setProperty('--dx', rnd(-40, 40) + 'px'); sp.style.setProperty('--sw', rnd(1.2, 2.2) + 's');
    g.addEventListener('animationend', () => g.remove());
    g.addEventListener('pointerdown', e => {
      e.stopPropagation();
      const r = g.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2;
      g.remove(); popSnd(); burst(['✨', '💫'], x, y, 3);
      if (!busyPose()) pose('happy', 500);
      if (Math.random() < 0.3) meow({ f: rnd(560, 820), dur: 0.3, end: 1.2 });
      addStars(1, x, y);
    });
    gameLayer.appendChild(g);
  }, 850);
}
function endGame() {
  gameOn = false; gameLayer.innerHTML = '';
  fanfare(); pose('jump happy', 900); confetti(20);
}

/* ---------- sleep (idle or lights off) ---------- */
let zzzTimer = 0, sleeping = false;
function startSleep(lightsOff) {
  closeTray(); sleeping = true;
  if (lightsOff) { $('#night').hidden = false; lullaby(); }
  pose('sleep', 0);
  clearInterval(zzzTimer);
  zzzTimer = setInterval(() => {
    const m = mouthPt();
    const z = document.createElement('span'); z.className = 'zzz'; z.textContent = 'z';
    z.style.left = (m.x + 70) + 'px'; z.style.top = (m.y - 120) + 'px'; z.style.setProperty('--dx', '40px');
    z.addEventListener('animationend', () => z.remove()); fx.appendChild(z);
  }, 1200);
}
function wake() {
  lastActive = performance.now();
  if (!sleeping) return;
  sleeping = false; clearInterval(zzzTimer); $('#night').hidden = true;
  if (ctx) meow({ f: 380, dur: 0.9, end: 0.7 });
  pose('jump happy', 900);
}
setInterval(() => {
  if (state !== 'off' && !sleeping && cur === null && !gameOn && performance.now() - lastActive > 60000) startSleep(false);
}, 2000);
$('#night').addEventListener('pointerdown', e => { e.stopPropagation(); wake(); });

/* ---------- touching the character ---------- */
let bellyTaps = 0, bellyTimer = 0, down = null, lastPet = 0;
function touchZone(zone, x, y) {
  wake();
  if (locked()) return;
  const m = mouthPt();
  switch (zone) {
    case 'head': bonk(); meow({ f: 700, dur: 0.35, end: 0.6, delay: 0.08 }); pose('ouch', 900); burst(['⭐', '✨'], x, y - 20, 4); break;
    case 'belly':
      bellyTaps++; clearTimeout(bellyTimer); bellyTimer = setTimeout(() => bellyTaps = 0, 2500);
      if (bellyTaps >= 3) { purr(1.8); pose('happy', 1900); burst('💗', m.x, m.y - 60, 6); bellyTaps = 0; }
      else { giggleSnd(); pose('giggle', 1000); burst(['💗', '😆'], x, y, 3); }
      break;
    case 'tail': boing(); meow({ f: 640, dur: 0.5, delay: 0.15 }); pose('jump', 750); burst('❗', m.x + 60, m.y - 160, 1); break;
    case 'paw': meow({ f: 760, dur: 0.3, end: 1.1 }); pose('wave happy', 1100); burst(isBoy() ? '👍' : '👋', x, y - 30, 1); break;
  }
}
function pet(x, y) {
  const now = performance.now();
  if (now - lastPet < 1400 || locked()) return;
  lastPet = now; wake();
  purr(1.3); pose('happy', 1400); burst('💗', x, y - 20, 3);
  addStars(1, x, y);
}
kitty.addEventListener('pointerdown', e => {
  closeTray(); look(e.clientX, e.clientY);
  const z = e.target.closest('[data-zone]');
  down = { x: e.clientX, y: e.clientY, zone: z && z.dataset.zone, moved: 0 };
});
kitty.addEventListener('pointermove', e => {
  look(e.clientX, e.clientY);
  if (!down) return;
  down.moved += Math.hypot(e.clientX - down.x, e.clientY - down.y); down.x = e.clientX; down.y = e.clientY;
  if (down.moved > 120) { down.moved = 0; down.petted = true; pet(e.clientX, e.clientY); }
});
['pointerup', 'pointercancel', 'pointerleave'].forEach(ev => kitty.addEventListener(ev, e => {
  if (!down) return;
  if (ev === 'pointerup' && !down.petted && down.moved < 20 && down.zone) touchZone(down.zone, e.clientX, e.clientY);
  down = null;
}));
document.addEventListener('pointermove', e => { if (!down) look(e.clientX, e.clientY); });

/* ---------- wiring ---------- */
$$('[data-tray]').forEach(b => b.addEventListener('click', () => { if (ctx) { wake(); openTray(b.dataset.tray); } }));
voiceBtn.addEventListener('click', () => { if (ctx) openTray('voices'); });
$('#gameBtn').addEventListener('click', startGame);
$('#sleepBtn').addEventListener('click', () => { if (!ctx || gameOn) return; if (sleeping) wake(); else { hold(1); startSleep(true); } });
$('#mapBtn').addEventListener('click', openMap);
$('#mapClose').addEventListener('click', () => $('#map').hidden = true);
$('#room').addEventListener('pointerdown', closeTray);
document.addEventListener('gesturestart', e => e.preventDefault());
document.addEventListener('dblclick', e => e.preventDefault());
document.addEventListener('contextmenu', e => e.preventDefault());

let wakeLock = null;
async function keepAwake() { try { if ('wakeLock' in navigator) wakeLock = await navigator.wakeLock.request('screen'); } catch (e) {} }

function setWho(w) {
  S.who = w === 'boy' ? 'boy' : 'cat'; save();
  kitty.classList.toggle('as-boy', isBoy());
  $('#swap').textContent = isBoy() ? '🐱' : '👦🏽';
}
$('#swap').addEventListener('click', () => {
  if (!ctx || locked() || gameOn) return;
  wake(); closeTray(); setWho(isBoy() ? 'cat' : 'boy');
  pose('jump', 750); meow({ f: 600, dur: 0.5 });
});

$$('.go').forEach(btn => btn.addEventListener('click', async () => {
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
['pointerup', 'pointerleave', 'pointercancel'].forEach(ev => gear.addEventListener(ev, () => { clearTimeout(holdT); gear.classList.remove('holding'); }));
function paintSettings() {
  $$('.seg[data-key]').forEach(seg => seg.querySelectorAll('button').forEach(b => b.classList.toggle('sel', S[seg.dataset.key] === b.dataset.v)));
}
function openSettings() { gear.classList.remove('holding'); closeTray(); paintSettings(); $('#settings').hidden = false; }
$$('.seg[data-key] button').forEach(b => b.addEventListener('click', () => { S[b.parentElement.dataset.key] = b.dataset.v; save(); paintSettings(); }));
$('#unlockAll').addEventListener('click', () => { P.unlocked = WORLDS.length - 1; P.stars = Math.max(P.stars, P.unlocked * PER); save(); paintStars(); alert('All worlds, voices and hats are unlocked.'); });
$('#resetAll').addEventListener('click', () => { if (confirm('Start over from the first world? Stars, worlds, voices and hats go back to the start.')) { P = { ...PDEF }; save(); paintStars(); setWorld(0); setHat(''); $('#voiceIcon').textContent = VOICE().icon; } });
$('#closeSettings').addEventListener('click', () => { $('#settings').hidden = true; });

/* ---------- boot ---------- */
setWho(S.who);
setWorld(P.world);
$('#hat').textContent = P.hat;
$('#voiceIcon').textContent = VOICE().icon;
paintStars();
requestAnimationFrame(frame);
blinkLoop();
window.__mishu = { P, WORLDS, VOICES, stretch, celebrate, setWorld, startGame, ACTS, get state() { return state; } };

if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
})();
