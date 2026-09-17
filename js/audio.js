/**
 * Synthesised sound — no audio files, so the page loads instantly and the
 * whole game stays a handful of KB. Every voice is built from oscillators and
 * filtered noise at runtime.
 */

let ctx = null;
let master = null;
let muted = false;

function ac() {
  if (!ctx) {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    master = ctx.createGain();
    master.gain.value = 0.9;
    master.connect(ctx.destination);
  }
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}

export function setMuted(v) {
  muted = v;
  if (master) master.gain.value = v ? 0 : 0.9;
}
export function isMuted() {
  return muted;
}

function noiseBuffer(seconds = 0.5) {
  const c = ac();
  const buf = c.createBuffer(1, Math.floor(c.sampleRate * seconds), c.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return buf;
}

/** Paper tearing: a bright noise burst that closes fast. */
export function tear() {
  if (muted) return;
  const c = ac();
  const src = c.createBufferSource();
  src.buffer = noiseBuffer(0.35);
  const bp = c.createBiquadFilter();
  bp.type = "bandpass";
  bp.frequency.setValueAtTime(2600, c.currentTime);
  bp.frequency.exponentialRampToValueAtTime(900, c.currentTime + 0.22);
  bp.Q.value = 0.8;
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, c.currentTime);
  g.gain.exponentialRampToValueAtTime(0.5, c.currentTime + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + 0.3);
  src.connect(bp).connect(g).connect(master);
  src.start();
  src.stop(c.currentTime + 0.35);
}

/** Coin chime — FM bell. `step` raises the pitch as the streak grows. */
export function coin(step = 0) {
  if (muted) return;
  const c = ac();
  const base = 880 * Math.pow(2, Math.min(step, 5) / 12);
  const carrier = c.createOscillator();
  const modulator = c.createOscillator();
  const modGain = c.createGain();
  const g = c.createGain();
  carrier.type = "sine";
  carrier.frequency.value = base;
  modulator.type = "sine";
  modulator.frequency.value = base * 3.5;
  modGain.gain.setValueAtTime(base * 2.2, c.currentTime);
  modGain.gain.exponentialRampToValueAtTime(1, c.currentTime + 0.25);
  g.gain.setValueAtTime(0.0001, c.currentTime);
  g.gain.exponentialRampToValueAtTime(0.32, c.currentTime + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + 0.7);
  modulator.connect(modGain).connect(carrier.frequency);
  carrier.connect(g).connect(master);
  modulator.start();
  carrier.start();
  modulator.stop(c.currentTime + 0.75);
  carrier.stop(c.currentTime + 0.75);
}

/** The white envelope: a low funeral gong that swallows the room. */
export function gong() {
  if (muted) return;
  const c = ac();
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, c.currentTime);
  g.gain.exponentialRampToValueAtTime(0.5, c.currentTime + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + 2.6);
  g.connect(master);
  for (const [f, level] of [[92, 1], [138, 0.5], [211, 0.28], [317, 0.14]]) {
    const o = c.createOscillator();
    const og = c.createGain();
    o.type = "sine";
    o.frequency.setValueAtTime(f, c.currentTime);
    o.frequency.exponentialRampToValueAtTime(f * 0.96, c.currentTime + 2.4);
    og.gain.value = level;
    o.connect(og).connect(g);
    o.start();
    o.stop(c.currentTime + 2.7);
  }
  const src = c.createBufferSource();
  src.buffer = noiseBuffer(1.2);
  const lp = c.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.value = 500;
  const ng = c.createGain();
  ng.gain.setValueAtTime(0.18, c.currentTime);
  ng.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + 1.1);
  src.connect(lp).connect(ng).connect(g);
  src.start();
}

/** Banking your grabs: a warm resolved chord. */
export function settle() {
  if (muted) return;
  const c = ac();
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, c.currentTime);
  g.gain.exponentialRampToValueAtTime(0.26, c.currentTime + 0.03);
  g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + 1.5);
  g.connect(master);
  [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => {
    const o = c.createOscillator();
    const og = c.createGain();
    o.type = i > 1 ? "triangle" : "sine";
    o.frequency.value = f;
    og.gain.value = 0.5 / (i + 1);
    o.connect(og).connect(g);
    o.start(c.currentTime + i * 0.055);
    o.stop(c.currentTime + 1.6);
  });
}

/**
 * Metal on metal: one coin landing on others.
 *
 * A struck disc does not ring in a harmonic series, and that irrational
 * spacing between its modes is the whole difference between metal and a beep.
 * `pile` is how many coins are already underneath — a deeper pile damps the
 * ring and drops the pitch, the way a real stack does, so a payout descends
 * in tone as it builds instead of repeating one sample.
 */
export function clink(pile = 0) {
  if (muted) return;
  const c = ac();
  const t = c.currentTime;
  const damp = Math.min(pile, 6) / 6;
  // a little pitch scatter, or a run of these turns into a machine gun
  const base = (3250 - 850 * damp) * (0.93 + Math.random() * 0.15);
  const ring = 0.21 - 0.1 * damp;

  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.1, t + 0.003);
  g.gain.exponentialRampToValueAtTime(0.0001, t + ring);
  g.connect(master);

  for (const [ratio, level] of [[1, 1], [1.593, 0.6], [2.136, 0.36], [2.718, 0.19], [3.42, 0.09]]) {
    const o = c.createOscillator();
    const og = c.createGain();
    o.type = "sine";
    o.frequency.value = base * ratio;
    og.gain.value = level * (1 - 0.35 * damp);
    o.connect(og).connect(g);
    o.start(t);
    o.stop(t + ring + 0.05);
  }

  // the strike itself — a few milliseconds of bright noise
  const src = c.createBufferSource();
  src.buffer = noiseBuffer(0.06);
  const bp = c.createBiquadFilter();
  bp.type = "bandpass";
  bp.frequency.value = 5400 - 1500 * damp;
  bp.Q.value = 1.1;
  const ng = c.createGain();
  ng.gain.setValueAtTime(0.13, t);
  ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.032);
  src.connect(bp).connect(ng).connect(g);
  src.start(t);
}

/** A coin dragged off the top of a stack — brief, dry, barely there. */
export function scrape() {
  if (muted) return;
  const c = ac();
  const t = c.currentTime;
  const src = c.createBufferSource();
  src.buffer = noiseBuffer(0.1);
  const bp = c.createBiquadFilter();
  bp.type = "bandpass";
  bp.frequency.setValueAtTime(2200, t);
  bp.frequency.exponentialRampToValueAtTime(6200, t + 0.07);
  bp.Q.value = 2.4;
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.055, t + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.085);
  src.connect(bp).connect(g).connect(master);
  src.start(t);
}
