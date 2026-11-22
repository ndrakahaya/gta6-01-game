// WebAudio-based sound engine - synthesizes all game audio at runtime
// No external audio files needed - generates engine sounds, effects, music and ambient audio

export class AudioEngine {
  constructor() {
    // Audio context and master controls
    this.ctx = null;                    // WebAudio context
    this.master = null;                 // Master gain node
    this.enabled = true;                // Global audio enable/disable
    this.volume = 0.6;                  // Master volume (0-1)
    
    // Sound system components
    this.engine = null;                  // Car engine sound generator
    this.siren = null;                  // Police siren sound generator
    this.musicGain = null;              // Background music volume control
    this.musicTimer = 0;                // Timer for music sequence timing
    this.musicStep = 0;                 // Step counter for music progression
  }

  /**
   * Initialize the audio system - must be called from a user gesture
   * (required by browsers for autoplay policies)
   */
  init() {
    if (this.ctx) return; // Already initialized
    
    // Check for browser WebAudio support
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) { 
      this.enabled = false; 
      console.warn('WebAudio not supported, audio disabled');
      return; 
    }
    
    // Create audio context and master gain
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.volume;
    this.master.connect(this.ctx.destination);
    
    // Initialize all sound systems
    this.startEngine();
    this.startSiren();
    this.startMusic();
  }

  /**
   * Resume suspended audio context (called after user interaction)
   */
  resume() {
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  }

  /**
   * Set master volume (0-1 range)
   * @param {number} v - Volume level (0.0 = silent, 1.0 = max)
   */
  setVolume(v) {
    this.volume = Math.max(0, Math.min(1, v)); // Clamp to valid range
    if (this.master) {
      this.master.gain.value = this.volume;
    }
  }

  // ===== ENGINE SOUND SYSTEM =====
  
  /**
   * Create a dynamic car engine sound using dual oscillators with filtering
   * Engine pitch and volume track vehicle speed and throttle
   */
  startEngine() {
    const ctx = this.ctx;
    
    // Main oscillator - sawtooth for engine fundamental
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.value = 60; // Base idle frequency
    
    // Sub oscillator - square for low-end rumble
    const sub = ctx.createOscillator();
    sub.type = 'square';
    sub.frequency.value = 30; // One octave below fundamental
    
    // Low-pass filter to shape the engine tone
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 620; // Cutoff frequency
    
    // Gain node for volume control
    const gain = ctx.createGain();
    gain.gain.value = 0; // Start silent
    
    // Connect: oscillators -> filter -> gain -> master
    osc.connect(filter);
    sub.connect(filter);
    filter.connect(gain);
    gain.connect(this.master);
    
    // Start oscillators
    osc.start();
    sub.start();
    
    // Store for real-time updates
    this.engine = { osc, sub, gain, filter };
  }

  // ===== EMERGENCY VEHICLE SIREN =====
  
  /**
   * Create a two-tone police siren that activates when cops are nearby
   * Alternates between high and low frequencies for authentic siren effect
   */
  startSiren() {
    const ctx = this.ctx;
    
    // Triangle oscillator for smooth siren tone
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.value = 620; // Starting frequency
    
    // Gain node for volume control (starts silent)
    const gain = ctx.createGain();
    gain.gain.value = 0;
    
    // Connect and start
    osc.connect(gain);
    gain.connect(this.master);
    osc.start();
    
    // Store for real-time updates
    this.siren = { osc, gain, t: 0 }; // t = time for frequency modulation
  }

  // ===== BACKGROUND MUSIC SYSTEM =====
  
  /**
   * Create subtle background music to prevent silence
   * Generates a quiet bass/arp pattern using minor pentatonic scale
   */
  startMusic() {
    const gain = this.ctx.createGain();
    gain.gain.value = 0.055; // Very low volume for atmosphere
    gain.connect(this.master);
    this.musicGain = gain;
  }

  /**
   * Update background music sequence
   * Plays notes from a minor pentatonic scale in a rhythmic pattern
   */
  musicTick(dt) {
    if (!this.ctx || !this.musicGain) return;
    
    this.musicTimer -= dt;
    if (this.musicTimer > 0) return;
    
    this.musicTimer = 0.42; // Time between notes
    
    // Minor pentatonic scale: A minor pentatonic (A, C, D, E, G, A)
    const scale = [0, 3, 5, 7, 10, 12]; // Semitone intervals from root
    const root = 55; // A1 note (55 Hz)
    const step = this.musicStep++;
    
    // Create melodic movement with occasional bass notes
    const note = scale[(step * 3) % scale.length];
    const freq = root * Math.pow(2, note / 12) * (step % 8 === 0 ? 1 : 2);
    this.blip(freq, 0.34, 'triangle', 0.5, this.musicGain);
    
    // Add bass note every 4 steps
    if (step % 4 === 0) {
      this.blip(root / 2, 0.5, 'sine', 0.8, this.musicGain);
    }
  }

  // ===== SOUND EFFECT GENERATION =====
  
  /**
   * Create a simple blip/tone sound
   * @param {number} freq - Frequency in Hz
   * @param {number} dur - Duration in seconds
   * @param {string} type - Oscillator type ('sine', 'square', 'triangle', 'sawtooth')
   * @param {number} vol - Volume (0-1)
   * @param {AudioNode} dest - Destination node (defaults to master)
   */
  blip(freq, dur, type = 'sine', vol = 0.3, dest = null) {
    if (!this.ctx) return;
    
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.value = freq;
    
    const g = ctx.createGain();
    const t = ctx.currentTime;
    
    // Envelope: quick attack, exponential decay
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.012); // Quick attack
    g.gain.exponentialRampToValueAtTime(0.0008, t + dur); // Exponential decay
    
    // Connect and schedule
    osc.connect(g);
    g.connect(dest ?? this.master);
    osc.start(t);
    osc.stop(t + dur + 0.02); // Small buffer to prevent clicks
  }

  /**
   * Generate filtered noise burst for impacts, explosions, and gunshots
   * @param {number} dur - Duration in seconds
   * @param {number} cutoff - Filter cutoff frequency in Hz
   * @param {number} vol - Volume (0-1)
   * @param {string} type - Filter type ('lowpass', 'highpass', etc.)
   */
  noise(dur, cutoff, vol, type = 'lowpass') {
    if (!this.ctx) return;
    
    const ctx = this.ctx;
    const len = Math.max(1, Math.floor(ctx.sampleRate * dur)); // Buffer length in samples
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    
    // Generate white noise with fade-out
    for (let i = 0; i < len; i++) {
      data[i] = (Math.random() * 2 - 1) * (1 - i / len); // Random sample with fade
    }
    
    // Create and configure noise source
    const src = ctx.createBufferSource();
    src.buffer = buf;
    
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = cutoff;
    
    const g = ctx.createGain();
    g.gain.value = vol;
    
    // Connect chain: source -> filter -> gain -> master
    src.connect(filter);
    filter.connect(g);
    g.connect(this.master);
    
    src.start();
  }

  // ===== GAME SOUND EFFECTS =====
  
  /** Gunshot sound - highpassed noise burst + low square wave */
  shot(vol = 1) {
    this.noise(0.16, 2400, 0.32 * vol, 'highpass'); // Sharp noise burst
    this.blip(150, 0.1, 'square', 0.18 * vol);      // Bass thump
  }

  /** Punch/hit sound - muffled noise + low sine wave */
  punch() {
    this.noise(0.1, 700, 0.24);     // Muffled impact
    this.blip(90, 0.09, 'sine', 0.2); // Low thud
  }

  /** Vehicle crash sound - noise burst + descending blip */
  crash(force = 1) {
    this.noise(0.34, 1100, Math.min(0.4, 0.16 * force)); // Impact noise
    this.blip(70, 0.22, 'square', 0.14 * force);        // Metallic screech
  }

  /** Explosion sound - low noise + deep sawtooth blip */
  explosion() {
    this.noise(0.9, 420, 0.5);     // Low, rumbling noise
    this.blip(48, 0.7, 'sawtooth', 0.3); // Very deep boom
  }

  /** Footstep sound - filtered noise burst */
  footstep(run) {
    this.noise(0.06, run ? 900 : 600, run ? 0.1 : 0.06); // Higher pitch for running
  }

  /** Car horn - two-tone square wave burst */
  horn() {
    this.blip(392, 0.28, 'square', 0.16); // G note
    this.blip(494, 0.28, 'square', 0.12); // B note
  }

  /** Pickup/collect sound - ascending triangle wave */
  pickup() {
    this.blip(660, 0.1, 'triangle', 0.2);      // First note
    setTimeout(() => this.blip(990, 0.14, 'triangle', 0.18), 90); // Second note
  }

  /** Mission success fanfare - ascending major chord */
  missionDone() {
    const notes = [523, 659, 784, 1047]; // C, E, G, C (high)
    notes.forEach((f, i) => 
      setTimeout(() => this.blip(f, 0.24, 'triangle', 0.2), i * 130)
    );
  }

  /** Mission failure - descending dissonant notes */
  fail() {
    this.blip(220, 0.4, 'sawtooth', 0.2);      // A note
    setTimeout(() => this.blip(165, 0.6, 'sawtooth', 0.2), 180); // E♭ note
  }

  // ===== REAL-TIME UPDATES =====
  
  /**
   * Update engine and siren sounds based on game state
   * Called every frame for dynamic audio response
   * @param {number} dt - Delta time since last update
   * @param {Object} car - Vehicle state object
   * @param {number} copDist - Distance to nearest cop
   * @param {number} stars - Current wanted level (0-5)
   */
  update(dt, car, copDist, stars) {
    if (!this.ctx) return;
    
    // Update background music
    this.musicTick(dt);

    // Update engine sound based on vehicle state
    if (this.engine) {
      const t = this.ctx.currentTime;
      if (car && !car.exploded) {
        // Calculate speed ratio (0-1) where 1 is max speed
        const speedRatio = Math.min(1, Math.abs(car.vel) / car.maxSpeed);
        
        // Calculate RPM based on speed and throttle
        const baseRPM = 52; // Idle RPM
        const speedRPM = speedRatio * 190; // Speed contribution
        const throttleRPM = car.throttle > 0 ? 22 : 0; // Throttle contribution
        const rpm = baseRPM + speedRPM + throttleRPM;
        
        // Update engine parameters with smooth transitions
        this.engine.osc.frequency.setTargetAtTime(rpm, t, 0.08);
        this.engine.sub.frequency.setTargetAtTime(rpm * 0.5, t, 0.08);
        this.engine.filter.frequency.setTargetAtTime(420 + speedRatio * 1500, t, 0.1);
        this.engine.gain.gain.setTargetAtTime(0.055 + speedRatio * 0.075, t, 0.1);
      } else {
        // Fade out engine when car is destroyed or not present
        this.engine.gain.gain.setTargetAtTime(0, t, 0.15);
      }
    }

    // Update siren sound based on police proximity
    if (this.siren) {
      const t = this.ctx.currentTime;
      if (stars > 0 && copDist < 90) {
        // Siren is active when wanted and cops are nearby
        this.siren.t += dt;
        const isHighTone = Math.sin(this.siren.t * 3.4) > 0; // Alternating tone
        this.siren.osc.frequency.setTargetAtTime(
          isHighTone ? 780 : 560, // High/low frequency alternation
          t, 
          0.03
        );
        
        // Volume based on distance (closer = louder)
        const volume = Math.max(0, 0.11 * (1 - copDist / 90));
        this.siren.gain.gain.setTargetAtTime(volume, t, 0.12);
      } else {
        // Fade out siren when not active
        this.siren.gain.gain.setTargetAtTime(0, t, 0.2);
      }
    }
  }
}