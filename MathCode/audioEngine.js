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
            const effectsVolume = Number(window.MathoroSettings?.get('volumen') ?? 70) / 100;
            const adjustedVolume = volume * Math.min(1, Math.max(0, effectsVolume));
            if (adjustedVolume <= 0) return false;
            const start = this.context.currentTime + delay;
            const end = start + duration;
            const oscillator = this.context.createOscillator();
            const gain = this.context.createGain();
            oscillator.type = type;
            oscillator.frequency.setValueAtTime(frequency, start);
            gain.gain.setValueAtTime(0.0001, start);
            gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, adjustedVolume), start + 0.015);
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
        this.playPlayerAttack();
        this.tone(523, 0.12, { type: 'triangle', volume: 0.12 });
        this.tone(659, 0.14, { delay: 0.08, type: 'triangle', volume: 0.14 });
        this.tone(880, 0.2, { delay: 0.16, volume: 0.16 });
    }

    playError() {
        this.tone(118, 0.24, { type: 'triangle', volume: 0.16 });
        this.tone(220, 0.28, { type: 'triangle', volume: 0.14 });
        this.tone(165, 0.32, { type: 'sawtooth', delay: 0.08, volume: 0.09 });
    }

    playPlayerAttack() {
        this.tone(146, 0.16, { type: 'triangle', volume: 0.17 });
        this.tone(392, 0.1, { type: 'sawtooth', delay: 0.025, volume: 0.08 });
    }

    playBossAttack(skill) {
        const patterns = {
            rafaga: { notes: [784, 587, 440], type: 'sawtooth', delay: 0.11 },
            mezcla: { notes: [330, 494, 392, 587], type: 'square', delay: 0.075 },
            doble: { notes: [164, 123, 82], type: 'sawtooth', delay: 0.14 }
        };
        const pattern = patterns[skill] || patterns.doble;
        pattern.notes.forEach((note, index) => this.tone(note, 0.22, {
            type: pattern.type, delay: index * pattern.delay, volume: 0.12
        }));
        if (skill === 'doble') this.tone(55, 0.32, { type: 'triangle', delay: 0.06, volume: 0.2 });
    }

    playBossImpact() {
        this.tone(92, 0.3, { type: 'sawtooth', volume: 0.18 });
        this.tone(138, 0.2, { type: 'triangle', delay: 0.035, volume: 0.12 });
    }

    playShuffle() {
        [620, 430, 560, 350, 500, 310].forEach((note, index) => this.tone(note, 0.09, {
            type: 'square', delay: index * 0.07, volume: 0.06
        }));
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
