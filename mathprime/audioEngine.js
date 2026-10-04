/** Motor de efectos sintetizados; las fallas de audio nunca bloquean la partida. */
export class AudioEngine {
    constructor() {
        this.context = null;
        this.masterVolume = 0.16;
        this.available = true;
        try {
            const AudioContextClass = window.AudioContext || window.webkitAudioContext;
            this.context = AudioContextClass ? new AudioContextClass() : null;
            this.available = Boolean(this.context);
        } catch (_) {
            this.context = null;
            this.available = false;
        }
    }

    async resume() {
        if (!this.context || this.context.state !== 'suspended') return false;
        try {
            await this.context.resume();
            return true;
        } catch (_) {
            this.available = false;
            return false;
        }
    }

    tone(frequency, duration = 0.14, options = {}) {
        if (!this.context || !this.available) return false;
        try {
            const { type = 'sine', volume = this.masterVolume, delay = 0 } = options;
            const start = this.context.currentTime + delay;
            const end = start + duration;
            const oscillator = this.context.createOscillator();
            const gain = this.context.createGain();
            oscillator.type = type;
            oscillator.frequency.setValueAtTime(frequency, start);
            gain.gain.setValueAtTime(0.0001, start);
            gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, volume), start + 0.015);
            gain.gain.exponentialRampToValueAtTime(0.0001, end);
            oscillator.connect(gain);
            gain.connect(this.context.destination);
            oscillator.start(start);
            oscillator.stop(end + 0.02);
            return true;
        } catch (_) {
            this.available = false;
            return false;
        }
    }

    playCorrect() {
        this.tone(660, 0.12, { volume: 0.12 });
        this.tone(880, 0.18, { delay: 0.09, volume: 0.16 });
    }

    playError() {
        this.tone(220, 0.28, { type: 'triangle', volume: 0.14 });
        this.tone(165, 0.32, { type: 'sawtooth', delay: 0.08, volume: 0.09 });
    }

    playPower(power) {
        const notes = {
            fury: [440, 660, 990],
            fiftyFifty: [740, 520],
            shield: [392, 587, 784]
        }[power] || [520, 780];
        notes.forEach((note, index) => this.tone(note, 0.16, {
            type: 'triangle', delay: index * 0.07, volume: 0.13
        }));
    }

    /** Sonido ascendente y brillante para el Rayo Matemático. */
    playUltimate() {
        [196, 392, 784, 1568].forEach((note, index) => this.tone(note, 0.24, {
            type: 'sawtooth', delay: index * 0.08, volume: 0.12
        }));
        this.tone(110, 0.42, { type: 'triangle', delay: 0.08, volume: 0.2 });
    }

    playVictory() {
        [523, 659, 784, 1047].forEach((note, index) => this.tone(note, 0.32, {
            delay: index * 0.15, volume: 0.14
        }));
    }

    playDefeat() {
        [392, 330, 262, 196].forEach((note, index) => this.tone(note, 0.34, {
            type: 'triangle', delay: index * 0.18, volume: 0.14
        }));
    }
}

export default AudioEngine;
