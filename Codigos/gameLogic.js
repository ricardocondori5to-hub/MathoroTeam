import { preguntaDeRespaldo, validarPregunta } from './preguntas.js';

/** Valores ajustables de balance y reglas para toda la partida. */
export const GAME_CONFIG = Object.freeze({
    maxLives: 20,
    maxEnemyHp: 5000,
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
    ultimateCorrectStreak: 3,

    /* --- Sprint 5: modificadores caóticos del jefe MATHORO --- */
    bossSkillChance: 0.18,          // solo usado si bossSkillIntervalTurns = 0
    bossSkillStreakBonus: 0.03,
    bossSkillStreakMax: 0.15,
    bossSkillMinTurn: 2,            // no ataca antes del 2.º turno
    bossSkillIntervalTurns: 2,      // ataque garantizado cada 2 turnos
    bossExpressTimeMs: 4000,        // 4 s del Reloj de Ráfaga
    bossDoubleDamage: 300,
    bossDoublePenalty: 2,
    bossMixSwapCount: 8             // rondas de mezcla sombría
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
            result: null,

            /* --- Sprint 5: estado del jefe --- */
            activeBossSkill: null,
            lastBossSkill: null,     // ← NUEVO: para no repetir la misma habilidad seguida
            bossSkillsUsed: 0,
            turnsPlayed: 0
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

    /* =========================================================
       SPRINT 5 · Modificadores Caóticos del Jefe MATHORO
       ========================================================= */

    shouldTriggerBossSkill(random = Math.random) {
        const s = this.state;
        if (s.phase !== 'playing') return false;
        if (s.activeBossSkill) return false;
        if (s.turnsPlayed < GAME_CONFIG.bossSkillMinTurn) return false;

        if (GAME_CONFIG.bossSkillIntervalTurns > 0) {
            return s.turnsPlayed % GAME_CONFIG.bossSkillIntervalTurns === 0;
        }

        const streakBonus = Math.min(
            s.combo * GAME_CONFIG.bossSkillStreakBonus,
            GAME_CONFIG.bossSkillStreakMax
        );
        const chance = GAME_CONFIG.bossSkillChance + streakBonus;
        return safeExecute(() => random() < chance, false, 'tirada de habilidad del jefe');
    }

    /**
     * Elige una habilidad al azar evitando repetir la última usada.
     * Pool: 'rafaga', 'mezcla', 'doble' (Inversión Espejo removida).
     */
    selectBossSkill(random = Math.random) {
        const pool = ['rafaga', 'mezcla', 'doble'];
        const last = this.state.lastBossSkill;
        const available = last ? pool.filter(s => s !== last) : pool;
        const chosen = randomItem(available, random);
        return chosen || randomItem(pool, random) || 'rafaga';
    }

    /** Marca una habilidad como activa y registra la última usada. */
    startBossSkill(skillName) {
        if (!['rafaga', 'mezcla', 'doble'].includes(skillName)) {
            return { started: false, state: this.getState() };
        }
        this.state.activeBossSkill = skillName;
        this.state.lastBossSkill = skillName;   // ← evita repetición consecutiva
        this.state.bossSkillsUsed = (this.state.bossSkillsUsed || 0) + 1;
        return { started: true, skill: skillName, state: this.getState() };
    }

    /** Restaura el estado normal del turno. */
    clearBossSkill() {
        this.state.activeBossSkill = null;
        return this.getState();
    }

    resolveBossExpressTimeout() {
        const s = this.state;
        if (s.phase !== 'playing' || s.activeBossSkill !== 'rafaga') {
            return { applied: false, state: this.getState() };
        }
        s.activeBossSkill = null;

        if (s.shieldActive) {
            s.shieldActive = false;
            return { applied: true, blocked: true, state: this.getState() };
        }

        s.lives = Math.max(0, s.lives - 1);
        s.combo = 0;
        s.multiplier = 1;
        if (s.lives === 0) this.finish('defeat');
        return { applied: true, blocked: false, livesLost: 1, state: this.getState() };
    }

    resolveDobleONada(correct) {
        const s = this.state;
        if (s.phase !== 'playing' || s.activeBossSkill !== 'doble') {
            return { applied: false, state: this.getState() };
        }

        if (correct) {
            const damage = Math.min(GAME_CONFIG.bossDoubleDamage, s.enemyHp);
            s.enemyHp = Math.max(0, s.enemyHp - GAME_CONFIG.bossDoubleDamage);
            s.score += 300;
            s.combo += 1;
            s.multiplier = Math.min(1 + Math.floor(s.combo / 3), GAME_CONFIG.maxMultiplier);
            s.ultimateCharge = Math.min(
                s.ultimateCharge + 1,
                GAME_CONFIG.ultimateCorrectStreak
            );
            s.activeBossSkill = null;
            if (s.enemyHp === 0) this.finish('victory');
            return { applied: true, correct: true, damage, state: this.getState() };
        }

        s.lives = Math.max(0, s.lives - GAME_CONFIG.bossDoublePenalty);
        s.combo = 0;
        s.multiplier = 1;
        s.ultimateCharge = 0;
        s.furyArmed = false;
        s.activeBossSkill = null;
        if (s.lives === 0) this.finish('defeat');
        return { applied: true, correct: false, livesLost: GAME_CONFIG.bossDoublePenalty, state: this.getState() };
    }

    recoverGameState(fallbackQuestion = preguntaDeRespaldo) {
        const safeQuestion = validateData(fallbackQuestion, validarPregunta, preguntaDeRespaldo);
        if (!this.state) this.reset();
        this.state.phase = 'playing';
        this.state.result = null;
        this.state.activeBossSkill = null;
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