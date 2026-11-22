// All sound is synthesised with WebAudio at runtime — no audio files, no network. Engine note
// follows car speed, plus gunshots, impacts, sirens, footsteps, pickups and a small music bed.

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.enabled = true;
    this.volume = 0.6;
    this.engine = null;
    this.siren = null;
    this.musicGain = null;
    this.musicTimer = 0;
    this.musicStep = 0;
  }

  /** Must be called from a user gesture (the NEW GAME click). */
  init() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) { this.enabled = false; return; }
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.volume;
    this.master.connect(this.ctx.destination);
    this.startEngine();
    this.startSiren();
    this.startMusic();
  }

  resume() {
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
  }

  setVolume(v) {
    this.volume = v;
    if (this.master) this.master.gain.value = v;
  }

  /** A continuous sawtooth engine whose pitch and gain track the car. */
  startEngine() {
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.value = 60;
    const sub = ctx.createOscillator();
    sub.type = 'square';
    sub.frequency.value = 30;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 620;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    osc.connect(filter);
    sub.connect(filter);
    filter.connect(gain);
    gain.connect(this.master);
    osc.start();
    sub.start();
    this.engine = { osc, sub, gain, filter };
  }

  /** Two-tone police siren, silent until a cop is near. */
  startSiren() {
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.value = 620;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    osc.connect(gain);
    gain.connect(this.master);
    osc.start();
    this.siren = { osc, gain, t: 0 };
  }

  /** A quiet looping bass/arp bed so the city is not silent. */
  startMusic() {
    const gain = this.ctx.createGain();
    gain.gain.value = 0.055;
    gain.connect(this.master);
    this.musicGain = gain;
  }

  musicTick(dt) {
    if (!this.ctx || !this.musicGain) return;
    this.musicTimer -= dt;
    if (this.musicTimer > 0) return;
    this.musicTimer = 0.42;
    // a minor pentatonic walk — original, generated, never a sampled track
    const scale = [0, 3, 5, 7, 10, 12];
    const root = 55; // A1
    const step = this.musicStep++;
    const note = scale[(step * 3) % scale.length];
    const freq = root * Math.pow(2, note / 12) * (step % 8 === 0 ? 1 : 2);
    this.blip(freq, 0.34, 'triangle', 0.5, this.musicGain);
    if (step % 4 === 0) this.blip(root / 2, 0.5, 'sine', 0.8, this.musicGain);
  }

  blip(freq, dur, type = 'sine', vol = 0.3, dest = null) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.value = freq;
    const g = ctx.createGain();
    const t = ctx.currentTime;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    osc.connect(g);
    g.connect(dest ?? this.master);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  /** Filtered noise burst — the basis of gunshots, impacts and explosions. */
  noise(dur, cutoff, vol, type = 'lowpass') {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const len = Math.max(1, Math.floor(ctx.sampleRate * dur));
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) {
      data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = cutoff;
    const g = ctx.createGain();
    g.gain.value = vol;
    src.connect(filter);
    filter.connect(g);
    g.connect(this.master);
    src.start();
  }

  shot(vol = 1) {
    this.noise(0.16, 2400, 0.32 * vol, 'highpass');
    this.blip(150, 0.1, 'square', 0.18 * vol);
  }

  punch() {
    this.noise(0.1, 700, 0.24);
    this.blip(90, 0.09, 'sine', 0.2);
  }

  crash(force = 1) {
    this.noise(0.34, 1100, Math.min(0.4, 0.16 * force));
    this.blip(70, 0.22, 'square', 0.14 * force);
  }

  explosion() {
    this.noise(0.9, 420, 0.5);
    this.blip(48, 0.7, 'sawtooth', 0.3);
  }

  footstep(run) {
    this.noise(0.06, run ? 900 : 600, run ? 0.1 : 0.06);
  }

  horn() {
    this.blip(392, 0.28, 'square', 0.16);
    this.blip(494, 0.28, 'square', 0.12);
  }

  pickup() {
    this.blip(660, 0.1, 'triangle', 0.2);
    setTimeout(() => this.blip(990, 0.14, 'triangle', 0.18), 90);
  }

  missionDone() {
    const notes = [523, 659, 784, 1047];
    notes.forEach((f, i) => setTimeout(() => this.blip(f, 0.24, 'triangle', 0.2), i * 130));
  }

  fail() {
    this.blip(220, 0.4, 'sawtooth', 0.2);
    setTimeout(() => this.blip(165, 0.6, 'sawtooth', 0.2), 180);
  }

  /** Per-frame: engine pitch from speed, siren from nearest cop distance. */
  update(dt, car, copDist, stars) {
    if (!this.ctx) return;
    this.musicTick(dt);

    if (this.engine) {
      const t = this.ctx.currentTime;
      if (car && !car.exploded) {
        const s = Math.min(1, Math.abs(car.vel) / car.maxSpeed);
        const rpm = 52 + s * 190 + (car.throttle > 0 ? 22 : 0);
        this.engine.osc.frequency.setTargetAtTime(rpm, t, 0.08);
        this.engine.sub.frequency.setTargetAtTime(rpm * 0.5, t, 0.08);
        this.engine.filter.frequency.setTargetAtTime(420 + s * 1500, t, 0.1);
        this.engine.gain.gain.setTargetAtTime(0.055 + s * 0.075, t, 0.1);
      } else {
        this.engine.gain.gain.setTargetAtTime(0, t, 0.15);
      }
    }

    if (this.siren) {
      const t = this.ctx.currentTime;
      if (stars > 0 && copDist < 90) {
        this.siren.t += dt;
        const hi = Math.sin(this.siren.t * 3.4) > 0;
        this.siren.osc.frequency.setTargetAtTime(hi ? 780 : 560, t, 0.03);
        const vol = Math.max(0, 0.11 * (1 - copDist / 90));
        this.siren.gain.gain.setTargetAtTime(vol, t, 0.12);
      } else {
        this.siren.gain.gain.setTargetAtTime(0, t, 0.2);
      }
    }
  }
}
