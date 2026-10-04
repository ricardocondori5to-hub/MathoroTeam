import { preguntaDeRespaldo, validarPregunta } from './preguntas.js';

/** Valores ajustables de balance y reglas para toda la partida. */
export const GAME_CONFIG = Object.freeze({
    maxLives: 5,
    maxEnemyHp: 1000,
    baseDamage: 100,
    basePoints: 100,
    fastBonus: 50,
    mediumBonus: 25,
    fastThresholdMs: 3000,
    mediumThresholdMs: 5000,
    fiftyFiftyCost: 200,
    shieldCost: 150,
    powerComboRequired: 2,
    rageComboRequired: 5,
    maxMultiplier: 5,
    ultimateDamage: 300,
    ultimateCorrectStreak: 3
});

/** Ejecuta una operación sin propagar excepciones al ciclo principal. */
export function safeExecute(operation, fallback = null, context = 'operación') {
    try {
        return operation();
    } catch (error) {
        console.warn(`[MATHORO] Falló ${context}; se usará recuperación segura.`, error);
        return typeof fallback === 'function' ? fallback(error) : fallback;
    }
}

/** Valida un dato y devuelve el valor de respaldo si no cumple el validador. */
export function validateData(value, validator, fallback = null) {
    if (typeof validator !== 'function') return fallback;
    return safeExecute(() => validator(value) ? value : fallback, fallback, 'validación de datos');
}

/** Genera un entero aleatorio inclusivo entre min y max. */
export function randomInteger(min, max, random = Math.random) {
    const lower = Math.ceil(min);
    const upper = Math.floor(max);
    if (!Number.isFinite(lower) || !Number.isFinite(upper) || upper < lower) return lower || 0;
    return Math.floor(random() * (upper - lower + 1)) + lower;
}

/** Elige un elemento al azar o null si la lista está vacía. */
export function randomItem(items, random = Math.random) {
    return Array.isArray(items) && items.length
        ? items[randomInteger(0, items.length - 1, random)]
        : null;
}

/** Devuelve una copia de la lista en orden aleatorio. */
export function shuffleList(items, random = Math.random) {
    if (!Array.isArray(items)) return [];
    const shuffled = [...items];
    for (let index = shuffled.length - 1; index > 0; index -= 1) {
        const other = randomInteger(0, index, random);
        [shuffled[index], shuffled[other]] = [shuffled[other], shuffled[index]];
    }
    return shuffled;
}

/**
 * Mantiene las reglas de la partida sin dependencias del navegador ni del DOM.
 * Los métodos devuelven resultados de dominio que la interfaz puede presentar.
 */
export class GameLogic {
    static CONFIG = GAME_CONFIG;

    constructor() {
        this.reset();
    }

    reset() {
        this.state = {
            lives: GAME_CONFIG.maxLives,
            enemyHp: GAME_CONFIG.maxEnemyHp,
            score: 0,
            combo: 0,
            multiplier: 1,
            furyArmed: false,
            shieldActive: false,
            ultimateCharge: 0,
            phase: 'playing',
            result: null
        };
        this.correctAnswer = null;
        this.questionResolved = true;
        return this.getState();
    }

    /** Prepara una pregunta validada para el siguiente turno. */
    setQuestion(question) {
        const safeQuestion = validateData(question, validarPregunta, null);
        if (!safeQuestion) throw new TypeError('La pregunta no supera la validación de integridad.');
        this.correctAnswer = safeQuestion.correcta;
        this.questionResolved = false;
        return {
            tema: safeQuestion.tema,
            pregunta: safeQuestion.pregunta,
            dificultad: safeQuestion.dificultad,
            opciones: [...safeQuestion.opciones],
            correcta: safeQuestion.correcta
        };
    }

    /** Resuelve una respuesta, protege el turno y recupera el estado ante errores. */
    answer(value, elapsedMs = 0) {
        try {
            if (this.state.phase !== 'playing' || this.questionResolved) {
                return { accepted: false, correct: false, state: this.getState() };
            }
            if (typeof this.correctAnswer !== 'string') {
                throw new Error('No hay una respuesta correcta preparada.');
            }
            this.questionResolved = true;
            const state = this.state;

            if (value !== this.correctAnswer) {
                state.combo = 0;
                state.multiplier = 1;
                state.furyArmed = false;
                state.ultimateCharge = 0;
                const shieldBlocked = state.shieldActive;
                if (shieldBlocked) state.shieldActive = false;
                else state.lives = Math.max(0, state.lives - 1);
                if (state.lives === 0) this.finish('defeat');
                return {
                    accepted: true,
                    correct: false,
                    shieldBlocked,
                    lostLife: !shieldBlocked,
                    state: this.getState()
                };
            }

            state.combo += 1;
            state.multiplier = Math.min(
                1 + Math.floor(state.combo / 3),
                GAME_CONFIG.maxMultiplier
            );
            const bonus = elapsedMs < GAME_CONFIG.fastThresholdMs
                ? GAME_CONFIG.fastBonus
                : elapsedMs < GAME_CONFIG.mediumThresholdMs
                    ? GAME_CONFIG.mediumBonus
                    : 0;
            const furyUsed = state.furyArmed;
            const furyMultiplier = furyUsed ? 2 : 1;
            const points = (GAME_CONFIG.basePoints + bonus) * state.multiplier * furyMultiplier;
            const damage = GAME_CONFIG.baseDamage * state.multiplier * furyMultiplier;

            state.score += points;
            state.enemyHp = Math.max(0, state.enemyHp - damage);
            state.furyArmed = false;
            state.ultimateCharge = Math.min(
                state.ultimateCharge + 1,
                GAME_CONFIG.ultimateCorrectStreak
            );
            if (state.enemyHp === 0) this.finish('victory');

            return {
                accepted: true,
                correct: true,
                bonus,
                points,
                damage,
                furyUsed,
                ultimateCharged: state.ultimateCharge,
                ultimateReady: state.ultimateCharge >= GAME_CONFIG.ultimateCorrectStreak,
                rageStarted: state.combo === GAME_CONFIG.rageComboRequired,
                state: this.getState()
            };
        } catch (error) {
            console.warn('[MATHORO] Error al resolver la respuesta. Se recuperará la partida.', error);
            const question = this.recoverGameState(preguntaDeRespaldo);
            return { accepted: false, correct: false, recovered: true, question, state: this.getState() };
        }
    }

    activateFury() {
        const state = this.state;
        if (state.phase !== 'playing' || state.combo < GAME_CONFIG.powerComboRequired || state.furyArmed) {
            return { used: false, reason: 'unavailable', state: this.getState() };
        }
        state.furyArmed = true;
        return { used: true, state: this.getState() };
    }

    useFiftyFifty(options, random = Math.random) {
        const state = this.state;
        if (state.phase !== 'playing' || state.combo < GAME_CONFIG.powerComboRequired) {
            return { used: false, reason: 'unavailable', state: this.getState() };
        }
        if (state.score < GAME_CONFIG.fiftyFiftyCost) {
            return { used: false, reason: 'insufficient-points', state: this.getState() };
        }
        if (!Array.isArray(options)) return { used: false, reason: 'invalid-options', state: this.getState() };
        const incorrectIndexes = options
            .map((option, index) => option === this.correctAnswer ? -1 : index)
            .filter(index => index >= 0);
        if (incorrectIndexes.length < 2) {
            return { used: false, reason: 'no-options', state: this.getState() };
        }
        const discardedIndexes = shuffleList(incorrectIndexes, random).slice(0, 2);
        state.score -= GAME_CONFIG.fiftyFiftyCost;
        return { used: true, discardedIndexes, state: this.getState() };
    }

    activateShield() {
        const state = this.state;
        if (state.phase !== 'playing' || state.combo < GAME_CONFIG.powerComboRequired) {
            return { used: false, reason: 'unavailable', state: this.getState() };
        }
        if (state.shieldActive) return { used: false, reason: 'already-active', state: this.getState() };
        if (state.score < GAME_CONFIG.shieldCost) {
            return { used: false, reason: 'insufficient-points', state: this.getState() };
        }
        state.score -= GAME_CONFIG.shieldCost;
        state.shieldActive = true;
        return { used: true, state: this.getState() };
    }

    /** Consume la carga y golpea al enemigo sin depender del reloj de respuesta. */
    activateUltimate() {
        const state = this.state;
        if (state.phase !== 'playing' || state.ultimateCharge < GAME_CONFIG.ultimateCorrectStreak) {
            return { used: false, reason: 'not-charged', state: this.getState() };
        }
        const damage = Math.min(GAME_CONFIG.ultimateDamage, state.enemyHp);
        state.enemyHp = Math.max(0, state.enemyHp - GAME_CONFIG.ultimateDamage);
        state.ultimateCharge = 0;
        if (state.enemyHp === 0) this.finish('victory');
        return { used: true, damage, state: this.getState() };
    }

    /** Recupera una partida sin borrar el puntaje ni los recursos actuales. */
    recoverGameState(fallbackQuestion = preguntaDeRespaldo) {
        const safeQuestion = validateData(fallbackQuestion, validarPregunta, preguntaDeRespaldo);
        if (!this.state) this.reset();
        this.state.phase = 'playing';
        this.state.result = null;
        this.state.lives = Math.max(1, Math.min(GAME_CONFIG.maxLives, this.state.lives));
        this.state.enemyHp = Math.max(1, Math.min(GAME_CONFIG.maxEnemyHp, this.state.enemyHp));
        this.state.score = Math.max(0, Number.isFinite(this.state.score) ? this.state.score : 0);
        this.state.combo = Math.max(0, Number.isFinite(this.state.combo) ? this.state.combo : 0);
        this.state.multiplier = Math.max(1, Math.min(GAME_CONFIG.maxMultiplier, this.state.multiplier || 1));
        this.state.ultimateCharge = Math.max(0, Math.min(
            GAME_CONFIG.ultimateCorrectStreak,
            Number.isFinite(this.state.ultimateCharge) ? this.state.ultimateCharge : 0
        ));
        this.correctAnswer = safeQuestion.correcta;
        this.questionResolved = false;
        return {
            ...safeQuestion,
            opciones: [...safeQuestion.opciones]
        };
    }

    finish(result) {
        if (this.state.phase !== 'playing') return;
        this.state.phase = result;
        this.state.result = result;
    }

    getState() {
        return {
            ...this.state,
            ultimateReady: this.state.ultimateCharge >= GAME_CONFIG.ultimateCorrectStreak
        };
    }
}

export default GameLogic;
