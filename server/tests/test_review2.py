"""리뷰 2 서버 지적(B2~B5)의 시험: 숫자 검사와 오류 응답, 차단 사용자의 로그아웃과 삭제, 연결 상한과 본문 마감, JWKS 재시도."""
import socket
import time
import unittest

from support import FakeJwks, TestServer, raw_request
import game_api


def raw_bytes(port, data):
    """바이트 원문을 보내고 상태 코드를 돌려준다(헤더에 비ASCII 바이트를 넣는 시험용)."""
    s = socket.create_connection(("127.0.0.1", port), timeout=10)
    try:
        s.sendall(data)
        buf = b""
        while True:
            b = s.recv(65536)
            if not b:
                break
            buf += b
    finally:
        s.close()
    return int(buf.split(b" ", 2)[1]) if buf else 0


class InputErrorTest(unittest.TestCase):
    """B2: 유니코드 숫자와 과다 필드가 빈 응답이 아니라 400을 받는다."""

    @classmethod
    def setUpClass(cls):
        cls.srv = TestServer()

    @classmethod
    def tearDownClass(cls):
        cls.srv.close()

    def setUp(self):
        self.c = self.srv.client()

    def test_is_uint(self):
        self.assertTrue(game_api.is_uint("123"))
        self.assertFalse(game_api.is_uint("²"))          # 위 첨자 2
        self.assertFalse(game_api.is_uint("٣"))          # 아라비아 인도 숫자 3
        self.assertFalse(game_api.is_uint(""))
        self.assertFalse(game_api.is_uint("-1"))
        self.assertFalse(game_api.is_uint("1" * 10))
        self.assertTrue(game_api.is_uint("1" * 10, 12))

    def test_leaderboard_limit_with_superscript_is_400(self):
        r = self.c.get("/api/leaderboard?limit=%C2%B2")
        self.assertEqual((r.status, r.json), (400, {"error": "bad_request"}))

    def test_too_many_query_fields_is_400(self):
        qs = "&".join("a%d=1" % i for i in range(21))
        r = self.c.get("/api/health?" + qs)
        self.assertEqual((r.status, r.json), (400, {"error": "bad_request"}))

    def test_non_ascii_content_length_is_400(self):
        req = (b"POST /api/anything HTTP/1.1\r\nHost: x\r\nOrigin: " + self.srv.origin.encode() +
               b"\r\nContent-Type: application/json\r\nContent-Length: \xb2\r\n\r\n")
        self.assertEqual(raw_bytes(self.srv.port, req), 400)

    def test_max_age_with_unicode_digit_is_ignored(self):
        self.assertIsNone(game_api.parse_max_age("max-age=²"))
        self.assertEqual(game_api.parse_max_age("max-age=60"), 60)


class BannedSelfServiceTest(unittest.TestCase):
    """B3: 차단된 사용자도 로그아웃과 계정 삭제는 할 수 있다. 나머지 API는 계속 403이다."""

    def setUp(self):
        self.srv = TestServer()
        self.c = self.srv.client()
        self.srv.login_ok(self.c)
        with self.srv.app.db.tx() as c:
            c.execute("UPDATE users SET banned=1")

    def tearDown(self):
        self.srv.close()

    def test_other_apis_still_banned(self):
        self.assertEqual((self.c.get("/api/me").status, self.c.get("/api/me").json), (403, {"error": "banned"}))
        self.assertEqual(self.c.put("/api/me/nickname", {"nickname": "abcd"}).status, 403)

    def test_banned_user_can_logout(self):
        r = self.c.post("/api/auth/logout")
        self.assertEqual((r.status, r.json), (200, {"ok": True}))
        self.assertEqual(self.c.get("/api/me").status, 401)

    def test_banned_user_can_delete_account(self):
        r = self.c.delete("/api/me", {"confirm": "DELETE"})
        self.assertEqual(r.status, 200)
        with self.srv.app.db.read() as c:
            self.assertEqual(c.execute("SELECT COUNT(*) FROM users").fetchone()[0], 0)

    def test_delete_still_needs_confirm(self):
        self.assertEqual(self.c.delete("/api/me", {"confirm": "no"}).status, 400)


class ConnectionLimitTest(unittest.TestCase):
    """B4: 동시 연결 상한과 본문 전체 마감."""

    def setUp(self):
        self.old = (game_api.MAX_CONNS, game_api.BODY_DEADLINE)

    def tearDown(self):
        game_api.MAX_CONNS, game_api.BODY_DEADLINE = self.old

    def test_over_limit_gets_503_and_slot_is_released(self):
        game_api.MAX_CONNS = 2
        srv = TestServer()
        idle = []
        try:
            for _ in range(2):                                   # 요청을 보내지 않고 연결만 잡는다
                idle.append(socket.create_connection(("127.0.0.1", srv.port), timeout=5))
            time.sleep(0.3)
            status, _ = raw_request(srv.port, "GET /api/health HTTP/1.0\r\n\r\n")
            self.assertEqual(status, 503)
            for s in idle:
                s.close()
            idle = []
            time.sleep(0.5)                                      # 연결이 닫히면 칸이 돌아온다
            status, _ = raw_request(srv.port, "GET /api/health HTTP/1.0\r\n\r\n")
            self.assertEqual(status, 200)
        finally:
            for s in idle:
                s.close()
            srv.close()

    def test_slow_body_hits_overall_deadline(self):
        game_api.BODY_DEADLINE = 0.6
        srv = TestServer()
        try:
            s = socket.create_connection(("127.0.0.1", srv.port), timeout=10)
            s.sendall(("POST /api/anything HTTP/1.1\r\nHost: x\r\nOrigin: %s\r\nContent-Type: application/json\r\n"
                       "Content-Length: 100\r\n\r\n" % srv.origin).encode())
            t0 = time.monotonic()
            buf = b""
            try:
                while True:                                      # 0.25초마다 1바이트씩 흘린다
                    s.sendall(b" ")
                    s.settimeout(0.25)
                    try:
                        b = s.recv(4096)
                        if not b:
                            break
                        buf += b
                    except socket.timeout:
                        pass
                    if buf or time.monotonic() - t0 > 5:
                        break
            except OSError:
                pass
            s.close()
            self.assertTrue(buf.startswith(b"HTTP/1.0 408"), buf[:60])
            self.assertLess(time.monotonic() - t0, 3)
        finally:
            srv.close()


class JwksEmptyRetryTest(unittest.TestCase):
    """B5: 키가 하나도 없을 때는 30초 뒤에 다시 받는다."""

    def test_empty_cache_retries_after_30_seconds(self):
        jwks = FakeJwks()
        jwks.fail = True
        srv = TestServer(jwks=jwks)
        try:
            c = srv.client()
            r = srv.login(c)
            self.assertNotEqual(r.header("location"), "/?login=ok")      # 받기에 실패해 로그인 실패
            calls = jwks.calls
            srv.clock.advance(10)
            srv.login(srv.client())
            self.assertEqual(jwks.calls, calls)                          # 30초 전에는 다시 받지 않는다
            srv.clock.advance(25)
            jwks.fail = False
            srv.login_ok(srv.client())                                   # 35초 뒤에는 받아서 성공
            self.assertGreater(jwks.calls, calls)
        finally:
            srv.close()


if __name__ == "__main__":
    unittest.main()
