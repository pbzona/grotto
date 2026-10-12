/**
 * Ambient sound, all synthesized (no audio files): surf and wind beds plus occasional voices
 * (gulls, creaking decks and ropes, a whistling villager, an owl, a distant bell) whose levels
 * follow `ambienceMix`. Audio only starts after a user gesture, as browsers require.
 */
import type { Mix } from "./ambience.ts";

export const SOUND_KEY = "grotto.sound";
export const readSound = () => { try { return localStorage.getItem(SOUND_KEY) !== "off"; } catch { return true; } };

const PENTA = [0, 2, 4, 7, 9, 12, 14];
const rand = (a: number, b: number) => a + Math.random() * (b - a);

export class Ambience {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private surf!: GainNode; private wind!: GainNode; private insects!: GainNode;
  private noise!: AudioBuffer;
  private mix: Mix | null = null;
  private timers: Record<string, number> = { gulls: 3, creaks: 5, voices: 9, owl: 14, bell: 20, ropes: 7, cricket: 0 };
  private on: boolean;

  constructor(on = readSound()) {
    this.on = on;
    const start = () => { if (this.on) this.start(); };
    for (const ev of ["pointerdown", "keydown"]) window.addEventListener(ev, start, { passive: true });
    document.addEventListener("visibilitychange", () => {
      if (!this.ctx) return;
      if (document.hidden) void this.ctx.suspend(); else if (this.on) void this.ctx.resume();
    });
  }
  get enabled() { return this.on; }
  set enabled(v: boolean) {
    this.on = v;
    try { localStorage.setItem(SOUND_KEY, v ? "on" : "off"); } catch { /* no storage */ }
    if (v) this.start();
    else if (this.ctx) { this.master.gain.setTargetAtTime(0, this.ctx.currentTime, 0.15); setTimeout(() => !this.on && this.ctx?.suspend(), 600); }
  }

  private start() {
    if (this.ctx) {
      void this.ctx.resume();
      this.master.gain.setTargetAtTime(0.55, this.ctx.currentTime, 0.4);
      return;
    }
    const AC = window.AudioContext ?? (window as any).webkitAudioContext;
    if (!AC) return;
    const ctx = this.ctx = new AC() as AudioContext;
    this.master = ctx.createGain(); this.master.gain.value = 0;
    const comp = ctx.createDynamicsCompressor();
    this.master.connect(comp).connect(ctx.destination);
    this.master.gain.setTargetAtTime(0.55, ctx.currentTime, 0.8);

    // a few seconds of brownish noise, looped, feeds the beds
    const len = ctx.sampleRate * 4, buf = this.noise = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch); let b = 0;
      for (let i = 0; i < len; i++) { b = b * 0.97 + (Math.random() * 2 - 1) * 0.03; d[i] = b * 3.5; }
    }
    // surf: low noise breathing on two slow swells
    const surf = this.bed(ctx, "lowpass", 480, 0.7, undefined, 0.55);
    this.surf = surf.level; this.lfo(ctx, 0.09, 0.3, surf.swell.gain); this.lfo(ctx, 0.053, 0.2, surf.swell.gain);
    // wind: a narrow, low band that gusts now and then and is mostly quiet in between
    const wind = this.bed(ctx, "bandpass", 420, 2.2, f => this.lfo(ctx, 0.03, 120, f.frequency), 0);
    this.wind = wind.level;
    const gust = ctx.createWaveShaper(); gust.curve = new Float32Array([0, 0, 0, 0.15, 1]); // only the tops of the swell come through
    const slow = ctx.createOscillator(); slow.frequency.value = 0.045 * rand(0.85, 1.15);
    const slow2 = ctx.createOscillator(); slow2.frequency.value = 0.017 * rand(0.85, 1.15);
    const sum = ctx.createGain(); sum.gain.value = 0.5;
    slow.connect(sum); slow2.connect(sum); sum.connect(gust).connect(wind.swell.gain); slow.start(); slow2.start();
    // night insects: a high trill, gated by scheduled chirps
    this.insects = ctx.createGain(); this.insects.gain.value = 0; this.insects.connect(this.master);
  }

  private bed(ctx: AudioContext, type: BiquadFilterType, freq: number, q: number, mod?: (f: BiquadFilterNode) => void, base = 1) {
    const src = ctx.createBufferSource(); src.buffer = this.noise; src.loop = true;
    src.start(0, Math.random() * 3);
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    mod?.(f);
    const level = ctx.createGain(); level.gain.value = 0;
    const g = ctx.createGain(); g.gain.value = base;
    src.connect(f).connect(g).connect(level).connect(this.master);
    // the swell LFOs modulate `swell`; `level` follows the mix
    return { level, swell: g };
  }
  private lfo(ctx: AudioContext, hz: number, depth: number, param: AudioParam) {
    const o = ctx.createOscillator(); o.frequency.value = hz * rand(0.85, 1.15);
    const d = ctx.createGain(); d.gain.value = depth;
    o.connect(d).connect(param); o.start();
  }

  /** Feed the latest mix (cheap to call every frame; levels glide). */
  update(dt: number, mix: Mix) {
    this.mix = mix;
    const ctx = this.ctx;
    if (!ctx || !this.on || ctx.state !== "running") return;
    const t = ctx.currentTime;
    this.surf.gain.setTargetAtTime(mix.surf * 0.42, t, 0.8);
    this.wind.gain.setTargetAtTime(mix.wind * 0.07, t, 1.2);
    this.insects.gain.setTargetAtTime(mix.insects * 0.05, t, 1.5);
    for (const k of Object.keys(this.timers)) this.timers[k] -= dt;
    const due = (k: keyof Mix | "cricket", level: number, every: [number, number]) => {
      if (this.timers[k] > 0) return false;
      this.timers[k] = rand(every[0], every[1]) / Math.max(0.15, level);
      return level > 0.03;
    };
    if (due("gulls", mix.gulls, [4, 11])) this.gull(mix.gulls);
    if (due("creaks", mix.creaks, [5, 13])) this.creak(rand(70, 130), mix.creaks);
    if (due("ropes", mix.ropes, [6, 14])) this.creak(rand(180, 260), mix.ropes * 0.7);
    if (due("voices", mix.voices, [12, 26])) this.whistle(mix.voices);
    if (due("owl", mix.owl, [16, 34])) this.owl(mix.owl);
    if (due("bell", mix.bell, [18, 40])) this.bell(mix.bell);
    if (due("cricket", mix.insects, [0.5, 0.9])) this.cricket();
  }

  private voice(level: number, pan = rand(-0.7, 0.7)) {
    const ctx = this.ctx!, g = ctx.createGain(), p = ctx.createStereoPanner();
    g.gain.value = level; p.pan.value = pan;
    g.connect(p).connect(this.master);
    return g;
  }
  private env(g: AudioParam, t: number, peak: number, attack: number, hold: number, release: number) {
    g.setValueAtTime(0, t); g.linearRampToValueAtTime(peak, t + attack);
    g.setValueAtTime(peak, t + attack + hold); g.exponentialRampToValueAtTime(1e-4, t + attack + hold + release);
  }
  private tone(out: AudioNode, type: OscillatorType, t: number, dur: number) {
    const o = this.ctx!.createOscillator(); o.type = type;
    const e = this.ctx!.createGain(); e.gain.value = 0;
    o.connect(e).connect(out); o.start(t); o.stop(t + dur + 0.05);
    return { o, e };
  }

  /** "kee-kee-keeow": a falling, nasal cry, two to four times. */
  private gull(level: number) {
    const ctx = this.ctx!, t0 = ctx.currentTime + 0.05;
    const f = ctx.createBiquadFilter(); f.type = "bandpass"; f.frequency.value = 1900; f.Q.value = 2.5;
    f.connect(this.voice(0.09 * level));
    const n = 2 + Math.floor(Math.random() * 3), base = rand(1300, 1700);
    for (let i = 0; i < n; i++) {
      const t = t0 + i * rand(0.17, 0.24), long = i === n - 1, d = long ? 0.42 : 0.14;
      const { o, e } = this.tone(f, "sawtooth", t, d);
      o.frequency.setValueAtTime(base * 1.15, t); o.frequency.exponentialRampToValueAtTime(base * (long ? 0.62 : 0.85), t + d);
      this.env(e.gain, t, 1, 0.02, d * 0.4, d * 0.6);
    }
  }
  /** Old timber taking weight: a low rasp with a wobbling pitch. */
  private creak(hz: number, level: number) {
    const ctx = this.ctx!, t = ctx.currentTime + 0.05, d = rand(0.35, 0.8);
    const f = ctx.createBiquadFilter(); f.type = "bandpass"; f.frequency.value = hz * 5; f.Q.value = 4;
    f.connect(this.voice(0.07 * level));
    const { o, e } = this.tone(f, "sawtooth", t, d);
    o.frequency.setValueAtTime(hz, t);
    for (let k = 1; k <= 4; k++) o.frequency.linearRampToValueAtTime(hz * rand(0.8, 1.25), t + (d * k) / 4);
    this.env(e.gain, t, 1, d * 0.3, d * 0.3, d * 0.4);
  }
  /** Someone on the walkways whistling a few notes of a tune. */
  private whistle(level: number) {
    const ctx = this.ctx!, root = rand(900, 1200);
    const out = this.voice(0.035 * level);
    let t = ctx.currentTime + 0.05;
    const notes = 3 + Math.floor(Math.random() * 4);
    let step = Math.floor(Math.random() * 4);
    for (let i = 0; i < notes; i++) {
      step = Math.max(0, Math.min(PENTA.length - 1, step + Math.floor(rand(-2, 3))));
      const hz = root * Math.pow(2, PENTA[step] / 12), d = i === notes - 1 ? 0.45 : rand(0.14, 0.3);
      const { o, e } = this.tone(out, "sine", t, d);
      o.frequency.setValueAtTime(hz * 0.97, t); o.frequency.linearRampToValueAtTime(hz, t + 0.04);
      const vib = ctx.createOscillator(), vd = ctx.createGain(); vib.frequency.value = 5.5; vd.gain.value = hz * 0.012;
      vib.connect(vd).connect(o.frequency); vib.start(t); vib.stop(t + d + 0.05);
      this.env(e.gain, t, 1, 0.03, d * 0.6, d * 0.4);
      t += d + 0.03;
    }
  }
  /** "hoo — hoo-hoo" from the trees. */
  private owl(level: number) {
    const ctx = this.ctx!, out = this.voice(0.06 * level), hz = rand(330, 400);
    const t0 = ctx.currentTime + 0.05;
    for (const [dt, d] of [[0, 0.45], [0.75, 0.22], [1.02, 0.5]]) {
      const t = t0 + dt, { o, e } = this.tone(out, "sine", t, d);
      o.frequency.setValueAtTime(hz * 1.04, t); o.frequency.linearRampToValueAtTime(hz * 0.96, t + d);
      this.env(e.gain, t, 1, 0.06, d * 0.4, d * 0.5);
    }
  }
  /** A bell buoy somewhere off the lighthouse, rung by the swell. */
  private bell(level: number) {
    const ctx = this.ctx!, out = this.voice(0.05 * level, rand(-0.3, 0.3)), t = ctx.currentTime + 0.05, f = rand(480, 560);
    for (const [m, a, d] of [[1, 1, 3.5], [2.76, 0.45, 2], [5.4, 0.2, 1.1], [0.5, 0.3, 4]]) {
      const { o, e } = this.tone(out, "sine", t, d);
      o.frequency.value = f * m;
      this.env(e.gain, t, a, 0.005, 0, d);
    }
  }
  /** One cricket chirp: three quick pulses of a high trill. */
  private cricket() {
    const ctx = this.ctx!, t0 = ctx.currentTime + 0.02, hz = rand(4200, 4700);
    const p = ctx.createStereoPanner(); p.pan.value = rand(-0.9, 0.9); p.connect(this.insects);
    for (let i = 0; i < 3; i++) {
      const t = t0 + i * 0.045, { o, e } = this.tone(p, "sine", t, 0.03);
      o.frequency.value = hz;
      this.env(e.gain, t, 1, 0.005, 0.01, 0.02);
    }
  }
  /** For tests: the last mix fed in, and whether audio is live. */
  get state() { return { mix: this.mix, running: this.ctx?.state === "running", on: this.on }; }
}
