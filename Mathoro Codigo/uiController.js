import { PREGUNTAS, preguntaDeRespaldo, validarPregunta } from './preguntas.js';
import { GAME_CONFIG, GameLogic, randomInteger, randomItem, safeExecute, shuffleList } from './gameLogic.js';
import { AudioEngine } from './audioEngine.js';

async function readApiJson(response) {
    if (!(response.headers.get('content-type') || '').includes('application/json')) {
        throw new Error('El servidor respondió con HTML en vez de JSON. Inicia MATHORO con iniciar_mathoro.bat.');
    }
    try { return await response.json(); }
    catch { throw new Error('El servidor envió JSON inválido. Reinicia MATHORO con iniciar_mathoro.bat.'); }
}

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
        this.scoreSubmitted = false;
        this.runId = 0;
        this.runStats = null;
        this.timerInterval = null;
        this.endTimeouts = new Set();
        this.messageIndex = 0;
        this.lastScore = null;
        this.lastCombo = null;

        /* --- Sprint 5: estado de habilidades del jefe --- */
        this.bossTimers = new Set();
        this.mezclaPhase = null;
        this.bossExpressDeadline = 0;

        this.bindEvents();
        this.bindGlobalErrorRecovery();
        this.startRun();
    }

    cacheElements() {
        const ids = [
            'vidaFill', 'escudoVidaIcono', 'preguntaTexto', 'dificultad',
            'enemigoFill', 'enemigoHPTxt', 'jugadorHPTxt', 'comboVal', 'multiplicador',
            'btnFuria', 'btn5050', 'btnEscudo', 'btnUltimate',
            'ultimateFill', 'ultimateTrack', 'ultimateStatus', 'gameover', 'btnReiniciar',
            'motivacional', 'puntajeValor', 'tiempoValor', 'resumenFinal',
            'tituloFinal', 'videoJefe', 'rageOverlay', 'contenedor',
            'bannerJefe', 'bossTimer', 'bossTimerValor'
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
        this.runId += 1;
        this.scoreSubmitted = false;
        this.runStats = { maxCombo: 0, ultimatesUsed: 0, fastAnswers: 0, correctAnswers: 0 };
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

    selectHighDifficultyQuestion() {
        if (!Array.isArray(PREGUNTAS) || PREGUNTAS.length === 0) return preguntaDeRespaldo;
        const hard = PREGUNTAS.filter(q => validarPregunta(q) && q.dificultad >= 3);
        if (hard.length > 0) return randomItem(hard);
        const sorted = PREGUNTAS.filter(validarPregunta).sort((a, b) => b.dificultad - a.dificultad);
        return sorted[0] || preguntaDeRespaldo;
    }

    selectEasyQuestion() {
        if (!Array.isArray(PREGUNTAS) || PREGUNTAS.length === 0) return preguntaDeRespaldo;
        const easy = PREGUNTAS.filter(q => validarPregunta(q) && q.dificultad <= 1);
        if (easy.length > 0) return randomItem(easy);
        const sorted = PREGUNTAS.filter(validarPregunta).sort((a, b) => a.dificultad - b.dificultad);
        return sorted[0] || preguntaDeRespaldo;
    }

    newQuestion() {
        if (this.game.getState().phase !== 'playing') return;
        try {
            this.clearBossSkill();

            this.game.state.turnsPlayed = (this.game.state.turnsPlayed || 0) + 1;

            let bossSkill = null;
            if (this.game.shouldTriggerBossSkill()) {
                bossSkill = this.game.selectBossSkill();
                const started = this.game.startBossSkill(bossSkill);
                if (!started.started) bossSkill = null;
            }

            let question;
            if (bossSkill === 'doble') {
                question = this.selectHighDifficultyQuestion();
            } else if (bossSkill === 'rafaga') {
                question = this.selectEasyQuestion();
            } else {
                question = this.selectValidQuestion();
            }

            this.showQuestion(question);

            if (bossSkill) this.announceBossSkill(bossSkill);
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
            button.classList.remove('correcta', 'incorrecta', 'descartada', 'boca-abajo', 'mezclando');
            button.style.transform = '';
            button.dataset.index = String(index);
            button.disabled = false;
        });

        this.elements.contenedor.classList.remove('doble-onada');
        this.mezclaPhase = null;

        this.busy = false;
        this.questionStartedAt = Date.now();
        this.rotateMessage();
        this.render(this.game.getState());
    }

    handleAnswer(button) {
        if (this.busy || button.disabled || this.game.getState().phase !== 'playing') return;

        const skill = this.game.getState().activeBossSkill;

        if (skill === 'mezcla' && this.mezclaPhase === null) {
            this.busy = true;
            this.mezclaPhase = 'shuffling';
            void this.audio.resume();
            this.runMezclaSombría();
            return;
        }

        this.busy = true;
        void this.audio.resume();
        const elapsed = Date.now() - this.questionStartedAt;

        if (skill === 'doble') {
            this.resolveDobleONada(button, elapsed);
            return;
        }

        if (skill === 'rafaga') {
            this.clearBossTimers();
            this.elements.bossTimer.hidden = true;
            this.elements.bossTimer.classList.remove('alerta');
        }

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
            this.runStats.correctAnswers += 1;
            if (result.bonus === GAME_CONFIG.fastBonus) this.runStats.fastAnswers += 1;
            button.classList.add('correcta');
            this.audio.playCorrect();
            this.showFloatingText(button, `+${result.points}`, '#6FBF4F');
            this.showFloatingText(button, `−${result.damage} HP`, '#C24A3A', 160);
            if (result.rageStarted) this.elements.rageOverlay.classList.add('activo');
        } else {
            button.classList.add('incorrecta');
            this.answerButtons.forEach(option => {
                if (option.dataset.valor === this.currentCorrectAnswer) option.classList.add('correcta');
            });
            this.audio.playError();
            if (result.shieldBlocked) this.showFloatingText(button, 'BLOQUEADO', '#F1C991');
            else this.showFloatingText(button, '−1 VIDA', '#C24A3A');
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
        this.runStats.ultimatesUsed += 1;
        this.busy = true;
        this.audio.playUltimate();
        this.elements.contenedor.classList.remove('ultimate-active');
        void this.elements.contenedor.offsetWidth;
        this.elements.contenedor.classList.add('ultimate-active');
        this.showFloatingText(this.elements.preguntaTexto, `RAYO −${result.damage} HP`, '#F1C991');
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
        if (this.runStats) this.runStats.maxCombo = Math.max(this.runStats.maxCombo, state.combo || 0);
        // ---- Barra del JUGADOR ----
        // (El color ahora lo controla el CSS: mismo gradiente bronce que el jefe.)
        const lifePercent = state.lives / GAME_CONFIG.maxLives * 100;
        this.elements.vidaFill.style.width = `${lifePercent}%`;
        this.elements.jugadorHPTxt.textContent = `${state.lives}/${GAME_CONFIG.maxLives}`;
        this.elements.escudoVidaIcono.classList.toggle('activo', state.shieldActive);

        // ---- Barra del JEFE ----
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
        const score = this.game.getState().score;
        this.elements.resumenFinal.textContent =
            `Puntaje: ${score} pts · Tiempo: ${this.formatTime(this.finalElapsedMs ?? (Date.now() - this.gameStartedAt))}`;
        this.elements.gameover.classList.add('visible');
        if (!this.scoreSubmitted) {
            this.scoreSubmitted = true;
            void this.saveScore(score, result, this.runId);
        }
        try { this.elements.videoJefe.currentTime = 0; } catch (_) { /* El video puede seguir cargando. */ }
        const playback = this.elements.videoJefe.play();
        if (playback?.catch) playback.catch(() => {});
        if (won) this.audio.playVictory();
        else this.audio.playDefeat();
    }

    async saveScore(points, result, runId) {
        const appendStatus = (message) => {
            if (runId !== this.runId) return;
            this.elements.resumenFinal.textContent += ` · ${message}`;
        };
        try {
            const response = await fetch('/api/scores', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'same-origin',
                body: JSON.stringify({
                    points,
                    result,
                    stats: { ...this.runStats, remainingLives: this.game.getState().lives }
                })
            });
            const data = await readApiJson(response);
            if (response.status === 401) {
                appendStatus('Inicia sesión para guardar tu puntaje en el ranking');
            } else if (!response.ok) {
                appendStatus(data.error || 'No se pudo guardar el puntaje');
            } else {
                const labels = {
                    'primera-partida': 'Primera partida',
                    campeon: 'Campeón',
                    'puntaje-1000': 'Mil puntos',
                    'puntaje-3000': 'Tres mil puntos',
                    'puntaje-5000': 'Cinco mil puntos',
                    'cinco-partidas': 'Constante',
                    'diez-partidas': 'Veterano',
                    'tres-victorias': 'Tricampeón',
                    'diez-victorias': 'Leyenda',
                    'combo-5': 'Combo x5',
                    'combo-10': 'Combo x10',
                    'combo-15': 'Combo x15',
                    'primer-rayo': 'Rayo matemático',
                    'cinco-rayos': 'Cinco rayos',
                    reflejos: 'Reflejos rápidos',
                    'mente-matematica': 'Mente matemática',
                    'sin-perder-vidas': 'Sin perder vidas',
                    acumulador: 'Acumulador'
                };
                const unlocked = (data.newAchievements || []).map((id) => labels[id]).filter(Boolean);
                appendStatus(unlocked.length
                    ? `¡Logro desbloqueado: ${unlocked.slice(0, 2).join(' y ')}!`
                    : 'Puntaje guardado en el ranking');
            }
        } catch (error) {
            appendStatus(error instanceof TypeError ? 'No se pudo conectar con el ranking' : error.message);
        }
    }

    restart() {
        this.clearScheduledTasks();
        this.clearBossSkill();
        this.stopTimer();
        this.lastScore = null;
        this.lastCombo = null;
        this.messageIndex = 0;
        this.startRun();
    }

    /* =========================================================
       SPRINT 5 · Habilidades del Jefe MATHORO
       ========================================================= */

    announceBossSkill(skill) {
        const textos = {
            rafaga: '¡MATHORO USA: RELOJ DE RÁFAGA!',
            mezcla: '¡MATHORO USA: MEZCLA SOMBRÍA!',
            doble:  '¡MATHORO USA: DOBLE O NADA!'
        };
        const banner = this.elements.bannerJefe;
        banner.textContent = textos[skill] || '¡ATAQUE DEL JEFE!';
        banner.classList.add('visible');

        try { this.audio.playError(); } catch (_) { /* El audio es opcional */ }

        this.scheduleBoss(() => banner.classList.remove('visible'), 2800);

        switch (skill) {
            case 'rafaga':
                this.elements.motivacional.textContent = '¡Pregunta fácil! Responde antes del reloj.';
                this.elements.motivacional.style.opacity = '1';
                this.scheduleBoss(() => this.startRafagaTimer(), 700);
                break;

            case 'mezcla':
                this.mezclaPhase = null;
                this.elements.motivacional.textContent = 'Responde y sigue tu opción con la mirada…';
                this.elements.motivacional.style.opacity = '1';
                break;

            case 'doble':
                this.elements.contenedor.classList.add('doble-onada');
                this.elements.motivacional.textContent = '¡Acierta = 300 de daño! ¡Falla = −2 vidas!';
                this.elements.motivacional.style.opacity = '1';
                break;
        }
    }

    startRafagaTimer() {
        if (this.game.getState().phase !== 'playing') return;
        if (this.game.getState().activeBossSkill !== 'rafaga') return;

        this.elements.bossTimer.hidden = false;
        this.elements.bossTimer.classList.remove('alerta');
        this.bossExpressDeadline = Date.now() + GAME_CONFIG.bossExpressTimeMs;

        const tick = () => {
            if (this.game.getState().phase !== 'playing') return;
            if (this.game.getState().activeBossSkill !== 'rafaga') return;

            const remaining = Math.max(0, this.bossExpressDeadline - Date.now());
            this.elements.bossTimerValor.textContent = (remaining / 1000).toFixed(1);

            if (remaining <= 0) {
                this.resolveRafagaTimeout();
                return;
            }
            if (remaining <= 1500) this.elements.bossTimer.classList.add('alerta');
            this.scheduleBoss(tick, 100);
        };
        tick();
    }

    resolveRafagaTimeout() {
        if (this.game.getState().phase !== 'playing') return;
        this.busy = true;
        this.clearBossTimers();

        this.elements.bossTimer.hidden = true;
        this.elements.bossTimer.classList.remove('alerta');
        this.elements.bossTimerValor.textContent = '0.0';

        const result = this.game.resolveBossExpressTimeout();

        this.answerButtons.forEach(button => {
            button.disabled = true;
            if (button.dataset.valor === this.currentCorrectAnswer) button.classList.add('correcta');
        });

        this.showFloatingText(
            this.elements.preguntaTexto,
            result.blocked ? 'BLOQUEADO' : '−1 VIDA',
            '#C24A3A'
        );

        try {
            if (result.blocked) this.audio.playPower('shield');
            else this.audio.playError();
        } catch (_) { /* el audio no debe bloquear la recuperación */ }

        this.render(result.state);

        if (result.state.phase === 'defeat') {
            this.finalElapsedMs = Date.now() - this.gameStartedAt;
            this.stopTimer();
            this.schedule(() => this.showEndScreen('defeat'), 800);
            return;
        }

        this.schedule(() => this.newQuestion(), 1100);
    }

    runMezclaSombría() {
        const buttons = [...this.answerButtons];
        buttons.forEach(b => b.classList.add('boca-abajo'));

        this.scheduleBoss(() => {
            try {
                this.performMixAnimation(buttons);
            } catch (error) {
                console.warn('[MATHORO] La animación de mezcla falló; se retoma el turno normal.', error);
                this.clearBossSkill();
                this.busy = false;
            }
        }, 450);
    }

    performMixAnimation(buttons) {
        const rounds = Math.max(2, GAME_CONFIG.bossMixSwapCount || 8);
        const swapDurationMs = 550;
        const slots = [0, 1, 2, 3, 4, 5];

        buttons.forEach(b => b.classList.add('mezclando'));

        let round = 0;

        const doRound = () => {
            if (this.game.getState().activeBossSkill !== 'mezcla') return;
            round += 1;

            let newSlots = shuffleList(slots);
            let guard = 0;
            while (
                guard < 8 &&
                buttons.every((b, i) => Number(b.dataset.index) === newSlots[i])
            ) {
                newSlots = shuffleList(slots);
                guard += 1;
            }

            buttons.forEach((b, i) => {
                b.dataset.index = String(newSlots[i]);
            });

            if (round < rounds) {
                this.scheduleBoss(doRound, swapDurationMs);
            } else {
                this.scheduleBoss(() => {
                    buttons.forEach(b => b.classList.remove('mezclando'));
                    this.mezclaPhase = 'awaiting_pick';
                    this.busy = false;
                    this.elements.motivacional.textContent = '¿Dónde cayó tu respuesta?';
                    this.elements.motivacional.style.opacity = '1';
                }, swapDurationMs);
            }
        };

        this.scheduleBoss(doRound, 30);
    }

    resolveDobleONada(button, elapsed) {
        const correct = button.dataset.valor === this.currentCorrectAnswer;
        const result = this.game.resolveDobleONada(correct);

        if (result.applied && result.correct) {
            this.runStats.correctAnswers += 1;
            button.classList.add('correcta');
            try { this.audio.playCorrect(); } catch (_) {}
            this.showFloatingText(button, '+300 pts', '#6FBF4F');
            this.showFloatingText(button, `−${result.damage} HP`, '#C24A3A', 160);
        } else {
            button.classList.add('incorrecta');
            this.answerButtons.forEach(b => {
                if (b.dataset.valor === this.currentCorrectAnswer) b.classList.add('correcta');
            });
            try { this.audio.playError(); } catch (_) {}
            this.showFloatingText(button, '−2 VIDAS', '#C24A3A');
        }

        this.elements.contenedor.classList.remove('doble-onada');

        this.render(result.state);

        if (result.state.phase === 'victory' || result.state.phase === 'defeat') {
            this.finalElapsedMs = Date.now() - this.gameStartedAt;
            this.stopTimer();
            this.schedule(() => this.showEndScreen(result.state.phase), 900);
            return;
        }

        this.answerButtons.forEach(b => b.disabled = true);
        this.schedule(() => this.newQuestion(), 1100);
    }

    clearBossSkill() {
        this.clearBossTimers();

        this.mezclaPhase = null;
        this.bossExpressDeadline = 0;

        if (this.elements.bannerJefe) {
            this.elements.bannerJefe.classList.remove('visible');
        }
        if (this.elements.bossTimer) {
            this.elements.bossTimer.hidden = true;
            this.elements.bossTimer.classList.remove('alerta');
        }

        this.elements.contenedor.classList.remove('doble-onada');

        this.answerButtons.forEach((button, index) => {
            button.classList.remove('boca-abajo', 'mezclando');
            button.style.transform = '';
            button.dataset.index = String(index);
        });

        if (this.game && typeof this.game.clearBossSkill === 'function') {
            this.game.clearBossSkill();
        }
    }

    scheduleBoss(callback, delay) {
        const id = window.setTimeout(() => {
            this.bossTimers.delete(id);
            this.runSafely(callback, 'temporizador del jefe');
        }, delay);
        this.bossTimers.add(id);
        return id;
    }

    clearBossTimers() {
        this.bossTimers.forEach(id => window.clearTimeout(id));
        this.bossTimers.clear();
    }

    recoverGameState(message = 'La partida se recuperó y puede continuar.') {
        if (this.recovering) return;
        this.recovering = true;
        console.warn(`[MATHORO] ${message}`);
        try {
            this.clearScheduledTasks();
            this.clearBossSkill();
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
        this.clearBossTimers();
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
