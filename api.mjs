import { createHash, randomBytes, timingSafeEqual, pbkdf2 as pbkdf2Callback } from 'node:crypto';
import { promisify } from 'node:util';
import { neon } from '@neondatabase/serverless';

const pbkdf2 = promisify(pbkdf2Callback);
const COOKIE = 'mathoro_session';
const SESSION_DAYS = 30;
const PBKDF2_ROUNDS = 310_000;
const USERNAME_RE = /^[A-Za-z0-9_.-]{3,24}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const REWARDS = {
  'insignia-campeon': 'campeon',
  'aura-bronce': 'puntaje-3000',
  'titulo-leyenda': 'diez-victorias',
  'marco-maestro': 'mente-matematica',
};

export const config = { path: '/api/*' };

function json(statusCode, body, headers = {}) {
  return new Response(JSON.stringify(body), {
    status: statusCode,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...headers },
  });
}

function normalize(value) {
  return String(value ?? '').normalize('NFKC').trim().toLocaleLowerCase('und');
}

function digest(value) {
  return createHash('sha256').update(value, 'ascii').digest('hex');
}

function cookieValue(header = '') {
  const entry = header.split(';').map((part) => part.trim()).find((part) => part.startsWith(`${COOKIE}=`));
  return entry ? decodeURIComponent(entry.slice(COOKIE.length + 1)) : '';
}

function setCookie(token, maxAge = SESSION_DAYS * 86400) {
  return `${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}

async function parseBody(request) {
  const body = await request.text();
  if (!body || body.length > 12_000) throw Object.assign(new Error('El cuerpo de la solicitud no es válido.'), { status: 400 });
  let data;
  try { data = JSON.parse(body); }
  catch { throw Object.assign(new Error('El cuerpo debe ser JSON válido.'), { status: 400 }); }
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw Object.assign(new Error('El cuerpo debe ser un objeto JSON.'), { status: 400 });
  return data;
}

async function passwordRecord(password, salt = randomBytes(16)) {
  const key = await pbkdf2(password, salt, PBKDF2_ROUNDS, 32, 'sha256');
  return { salt: salt.toString('hex'), hash: key.toString('hex') };
}

async function currentUser(sql, request) {
  const token = cookieValue(request.headers.get('cookie') || '');
  if (!token) return null;
  const rows = await sql`SELECT users.id, users.username, users.username_key
    FROM sessions JOIN users ON users.id = sessions.user_id
    WHERE sessions.token_hash = ${digest(token)} AND sessions.expires_at > NOW() LIMIT 1`;
  return rows[0] || null;
}

async function createSession(sql, userId) {
  const token = randomBytes(32).toString('base64url');
  await sql`DELETE FROM sessions WHERE expires_at <= NOW()`;
  await sql`INSERT INTO sessions (token_hash, user_id, expires_at)
    VALUES (${digest(token)}, ${userId}, NOW() + (${SESSION_DAYS} * INTERVAL '1 day'))`;
  return setCookie(token);
}

function cappedStat(stats, key, max = 10_000) {
  const value = Number.parseInt(stats?.[key], 10);
  return Number.isFinite(value) ? Math.max(0, Math.min(max, value)) : 0;
}

async function handle(request, sql) {
  const method = request.method;
  const path = new URL(request.url).pathname;

  if (method === 'GET' && path === '/api/me') {
    const user = await currentUser(sql, request);
    return user
      ? json(200, { authenticated: true, user: { id: Number(user.id), username: user.username } })
      : json(401, { authenticated: false });
  }

  if (method === 'GET' && path === '/api/leaderboard') {
    const scores = await sql`SELECT users.username, MAX(scores.points)::int AS score,
      COUNT(scores.id)::int AS games, MAX(scores.created_at) AS achieved_at
      FROM users JOIN scores ON scores.user_id = users.id
      GROUP BY users.id ORDER BY score DESC, achieved_at ASC, users.username_key ASC`;
    return json(200, { scores: scores.map((row) => ({ ...row, games: Number(row.games), score: Number(row.score) })) });
  }

  if (method === 'GET' && path === '/api/achievements') {
    const user = await currentUser(sql, request);
    if (!user) return json(401, { error: 'Inicia sesión para ver tus logros.' });
    const achievements = await sql`SELECT achievement_id, unlocked_at FROM achievements WHERE user_id = ${user.id} ORDER BY unlocked_at`;
    return json(200, { achievements });
  }

  if (method === 'GET' && path === '/api/rewards') {
    const user = await currentUser(sql, request);
    if (!user) return json(401, { error: 'Inicia sesión para ver tus recompensas.' });
    const rows = await sql`SELECT rewards.reward_id, rewards.achievement_id,
      achievements.unlocked_at, claimed_rewards.claimed_at
      FROM (VALUES ('insignia-campeon','campeon'), ('aura-bronce','puntaje-3000'),
        ('titulo-leyenda','diez-victorias'), ('marco-maestro','mente-matematica')) AS rewards(reward_id, achievement_id)
      LEFT JOIN achievements ON achievements.user_id = ${user.id} AND achievements.achievement_id = rewards.achievement_id
      LEFT JOIN claimed_rewards ON claimed_rewards.user_id = ${user.id} AND claimed_rewards.reward_id = rewards.reward_id
      ORDER BY CASE rewards.reward_id WHEN 'insignia-campeon' THEN 1 WHEN 'aura-bronce' THEN 2 WHEN 'titulo-leyenda' THEN 3 ELSE 4 END`;
    return json(200, { rewards: rows.map((row) => ({ id: row.reward_id, achievementId: row.achievement_id,
      unlocked: Boolean(row.unlocked_at), unlockedAt: row.unlocked_at,
      claimed: Boolean(row.claimed_at), claimedAt: row.claimed_at })) });
  }

  if (method !== 'POST') return json(404, { error: 'Ruta API no encontrada.' });
  const origin = request.headers.get('origin');
  if (origin && new URL(origin).origin !== new URL(request.url).origin) return json(403, { error: 'Solicitud de otro origen rechazada.' });
  const data = await parseBody(request);

  if (path === '/api/register') {
    const username = String(data.username ?? '').normalize('NFKC').trim();
    const email = String(data.email ?? '').normalize('NFKC').trim();
    const password = String(data.password ?? '');
    if (!USERNAME_RE.test(username)) return json(400, { error: 'El usuario debe tener 3 a 24 caracteres: letras, números, punto, guion o guion bajo.' });
    if (!EMAIL_RE.test(email) || email.length > 254) return json(400, { error: 'Escribe un correo electrónico válido.' });
    if (password.length < 8 || password.length > 200) return json(400, { error: 'La contraseña debe tener entre 8 y 200 caracteres.' });
    const record = await passwordRecord(password);
    const rows = await sql`INSERT INTO users (username, username_key, email, email_key, password_salt, password_hash)
      VALUES (${username}, ${normalize(username)}, ${email}, ${normalize(email)}, ${record.salt}, ${record.hash}) RETURNING id, username`;
    const user = rows[0];
    return json(201, { ok: true, user: { id: Number(user.id), username: user.username } }, { 'Set-Cookie': await createSession(sql, user.id) });
  }

  if (path === '/api/login') {
    const identifier = String(data.identifier ?? '').normalize('NFKC').trim();
    const password = String(data.password ?? '');
    const rows = await sql`SELECT id, username, password_salt, password_hash FROM users WHERE username_key = ${normalize(identifier)} OR email_key = ${normalize(identifier)} LIMIT 1`;
    const user = rows[0];
    if (!user) {
      await passwordRecord(password || 'invalid-password', Buffer.from('mathoro-dummy-salt'));
      return json(401, { error: 'Usuario/correo o contraseña incorrectos.' });
    }
    const actual = await passwordRecord(password, Buffer.from(user.password_salt, 'hex'));
    const expectedBuffer = Buffer.from(user.password_hash, 'hex');
    const actualBuffer = Buffer.from(actual.hash, 'hex');
    if (expectedBuffer.length !== actualBuffer.length || !timingSafeEqual(expectedBuffer, actualBuffer)) return json(401, { error: 'Usuario/correo o contraseña incorrectos.' });
    return json(200, { ok: true, user: { id: Number(user.id), username: user.username } }, { 'Set-Cookie': await createSession(sql, user.id) });
  }

  if (path === '/api/logout') {
    const token = cookieValue(request.headers.get('cookie') || '');
    if (token) await sql`DELETE FROM sessions WHERE token_hash = ${digest(token)}`;
    return json(200, { ok: true }, { 'Set-Cookie': setCookie('', 0) });
  }

  if (path === '/api/scores') {
    const user = await currentUser(sql, request);
    if (!user) return json(401, { error: 'Inicia sesión para guardar tu puntaje.' });
    const points = Number(data.points);
    const result = String(data.result || '');
    if (data.points == null || data.points === '' || !Number.isInteger(points) || points < 0 || points > 10_000_000 || !['victory', 'defeat'].includes(result)) return json(400, { error: 'El resultado de la partida no es válido.' });
    const stats = data.stats && typeof data.stats === 'object' ? data.stats : {};
    const maxCombo = cappedStat(stats, 'maxCombo');
    const ultimatesUsed = cappedStat(stats, 'ultimatesUsed');
    const fastAnswers = cappedStat(stats, 'fastAnswers');
    const correctAnswers = cappedStat(stats, 'correctAnswers');
    const remainingLives = cappedStat(stats, 'remainingLives', 20);
    const inserted = await sql`INSERT INTO scores (user_id, points, result, max_combo, ultimates_used, fast_answers, correct_answers, remaining_lives)
      VALUES (${user.id}, ${points}, ${result}, ${maxCombo}, ${ultimatesUsed}, ${fastAnswers}, ${correctAnswers}, ${remainingLives}) RETURNING id`;
    const rows = await sql`SELECT COUNT(*)::int AS games, COUNT(*) FILTER (WHERE result = 'victory')::int AS wins,
      MAX(points)::int AS best_score, SUM(points)::bigint AS total_score, MAX(max_combo)::int AS best_combo,
      SUM(ultimates_used)::int AS total_ultimates, SUM(fast_answers)::int AS total_fast,
      SUM(correct_answers)::int AS total_correct,
      COUNT(*) FILTER (WHERE result = 'victory' AND remaining_lives >= 18)::int AS perfect_wins
      FROM scores WHERE user_id = ${user.id}`;
    const h = rows[0];
    const conditions = {
      'primera-partida': Number(h.games) >= 1, campeon: Number(h.wins) >= 1,
      'puntaje-1000': Number(h.best_score) >= 1000, 'puntaje-3000': Number(h.best_score) >= 3000,
      'puntaje-5000': Number(h.best_score) >= 5000, 'cinco-partidas': Number(h.games) >= 5,
      'diez-partidas': Number(h.games) >= 10, 'tres-victorias': Number(h.wins) >= 3,
      'diez-victorias': Number(h.wins) >= 10, 'combo-5': Number(h.best_combo) >= 5,
      'combo-10': Number(h.best_combo) >= 10, 'combo-15': Number(h.best_combo) >= 15,
      'primer-rayo': Number(h.total_ultimates) >= 1, 'cinco-rayos': Number(h.total_ultimates) >= 5,
      reflejos: Number(h.total_fast) >= 1, 'mente-matematica': Number(h.total_correct) >= 25,
      'sin-perder-vidas': Number(h.perfect_wins) >= 1, acumulador: Number(h.total_score) >= 10_000,
    };
    const newAchievements = [];
    for (const [id, unlocked] of Object.entries(conditions)) {
      if (!unlocked) continue;
      const added = await sql`INSERT INTO achievements (user_id, achievement_id) VALUES (${user.id}, ${id}) ON CONFLICT DO NOTHING RETURNING achievement_id`;
      if (added.length) newAchievements.push(id);
    }
    return json(201, { ok: true, scoreId: Number(inserted[0].id), newAchievements });
  }

  if (path === '/api/rewards/claim') {
    const user = await currentUser(sql, request);
    if (!user) return json(401, { error: 'Inicia sesión para reclamar recompensas.' });
    const rewardId = String(data.rewardId || '');
    const achievementId = REWARDS[rewardId];
    if (!achievementId) return json(400, { error: 'La recompensa no existe.' });
    const unlocked = await sql`SELECT 1 FROM achievements WHERE user_id = ${user.id} AND achievement_id = ${achievementId}`;
    if (!unlocked.length) return json(403, { error: 'Desbloquea el logro requerido para reclamar esta recompensa.' });
    const claimed = await sql`INSERT INTO claimed_rewards (user_id, reward_id) VALUES (${user.id}, ${rewardId}) ON CONFLICT DO NOTHING RETURNING reward_id`;
    return json(200, { ok: true, alreadyClaimed: !claimed.length });
  }

  return json(404, { error: 'Ruta API no encontrada.' });
}

export default async (request) => {
  if (!process.env.DATABASE_URL) return json(503, { error: 'Base de datos sin configurar. En Netlify agrega la variable de entorno DATABASE_URL y vuelve a publicar el sitio.' });
  try {
    const sql = neon(process.env.DATABASE_URL);
    return await handle(request, sql);
  } catch (error) {
    if (error?.status) return json(error.status, { error: error.message });
    if (error?.code === '23505') return json(409, { error: 'Ese nombre de usuario o correo ya está registrado.' });
    console.error('MATHORO API error:', error);
    return json(500, { error: 'No se pudo acceder a la base de datos. Revisa DATABASE_URL, ejecuta netlify/schema.sql y consulta los logs de funciones.' });
  }
};
