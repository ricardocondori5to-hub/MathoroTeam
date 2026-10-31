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
USERNAME_RE = re.compile(r"^[A-Za-z0-9_.-]{3,24}$")
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
                created_at TEXT NOT NULL
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
            """
        )
        score_columns = {row["name"] for row in connection.execute("PRAGMA table_info(scores)")}
        for name in ("max_combo", "ultimates_used", "fast_answers", "correct_answers", "remaining_lives"):
            if name not in score_columns:
                connection.execute(f"ALTER TABLE scores ADD COLUMN {name} INTEGER NOT NULL DEFAULT 0")


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
                """SELECT users.id, users.username, users.username_key
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
            elif path == "/api/logout":
                self.logout()
            elif path == "/api/scores":
                self.add_score(data)
            elif path == "/api/rewards/claim":
                self.claim_reward(data)
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
                    self.send_json(200, {"authenticated": True, "user": {"id": user["id"], "username": user["username"]}})
                    return
                if path == "/api/leaderboard":
                    rows = connection.execute(
                        """SELECT users.username, MAX(scores.points) AS score,
                                  COUNT(scores.id) AS games, MAX(scores.created_at) AS achieved_at
                           FROM users JOIN scores ON scores.user_id = users.id
                           GROUP BY users.id
                           ORDER BY score DESC, achieved_at ASC, users.username_key ASC"""
                    ).fetchall()
                    self.send_json(200, {"scores": [dict(row) for row in rows]})
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
        if not USERNAME_RE.fullmatch(username):
            self.send_json(400, {"error": "El usuario debe tener 3 a 24 caracteres: letras, números, punto, guion o guion bajo."})
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
                """INSERT INTO users(username, username_key, email, email_key, password_salt, password_hash, created_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?)""",
                (username, normalize(username), email, normalize(email), salt, password_hash, now),
            )
            user_id = cursor.lastrowid
            cookie = self.create_session(connection, user_id)
        self.send_json(201, {"ok": True, "user": {"id": user_id, "username": username}}, {"Set-Cookie": cookie})

    def login(self, data: dict) -> None:
        identifier = unicodedata.normalize("NFKC", str(data.get("identifier", ""))).strip()
        password = str(data.get("password", ""))
        with db_connect() as connection:
            user = connection.execute(
                "SELECT id, username, password_salt, password_hash FROM users WHERE username_key = ? OR email_key = ?",
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
        self.send_json(200, {"ok": True, "user": {"id": user["id"], "username": user["username"]}}, {"Set-Cookie": cookie})

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
        for key in ("maxCombo", "ultimatesUsed", "fastAnswers", "correctAnswers", "remainingLives"):
            try:
                stats[key] = max(0, min(10_000, int(raw_stats.get(key, 0))))
            except (TypeError, ValueError):
                stats[key] = 0
        stats["remainingLives"] = min(20, stats["remainingLives"])
        with db_connect() as connection:
            user = self.current_user(connection)
            if not user:
                self.send_json(401, {"error": "Inicia sesión para guardar tu puntaje."})
                return
            cursor = connection.execute(
                """INSERT INTO scores(user_id, points, result, max_combo, ultimates_used,
                          fast_answers, correct_answers, remaining_lives, created_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (user["id"], points, result, stats["maxCombo"], stats["ultimatesUsed"],
                 stats["fastAnswers"], stats["correctAnswers"], stats["remainingLives"], utc_now().isoformat()),
            )
            history = connection.execute(
                """SELECT COUNT(*) AS games,
                          SUM(CASE WHEN result = 'victory' THEN 1 ELSE 0 END) AS wins,
                          MAX(points) AS best_score, SUM(points) AS total_score,
                          MAX(max_combo) AS best_combo, SUM(ultimates_used) AS total_ultimates,
                          SUM(fast_answers) AS total_fast, SUM(correct_answers) AS total_correct,
                          SUM(CASE WHEN result = 'victory' AND remaining_lives >= 18 THEN 1 ELSE 0 END) AS perfect_wins
                   FROM scores WHERE user_id = ?""",
                (user["id"],),
            ).fetchone()
            conditions = {
                "primera-partida": history["games"] >= 1,
                "campeon": history["wins"] >= 1,
                "puntaje-1000": history["best_score"] >= 1000,
                "puntaje-3000": history["best_score"] >= 3000,
                "puntaje-5000": history["best_score"] >= 5000,
                "cinco-partidas": history["games"] >= 5,
                "diez-partidas": history["games"] >= 10,
                "tres-victorias": history["wins"] >= 3,
                "diez-victorias": history["wins"] >= 10,
                "combo-5": history["best_combo"] >= 5,
                "combo-10": history["best_combo"] >= 10,
                "combo-15": history["best_combo"] >= 15,
                "primer-rayo": history["total_ultimates"] >= 1,
                "cinco-rayos": history["total_ultimates"] >= 5,
                "reflejos": history["total_fast"] >= 1,
                "mente-matematica": history["total_correct"] >= 25,
                "sin-perder-vidas": history["perfect_wins"] >= 1,
                "acumulador": history["total_score"] >= 10_000,
            }
            nuevos = []
            unlocked_at = utc_now().isoformat()
            for achievement_id, unlocked in conditions.items():
                if unlocked:
                    result_insert = connection.execute(
                        "INSERT OR IGNORE INTO achievements(user_id, achievement_id, unlocked_at) VALUES (?, ?, ?)",
                        (user["id"], achievement_id, unlocked_at),
                    )
                    if result_insert.rowcount:
                        nuevos.append(achievement_id)
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
