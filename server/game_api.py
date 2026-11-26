#!/usr/bin/env python3
"""Lanternwake 계정 서버. 파이썬 표준 라이브러리와 SQLite만 쓴다.

설계는 DESIGN-ACCOUNT.md를 따른다.
  serve [--dev] [--static <폴더>] [--host H] [--port N]
  stats | suspects | hide <runId> | unhide <runId> | ban <userId> | unban <userId>
  rename <userId> <닉네임> | rebuild-best
환경 변수: GOOGLE_CLIENT_ID(serve 필수), PUBLIC_ORIGIN, DATA, BOUNDS
"""
import json
import math
import mimetypes
import os
import sqlite3
import sys
import threading
import time
import urllib.parse
from contextlib import contextmanager
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

VERSION = "1.0.0"
DEFAULT_ORIGIN = "https://game.aovob7.duckdns.org"
HERE = os.path.dirname(os.path.abspath(__file__))

MAX_BODY = 32 * 1024
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
    def __init__(self, cfg, clock=time.time):
        self.cfg = cfg
        self.clock = clock
        os.makedirs(cfg.data, exist_ok=True)
        self.db = Db(os.path.join(cfg.data, "game.db"))
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


def route(method, path, login="none", form_post=False):
    def deco(fn):
        ROUTES.setdefault(path, {})[method] = (fn, login)
        if form_post:
            FORM_POST_PATHS.add(path)
        return fn
    return deco


@route("GET", "/api/health")
def h_health(app, req):
    return Resp(200, {"ok": True, "version": VERSION})


WRITE_METHODS = ("POST", "PUT", "DELETE")


def find_session_user(app, req):
    """세션 쿠키로 사용자를 찾는다. S17에서 채운다."""
    return None


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
        if cl.isdigit() and 0 < int(cl) <= DRAIN_MAX and not getattr(self, "body_read", False):
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
        except (OSError, ValueError) as e:
            # 연결 끊김, 시간 초과. 응답할 상대가 없다.
            if not isinstance(e, (ConnectionError, TimeoutError)):
                log_error(e, path)
        except Exception as e:
            log_error(e, path)
            try:
                self.send_resp(Resp(500, {"error": "server_error"}))
            except OSError:
                pass

    def process(self, app, method):
        path, _, qs = self.path.partition("?")
        query = {k: v[0] for k, v in urllib.parse.parse_qs(qs, max_num_fields=20).items()}
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
        fn, login = entry
        if login != "none":
            self.load_user(app, req, login == "required")
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
        if not cl.isdigit() or len(cl) > 9:
            raise ApiError(400, "bad_request")
        n = int(cl)
        if n > MAX_BODY:
            raise ApiError(413, "too_large")
        ctype = self.headers.get("Content-Type", "").split(";")[0].strip().lower()
        if not form_post and n > 0 and ctype != "application/json":
            raise ApiError(400, "bad_request")
        data = self.rfile.read(n) if n else b""
        self.body_read = True
        if len(data) != n:
            raise ApiError(400, "bad_request")
        req.body = data
        req.ctype = ctype

    def load_user(self, app, req, required):
        user = find_session_user(app, req)
        if user is None:
            if required:
                raise ApiError(401, "no_session")
            return
        if required and user["banned"]:
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
        ThreadingHTTPServer.__init__(self, addr, Handler)


def make_server(app, host=None, port=None):
    return Server((host if host is not None else app.cfg.host,
                   app.cfg.port if port is None else port), app)


# ---------------------------------------------------------------- CLI

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
    if not cfg.client_id:
        sys.exit("GOOGLE_CLIENT_ID 환경 변수가 필요합니다.")
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


COMMANDS = {"serve": cmd_serve, "stats": cmd_stats}


def main(argv=None):
    argv = list(sys.argv[1:] if argv is None else argv)
    if not argv or argv[0] not in COMMANDS:
        sys.exit(__doc__)
    COMMANDS[argv[0]](argv[1:])


if __name__ == "__main__":
    main()
