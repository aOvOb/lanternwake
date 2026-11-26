"""S18: 닉네임, 설정 동기화, 게스트 기록 가져오기, 계정 삭제 시 순위표 반영."""
import unicodedata
import unittest

from support import TestServer
from support_runs import Player, make_run
import game_api


class AccountBase(unittest.TestCase):
    def setUp(self):
        self.srv = TestServer()
        self.p = Player(self.srv, "acct")
        self.c = self.p.c

    def tearDown(self):
        self.srv.close()

    def me(self):
        return self.c.get("/api/me").json

    def db(self, sql, args=()):
        with self.srv.app.db.read() as c:
            return [tuple(r) for r in c.execute(sql, args).fetchall()]


class NicknameTest(AccountBase):
    def set(self, name, client=None):
        return (client or self.c).put("/api/me/nickname", {"nickname": name})

    def test_first_set_succeeds_and_marks_nickname_set(self):
        r = self.set("오렌")
        self.assertEqual((r.status, r.json), (200, {"nickname": "오렌"}))
        j = self.me()
        self.assertEqual(j["user"]["nickname"], "오렌")
        self.assertTrue(j["user"]["nicknameSet"])

    def test_valid_names(self):
        for i, name in enumerate(("가나", "Ab", "a_b", "한글English123", "_" * 12, "가" * 12, "0123456789ab")):
            p = Player(self.srv, "v%d" % i)
            self.assertEqual(self.set(name, p.c).status, 200, name)

    def test_invalid_names(self):
        bad = ["", "a", "가", "x" * 13, "가" * 13, "a b", " ab", "ab ", "ab\n", "a-b", "a.b", "a@b", "<b>x</b>",
               "😀😀", "ㅋㅋ", "ㅏㅏㅏ", "漢字", "ａｂ", "a​b", "한 글", "é́", "ab\x00"]
        for name in bad:
            r = self.set(name)
            self.assertEqual((r.status, r.json), (400, {"error": "invalid_nickname"}), repr(name))
        for val in (None, 5, True, ["ab"], {"a": 1}):
            self.assertEqual(self.set(val).status, 400, val)
        self.assertEqual(self.c.put("/api/me/nickname", {}).status, 400)
        self.assertFalse(self.me()["user"]["nicknameSet"])

    def test_reserved_names(self):
        for name in ("관리자", "운영자", "운영진", "admin", "ADMIN", "Admin", "administrator", "system", "root",
                     "Lanternwake", "등불지기", "등불지기1", "등불지기1234", "등불지기000000"):
            r = self.set(name)
            self.assertEqual(r.json, {"error": "invalid_nickname"}, name)

    def test_names_that_only_start_like_reserved_are_fine(self):
        self.assertEqual(self.set("등불지기님").status, 200)

    def test_banned_words(self):
        for name in ("시발", "씨발이", "좋은병신", "FUCK", "xxshitxx", "a개새끼b"):
            self.assertEqual(self.set(name).json, {"error": "invalid_nickname"}, name)

    def test_nfc_normalization(self):
        nfd = unicodedata.normalize("NFD", "한글")
        self.assertNotEqual(nfd, "한글")
        r = self.set(nfd)
        self.assertEqual((r.status, r.json), (200, {"nickname": "한글"}))
        self.assertEqual(self.db("SELECT nickname, nickname_key FROM users"), [("한글", "한글")])

    def test_nfd_and_nfc_are_the_same_name(self):
        self.set("한글")
        other = Player(self.srv, "o")
        r = self.set(unicodedata.normalize("NFD", "한글"), other.c)
        self.assertEqual((r.status, r.json), (409, {"error": "nickname_taken"}))

    def test_taken_is_case_insensitive(self):
        self.set("Oren")
        other = Player(self.srv, "o")
        for name in ("oren", "OREN", "oReN"):
            r = self.set(name, other.c)
            self.assertEqual((r.status, r.json), (409, {"error": "nickname_taken"}), name)
        self.assertFalse(other.c.get("/api/me").json["user"]["nicknameSet"])

    def test_case_keeps_display_form(self):
        self.set("OwlKing")
        self.assertEqual(self.me()["user"]["nickname"], "OwlKing")
        self.assertEqual(self.db("SELECT nickname_key FROM users WHERE id=?", (self.p.id,)), [("owlking",)])

    def test_cooldown_24_hours_after_first_set(self):
        self.assertEqual(self.set("첫이름").status, 200)         # 첫 설정은 예외
        r = self.set("둘째이름")
        self.assertEqual((r.status, r.json), (429, {"error": "too_soon"}))
        self.assertGreater(int(r.header("retry-after")), 86000)
        self.srv.clock.advance(86400 - 100)
        self.assertEqual(self.set("둘째이름").status, 429)
        self.srv.clock.advance(101)
        self.assertEqual(self.set("둘째이름").status, 200)
        self.assertEqual(self.set("셋째이름").status, 429)

    def test_failed_attempts_do_not_start_cooldown(self):
        self.set("a")                                          # 형식 오류
        Player(self.srv, "o").c.put("/api/me/nickname", {"nickname": "Taken"})
        self.set("Taken")                                      # 중복
        self.assertEqual(self.set("Free1").status, 200)
        self.assertEqual(self.db("SELECT nickname_changed_at FROM users WHERE id=?", (self.p.id,))[0][0] is None, False)

    def test_same_name_is_a_noop(self):
        self.set("MyName")
        r = self.set("MyName")
        self.assertEqual((r.status, r.json), (200, {"nickname": "MyName"}))
        self.srv.clock.advance(100)
        self.assertEqual(self.set("MyName").status, 200)       # 쿨다운 중에도 오류 아님

    def test_keeping_the_auto_name_is_allowed_as_noop(self):
        auto = self.me()["user"]["nickname"]
        r = self.set(auto)
        self.assertEqual((r.status, r.json), (200, {"nickname": auto}))
        self.assertFalse(self.me()["user"]["nicknameSet"])

    def test_requires_login_and_origin(self):
        self.assertEqual(self.set("Anyone", self.srv.client()).status, 401)
        self.assertEqual(self.c.put("/api/me/nickname", {"nickname": "Anyone"}, origin=False).status, 403)

    def test_nickname_shows_on_leaderboard_after_cache_expiry(self):
        self.set("OldName")
        self.p.play(300000, 200)
        self.srv.clock.advance(31)
        self.assertEqual(self.c.get("/api/leaderboard").json["entries"][0]["nickname"], "OldName")
        self.srv.clock.advance(86400)
        self.set("NewName")
        self.assertEqual(self.c.get("/api/leaderboard").json["entries"][0]["nickname"], "NewName")   # 캐시 비움

    def test_auto_nicknames_are_unique(self):
        names = {Player(self.srv, "u%d" % i).c.get("/api/me").json["user"]["nickname"] for i in range(15)}
        self.assertEqual(len(names), 15)


class SettingsTest(AccountBase):
    S = {"sound": False, "vibrate": True, "dmgNumbers": False}

    def put(self, settings, rev, client=None):
        return (client or self.c).put("/api/me/settings", {"settings": settings, "rev": rev})

    def test_save_and_read_back(self):
        r = self.put(self.S, 1764100123456)
        self.assertEqual((r.status, r.json), (200, {"settings": self.S, "rev": 1764100123456}))
        j = self.me()
        self.assertEqual(j["settings"], self.S)
        self.assertEqual(j["settingsRev"], 1764100123456)

    def test_older_or_equal_rev_does_not_overwrite(self):
        self.put(self.S, 2000)
        other = {"sound": True, "vibrate": False, "dmgNumbers": True}
        for rev in (1999, 2000, 0):
            r = self.put(other, rev)
            self.assertEqual(r.json, {"settings": self.S, "rev": 2000}, rev)
        self.assertEqual(self.me()["settings"], self.S)

    def test_newer_rev_overwrites(self):
        self.put(self.S, 2000)
        other = {"sound": True, "vibrate": False, "dmgNumbers": True}
        r = self.put(other, 2001)
        self.assertEqual(r.json, {"settings": other, "rev": 2001})
        self.assertEqual(self.me()["settingsRev"], 2001)

    def test_rev_zero_with_nothing_saved_returns_defaults(self):
        r = self.put(self.S, 0)
        self.assertEqual(r.json, {"settings": {"sound": True, "vibrate": True, "dmgNumbers": True}, "rev": 0})

    def test_extra_keys_are_dropped(self):
        r = self.put(dict(self.S, quality=2, evil="<script>"), 5)
        self.assertEqual(r.json["settings"], self.S)
        self.assertEqual(self.db("SELECT json FROM settings"), [('{"sound":false,"vibrate":true,"dmgNumbers":false}',)])

    def test_validation(self):
        good = dict(self.S)
        missing = {"sound": True, "vibrate": True}
        nonbool = {"sound": 1, "vibrate": True, "dmgNumbers": True}
        for settings, rev in ((missing, 1), (nonbool, 1), ("x", 1), (None, 1), (good, -1), (good, "1"),
                              (good, 1.5), (good, True), (good, None), (good, 2 ** 60)):
            r = self.put(settings, rev)
            self.assertEqual((r.status, r.json), (400, {"error": "bad_request"}), (settings, rev))
        self.assertEqual(self.c.put("/api/me/settings", {}).status, 400)

    def test_users_have_separate_settings(self):
        other = Player(self.srv, "o")
        self.put(self.S, 10)
        self.assertEqual(other.c.get("/api/me").json["settings"], {"sound": True, "vibrate": True, "dmgNumbers": True})

    def test_10_per_minute(self):
        self.srv.clock.freeze()
        codes = [self.put(self.S, i + 1).status for i in range(11)]
        self.assertEqual(codes, [200] * 10 + [429])

    def test_requires_login_and_origin(self):
        self.assertEqual(self.put(self.S, 1, self.srv.client()).status, 401)
        self.assertEqual(self.c.put("/api/me/settings", {"settings": self.S, "rev": 1}, origin=False).status, 403)


class ImportTest(AccountBase):
    REC = {"bestTime": 412.5, "bestKills": 980, "bestLevel": 31, "wins": 0, "runs": 14, "fullDawns": 0}

    def imp(self, rec, client=None):
        return (client or self.c).post("/api/me/import", {"records": rec})

    def test_import_into_empty_account(self):
        r = self.imp(self.REC)
        self.assertEqual(r.status, 200)
        self.assertEqual(r.json["records"], {"bestTimeMs": 412500, "bestKills": 980, "bestLevel": 31,
                                             "wins": 0, "runs": 14, "fullDawns": 0})
        self.assertTrue(self.me()["imported"])
        self.assertEqual(self.me()["records"], r.json["records"])

    def test_import_merges_max_and_sums(self):
        self.p.submit_ok(make_run(300000, 1000), make_run(60000, 50))     # 서버 기록: 300000ms, 1000킬
        before = self.me()["records"]
        self.assertEqual((before["runs"], before["bestKills"]), (2, 1000))
        rec = dict(self.REC, wins=2, fullDawns=1, bestLevel=2)
        r = self.imp(rec)
        merged = r.json["records"]
        self.assertEqual(merged["bestTimeMs"], 412500)             # 큰 값
        self.assertEqual(merged["bestKills"], 1000)                # 큰 값
        self.assertEqual(merged["bestLevel"], max(before["bestLevel"], 2))
        self.assertEqual(merged["runs"], 2 + 14)                   # 더함
        self.assertEqual((merged["wins"], merged["fullDawns"]), (2, 1))

    def test_import_only_once_per_account(self):
        self.assertEqual(self.imp(self.REC).status, 200)
        r = self.imp(self.REC)
        self.assertEqual((r.status, r.json), (409, {"error": "already_imported"}))
        self.assertEqual(self.me()["records"]["runs"], 14)

    def test_import_does_not_touch_leaderboard(self):
        self.imp(self.REC)
        self.assertEqual(self.db("SELECT COUNT(*) FROM best"), [(0,)])
        self.assertEqual(self.db("SELECT COUNT(*) FROM runs"), [(0,)])
        self.assertEqual(self.c.get("/api/leaderboard").json["entries"], [])

    def test_values_are_clamped(self):
        r = self.imp({"bestTime": 99999, "bestKills": 10 ** 12, "bestLevel": 9999, "wins": 10 ** 9, "runs": 10 ** 9,
                      "fullDawns": 10 ** 9})
        rec = r.json["records"]
        self.assertEqual(rec["bestTimeMs"], 900000)
        self.assertEqual((rec["bestKills"], rec["bestLevel"]), (1000000, 200))
        self.assertEqual((rec["wins"], rec["runs"], rec["fullDawns"]), (1000000, 1000000, 1000000))

    def test_missing_fields_count_as_zero(self):
        r = self.imp({"runs": 3})
        self.assertEqual(r.json["records"]["runs"], 3)

    def test_validation_and_failed_import_is_not_marked(self):
        for rec in ("x", None, [], {"bestKills": -1}, {"runs": 1.5}, {"bestKills": "5"}, {"bestTime": -1},
                    {"bestTime": "5"}, {"wins": True}, {"bestLevel": None}):
            r = self.imp(rec)
            self.assertEqual((r.status, r.json), (400, {"error": "bad_request"}), rec)
        r = self.c.post("/api/me/import", raw_body=b'{"records":{"bestTime":NaN}}')
        self.assertEqual(r.status, 400)
        r = self.c.post("/api/me/import", raw_body=b'{"records":{"bestTime":Infinity}}')
        self.assertEqual(r.status, 400)
        self.assertFalse(self.me()["imported"])
        self.assertEqual(self.imp(self.REC).status, 200)

    def test_requires_login_and_origin(self):
        self.assertEqual(self.imp(self.REC, self.srv.client()).status, 401)
        self.assertEqual(self.c.post("/api/me/import", {"records": self.REC}, origin=False).status, 403)


class DeleteAccountBoardTest(AccountBase):
    def test_deleted_user_leaves_the_board_immediately(self):
        keep = Player(self.srv, "keep", "Keeper")
        self.c.put("/api/me/nickname", {"nickname": "Leaver"})
        self.p.play(600000, 500)
        keep.play(300000, 200)
        self.srv.clock.advance(31)
        names = [e["nickname"] for e in self.c.get("/api/leaderboard").json["entries"]]
        self.assertEqual(names, ["Leaver", "Keeper"])
        self.assertEqual(self.c.delete("/api/me", {"confirm": "DELETE"}).status, 200)
        names = [e["nickname"] for e in self.srv.client().get("/api/leaderboard").json["entries"]]
        self.assertEqual(names, ["Keeper"])
        for table in ("tickets", "runs", "best", "records", "settings", "sessions"):
            self.assertEqual(self.db("SELECT COUNT(*) FROM %s WHERE user_id=?" % table, (self.p.id,)), [(0,)], table)
        self.assertEqual(self.db("SELECT COUNT(*) FROM best"), [(2,)])
        self.assertEqual(self.db("SELECT COUNT(*) FROM users"), [(1,)])

    def test_rank_of_others_moves_up_after_delete(self):
        keep = Player(self.srv, "keep", "Keeper")
        self.p.play(600000, 500)
        keep.play(300000, 200)
        self.c.delete("/api/me", {"confirm": "DELETE"})
        self.assertEqual(keep.c.get("/api/leaderboard?board=time").json["me"]["rank"], 1)


if __name__ == "__main__":
    unittest.main()
