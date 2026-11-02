#!/usr/bin/env python3
"""Servidor local de MATHORO: archivos estáticos, cuentas y ranking SQLite."""

from __future__ import annotations

import argparse
import hashlib
import hmac
import json
import re
import secrets
import sqlite3
import unicodedata
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from http.cookies import SimpleCookie
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit


ROOT = Path(__file__).resolve().parent
DATA_DIR = ROOT / "data"
DATABASE = DATA_DIR / "mathoro.sqlite3"
SESSION_COOKIE = "mathoro_session"
SESSION_DAYS = 30
PBKDF2_ROUNDS = 310_000
MAX_BODY_BYTES = 8_192
TEACHER_REGISTRATION_CODE = "Todoalrojoperri123"
USERNAME_RE = re.compile(r"^[A-Za-z0-9_.-]{3,10}$")
EMAIL_RE = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]+$")


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


@contextmanager
def db_connect():
    connection = sqlite3.connect(DATABASE, timeout=10)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    connection.execute("PRAGMA busy_timeout = 10000")
    try:
        yield connection
        connection.commit()
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()


def achievement_conditions(connection: sqlite3.Connection, user_id: int) -> dict[str, bool]:
    history = connection.execute(
        """SELECT COUNT(*) AS games,
                  SUM(CASE WHEN result = 'victory' THEN 1 ELSE 0 END) AS wins,
                  MAX(points) AS best_score, SUM(points) AS total_score,
                  MAX(max_combo) AS best_combo, SUM(ultimates_used) AS total_ultimates,
                  SUM(fast_answers) AS total_fast, SUM(correct_answers) AS total_correct,
                  SUM(CASE WHEN result = 'victory' AND remaining_lives >= 20 THEN 1 ELSE 0 END) AS perfect_wins,
                  SUM(CASE WHEN result = 'victory' AND underdog_epic = 1 THEN 1 ELSE 0 END) AS epic_underdog_wins,
                  SUM(CASE WHEN result = 'victory' AND ultimate_finisher = 1 THEN 1 ELSE 0 END) AS ultimate_finisher_wins,
                  MAX(fifty_fifty_streak) AS best_fifty_streak,
                  MAX(shield_uses) AS best_shield_uses
           FROM scores WHERE user_id = ?""",
        (user_id,),
    ).fetchone()
    totals = {key: history[key] or 0 for key in history.keys()}
    best_clean_win_streak = 0
    clean_win_streak = 0
    for game in connection.execute(
        "SELECT result, remaining_lives FROM scores WHERE user_id = ? ORDER BY id",
        (user_id,),
    ):
        if game["result"] == "victory" and game["remaining_lives"] > 10:
            clean_win_streak += 1
            best_clean_win_streak = max(best_clean_win_streak, clean_win_streak)
        else:
            clean_win_streak = 0

    return {
        "primera-partida": totals["games"] >= 3,
        "campeon": best_clean_win_streak >= 3,
        "exponencial": totals["epic_underdog_wins"] >= 2,
        "fiuuu": totals["ultimate_finisher_wins"] >= 3,
        "indeciso": totals["best_fifty_streak"] >= 4,
        "lo-lograste": totals["perfect_wins"] >= 5,
        "que-defensa": totals["best_shield_uses"] >= 6,
        "campeon-ii": best_clean_win_streak >= 5,
        "puntaje-1000": totals["best_score"] >= 2000,
        "puntaje-3000": totals["best_score"] >= 4000,
        "puntaje-5000": totals["best_score"] >= 6000,
        "cinco-partidas": totals["games"] >= 10,
        "diez-partidas": totals["games"] >= 25,
        "tres-victorias": totals["wins"] >= 5,
        "diez-victorias": totals["wins"] >= 20,
        "combo-5": totals["best_combo"] >= 8,
        "combo-10": totals["best_combo"] >= 12,
        "combo-15": totals["best_combo"] >= 18,
        "primer-rayo": totals["total_ultimates"] >= 3,
        "cinco-rayos": totals["total_ultimates"] >= 10,
        "reflejos": totals["total_fast"] >= 10,
        "mente-matematica": totals["total_correct"] >= 50,
        "sin-perder-vidas": totals["perfect_wins"] >= 3,
        "acumulador": totals["total_score"] >= 30_000,
    }


def reconcile_achievements(connection: sqlite3.Connection, user_id: int) -> list[str]:
    conditions = achievement_conditions(connection, user_id)
    existing = {
        row["achievement_id"]
        for row in connection.execute(
            "SELECT achievement_id FROM achievements WHERE user_id = ?",
            (user_id,),
        )
    }
    known_ids = tuple(conditions)
    eligible = {achievement_id for achievement_id, unlocked in conditions.items() if unlocked}
    stale = existing.intersection(known_ids) - eligible
    if stale:
        placeholders = ",".join("?" for _ in stale)
        connection.execute(
            f"DELETE FROM achievements WHERE user_id = ? AND achievement_id IN ({placeholders})",
            (user_id, *stale),
        )
    newly_eligible = sorted(eligible - existing)
    unlocked_at = utc_now().isoformat()
    for achievement_id in newly_eligible:
        connection.execute(
            "INSERT OR IGNORE INTO achievements(user_id, achievement_id, unlocked_at) VALUES (?, ?, ?)",
            (user_id, achievement_id, unlocked_at),
        )
    return newly_eligible


def initialize_database() -> None:
    DATA_DIR.mkdir(exist_ok=True)
    with db_connect() as connection:
        connection.execute("PRAGMA journal_mode = WAL")
        connection.executescript(
            """
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY,
                username TEXT NOT NULL,
                username_key TEXT NOT NULL UNIQUE,
                email TEXT NOT NULL,
                email_key TEXT NOT NULL UNIQUE,
                password_salt BLOB NOT NULL,
                password_hash BLOB NOT NULL,
                created_at TEXT NOT NULL,
                role TEXT NOT NULL DEFAULT 'student'
            );
            CREATE TABLE IF NOT EXISTS sessions (
                token_hash TEXT PRIMARY KEY,
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                expires_at TEXT NOT NULL,
                created_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS sessions_expiry_idx ON sessions(expires_at);
            CREATE TABLE IF NOT EXISTS scores (
                id INTEGER PRIMARY KEY,
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                points INTEGER NOT NULL CHECK(points >= 0),
                result TEXT NOT NULL CHECK(result IN ('victory', 'defeat')),
                max_combo INTEGER NOT NULL DEFAULT 0,
                ultimates_used INTEGER NOT NULL DEFAULT 0,
                fast_answers INTEGER NOT NULL DEFAULT 0,
                correct_answers INTEGER NOT NULL DEFAULT 0,
                remaining_lives INTEGER NOT NULL DEFAULT 0,
                fifty_fifty_streak INTEGER NOT NULL DEFAULT 0,
                shield_uses INTEGER NOT NULL DEFAULT 0,
                underdog_epic INTEGER NOT NULL DEFAULT 0,
                ultimate_finisher INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS scores_user_points_idx ON scores(user_id, points DESC);
            CREATE TABLE IF NOT EXISTS achievements (
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                achievement_id TEXT NOT NULL,
                unlocked_at TEXT NOT NULL,
                PRIMARY KEY(user_id, achievement_id)
            );
            CREATE TABLE IF NOT EXISTS claimed_rewards (
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                reward_id TEXT NOT NULL,
                claimed_at TEXT NOT NULL,
                PRIMARY KEY(user_id, reward_id)
            );
            CREATE TABLE IF NOT EXISTS game_config (
                id INTEGER PRIMARY KEY CHECK(id = 1),
                access_code TEXT NOT NULL DEFAULT '',
                updated_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS game_sessions (
                session_token TEXT PRIMARY KEY,
                user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
                display_name TEXT NOT NULL,
                score INTEGER NOT NULL DEFAULT 0,
                started_at TEXT NOT NULL,
                last_seen TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS game_sessions_last_seen_idx ON game_sessions(last_seen);
            """
        )
        score_columns = {row["name"] for row in connection.execute("PRAGMA table_info(scores)")}
        for name in ("max_combo", "ultimates_used", "fast_answers", "correct_answers", "remaining_lives", "fifty_fifty_streak", "shield_uses", "underdog_epic", "ultimate_finisher"):
            if name not in score_columns:
                connection.execute(f"ALTER TABLE scores ADD COLUMN {name} INTEGER NOT NULL DEFAULT 0")
        user_columns = {row["name"] for row in connection.execute("PRAGMA table_info(users)")}
        if "role" not in user_columns:
            connection.execute("ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'student'")
        game_session_columns = {row["name"] for row in connection.execute("PRAGMA table_info(game_sessions)")}
        if "score" not in game_session_columns:
            connection.execute("ALTER TABLE game_sessions ADD COLUMN score INTEGER NOT NULL DEFAULT 0")
        connection.execute(
            "INSERT OR IGNORE INTO game_config(id, access_code, updated_at) VALUES (1, '', ?)",
            (utc_now().isoformat(),),
        )
        for row in connection.execute("SELECT id FROM users"):
            reconcile_achievements(connection, row["id"])


def normalize(value: str) -> str:
    return unicodedata.normalize("NFKC", value).strip().casefold()


def hash_password(password: str, salt: bytes | None = None) -> tuple[bytes, bytes]:
    salt = salt or secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, PBKDF2_ROUNDS)
    return salt, digest


def token_digest(token: str) -> str:
    return hashlib.sha256(token.encode("ascii")).hexdigest()


class MathoroHandler(SimpleHTTPRequestHandler):
    server_version = "MATHORO/1.0"

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def log_message(self, fmt: str, *args) -> None:
        print(f"[{self.log_date_time_string()}] {self.address_string()} {fmt % args}")

    def send_json(self, status: int, payload: dict, extra_headers: dict[str, str] | None = None) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        for name, value in (extra_headers or {}).items():
            self.send_header(name, value)
        self.end_headers()
        self.wfile.write(body)

    def read_json(self) -> dict:
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError as exc:
            raise ValueError("Tamaño de solicitud inválido.") from exc
        if length < 0 or length > MAX_BODY_BYTES:
            raise ValueError("La solicitud es demasiado grande.")
        raw = self.rfile.read(length)
        try:
            value = json.loads(raw.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise ValueError("El cuerpo debe ser JSON válido.") from exc
        if not isinstance(value, dict):
            raise ValueError("El cuerpo debe ser un objeto JSON.")
        return value

    def origin_is_same_site(self) -> bool:
        origin = self.headers.get("Origin")
        if not origin:
            return True
        parsed = urlsplit(origin)
        return parsed.scheme in ("http", "https") and parsed.netloc == self.headers.get("Host")

    def current_user(self, connection: sqlite3.Connection):
        cookies = SimpleCookie()
        try:
            cookies.load(self.headers.get("Cookie", ""))
            morsel = cookies.get(SESSION_COOKIE)
            if not morsel:
                return None
            now = utc_now().isoformat()
            return connection.execute(
                """SELECT users.id, users.username, users.username_key, users.role
                   FROM sessions JOIN users ON users.id = sessions.user_id
                   WHERE sessions.token_hash = ? AND sessions.expires_at > ?""",
                (token_digest(morsel.value), now),
            ).fetchone()
        except (KeyError, ValueError):
            return None

    def create_session(self, connection: sqlite3.Connection, user_id: int) -> str:
        connection.execute("DELETE FROM sessions WHERE expires_at <= ?", (utc_now().isoformat(),))
        token = secrets.token_urlsafe(32)
        now = utc_now()
        expires = now + timedelta(days=SESSION_DAYS)
        connection.execute(
            "INSERT INTO sessions(token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)",
            (token_digest(token), user_id, expires.isoformat(), now.isoformat()),
        )
        secure = "; Secure" if self.headers.get("X-Forwarded-Proto") == "https" else ""
        return f"{SESSION_COOKIE}={token}; Path=/; HttpOnly; SameSite=Lax; Max-Age={SESSION_DAYS * 86400}{secure}"

    def do_GET(self) -> None:
        path = urlsplit(self.path).path
        if path.startswith("/api/"):
            self.handle_api_get(path)
            return
        if path == "/server.py" or path.startswith("/data/"):
            self.send_error(404)
            return
        super().do_GET()

    def do_POST(self) -> None:
        path = urlsplit(self.path).path
        if not path.startswith("/api/"):
            self.send_error(404)
            return
        if not self.origin_is_same_site():
            self.send_json(403, {"error": "Solicitud de otro origen rechazada."})
            return
        try:
            data = self.read_json()
        except ValueError as exc:
            self.send_json(400, {"error": str(exc)})
            return
        try:
            if path == "/api/register":
                self.register(data)
            elif path == "/api/login":
                self.login(data)
            elif path == "/api/account":
                self.update_account(data)
            elif path == "/api/logout":
                self.logout()
            elif path == "/api/scores":
                self.add_score(data)
            elif path == "/api/rewards/claim":
                self.claim_reward(data)
            elif path == "/api/teacher":
                self.save_teacher_config(data)
            elif path == "/api/game/join":
                self.join_game(data)
            elif path == "/api/game/presence":
                self.update_game_presence(data)
            else:
                self.send_json(404, {"error": "Ruta API no encontrada."})
        except sqlite3.IntegrityError:
            self.send_json(409, {"error": "Ese nombre de usuario o correo ya está registrado."})
        except sqlite3.Error:
            self.send_json(500, {"error": "No se pudo acceder a la base de datos."})

    def handle_api_get(self, path: str) -> None:
        try:
            with db_connect() as connection:
                if path == "/api/me":
                    user = self.current_user(connection)
                    if not user:
                        self.send_json(401, {"authenticated": False})
                        return
                    self.send_json(200, {"authenticated": True, "user": {"id": user["id"], "username": user["username"], "role": user["role"]}})
                    return
                if path == "/api/account":
                    user = self.current_user(connection)
                    if not user:
                        self.send_json(401, {"error": "Inicia sesión para consultar tu cuenta."})
                        return
                    profile = connection.execute(
                        "SELECT username, email, role FROM users WHERE id = ?",
                        (user["id"],),
                    ).fetchone()
                    self.send_json(200, {"user": {"username": profile["username"], "email": profile["email"], "role": profile["role"]}})
                    return
                if path == "/api/teacher":
                    user = self.current_user(connection)
                    if not user:
                        self.send_json(401, {"error": "Inicia sesión como profesor para ver el panel."})
                        return
                    role = connection.execute("SELECT role FROM users WHERE id = ?", (user["id"],)).fetchone()["role"]
                    if role != "teacher":
                        self.send_json(403, {"error": "Esta sección es solo para profesores."})
                        return
                    config = connection.execute("SELECT access_code FROM game_config WHERE id = 1").fetchone()
                    active_after = (utc_now() - timedelta(seconds=90)).isoformat()
                    players = connection.execute(
                        "SELECT display_name, score, started_at, last_seen FROM game_sessions WHERE last_seen >= ? ORDER BY score DESC, started_at ASC",
                        (active_after,),
                    ).fetchall()
                    self.send_json(200, {"accessCode": config["access_code"], "players": [dict(row) for row in players]})
                    return
                if path == "/api/leaderboard":
                    rows = connection.execute(
                        """SELECT users.username, MAX(scores.points) AS score,
                                  COUNT(scores.id) AS games, MAX(scores.created_at) AS achieved_at,
                                  GROUP_CONCAT(DISTINCT achievements.achievement_id) AS achievement_ids
                           FROM users JOIN scores ON scores.user_id = users.id
                           LEFT JOIN achievements ON achievements.user_id = users.id
                           GROUP BY users.id
                           ORDER BY score DESC, achieved_at ASC, users.username_key ASC"""
                    ).fetchall()
                    self.send_json(200, {"scores": [{**dict(row), "achievements": (row["achievement_ids"] or "").split(",") if row["achievement_ids"] else []} for row in rows]})
                    return
                if path == "/api/achievements":
                    user = self.current_user(connection)
                    if not user:
                        self.send_json(401, {"error": "Inicia sesión para ver tus logros."})
                        return
                    rows = connection.execute(
                        "SELECT achievement_id, unlocked_at FROM achievements WHERE user_id = ? ORDER BY unlocked_at",
                        (user["id"],),
                    ).fetchall()
                    self.send_json(200, {"achievements": [dict(row) for row in rows]})
                    return
                if path == "/api/rewards":
                    user = self.current_user(connection)
                    if not user:
                        self.send_json(401, {"error": "Inicia sesión para ver tus recompensas."})
                        return
                    reward_rows = connection.execute(
                        """SELECT rewards.reward_id, rewards.achievement_id,
                                  achievements.unlocked_at, claimed_rewards.claimed_at
                           FROM (SELECT 'insignia-campeon' AS reward_id, 'campeon' AS achievement_id
                                 UNION ALL SELECT 'aura-bronce', 'puntaje-3000'
                                 UNION ALL SELECT 'titulo-leyenda', 'diez-victorias'
                                 UNION ALL SELECT 'marco-maestro', 'mente-matematica') AS rewards
                           LEFT JOIN achievements ON achievements.user_id = ?
                             AND achievements.achievement_id = rewards.achievement_id
                           LEFT JOIN claimed_rewards ON claimed_rewards.user_id = ?
                             AND claimed_rewards.reward_id = rewards.reward_id
                           ORDER BY CASE rewards.reward_id
                             WHEN 'insignia-campeon' THEN 1 WHEN 'aura-bronce' THEN 2
                             WHEN 'titulo-leyenda' THEN 3 ELSE 4 END""",
                        (user["id"], user["id"]),
                    ).fetchall()
                    self.send_json(200, {"rewards": [
                        {"id": row["reward_id"], "achievementId": row["achievement_id"],
                         "unlocked": row["unlocked_at"] is not None,
                         "unlockedAt": row["unlocked_at"], "claimed": row["claimed_at"] is not None,
                         "claimedAt": row["claimed_at"]}
                        for row in reward_rows
                    ]})
                    return
        except sqlite3.Error:
            self.send_json(500, {"error": "No se pudo leer la base de datos. Reinicia el servidor MATHORO."})
            return
        self.send_json(404, {"error": "Ruta API no encontrada."})

    def register(self, data: dict) -> None:
        username = unicodedata.normalize("NFKC", str(data.get("username", ""))).strip()
        email = unicodedata.normalize("NFKC", str(data.get("email", ""))).strip()
        password = str(data.get("password", ""))
        teacher_code = str(data.get("teacherCode", ""))
        role = "teacher" if hmac.compare_digest(teacher_code, TEACHER_REGISTRATION_CODE) else "student"
        if not USERNAME_RE.fullmatch(username):
            self.send_json(400, {"error": "El usuario debe tener 3 a 10 caracteres: letras, números, punto, guion o guion bajo."})
            return
        if not EMAIL_RE.fullmatch(email) or len(email) > 254:
            self.send_json(400, {"error": "Escribe un correo electrónico válido."})
            return
        if len(password) < 8 or len(password) > 200:
            self.send_json(400, {"error": "La contraseña debe tener entre 8 y 200 caracteres."})
            return
        salt, password_hash = hash_password(password)
        now = utc_now().isoformat()
        with db_connect() as connection:
            cursor = connection.execute(
                """INSERT INTO users(username, username_key, email, email_key, password_salt, password_hash, created_at, role)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
                (username, normalize(username), email, normalize(email), salt, password_hash, now, role),
            )
            user_id = cursor.lastrowid
            cookie = self.create_session(connection, user_id)
        self.send_json(201, {"ok": True, "user": {"id": user_id, "username": username, "role": role}}, {"Set-Cookie": cookie})

    def login(self, data: dict) -> None:
        identifier = unicodedata.normalize("NFKC", str(data.get("identifier", ""))).strip()
        password = str(data.get("password", ""))
        with db_connect() as connection:
            user = connection.execute(
                "SELECT id, username, role, password_salt, password_hash FROM users WHERE username_key = ? OR email_key = ?",
                (normalize(identifier), normalize(identifier)),
            ).fetchone()
            if user:
                _, attempted_hash = hash_password(password, user["password_salt"])
                valid = hmac.compare_digest(attempted_hash, user["password_hash"])
            else:
                hash_password(password or "invalid-password", b"mathoro-dummy-salt")
                valid = False
            if not valid:
                self.send_json(401, {"error": "Usuario/correo o contraseña incorrectos."})
                return
            cookie = self.create_session(connection, user["id"])
        self.send_json(200, {"ok": True, "user": {"id": user["id"], "username": user["username"], "role": user["role"]}}, {"Set-Cookie": cookie})

    def update_account(self, data: dict) -> None:
        current_password = str(data.get("currentPassword", ""))
        username = unicodedata.normalize("NFKC", str(data.get("username", ""))).strip()
        email = unicodedata.normalize("NFKC", str(data.get("email", ""))).strip()
        new_password = str(data.get("newPassword", ""))
        if not current_password:
            self.send_json(400, {"error": "Escribe tu contraseña actual para confirmar los cambios."})
            return
        if not USERNAME_RE.fullmatch(username):
            self.send_json(400, {"error": "El usuario debe tener 3 a 10 caracteres: letras, números, punto, guion o guion bajo."})
            return
        if not EMAIL_RE.fullmatch(email) or len(email) > 254:
            self.send_json(400, {"error": "Escribe un correo electrónico válido."})
            return
        if new_password and (len(new_password) < 8 or len(new_password) > 200):
            self.send_json(400, {"error": "La nueva contraseña debe tener entre 8 y 200 caracteres."})
            return
        with db_connect() as connection:
            user = self.current_user(connection)
            if not user:
                self.send_json(401, {"error": "Tu sesión venció. Inicia sesión de nuevo."})
                return
            credentials = connection.execute(
                "SELECT password_salt, password_hash FROM users WHERE id = ?",
                (user["id"],),
            ).fetchone()
            _, attempted_hash = hash_password(current_password, credentials["password_salt"])
            if not hmac.compare_digest(attempted_hash, credentials["password_hash"]):
                self.send_json(401, {"error": "La contraseña actual no es correcta."})
                return
            if new_password:
                salt, password_hash = hash_password(new_password)
                connection.execute(
                    """UPDATE users SET username = ?, username_key = ?, email = ?, email_key = ?,
                              password_salt = ?, password_hash = ? WHERE id = ?""",
                    (username, normalize(username), email, normalize(email), salt, password_hash, user["id"]),
                )
            else:
                connection.execute(
                    "UPDATE users SET username = ?, username_key = ?, email = ?, email_key = ? WHERE id = ?",
                    (username, normalize(username), email, normalize(email), user["id"]),
                )
        self.send_json(200, {"ok": True, "user": {"username": username, "email": email}})

    def save_teacher_config(self, data: dict) -> None:
        access_code = str(data.get("accessCode", "")).strip()
        if len(access_code) > 64 or any(ord(char) < 32 for char in access_code):
            self.send_json(400, {"error": "El código puede tener hasta 64 caracteres."})
            return
        with db_connect() as connection:
            user = self.current_user(connection)
            if not user or user["role"] != "teacher":
                self.send_json(403, {"error": "Solo un profesor puede cambiar el código de partida."})
                return
            connection.execute(
                "UPDATE game_config SET access_code = ?, updated_at = ? WHERE id = 1",
                (access_code, utc_now().isoformat()),
            )
        self.send_json(200, {"ok": True, "accessCode": access_code})

    def join_game(self, data: dict) -> None:
        display_name = " ".join(str(data.get("displayName", "")).split())
        entered_code = str(data.get("code", "")).strip()
        if not display_name or len(display_name) > 40:
            self.send_json(400, {"error": "Escribe un nombre de hasta 40 caracteres."})
            return
        if not entered_code or len(entered_code) > 64:
            self.send_json(400, {"error": "Escribe el código de partida."})
            return
        with db_connect() as connection:
            config = connection.execute("SELECT access_code FROM game_config WHERE id = 1").fetchone()
            required_code = config["access_code"] if config else ""
            if not required_code:
                self.send_json(403, {"error": "El profesor todavía no activó un código de partida."})
                return
            if not hmac.compare_digest(entered_code, required_code):
                self.send_json(403, {"error": "El código de partida no es correcto."})
                return
            user = self.current_user(connection)
            token = secrets.token_urlsafe(32)
            now = utc_now().isoformat()
            connection.execute(
                "INSERT INTO game_sessions(session_token, user_id, display_name, started_at, last_seen) VALUES (?, ?, ?, ?, ?)",
                (token, user["id"] if user else None, display_name, now, now),
            )
        self.send_json(201, {"ok": True, "sessionToken": token})

    def update_game_presence(self, data: dict) -> None:
        token = str(data.get("sessionToken", ""))
        action = str(data.get("action", "heartbeat"))
        if not token or action not in ("heartbeat", "leave"):
            self.send_json(400, {"error": "La sesión de partida no es válida."})
            return
        with db_connect() as connection:
            if action == "leave":
                connection.execute("DELETE FROM game_sessions WHERE session_token = ?", (token,))
            else:
                try:
                    score = max(0, min(10_000_000, int(data.get("score", 0))))
                except (TypeError, ValueError):
                    score = 0
                result = connection.execute(
                    "UPDATE game_sessions SET last_seen = ?, score = ? WHERE session_token = ?",
                    (utc_now().isoformat(), score, token),
                )
                if result.rowcount == 0:
                    self.send_json(404, {"error": "La sesión de partida ya venció."})
                    return
        self.send_json(200, {"ok": True})

    def logout(self) -> None:
        with db_connect() as connection:
            user = self.current_user(connection)
            cookies = SimpleCookie()
            cookies.load(self.headers.get("Cookie", ""))
            morsel = cookies.get(SESSION_COOKIE)
            if morsel:
                connection.execute("DELETE FROM sessions WHERE token_hash = ?", (token_digest(morsel.value),))
        self.send_json(200, {"ok": True}, {"Set-Cookie": f"{SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0"})

    def add_score(self, data: dict) -> None:
        try:
            points = int(data.get("points"))
        except (TypeError, ValueError):
            self.send_json(400, {"error": "Puntaje inválido."})
            return
        result = str(data.get("result", ""))
        if points < 0 or points > 10_000_000 or result not in ("victory", "defeat"):
            self.send_json(400, {"error": "El resultado de la partida no es válido."})
            return
        raw_stats = data.get("stats", {})
        if not isinstance(raw_stats, dict):
            raw_stats = {}
        stats = {}
        for key in ("maxCombo", "ultimatesUsed", "fastAnswers", "correctAnswers", "remainingLives", "fiftyFiftyStreak", "shieldUses", "underdogEpic", "ultimateFinisher"):
            try:
                stats[key] = max(0, min(10_000, int(raw_stats.get(key, 0))))
            except (TypeError, ValueError):
                stats[key] = 0
        stats["remainingLives"] = min(20, stats["remainingLives"])
        for key in ("underdogEpic", "ultimateFinisher"):
            stats[key] = int(bool(stats[key]))
        with db_connect() as connection:
            user = self.current_user(connection)
            if not user:
                self.send_json(401, {"error": "Inicia sesión para guardar tu puntaje."})
                return
            cursor = connection.execute(
                """INSERT INTO scores(user_id, points, result, max_combo, ultimates_used,
                          fast_answers, correct_answers, remaining_lives, fifty_fifty_streak,
                          shield_uses, underdog_epic, ultimate_finisher, created_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (user["id"], points, result, stats["maxCombo"], stats["ultimatesUsed"],
                 stats["fastAnswers"], stats["correctAnswers"], stats["remainingLives"], stats["fiftyFiftyStreak"],
                 stats["shieldUses"], stats["underdogEpic"], stats["ultimateFinisher"], utc_now().isoformat()),
            )
            nuevos = reconcile_achievements(connection, user["id"])
        self.send_json(201, {"ok": True, "scoreId": cursor.lastrowid, "newAchievements": nuevos})

    def claim_reward(self, data: dict) -> None:
        reward_requirements = {
            "insignia-campeon": "campeon",
            "aura-bronce": "puntaje-3000",
            "titulo-leyenda": "diez-victorias",
            "marco-maestro": "mente-matematica",
        }
        reward_id = str(data.get("rewardId", ""))
        achievement_id = reward_requirements.get(reward_id)
        if not achievement_id:
            self.send_json(400, {"error": "La recompensa no existe."})
            return
        with db_connect() as connection:
            user = self.current_user(connection)
            if not user:
                self.send_json(401, {"error": "Inicia sesión para reclamar recompensas."})
                return
            unlocked = connection.execute(
                "SELECT 1 FROM achievements WHERE user_id = ? AND achievement_id = ?",
                (user["id"], achievement_id),
            ).fetchone()
            if not unlocked:
                self.send_json(403, {"error": "Desbloquea el logro requerido para reclamar esta recompensa."})
                return
            cursor = connection.execute(
                "INSERT OR IGNORE INTO claimed_rewards(user_id, reward_id, claimed_at) VALUES (?, ?, ?)",
                (user["id"], reward_id, utc_now().isoformat()),
            )
        self.send_json(200, {"ok": True, "alreadyClaimed": not bool(cursor.rowcount)})


def main() -> None:
    parser = argparse.ArgumentParser(description="Servidor local de MATHORO")
    parser.add_argument("--host", default="127.0.0.1", help="Dirección de escucha (por defecto: 127.0.0.1)")
    parser.add_argument("--port", type=int, default=8000, help="Puerto HTTP (por defecto: 8000)")
    args = parser.parse_args()
    initialize_database()
    server = ThreadingHTTPServer((args.host, args.port), MathoroHandler)
    print(f"MATHORO está disponible en http://localhost:{args.port}/index.html")
    print(f"Base de datos local: {DATABASE}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nCerrando MATHORO...")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
