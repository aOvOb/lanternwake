"""S17: 로그인 콜백, 세션 쿠키, 로그아웃, 계정 삭제."""
import hashlib
import hmac
import json
import os
import re
import unittest
import urllib.parse

from support import CLIENT_ID, KEYS, TestServer, b64u, id_claims, make_jwt
import game_api

K1, K2 = KEYS


def location_query(resp):
    loc = resp.header("location")
    return urllib.parse.parse_qs(urllib.parse.urlparse(loc).query)


class AuthApiTest(unittest.TestCase):
    def setUp(self):
        self.srv = TestServer()
        self.c = self.srv.client()

    def tearDown(self):
        self.srv.close()

    def db(self, sql, args=()):
        with self.srv.app.db.read() as c:
            return [tuple(r) for r in c.execute(sql, args).fetchall()]

    # -- /api/auth/start
    def test_start_redirects_to_google_with_expected_params(self):
        r = self.c.get("/api/auth/start")
        self.assertEqual(r.status, 302)
        loc = r.header("location")
        self.assertTrue(loc.startswith("https://accounts.google.com/o/oauth2/v2/auth?"))
        q = location_query(r)
        one = {k: v[0] for k, v in q.items()}
        self.assertEqual(one["client_id"], CLIENT_ID)
        self.assertEqual(one["redirect_uri"], self.srv.origin + "/api/auth/callback")
        self.assertEqual(one["response_type"], "id_token")
        self.assertEqual(one["response_mode"], "form_post")
        self.assertEqual(one["scope"], "openid")
        self.assertEqual(one["prompt"], "select_account")
        self.assertEqual(one["nonce"], hashlib.sha256(one["state"].encode()).hexdigest())
        self.assertEqual(len(one["state"]), 43)       # 32바이트의 base64url
        self.assertEqual(set(one), {"client_id", "redirect_uri", "response_type", "response_mode",
                                    "scope", "state", "nonce", "prompt"})

    def test_start_sets_login_cookie_with_same_value_as_state(self):
        r = self.c.get("/api/auth/start")
        sc = r.all_headers("set-cookie")
        self.assertEqual(len(sc), 1)
        state = location_query(r)["state"][0]
        self.assertEqual(sc[0], "__Host-lw_login=%s; Path=/; Max-Age=600; HttpOnly; Secure; SameSite=None" % state)
        self.assertNotIn("Domain", sc[0])

    def test_each_start_has_new_state(self):
        a = location_query(self.c.get("/api/auth/start"))["state"][0]
        b = location_query(self.c.get("/api/auth/start"))["state"][0]
        self.assertNotEqual(a, b)

    # -- 콜백 성공
    def test_callback_success_sets_session_and_clears_login_cookie(self):
        r = self.srv.login(self.c)
        self.assertEqual(r.status, 303)
        self.assertEqual(r.header("location"), "/?login=ok")
        sc = r.all_headers("set-cookie")
        self.assertEqual(len(sc), 2)
        self.assertEqual(sc[0], "__Host-lw_login=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=None")
        self.assertTrue(re.fullmatch(r"__Host-lw_s=[A-Za-z0-9_-]{43}; Path=/; Max-Age=15552000; "
                                     r"HttpOnly; Secure; SameSite=Lax", sc[1]), sc[1])
        self.assertIn("__Host-lw_s", self.c.jar)
        self.assertNotIn("__Host-lw_login", self.c.jar)
        self.assertEqual(r.header("cache-control"), "no-store")

    def test_callback_does_not_need_same_origin(self):
        """구글에서 오는 POST라 Origin이 구글이거나 null이다. 상태 쿠키로 보호한다."""
        r = self.c.get("/api/auth/start")
        q = location_query(r)
        token = make_jwt(K1, id_claims(self.srv.clock(), q["nonce"][0]))
        for origin in ("https://accounts.google.com", "null", False):
            self.c.jar["__Host-lw_login"] = q["state"][0]
            resp = self.c.request(
                "POST", "/api/auth/callback", origin=origin, ctype="application/x-www-form-urlencoded",
                raw_body=urllib.parse.urlencode({"id_token": token, "state": q["state"][0]}).encode())
            self.assertEqual(resp.header("location"), "/?login=ok", origin)

    def test_me_after_login(self):
        self.srv.login_ok(self.c)
        r = self.c.get("/api/me")
        self.assertEqual(r.status, 200)
        j = r.json
        self.assertTrue(re.fullmatch(r"등불지기\d{4}", j["user"]["nickname"]))
        self.assertFalse(j["user"]["nicknameSet"])
        self.assertEqual(j["records"], {"bestTimeMs": 0, "bestKills": 0, "bestLevel": 0, "wins": 0,
                                        "runs": 0, "fullDawns": 0})
        self.assertEqual(j["settings"], {"sound": True, "vibrate": True, "dmgNumbers": True})
        self.assertEqual(j["settingsRev"], 0)
        self.assertFalse(j["imported"])
        self.assertEqual(r.header("cache-control"), "no-store")

    def test_same_sub_same_user_other_sub_other_user(self):
        self.srv.login_ok(self.c, sub="same")
        id1 = self.c.get("/api/me").json["user"]["id"]
        c2 = self.srv.client()
        self.srv.login_ok(c2, sub="same")
        self.assertEqual(c2.get("/api/me").json["user"]["id"], id1)
        c3 = self.srv.client()
        self.srv.login_ok(c3, sub="other")
        self.assertNotEqual(c3.get("/api/me").json["user"]["id"], id1)
        self.assertEqual(self.db("SELECT COUNT(*) FROM users"), [(2,)])
        self.assertEqual(self.db("SELECT COUNT(*) FROM sessions"), [(3,)])
        self.assertEqual(self.db("SELECT COUNT(*) FROM records"), [(2,)])

    def test_db_has_no_email_name_or_plain_sub(self):
        self.srv.login_ok(self.c, sub="plain-sub-value-123")
        cols = [r[1] for r in self.db("PRAGMA table_info(users)")]
        self.assertEqual(cols, ["id", "sub_hash", "nickname", "nickname_key", "nickname_set",
                                "nickname_changed_at", "imported", "banned", "created_at", "last_seen_at"])
        for table in ("users", "sessions", "records", "settings", "tickets", "runs", "best"):
            for row in self.db("SELECT * FROM " + table):
                self.assertNotIn("plain-sub-value-123", repr(row))
        pepper_path = os.path.join(self.srv.cfg.data, "pepper")
        with open(pepper_path, "rb") as f:
            pepper = f.read()
        self.assertEqual(len(pepper), 32)
        expect = hmac.new(pepper, b"plain-sub-value-123", hashlib.sha256).hexdigest()
        self.assertEqual(self.db("SELECT sub_hash FROM users"), [(expect,)])

    def test_session_token_is_stored_only_as_hash(self):
        self.srv.login_ok(self.c)
        token = self.c.jar["__Host-lw_s"]
        self.assertEqual(self.db("SELECT token_hash FROM sessions"),
                         [(hashlib.sha256(token.encode()).hexdigest(),)])

    def test_pepper_is_reused_across_restarts(self):
        p1 = self.srv.app.pepper
        self.assertEqual(game_api.load_pepper(self.srv.cfg.data), p1)

    def test_jwks_is_cached_between_logins(self):
        self.srv.login_ok(self.c, sub="a")
        self.srv.login_ok(self.srv.client(), sub="b")
        self.assertEqual(self.srv.jwks.calls, 1)

    # -- 콜백 거부
    def assert_fail(self, resp, reason):
        self.assertEqual(resp.status, 303)
        self.assertEqual(resp.header("location"), "/?login=fail&r=" + reason)
        self.assertNotIn("__Host-lw_s", self.c.jar)
        self.assertEqual(self.db("SELECT COUNT(*) FROM users"), [(0,)])
        self.assertEqual(self.db("SELECT COUNT(*) FROM sessions"), [(0,)])

    def test_no_login_cookie_is_rejected(self):
        r = self.c.get("/api/auth/start")
        q = location_query(r)
        self.c.jar.clear()
        token = make_jwt(K1, id_claims(self.srv.clock(), q["nonce"][0]))
        resp = self.c.request("POST", "/api/auth/callback", origin=False, ctype="application/x-www-form-urlencoded",
                              raw_body=urllib.parse.urlencode({"id_token": token, "state": q["state"][0]}).encode())
        self.assert_fail(resp, "state")

    def test_state_mismatch_is_rejected(self):
        self.assert_fail(self.srv.login(self.c, state="x" * 43), "state")

    def test_empty_state_is_rejected(self):
        self.assert_fail(self.srv.login(self.c, state=""), "state")

    def test_state_missing_from_form_is_rejected(self):
        self.c.get("/api/auth/start")
        resp = self.c.request("POST", "/api/auth/callback", origin=False, ctype="application/x-www-form-urlencoded",
                              raw_body=b"id_token=abc")
        self.assert_fail(resp, "state")

    def test_wrong_content_type_is_rejected(self):
        self.c.get("/api/auth/start")
        resp = self.c.request("POST", "/api/auth/callback", origin=False, raw_body=b"{}")
        self.assert_fail(resp, "state")

    def test_failure_clears_login_cookie(self):
        r = self.srv.login(self.c, state="nope")
        self.assertEqual(r.all_headers("set-cookie"),
                         ["__Host-lw_login=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=None"])
        self.assertNotIn("__Host-lw_login", self.c.jar)

    def test_forged_signature_is_rejected(self):
        r = self.c.get("/api/auth/start")
        q = location_query(r)
        h, p, s = make_jwt(K1, id_claims(self.srv.clock(), q["nonce"][0])).split(".")
        sig = bytearray(K1.sign((h + "." + p).encode()))
        sig[5] ^= 0x10
        self.assert_fail(self.srv.login(self.c, token=h + "." + p + "." + b64u(bytes(sig))), "token")

    def test_signature_by_unknown_key_is_rejected(self):
        self.srv.jwks.keys = [K2]
        self.assert_fail(self.srv.login(self.c, key=K1), "token")

    def test_alg_none_is_rejected(self):
        t = make_jwt(K1, id_claims(self.srv.clock(), "n"), header={"alg": "none", "kid": K1.kid}, signature=b"")
        self.assert_fail(self.srv.login(self.c, token=t), "token")

    def test_alg_hs256_is_rejected(self):
        payload = id_claims(self.srv.clock(), "n")
        seg = b64u(json.dumps({"alg": "HS256", "kid": K1.kid}).encode()) + "." + b64u(json.dumps(payload).encode())
        sig = hmac.new(K1.n.to_bytes(K1.size, "big"), seg.encode(), hashlib.sha256).digest()
        self.assert_fail(self.srv.login(self.c, token=seg + "." + b64u(sig)), "token")

    def test_aud_mismatch_is_rejected(self):
        self.assert_fail(self.srv.login(self.c, claims={"aud": "other", "azp": None}), "aud")

    def test_iss_mismatch_is_rejected(self):
        self.assert_fail(self.srv.login(self.c, claims={"iss": "https://evil.example"}), "token")

    def test_expired_token_is_rejected(self):
        now = int(self.srv.clock())
        self.assert_fail(self.srv.login(self.c, claims={"exp": now - 300}), "exp")

    def test_nonce_mismatch_is_rejected(self):
        self.assert_fail(self.srv.login(self.c, nonce="not-the-nonce"), "nonce")

    def test_token_for_other_login_attempt_is_rejected(self):
        """다른 로그인 시도(다른 state)의 nonce로 만든 토큰을 끼워 넣는 재사용."""
        other = location_query(self.c.get("/api/auth/start"))
        self.assert_fail(self.srv.login(self.c, nonce=other["nonce"][0]), "nonce")

    def test_google_error_is_rejected(self):
        self.c.get("/api/auth/start")
        state = self.c.jar["__Host-lw_login"]
        resp = self.c.request("POST", "/api/auth/callback", origin=False, ctype="application/x-www-form-urlencoded",
                              raw_body=urllib.parse.urlencode({"error": "access_denied", "state": state}).encode())
        self.assert_fail(resp, "google")

    def test_missing_id_token_is_rejected(self):
        self.assert_fail(self.srv.login(self.c, token=""), "token")

    def test_replayed_callback_is_rejected(self):
        r = self.c.get("/api/auth/start")
        q = location_query(r)
        state = q["state"][0]
        body = urllib.parse.urlencode(
            {"id_token": make_jwt(K1, id_claims(self.srv.clock(), q["nonce"][0])), "state": state}).encode()
        first = self.c.request("POST", "/api/auth/callback", origin=False,
                               ctype="application/x-www-form-urlencoded", raw_body=body)
        self.assertEqual(first.header("location"), "/?login=ok")
        again = self.c.request("POST", "/api/auth/callback", origin=False,
                               ctype="application/x-www-form-urlencoded", raw_body=body)
        self.assertEqual(again.header("location"), "/?login=fail&r=state")

    def test_open_redirect_is_impossible(self):
        r = self.srv.login(self.c, extra_form={"redirect": "https://evil.example", "next": "//evil.example"})
        self.assertEqual(r.header("location"), "/?login=ok")

    # -- 세션
    def test_me_requires_session(self):
        r = self.c.get("/api/me")
        self.assertEqual((r.status, r.json), (401, {"error": "no_session"}))

    def test_garbage_session_cookie_is_401(self):
        self.c.jar["__Host-lw_s"] = "garbage"
        self.assertEqual(self.c.get("/api/me").status, 401)
        self.c.jar["__Host-lw_s"] = "x" * 500
        self.assertEqual(self.c.get("/api/me").status, 401)

    def test_expired_session_is_401(self):
        self.srv.login_ok(self.c)
        self.srv.clock.advance(181 * 86400)
        self.assertEqual(self.c.get("/api/me").status, 401)

    def test_session_extends_after_a_day(self):
        self.srv.login_ok(self.c)
        r = self.c.get("/api/me")
        self.assertEqual(r.all_headers("set-cookie"), [])      # 하루 안에는 갱신하지 않는다
        before = self.db("SELECT expires_at FROM sessions")[0][0]
        self.srv.clock.advance(2 * 86400)
        r = self.c.get("/api/me")
        self.assertEqual(r.status, 200)
        sc = r.all_headers("set-cookie")
        self.assertEqual(len(sc), 1)
        self.assertIn("Max-Age=15552000", sc[0])
        self.assertIn("__Host-lw_s=" + self.c.jar["__Host-lw_s"], sc[0])
        after = self.db("SELECT expires_at FROM sessions")[0][0]
        self.assertGreaterEqual(after - before, 2 * 86400 - 2)

    def test_session_alive_at_day_179_if_used_regularly(self):
        self.srv.login_ok(self.c)
        for _ in range(4):
            self.srv.clock.advance(100 * 86400)
            self.assertEqual(self.c.get("/api/me").status, 200)

    def test_banned_user_gets_403(self):
        self.srv.login_ok(self.c)
        with self.srv.app.db.tx() as c:
            c.execute("UPDATE users SET banned=1")
        r = self.c.get("/api/me")
        self.assertEqual((r.status, r.json), (403, {"error": "banned"}))

    # -- 로그아웃
    def test_logout(self):
        self.srv.login_ok(self.c)
        old = self.c.jar["__Host-lw_s"]
        r = self.c.post("/api/auth/logout")
        self.assertEqual((r.status, r.json), (200, {"ok": True}))
        self.assertEqual(r.all_headers("set-cookie"), ["__Host-lw_s=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax"])
        self.assertEqual(self.db("SELECT COUNT(*) FROM sessions"), [(0,)])
        self.c.jar["__Host-lw_s"] = old                        # 훔친 쿠키를 다시 쓰는 경우
        self.assertEqual(self.c.get("/api/me").status, 401)

    def test_logout_needs_origin_and_session(self):
        self.srv.login_ok(self.c)
        self.assertEqual(self.c.post("/api/auth/logout", origin=False).status, 403)
        self.assertEqual(self.db("SELECT COUNT(*) FROM sessions"), [(1,)])
        self.assertEqual(self.srv.client().post("/api/auth/logout").status, 401)

    def test_logout_of_one_device_keeps_the_other(self):
        self.srv.login_ok(self.c, sub="u")
        c2 = self.srv.client()
        self.srv.login_ok(c2, sub="u")
        self.c.post("/api/auth/logout")
        self.assertEqual(c2.get("/api/me").status, 200)

    def test_logout_after_a_day_does_not_resend_session_cookie(self):
        self.srv.login_ok(self.c)
        self.srv.clock.advance(2 * 86400)
        r = self.c.post("/api/auth/logout")
        self.assertEqual(len(r.all_headers("set-cookie")), 1)
        self.assertIn("Max-Age=0", r.all_headers("set-cookie")[0])

    # -- 계정 삭제
    def test_delete_account_removes_every_related_row(self):
        self.srv.login_ok(self.c, sub="del")
        uid = self.c.get("/api/me").json["user"]["id"]
        n = self.srv.app.now()
        with self.srv.app.db.tx() as c:
            c.execute("INSERT INTO settings VALUES(?, '{}', 1, ?)", (uid, n))
            c.execute("INSERT INTO tickets VALUES('tk', ?, ?, ?, NULL)", (uid, n, n + 100))
            cur = c.execute("INSERT INTO runs(user_id,client_run_id,ver,time_ms,kills,level,won,full_dawn,elites,"
                            "bosses,detail,status,submitted_at) VALUES(?,'r','1.0.0',1,0,1,0,0,0,0,'{}','ranked',?)",
                            (uid, n))
            c.execute("INSERT INTO best VALUES(?, 'time', ?, 1, 0, ?)", (uid, cur.lastrowid, n))
        other = self.srv.client()
        self.srv.login_ok(other, sub="keep")
        r = self.c.delete("/api/me", {"confirm": "DELETE"})
        self.assertEqual((r.status, r.json), (200, {"ok": True}))
        self.assertIn("Max-Age=0", r.all_headers("set-cookie")[0])
        for table in ("users", "sessions", "records", "settings", "tickets", "runs", "best"):
            col = "id" if table == "users" else "user_id"
            self.assertEqual(self.db("SELECT COUNT(*) FROM %s WHERE %s=?" % (table, col), (uid,)), [(0,)], table)
        self.assertEqual(self.db("SELECT COUNT(*) FROM users"), [(1,)])
        self.assertEqual(other.get("/api/me").status, 200)
        self.assertEqual(self.c.get("/api/me").status, 401)

    def test_delete_account_requires_confirm(self):
        self.srv.login_ok(self.c)
        for body in ({}, {"confirm": "delete"}, {"confirm": True}, {"confirm": ""}):
            self.assertEqual(self.c.delete("/api/me", body).status, 400, body)
        self.assertEqual(self.c.delete("/api/me", raw_body=b"not json").status, 400)
        self.assertEqual(self.c.delete("/api/me", raw_body=b"[1]").status, 400)
        self.assertEqual(self.c.get("/api/me").status, 200)

    def test_delete_account_needs_origin(self):
        self.srv.login_ok(self.c)
        self.assertEqual(self.c.delete("/api/me", {"confirm": "DELETE"}, origin=False).status, 403)
        self.assertEqual(self.c.get("/api/me").status, 200)

    def test_login_after_delete_creates_fresh_account(self):
        self.srv.login_ok(self.c, sub="again")
        old = self.c.get("/api/me").json["user"]["id"]
        self.c.delete("/api/me", {"confirm": "DELETE"})
        self.srv.login_ok(self.c, sub="again")
        self.assertEqual(self.c.get("/api/me").status, 200)
        self.assertEqual(self.db("SELECT COUNT(*) FROM users"), [(1,)])
        self.assertIsNotNone(old)

    # -- 요청 제한
    def test_auth_endpoints_are_limited_to_10_per_minute_per_ip(self):
        self.srv.app.clock = lambda: 5000.0
        codes = [self.c.get("/api/auth/start").status for _ in range(11)]
        self.assertEqual(codes, [302] * 10 + [429])

    def test_callback_rate_limit_redirects_with_reason(self):
        self.srv.app.clock = lambda: 5000.0
        for _ in range(10):
            self.c.get("/api/auth/start")
        resp = self.c.request("POST", "/api/auth/callback", origin=False,
                              ctype="application/x-www-form-urlencoded", raw_body=b"state=a")
        self.assertEqual((resp.status, resp.header("location")), (303, "/?login=fail&r=rate"))

    def test_new_accounts_limited_to_5_per_day_per_ip(self):
        for i in range(5):
            self.srv.clock.advance(61)            # 인증 요청 제한(분당 10)을 피한다
            self.srv.login_ok(self.c, sub="new-%d" % i)
        self.srv.clock.advance(61)
        self.assert_rate_failed(self.srv.login(self.c, sub="new-6"))
        self.assertEqual(self.db("SELECT COUNT(*) FROM users"), [(5,)])
        # 기존 계정은 계속 로그인된다
        self.srv.clock.advance(61)
        self.srv.login_ok(self.c, sub="new-0")
        # 다른 IP는 영향 없음
        self.srv.login_ok(self.srv.client(), sub="new-7")

    def assert_rate_failed(self, resp):
        self.assertEqual((resp.status, resp.header("location")), (303, "/?login=fail&r=rate"))


class DevModeTest(unittest.TestCase):
    def test_dev_cookie_names_and_attributes(self):
        srv = TestServer(dev=True)
        try:
            c = srv.client()
            r = c.get("/api/auth/start")
            self.assertEqual(len(r.all_headers("set-cookie")), 1)
            sc = r.all_headers("set-cookie")[0]
            self.assertTrue(sc.startswith("lw_login="))
            self.assertNotIn("Secure", sc)
            self.assertNotIn("SameSite", sc)
            srv.login_ok(c)
            self.assertIn("lw_s", c.jar)
            self.assertEqual(c.get("/api/me").status, 200)
        finally:
            srv.close()


if __name__ == "__main__":
    unittest.main()
