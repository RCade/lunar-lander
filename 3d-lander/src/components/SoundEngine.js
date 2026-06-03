// Web Audio Retro Synthesizer Engine
class SoundEngine {
  constructor() {
    this.ctx = null;
    this.engineOsc = null;
    this.engineNoise = null;
    this.engineGain = null;
    this.alarmOsc = null;
    this.alarmGain = null;
    this.alarmInterval = null;
    this.muted = false;
    this.isInitialized = false;
  }

  init() {
    if (this.isInitialized) return;
    try {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AudioContextClass();
      
      // Create main engine oscillator (sawtooth)
      this.engineOsc = this.ctx.createOscillator();
      this.engineOsc.type = 'sawtooth';
      this.engineOsc.frequency.setValueAtTime(45, this.ctx.currentTime);
      
      // Noise buffer for combustion sound
      const bufferSize = this.ctx.sampleRate * 2;
      const noiseBuffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
      const output = noiseBuffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) {
        output[i] = Math.random() * 2 - 1;
      }
      
      this.engineNoise = this.ctx.createBufferSource();
      this.engineNoise.buffer = noiseBuffer;
      this.engineNoise.loop = true;

      // Low-pass filter to sound like an engine combustion chamber
      const engineFilter = this.ctx.createBiquadFilter();
      engineFilter.type = 'lowpass';
      engineFilter.frequency.setValueAtTime(80, this.ctx.currentTime);

      this.engineGain = this.ctx.createGain();
      this.engineGain.gain.setValueAtTime(0, this.ctx.currentTime);

      // Connect engine synth nodes
      this.engineOsc.connect(engineFilter);
      
      const noiseGain = this.ctx.createGain();
      noiseGain.gain.setValueAtTime(0.15, this.ctx.currentTime);
      this.engineNoise.connect(noiseGain);
      noiseGain.connect(engineFilter);

      engineFilter.connect(this.engineGain);
      this.engineGain.connect(this.ctx.destination);

      // Start engine generators
      this.engineOsc.start();
      this.engineNoise.start();

      // Alarm synthesizer nodes
      this.alarmGain = this.ctx.createGain();
      this.alarmGain.gain.setValueAtTime(0, this.ctx.currentTime);
      
      this.alarmOsc = this.ctx.createOscillator();
      this.alarmOsc.type = 'sine';
      this.alarmOsc.frequency.setValueAtTime(1200, this.ctx.currentTime);
      this.alarmOsc.connect(this.alarmGain);
      this.alarmGain.connect(this.ctx.destination);
      this.alarmOsc.start();

      this.isInitialized = true;
      console.log("3D Sound Engine initialized successfully");
    } catch (e) {
      console.error("Web Audio initialization failed", e);
    }
  }

  setThrustLevel(level) {
    if (!this.ctx || this.muted || !this.isInitialized) return;
    
    const now = this.ctx.currentTime;
    const engineVol = level * 0.45;
    const enginePitch = 45 + level * 65;

    this.engineGain.gain.setTargetAtTime(engineVol, now, 0.05);
    this.engineOsc.frequency.setTargetAtTime(enginePitch, now, 0.08);
  }

  startAlarm(isFast = false) {
    if (!this.ctx || this.muted || !this.isInitialized || this.alarmInterval) return;
    
    const rate = isFast ? 180 : 350;
    let active = false;

    this.alarmInterval = setInterval(() => {
      if (this.muted || !this.ctx || !this.isInitialized) return;
      const now = this.ctx.currentTime;
      active = !active;
      if (active) {
        this.alarmOsc.frequency.setValueAtTime(isFast ? 1600 : 1000, now);
        this.alarmGain.gain.setValueAtTime(0.12, now);
      } else {
        this.alarmGain.gain.setValueAtTime(0, now);
      }
    }, rate);
  }

  stopAlarm() {
    if (this.alarmInterval) {
      clearInterval(this.alarmInterval);
      this.alarmInterval = null;
    }
    if (this.ctx && this.alarmGain && this.isInitialized) {
      this.alarmGain.gain.setValueAtTime(0, this.ctx.currentTime);
    }
  }

  playExplosion() {
    if (!this.ctx || this.muted || !this.isInitialized) return;
    const now = this.ctx.currentTime;

    // Stop engine and warning alarms immediately
    this.stopAlarm();
    this.engineGain.gain.setValueAtTime(0, now);

    // Create explosion node tree
    const osc = this.ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(100, now);
    osc.frequency.exponentialRampToValueAtTime(10, now + 1.2);

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(300, now);
    filter.frequency.exponentialRampToValueAtTime(30, now + 1.0);

    const gainNode = this.ctx.createGain();
    gainNode.gain.setValueAtTime(0.8, now);
    gainNode.gain.exponentialRampToValueAtTime(0.01, now + 1.5);

    // Mix in brown noise source for impact blast
    const bufferSize = this.ctx.sampleRate * 1.5;
    const noiseBuffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const output = noiseBuffer.getChannelData(0);
    let lastOut = 0.0;
    for (let i = 0; i < bufferSize; i++) {
      const white = Math.random() * 2 - 1;
      output[i] = (lastOut + (0.02 * white)) / 1.02; // Red/brown noise filter
      lastOut = output[i];
      output[i] *= 4.5;
    }

    const noise = this.ctx.createBufferSource();
    noise.buffer = noiseBuffer;

    osc.connect(filter);
    noise.connect(filter);
    filter.connect(gainNode);
    gainNode.connect(this.ctx.destination);

    osc.start(now);
    noise.start(now);
    osc.stop(now + 1.5);
    noise.stop(now + 1.5);
  }

  playLandingTune() {
    if (!this.ctx || this.muted || !this.isInitialized) return;
    const now = this.ctx.currentTime;

    // Stop alarms & engine
    this.stopAlarm();
    this.engineGain.gain.setValueAtTime(0, now);

    // Play retro C major arpeggio
    const notes = [261.63, 329.63, 392.00, 523.25, 659.25, 783.99, 1046.50];
    notes.forEach((freq, idx) => {
      const osc = this.ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, now + idx * 0.08);

      const gain = this.ctx.createGain();
      gain.gain.setValueAtTime(0.15, now + idx * 0.08);
      gain.gain.exponentialRampToValueAtTime(0.005, now + idx * 0.08 + 0.35);

      osc.connect(gain);
      gain.connect(this.ctx.destination);

      osc.start(now + idx * 0.08);
      osc.stop(now + idx * 0.08 + 0.4);
    });
  }

  toggleMute() {
    this.muted = !this.muted;
    if (this.muted) {
      this.stopAlarm();
      if (this.engineGain) {
        this.engineGain.gain.setValueAtTime(0, this.ctx ? this.ctx.currentTime : 0);
      }
    }
    return this.muted;
  }
}

export const soundEngine = new SoundEngine();
