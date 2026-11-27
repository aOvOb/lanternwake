#!/usr/bin/env python3
"""Lanternwake 계정 서버. 파이썬 표준 라이브러리와 SQLite만 쓴다.

설계는 DESIGN-ACCOUNT.md를 따른다.
  serve [--dev] [--static <폴더>] [--host H] [--port N]   (`--dev ...`만 써도 serve)
  stats | suspects | hide <runId> | unhide <runId> | ban <userId> | unban <userId>
  rename <userId> <닉네임> | rebuild-best
환경 변수: GOOGLE_CLIENT_ID(serve 필수, --dev는 없어도 됨), PUBLIC_ORIGIN, DATA, BOUNDS
"""
import base64
import bisect
import hashlib
import hmac
import json
import math
import mimetypes
import os
import re
import secrets
import socket
import sqlite3
import sys
import threading
import time
import unicodedata
import urllib.parse
import urllib.request
from contextlib import contextmanager
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

VERSION = "1.0.0"
DEFAULT_ORIGIN = "https://game.aovob7.duckdns.org"
HERE = os.path.dirname(os.path.abspath(__file__))

MAX_BODY = 32 * 1024
MAX_CONNS = 64                   # 동시에 처리하는 연결 수. 넘치면 바로 503을 돌려준다
BODY_DEADLINE = 10               # 본문 전체를 받는 데 주는 시간(초)
DRAIN_MAX = 64 * 1024            # 거부한 요청의 본문을 이만큼까지는 읽어 버린다(연결 재설정 방지)
SOCKET_TIMEOUT = 15

# 요청 제한(7.1): 이름 -> (한도, 채우는 데 걸리는 초)
LIMITS = {
    "all": (120, 60),
    "auth": (10, 60),
    "new_account": (5, 86400),
    "board": (30, 60),
    "runs": (30, 3600),
    "tickets": (30, 3600),
    "settings": (10, 60),
}
RUNS_PER_DAY = 300

JANITOR_BUCKET_SEC = 600
JANITOR_DB_SEC = 6 * 3600


class ApiError(Exception):
    """JSON 오류 응답으로 바뀌는 예외. 코드는 DESIGN-ACCOUNT.md 5장을 따른다."""

    def __init__(self, status, code, headers=()):
        Exception.__init__(self, code)
        self.status = status
        self.code = code
        self.headers = list(headers)


def rate_limited(retry_after):
    return ApiError(429, "rate_limited", [("Retry-After", str(retry_after))])


# ---------------------------------------------------------------- 설정

class Config:
    def __init__(self, **kw):
        self.client_id = ""
        self.origin = DEFAULT_ORIGIN
        self.data = "/data"
        self.bounds_path = os.path.join(HERE, "bounds.json")
        self.dev = False
        self.static = None
        self.host = "0.0.0.0"
        self.port = 8080
        for k, v in kw.items():
            if not hasattr(self, k):
                raise TypeError("알 수 없는 설정: " + k)
            setattr(self, k, v)

    @property
    def session_cookie(self):
        return ("" if self.dev else "__Host-") + "lw_s"

    @property
    def login_cookie(self):
        return ("" if self.dev else "__Host-") + "lw_login"


def config_from_env(dev=False, static=None, host=None, port=None):
    env = os.environ
    cfg = Config(dev=dev, static=static)
    cfg.client_id = env.get("GOOGLE_CLIENT_ID", "")
    if port:
        cfg.port = port
    if host:
        cfg.host = host
    elif dev:
        cfg.host = "127.0.0.1"           # 개발용 로그인은 기본으로 이 컴퓨터에서만 닿는다(--host 로 바꿀 수는 있다)
    if dev:
        cfg.origin = "http://localhost:%d" % cfg.port
        cfg.data = os.path.join(HERE, ".devdata")
    cfg.origin = env.get("PUBLIC_ORIGIN", cfg.origin).rstrip("/")
    cfg.data = env.get("DATA", cfg.data)
    cfg.bounds_path = env.get("BOUNDS", cfg.bounds_path)
    return cfg


# ---------------------------------------------------------------- DB

SCHEMA_V1 = """
CREATE TABLE users (
  id                  INTEGER PRIMARY KEY,
  sub_hash            TEXT    NOT NULL UNIQUE,
  nickname            TEXT    NOT NULL,
  nickname_key        TEXT    NOT NULL UNIQUE,
  nickname_set        INTEGER NOT NULL DEFAULT 0,
  nickname_changed_at INTEGER,
  imported            INTEGER NOT NULL DEFAULT 0,
  banned              INTEGER NOT NULL DEFAULT 0,
  created_at          INTEGER NOT NULL,
  last_seen_at        INTEGER NOT NULL
);
CREATE TABLE sessions (
  token_hash   TEXT    PRIMARY KEY,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at   INTEGER NOT NULL,
  last_used_at INTEGER NOT NULL,
  expires_at   INTEGER NOT NULL
);
CREATE INDEX sessions_user ON sessions(user_id);
CREATE TABLE settings (
  user_id    INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  json       TEXT    NOT NULL,
  rev        INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE records (
  user_id      INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  best_time_ms INTEGER NOT NULL DEFAULT 0,
  best_kills   INTEGER NOT NULL DEFAULT 0,
  best_level   INTEGER NOT NULL DEFAULT 0,
  wins         INTEGER NOT NULL DEFAULT 0,
  runs         INTEGER NOT NULL DEFAULT 0,
  full_dawns   INTEGER NOT NULL DEFAULT 0,
  updated_at   INTEGER NOT NULL
);
CREATE TABLE tickets (
  id         TEXT    PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  issued_at  INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at    INTEGER
);
CREATE INDEX tickets_user_unused ON tickets(user_id) WHERE used_at IS NULL;
CREATE TABLE runs (
  id            INTEGER PRIMARY KEY,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  client_run_id TEXT    NOT NULL,
  ticket_id     TEXT,
  ticket_age_s  INTEGER,
  ver           TEXT    NOT NULL,
  time_ms       INTEGER NOT NULL,
  kills         INTEGER NOT NULL,
  level         INTEGER NOT NULL,
  won           INTEGER NOT NULL,
  full_dawn     INTEGER NOT NULL,
  elites        INTEGER NOT NULL,
  bosses        INTEGER NOT NULL,
  detail        TEXT    NOT NULL,
  status        TEXT    NOT NULL,
  reason        TEXT,
  hidden        INTEGER NOT NULL DEFAULT 0,
  submitted_at  INTEGER NOT NULL,
  UNIQUE (user_id, client_run_id)
);
CREATE INDEX runs_user ON runs(user_id, submitted_at);
CREATE TABLE best (
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  board       TEXT    NOT NULL,
  run_id      INTEGER NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  v1          INTEGER NOT NULL,
  v2          INTEGER NOT NULL,
  achieved_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, board)
);
CREATE INDEX best_rank ON best(board, v1 DESC, v2 DESC, achieved_at ASC);
"""

MIGRATIONS = [SCHEMA_V1]   # 인덱스 i는 user_version i -> i+1로 올리는 스크립트


class Db:
    """연결 하나를 Lock으로 감싼다. 동시 사용자가 적어서 이것으로 충분하다."""

    def __init__(self, path):
        self.lock = threading.Lock()
        self.conn = sqlite3.connect(path, check_same_thread=False, isolation_level=None)
        self.conn.row_factory = sqlite3.Row
        c = self.conn
        c.execute("PRAGMA journal_mode=WAL")
        c.execute("PRAGMA foreign_keys=ON")
        c.execute("PRAGMA busy_timeout=3000")
        self.migrate()

    def migrate(self):
        c = self.conn
        ver = c.execute("PRAGMA user_version").fetchone()[0]
        for i in range(ver, len(MIGRATIONS)):
            try:
                c.executescript("BEGIN;\n" + MIGRATIONS[i] + "\nPRAGMA user_version=%d;\nCOMMIT;" % (i + 1))
            except Exception:
                if c.in_transaction:
                    c.execute("ROLLBACK")
                raise

    @property
    def version(self):
        return self.conn.execute("PRAGMA user_version").fetchone()[0]

    @contextmanager
    def tx(self):
        with self.lock:
            c = self.conn
            c.execute("BEGIN IMMEDIATE")
            try:
                yield c
            except BaseException:
                c.execute("ROLLBACK")
                raise
            else:
                c.execute("COMMIT")

    @contextmanager
    def read(self):
        with self.lock:
            yield self.conn

    def close(self):
        with self.lock:
            self.conn.close()


# ---------------------------------------------------------------- 요청 제한

class Buckets:
    """메모리 토큰 버킷. IP는 메모리에만 두고 디스크에 남기지 않는다."""

    def __init__(self, clock):
        self.clock = clock
        self.lock = threading.Lock()
        self.items = {}

    def take(self, key, capacity, per, cost=1):
        """성공하면 0, 모자라면 기다릴 초(올림)를 돌려준다."""
        rate = capacity / float(per)
        now = self.clock()
        with self.lock:
            tokens, last = capacity, now
            if key in self.items:
                tokens, last = self.items[key][:2]
            tokens = min(capacity, tokens + max(0.0, now - last) * rate)
            if tokens >= cost:
                self.items[key] = (tokens - cost, now, capacity, rate)
                return 0
            self.items[key] = (tokens, now, capacity, rate)
            return max(1, int(math.ceil((cost - tokens) / rate)))

    def purge(self):
        """가득 찬(= 새 버킷과 같은) 항목을 지운다."""
        now = self.clock()
        with self.lock:
            for k in [k for k, (t, last, cap, rate) in self.items.items()
                      if t + max(0.0, now - last) * rate >= cap]:
                del self.items[k]


# ---------------------------------------------------------------- 앱

class App:
    def __init__(self, cfg, clock=time.time, jwks_fetch=None):
        self.cfg = cfg
        self.clock = clock
        os.makedirs(cfg.data, exist_ok=True)
        self.db = Db(os.path.join(cfg.data, "game.db"))
        self.pepper = load_pepper(cfg.data)
        self.bounds = load_bounds(cfg.bounds_path)
        self.boards = {}          # 순위표 캐시: board -> (만든 시각, 상위 100개)
        self.jwks = JwksCache(jwks_fetch or fetch_jwks_http, lambda: self.clock())
        self.buckets = Buckets(lambda: self.clock())
        self.stop_event = threading.Event()
        self.janitor = None

    def now(self):
        return int(self.clock())

    def limit(self, key, name, cost=1):
        cap, per = LIMITS[name]
        wait = self.buckets.take((name, key), cap, per, cost)
        if wait:
            raise rate_limited(wait)

    def cleanup(self):
        """만료된 세션과 표, 30일 지난 rejected 판을 지운다."""
        now = self.now()
        with self.db.tx() as c:
            c.execute("DELETE FROM sessions WHERE expires_at < ?", (now,))
            c.execute("DELETE FROM tickets WHERE expires_at < ?", (now,))
            c.execute("DELETE FROM runs WHERE status = 'rejected' AND submitted_at < ?",
                      (now - 30 * 86400,))

    def start_janitor(self):
        def loop():
            last_db = self.clock()
            while not self.stop_event.wait(JANITOR_BUCKET_SEC):
                self.buckets.purge()
                if self.clock() - last_db >= JANITOR_DB_SEC:
                    last_db = self.clock()
                    try:
                        self.cleanup()
                    except Exception as e:
                        log_error(e, "cleanup")
        self.cleanup()
        self.janitor = threading.Thread(target=loop, name="janitor", daemon=True)
        self.janitor.start()

    def close(self):
        self.stop_event.set()
        self.db.close()


_UINT = re.compile(r"[0-9]+")


def is_uint(s, max_len=9):
    """ASCII 숫자만 있는 짧은 문자열인지. str.isdigit()는 위 첨자 같은 유니코드 숫자도 통과시켜 int()에서 ValueError가 난다."""
    return isinstance(s, str) and len(s) <= max_len and _UINT.fullmatch(s) is not None


def log_error(exc, path):
    """오류 종류와 경로만 남긴다. 토큰, 쿠키, sub, IP는 쓰지 않는다."""
    sys.stderr.write("error %s %s\n" % (type(exc).__name__, path))
    sys.stderr.flush()


# ---------------------------------------------------------------- 요청과 응답

class Req:
    def __init__(self, app, method, path, query, headers, ip):
        self.app = app
        self.method = method
        self.path = path
        self.query = query
        self.headers = headers
        self.ip = ip
        self.body = b""
        self.ctype = ""
        self.cookies = parse_cookies(headers.get("Cookie", ""))
        self.user = None
        self.extra_headers = []   # 세션 연장 등으로 응답에 덧붙일 헤더

    def json(self):
        try:
            obj = json.loads(self.body.decode("utf-8"))
        except (ValueError, UnicodeDecodeError):
            raise ApiError(400, "bad_request")
        if not isinstance(obj, dict):
            raise ApiError(400, "bad_request")
        return obj


class Resp:
    def __init__(self, status=200, obj=None, headers=(), location=None, raw=None, ctype=None):
        self.status = status
        self.obj = obj
        self.headers = list(headers)
        self.location = location
        self.raw = raw          # 정적 파일 본문(bytes)
        self.ctype = ctype


def parse_cookies(header):
    out = {}
    for part in header.split(";"):
        k, sep, v = part.strip().partition("=")
        if sep and k and k not in out:
            out[k] = v
    return out


def make_cookie(cfg, name, value, max_age, samesite):
    s = "%s=%s; Path=/; Max-Age=%d; HttpOnly" % (name, value, max_age)
    if not cfg.dev:
        s += "; Secure"
    if samesite:
        s += "; SameSite=" + samesite
    return ("Set-Cookie", s)


# 라우트: 경로 -> 메서드 -> (함수, 로그인 방식). 로그인 방식은 none, optional, required.
ROUTES = {}
FORM_POST_PATHS = set()   # Origin 검사 대신 다른 보호를 쓰는 경로(구글 콜백)


def route(method, path, login="none", form_post=False, allow_banned=False):
    def deco(fn):
        ROUTES.setdefault(path, {})[method] = (fn, login, allow_banned)
        if form_post:
            FORM_POST_PATHS.add(path)
        return fn
    return deco


@route("GET", "/api/health")
def h_health(app, req):
    return Resp(200, {"ok": True, "version": VERSION})


WRITE_METHODS = ("POST", "PUT", "DELETE")


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.0"
    timeout = SOCKET_TIMEOUT
    server_version = "lw-game"
    sys_version = ""

    def log_message(self, fmt, *args):
        pass

    def do_GET(self):
        self.dispatch("GET")

    def do_POST(self):
        self.dispatch("POST")

    def do_PUT(self):
        self.dispatch("PUT")

    def do_DELETE(self):
        self.dispatch("DELETE")

    def do_OPTIONS(self):
        self.dispatch("OPTIONS")

    do_HEAD = do_GET

    # -- 보조
    def client_ip(self):
        ip = self.headers.get("X-Real-IP", "").strip()[:64]
        return ip or self.client_address[0]

    def send_resp(self, resp):
        self.send_response(resp.status)
        if resp.location is not None:
            self.send_header("Location", resp.location)
            body = b""
        elif resp.raw is not None:
            self.send_header("Content-Type", resp.ctype)
            body = resp.raw
        else:
            self.send_header("Content-Type", "application/json; charset=utf-8")
            body = json.dumps(resp.obj, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Connection", "close")
        for k, v in resp.headers:
            self.send_header(k, v)
        self.end_headers()
        if body and self.command != "HEAD":
            self.wfile.write(body)

    def drain(self):
        """읽지 않은 본문을 조금만 읽어 버린다. 안 그러면 응답 전에 연결이 재설정될 수 있다."""
        cl = self.headers.get("Content-Length", "")
        if is_uint(cl) and 0 < int(cl) <= DRAIN_MAX and not getattr(self, "body_read", False):
            try:
                self.rfile.read(int(cl))
            except OSError:
                pass

    # -- 처리
    def dispatch(self, method):
        self.body_read = False
        app = self.server.app
        path = self.path.partition("?")[0]
        try:
            try:
                resp = self.process(app, method)
            except ApiError as e:
                if method in WRITE_METHODS:
                    self.drain()
                if path in FORM_POST_PATHS and e.code == "rate_limited":
                    resp = Resp(303, headers=[], location="/?login=fail&r=rate")
                else:
                    resp = Resp(e.status, {"error": e.code}, e.headers)
            self.send_resp(resp)
        except OSError as e:
            # 연결 끊김, 시간 초과. 응답할 상대가 없다.
            if not isinstance(e, (ConnectionError, TimeoutError)):
                log_error(e, path)
        except Exception as e:      # ValueError를 포함한 나머지는 500으로 응답한다
            log_error(e, path)
            try:
                self.send_resp(Resp(500, {"error": "server_error"}))
            except OSError:
                pass

    def process(self, app, method):
        path, _, qs = self.path.partition("?")
        try:
            query = {k: v[0] for k, v in urllib.parse.parse_qs(qs, keep_blank_values=True, max_num_fields=20).items()}
        except ValueError:          # 필드가 너무 많은 질의
            raise ApiError(400, "bad_request")
        req = Req(app, method, path, query, self.headers, self.client_ip())

        if not path.startswith("/api/"):
            return self.serve_static(app, method, path)

        # 요청 제한
        app.limit(req.ip, "all")
        if path.startswith("/api/auth/"):
            app.limit(req.ip, "auth")
        if path == "/api/leaderboard":
            app.limit(req.ip, "board")

        if method in WRITE_METHODS:
            self.read_body(app, req, path in FORM_POST_PATHS)

        methods = ROUTES.get(path)
        if methods is None:
            raise ApiError(404, "not_found")
        entry = methods.get(method)
        if entry is None:
            raise ApiError(405, "method_not_allowed", [("Allow", ", ".join(sorted(methods)))])
        fn, login, allow_banned = entry
        if login != "none":
            self.load_user(app, req, login == "required", allow_banned)
        resp = fn(app, req)
        resp.headers.extend(req.extra_headers)
        return resp

    def read_body(self, app, req, form_post):
        if not form_post and self.headers.get("Origin") != app.cfg.origin:
            raise ApiError(403, "forbidden")
        if self.headers.get("Transfer-Encoding") is not None:
            raise ApiError(411, "length_required")
        cl = self.headers.get("Content-Length")
        if cl is None:
            raise ApiError(411, "length_required")
        if not is_uint(cl):
            raise ApiError(400, "bad_request")
        n = int(cl)
        if n > MAX_BODY:
            raise ApiError(413, "too_large")
        ctype = self.headers.get("Content-Type", "").split(";")[0].strip().lower()
        if not form_post and n > 0 and ctype != "application/json":
            raise ApiError(400, "bad_request")
        data = self.read_exact(n) if n else b""
        self.body_read = True
        if len(data) != n:
            raise ApiError(400, "bad_request")
        req.body = data
        req.ctype = ctype

    def read_exact(self, n):
        """본문 n바이트를 BODY_DEADLINE초 안에 받는다. 한 번의 recv가 아니라 요청 전체에 마감을 건다."""
        end = time.monotonic() + BODY_DEADLINE
        parts, got = [], 0
        try:
            while got < n:
                left = end - time.monotonic()
                if left <= 0:
                    raise TimeoutError("body deadline")
                self.connection.settimeout(left)
                chunk = self.rfile.read1(min(n - got, 8192))
                if not chunk:
                    break
                parts.append(chunk)
                got += len(chunk)
        except TimeoutError:
            self.body_read = True       # 느린 상대의 나머지를 더 읽지 않는다
            raise ApiError(408, "request_timeout")
        return b"".join(parts)

    def load_user(self, app, req, required, allow_banned=False):
        user = find_session_user(app, req)
        if user is None:
            if required:
                raise ApiError(401, "no_session")
            return
        if required and user["banned"] and not allow_banned:
            raise ApiError(403, "banned")
        req.user = user

    def serve_static(self, app, method, path):
        root = app.cfg.static
        if root is None or method not in ("GET", "HEAD"):
            raise ApiError(404, "not_found")
        rel = urllib.parse.unquote(path).lstrip("/")
        if rel == "" or rel.endswith("/"):
            rel += "index.html"
        full = os.path.realpath(os.path.join(root, rel))
        base = os.path.realpath(root)
        if os.path.commonpath([full, base]) != base or not os.path.isfile(full):
            raise ApiError(404, "not_found")
        ctype = mimetypes.guess_type(full)[0] or "application/octet-stream"
        if full.endswith(".webmanifest"):
            ctype = "application/manifest+json"
        with open(full, "rb") as f:
            data = f.read()
        return Resp(200, raw=data, ctype=ctype, headers=[("Cache-Control", "no-cache")])


class Server(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True

    def __init__(self, addr, app):
        self.app = app
        self.slots = threading.BoundedSemaphore(MAX_CONNS)
        ThreadingHTTPServer.__init__(self, addr, Handler)

    def process_request(self, request, client_address):
        # 동시 연결이 상한이면 스레드를 만들지 않고 바로 503을 돌려준다
        if not self.slots.acquire(blocking=False):
            try:
                request.settimeout(0.3)
                request.sendall(b"HTTP/1.0 503 Service Unavailable\r\nConnection: close\r\n"
                                b"Content-Length: 0\r\n\r\n")
                request.shutdown(socket.SHUT_WR)
                request.recv(4096)          # 읽지 않은 요청이 남은 채 닫으면 상대가 응답 전에 재설정을 받는다
            except OSError:
                pass
            self.shutdown_request(request)
            return
        try:
            ThreadingHTTPServer.process_request(self, request, client_address)
        except BaseException:
            self.slots.release()
            raise

    def process_request_thread(self, request, client_address):
        try:
            ThreadingHTTPServer.process_request_thread(self, request, client_address)
        finally:
            self.slots.release()


def make_server(app, host=None, port=None):
    return Server((host if host is not None else app.cfg.host,
                   app.cfg.port if port is None else port), app)


# ---------------------------------------------------------------- 로그인: ID 토큰 검증

GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
GOOGLE_JWKS_URL = "https://www.googleapis.com/oauth2/v3/certs"
GOOGLE_ISSUERS = ("https://accounts.google.com", "accounts.google.com")
# DigestInfo(SHA-256) 접두 DER. RFC 8017 9.2의 EMSA-PKCS1-v1_5 기대값에 쓴다.
SHA256_DIGESTINFO = bytes.fromhex("3031300d060960864801650304020105000420")
MIN_KEY_BITS = 2048
JWKS_RETRY_SEC = 300          # 키를 못 찾았을 때 다시 받는 최소 간격
JWKS_RETRY_EMPTY_SEC = 30     # 키가 하나도 없을 때(시작 직후 실패 등)의 최소 간격
JWKS_DEFAULT_MAX_AGE = 3600
JWKS_MAX_AGE_RANGE = (60, 86400)
EXP_LEEWAY = 60
IAT_LEEWAY = 300
TOKEN_MAX_LEN = 8192

SESSION_TTL = 180 * 86400
SESSION_REFRESH_AFTER = 86400
LOGIN_COOKIE_TTL = 600

B64URL_CHARS = frozenset("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_")


class TokenError(Exception):
    """로그인 실패 사유 코드(state, token, aud, exp, nonce)를 담는다."""

    def __init__(self, code):
        Exception.__init__(self, code)
        self.code = code


def sha256_hex(text):
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def b64url_decode(text):
    if not isinstance(text, str) or any(ch not in B64URL_CHARS for ch in text):
        raise ValueError("base64url 아님")
    return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))


def rsa_verify_pkcs1_sha256(n, e, message, signature):
    """RFC 8017 8.2.2 방식. 서명을 풀어 기대 인코딩과 통째로 비교한다.
    패딩을 해석하지 않으므로 패딩 파싱 오류에서 오는 서명 위조가 생기지 않는다."""
    k = (n.bit_length() + 7) // 8
    if len(signature) != k:
        return False
    s = int.from_bytes(signature, "big")
    if s >= n:
        return False
    em = pow(s, e, n).to_bytes(k, "big")
    t = SHA256_DIGESTINFO + hashlib.sha256(message).digest()
    if k < len(t) + 11:
        return False
    expected = b"\x00\x01" + b"\xff" * (k - len(t) - 3) + b"\x00" + t
    return hmac.compare_digest(em, expected)


def parse_max_age(cache_control):
    """Cache-Control 값에서 max-age(초)를 꺼낸다. 없으면 None."""
    for part in (cache_control or "").split(","):
        k, _, v = part.strip().partition("=")
        if k.lower() == "max-age" and is_uint(v.strip(), 12):
            return int(v.strip())
    return None


def parse_jwks(doc):
    """JWKS 문서에서 {kid: (n, e)}를 만든다. RSA가 아닌 키와 깨진 항목은 건너뛴다."""
    keys = {}
    items = doc.get("keys") if isinstance(doc, dict) else None
    if not isinstance(items, list):
        raise ValueError("keys 없음")
    for k in items[:20]:
        try:
            if k.get("kty") != "RSA" or not isinstance(k.get("kid"), str):
                continue
            keys[k["kid"]] = (int.from_bytes(b64url_decode(k["n"]), "big"),
                              int.from_bytes(b64url_decode(k["e"]), "big"))
        except (AttributeError, KeyError, ValueError):
            continue
    return keys


def fetch_jwks_http():
    """구글 JWKS를 받는다. (문서, max-age 또는 None)을 돌려준다."""
    req = urllib.request.Request(GOOGLE_JWKS_URL, headers={"User-Agent": "lanternwake-game-api"})
    with urllib.request.urlopen(req, timeout=5) as r:
        data = r.read(200001)
        if len(data) > 200000:
            raise ValueError("JWKS가 너무 큼")
        return json.loads(data.decode("utf-8")), parse_max_age(r.headers.get("Cache-Control"))


class JwksCache:
    """kid로 공개키를 찾는다. 캐시 수명은 Cache-Control max-age를 따른다.
    키가 없거나 수명이 끝났을 때만 다시 받고, 그것도 5분에 한 번으로 제한한다.
    받기에 실패하면 남아 있는 옛 키를 그대로 쓴다."""

    def __init__(self, fetch, clock):
        self.fetch = fetch
        self.clock = clock
        self.lock = threading.Lock()
        self.keys = {}
        self.expires = 0.0
        self.last_attempt = None

    def get(self, kid):
        now = self.clock()
        with self.lock:
            if kid in self.keys and now < self.expires:
                return self.keys[kid]
            wait = JWKS_RETRY_SEC if self.keys else JWKS_RETRY_EMPTY_SEC
            if self.last_attempt is None or now - self.last_attempt >= wait:
                self.last_attempt = now
                try:
                    doc, max_age = self.fetch()
                    keys = parse_jwks(doc)
                except Exception as e:
                    log_error(e, "jwks")
                else:
                    lo, hi = JWKS_MAX_AGE_RANGE
                    age = JWKS_DEFAULT_MAX_AGE if max_age is None else min(hi, max(lo, max_age))
                    self.keys = keys
                    self.expires = now + age
            return self.keys.get(kid)


def is_number(v):
    return isinstance(v, (int, float)) and not isinstance(v, bool)


def verify_id_token(app, token, nonce):
    """ID 토큰을 검증하고 sub를 돌려준다. 실패하면 TokenError(사유 코드)."""
    if not isinstance(token, str) or len(token) > TOKEN_MAX_LEN:
        raise TokenError("token")
    parts = token.split(".")
    if len(parts) != 3:
        raise TokenError("token")
    try:
        header = json.loads(b64url_decode(parts[0]).decode("utf-8"))
        payload = json.loads(b64url_decode(parts[1]).decode("utf-8"))
        signature = b64url_decode(parts[2])
    except (ValueError, UnicodeDecodeError):
        raise TokenError("token")
    if not isinstance(header, dict) or not isinstance(payload, dict):
        raise TokenError("token")
    # alg는 토큰이 아니라 우리가 정한다. none, HS256 등은 여기서 거부된다.
    if header.get("alg") != "RS256":
        raise TokenError("token")
    kid = header.get("kid")
    if not isinstance(kid, str) or not kid:
        raise TokenError("token")
    key = app.jwks.get(kid)
    if key is None:
        raise TokenError("token")
    n, e = key
    if n.bit_length() < MIN_KEY_BITS or not (3 <= e < 2 ** 32) or e % 2 == 0:
        raise TokenError("token")
    signing_input = (parts[0] + "." + parts[1]).encode("ascii")
    if not rsa_verify_pkcs1_sha256(n, e, signing_input, signature):
        raise TokenError("token")

    # 서명이 맞은 뒤에 클레임을 본다.
    if payload.get("iss") not in GOOGLE_ISSUERS:
        raise TokenError("token")
    client_id = app.cfg.client_id
    aud, azp = payload.get("aud"), payload.get("azp")
    if isinstance(aud, list):
        if client_id not in aud or azp != client_id:
            raise TokenError("aud")
    elif aud != client_id:
        raise TokenError("aud")
    if azp is not None and azp != client_id:
        raise TokenError("aud")
    exp, iat = payload.get("exp"), payload.get("iat")
    if not is_number(exp) or not is_number(iat):
        raise TokenError("token")
    now = app.clock()
    if not exp > now - EXP_LEEWAY or not iat < now + IAT_LEEWAY:
        raise TokenError("exp")
    tn = payload.get("nonce")
    if not isinstance(tn, str) or not hmac.compare_digest(tn.encode("utf-8"), nonce.encode("utf-8")):
        raise TokenError("nonce")
    sub = payload.get("sub")
    if not isinstance(sub, str) or not sub or len(sub) > 255:
        raise TokenError("token")
    return sub


# ---------------------------------------------------------------- 로그인: 세션과 라우트

def load_pepper(data_dir):
    """/data/pepper를 읽는다. 없으면 무작위 32바이트로 만든다. 백업 대상이다."""
    path = os.path.join(data_dir, "pepper")
    try:
        with open(path, "rb") as f:
            pepper = f.read()
        if len(pepper) >= 16:
            return pepper
        raise RuntimeError("pepper 파일이 너무 짧음: " + path)
    except FileNotFoundError:
        pass
    pepper = secrets.token_bytes(32)
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, "wb") as f:
        f.write(pepper)
    return pepper


def login_cookie_header(cfg, value, max_age):
    # 구글 콜백은 다른 사이트에서 오는 POST라 SameSite=None이어야 쿠키가 같이 온다.
    # 개발 모드(http)는 Secure를 못 쓰므로 속성을 생략한다(브라우저 기본 Lax의 POST 예외에 기댄다).
    return make_cookie(cfg, cfg.login_cookie, value, max_age, None if cfg.dev else "None")


def session_cookie_header(cfg, value, max_age):
    return make_cookie(cfg, cfg.session_cookie, value, max_age, "Lax")


def find_session_user(app, req):
    """세션 쿠키로 사용자를 찾는다. 하루 넘게 지났으면 만료를 늘리고 쿠키를 새로 내린다."""
    token = req.cookies.get(app.cfg.session_cookie)
    if not token or len(token) > 128:
        return None
    th = sha256_hex(token)
    now = app.now()
    with app.db.read() as c:
        row = c.execute(
            "SELECT u.id, u.nickname, u.nickname_set, u.nickname_changed_at, u.imported, u.banned,"
            " u.created_at, s.last_used_at, s.expires_at FROM sessions s JOIN users u ON u.id = s.user_id"
            " WHERE s.token_hash = ?", (th,)).fetchone()
    if row is None or row["expires_at"] <= now:
        return None
    user = dict(row)
    user["session_hash"] = th
    if now - row["last_used_at"] > SESSION_REFRESH_AFTER:
        with app.db.tx() as c:
            c.execute("UPDATE sessions SET last_used_at=?, expires_at=? WHERE token_hash=?",
                      (now, now + SESSION_TTL, th))
            c.execute("UPDATE users SET last_seen_at=? WHERE id=?", (now, row["id"]))
        req.extra_headers.append(session_cookie_header(app.cfg, token, SESSION_TTL))
    return user


def first_value(form, key):
    v = form.get(key)
    return v[0] if v else ""


def new_nickname(c):
    """등불지기 + 숫자 4자리. 겹치면 다시 뽑고, 계속 겹치면 6자리로 넓힌다."""
    for digits in (4, 6):
        for _ in range(50):
            name = "등불지기%0*d" % (digits, secrets.randbelow(10 ** digits))
            if c.execute("SELECT 1 FROM users WHERE nickname_key=?", (name.lower(),)).fetchone() is None:
                return name
    raise RuntimeError("닉네임을 정하지 못함")


def login_user(app, ip, sub, limit=True):
    """sub로 사용자를 찾거나 만든다. 새 계정은 IP당 하루 5개까지(limit=False는 개발용 로그인만)."""
    sub_hash = hmac.new(app.pepper, sub.encode("utf-8"), hashlib.sha256).hexdigest()
    now = app.now()
    with app.db.tx() as c:
        row = c.execute("SELECT id FROM users WHERE sub_hash=?", (sub_hash,)).fetchone()
        if row is not None:
            c.execute("UPDATE users SET last_seen_at=? WHERE id=?", (now, row["id"]))
            return row["id"]
        if limit:
            app.limit(ip, "new_account")
        name = new_nickname(c)
        cur = c.execute(
            "INSERT INTO users(sub_hash, nickname, nickname_key, nickname_set, created_at, last_seen_at)"
            " VALUES(?,?,?,0,?,?)", (sub_hash, name, name.lower(), now, now))
        c.execute("INSERT INTO records(user_id, updated_at) VALUES(?,?)", (cur.lastrowid, now))
        return cur.lastrowid


def create_session(app, user_id):
    token = secrets.token_urlsafe(32)
    now = app.now()
    with app.db.tx() as c:
        c.execute("INSERT INTO sessions(token_hash, user_id, created_at, last_used_at, expires_at)"
                  " VALUES(?,?,?,?,?)", (sha256_hex(token), user_id, now, now, now + SESSION_TTL))
    return token


@route("GET", "/api/auth/start")
def h_auth_start(app, req):
    cfg = app.cfg
    c = secrets.token_urlsafe(32)
    params = urllib.parse.urlencode({
        "client_id": cfg.client_id,
        "redirect_uri": cfg.origin + "/api/auth/callback",
        "response_type": "id_token",
        "response_mode": "form_post",
        "scope": "openid",
        "state": c,
        "nonce": sha256_hex(c),
        "prompt": "select_account",
    })
    return Resp(302, headers=[login_cookie_header(cfg, c, LOGIN_COOKIE_TTL)],
                location=GOOGLE_AUTH_URL + "?" + params)


@route("POST", "/api/auth/callback", form_post=True)
def h_auth_callback(app, req):
    cfg = app.cfg
    clear = login_cookie_header(cfg, "", 0)

    def fail(reason):
        return Resp(303, headers=[clear], location="/?login=fail&r=" + reason)

    if req.ctype != "application/x-www-form-urlencoded":
        return fail("state")
    form = urllib.parse.parse_qs(req.body.decode("utf-8", "replace"), max_num_fields=10,
                                 keep_blank_values=True)
    state = first_value(form, "state")
    c = req.cookies.get(cfg.login_cookie)
    # 로그인 CSRF 방지: 우리가 이 브라우저에 내린 상태 값과 같아야 한다.
    if not c or not state or not hmac.compare_digest(c.encode("utf-8"), state.encode("utf-8")):
        return fail("state")
    if "error" in form:
        return fail("google")
    try:
        sub = verify_id_token(app, first_value(form, "id_token"), sha256_hex(c))
    except TokenError as e:
        return fail(e.code)
    try:
        user_id = login_user(app, req.ip, sub)
    except ApiError:
        return fail("rate")
    token = create_session(app, user_id)
    return Resp(303, headers=[clear, session_cookie_header(cfg, token, SESSION_TTL)],
                location="/?login=ok")


DEV_CLIENT_ID = "dev-no-client-id.apps.googleusercontent.com"
DEV_NAME_RE = re.compile(r"[A-Za-z0-9_-]{1,32}")


@route("GET", "/api/dev/login")
def h_dev_login(app, req):
    """개발 전용 가짜 로그인(구글 없이 세션 발급). --dev가 아니면 없는 경로와 똑같이 404다.

    이름(name)마다 계정 하나를 만들고 세션 쿠키를 내린 뒤 /?login=ok 로 보낸다.
    """
    if not app.cfg.dev:
        raise ApiError(404, "not_found")
    name = req.query.get("name", "tester")
    if not DEV_NAME_RE.fullmatch(name):
        raise ApiError(400, "bad_request")
    user_id = login_user(app, req.ip, "dev:" + name, limit=False)
    token = create_session(app, user_id)
    return Resp(303, headers=[session_cookie_header(app.cfg, token, SESSION_TTL)], location="/?login=ok")


@route("POST", "/api/auth/logout", login="required", allow_banned=True)
def h_auth_logout(app, req):
    with app.db.tx() as c:
        c.execute("DELETE FROM sessions WHERE token_hash=?", (req.user["session_hash"],))
    req.extra_headers[:] = []
    return Resp(200, {"ok": True}, [session_cookie_header(app.cfg, "", 0)])


def records_json(row):
    return {"bestTimeMs": row["best_time_ms"], "bestKills": row["best_kills"],
            "bestLevel": row["best_level"], "wins": row["wins"], "runs": row["runs"],
            "fullDawns": row["full_dawns"]}


DEFAULT_SETTINGS = {"sound": True, "vibrate": True, "dmgNumbers": True}


@route("GET", "/api/me", login="required")
def h_me(app, req):
    u = req.user
    with app.db.read() as c:
        rec = c.execute("SELECT * FROM records WHERE user_id=?", (u["id"],)).fetchone()
        st = c.execute("SELECT json, rev FROM settings WHERE user_id=?", (u["id"],)).fetchone()
    return Resp(200, {
        "user": {"id": u["id"], "nickname": u["nickname"], "nicknameSet": bool(u["nickname_set"]),
                 "createdAt": u["created_at"]},
        "records": records_json(rec),
        "settings": json.loads(st["json"]) if st else dict(DEFAULT_SETTINGS),
        "settingsRev": st["rev"] if st else 0,
        "imported": bool(u["imported"]),
    })


@route("DELETE", "/api/me", login="required", allow_banned=True)
def h_me_delete(app, req):
    if req.json().get("confirm") != "DELETE":
        raise ApiError(400, "bad_request")
    with app.db.tx() as c:
        c.execute("DELETE FROM users WHERE id=?", (req.user["id"],))
    app.boards.clear()
    req.extra_headers[:] = []
    return Resp(200, {"ok": True}, [session_cookie_header(app.cfg, "", 0)])


# ---------------------------------------------------------------- 검사 기준(bounds.json)

class Bounds:
    """server/bounds.json을 읽어 판 검사에 쓰는 표를 만든다(DESIGN-ACCOUNT.md 6.2)."""

    def __init__(self, d):
        try:
            self.win_ms = int(d["winMs"])
            self.max_level = int(d["maxLevel"])
            self.last_boss_ms = d["lastBossT"] * 1000
            self.xp_to_reach = [int(v) for v in d["xpToReach"]]
            self.kpm_max = [int(v) for v in d["kpmMax"]]
            self.min_ranked = parse_version(d["minRankedVersion"])
            elites = sorted((float(t) * 1000, int(n)) for t, n in d["elites"])
            bosses = sorted(float(t) * 1000 for t in d["bosses"])
        except (KeyError, TypeError, ValueError) as e:
            raise ValueError("bounds.json 형식 오류: %r" % (e,))
        if self.min_ranked is None or len(self.xp_to_reach) <= self.max_level or len(self.kpm_max) != MAX_MINUTES:
            raise ValueError("bounds.json 값 오류")
        self.elite_times = [t for t, _ in elites]
        self.elite_cum = [0]
        for _, n in elites:
            self.elite_cum.append(self.elite_cum[-1] + n)
        self.boss_times = bosses

    def elites_before(self, t_ms):
        """t_ms까지 등장한 엘리트 마릿수 합."""
        return self.elite_cum[bisect.bisect_right(self.elite_times, t_ms)]

    def bosses_before(self, t_ms):
        return bisect.bisect_right(self.boss_times, t_ms)


def load_bounds(path):
    with open(path, encoding="utf-8") as f:
        return Bounds(json.load(f))


VERSION_RE = re.compile(r"\d{1,4}\.\d{1,4}\.\d{1,4}")
MAX_MINUTES = 15
MIN_RANKED_MS = 30000
TICKET_TTL = 14 * 86400
TICKET_MAX_UNUSED = 6
TICKET_MAX_COUNT = 5
RUN_BATCH_MAX = 20
INT_CAP = 2 ** 62


def parse_version(text):
    if not isinstance(text, str) or not VERSION_RE.fullmatch(text):
        return None
    return tuple(int(p) for p in text.split("."))


def is_int(v):
    return isinstance(v, int) and not isinstance(v, bool)


def clamp_int(v):
    return max(-INT_CAP, min(INT_CAP, v)) if is_int(v) else 0


# ---------------------------------------------------------------- 판 검사

def check_run(b, r):
    """통계 검사. 실패하면 검사 이름, 통과하면 None. r은 parse_run이 만든 dict."""
    t = r["time_ms"]
    if not (0 < t <= b.win_ms) or r["kills"] < 0 or not (1 <= r["level"] <= b.max_level) \
            or r["elites"] < 0 or r["bosses"] < 0:
        return "range"
    if r["won"]:
        if t != b.win_ms:
            return "win"
    elif t >= b.win_ms:
        return "win"
    if r["full_dawn"] and (not r["won"] or r["bosses"] < 1 or t <= b.last_boss_ms):
        return "dawn"
    if r["elites"] > b.elites_before(t) or r["bosses"] > b.bosses_before(t):
        return "events"
    minutes = -(-t // 60000)
    kpm, lvm = r["kpm"], r["lvm"]
    if not (isinstance(kpm, list) and isinstance(lvm, list)) or len(kpm) != minutes or len(lvm) != minutes \
            or minutes > MAX_MINUTES:
        return "shape"
    if not all(is_int(v) and 0 <= v <= 65535 for v in kpm) \
            or not all(is_int(v) and 1 <= v <= b.max_level for v in lvm):
        return "shape"
    if sum(kpm) != r["kills"] or any(lvm[i] > lvm[i + 1] for i in range(minutes - 1)) or lvm[-1] != r["level"]:
        return "shape"
    if any(kpm[i] > b.kpm_max[i] for i in range(minutes)):
        return "kpm"
    cum = 0
    for i in range(minutes):
        cum += kpm[i]
        end_ms = min((i + 1) * 60000, t)
        cap = 5 * cum + 20 * b.elites_before(end_ms) + 100 * b.bosses_before(end_ms)
        if b.xp_to_reach[lvm[i]] > cap:
            return "xp"
    return None


def parse_run(raw):
    """JSON 한 판을 내부 dict로 바꾼다. 형식이 틀리면 (None, 사유)."""
    if not isinstance(raw, dict):
        return None, "shape"
    cid = raw.get("clientRunId")
    if not isinstance(cid, str) or not CLIENT_RUN_ID_RE.fullmatch(cid):
        return None, "client_run_id"
    ticket = raw.get("ticket")
    if ticket is not None and (not isinstance(ticket, str) or len(ticket) > 64):
        ticket = ""      # 알아볼 수 없는 표는 없는 표로 취급(no_ticket)
    r = {"cid": cid, "ticket": ticket or None, "ver": raw.get("ver"), "bad": None}
    for key, name in (("timeMs", "time_ms"), ("kills", "kills"), ("level", "level"),
                      ("elites", "elites"), ("bosses", "bosses")):
        r[name] = raw.get(key)
        if not is_int(r[name]):
            r["bad"] = "range"
    for key, name in (("won", "won"), ("fullDawn", "full_dawn")):
        r[name] = raw.get(key)
        if not isinstance(r[name], bool):
            r["bad"] = "range"
    r["kpm"], r["lvm"] = raw.get("kpm"), raw.get("lvm")
    if r["bad"] is None and parse_version(r["ver"]) is None:
        r["bad"] = "ver"
    return r, None


CLIENT_RUN_ID_RE = re.compile(r"[A-Za-z0-9-]{8,64}")


def clean_list(v):
    if not isinstance(v, list):
        return []
    return [x for x in v[:20] if is_int(x) and abs(x) < 2 ** 31]


def user_ranks(c, user_id):
    """두 보드에서의 내 순위(1부터). 기록이 없는 보드는 키를 뺀다."""
    out = {}
    for board in ("time", "kills"):
        rk = rank_of(c, board, user_id)
        if rk is not None:
            out[board] = rk
    return out


def rank_of(c, board, user_id):
    """best에서 나보다 좋은 행 수 + 1. 차단된 사용자와 숨긴 기록은 뺀다."""
    me = c.execute("SELECT v1, v2, achieved_at FROM best WHERE user_id=? AND board=?", (user_id, board)).fetchone()
    if me is None:
        return None
    v1, v2, at = me["v1"], me["v2"], me["achieved_at"]
    n = c.execute(
        "SELECT COUNT(*) FROM best b JOIN users u ON u.id=b.user_id JOIN runs r ON r.id=b.run_id"
        " WHERE b.board=? AND u.banned=0 AND r.hidden=0 AND (b.v1>? OR (b.v1=? AND b.v2>?)"
        " OR (b.v1=? AND b.v2=? AND b.achieved_at<?)"
        " OR (b.v1=? AND b.v2=? AND b.achieved_at=? AND b.user_id<?))",
        (board, v1, v1, v2, v1, v2, at, v1, v2, at, user_id)).fetchone()[0]
    return n + 1


def board_values(board, time_ms, kills):
    """보드별 (v1, v2). 둘 다 큰 쪽이 좋다. kills 보드는 짧은 시간이 좋으므로 -time_ms."""
    return (time_ms, kills) if board == "time" else (kills, -time_ms)


def update_best(c, user_id, run_id, time_ms, kills, at):
    for board in ("time", "kills"):
        v1, v2 = board_values(board, time_ms, kills)
        cur = c.execute("SELECT v1, v2 FROM best WHERE user_id=? AND board=?", (user_id, board)).fetchone()
        if cur is None or (v1, v2) > (cur["v1"], cur["v2"]):
            c.execute("INSERT OR REPLACE INTO best(user_id, board, run_id, v1, v2, achieved_at) VALUES(?,?,?,?,?,?)",
                      (user_id, board, run_id, v1, v2, at))


def rebuild_best(app, user_id=None):
    """ranked이고 숨기지 않았고 minRankedVersion 이상인 판으로 best를 다시 만든다."""
    min_ver = app.bounds.min_ranked
    with app.db.tx() as c:
        if user_id is None:
            c.execute("DELETE FROM best")
            rows = c.execute("SELECT id, user_id, ver, time_ms, kills, submitted_at FROM runs"
                             " WHERE status='ranked' AND hidden=0 ORDER BY submitted_at, id").fetchall()
        else:
            c.execute("DELETE FROM best WHERE user_id=?", (user_id,))
            rows = c.execute("SELECT id, user_id, ver, time_ms, kills, submitted_at FROM runs"
                             " WHERE user_id=? AND status='ranked' AND hidden=0 ORDER BY submitted_at, id",
                             (user_id,)).fetchall()
        for r in rows:
            v = parse_version(r["ver"])
            if v is None or v < min_ver:
                continue
            update_best(c, r["user_id"], r["id"], r["time_ms"], r["kills"], r["submitted_at"])
    app.boards.clear()


def run_result(cid, status, reason=None, rank=None, first=None):
    out = {"clientRunId": cid, "status": status}
    if first is not None:
        out["first"] = first
    if reason is not None:
        out["reason"] = reason
    if rank:
        out["rank"] = rank
    return out


def process_run(app, c, user_id, raw, now):
    """한 판을 검사하고 저장한다. c는 열린 트랜잭션이다. 결과 dict를 돌려준다."""
    r, why = parse_run(raw)
    if r is None:
        cid = raw.get("clientRunId") if isinstance(raw, dict) else None
        return run_result(cid[:64] if isinstance(cid, str) else None, "rejected", why)
    cid = r["cid"]
    old = c.execute("SELECT id, status, reason FROM runs WHERE user_id=? AND client_run_id=?",
                    (user_id, cid)).fetchone()
    if old is not None:
        rank = user_ranks(c, user_id) if old["status"] == "ranked" else None
        return run_result(cid, "duplicate", old["reason"], rank, first=old["status"])

    b = app.bounds
    status, reason, ticket_age = None, None, None
    reason = r["bad"] or check_run(b, r)
    if reason:
        status = "rejected"
    elif parse_version(r["ver"]) < b.min_ranked:
        status, reason = "unranked", "old_version"
    elif r["time_ms"] < MIN_RANKED_MS:
        status, reason = "unranked", "too_short"
    elif r["ticket"] is None:
        status, reason = "unranked", "no_ticket"
    else:
        t = c.execute("SELECT issued_at, expires_at, used_at FROM tickets WHERE id=? AND user_id=?",
                      (r["ticket"], user_id)).fetchone()
        if t is None or t["used_at"] is not None:
            status, reason = "unranked", "no_ticket"
        elif t["expires_at"] <= now:
            status, reason = "unranked", "ticket_expired"
        elif now - t["issued_at"] < r["time_ms"] / 1000.0 - 5:
            status, reason = "rejected", "elapsed"
        else:
            # 표 사용 처리는 원자적으로. 이미 쓴 표면 갱신 행 수가 0이다.
            cur = c.execute("UPDATE tickets SET used_at=? WHERE id=? AND used_at IS NULL", (now, r["ticket"]))
            if cur.rowcount == 1:
                status = "ranked"
                ticket_age = now - t["issued_at"]
            else:
                status, reason = "unranked", "no_ticket"

    detail = json.dumps({"kpm": clean_list(r["kpm"]), "lvm": clean_list(r["lvm"])}, separators=(",", ":"))
    cur = c.execute(
        "INSERT INTO runs(user_id, client_run_id, ticket_id, ticket_age_s, ver, time_ms, kills, level, won,"
        " full_dawn, elites, bosses, detail, status, reason, hidden, submitted_at)"
        " VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,0,?)",
        (user_id, cid, r["ticket"], ticket_age, r["ver"][:32] if isinstance(r["ver"], str) else "", clamp_int(r["time_ms"]),
         clamp_int(r["kills"]), clamp_int(r["level"]), int(r["won"] is True), int(r["full_dawn"] is True),
         clamp_int(r["elites"]), clamp_int(r["bosses"]), detail, status, reason, now))
    run_id = cur.lastrowid
    if status == "rejected":
        return run_result(cid, status, reason)
    c.execute(
        "UPDATE records SET best_time_ms=MAX(best_time_ms,?), best_kills=MAX(best_kills,?),"
        " best_level=MAX(best_level,?), wins=wins+?, runs=runs+1, full_dawns=full_dawns+?, updated_at=?"
        " WHERE user_id=?",
        (r["time_ms"], r["kills"], r["level"], int(r["won"]), int(r["full_dawn"]), now, user_id))
    if status == "ranked":
        update_best(c, user_id, run_id, r["time_ms"], r["kills"], now)
        return run_result(cid, status, None, user_ranks(c, user_id))
    return run_result(cid, status, reason)


@route("POST", "/api/runs", login="required")
def h_runs_submit(app, req):
    body = req.json()
    runs = body.get("runs")
    if not isinstance(runs, list) or not 1 <= len(runs) <= RUN_BATCH_MAX:
        raise ApiError(400, "bad_request")
    uid = req.user["id"]
    app.limit(uid, "runs")
    now = app.now()
    with app.db.tx() as c:
        row = c.execute("SELECT COUNT(*) n, MIN(submitted_at) first FROM runs WHERE user_id=? AND submitted_at>?",
                        (uid, now - 86400)).fetchone()
        if row["n"] + len(runs) > RUNS_PER_DAY:
            raise rate_limited(max(1, (row["first"] or now) + 86400 - now))
        results = [process_run(app, c, uid, raw, now) for raw in runs]
        rec = c.execute("SELECT * FROM records WHERE user_id=?", (uid,)).fetchone()
    return Resp(200, {"results": results, "records": records_json(rec)})


@route("POST", "/api/runs/tickets", login="required")
def h_tickets(app, req):
    count = req.json().get("count", 1)
    if not is_int(count) or not 1 <= count <= TICKET_MAX_COUNT:
        raise ApiError(400, "bad_request")
    uid = req.user["id"]
    app.limit(uid, "tickets")
    now = app.now()
    out = []
    with app.db.tx() as c:
        unused = c.execute("SELECT COUNT(*) FROM tickets WHERE user_id=? AND used_at IS NULL AND expires_at>?",
                           (uid, now)).fetchone()[0]
        # 상한을 넘기면 가장 오래된 미사용 표를 지우고 새로 준다(클라이언트가 잃어버린 표가 쌓여 막히지 않게)
        over = unused + count - TICKET_MAX_UNUSED
        if over > 0:
            c.execute("DELETE FROM tickets WHERE id IN (SELECT id FROM tickets WHERE user_id=? AND used_at IS NULL "
                      "AND expires_at>? ORDER BY issued_at, rowid LIMIT ?)", (uid, now, over))
        for _ in range(count):
            tid = secrets.token_urlsafe(16)
            c.execute("INSERT INTO tickets(id, user_id, issued_at, expires_at) VALUES(?,?,?,?)",
                      (tid, uid, now, now + TICKET_TTL))
            out.append({"id": tid, "issuedAt": now, "expiresAt": now + TICKET_TTL})
    return Resp(200, {"tickets": out})


# ---------------------------------------------------------------- 닉네임, 설정, 가져오기

NICK_RE = re.compile(r"[가-힣A-Za-z0-9_]{2,12}")
AUTO_NICK_RE = re.compile(r"등불지기[0-9]*")
RESERVED_NICKS = {"관리자", "운영자", "운영진", "admin", "administrator", "moderator", "system", "root",
                  "lanternwake", "gm"}
BANNED_WORDS = ("시발", "씨발", "병신", "개새끼", "지랄", "fuck", "shit", "bitch", "nigger", "nigga")
NICK_COOLDOWN = 86400


def normalize_nickname(text, admin=False):
    """NFC로 정규화하고 규칙을 검사한다. (닉네임, 비교 키)를 돌려준다."""
    if not isinstance(text, str):
        raise ApiError(400, "invalid_nickname")
    name = unicodedata.normalize("NFC", text)
    if not NICK_RE.fullmatch(name):
        raise ApiError(400, "invalid_nickname")
    key = name.lower()
    if not admin and (key in RESERVED_NICKS or AUTO_NICK_RE.fullmatch(key)
                      or any(w in key for w in BANNED_WORDS)):
        raise ApiError(400, "invalid_nickname")
    return name, key


@route("PUT", "/api/me/nickname", login="required")
def h_nickname(app, req):
    raw = req.json().get("nickname")
    u = req.user
    now = app.now()
    if isinstance(raw, str) and unicodedata.normalize("NFC", raw) == u["nickname"]:
        return Resp(200, {"nickname": u["nickname"]})      # 지금 이름 그대로면 아무 일도 없다
    name, key = normalize_nickname(raw)
    with app.db.tx() as c:
        row = c.execute("SELECT nickname_set, nickname_changed_at FROM users WHERE id=?", (u["id"],)).fetchone()
        if row["nickname_set"] and row["nickname_changed_at"] is not None \
                and now - row["nickname_changed_at"] < NICK_COOLDOWN:
            raise ApiError(429, "too_soon", [("Retry-After", str(row["nickname_changed_at"] + NICK_COOLDOWN - now))])
        try:
            c.execute("UPDATE users SET nickname=?, nickname_key=?, nickname_set=1, nickname_changed_at=? WHERE id=?",
                      (name, key, now, u["id"]))
        except sqlite3.IntegrityError:
            raise ApiError(409, "nickname_taken")
    app.boards.clear()
    return Resp(200, {"nickname": name})


@route("PUT", "/api/me/settings", login="required")
def h_settings(app, req):
    body = req.json()
    st, rev = body.get("settings"), body.get("rev")
    if not isinstance(st, dict) or not is_int(rev) or not 0 <= rev <= 2 ** 53 \
            or any(not isinstance(st.get(k), bool) for k in DEFAULT_SETTINGS):
        raise ApiError(400, "bad_request")
    uid = req.user["id"]
    app.limit(uid, "settings")
    clean = {k: st[k] for k in DEFAULT_SETTINGS}
    with app.db.tx() as c:
        cur = c.execute("SELECT json, rev FROM settings WHERE user_id=?", (uid,)).fetchone()
        if cur is None or rev > cur["rev"]:
            if cur is None and rev == 0:
                return Resp(200, {"settings": dict(DEFAULT_SETTINGS), "rev": 0})
            c.execute("INSERT OR REPLACE INTO settings(user_id, json, rev, updated_at) VALUES(?,?,?,?)",
                      (uid, json.dumps(clean, separators=(",", ":")), rev, app.now()))
            return Resp(200, {"settings": clean, "rev": rev})
        return Resp(200, {"settings": json.loads(cur["json"]), "rev": cur["rev"]})


IMPORT_CAPS = {"bestKills": 1000000, "bestLevel": 200, "wins": 1000000, "runs": 1000000, "fullDawns": 1000000}


@route("POST", "/api/me/import", login="required")
def h_import(app, req):
    rec = req.json().get("records")
    if not isinstance(rec, dict):
        raise ApiError(400, "bad_request")
    vals = {}
    for key, cap in IMPORT_CAPS.items():
        v = rec.get(key, 0)
        if not is_int(v) or v < 0:
            raise ApiError(400, "bad_request")
        vals[key] = min(v, cap)
    bt = rec.get("bestTime", 0)
    if not is_number(bt) or bt < 0 or bt != bt or bt == float("inf"):
        raise ApiError(400, "bad_request")
    vals["bestTimeMs"] = min(int(round(bt * 1000)), app.bounds.win_ms)
    uid = req.user["id"]
    with app.db.tx() as c:
        if c.execute("SELECT imported FROM users WHERE id=?", (uid,)).fetchone()["imported"]:
            raise ApiError(409, "already_imported")
        c.execute(
            "UPDATE records SET best_time_ms=MAX(best_time_ms,?), best_kills=MAX(best_kills,?),"
            " best_level=MAX(best_level,?), wins=wins+?, runs=runs+?, full_dawns=full_dawns+?, updated_at=?"
            " WHERE user_id=?",
            (vals["bestTimeMs"], vals["bestKills"], vals["bestLevel"], vals["wins"], vals["runs"],
             vals["fullDawns"], app.now(), uid))
        c.execute("UPDATE users SET imported=1 WHERE id=?", (uid,))
        merged = c.execute("SELECT * FROM records WHERE user_id=?", (uid,)).fetchone()
    return Resp(200, {"records": records_json(merged)})


# ---------------------------------------------------------------- 순위표

BOARD_CACHE_SEC = 30
BOARD_MAX = 100
BOARD_DEFAULT = 50


@route("GET", "/api/leaderboard", login="optional")
def h_leaderboard(app, req):
    board = req.query.get("board", "time")
    if board not in ("time", "kills"):
        raise ApiError(400, "bad_request")
    ls = req.query.get("limit", str(BOARD_DEFAULT))
    if not is_uint(ls, 6) or int(ls) < 1:
        raise ApiError(400, "bad_request")
    limit = min(int(ls), BOARD_MAX)
    now = app.now()
    cached = app.boards.get(board)
    if cached is None or now - cached[0] >= BOARD_CACHE_SEC:
        with app.db.read() as c:
            rows = c.execute(
                "SELECT u.nickname, r.time_ms, r.kills, r.level, r.full_dawn, b.achieved_at FROM best b"
                " JOIN users u ON u.id=b.user_id JOIN runs r ON r.id=b.run_id"
                " WHERE b.board=? AND u.banned=0 AND r.hidden=0"
                " ORDER BY b.v1 DESC, b.v2 DESC, b.achieved_at ASC, b.user_id ASC LIMIT ?",
                (board, BOARD_MAX)).fetchall()
        entries = [{"rank": i + 1, "nickname": r["nickname"], "timeMs": r["time_ms"], "kills": r["kills"],
                    "level": r["level"], "fullDawn": bool(r["full_dawn"]), "at": r["achieved_at"]}
                   for i, r in enumerate(rows)]
        cached = (now, entries)
        app.boards[board] = cached
    out = {"board": board, "updatedAt": cached[0], "entries": cached[1][:limit]}
    u = req.user
    if u is not None and not u["banned"]:
        with app.db.read() as c:
            rk = rank_of(c, board, u["id"])
            if rk is not None:
                r = c.execute("SELECT r.time_ms, r.kills FROM best b JOIN runs r ON r.id=b.run_id"
                              " WHERE b.user_id=? AND b.board=?", (u["id"], board)).fetchone()
                out["me"] = {"rank": rk, "timeMs": r["time_ms"], "kills": r["kills"]}
    return Resp(200, out)


# ---------------------------------------------------------------- 관리 작업(CLI)

def set_run_hidden(app, run_id, hidden):
    with app.db.tx() as c:
        row = c.execute("SELECT user_id FROM runs WHERE id=?", (run_id,)).fetchone()
        if row is None:
            raise KeyError("판 %d 없음" % run_id)
        c.execute("UPDATE runs SET hidden=? WHERE id=?", (1 if hidden else 0, run_id))
    rebuild_best(app, row["user_id"])
    return row["user_id"]


def set_user_banned(app, user_id, banned):
    with app.db.tx() as c:
        cur = c.execute("UPDATE users SET banned=? WHERE id=?", (1 if banned else 0, user_id))
        if cur.rowcount != 1:
            raise KeyError("사용자 %d 없음" % user_id)
    app.boards.clear()


def rename_user(app, user_id, nickname):
    """관리자 이름 바꾸기. 예약어와 금칙어는 건너뛰고 형식과 중복만 본다."""
    try:
        name, key = normalize_nickname(nickname, admin=True)
    except ApiError:
        raise ValueError("닉네임 형식이 맞지 않음(2~12자, 한글, 영문, 숫자, _)")
    with app.db.tx() as c:
        try:
            cur = c.execute("UPDATE users SET nickname=?, nickname_key=?, nickname_set=1 WHERE id=?",
                            (name, key, user_id))
        except sqlite3.IntegrityError:
            raise ValueError("이미 쓰는 닉네임")
        if cur.rowcount != 1:
            raise KeyError("사용자 %d 없음" % user_id)
    app.boards.clear()


def find_suspects(app):
    """분당 처치가 상위 0.1%인 판, 미리 받은 표로 1위가 된 판을 모은다(DESIGN-ACCOUNT.md 6.2)."""
    with app.db.read() as c:
        rows = c.execute(
            "SELECT r.id, r.user_id, u.nickname, r.time_ms, r.kills, r.detail, r.ticket_age_s FROM runs r"
            " JOIN users u ON u.id=r.user_id WHERE r.status='ranked' AND r.hidden=0 AND u.banned=0").fetchall()
        top = {}
        for board in ("time", "kills"):
            first = c.execute(
                "SELECT b.run_id FROM best b JOIN users u ON u.id=b.user_id JOIN runs r ON r.id=b.run_id"
                " WHERE b.board=? AND u.banned=0 AND r.hidden=0"
                " ORDER BY b.v1 DESC, b.v2 DESC, b.achieved_at ASC, b.user_id ASC LIMIT 1", (board,)).fetchone()
            if first is not None:
                top.setdefault(first["run_id"], []).append(board)
    peak = {}
    for r in rows:
        kpm = json.loads(r["detail"]).get("kpm") or [0]
        peak[r["id"]] = max(kpm)
    out = []
    if rows:
        vals = sorted(peak.values())
        cutoff = vals[min(len(vals) - 1, int(math.ceil(0.999 * len(vals))) - 1)]
        for r in rows:
            why = []
            if peak[r["id"]] >= cutoff:
                why.append("kpm_top")
            age = r["ticket_age_s"]
            if r["id"] in top and age is not None and age - r["time_ms"] / 1000.0 > PRE_TICKET_SLACK_SEC:
                why.extend("pre_ticket_rank1_" + board for board in top[r["id"]])
            if why:
                out.append({"runId": r["id"], "userId": r["user_id"], "nickname": r["nickname"],
                            "timeMs": r["time_ms"], "kills": r["kills"], "peakKpm": peak[r["id"]],
                            "ticketAgeS": age, "why": why})
    return out


PRE_TICKET_SLACK_SEC = 3600   # 표를 받은 지 판 길이보다 1시간 넘게 지났으면 미리 받은 표로 본다


# ---------------------------------------------------------------- CLI

def ensure_client_id(cfg):
    """운영 모드는 GOOGLE_CLIENT_ID가 필수다. 개발 모드는 없어도 뜬다(구글 로그인은 못 쓰고 /api/dev/login만 쓴다)."""
    if not cfg.client_id:
        if not cfg.dev:
            sys.exit("GOOGLE_CLIENT_ID 환경 변수가 필요합니다.")
        cfg.client_id = DEV_CLIENT_ID


def ensure_dev_safe(cfg):
    """--dev 인데 공개 주소(https://)가 설정되어 있으면 운영 설정에 실수로 --dev 가 들어간 것이므로 종료한다."""
    if cfg.dev and cfg.origin.lower().startswith("https://"):
        sys.exit("--dev 는 PUBLIC_ORIGIN 이 https:// 인 환경에서 쓸 수 없습니다(개발용 로그인이 공개됩니다).")


def cmd_serve(args):
    dev = "--dev" in args
    static = host = port = None
    i = 0
    rest = [a for a in args if a != "--dev"]
    while i < len(rest):
        if rest[i] == "--static" and i + 1 < len(rest):
            static = rest[i + 1]
            i += 2
        elif rest[i] == "--host" and i + 1 < len(rest):
            host = rest[i + 1]
            i += 2
        elif rest[i] == "--port" and i + 1 < len(rest):
            port = int(rest[i + 1])
            i += 2
        else:
            sys.exit("알 수 없는 인자: " + rest[i])
    cfg = config_from_env(dev=dev, static=static, host=host, port=port)
    ensure_dev_safe(cfg)
    ensure_client_id(cfg)
    app = App(cfg)
    app.start_janitor()
    server = make_server(app)
    print("serve %s:%d origin=%s dev=%s" % (cfg.host, cfg.port, cfg.origin, cfg.dev), flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
        app.close()


def open_admin_app():
    cfg = config_from_env()
    return App(cfg)


def cmd_stats(args):
    app = open_admin_app()
    try:
        with app.db.read() as c:
            users = c.execute("SELECT COUNT(*) FROM users").fetchone()[0]
            banned = c.execute("SELECT COUNT(*) FROM users WHERE banned=1").fetchone()[0]
            lt = time.localtime(app.now())
            midnight = int(time.mktime((lt.tm_year, lt.tm_mon, lt.tm_mday, 0, 0, 0, 0, 0, -1)))
            today = c.execute("SELECT COUNT(*) FROM runs WHERE submitted_at >= ?", (midnight,)).fetchone()[0]
            by = c.execute("SELECT status, COUNT(*) n FROM runs GROUP BY status ORDER BY status").fetchall()
        print("사용자 %d명 (차단 %d명)" % (users, banned))
        print("오늘 판 %d개" % today)
        for r in by:
            print("판 %s: %d개" % (r["status"], r["n"]))
    finally:
        app.close()


def with_admin_app(fn):
    app = open_admin_app()
    try:
        return fn(app)
    except (KeyError, ValueError) as e:
        sys.exit("오류: %s" % (e.args[0] if e.args else e))
    finally:
        app.close()


def need_int(args, n):
    if len(args) != n or not all(a.lstrip("-").isdigit() for a in args[:1]):
        sys.exit("인자가 맞지 않습니다.\n" + __doc__)
    return int(args[0])


def cmd_suspects(args):
    def run(app):
        rows = find_suspects(app)
        for r in rows:
            print("run=%d user=%d %s time=%dms kills=%d peakKpm=%d ticketAge=%s %s" % (
                r["runId"], r["userId"], r["nickname"], r["timeMs"], r["kills"], r["peakKpm"],
                r["ticketAgeS"], ",".join(r["why"])))
        print("의심 기록 %d개" % len(rows))
    with_admin_app(run)


def cmd_hide(args, hidden=True):
    rid = need_int(args, 1)
    uid = with_admin_app(lambda app: set_run_hidden(app, rid, hidden))
    print("판 %d %s (사용자 %d의 best를 다시 만듦)" % (rid, "숨김" if hidden else "숨김 해제", uid))


def cmd_unhide(args):
    cmd_hide(args, False)


def cmd_ban(args, banned=True):
    uid = need_int(args, 1)
    with_admin_app(lambda app: set_user_banned(app, uid, banned))
    print("사용자 %d %s" % (uid, "차단" if banned else "차단 해제"))


def cmd_unban(args):
    cmd_ban(args, False)


def cmd_rename(args):
    if len(args) != 2 or not is_uint(args[0], 12):
        sys.exit("사용법: rename <userId> <닉네임>")
    with_admin_app(lambda app: rename_user(app, int(args[0]), args[1]))
    print("사용자 %s 닉네임을 %s로 바꿈" % (args[0], args[1]))


def cmd_rebuild_best(args):
    with_admin_app(lambda app: rebuild_best(app))
    print("best를 다시 만듦")


COMMANDS = {"serve": cmd_serve, "stats": cmd_stats, "suspects": cmd_suspects, "hide": cmd_hide,
            "unhide": cmd_unhide, "ban": cmd_ban, "unban": cmd_unban, "rename": cmd_rename,
            "rebuild-best": cmd_rebuild_best}


def main(argv=None):
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8")     # 컨테이너 로케일과 상관없이 한글이 깨지지 않게
    argv = list(sys.argv[1:] if argv is None else argv)
    if argv and argv[0].startswith("--"):
        argv.insert(0, "serve")          # `game_api.py --dev`는 `serve --dev`와 같다
    if not argv or argv[0] not in COMMANDS:
        sys.exit(__doc__)
    COMMANDS[argv[0]](argv[1:])


if __name__ == "__main__":
    main()
