import { SimEvent } from './sim';

const STORAGE_KEY = 'charge.muted';

/**
 * Procedural battle sound — no audio assets. Hoofbeats follow your squadron's
 * speed, a low din follows the fighting, and events get short synthesized cues.
 */
export class ChargeAudio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private hoofGain: GainNode | null = null;
  private dinGain: GainNode | null = null;
  private hoofPhase = 0;
  private din = 0;
  private lastImpact = 0;
  private lastHit = 0;
  private _muted: boolean;

  constructor() {
    let stored: string | null = null;
    try { stored = localStorage.getItem(STORAGE_KEY); } catch { /* storage unavailable */ }
    this._muted = stored === '1';
  }

  get muted(): boolean {
    return this._muted;
  }

  set muted(m: boolean) {
    this._muted = m;
    try { localStorage.setItem(STORAGE_KEY, m ? '1' : '0'); } catch { /* storage unavailable */ }
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(m ? 0 : 0.55, this.ctx.currentTime, 0.05);
  }

  /** Must be called from a user gesture (browsers block audio until then). */
  start(): void {
    if (typeof AudioContext === 'undefined') return;
    if (!this.ctx) {
      try {
        this.ctx = new AudioContext();
      } catch {
        return;
      }
      const ctx = this.ctx;
      this.master = ctx.createGain();
      this.master.gain.value = this._muted ? 0 : 0.55;
      this.master.connect(ctx.destination);

      const len = ctx.sampleRate;
      this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
      const data = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;

      // Hoofbeats: low rumble whose level is pulsed in rhythm from update().
      this.hoofGain = this.loopNoise('lowpass', 220, 0.9);
      // Battle din: band-limited clatter in the background.
      this.dinGain = this.loopNoise('bandpass', 900, 0.6);
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  /** Silence the loops (pause / end of battle). */
  hush(): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.hoofGain?.gain.setTargetAtTime(0, t, 0.05);
    this.dinGain?.gain.setTargetAtTime(0, t, 0.1);
  }

  private loopNoise(type: BiquadFilterType, freq: number, q: number): GainNode {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = freq;
    filter.Q.value = q;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    src.connect(filter).connect(gain).connect(this.master!);
    src.start();
    return gain;
  }

  /** Per-frame: hoof rhythm from squadron speed (0..1) and din from the frame's events. */
  update(dt: number, speedK: number, riders: number, events: SimEvent[]): void {
    const ctx = this.ctx;
    if (!ctx || !this.hoofGain || !this.dinGain) return;
    const t = ctx.currentTime;

    // Four-beat gallop: faster and heavier with speed, louder with more riders.
    const rate = 2 + speedK * 4.5;
    this.hoofPhase = (this.hoofPhase + dt * rate) % 1;
    const beat = Math.pow(Math.max(0, Math.sin(this.hoofPhase * Math.PI * 4)), 6);
    const size = Math.min(1, 0.45 + riders / 30);
    const level = speedK < 0.08 ? 0 : (0.15 + 0.85 * beat) * speedK * size * 0.9;
    this.hoofGain.gain.setTargetAtTime(level, t, 0.012);

    let hits = 0;
    for (const e of events) {
      if (e.type === 'hit' || e.type === 'kill') hits++;
      this.cue(e);
    }
    this.din += (Math.min(1, hits / 3) - this.din) * Math.min(1, dt * 2);
    this.dinGain.gain.setTargetAtTime(0.04 + this.din * 0.12, t, 0.2);
  }

  private cue(e: SimEvent): void {
    const now = this.ctx!.currentTime;
    switch (e.type) {
      case 'impact':
        if (now - this.lastImpact < 0.045) return;
        this.lastImpact = now;
        this.thud(e.pike ? 260 : 120, e.side === 'rear' ? 0.55 : 0.4, e.pike ? 0.08 : 0.14);
        if (e.pike) this.clang();
        break;
      case 'rider-hit':
        if (!e.mine || now - this.lastHit < 0.08) return;
        this.lastHit = now;
        this.thud(180, 0.25, 0.08);
        break;
      case 'rider-down':
        if (e.mine) this.thud(70, 0.6, 0.35);
        break;
      case 'volley':
        if (e.atPlayer) this.whoosh(e.flight);
        break;
      case 'rout':
        this.horn(e.team === 'red' ? [392, 523] : [330, 247], 0.5);
        break;
      case 'wave':
        this.horn([220, 220, 294], 0.6);
        break;
      case 'join':
      case 'rally':
        this.chime(e.type === 'join' ? [660, 880, 1100] : [880]);
        break;
      case 'muster':
        this.horn([392, 494, 587], 0.35);
        break;
      case 'combo':
        this.chime([784, 988]);
        break;
    }
  }

  private envGain(peak: number, attack: number, decay: number, at = this.ctx!.currentTime): GainNode {
    const g = this.ctx!.createGain();
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(peak, at + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, at + attack + decay);
    g.connect(this.master!);
    return g;
  }

  private noiseBurst(type: BiquadFilterType, freq: number, peak: number, decay: number, at?: number): void {
    const ctx = this.ctx!;
    const start = at ?? ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    src.connect(f).connect(this.envGain(peak, 0.004, decay, start));
    src.start(start, Math.random() * 0.5);
    src.stop(start + decay + 0.05);
  }

  private thud(freq: number, peak: number, decay: number): void {
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    this.noiseBurst('lowpass', freq * 4, peak, decay);
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(freq, t);
    o.frequency.exponentialRampToValueAtTime(freq * 0.5, t + decay);
    o.connect(this.envGain(peak * 0.7, 0.003, decay));
    o.start(t);
    o.stop(t + decay + 0.05);
  }

  private clang(): void {
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    for (const f of [1250, 1870]) {
      const o = ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.value = f;
      o.connect(this.envGain(0.08, 0.002, 0.25));
      o.start(t);
      o.stop(t + 0.3);
    }
  }

  private whoosh(flight: number): void {
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.Q.value = 2;
    f.frequency.setValueAtTime(2400, t);
    f.frequency.exponentialRampToValueAtTime(700, t + 0.6);
    src.connect(f).connect(this.envGain(0.22, 0.08, 0.55));
    src.start(t);
    src.stop(t + 0.7);
    // A patter of arrows landing when the volley comes down.
    for (let i = 0; i < 6; i++) this.noiseBurst('highpass', 2500, 0.06, 0.03, t + flight + Math.random() * 0.25);
  }

  private horn(notes: number[], peak: number): void {
    const ctx = this.ctx!;
    const t0 = ctx.currentTime;
    notes.forEach((f, i) => {
      const at = t0 + i * 0.22;
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = f;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 1100;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, at);
      g.gain.linearRampToValueAtTime(peak * 0.25, at + 0.05);
      g.gain.setValueAtTime(peak * 0.25, at + 0.18);
      g.gain.exponentialRampToValueAtTime(0.0001, at + 0.42);
      o.connect(lp).connect(g).connect(this.master!);
      o.start(at);
      o.stop(at + 0.45);
    });
  }

  private chime(notes: number[]): void {
    const ctx = this.ctx!;
    const t0 = ctx.currentTime;
    notes.forEach((f, i) => {
      const at = t0 + i * 0.09;
      const o = ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.value = f;
      o.connect(this.envGain(0.14, 0.005, 0.35, at));
      o.start(at);
      o.stop(at + 0.4);
    });
  }
}
