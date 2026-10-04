import { PREGUNTAS, preguntaDeRespaldo, validarPregunta } from './preguntas.js';
import { GAME_CONFIG, GameLogic, randomInteger, safeExecute, shuffleList } from './gameLogic.js';
import { AudioEngine } from './audioEngine.js';

const MENSAJES = [
    '¡Sigue así, Mathoro!', '¡Eres increíble!', '¡Vas muy bien!',
    '¡No te rindas!', '¡Tú puedes!', '¡Mente veloz!',
    '¡Cada vez mejor!', '¡Concéntrate!'
];
const ERROR = Symbol('error-de-ciclo');

/** Coordina entrada, reglas y presentación sin almacenar reglas de combate. */
class UIController {
    constructor() {
        this.game = new GameLogic();
        this.audio = new AudioEngine();
        this.elements = this.cacheElements();
        this.answerButtons = [...document.querySelectorAll('.opcion')];
        this.busy = false;
        this.recovering = false;
        this.questionStartedAt = 0;
        this.gameStartedAt = 0;
        this.finalElapsedMs = null;
        this.timerInterval = null;
        this.endTimeouts = new Set();
        this.messageIndex = 0;
        this.lastScore = null;
        this.lastCombo = null;
        this.bindEvents();
        this.bindGlobalErrorRecovery();
        this.startRun();
    }

    cacheElements() {
        const ids = [
            'vidaFill', 'escudoVidaIcono', 'preguntaTexto', 'dificultad',
            'enemigoFill', 'enemigoHPTxt', 'comboVal', 'multiplicador',
            'btnFuria', 'btn5050', 'btnEscudo', 'btnUltimate',
            'ultimateFill', 'ultimateTrack', 'ultimateStatus', 'gameover', 'btnReiniciar',
            'motivacional', 'puntajeValor', 'tiempoValor', 'resumenFinal',
            'tituloFinal', 'videoJefe', 'rageOverlay', 'contenedor'
        ];
        const elements = Object.fromEntries(ids.map(id => [id, document.getElementById(id)]));
        const missing = ids.filter(id => !elements[id]);
        if (missing.length) throw new Error(`Faltan elementos en nivel1.html: ${missing.join(', ')}`);
        return elements;
    }

    bindEvents() {
        this.answerButtons.forEach(button => {
            button.addEventListener('click', () => this.runSafely(
                () => this.handleAnswer(button), 'resolución de respuesta'
            ));
        });
        this.elements.btnReiniciar.addEventListener('click', () => this.runSafely(
            () => this.restart(), 'reinicio de partida'
        ));
        this.elements.btnFuria.addEventListener('click', () => this.runSafely(
            () => this.handleFury(), 'poder Furia'
        ));
        this.elements.btn5050.addEventListener('click', () => this.runSafely(
            () => this.handleFiftyFifty(), 'poder 50/50'
        ));
        this.elements.btnEscudo.addEventListener('click', () => this.runSafely(
            () => this.handleShield(), 'poder Escudo'
        ));
        this.elements.btnUltimate.addEventListener('click', () => this.runSafely(
            () => this.handleUltimate(), 'Rayo Matemático'
        ));
        document.addEventListener('keydown', event => this.runSafely(
            () => this.handleKeydown(event), 'entrada de teclado'
        ));
        document.addEventListener('pointerdown', () => { void this.audio.resume(); }, { passive: true });
    }

    bindGlobalErrorRecovery() {
        window.addEventListener('error', event => {
            if (event.error || event.message) {
                this.recoverGameState(`Error inesperado: ${event.message || 'fallo de ejecución'}`);
            }
        });
        window.addEventListener('unhandledrejection', event => {
            this.recoverGameState(`Operación interrumpida: ${String(event.reason || 'error asíncrono')}`);
        });
    }

    runSafely(operation, context) {
        const result = safeExecute(operation, ERROR, context);
        if (result === ERROR) this.recoverGameState(`Se recuperó la partida tras un error en ${context}.`);
        return result;
    }

    startRun() {
        this.game.reset();
        this.gameStartedAt = Date.now();
        this.finalElapsedMs = null;
        this.busy = false;
        this.elements.gameover.classList.remove('visible');
        this.elements.contenedor.classList.remove('ultimate-active');
        this.elements.videoJefe.pause();
        try { this.elements.videoJefe.currentTime = 0; } catch (_) { /* El video puede seguir cargando. */ }
        this.startTimer();
        this.render(this.game.getState());
        this.newQuestion();
    }

    /** Selecciona al azar una pregunta íntegra y salta todas las corruptas. */
    selectValidQuestion() {
        if (!Array.isArray(PREGUNTAS) || PREGUNTAS.length === 0) {
            console.warn('[MATHORO] Banco vacío o inválido; se usará la pregunta de respaldo.');
            return preguntaDeRespaldo;
        }
        const startIndex = randomInteger(0, PREGUNTAS.length - 1);
        for (let offset = 0; offset < PREGUNTAS.length; offset += 1) {
            const candidate = PREGUNTAS[(startIndex + offset) % PREGUNTAS.length];
            if (validarPregunta(candidate)) return candidate;
            console.warn(`[MATHORO] Pregunta inválida en el índice ${(startIndex + offset) % PREGUNTAS.length}; se omitirá.`, candidate);
        }
        console.warn('[MATHORO] No hay preguntas válidas; se usará la pregunta de respaldo.');
        return preguntaDeRespaldo;
    }

    newQuestion() {
        if (this.game.getState().phase !== 'playing') return;
        try {
            const question = this.selectValidQuestion();
            this.showQuestion(question);
        } catch (error) {
            console.warn('[MATHORO] No se pudo preparar la pregunta; se activará el respaldo.', error);
            this.recoverGameState('Se cargó una pregunta segura para continuar.');
        }
    }

    showQuestion(question) {
        const validQuestion = validarPregunta(question) ? question : preguntaDeRespaldo;
        const view = this.game.setQuestion(validQuestion);
        this.currentCorrectAnswer = view.correcta;
        this.elements.preguntaTexto.textContent = view.pregunta;
        this.elements.dificultad.textContent = `${'★'.repeat(view.dificultad)}${'☆'.repeat(3 - view.dificultad)}`;
        this.elements.dificultad.dataset.nivel = String(view.dificultad);

        const answers = shuffleList([...view.opciones]);
        this.answerButtons.forEach((button, index) => {
            button.textContent = answers[index];
            button.dataset.valor = answers[index];
            button.setAttribute('aria-label', `Respuesta ${index + 1}: ${answers[index]}`);
            button.classList.remove('correcta', 'incorrecta', 'descartada');
            button.disabled = false;
        });
        this.busy = false;
        this.questionStartedAt = Date.now();
        this.rotateMessage();
        this.render(this.game.getState());
    }

    handleAnswer(button) {
        if (this.busy || button.disabled || this.game.getState().phase !== 'playing') return;
        this.busy = true;
        void this.audio.resume();
        const elapsed = Date.now() - this.questionStartedAt;
        const result = this.game.answer(button.dataset.valor, elapsed);

        if (result.recovered) {
            this.recoverGameState('La lógica recuperó el turno con la pregunta de respaldo.');
            return;
        }
        if (!result.accepted) {
            this.busy = false;
            return;
        }

        if (result.correct) {
            button.classList.add('correcta');
            this.audio.playCorrect();
            this.showFloatingText(button, `+${result.points}`, '#4dff88');
            this.showFloatingText(button, `−${result.damage} HP`, '#ff5a5a', 160);
            if (result.rageStarted) this.elements.rageOverlay.classList.add('activo');
        } else {
            button.classList.add('incorrecta');
            this.answerButtons.forEach(option => {
                if (option.dataset.valor === this.currentCorrectAnswer) option.classList.add('correcta');
            });
            this.audio.playError();
            if (result.shieldBlocked) this.showFloatingText(button, 'BLOQUEADO', '#ffe27a');
            else this.showFloatingText(button, '−1 VIDA', '#ff5a5a');
        }

        this.render(result.state);
        if (result.state.phase === 'victory' || result.state.phase === 'defeat') {
            const resultName = result.state.phase;
            this.finalElapsedMs = Date.now() - this.gameStartedAt;
            this.stopTimer();
            this.schedule(() => this.showEndScreen(resultName), result.correct ? 900 : 700);
            return;
        }

        this.answerButtons.forEach(option => { option.disabled = true; });
        this.schedule(() => this.newQuestion(), result.correct ? 1000 : 1100);
    }

    handleFury() {
        if (this.busy) return;
        void this.audio.resume();
        const result = this.game.activateFury();
        if (!result.used) return;
        this.audio.playPower('fury');
        this.elements.motivacional.textContent = '¡FURIA ARMADA!';
        this.elements.motivacional.style.opacity = '1';
        this.render(result.state);
    }

    handleFiftyFifty() {
        if (this.busy) return;
        void this.audio.resume();
        const options = this.answerButtons.map(button => button.dataset.valor);
        const result = this.game.useFiftyFifty(options);
        if (!result.used) return;
        result.discardedIndexes.forEach(index => {
            this.answerButtons[index].classList.add('descartada');
            this.answerButtons[index].disabled = true;
        });
        this.audio.playPower('fiftyFifty');
        this.render(result.state);
    }

    handleShield() {
        if (this.busy) return;
        void this.audio.resume();
        const result = this.game.activateShield();
        if (!result.used) return;
        this.audio.playPower('shield');
        this.elements.motivacional.textContent = '¡ESCUDO ACTIVO!';
        this.elements.motivacional.style.opacity = '1';
        this.render(result.state);
    }

    handleUltimate() {
        if (this.busy) return;
        void this.audio.resume();
        const result = this.game.activateUltimate();
        if (!result.used) return;
        this.busy = true;
        this.audio.playUltimate();
        this.elements.contenedor.classList.remove('ultimate-active');
        void this.elements.contenedor.offsetWidth;
        this.elements.contenedor.classList.add('ultimate-active');
        this.showFloatingText(this.elements.preguntaTexto, `RAYO −${result.damage} HP`, '#79e8ff');
        this.render(result.state);
        window.setTimeout(() => this.elements.contenedor.classList.remove('ultimate-active'), 950);

        if (result.state.phase === 'victory') {
            this.finalElapsedMs = Date.now() - this.gameStartedAt;
            this.stopTimer();
            this.schedule(() => this.showEndScreen('victory'), 700);
        } else {
            this.schedule(() => {
                this.busy = false;
                this.render(this.game.getState());
            }, 650);
        }
    }

    handleKeydown(event) {
        const number = Number.parseInt(event.key, 10);
        if (number >= 1 && number <= 6) {
            const button = this.answerButtons[number - 1];
            if (button && !button.disabled && !button.classList.contains('descartada')) {
                event.preventDefault();
                button.click();
            }
            return;
        }
        const key = event.key.toLowerCase();
        if (key === 'q' && !this.elements.btnFuria.disabled) this.elements.btnFuria.click();
        if (key === 'w' && !this.elements.btn5050.disabled) this.elements.btn5050.click();
        if (key === 'e' && !this.elements.btnEscudo.disabled) this.elements.btnEscudo.click();
        if (key === 'r' && !this.elements.btnUltimate.disabled) this.elements.btnUltimate.click();
    }

    render(state) {
        const lifePercent = state.lives / GAME_CONFIG.maxLives * 100;
        this.elements.vidaFill.style.width = `${lifePercent}%`;
        this.elements.vidaFill.style.background = lifePercent > 60
            ? '#22c55e' : lifePercent > 30 ? '#f0a000' : '#d32020';
        this.elements.escudoVidaIcono.classList.toggle('activo', state.shieldActive);

        const enemyPercent = Math.max(0, state.enemyHp / GAME_CONFIG.maxEnemyHp * 100);
        this.elements.enemigoFill.style.width = `${enemyPercent}%`;
        this.elements.enemigoHPTxt.textContent = `${state.enemyHp}/${GAME_CONFIG.maxEnemyHp}`;
        this.elements.comboVal.textContent = String(state.combo);
        this.elements.multiplicador.textContent = `${state.multiplier}x`;
        this.elements.multiplicador.className = `multiplicador x${state.multiplier}`;
        this.elements.rageOverlay.classList.toggle('activo', state.combo >= GAME_CONFIG.rageComboRequired);

        const ultimatePercent = state.ultimateCharge / GAME_CONFIG.ultimateCorrectStreak * 100;
        this.elements.ultimateFill.style.width = `${ultimatePercent}%`;
        this.elements.ultimateTrack.setAttribute('aria-valuenow', String(state.ultimateCharge));
        this.elements.ultimateStatus.textContent = state.ultimateReady
            ? 'CARGADO' : `${state.ultimateCharge}/${GAME_CONFIG.ultimateCorrectStreak}`;
        this.elements.btnUltimate.disabled = state.phase !== 'playing' || !state.ultimateReady || this.busy;
        this.elements.btnUltimate.classList.toggle('listo', state.ultimateReady);

        if (this.lastScore !== state.score) {
            this.elements.puntajeValor.textContent = String(state.score);
            this.pop(this.elements.puntajeValor, 'pop');
            this.lastScore = state.score;
        }
        if (this.lastCombo !== state.combo) {
            this.pop(this.elements.comboVal, 'pop');
            this.lastCombo = state.combo;
        }

        const powersReady = state.phase === 'playing' && !this.busy
            && state.combo >= GAME_CONFIG.powerComboRequired;
        this.elements.btnFuria.disabled = !powersReady || state.furyArmed;
        this.elements.btnFuria.classList.toggle('activo', state.furyArmed);
        this.elements.btn5050.disabled = !powersReady || state.score < GAME_CONFIG.fiftyFiftyCost;
        this.elements.btnEscudo.disabled = !powersReady
            || state.score < GAME_CONFIG.shieldCost || state.shieldActive;
    }

    startTimer() {
        this.stopTimer();
        this.elements.tiempoValor.textContent = '00:00';
        this.timerInterval = window.setInterval(() => {
            this.elements.tiempoValor.textContent = this.formatTime(Date.now() - this.gameStartedAt);
        }, 250);
    }

    stopTimer() {
        if (this.timerInterval !== null) {
            window.clearInterval(this.timerInterval);
            this.timerInterval = null;
        }
    }

    formatTime(milliseconds) {
        const totalSeconds = Math.floor(milliseconds / 1000);
        return `${String(Math.floor(totalSeconds / 60)).padStart(2, '0')}:${String(totalSeconds % 60).padStart(2, '0')}`;
    }

    showEndScreen(result) {
        const won = result === 'victory';
        this.elements.tituloFinal.textContent = won ? '¡Ganaste!' : '¡Te derrotaron!';
        this.elements.resumenFinal.textContent =
            `Puntaje: ${this.game.getState().score} pts · Tiempo: ${this.formatTime(this.finalElapsedMs ?? (Date.now() - this.gameStartedAt))}`;
        this.elements.gameover.classList.add('visible');
        try { this.elements.videoJefe.currentTime = 0; } catch (_) { /* El video puede seguir cargando. */ }
        const playback = this.elements.videoJefe.play();
        if (playback?.catch) playback.catch(() => {});
        if (won) this.audio.playVictory();
        else this.audio.playDefeat();
    }

    restart() {
        this.clearScheduledTasks();
        this.stopTimer();
        this.lastScore = null;
        this.lastCombo = null;
        this.messageIndex = 0;
        this.startRun();
    }

    /** Restaura la interfaz con la pregunta de emergencia sin borrar el puntaje. */
    recoverGameState(message = 'La partida se recuperó y puede continuar.') {
        if (this.recovering) return;
        this.recovering = true;
        console.warn(`[MATHORO] ${message}`);
        try {
            this.clearScheduledTasks();
            document.querySelectorAll('.dano-flotante').forEach(element => element.remove());
            this.answerButtons.forEach(button => {
                button.classList.remove('correcta', 'incorrecta', 'descartada');
                button.disabled = false;
            });
            this.elements.gameover.classList.remove('visible');
            this.elements.contenedor.classList.remove('ultimate-active');
            this.busy = false;

            const fallback = this.game.recoverGameState(preguntaDeRespaldo);
            this.elements.motivacional.textContent = '¡Partida recuperada! Continúa jugando.';
            this.elements.motivacional.style.opacity = '1';
            this.showQuestion(fallback);
            if (this.timerInterval === null) this.startTimer();
        } catch (error) {
            console.warn('[MATHORO] La recuperación necesitó reiniciar el estado interno.', error);
            const score = this.game?.getState?.().score || 0;
            this.game.reset();
            this.game.state.score = score;
            this.busy = false;
            try {
                this.showQuestion(preguntaDeRespaldo);
                if (this.timerInterval === null) this.startTimer();
            } catch (_) { /* El respaldo estático es el último nivel de tolerancia a fallos. */ }
        } finally {
            window.setTimeout(() => { this.recovering = false; }, 200);
        }
    }

    clearScheduledTasks() {
        this.endTimeouts.forEach(timeout => window.clearTimeout(timeout));
        this.endTimeouts.clear();
    }

    showFloatingText(anchor, text, color, delay = 0) {
        const rect = anchor.getBoundingClientRect();
        const element = document.createElement('div');
        element.className = 'dano-flotante';
        element.textContent = text;
        element.style.left = `${rect.left + rect.width / 2}px`;
        element.style.top = `${rect.top + rect.height / 2 + delay / 4}px`;
        element.style.color = color;
        element.style.animationDelay = `${delay}ms`;
        document.body.appendChild(element);
        window.setTimeout(() => element.remove(), 1400 + delay);
    }

    rotateMessage() {
        const element = this.elements.motivacional;
        element.style.opacity = '0';
        element.style.transform = 'translateY(4px)';
        this.schedule(() => {
            element.textContent = MENSAJES[this.messageIndex];
            this.messageIndex = (this.messageIndex + 1) % MENSAJES.length;
            element.style.opacity = '1';
            element.style.transform = 'translateY(0)';
        }, 350);
    }

    schedule(callback, delay) {
        const timeout = window.setTimeout(() => {
            this.endTimeouts.delete(timeout);
            this.runSafely(callback, 'transición de interfaz');
        }, delay);
        this.endTimeouts.add(timeout);
        return timeout;
    }

    pop(element, className) {
        element.classList.remove(className);
        void element.offsetWidth;
        element.classList.add(className);
    }
}

window.addEventListener('DOMContentLoaded', () => {
    safeExecute(() => new UIController(), error => {
        console.warn('[MATHORO] No se pudo iniciar el controlador.', error);
        return null;
    }, 'inicio de la interfaz');
});
