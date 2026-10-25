// 程序化音频：不加载任何外部音频文件，全部用 WebAudio 合成。
// 慢速爵士背景在首次用户手势后启动，避免自动播放限制。

let ctx = null;
let master = null;
let sfxBus = null;
let musicBus = null;
let ambientBus = null;
let musicTimer = null;
let ambientTimer = null;
let ambientSource = null;
let musicOn = false;
let soundOn = true;
let ambientOn = true;
let unlocked = false;

function ensure() {
  if (ctx) return ctx;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  ctx = new AC();
  master = ctx.createGain();
  master.gain.value = 0.9;
  master.connect(ctx.destination);
  sfxBus = ctx.createGain();
  sfxBus.gain.value = soundOn ? 0.7 : 0;
  sfxBus.connect(master);
  musicBus = ctx.createGain();
  musicBus.gain.value = 0.16;
  musicBus.connect(master);
  ambientBus = ctx.createGain();
  ambientBus.gain.value = ambientOn ? 0.12 : 0;
  ambientBus.connect(master);
  return ctx;
}

export function unlock() {
  const c = ensure();
  if (!c) return;
  unlocked = true;
  if (c.state === "suspended") c.resume().catch(() => {});
  applyMusic();
  applyAmbient();
}

export function isAudioUnlocked() {
  return !!ctx && ctx.state === "running";
}

function env(node, when, attack, peak, decay) {
  node.gain.setValueAtTime(0.0001, when);
  node.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), when + attack);
  node.gain.exponentialRampToValueAtTime(0.0001, when + attack + decay);
}

function tone({ freq = 440, type = "sine", dur = 0.2, gain = 0.2, slide = 0, when = 0, bus = null, gate = true }) {
  const c = ensure();
  if (!c || (gate && !soundOn)) return;
  const t = c.currentTime + when;
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  if (slide) osc.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t + dur);
  env(g, t, 0.008, gain, dur);
  osc.connect(g).connect(bus || sfxBus);
  osc.start(t);
  osc.stop(t + dur + 0.05);
}

function noise({ dur = 0.3, gain = 0.2, cutoff = 1800, type = "highpass", when = 0, attack = 0.005, bus = null, gate = true }) {
  const c = ensure();
  if (!c || (gate && !soundOn)) return;
  const t = c.currentTime + when;
  const len = Math.max(1, Math.floor(c.sampleRate * dur));
  const buffer = c.createBuffer(1, len, c.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < len; i += 1) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const src = c.createBufferSource();
  src.buffer = buffer;
  const filter = c.createBiquadFilter();
  filter.type = type;
  filter.frequency.value = cutoff;
  const g = c.createGain();
  env(g, t, attack, gain, dur);
  src.connect(filter).connect(g).connect(bus || sfxBus);
  src.start(t);
}

export function setSound(on) {
  soundOn = !!on;
  if (sfxBus) sfxBus.gain.value = soundOn ? 0.7 : 0;
}

function applyMusic() {
  if (!ctx) return;
  if (!musicOn) {
    if (musicTimer) clearInterval(musicTimer);
    musicTimer = null;
    musicBus.gain.value = 0;
    return;
  }
  musicBus.gain.value = 0.16;
  if (!musicTimer) {
    playJazzBar();
    musicTimer = setInterval(playJazzBar, 6400);
  }
}

export function setMusic(on) {
  musicOn = !!on;
  if (unlocked) applyMusic();
}

/* 环境声：低音量酒馆底噪 + 偶发杯碟碰撞，独立于音效与爵士乐 */
function startAmbientNoise() {
  if (ambientSource) return;
  const c = ensure();
  if (!c) return;
  const len = Math.floor(c.sampleRate * 3);
  const buffer = c.createBuffer(1, len, c.sampleRate);
  const data = buffer.getChannelData(0);
  let last = 0;
  for (let i = 0; i < len; i += 1) {
    last = last * 0.985 + (Math.random() * 2 - 1) * 0.015;
    data[i] = last * 4;
  }
  const src = c.createBufferSource();
  src.buffer = buffer;
  src.loop = true;
  const filter = c.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.value = 520;
  const g = c.createGain();
  g.gain.value = 0.06;
  src.connect(filter).connect(g).connect(ambientBus);
  src.start();
  ambientSource = src;
}

function stopAmbient() {
  if (ambientSource) {
    try { ambientSource.stop(); } catch (e) {}
    ambientSource.disconnect();
    ambientSource = null;
  }
  if (ambientTimer) {
    clearInterval(ambientTimer);
    ambientTimer = null;
  }
}

function ambientClink() {
  tone({ freq: 1500 + Math.random() * 500, dur: 0.06, gain: 0.03, when: 0, bus: ambientBus, gate: false });
  tone({ freq: 2100 + Math.random() * 700, dur: 0.05, gain: 0.02, when: 0.045, bus: ambientBus, gate: false });
}

function ambientMurmur() {
  noise({ dur: 1.6, gain: 0.012, cutoff: 760, type: "lowpass", attack: 0.5, when: 0, bus: ambientBus, gate: false });
}

function applyAmbient() {
  if (!ctx || !ambientBus) return;
  if (!ambientOn) {
    ambientBus.gain.value = 0;
    stopAmbient();
    return;
  }
  ambientBus.gain.value = 0.12;
  startAmbientNoise();
  if (!ambientTimer) {
    ambientTimer = setInterval(() => {
      if (!ambientOn) return;
      if (Math.random() < 0.65) ambientClink();
      if (Math.random() < 0.45) ambientMurmur();
    }, 5600);
  }
}

export function setAmbient(on) {
  ambientOn = !!on;
  if (unlocked) applyAmbient();
}

const JAZZ_SCALE = [0, 3, 5, 6, 7, 10];
const BASE = 110;

function jazzNote(degree, octave = 0) {
  return BASE * Math.pow(2, (JAZZ_SCALE[degree % JAZZ_SCALE.length] + 12 * octave) / 12);
}

function playJazzBar() {
  const c = ensure();
  if (!c || !musicOn) return;
  const now = c.currentTime + 0.05;
  // ii-V-I 慢速铺底：每小节三个和弦，三角波 + 低通
  const chords = [
    [jazzNote(1, 0), jazzNote(3, 0), jazzNote(5, 1)],
    [jazzNote(0, 0), jazzNote(3, 1), jazzNote(4, 1)],
    [jazzNote(0, 1), jazzNote(2, 1), jazzNote(4, 1)],
  ];
  chords.forEach((chord, ci) => {
    const start = now + ci * 2.0;
    chord.forEach((freq, i) => {
      const osc = c.createOscillator();
      const g = c.createGain();
      const filter = c.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.value = 700 + i * 120;
      osc.type = i === 0 ? "triangle" : "sine";
      osc.frequency.value = freq;
      osc.detune.value = (Math.random() * 8 - 4);
      env(g, start, 0.35, 0.05 / (i + 1), 1.9);
      osc.connect(filter).connect(g).connect(musicBus);
      osc.start(start);
      osc.stop(start + 2.3);
    });
  });
  // 稀疏旋律
  for (let i = 0; i < 3; i += 1) {
    if (Math.random() < 0.55) {
      const when = now + Math.random() * 5.6;
      const freq = jazzNote(Math.floor(Math.random() * JAZZ_SCALE.length), 2);
      const osc = c.createOscillator();
      const g = c.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      env(g, when, 0.02, 0.035, 0.5);
      osc.connect(g).connect(musicBus);
      osc.start(when);
      osc.stop(when + 0.6);
    }
  }
  // 刷子噪声
  noise({ dur: 0.16, gain: 0.02, cutoff: 5000, type: "bandpass", when: 0, bus: musicBus, gate: false });
  noise({ dur: 0.12, gain: 0.015, cutoff: 4000, type: "bandpass", when: 2.0, bus: musicBus, gate: false });
}

export const sfx = {
  click() { tone({ freq: 520, type: "square", dur: 0.05, gain: 0.08, slide: 80 }); },
  hover() { tone({ freq: 700, type: "sine", dur: 0.03, gain: 0.03 }); },
  card() { noise({ dur: 0.12, gain: 0.12, cutoff: 2600 }); tone({ freq: 220, type: "triangle", dur: 0.09, gain: 0.08, slide: 120 }); },
  play() { noise({ dur: 0.16, gain: 0.14, cutoff: 1800 }); tone({ freq: 180, type: "triangle", dur: 0.12, gain: 0.1, slide: 90 }); },
  challenge() {
    tone({ freq: 330, type: "sawtooth", dur: 0.16, gain: 0.14, slide: -80 });
    tone({ freq: 220, type: "square", dur: 0.22, gain: 0.1, slide: -60, when: 0.05 });
  },
  correct() { tone({ freq: 660, dur: 0.12, gain: 0.12 }); tone({ freq: 880, dur: 0.16, gain: 0.1, when: 0.08 }); },
  wrong() { tone({ freq: 220, type: "sawtooth", dur: 0.2, gain: 0.1, slide: -60 }); },
  tick() { tone({ freq: 1200, type: "square", dur: 0.03, gain: 0.05 }); },
  spin() { noise({ dur: 0.5, gain: 0.08, cutoff: 900, type: "bandpass" }); },
  dry() { tone({ freq: 900, type: "square", dur: 0.04, gain: 0.08 }); noise({ dur: 0.05, gain: 0.05, cutoff: 3000 }); },
  shot() {
    noise({ dur: 0.5, gain: 0.5, cutoff: 1200 });
    tone({ freq: 90, type: "sine", dur: 0.5, gain: 0.4, slide: -50 });
  },
  win() { [523, 659, 784, 1046].forEach((f, i) => tone({ freq: f, dur: 0.22, gain: 0.1, when: i * 0.12 })); },
  lose() { [392, 330, 262].forEach((f, i) => tone({ freq: f, type: "triangle", dur: 0.3, gain: 0.12, when: i * 0.15 })); },
  crystal() { tone({ freq: 1320, dur: 0.1, gain: 0.08 }); tone({ freq: 1760, dur: 0.16, gain: 0.06, when: 0.06 }); },
};
