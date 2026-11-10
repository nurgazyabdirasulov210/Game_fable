// Fully procedural audio (WebAudio): no asset files needed.
type NoiseOpt = { type?: BiquadFilterType; freq: number; freqEnd?: number; q?: number; gain: number; attack?: number; decay: number; delay?: number };
type ToneOpt = { type?: OscillatorType; freq: number; freqEnd?: number; gain: number; attack?: number; decay: number; delay?: number };

export class AudioSys {
  ctx: AudioContext | null = null;
  private master!: GainNode;
  private sfx!: GainNode;
  private amb!: GainNode;
  private music!: GainNode;
  private noiseBuf!: AudioBuffer;
  private loops: { wind: GainNode; rain: GainNode; fire: GainNode; water: GainNode } | null = null;
  private vol = { master: 0.8, music: 0.6 };
  private musicTimer: number | null = null;
  private musicNext = 0;
  private chordIdx = 0;
  private ambState = { rain: 0, wind: 0.3, night: 0, fire: 0, water: 0 };
  private nextBird = 0;
  private nextCrackle = 0;
  private nextCricket = 0;

  /** Must be called from a user gesture. Safe to call repeatedly. */
  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') void this.ctx.resume(); return; }
    try {
      const AC = window.AudioContext ?? (window as any).webkitAudioContext;
      this.ctx = new AC();
    } catch { this.ctx = null; return; }
    const c = this.ctx!;
    this.master = c.createGain(); this.master.connect(c.destination);
    this.sfx = c.createGain(); this.sfx.connect(this.master);
    this.amb = c.createGain(); this.amb.gain.value = 0; this.amb.connect(this.master);
    this.music = c.createGain(); this.music.connect(this.master);
    const len = c.sampleRate * 2;
    this.noiseBuf = c.createBuffer(1, len, c.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    const loop = (type: BiquadFilterType, freq: number, q: number) => {
      const src = c.createBufferSource(); src.buffer = this.noiseBuf; src.loop = true;
      const f = c.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
      const g = c.createGain(); g.gain.value = 0;
      src.connect(f); f.connect(g); g.connect(this.amb); src.start();
      return g;
    };
    this.loops = { wind: loop('lowpass', 420, 0.4), rain: loop('highpass', 1800, 0.3), fire: loop('bandpass', 700, 0.6), water: loop('bandpass', 1100, 0.5) };
    this.setVolumes(this.vol.master, this.vol.music);
  }

  setVolumes(master: number, music: number) {
    this.vol = { master, music };
    if (!this.ctx) return;
    this.master.gain.value = master;
    this.music.gain.value = music * 0.5;
  }

  private noise(o: NoiseOpt) {
    const c = this.ctx; if (!c) return;
    const t = c.currentTime + (o.delay ?? 0);
    const src = c.createBufferSource(); src.buffer = this.noiseBuf;
    const f = c.createBiquadFilter(); f.type = o.type ?? 'bandpass'; f.Q.value = o.q ?? 1;
    f.frequency.setValueAtTime(o.freq, t);
    if (o.freqEnd) f.frequency.exponentialRampToValueAtTime(o.freqEnd, t + o.decay);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(o.gain, t + (o.attack ?? 0.005));
    g.gain.exponentialRampToValueAtTime(0.0001, t + (o.attack ?? 0.005) + o.decay);
    src.connect(f); f.connect(g); g.connect(this.sfx);
    src.start(t, Math.random() * 1.5); src.stop(t + (o.attack ?? 0.005) + o.decay + 0.05);
  }

  private tone(o: ToneOpt, dest?: AudioNode) {
    const c = this.ctx; if (!c) return;
    const t = c.currentTime + (o.delay ?? 0);
    const osc = c.createOscillator(); osc.type = o.type ?? 'sine';
    osc.frequency.setValueAtTime(o.freq, t);
    if (o.freqEnd) osc.frequency.exponentialRampToValueAtTime(o.freqEnd, t + o.decay);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(o.gain, t + (o.attack ?? 0.005));
    g.gain.exponentialRampToValueAtTime(0.0001, t + (o.attack ?? 0.005) + o.decay);
    osc.connect(g); g.connect(dest ?? this.sfx);
    osc.start(t); osc.stop(t + (o.attack ?? 0.005) + o.decay + 0.05);
  }

  // ------------------------------------------------------------ one-shots
  step(surface: 'grass' | 'wood' | 'water', run: boolean) {
    const g = run ? 0.16 : 0.1;
    if (surface === 'wood') { this.noise({ type: 'lowpass', freq: 500, gain: g * 1.4, decay: 0.08 }); this.tone({ freq: 110 + Math.random() * 30, gain: g * 0.6, decay: 0.07, type: 'triangle' }); }
    else if (surface === 'water') this.noise({ type: 'bandpass', freq: 900 + Math.random() * 500, q: 0.8, gain: g * 1.5, decay: 0.22, attack: 0.02 });
    else this.noise({ type: 'bandpass', freq: 500 + Math.random() * 500, q: 0.7, gain: g, decay: 0.11, attack: 0.01 });
  }
  swing() { this.noise({ type: 'bandpass', freq: 500, freqEnd: 1800, q: 1.5, gain: 0.12, attack: 0.05, decay: 0.14 }); }
  chop() { this.noise({ type: 'lowpass', freq: 1400, freqEnd: 300, gain: 0.5, decay: 0.12 }); this.tone({ freq: 180, freqEnd: 90, gain: 0.35, decay: 0.12, type: 'triangle' }); }
  treeFall() { this.noise({ type: 'lowpass', freq: 900, freqEnd: 120, gain: 0.5, attack: 0.1, decay: 0.9 }); this.tone({ freq: 70, freqEnd: 40, gain: 0.5, decay: 0.5, delay: 0.55 }); }
  stone() { this.noise({ type: 'highpass', freq: 2200, gain: 0.3, decay: 0.05 }); this.tone({ freq: 950 + Math.random() * 300, freqEnd: 500, gain: 0.16, decay: 0.07, type: 'square' }); }
  pickup() { this.tone({ freq: 520, freqEnd: 780, gain: 0.14, decay: 0.09, type: 'triangle' }); this.noise({ freq: 2500, gain: 0.08, decay: 0.06 }); }
  rustle() { this.noise({ type: 'highpass', freq: 3000, gain: 0.16, attack: 0.03, decay: 0.2 }); }
  crate() { this.noise({ type: 'lowpass', freq: 700, gain: 0.4, decay: 0.15 }); this.tone({ freq: 240, freqEnd: 330, gain: 0.12, decay: 0.2, delay: 0.08, type: 'triangle' }); }
  craft() { for (let i = 0; i < 3; i++) this.tone({ freq: 440 * [1, 1.25, 1.5][i], gain: 0.13, decay: 0.18, delay: i * 0.07, type: 'triangle' }); this.noise({ freq: 1800, gain: 0.12, decay: 0.08 }); }
  build() { this.noise({ type: 'lowpass', freq: 600, gain: 0.5, decay: 0.14 }); this.tone({ freq: 140, freqEnd: 80, gain: 0.4, decay: 0.16 }); this.noise({ type: 'lowpass', freq: 900, gain: 0.3, decay: 0.1, delay: 0.14 }); }
  ui() { this.tone({ freq: 660, gain: 0.07, decay: 0.05, type: 'triangle' }); }
  uiHover() { this.tone({ freq: 880, gain: 0.025, decay: 0.03, type: 'sine' }); }
  error() { this.tone({ freq: 190, gain: 0.14, decay: 0.16, type: 'square' }); }
  eat() { for (let i = 0; i < 3; i++) this.noise({ type: 'bandpass', freq: 900, q: 2, gain: 0.2, decay: 0.07, delay: i * 0.13 }); }
  drink() { for (let i = 0; i < 3; i++) this.tone({ freq: 300 + i * 40, freqEnd: 520 + i * 40, gain: 0.12, decay: 0.1, delay: i * 0.15 }); }
  hurt() { this.noise({ type: 'lowpass', freq: 500, gain: 0.5, decay: 0.16 }); this.tone({ freq: 160, freqEnd: 70, gain: 0.4, decay: 0.22, type: 'sawtooth' }); }
  hitEnemy() { this.noise({ type: 'lowpass', freq: 1100, freqEnd: 250, gain: 0.45, decay: 0.1 }); }
  door() { this.tone({ freq: 240, freqEnd: 170, gain: 0.1, decay: 0.3, type: 'sawtooth' }); this.noise({ type: 'lowpass', freq: 400, gain: 0.3, decay: 0.08, delay: 0.25 }); }
  quest() { [523, 659, 784, 1047].forEach((f, i) => this.tone({ freq: f, gain: 0.13, decay: 0.35, delay: i * 0.11, type: 'triangle' })); }
  death() { this.tone({ freq: 220, freqEnd: 55, gain: 0.4, decay: 1.4, type: 'sawtooth' }); this.noise({ type: 'lowpass', freq: 300, gain: 0.4, decay: 1.2 }); }
  win() { [392, 494, 587, 784, 988, 1175].forEach((f, i) => this.tone({ freq: f, gain: 0.14, decay: 0.9, delay: i * 0.16, type: 'triangle' })); }
  radio() { this.noise({ type: 'bandpass', freq: 2400, q: 3, gain: 0.14, decay: 0.5 }); for (let i = 0; i < 4; i++) this.tone({ freq: 1200, gain: 0.07, decay: 0.06, delay: 0.15 + i * 0.12, type: 'square' }); }
  thunder(dist = 0.5) {
    const g = 0.9 * (1 - dist * 0.6);
    this.noise({ type: 'lowpass', freq: 220, freqEnd: 50, gain: g, attack: 0.03, decay: 2.6, delay: dist * 1.6 });
    this.noise({ type: 'lowpass', freq: 900, freqEnd: 100, gain: g * 0.5, attack: 0.01, decay: 0.5, delay: dist * 1.6 });
  }
  /** vol 0..1 already attenuated by distance */
  growl(type: string, vol: number) {
    if (vol <= 0.02 || !this.ctx) return;
    if (type === 'wolf') { this.tone({ type: 'sawtooth', freq: 190, freqEnd: 120, gain: 0.22 * vol, attack: 0.05, decay: 0.5 }); this.noise({ type: 'bandpass', freq: 400, q: 2, gain: 0.2 * vol, attack: 0.05, decay: 0.45 }); }
    else if (type === 'mutant') { this.tone({ type: 'sawtooth', freq: 95, freqEnd: 60, gain: 0.3 * vol, attack: 0.08, decay: 0.8 }); this.tone({ type: 'square', freq: 143, freqEnd: 80, gain: 0.1 * vol, attack: 0.08, decay: 0.7 }); }
    else if (type === 'stalker') { this.tone({ type: 'sawtooth', freq: 60, freqEnd: 240, gain: 0.3 * vol, attack: 0.3, decay: 1.2 }); this.noise({ type: 'bandpass', freq: 3000, freqEnd: 800, q: 4, gain: 0.25 * vol, attack: 0.2, decay: 1.1 }); }
    else this.noise({ type: 'bandpass', freq: 700, q: 2, gain: 0.12 * vol, decay: 0.2 });
  }

  // ------------------------------------------------------------ ambience
  setAmbience(a: Partial<typeof this.ambState>) { Object.assign(this.ambState, a); }
  ambienceOn(on: boolean) {
    if (!this.ctx) return;
    this.amb.gain.setTargetAtTime(on ? 1 : 0, this.ctx.currentTime, 0.4);
  }

  update(_dt: number) {
    const c = this.ctx; if (!c || !this.loops) return;
    const t = c.currentTime, a = this.ambState;
    this.loops.wind.gain.setTargetAtTime(0.05 + a.wind * 0.22 + Math.sin(t * 0.31) * 0.02, t, 0.5);
    this.loops.rain.gain.setTargetAtTime(a.rain * 0.3, t, 0.5);
    this.loops.fire.gain.setTargetAtTime(a.fire * 0.1, t, 0.3);
    this.loops.water.gain.setTargetAtTime(a.water * 0.12, t, 0.5);
    if (this.amb.gain.value < 0.05) return;
    if (a.fire > 0.05 && t > this.nextCrackle) {
      this.nextCrackle = t + 0.05 + Math.random() * 0.35;
      this.noise({ type: 'highpass', freq: 1500 + Math.random() * 2500, gain: 0.25 * a.fire * Math.random(), decay: 0.03 });
    }
    if (t > this.nextBird) {
      this.nextBird = t + 1.5 + Math.random() * 6;
      if (a.night < 0.4 && a.rain < 0.3) {
        const base = 2200 + Math.random() * 1800, n = 2 + Math.floor(Math.random() * 4), vol = 0.035 + Math.random() * 0.03;
        for (let i = 0; i < n; i++) this.tone({ freq: base * (1 + Math.random() * 0.1), freqEnd: base * (0.8 + Math.random() * 0.5), gain: vol, decay: 0.07, delay: i * 0.11 }, this.amb);
      } else if (a.night > 0.7 && Math.random() < 0.18) {
        this.tone({ freq: 330, freqEnd: 300, gain: 0.05, attack: 0.08, decay: 0.35, type: 'sine' }, this.amb);
        this.tone({ freq: 300, freqEnd: 270, gain: 0.05, attack: 0.08, decay: 0.5, delay: 0.55, type: 'sine' }, this.amb);
      }
    }
    if (a.night > 0.5 && a.rain < 0.3 && t > this.nextCricket) {
      this.nextCricket = t + 0.55 + Math.random() * 0.2;
      for (let i = 0; i < 3; i++) this.tone({ freq: 4300, gain: 0.012 * a.night, decay: 0.03, delay: i * 0.05 }, this.amb);
    }
  }

  // ------------------------------------------------------------ menu music
  startMusic() {
    const c = this.ctx; if (!c || this.musicTimer !== null) return;
    this.musicNext = c.currentTime + 0.1;
    const chords = [[220, 261.6, 329.6], [174.6, 220, 261.6], [130.8, 196, 329.6], [196, 246.9, 293.7]];
    const delay = c.createDelay(1); delay.delayTime.value = 0.42;
    const fb = c.createGain(); fb.gain.value = 0.35;
    delay.connect(fb); fb.connect(delay); delay.connect(this.music);
    const sched = () => {
      while (this.musicNext < c.currentTime + 1.5) {
        const t0 = this.musicNext, ch = chords[this.chordIdx++ % chords.length], dur = 6.4;
        for (const f of ch) for (const det of [-5, 6]) {
          const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f / 2; o.detune.value = det;
          const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 520; lp.Q.value = 0.5;
          const g = c.createGain();
          g.gain.setValueAtTime(0.0001, t0); g.gain.linearRampToValueAtTime(0.05, t0 + 2.2); g.gain.linearRampToValueAtTime(0.0001, t0 + dur + 1.5);
          o.connect(lp); lp.connect(g); g.connect(this.music); o.start(t0); o.stop(t0 + dur + 1.6);
        }
        const bass = c.createOscillator(); bass.type = 'sine'; bass.frequency.value = ch[0] / 4;
        const bg = c.createGain(); bg.gain.setValueAtTime(0.0001, t0); bg.gain.linearRampToValueAtTime(0.16, t0 + 0.6); bg.gain.linearRampToValueAtTime(0.0001, t0 + dur);
        bass.connect(bg); bg.connect(this.music); bass.start(t0); bass.stop(t0 + dur + 0.1);
        for (let i = 0; i < 8; i++) {
          if (Math.random() < 0.3) continue;
          const tt = t0 + i * 0.8, f = ch[Math.floor(Math.random() * 3)] * (Math.random() < 0.4 ? 4 : 2);
          const o = c.createOscillator(); o.type = 'triangle'; o.frequency.value = f;
          const g = c.createGain(); g.gain.setValueAtTime(0.0001, tt); g.gain.linearRampToValueAtTime(0.09, tt + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, tt + 1.4);
          o.connect(g); g.connect(this.music); g.connect(delay); o.start(tt); o.stop(tt + 1.5);
        }
        this.musicNext += dur;
      }
    };
    sched();
    this.musicTimer = window.setInterval(sched, 500);
    this.music.gain.cancelScheduledValues(c.currentTime);
    this.music.gain.setTargetAtTime(this.vol.music * 0.5, c.currentTime, 0.5);
  }
  stopMusic() {
    if (this.musicTimer !== null) { clearInterval(this.musicTimer); this.musicTimer = null; }
    if (this.ctx) this.music.gain.setTargetAtTime(0, this.ctx.currentTime, 0.6);
  }
  get musicPlaying() { return this.musicTimer !== null; }
}
