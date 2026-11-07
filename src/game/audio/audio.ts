/* ============================================================================
 * STICKMAN RISING — Synthesized Audio Engine (no assets, no dependencies)
 * ----------------------------------------------------------------------------
 * 100% procedural Web Audio. SFX are built from a shared white-noise buffer +
 * oscillator voices; music is a lookahead-scheduled synthwave battle loop
 * (132 BPM, A minor).
 *
 * - Side-effect free at import (SSR safe); the AudioContext graph is lazily
 *   created inside resume()/startMusic() from a user gesture (Safari-safe).
 * - play() jitters pitch ±7% so repeats never sound identical.
 * - Voice cap 32 (lowest priority evicted); every source gets an explicit
 *   stop() and every voice/event gain is disconnected on end — zero leaks.
 * - All scheduling is in the ctx.currentTime domain.
 *
 * Sections: 1 public API · 2 tuning constants · 3 module helpers · 4 engine
 * lifecycle/graph · 5 voice management · 6 synth helpers · 7 SFX recipes ·
 * 8 music sequencer
 * ========================================================================== */

/* ============================ 1. Public API types ========================= */

export type SfxName =
  | 'swing' | 'swingHeavy' | 'hit' | 'hitHeavy' | 'launch' | 'slam' | 'dash' | 'jump' | 'land'
  | 'parry' | 'parryPerfect' | 'clang' | 'death' | 'deathHeavy' | 'explosion' | 'lightning'
  | 'fire' | 'void' | 'gravity' | 'phantom' | 'execute' | 'rankup' | 'wave' | 'swordSwitch'
  | 'charge' | 'chargeReady' | 'gunshot' | 'reflect' | 'telegraph' | 'hurt' | 'heal'
  | 'uiClick' | 'uiConfirm' | 'bossAlert' | 'energyFull';

export interface SfxOpts {
  /** Multiplies the base pitch of every layer (default 1). */
  pitch?: number;
  /** Output volume 0..1 (default 1). */
  volume?: number;
  /** 0..1 — boosts/adds extra layers for heavy versions (default 0.5). */
  intensity?: number;
}

/* ========================= 2. Tuning constants ============================ */

/** Higher value = more likely to survive the 32-voice cap. */
const SFX_PRIORITY: Record<SfxName, number> = {
  swing: 2, swingHeavy: 5, hit: 5, hitHeavy: 6, launch: 5, slam: 6, dash: 3, jump: 2, land: 3,
  parry: 8, parryPerfect: 8, clang: 4, death: 5, deathHeavy: 6, explosion: 6, lightning: 5,
  fire: 4, void: 4, gravity: 4, phantom: 3, execute: 9, rankup: 7, wave: 7, swordSwitch: 4,
  charge: 4, chargeReady: 5, gunshot: 5, reflect: 4, telegraph: 4, hurt: 5, heal: 4,
  uiClick: 6, uiConfirm: 6, bossAlert: 9, energyFull: 7,
};

const MAX_VOICES = 32;      // concurrent SFX voice cap
const NOISE_DUR = 2.0;      // seconds of shared white noise
const PITCH_JITTER = 0.07;  // ±7% random pitch per play()

/* Music theory data — dark synthwave battle loop, 132 BPM, A minor. */
const BPM = 132;
const STEP_DUR = 60 / BPM / 4;          // one 16th note (~113.6ms)
const STEPS_PER_BAR = 16;
const SCHED_AHEAD = 0.12;               // schedule notes 120ms ahead
const TICK_MS = 25;                     // lookahead scheduler interval
const BASS_ROOT = 45;                   // A2 (midi)
/** 8th-note bass line relative to A: A A A G | A A C B (repeated as 16ths). */
const BASS_PATTERN: readonly number[] = [0, 0, 0, -2, 0, 0, 3, 2];
/** One chord per bar: Am → F → G → Em (all diatonic to A natural minor). */
const CHORDS: readonly (readonly number[])[] = [
  [57, 60, 64], // Am  (A3 C4 E4)
  [53, 57, 60], // F   (F3 A3 C4)
  [55, 59, 62], // G   (G3 B3 D4)
  [52, 55, 59], // Em  (E3 G3 B3)
];
/** 16th-note arp step → index into [chord+12, chord+12, chord+12, root+24]. */
const ARP_PATTERN: readonly number[] = [0, 1, 2, 3, 2, 1, 0, 1, 2, 3, 2, 1, 0, 1, 2, 3];

/** Chord for a bar (Am fallback — only reachable if data is ever corrupted). */
function chordAt(bar: number): readonly number[] {
  return CHORDS[bar % CHORDS.length] ?? [57, 60, 64];
}

/** Arp voicing for a chord: [n0+12, n1+12, n2+12, n0+24]. */
function arpNotes(chord: readonly number[]): readonly number[] {
  const n0 = chord[0] ?? 57;
  const n1 = chord[1] ?? 60;
  const n2 = chord[2] ?? 64;
  return [n0 + 12, n1 + 12, n2 + 12, n0 + 24];
}

/* ======================= 3. Module-level helpers ========================== */

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

function midiToFreq(m: number): number {
  return 440 * Math.pow(2, (m - 69) / 12);
}

/** Random detune in cents, ±range. Keeps metallic partials from phasing flat. */
function randCents(range: number): number {
  return (Math.random() * 2 - 1) * range;
}

function makeNoiseBuffer(ctx: AudioContext): AudioBuffer {
  const len = Math.floor(ctx.sampleRate * NOISE_DUR);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  return buf;
}

/** tanh soft-clip curve shared by all waveshaper crunch nodes (inferred
 *  return type keeps it assignable to WaveShaper.curve on TS 5.7+). */
function makeCrunchCurve() {
  const n = 1024;
  const curve = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    curve[i] = Math.tanh(x * 3);
  }
  return curve;
}

function stopSource(s: AudioScheduledSourceNode, when: number): void {
  try { s.stop(when); } catch { /* already stopped */ }
}

function disconnectNode(n: AudioNode): void {
  try { n.disconnect(); } catch { /* already disconnected */ }
}

/** Safari-safe AudioContext lookup (single narrow `unknown` cast, no `any`). */
function audioContextCtor(): typeof AudioContext | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as {
    AudioContext?: typeof AudioContext;
    webkitAudioContext?: typeof AudioContext;
  };
  return w.AudioContext ?? w.webkitAudioContext ?? null;
}

/* ========================== Internal interfaces =========================== */

/** One play() call = one voice (a subtree hanging off a single output gain). */
interface Voice {
  out: GainNode;
  prio: number;
  end: number;                                   // ctx time the last source stops
  lastSrc: AudioScheduledSourceNode | null;      // source whose onended cleans up
  srcs: AudioScheduledSourceNode[];
  dead: boolean;
}

/** The entire persistent audio graph (built lazily, exactly once). */
interface Graph {
  ctx: AudioContext;
  sfx: GainNode;            // SFX bus — user sfx volume / mute
  music: GainNode;          // music bus — user music volume / mute
  mix: GainNode;            // music start/stop fade (0..1)
  bass: BiquadFilterNode;   // resonant lowpass for the saw bass
  pad: BiquadFilterNode;    // heavy lowpass for the pad
  hat: BiquadFilterNode;    // highpass for hats / bright ticks
  snare: BiquadFilterNode;  // bandpass for snare noise
  arp: BiquadFilterNode;    // lowpass for the arp layer
  noise: AudioBuffer;       // shared white noise
  crunch: ReturnType<typeof makeCrunchCurve>; // shared waveshaper curve
}

/* ====================== 4. AudioEngine — lifecycle ======================== */

export class AudioEngine {
  /* --- user-facing state (applied lazily once a graph exists) --- */
  private sfxVol = 0.9;
  private musicVol = 0.6;
  private muted = false;
  private musicIntensity = 0.35;

  /* --- engine state --- */
  private graph: Graph | null = null;
  private voices: Voice[] = [];
  private timer: number | null = null;
  private musicWanted = false;
  private warned = false;

  /* --- sequencer state --- */
  private step = 0;
  private bar = 0;
  private nextStepTime = 0;
  private musicIApplied = 0.35; // smoothed value of musicIntensity

  constructor() {
    /* Everything is lazy: constructing an AudioEngine touches no browser API. */
  }

  /** Create/resume the AudioContext. Call from a user gesture; repeat-safe. */
  resume(): void {
    const g = this.ensureGraph();
    if (!g) return;
    if (g.ctx.state === 'suspended') void g.ctx.resume().catch(() => undefined);
    if (this.musicWanted && this.timer === null) this.beginLoop();
  }

  /** Suspend the context (audio clock freezes; music resumes where it left). */
  suspend(): void {
    const g = this.graph;
    if (g && g.ctx.state === 'running') void g.ctx.suspend().catch(() => undefined);
  }

  setSfxVolume(v: number): void {
    this.sfxVol = clamp01(v);
    this.applyVolumes();
  }

  setMusicVolume(v: number): void {
    this.musicVol = clamp01(v);
    this.applyVolumes();
  }

  setMuted(m: boolean): void {
    this.muted = m;
    this.applyVolumes();
  }

  /** Battle intensity 0..1 — morphs the running loop (filters/layers). */
  setMusicIntensity(i: number): void {
    this.musicIntensity = clamp01(i);
    if (this.timer === null) this.musicIApplied = this.musicIntensity;
  }

  /** Start the battle loop. Safe to call repeatedly (no double-scheduling). */
  startMusic(): void {
    this.musicWanted = true;
    const g = this.ensureGraph();
    if (g) this.beginLoop();
  }

  /** Stop the loop cleanly (quick fade; scheduler halted). */
  stopMusic(): void {
    this.musicWanted = false;
    if (this.timer !== null) { window.clearInterval(this.timer); this.timer = null; }
    const g = this.graph;
    if (g) {
      const now = g.ctx.currentTime;
      g.mix.gain.cancelScheduledValues(now);
      g.mix.gain.setValueAtTime(Math.max(0.0001, g.mix.gain.value), now);
      g.mix.gain.linearRampToValueAtTime(0, now + 0.12);
    }
  }

  /**
   * Fire a sound effect; silently no-ops until the context is running.
   * Pitch is jittered ±7%; opts.pitch multiplies the base pitch.
   */
  play(name: SfxName, opts?: SfxOpts): void {
    const g = this.graph;
    if (!g || g.ctx.state !== 'running') return;
    this.pruneVoices();

    // Voice cap: evict the lowest-priority live voice to make room.
    if (this.voices.length >= MAX_VOICES) {
      const victim = this.voices.reduce((a, b) => (b.prio < a.prio ? b : a));
      this.killVoice(victim);
    }

    const pf = (opts?.pitch ?? 1) * (1 + (Math.random() * 2 - 1) * PITCH_JITTER);
    const vol = clamp01(opts?.volume ?? 1);
    const inten = clamp01(opts?.intensity ?? 0.5);

    const out = g.ctx.createGain();
    out.gain.value = vol;
    out.connect(g.sfx);
    const v: Voice = { out, prio: SFX_PRIORITY[name], end: 0, lastSrc: null, srcs: [], dead: false };
    const t = g.ctx.currentTime + 0.004;
    this.synthSfx(name, v, t, pf, inten);

    if (v.srcs.length === 0) { disconnectNode(out); return; } // defensive
    this.voices.push(v);

    // The longest-running source cleans the whole voice up when it ends.
    const onEnd = (src: AudioScheduledSourceNode): void => {
      if (v.dead || src !== v.lastSrc) return;
      v.dead = true;
      const i = this.voices.indexOf(v);
      if (i >= 0) this.voices.splice(i, 1);
      disconnectNode(v.out);
    };
    for (const s of v.srcs) s.onended = () => onEnd(s);
  }

  /* --- graph construction & volume plumbing --- */

  private ensureGraph(): Graph | null {
    if (this.graph) return this.graph;
    if (typeof window === 'undefined') return null; // SSR import safety
    const AC = audioContextCtor();
    if (!AC) {
      if (!this.warned) { this.warned = true; console.warn('[audio] Web Audio API unavailable — running silent'); }
      return null;
    }
    const ctx = new AC();

    // Master bus: [sfx | music] → compressor → destination. The compressor
    // glues layered hits together and stops hard clipping.
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.knee.value = 20; comp.ratio.value = 5;
    comp.attack.value = 0.003; comp.release.value = 0.24;
    comp.connect(ctx.destination);

    const sfx = ctx.createGain();
    sfx.gain.value = this.muted ? 0 : this.sfxVol;
    sfx.connect(comp);
    const music = ctx.createGain();
    music.gain.value = this.muted ? 0 : this.musicVol;
    music.connect(comp);
    const mix = ctx.createGain(); // music start/stop fade
    mix.gain.value = 0;
    mix.connect(music);

    const mk = (type: BiquadFilterType, f: number, q: number): BiquadFilterNode => {
      const b = ctx.createBiquadFilter();
      b.type = type; b.frequency.value = f; b.Q.value = q;
      b.connect(mix);
      return b;
    };

    this.graph = {
      ctx, sfx, music, mix,
      bass: mk('lowpass', 320, 9), pad: mk('lowpass', 700, 0.6),
      hat: mk('highpass', 8200, 0.7), snare: mk('bandpass', 1900, 0.9),
      arp: mk('lowpass', 2600, 1),
      noise: makeNoiseBuffer(ctx), crunch: makeCrunchCurve(),
    };
    return this.graph;
  }

  private applyVolumes(): void {
    const g = this.graph;
    if (!g) return;
    const now = g.ctx.currentTime;
    g.sfx.gain.setTargetAtTime(this.muted ? 0 : this.sfxVol, now, 0.03);
    g.music.gain.setTargetAtTime(this.muted ? 0 : this.musicVol, now, 0.03);
  }

  /* --- 5. Voice management --- */

  /** Disconnect voices whose final stop time has passed (cheap O(n), n≤32). */
  private pruneVoices(): void {
    const g = this.graph;
    if (!g || this.voices.length === 0) return;
    const now = g.ctx.currentTime;
    for (let i = this.voices.length - 1; i >= 0; i--) {
      const v = this.voices[i];
      if (v && v.end < now - 0.05) {
        this.voices.splice(i, 1);
        disconnectNode(v.out);
      }
    }
  }

  /** Immediately silence + tear down a voice (used only for cap eviction). */
  private killVoice(v: Voice): void {
    if (v.dead) return;
    v.dead = true;
    const when = this.graph ? this.graph.ctx.currentTime : 0;
    for (const s of v.srcs) stopSource(s, when);
    try { v.out.gain.cancelScheduledValues(when); v.out.gain.setValueAtTime(0, when); } catch { /* noop */ }
    disconnectNode(v.out);
    const i = this.voices.indexOf(v);
    if (i >= 0) this.voices.splice(i, 1);
  }

  /* --- 6. Low-level synth helpers (all times in ctx.currentTime domain) --- */

  /**
   * Amplitude envelope: linear attack, optional hold, exponential decay.
   * `swell` inverts the shape (slow rise, fast cut) for reverse-ish sounds.
   */
  private env(p: AudioParam, t: number, peak: number, dur: number, attack: number, hold: number, swell = false): void {
    const pk = Math.max(0.0002, peak);
    if (swell) {
      p.setValueAtTime(0.0001, t);
      p.linearRampToValueAtTime(pk, t + Math.max(0.02, dur * 0.85));
      p.linearRampToValueAtTime(0.0001, t + dur);
      p.setValueAtTime(0, t + dur + 0.002);
      return;
    }
    p.setValueAtTime(0.0001, t);
    p.linearRampToValueAtTime(pk, t + Math.max(0.001, attack));
    if (hold > 0) p.setValueAtTime(pk, t + attack + hold);
    p.exponentialRampToValueAtTime(0.0001, t + attack + hold + dur);
    p.setValueAtTime(0, t + attack + hold + dur + 0.002);
  }

  /** Noise burst through a swept biquad filter (the workhorse for whooshes). */
  private addNoise(v: Voice, t: number, pf: number, o: NoiseOpts): void {
    const g = this.graph!;
    const src = g.ctx.createBufferSource();
    src.buffer = g.noise;
    const offset = Math.max(0, NOISE_DUR - o.dur - 0.1) * Math.random();

    const flt = g.ctx.createBiquadFilter();
    flt.type = o.type ?? 'bandpass';
    flt.Q.value = o.q ?? 1;
    flt.frequency.setValueAtTime(Math.max(25, o.f0 * pf), t);
    flt.frequency.exponentialRampToValueAtTime(Math.max(25, o.f1 * pf), t + o.dur);

    if (o.flutter) { // LFO wobbling the cutoff (fire / air turbulence)
      const lfo = g.ctx.createOscillator();
      lfo.type = 'sine'; lfo.frequency.value = o.flutter.rate;
      const lg = g.ctx.createGain();
      lg.gain.value = o.flutter.depth;
      lfo.connect(lg); lg.connect(flt.frequency);
      lfo.start(t); stopSource(lfo, t + o.dur + 0.05); v.srcs.push(lfo);
    }

    const gn = g.ctx.createGain();
    this.env(gn.gain, t, o.gain, o.dur, o.attack ?? 0.004, o.hold ?? 0, o.shape === 'swell');

    src.connect(flt);
    let tail: AudioNode = flt;
    if (o.dist) { // gritty crunch layer
      const ws = g.ctx.createWaveShaper();
      ws.curve = g.crunch;
      ws.oversample = '2x';
      flt.connect(ws);
      tail = ws;
    }
    tail.connect(gn);
    gn.connect(v.out);
    const stop = t + o.dur + 0.06;
    src.start(t, offset);
    stopSource(src, stop);
    v.srcs.push(src);
    if (stop > v.end) { v.end = stop; v.lastSrc = src; }
  }

  /** Oscillator blip with optional pitch drop, detune and swept filter. */
  private addTone(v: Voice, t: number, pf: number, o: ToneOpts): void {
    const g = this.graph!;
    const osc = g.ctx.createOscillator();
    osc.type = o.type ?? 'sine';
    osc.frequency.setValueAtTime(Math.max(20, o.f0 * pf), t);
    if (o.f1 !== undefined) osc.frequency.exponentialRampToValueAtTime(Math.max(20, o.f1 * pf), t + o.dur);
    if (o.detune !== undefined) osc.detune.value = o.detune;

    const gn = g.ctx.createGain();
    this.env(gn.gain, t, o.gain, o.dur, o.attack ?? 0.004, o.hold ?? 0, o.shape === 'swell');

    let tail: AudioNode = osc;
    if (o.filter) {
      const flt = g.ctx.createBiquadFilter();
      flt.type = o.filter.type; flt.Q.value = o.filter.q ?? 1;
      flt.frequency.setValueAtTime(Math.max(25, o.filter.f0 * pf), t);
      if (o.filter.f1 !== undefined) {
        flt.frequency.exponentialRampToValueAtTime(Math.max(25, o.filter.f1 * pf), t + o.dur);
      }
      osc.connect(flt); tail = flt;
    }
    tail.connect(gn);
    gn.connect(v.out);

    const stop = t + o.dur + 0.06;
    osc.start(t);
    stopSource(osc, stop);
    v.srcs.push(osc);
    if (stop > v.end) { v.end = stop; v.lastSrc = osc; }
  }

  /* --- 7. SFX recipes --- */

  private synthSfx(name: SfxName, v: Voice, t: number, pf: number, x: number): void {
    switch (name) {
      /* — swordplay — */
      case 'swing': // sharp airy whoosh + faint high shimmer
        this.addNoise(v, t, pf, { dur: 0.13, f0: 700, f1: 2600, q: 1.4, gain: 0.5 });
        this.addNoise(v, t + 0.012, pf, { dur: 0.08, f0: 5200, f1: 7200, type: 'highpass', gain: 0.07 });
        break;
      case 'swingHeavy': // deep long sweep + low rumble
        this.addNoise(v, t, pf, { dur: 0.3, f0: 300, f1: 900, q: 1.2, gain: 0.7 });
        this.addNoise(v, t, pf, { dur: 0.24, f0: 220, f1: 90, type: 'lowpass', gain: 0.4 });
        this.addTone(v, t, pf, { type: 'sine', f0: 95, f1: 55, dur: 0.22, gain: 0.3 });
        if (x > 0.4) this.addNoise(v, t + 0.04, pf, { dur: 0.18, f0: 800, f1: 2300, q: 1.2, gain: 0.14 * x });
        break;
      case 'hit': // snappy noise crack + 150-220Hz thump
        this.addNoise(v, t, pf, { dur: 0.05, f0: 4000, f1: 2600, q: 1.6, gain: 0.75 });
        this.addTone(v, t, pf, { type: 'sine', f0: 200, f1: 145, dur: 0.08, gain: 0.9 });
        this.addNoise(v, t, pf, { dur: 0.014, f0: 3000, f1: 2600, type: 'highpass', gain: 0.3 });
        break;
      case 'hitHeavy': // sub thump + distorted crunch + crack (intensity)
        this.addTone(v, t, pf, { type: 'sine', f0: 78, f1: 42, dur: 0.18, gain: 1.0, hold: 0.02 });
        this.addNoise(v, t, pf, { dur: 0.12, f0: 1300, f1: 500, q: 0.8, gain: 0.7, dist: true });
        this.addNoise(v, t, pf, { dur: 0.16, f0: 2500, f1: 700, q: 1.0, gain: 0.5 });
        if (x > 0.3) this.addNoise(v, t, pf, { dur: 0.03, f0: 5200, f1: 4200, type: 'highpass', gain: 0.2 + 0.5 * x });
        break;

      /* — movement — */
      case 'launch': // rising whoosh
        this.addNoise(v, t, pf, { dur: 0.25, f0: 400, f1: 3000, q: 1.1, gain: 0.6 });
        this.addTone(v, t, pf, { type: 'sine', f0: 180, f1: 520, dur: 0.22, gain: 0.12 });
        break;
      case 'slam': // sub drop + noise crash
        this.addTone(v, t, pf, { type: 'sine', f0: 120, f1: 35, dur: 0.32, gain: 1.0, hold: 0.03 });
        this.addNoise(v, t, pf, { dur: 0.35, f0: 1000, f1: 150, type: 'lowpass', gain: 0.8, dist: true });
        this.addNoise(v, t, pf, { dur: 0.06, f0: 2800, f1: 1200, q: 1.2, gain: 0.4 });
        break;
      case 'dash': // quick airy sweep down
        this.addNoise(v, t, pf, { dur: 0.12, f0: 2000, f1: 300, q: 1.3, gain: 0.5 });
        this.addTone(v, t, pf, { type: 'triangle', f0: 700, f1: 200, dur: 0.1, gain: 0.12 });
        break;
      case 'jump': // soft short whoosh up
        this.addNoise(v, t, pf, { dur: 0.14, f0: 500, f1: 1600, q: 1.0, gain: 0.3 });
        break;
      case 'land': // dry thud
        this.addNoise(v, t, pf, { dur: 0.1, f0: 500, f1: 180, type: 'lowpass', gain: 0.5 });
        this.addTone(v, t, pf, { type: 'sine', f0: 95, f1: 60, dur: 0.1, gain: 0.7 });
        break;

      /* — defense — */
      case 'parry': // bright metallic ring, detuned partials
        this.addNoise(v, t, pf, { dur: 0.03, f0: 3200, f1: 2600, q: 1.2, gain: 0.5 });
        this.addTone(v, t, pf, { f0: 1400, dur: 0.22, gain: 0.5, detune: randCents(8) });
        this.addTone(v, t, pf, { f0: 2100, dur: 0.16, gain: 0.32, detune: randCents(8) });
        this.addTone(v, t, pf, { f0: 3300, dur: 0.1, gain: 0.2 });
        break;
      case 'parryPerfect': // longer decay + shimmering 5th overtones
        this.addNoise(v, t, pf, { dur: 0.04, f0: 4000, f1: 6000, type: 'highpass', gain: 0.4 });
        this.addTone(v, t, pf, { f0: 1400, dur: 0.4, gain: 0.5, detune: randCents(8) });
        this.addTone(v, t, pf, { f0: 2100, dur: 0.3, gain: 0.32, detune: randCents(8) });
        this.addTone(v, t, pf, { f0: 3300, dur: 0.2, gain: 0.2 });
        this.addTone(v, t + 0.01, pf, { f0: 4200, dur: 0.35, gain: 0.14 });
        this.addTone(v, t + 0.01, pf, { f0: 4950, dur: 0.3, gain: 0.1 });
        break;
      case 'clang': // square burst through resonant bandpass + partials
        this.addTone(v, t, pf, { type: 'square', f0: 800, f1: 720, dur: 0.12, gain: 0.5, filter: { type: 'bandpass', f0: 800, f1: 720, q: 9 } });
        this.addTone(v, t, pf, { f0: 1280, dur: 0.1, gain: 0.2, detune: 8 });
        this.addTone(v, t, pf, { f0: 2050, dur: 0.07, gain: 0.12 });
        this.addNoise(v, t, pf, { dur: 0.02, f0: 2500, f1: 2000, gain: 0.35 });
        break;

      /* — death & destruction — */
      case 'death': // mid noise burst + pitch-down blip
        this.addNoise(v, t, pf, { dur: 0.28, f0: 1200, f1: 350, q: 0.9, gain: 0.5 });
        this.addTone(v, t, pf, { type: 'square', f0: 520, f1: 140, dur: 0.2, gain: 0.3, filter: { type: 'lowpass', f0: 1200 } });
        break;
      case 'deathHeavy': // bigger burst + sub
        this.addNoise(v, t, pf, { dur: 0.4, f0: 900, f1: 120, type: 'lowpass', gain: 0.7, dist: true });
        this.addTone(v, t, pf, { type: 'sine', f0: 100, f1: 38, dur: 0.35, gain: 0.9 });
        this.addTone(v, t, pf, { type: 'square', f0: 400, f1: 80, dur: 0.25, gain: 0.3 });
        break;
      case 'explosion': { // brown-ish body + sub drop + crackle tail
        this.addNoise(v, t, pf, { dur: 0.55, f0: 900, f1: 90, type: 'lowpass', q: 0.8, gain: 1.0 });
        this.addTone(v, t, pf, { type: 'sine', f0: 100, f1: 30, dur: 0.45, gain: 0.9 });
        this.addNoise(v, t, pf, { dur: 0.03, f0: 3000, f1: 2000, gain: 0.5 });
        for (let i = 0; i < 5; i++) {
          this.addNoise(v, t + 0.18 + i * 0.07 + Math.random() * 0.02, pf,
            { dur: 0.03, f0: 1500 + Math.random() * 1500, f1: 800, gain: 0.15 });
        }
        break;
      }
      case 'lightning': { // rapid crackle + high sizzle
        const ticks = 6 + Math.floor(Math.random() * 5);
        for (let i = 0; i < ticks; i++) {
          this.addNoise(v, t + i * 0.013, pf,
            { dur: 0.012, f0: 2800 + Math.random() * 2800, f1: 2000, q: 2, gain: 0.45 - i * 0.03 });
        }
        this.addNoise(v, t, pf, { dur: 0.13, f0: 6000, f1: 9000, type: 'highpass', gain: 0.25 });
        break;
      }

      /* — elemental — */
      case 'fire': // whoosh with LFO flutter on the cutoff
        this.addNoise(v, t, pf, { dur: 0.3, f0: 850, f1: 200, q: 0.9, gain: 0.4 + 0.3 * x, flutter: { rate: 15, depth: 240 } });
        this.addNoise(v, t, pf, { dur: 0.18, f0: 2500, f1: 900, type: 'highpass', gain: 0.12 });
        break;
      case 'void': // reverse swell into a deep boom
        this.addNoise(v, t, pf, { dur: 0.42, f0: 480, f1: 900, type: 'lowpass', gain: 0.5, shape: 'swell' });
        this.addTone(v, t + 0.3, pf, { type: 'sine', f0: 70, f1: 34, dur: 0.45, gain: 0.9 });
        this.addNoise(v, t + 0.28, pf, { dur: 0.3, f0: 300, f1: 60, type: 'lowpass', gain: 0.5 });
        break;
      case 'gravity': // heavy sub pulses + slow sweep down
        this.addTone(v, t, pf, { type: 'sine', f0: 85, f1: 30, dur: 0.6, gain: 0.8 });
        this.addTone(v, t + 0.3, pf, { type: 'sine', f0: 60, f1: 28, dur: 0.3, gain: 0.5 });
        this.addNoise(v, t, pf, { dur: 0.6, f0: 900, f1: 90, q: 1.0, gain: 0.25 });
        break;
      case 'phantom': // airy detuned dual whoosh
        this.addNoise(v, t, pf, { dur: 0.4, f0: 900, f1: 2300, q: 1.2, gain: 0.3 });
        this.addNoise(v, t + 0.06, pf * 1.04, { dur: 0.38, f0: 850, f1: 2100, q: 1.2, gain: 0.3 });
        this.addNoise(v, t + 0.05, pf, { dur: 0.3, f0: 5000, f1: 7500, type: 'highpass', gain: 0.08 });
        break;

      /* — drama & systems — */
      case 'execute': // deep boom, then a sharp slice
        this.addTone(v, t, pf, { type: 'sine', f0: 95, f1: 36, dur: 0.3, gain: 1.0 });
        this.addNoise(v, t, pf, { dur: 0.25, f0: 700, f1: 100, type: 'lowpass', gain: 0.6, dist: true });
        this.addNoise(v, t + 0.12, pf, { dur: 0.1, f0: 1500, f1: 3600, q: 1.4, gain: 0.7 });
        this.addTone(v, t + 0.12, pf, { f0: 2400, f1: 2100, dur: 0.18, gain: 0.3 });
        break;
      case 'rankup': { // ascending square blips (C5-E5-A5)
        let dt = 0;
        for (const f of [523.25, 659.25, 880]) {
          this.addTone(v, t + dt, pf, { type: 'square', f0: f, dur: 0.07, gain: 0.22, filter: { type: 'lowpass', f0: 2500 } });
          dt += 0.085;
        }
        break;
      }
      case 'wave': { // alarm-ish two-tone low horn ×2
        for (let i = 0; i < 4; i++) {
          const f = i % 2 === 0 ? 220 : 164.81;
          this.addTone(v, t + i * 0.19, pf, { type: 'sawtooth', f0: f, dur: 0.16, gain: 0.28, filter: { type: 'lowpass', f0: 700, q: 2 } });
          this.addTone(v, t + i * 0.19, pf, { type: 'sawtooth', f0: f / 2, dur: 0.16, gain: 0.14, filter: { type: 'lowpass', f0: 500 } });
        }
        break;
      }
      case 'swordSwitch': // slick blip + metallic shing
        this.addTone(v, t, pf, { type: 'sine', f0: 900, f1: 1500, dur: 0.06, gain: 0.25 });
        this.addTone(v, t + 0.03, pf, { f0: 3800, dur: 0.12, gain: 0.12 });
        this.addTone(v, t + 0.03, pf, { f0: 5700, dur: 0.08, gain: 0.07 });
        this.addNoise(v, t, pf, { dur: 0.02, f0: 4000, f1: 5000, type: 'highpass', gain: 0.2 });
        break;
      case 'charge': // rising filtered hum
        this.addTone(v, t, pf, { type: 'sawtooth', f0: 80, f1: 240, dur: 0.3, gain: 0.3, filter: { type: 'lowpass', f0: 220, f1: 1300, q: 6 } });
        this.addTone(v, t, pf, { type: 'sine', f0: 160, f1: 480, dur: 0.3, gain: 0.1 });
        break;
      case 'chargeReady': // bright ping
        this.addTone(v, t, pf, { f0: 1320, dur: 0.22, gain: 0.4 });
        this.addTone(v, t, pf, { f0: 1980, dur: 0.15, gain: 0.2, detune: 5 });
        this.addNoise(v, t, pf, { dur: 0.05, f0: 5000, f1: 8000, type: 'highpass', gain: 0.15 });
        break;
      case 'gunshot': // bright crack + pitch-down tail
        this.addNoise(v, t, pf, { dur: 0.06, f0: 3500, f1: 900, q: 0.9, gain: 1.0, dist: true });
        this.addNoise(v, t, pf, { dur: 0.16, f0: 700, f1: 120, type: 'lowpass', gain: 0.4 });
        this.addTone(v, t, pf, { type: 'square', f0: 320, f1: 55, dur: 0.14, gain: 0.25 });
        break;
      case 'reflect': // zingy up-sweep ping
        this.addTone(v, t, pf, { type: 'triangle', f0: 600, f1: 2500, dur: 0.16, gain: 0.4 });
        this.addTone(v, t, pf, { f0: 606, f1: 2520, dur: 0.16, gain: 0.2, detune: 12 });
        break;
      case 'telegraph': // low warning double-blip
        this.addTone(v, t, pf, { type: 'square', f0: 138, dur: 0.1, gain: 0.35, filter: { type: 'lowpass', f0: 420, q: 3 } });
        this.addTone(v, t + 0.13, pf, { type: 'square', f0: 138, dur: 0.1, gain: 0.35, filter: { type: 'lowpass', f0: 420, q: 3 } });
        break;
      case 'hurt': // gritty noise + low thud
        this.addNoise(v, t, pf, { dur: 0.07, f0: 1100, f1: 500, q: 1.4, gain: 0.5, dist: true });
        this.addTone(v, t, pf, { type: 'sine', f0: 130, f1: 75, dur: 0.09, gain: 0.5 });
        break;
      case 'heal': // warm soft two-note chime
        this.addTone(v, t, pf, { type: 'triangle', f0: 523.25, dur: 0.22, gain: 0.22, attack: 0.03 });
        this.addTone(v, t + 0.1, pf, { type: 'triangle', f0: 659.25, dur: 0.3, gain: 0.22, attack: 0.03 });
        this.addTone(v, t + 0.1, pf, { f0: 1318.5, dur: 0.25, gain: 0.06, attack: 0.03 });
        break;

      /* — UI — */
      case 'uiClick': // tiny tick
        this.addNoise(v, t, pf, { dur: 0.015, f0: 2500, f1: 3500, type: 'highpass', gain: 0.25 });
        this.addTone(v, t, pf, { f0: 1150, dur: 0.02, gain: 0.15 });
        break;
      case 'uiConfirm': // pleasant two-tone confirm
        this.addTone(v, t, pf, { f0: 660, dur: 0.08, gain: 0.3 });
        this.addTone(v, t + 0.07, pf, { f0: 880, dur: 0.14, gain: 0.3 });
        break;
      case 'bossAlert': { // serious klaxon: two alternating low tones ×3
        for (let i = 0; i < 6; i++) {
          const f = i % 2 === 0 ? 98 : 73.42;
          this.addTone(v, t + i * 0.21, pf, { type: 'sawtooth', f0: f, dur: 0.17, gain: 0.3, filter: { type: 'lowpass', f0: 900, q: 2 } });
        }
        break;
      }
      case 'energyFull': { // bright power-up arpeggio (A minor)
        let dt = 0;
        for (const f of [440, 523.25, 659.25, 880, 1046.5]) {
          this.addTone(v, t + dt, pf, { type: 'square', f0: f, dur: 0.06, gain: 0.2, filter: { type: 'lowpass', f0: 3000 } });
          dt += 0.05;
        }
        this.addNoise(v, t, pf, { dur: 0.3, f0: 800, f1: 4000, gain: 0.15 });
        break;
      }
    }
  }

  /* --- 8. Music sequencer (lookahead scheduler) --- */

  private beginLoop(): void {
    const g = this.graph;
    if (!g || this.timer !== null) return;
    this.step = 0;
    this.bar = 0;
    this.musicIApplied = this.musicIntensity;
    const now = g.ctx.currentTime;
    g.mix.gain.cancelScheduledValues(now);
    g.mix.gain.setValueAtTime(Math.max(0.0001, g.mix.gain.value), now);
    g.mix.gain.linearRampToValueAtTime(1, now + 0.15);
    this.nextStepTime = now + 0.08;
    this.timer = window.setInterval(() => this.tick(), TICK_MS);
  }

  private tick(): void {
    const g = this.graph;
    if (!g || g.ctx.state !== 'running' || !this.musicWanted) return;
    const now = g.ctx.currentTime;

    // Smoothly morph toward the target battle intensity.
    const d = this.musicIntensity - this.musicIApplied;
    this.musicIApplied = Math.abs(d) < 0.001 ? this.musicIntensity : this.musicIApplied + d * 0.12;

    // Resync if background throttling made us fall far behind.
    if (this.nextStepTime < now - 0.3) this.nextStepTime = now + 0.05;

    while (this.nextStepTime < now + SCHED_AHEAD) {
      this.scheduleStep(this.step, this.bar, this.nextStepTime);
      this.nextStepTime += STEP_DUR;
      this.step++;
      if (this.step >= STEPS_PER_BAR) { this.step = 0; this.bar++; }
    }
    this.pruneVoices(); // piggyback SFX voice GC on the scheduler
  }

  private scheduleStep(step: number, bar: number, t: number): void {
    const g = this.graph!;
    const i = this.musicIApplied;
    const mix = g.mix;

    // — drums — kick on 1 & 3 (+ syncopated ghost kick when intense)
    if (step === 0 || step === 8) {
      this.mTone(t, 'sine', 150, 44, 0.24, 0.9, mix, 0.11, 0.001);
      this.mNoise(t, 0.012, 0.12, g.hat); // attack click
    } else if (step === 14 && i > 0.65) {
      this.mTone(t, 'sine', 130, 44, 0.16, 0.5, mix, 0.09, 0.001);
    }
    // snare on 2 & 4 (only above mid intensity)
    if ((step === 4 || step === 12) && i > 0.45) {
      const sg = Math.min(1, (i - 0.4) * 2.2);
      this.mNoise(t, 0.12, 0.5 * sg, g.snare);
      this.mTone(t, 'triangle', 210, 128, 0.08, 0.3 * sg, mix);
    }
    // closed hats: offbeat 8ths (fading in), ghost 16ths at very high intensity
    if (i > 0.28 && step % 4 === 2) {
      const hg = Math.min(1, (i - 0.25) / 0.4);
      this.mNoise(t, 0.03, 0.3 * hg * (step === 6 || step === 14 ? 1 : 0.75), g.hat);
    }
    if (i > 0.78 && step % 2 === 1) this.mNoise(t, 0.02, 0.09, g.hat);

    // — bass — driving 16ths: A A A G | A A C B (saw through resonant LP)
    const off = BASS_PATTERN[(step >> 1) & 7] ?? 0;
    const vel = step % 2 === 0 ? 1 : 0.72;
    this.mBass(t, midiToFreq(BASS_ROOT + off), vel);
    g.bass.frequency.setValueAtTime(230 + 1750 * i * i + (step % 4 === 0 ? 240 : 0), t);

    // — pad — one dark detuned-saw chord per bar, slowly breathing cutoff
    const chord = chordAt(bar);
    if (step === 0) {
      this.mPad(t, chord, 0.045 + 0.02 * i);
      g.pad.frequency.setTargetAtTime(520 + 700 * i, t, 0.5);
    }

    // — arp — chord-tone square arp, faded in at high intensity
    if (i > 0.55) {
      const notes = arpNotes(chord);
      const ag = 0.1 * Math.min(1, (i - 0.5) / 0.4);
      const idx = ARP_PATTERN[step] ?? 0;
      if (ag > 0.005) this.mArp(t, midiToFreq(notes[idx] ?? 880), ag * (step % 4 === 0 ? 1.2 : 0.9));
    }
  }

  /** Music noise event → shared filter. Gains self-destruct on source end. */
  private mNoise(t: number, dur: number, gain: number, dest: AudioNode): void {
    const g = this.graph!;
    const src = g.ctx.createBufferSource();
    src.buffer = g.noise;
    const offset = Math.max(0, NOISE_DUR - dur - 0.1) * Math.random();
    const gn = g.ctx.createGain();
    this.env(gn.gain, t, gain, dur, 0.001, 0);
    src.connect(gn); gn.connect(dest);
    src.onended = () => disconnectNode(gn);
    src.start(t, offset); stopSource(src, t + dur + 0.03);
  }

  /** Music oscillator event with optional pitch-drop time. */
  private mTone(t: number, type: OscillatorType, f0: number, f1: number | undefined, dur: number, gain: number, dest: AudioNode, fDur?: number, attack = 0.002): void {
    const g = this.graph!;
    const osc = g.ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(Math.max(20, f0), t);
    if (f1 !== undefined) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + (fDur ?? dur));
    }
    const gn = g.ctx.createGain();
    this.env(gn.gain, t, gain, dur, attack, 0);
    osc.connect(gn); gn.connect(dest);
    osc.onended = () => disconnectNode(gn);
    osc.start(t); stopSource(osc, t + dur + 0.05);
  }

  /** One 16th-note bass hit: saw + sine sub through the shared bass filter. */
  private mBass(t: number, freq: number, vel: number): void {
    const g = this.graph!;
    const gn = g.ctx.createGain();
    this.env(gn.gain, t, 0.42 * vel, 0.095, 0.003, 0);
    const saw = g.ctx.createOscillator();
    saw.type = 'sawtooth'; saw.frequency.value = freq;
    const sub = g.ctx.createOscillator();
    sub.type = 'sine'; sub.frequency.value = freq;
    const subGain = g.ctx.createGain();
    subGain.gain.value = 0.6;
    saw.connect(gn);
    sub.connect(subGain);
    subGain.connect(gn);
    gn.connect(g.bass);
    const stop = t + 0.13;
    saw.onended = () => { disconnectNode(gn); disconnectNode(subGain); };
    sub.onended = () => { disconnectNode(gn); disconnectNode(subGain); };
    saw.start(t); stopSource(saw, stop);
    sub.start(t); stopSource(sub, stop);
  }

  /** One bar of pad: 3 chord tones × 2 detuned saws, slow swell/release. */
  private mPad(t: number, chord: readonly number[], level: number): void {
    const g = this.graph!;
    const barDur = STEPS_PER_BAR * STEP_DUR;
    const stop = t + barDur + 0.45;
    for (const m of chord) {
      const f = midiToFreq(m);
      for (const det of [-9, 9]) {
        const osc = g.ctx.createOscillator();
        osc.type = 'sawtooth'; osc.frequency.value = f; osc.detune.value = det;
        const gn = g.ctx.createGain();
        const p = gn.gain;
        p.setValueAtTime(0.0001, t);
        p.linearRampToValueAtTime(level, t + 0.5);
        p.setValueAtTime(level, t + barDur - 0.2);
        p.linearRampToValueAtTime(0.0001, t + barDur + 0.3);
        p.setValueAtTime(0, stop + 0.01);
        osc.connect(gn); gn.connect(g.pad);
        osc.onended = () => disconnectNode(gn);
        osc.start(t); stopSource(osc, stop);
      }
    }
  }

  /** One arp note: short square blip through the shared arp filter. */
  private mArp(t: number, freq: number, gain: number): void {
    const g = this.graph!;
    const osc = g.ctx.createOscillator();
    osc.type = 'square';
    osc.frequency.value = freq;
    const gn = g.ctx.createGain();
    this.env(gn.gain, t, gain, 0.055, 0.002, 0);
    osc.connect(gn); gn.connect(g.arp);
    osc.onended = () => disconnectNode(gn);
    osc.start(t); stopSource(osc, t + 0.09);
  }
}

/* Option bags for the low-level helpers (kept private to the module). */

interface NoiseOpts {
  dur: number;                 // total length (s)
  f0: number; f1: number;      // filter sweep endpoints, pre pitch-factor
  gain: number;                // envelope peak
  type?: BiquadFilterType;     // default 'bandpass'
  q?: number;                  // default 1
  attack?: number;             // default 4ms
  hold?: number;               // default 0
  shape?: 'decay' | 'swell';   // 'swell' = reverse-ish rise
  dist?: boolean;              // route through the crunch waveshaper
  flutter?: { rate: number; depth: number }; // cutoff LFO (fire, air)
}

interface ToneOpts {
  f0: number;                  // start frequency, pre pitch-factor
  dur: number;                 // total length (s)
  gain: number;                // envelope peak
  f1?: number;                 // optional pitch drop target
  type?: OscillatorType;       // default 'sine'
  detune?: number;             // cents
  attack?: number;             // default 4ms
  hold?: number;               // default 0
  shape?: 'decay' | 'swell';
  filter?: { type: BiquadFilterType; f0: number; f1?: number; q?: number };
}

export default AudioEngine;
