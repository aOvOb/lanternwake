"""개발 전용 가짜 로그인(/api/dev/login): --dev에서만 켜지고 운영 모드에서는 반드시 꺼져 있다."""
import os
import unittest
from unittest import mock

from support import TestServer
import game_api

PATHS = ("/api/dev/login", "/api/dev/login?name=tester", "/api/dev/login?name=x&a=1", "/api/dev/login/",
         "/api/dev/login?name=../etc")


class DevLoginOffInProduction(unittest.TestCase):
    def setUp(self):
        self.srv = TestServer(dev=False)

    def tearDown(self):
        self.srv.close()

    def test_every_variant_is_404_without_cookie(self):
        c = self.srv.client()
        for path in PATHS:
            r = c.get(path)
            self.assertEqual((r.status, r.json), (404, {"error": "not_found"}), path)
            self.assertEqual(r.all_headers("set-cookie"), [], path)
            self.assertIsNone(r.header("location"), path)
        self.assertEqual(c.get("/api/me").status, 401)

    def test_response_is_identical_to_unknown_path(self):
        c = self.srv.client()
        a, b = c.get("/api/dev/login?name=tester"), c.get("/api/dev/nothing")
        self.assertEqual((a.status, a.body), (b.status, b.body))

    def test_no_user_is_created(self):
        self.srv.client().get("/api/dev/login?name=tester")
        with self.srv.app.db.read() as c:
            self.assertEqual(c.execute("SELECT COUNT(*) FROM users").fetchone()[0], 0)

    def test_environment_cannot_turn_it_on(self):
        for key in ("DEV", "LW_DEV", "DEBUG", "PUBLIC_ORIGIN"):
            with mock.patch.dict(os.environ, {key: "1" if key != "PUBLIC_ORIGIN" else "http://localhost:8080"}):
                self.assertFalse(game_api.config_from_env().dev, key)

    def test_serve_without_client_id_exits_in_production(self):
        cfg = game_api.Config(dev=False)
        with self.assertRaises(SystemExit):
            game_api.ensure_client_id(cfg)


class DevLoginOnInDev(unittest.TestCase):
    def setUp(self):
        self.srv = TestServer(dev=True)

    def tearDown(self):
        self.srv.close()

    def test_login_sets_session_and_me_works(self):
        c = self.srv.client()
        r = c.get("/api/dev/login?name=tester")
        self.assertEqual((r.status, r.header("location")), (303, "/?login=ok"))
        self.assertTrue(any(v.startswith("lw_s=") for v in r.all_headers("set-cookie")))
        me = c.get("/api/me")
        self.assertEqual(me.status, 200)
        self.assertFalse(me.json["user"]["nicknameSet"])

    def test_same_name_same_user_different_name_different_user(self):
        a, b, a2 = self.srv.client(), self.srv.client(), self.srv.client()
        for c, n in ((a, "one"), (b, "two"), (a2, "one")):
            c.get("/api/dev/login?name=" + n)
        ids = [c.get("/api/me").json["user"]["id"] for c in (a, b, a2)]
        self.assertEqual(ids[0], ids[2])
        self.assertNotEqual(ids[0], ids[1])

    def test_default_name_and_bad_names(self):
        c = self.srv.client()
        self.assertEqual(c.get("/api/dev/login").status, 303)
        for bad in ("", "a%20b", "x" * 33, "..%2Fx", "%ED%95%9C%EA%B8%80"):
            self.assertEqual(self.srv.client().get("/api/dev/login?name=" + bad).status, 400, bad)

    def test_not_limited_by_new_account_bucket(self):
        c = self.srv.client(ip="10.9.9.9")
        for i in range(8):
            self.assertEqual(c.get("/api/dev/login?name=u%d" % i).status, 303)

    def test_dev_server_starts_without_client_id(self):
        cfg = game_api.Config(dev=True)
        game_api.ensure_client_id(cfg)
        self.assertEqual(cfg.client_id, game_api.DEV_CLIENT_ID)


class MainShorthand(unittest.TestCase):
    def test_dev_flag_first_means_serve(self):
        calls = []
        with mock.patch.dict(game_api.COMMANDS, {"serve": lambda a: calls.append(a)}):
            game_api.main(["--dev", "--port", "9"])
        self.assertEqual(calls, [["--dev", "--port", "9"]])


if __name__ == "__main__":
    unittest.main()
