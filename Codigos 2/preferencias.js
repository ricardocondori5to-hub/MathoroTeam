(() => {
  'use strict';

  const STORAGE_KEY = 'mathoro.opciones';
  const MUSIC_EPOCH_KEY = 'mathoro.musica.inicio';
  const MUSIC_STEP_MS = 620;
  const DEFAULTS = Object.freeze({ volumen: 70, musica: 65, sensibilidad: 50, brillo: 80 });
  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

  function readSettings() {
    let stored = {};
    try { stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'); } catch (_) {}
    return Object.fromEntries(Object.entries(DEFAULTS).map(([key, fallback]) => {
      const value = Number(stored[key]);
      return [key, Number.isFinite(value) ? clamp(value, key === 'sensibilidad' ? 1 : 0, 100) : fallback];
    }));
  }

  let settings = readSettings();
  let musicContext = null;
  let musicGain = null;
  let musicTimer = null;
  let musicStarting = false;
  let musicStep = 0;
  let audioUnlocked = false;

  function applyBrightness() {
    const darkness = ((100 - settings.brillo) / 100) * 0.72;
    document.documentElement.style.setProperty('--mathoro-screen-darkness', String(darkness));
  }

  function applyMusicVolume() {
    if (!musicGain || !musicContext) return;
    musicGain.gain.setTargetAtTime((settings.musica / 100) * 0.07, musicContext.currentTime, 0.18);
  }

  function playNote(frequency, start, duration, peak, type = 'sine') {
    const oscillator = musicContext.createOscillator();
    const envelope = musicContext.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, start);
    envelope.gain.setValueAtTime(0.0001, start);
    envelope.gain.exponentialRampToValueAtTime(peak, start + 0.16);
    envelope.gain.setValueAtTime(peak, start + duration * 0.72);
    envelope.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    oscillator.connect(envelope);
    envelope.connect(musicGain);
    oscillator.start(start);
    oscillator.stop(start + duration + 0.03);
  }

  function playMusicPulse(frequency, start, duration, peak) {
    const oscillator = musicContext.createOscillator();
    const envelope = musicContext.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(frequency, start);
    oscillator.frequency.exponentialRampToValueAtTime(Math.max(38, frequency * 0.42), start + duration * 0.55);
    envelope.gain.setValueAtTime(0.0001, start);
    envelope.gain.exponentialRampToValueAtTime(peak, start + 0.008);
    envelope.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    oscillator.connect(envelope);
    envelope.connect(musicGain);
    oscillator.start(start);
    oscillator.stop(start + duration + 0.02);
  }

  function scheduleMusic() {
    musicStarting = false;
    if (musicTimer || !musicContext) return;
    applyMusicVolume();

    const melody = [293.66, 349.23, 392, 440, 523.25, 440, 392, 349.23];
    const chords = [
      { notes: [146.83, 174.61, 220, 293.66], bass: 73.42 },
      { notes: [116.54, 146.83, 174.61, 233.08], bass: 58.27 },
      { notes: [130.81, 174.61, 220, 261.63], bass: 43.65 },
      { notes: [130.81, 164.81, 196, 261.63], bass: 65.41 }
    ];
    let startedAt = Date.now();
    try {
      const savedStart = Number(sessionStorage.getItem(MUSIC_EPOCH_KEY));
      if (Number.isFinite(savedStart) && savedStart > 0) startedAt = savedStart;
      else sessionStorage.setItem(MUSIC_EPOCH_KEY, String(startedAt));
    } catch (_) {}

    const elapsed = Math.max(0, Date.now() - startedAt);
    musicStep = Math.floor(elapsed / MUSIC_STEP_MS);
    const playMeasure = () => {
      if (!musicContext || musicContext.state === 'closed') { musicTimer = null; return; }
      const start = musicContext.currentTime + 0.04;
      const chord = chords[Math.floor(musicStep / 4) % chords.length];
      chord.notes.forEach((frequency) => playNote(frequency, start, 2.35, 0.12, 'triangle'));
      playNote(chord.notes[3] * 2, start + 0.02, 1.35, 0.045, 'sawtooth');
      playNote(melody[musicStep % melody.length], start + 0.04, 0.54, 0.18, 'triangle');
      playMusicPulse(chord.bass, start, 0.48, 0.16);
      if (musicStep % 4 === 0) playMusicPulse(110, start, 0.24, 0.18);
      else if (musicStep % 4 === 2) playMusicPulse(146.83, start, 0.16, 0.11);
      musicStep += 1;
    };

    const delayToBeat = MUSIC_STEP_MS - (elapsed % MUSIC_STEP_MS);
    musicTimer = window.setTimeout(() => {
      musicTimer = null;
      playMeasure();
      musicTimer = window.setInterval(playMeasure, MUSIC_STEP_MS);
    }, delayToBeat);
  }

  function startBackgroundMusic() {
    audioUnlocked = true;
    if (musicTimer || settings.musica <= 0) return;
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return;
    try {
      musicContext ||= new AudioContextClass();
      musicGain ||= musicContext.createGain();
      if (!musicGain.__connected) {
        musicGain.connect(musicContext.destination);
        musicGain.__connected = true;
      }
      if (musicStarting) {
        if (musicContext.state === 'suspended') void musicContext.resume().then(scheduleMusic).catch(() => {});
        return;
      }
      musicStarting = true;
      void musicContext.resume().then(scheduleMusic).catch(() => { musicStarting = false; });
    } catch (error) {
      console.warn('[MATHORO] No se pudo iniciar la música de fondo.', error);
      musicStarting = false;
      musicTimer = null;
    }
  }

  function apply(nextSettings = readSettings()) {
    settings = nextSettings;
    applyBrightness();
    applyMusicVolume();
    if (audioUnlocked && settings.musica > 0 && !musicTimer) startBackgroundMusic();
  }

  window.MathoroSettings = Object.freeze({
    key: STORAGE_KEY,
    get(name) { return settings[name] ?? DEFAULTS[name]; },
    all() { return { ...settings }; },
    save(nextSettings) {
      const normalized = Object.fromEntries(Object.entries(DEFAULTS).map(([key, fallback]) => {
        const value = Number(nextSettings[key]);
        return [key, Number.isFinite(value) ? clamp(value, key === 'sensibilidad' ? 1 : 0, 100) : fallback];
      }));
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized)); } catch (_) {}
      apply(normalized);
      window.dispatchEvent(new CustomEvent('mathoro:settingschange', { detail: normalized }));
      return { ...normalized };
    },
    dragThreshold(basePixels) {
      const sensitivity = this.get('sensibilidad');
      return Math.round(basePixels * (1.5 - sensitivity / 100));
    },
    startMusic: startBackgroundMusic,
  });

  const globalStyle = document.createElement('style');
  globalStyle.textContent = `
    * { cursor: url("imagenes/cursor-mathoro-v3.svg") 5 2, auto !important; }
    input:not([type="range"]), textarea, [contenteditable="true"] { cursor: text !important; }
    body::after {
      content: ""; position: fixed; z-index: 2147483646; inset: 0;
      background: #1b0905; opacity: var(--mathoro-screen-darkness, 0);
      pointer-events: none;
    }
  `;
  document.head.appendChild(globalStyle);
  applyBrightness();

  window.addEventListener('mathoro:settingschange', (event) => apply(event.detail));
  window.addEventListener('storage', (event) => {
    if (event.key === STORAGE_KEY) apply();
  });
  document.addEventListener('pointerdown', startBackgroundMusic, { passive: true });
  document.addEventListener('keydown', startBackgroundMusic, { once: true });
  try {
    if (sessionStorage.getItem(MUSIC_EPOCH_KEY)) startBackgroundMusic();
  } catch (_) {}
})();
