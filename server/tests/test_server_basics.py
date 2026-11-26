"""S16: 서버 뼈대, DB, 공통 처리, 요청 제한, 정리 작업."""
import os
import sqlite3
import tempfile
import unittest

from support import TestServer, raw_request
import game_api


class BasicsTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.srv = TestServer()

    @classmethod
    def tearDownClass(cls):
        cls.srv.close()

    def setUp(self):
        self.c = self.srv.client()

    def test_health(self):
        r = self.c.get("/api/health")
        self.assertEqual(r.status, 200)
        self.assertEqual(r.json, {"ok": True, "version": game_api.VERSION})
        self.assertEqual(r.header("cache-control"), "no-store")
        self.assertEqual(r.header("content-type"), "application/json; charset=utf-8")

    def test_unknown_route_and_method(self):
        r = self.c.get("/api/nope")
        self.assertEqual((r.status, r.json), (404, {"error": "not_found"}))
        r = self.c.post("/api/health")
        self.assertEqual(r.status, 405)

    def test_no_cors_headers(self):
        r = self.c.get("/api/health", headers={"Origin": "https://evil.example"})
        self.assertIsNone(r.header("access-control-allow-origin"))
        r = self.c.request("OPTIONS", "/api/health")
        self.assertEqual(r.status, 405)
        self.assertIsNone(r.header("access-control-allow-origin"))

    def test_post_without_origin_is_403(self):
        r = self.c.post("/api/anything", origin=False)
        self.assertEqual((r.status, r.json), (403, {"error": "forbidden"}))

    def test_post_with_other_origin_is_403(self):
        for o in ("https://evil.example", "null", self.srv.origin + ".evil.example", self.srv.origin + "/"):
            r = self.c.post("/api/anything", origin=o)
            self.assertEqual(r.status, 403, o)

    def test_put_and_delete_also_need_origin(self):
        self.assertEqual(self.c.put("/api/anything", origin=False).status, 403)
        self.assertEqual(self.c.delete("/api/anything", origin=False).status, 403)

    def test_correct_origin_reaches_router(self):
        self.assertEqual(self.c.post("/api/anything").status, 404)

    def test_body_over_32kb_is_413(self):
        body = b'{"a":"' + b"x" * (33 * 1024) + b'"}'
        r = self.c.post("/api/anything", raw_body=body)
        self.assertEqual((r.status, r.json), (413, {"error": "too_large"}))

    def test_body_32kb_is_accepted(self):
        body = b" " * (32 * 1024)
        r = self.c.post("/api/anything", raw_body=body)
        self.assertEqual(r.status, 404)

    def test_chunked_is_411(self):
        text = ("POST /api/anything HTTP/1.1\r\nHost: x\r\nOrigin: %s\r\n"
                "Content-Type: application/json\r\nTransfer-Encoding: chunked\r\n\r\n"
                "2\r\n{}\r\n0\r\n\r\n") % self.srv.origin
        status, _ = raw_request(self.srv.port, text)
        self.assertEqual(status, 411)

    def test_missing_content_length_is_411(self):
        text = ("POST /api/anything HTTP/1.1\r\nHost: x\r\nOrigin: %s\r\n"
                "Content-Type: application/json\r\n\r\n") % self.srv.origin
        status, _ = raw_request(self.srv.port, text)
        self.assertEqual(status, 411)

    def test_non_json_content_type_is_400(self):
        r = self.c.post("/api/anything", raw_body=b"a=b", ctype="text/plain")
        self.assertEqual((r.status, r.json), (400, {"error": "bad_request"}))
        r = self.c.post("/api/anything", raw_body=b"{}", ctype="application/json; charset=utf-8")
        self.assertEqual(r.status, 404)


class RateLimitTest(unittest.TestCase):
    def setUp(self):
        self.srv = TestServer()
        self.c = self.srv.client()

    def tearDown(self):
        self.srv.close()

    def test_121st_request_in_a_minute_is_429(self):
        # 시계를 멈춰 두고 센다(오프셋만 쓰므로 실제 시간이 조금 흘러도 한도는 120이다)
        self.srv.app.clock = lambda: 1000.0
        for i in range(120):
            self.assertEqual(self.c.get("/api/health").status, 200, i)
        r = self.c.get("/api/health")
        self.assertEqual(r.status, 429)
        self.assertEqual(r.json, {"error": "rate_limited"})
        self.assertTrue(int(r.header("retry-after")) >= 1)

    def test_x_real_ip_is_used_for_limits(self):
        self.srv.app.clock = lambda: 1000.0
        a = self.srv.client("10.9.9.1")
        for _ in range(120):
            self.assertEqual(a.get("/api/health").status, 200)
        self.assertEqual(a.get("/api/health").status, 429)
        b = self.srv.client("10.9.9.2")
        self.assertEqual(b.get("/api/health").status, 200)

    def test_bucket_refills_over_time(self):
        t = [1000.0]
        self.srv.app.clock = lambda: t[0]
        for _ in range(120):
            self.c.get("/api/health")
        self.assertEqual(self.c.get("/api/health").status, 429)
        t[0] += 1.0     # 초당 2개 채움
        self.assertEqual(self.c.get("/api/health").status, 200)
        self.assertEqual(self.c.get("/api/health").status, 200)
        self.assertEqual(self.c.get("/api/health").status, 429)

    def test_auth_prefix_limit_is_10_per_minute(self):
        self.srv.app.clock = lambda: 1000.0
        codes = [self.c.get("/api/auth/unknown").status for _ in range(11)]
        self.assertEqual(codes[:10], [404] * 10)
        self.assertEqual(codes[10], 429)

    def test_leaderboard_limit_is_30_per_minute(self):
        self.srv.app.clock = lambda: 1000.0
        codes = [self.c.get("/api/leaderboard").status for _ in range(31)]
        self.assertEqual(codes[30], 429)
        self.assertNotIn(429, codes[:30])

    def test_purge_removes_full_buckets(self):
        t = [1000.0]
        self.srv.app.clock = lambda: t[0]
        self.c.get("/api/health")
        self.assertEqual(len(self.srv.app.buckets.items), 1)
        self.srv.app.buckets.purge()
        self.assertEqual(len(self.srv.app.buckets.items), 1)   # 아직 덜 찼다
        t[0] += 60
        self.srv.app.buckets.purge()
        self.assertEqual(len(self.srv.app.buckets.items), 0)


class DbTest(unittest.TestCase):
    def test_schema_and_user_version(self):
        with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as d:
            app = game_api.App(game_api.Config(data=d, client_id="x"))
            try:
                self.assertEqual(app.db.version, len(game_api.MIGRATIONS))
                with app.db.read() as c:
                    names = {r[0] for r in c.execute("SELECT name FROM sqlite_master WHERE type='table'")}
                    self.assertTrue({"users", "sessions", "settings", "records", "tickets", "runs", "best"} <= names)
                    self.assertEqual(c.execute("PRAGMA foreign_keys").fetchone()[0], 1)
                    self.assertEqual(c.execute("PRAGMA journal_mode").fetchone()[0], "wal")
            finally:
                app.close()
            # 다시 열어도 버전이 그대로이고 오류가 없다
            app = game_api.App(game_api.Config(data=d, client_id="x"))
            self.assertEqual(app.db.version, len(game_api.MIGRATIONS))
            app.close()

    def test_cleanup_removes_expired_rows(self):
        with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as d:
            now = [10_000_000.0]
            app = game_api.App(game_api.Config(data=d, client_id="x"), clock=lambda: now[0])
            try:
                n = app.now()
                with app.db.tx() as c:
                    c.execute("INSERT INTO users(id,sub_hash,nickname,nickname_key,created_at,last_seen_at)"
                              " VALUES(1,'h','n','n',?,?)", (n, n))
                    c.execute("INSERT INTO sessions VALUES('old',1,?,?,?)", (n, n, n - 1))
                    c.execute("INSERT INTO sessions VALUES('new',1,?,?,?)", (n, n, n + 100))
                    c.execute("INSERT INTO tickets VALUES('t-old',1,?,?,NULL)", (n - 99, n - 1))
                    c.execute("INSERT INTO tickets VALUES('t-new',1,?,?,NULL)", (n, n + 100))
                    for rid, status, age in (("r1", "rejected", 31), ("r2", "rejected", 29), ("r3", "unranked", 99)):
                        c.execute("INSERT INTO runs(user_id,client_run_id,ver,time_ms,kills,level,won,full_dawn,"
                                  "elites,bosses,detail,status,submitted_at) VALUES(1,?,?,1,0,1,0,0,0,0,'{}',?,?)",
                                  (rid, "1.0.0", status, n - age * 86400))
                app.cleanup()
                with app.db.read() as c:
                    self.assertEqual([r[0] for r in c.execute("SELECT token_hash FROM sessions")], ["new"])
                    self.assertEqual([r[0] for r in c.execute("SELECT id FROM tickets")], ["t-new"])
                    self.assertEqual(sorted(r[0] for r in c.execute("SELECT client_run_id FROM runs")), ["r2", "r3"])
            finally:
                app.close()


class StaticTest(unittest.TestCase):
    def test_static_serving_and_traversal(self):
        with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as root:
            with open(os.path.join(root, "index.html"), "w", encoding="utf-8") as f:
                f.write("<h1>hi</h1>")
            secret = os.path.join(os.path.dirname(root), "secret-lw-test.txt")
            with open(secret, "w") as f:
                f.write("x")
            srv = TestServer(static=root)
            try:
                c = srv.client()
                r = c.get("/")
                self.assertEqual((r.status, r.body), (200, b"<h1>hi</h1>"))
                self.assertTrue(r.header("content-type").startswith("text/html"))
                self.assertEqual(c.get("/index.html").status, 200)
                self.assertEqual(c.get("/missing.js").status, 404)
                self.assertEqual(c.get("/../secret-lw-test.txt").status, 404)
                self.assertEqual(c.get("/%2e%2e/secret-lw-test.txt").status, 404)
                self.assertEqual(c.get("/api/health").status, 200)
            finally:
                srv.close()
                os.remove(secret)

    def test_no_static_by_default(self):
        srv = TestServer()
        try:
            self.assertEqual(srv.client().get("/").status, 404)
        finally:
            srv.close()


class ConfigTest(unittest.TestCase):
    def test_dev_cookie_names(self):
        self.assertEqual(game_api.Config(dev=True).session_cookie, "lw_s")
        self.assertEqual(game_api.Config().session_cookie, "__Host-lw_s")
        self.assertEqual(game_api.Config().login_cookie, "__Host-lw_login")

    def test_cookie_attributes(self):
        prod = game_api.make_cookie(game_api.Config(), "__Host-lw_s", "v", 5, "Lax")[1]
        self.assertEqual(prod, "__Host-lw_s=v; Path=/; Max-Age=5; HttpOnly; Secure; SameSite=Lax")
        dev = game_api.make_cookie(game_api.Config(dev=True), "lw_s", "v", 5, "Lax")[1]
        self.assertNotIn("Secure", dev)


if __name__ == "__main__":
    unittest.main()
