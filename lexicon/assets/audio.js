/* Lexicon Rush - Web Audio chiptune SFX (no external assets) */
(function (root) {
  "use strict";

  let ctx = null;
  let master = null;
  let muted = false;

  function ensure() {
    if (!ctx) {
      const AC = root.AudioContext || root.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.16;
      master.connect(ctx.destination);
    }
    if (ctx.state === "suspended") ctx.resume();
    return ctx;
  }

  function tone(freq, dur, type, when, gain, slideTo) {
    const c = ensure();
    if (!c || muted) return;
    const t0 = c.currentTime + (when || 0);
    const osc = c.createOscillator();
    const g = c.createGain();
    osc.type = type || "square";
    osc.frequency.setValueAtTime(freq, t0);
    if (slideTo) osc.frequency.linearRampToValueAtTime(slideTo, t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain == null ? 0.6 : gain, t0 + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g);
    g.connect(master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  function noise(dur, when, gain) {
    const c = ensure();
    if (!c || muted) return;
    const t0 = c.currentTime + (when || 0);
    const len = Math.max(1, Math.floor(c.sampleRate * dur));
    const buf = c.createBuffer(1, len, c.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = c.createBufferSource();
    const g = c.createGain();
    g.gain.value = gain == null ? 0.25 : gain;
    src.buffer = buf;
    src.connect(g);
    g.connect(master);
    src.start(t0);
  }

  const SFX = {
    click: () => tone(520, 0.05, "square", 0, 0.35),
    select: () => tone(660, 0.06, "square", 0, 0.4, 760),
    play: () => {
      tone(330, 0.09, "square", 0, 0.5, 520);
      tone(520, 0.1, "square", 0.05, 0.35, 660);
    },
    score: () => {
      tone(660, 0.08, "square", 0, 0.45);
      tone(880, 0.1, "square", 0.07, 0.4);
      tone(1320, 0.12, "square", 0.15, 0.3);
    },
    gold: () => {
      [880, 1100, 1320, 1760].forEach((f, i) => tone(f, 0.10, "triangle", i * 0.055, 0.4));
    },
    error: () => {
      tone(180, 0.18, "sawtooth", 0, 0.45, 90);
      noise(0.12, 0, 0.12);
    },
    vault: () => {
      tone(440, 0.12, "triangle", 0, 0.4);
      tone(660, 0.16, "triangle", 0.08, 0.35);
    },
    coin: () => {
      tone(988, 0.06, "square", 0, 0.4);
      tone(1319, 0.12, "square", 0.05, 0.35);
    },
    buy: () => {
      tone(523, 0.07, "square", 0, 0.4);
      tone(784, 0.1, "square", 0.06, 0.35);
    },
    win: () => {
      [523, 659, 784, 1047, 1319].forEach((f, i) => tone(f, 0.22, "square", i * 0.12, 0.42));
    },
    lose: () => {
      [392, 330, 262, 196].forEach((f, i) => tone(f, 0.28, "sawtooth", i * 0.16, 0.4));
    },
    boss: () => {
      tone(110, 0.5, "sawtooth", 0, 0.35, 82);
      noise(0.4, 0.05, 0.16);
    },
  };

  function play(name) {
    if (muted) return;
    const fn = SFX[name];
    if (fn) fn();
  }

  function toggle() {
    muted = !muted;
    return muted;
  }

  function unlock() {
    ensure();
  }

  root.LexiconAudio = { play, toggle, unlock, isMuted: () => muted };
})(typeof globalThis !== "undefined" ? globalThis : this);
