"""S18: 관리 작업(hide, ban, rename, rebuild-best, suspects, stats)과 CLI 연결."""
import os
import subprocess
import sys
import unittest

from support import FIXTURES, SERVER_DIR, TestServer
from support_runs import Player, make_run
import game_api

CLI = os.path.join(SERVER_DIR, "game_api.py")


class AdminBase(unittest.TestCase):
    def setUp(self):
        self.srv = TestServer()
        self.app = self.srv.app
        self.guest = self.srv.client()

    def tearDown(self):
        self.srv.close()

    def names(self, board="time"):
        self.srv.clock.advance(31)
        return [e["nickname"] for e in self.guest.get("/api/leaderboard?board=" + board).json["entries"]]

    def best_run_ids(self, user_id):
        with self.app.db.read() as c:
            return {r["board"]: r["run_id"] for r in c.execute("SELECT board, run_id FROM best WHERE user_id=?", (user_id,))}

    def run_id(self, client_run_id):
        with self.app.db.read() as c:
            return c.execute("SELECT id FROM runs WHERE client_run_id=?", (client_run_id,)).fetchone()[0]


class HideBanTest(AdminBase):
    def play_two(self, p):
        """p가 판 둘을 올린다. 두 번째가 더 좋다. (첫 판 id, 둘째 판 id)를 돌려준다."""
        r1 = p.play(240000, 100)
        r2 = p.play(300000, 200)
        return self.run_id(r1["clientRunId"]), self.run_id(r2["clientRunId"])

    def test_hide_best_run_falls_back_to_next_best(self):
        a = Player(self.srv, "a", "Alpha")
        first, second = self.play_two(a)
        self.assertEqual(set(self.best_run_ids(a.id).values()), {second})
        game_api.set_run_hidden(self.app, second, True)
        self.assertEqual(set(self.best_run_ids(a.id).values()), {first})
        j = self.guest.get("/api/leaderboard").json            # 캐시가 비워져 바로 반영
        self.assertEqual((j["entries"][0]["timeMs"], j["entries"][0]["kills"]), (240000, 100))

    def test_hide_only_run_removes_user_from_board(self):
        a = Player(self.srv, "a", "Alpha")
        b = Player(self.srv, "b", "Bravo")
        ra = a.play(300000, 200)
        b.play(240000, 100)
        game_api.set_run_hidden(self.app, self.run_id(ra["clientRunId"]), True)
        self.assertEqual(self.names("time"), ["Bravo"])
        self.assertEqual(self.names("kills"), ["Bravo"])
        self.assertNotIn("me", a.c.get("/api/leaderboard").json)
        self.assertEqual(b.c.get("/api/leaderboard").json["me"]["rank"], 1)

    def test_hidden_run_still_counts_for_personal_records(self):
        a = Player(self.srv, "a", "Alpha")
        ra = a.play(300000, 200)
        game_api.set_run_hidden(self.app, self.run_id(ra["clientRunId"]), True)
        self.assertEqual(a.c.get("/api/me").json["records"]["bestKills"], 200)

    def test_unhide_restores(self):
        a = Player(self.srv, "a", "Alpha")
        ra = self.run_id(a.play(300000, 200)["clientRunId"])
        game_api.set_run_hidden(self.app, ra, True)
        self.assertEqual(self.names(), [])
        game_api.set_run_hidden(self.app, ra, False)
        self.assertEqual(self.names(), ["Alpha"])

    def test_hide_unknown_run(self):
        with self.assertRaises(KeyError):
            game_api.set_run_hidden(self.app, 99999, True)

    def test_ban_removes_user_from_board_and_ranks(self):
        a = Player(self.srv, "a", "Alpha")
        b = Player(self.srv, "b", "Bravo")
        a.play(600000, 500)
        b.play(300000, 200)
        self.srv.clock.advance(31)
        self.assertEqual(b.c.get("/api/leaderboard").json["me"]["rank"], 2)
        game_api.set_user_banned(self.app, a.id, True)
        self.assertEqual(self.names(), ["Bravo"])
        self.assertEqual(b.c.get("/api/leaderboard").json["me"]["rank"], 1)
        with self.app.db.read() as c:
            self.assertEqual(game_api.rank_of(c, "time", b.id), 1)
        r = a.c.get("/api/me")
        self.assertEqual((r.status, r.json), (403, {"error": "banned"}))
        self.assertEqual(a.submit(make_run()).status, 403)

    def test_unban_restores(self):
        a = Player(self.srv, "a", "Alpha")
        a.play(300000, 200)
        game_api.set_user_banned(self.app, a.id, True)
        self.assertEqual(self.names(), [])
        game_api.set_user_banned(self.app, a.id, False)
        self.assertEqual(self.names(), ["Alpha"])
        self.assertEqual(a.c.get("/api/me").status, 200)

    def test_ban_unknown_user(self):
        with self.assertRaises(KeyError):
            game_api.set_user_banned(self.app, 99999, True)

    def test_banned_user_cannot_login_to_use_the_api(self):
        a = Player(self.srv, "a", "Alpha")
        game_api.set_user_banned(self.app, a.id, True)
        c = self.srv.client()
        self.srv.login_ok(c, sub="a")                     # 로그인 자체는 되지만
        self.assertEqual(c.get("/api/me").status, 403)    # 모든 API가 banned


class RenameTest(AdminBase):
    def test_rename(self):
        a = Player(self.srv, "a")
        game_api.rename_user(self.app, a.id, "새이름")
        j = a.c.get("/api/me").json
        self.assertEqual((j["user"]["nickname"], j["user"]["nicknameSet"]), ("새이름", True))

    def test_rename_skips_reserved_words_but_checks_format_and_uniqueness(self):
        a = Player(self.srv, "a")
        b = Player(self.srv, "b", "Taken")
        game_api.rename_user(self.app, a.id, "관리자")
        with self.assertRaises(ValueError):
            game_api.rename_user(self.app, a.id, "x")
        with self.assertRaises(ValueError):
            game_api.rename_user(self.app, a.id, "taken")
        with self.assertRaises(KeyError):
            game_api.rename_user(self.app, 99999, "Nobody")
        self.assertEqual(b.c.get("/api/me").json["user"]["nickname"], "Taken")

    def test_rename_does_not_start_user_cooldown(self):
        a = Player(self.srv, "a")
        game_api.rename_user(self.app, a.id, "Forced")
        self.assertEqual(a.c.put("/api/me/nickname", {"nickname": "Mine"}).status, 200)


class RebuildBestTest(AdminBase):
    def test_rebuild_reproduces_current_best(self):
        a = Player(self.srv, "a", "Alpha")
        b = Player(self.srv, "b", "Bravo")
        a.play(300000, 200)
        b.play(240000, 400)
        a.play(120000, 100)
        with self.app.db.read() as c:
            before = [tuple(r) for r in c.execute("SELECT * FROM best ORDER BY user_id, board")]
        game_api.rebuild_best(self.app)
        with self.app.db.read() as c:
            after = [tuple(r) for r in c.execute("SELECT * FROM best ORDER BY user_id, board")]
        self.assertEqual(before, after)

    def test_rebuild_drops_runs_below_min_ranked_version(self):
        a = Player(self.srv, "a", "Alpha")
        b = Player(self.srv, "b", "Bravo")
        a.play(300000, 200)
        b.play(240000, 100)
        self.app.bounds.min_ranked = (0, 2, 0)           # 밸런스를 바꿔 최소 버전을 올렸다
        game_api.rebuild_best(self.app)
        self.assertEqual(self.names(), [])
        self.app.bounds.min_ranked = (0, 1, 0)
        game_api.rebuild_best(self.app)
        self.assertEqual(self.names(), ["Alpha", "Bravo"])

    def test_rebuild_skips_hidden_unranked_and_rejected(self):
        a = Player(self.srv, "a", "Alpha")
        a.submit_ok(make_run(300000, 200))                  # 표 없음
        a.submit_ok(make_run(300000, 200, level=0))         # 거부
        game_api.rebuild_best(self.app)
        self.assertEqual(self.names(), [])

    def test_rebuild_for_one_user_leaves_others(self):
        a = Player(self.srv, "a", "Alpha")
        b = Player(self.srv, "b", "Bravo")
        a.play(300000, 200)
        b.play(240000, 100)
        game_api.rebuild_best(self.app, a.id)
        self.assertEqual(self.names(), ["Alpha", "Bravo"])


class SuspectsTest(AdminBase):
    def test_top_kpm_run_is_flagged(self):
        a = Player(self.srv, "a", "Alpha")
        b = Player(self.srv, "b", "Bravo")
        a.play(300000, 200)                     # 분당 40
        rb = b.play(300000, 1000)               # 분당 200
        s = game_api.find_suspects(self.app)
        self.assertEqual([x["runId"] for x in s], [self.run_id(rb["clientRunId"])])
        self.assertEqual(s[0]["peakKpm"], 200)
        self.assertEqual(s[0]["why"], ["kpm_top"])
        self.assertEqual(s[0]["nickname"], "Bravo")

    def test_pre_fetched_ticket_rank_one_is_flagged(self):
        a = Player(self.srv, "a", "Alpha")
        t = a.tickets(1)[0]
        self.srv.clock.advance(2 * 3600 + 400)             # 표를 받고 2시간 넘게 지난 뒤 300초짜리 판
        res = a.submit_ok(make_run(300000, 200, ticket=t["id"]))[0]
        self.assertEqual(res["status"], "ranked")
        s = game_api.find_suspects(self.app)
        self.assertEqual(len(s), 1)
        self.assertIn("pre_ticket_rank1_time", s[0]["why"])
        self.assertIn("pre_ticket_rank1_kills", s[0]["why"])

    def test_normal_ticket_is_not_flagged_for_age(self):
        a = Player(self.srv, "a", "Alpha")
        a.play(300000, 200)
        b = Player(self.srv, "b", "Bravo")
        b.play(300000, 100)
        flagged = [x for x in game_api.find_suspects(self.app) if any(w.startswith("pre_ticket") for w in x["why"])]
        self.assertEqual(flagged, [])

    def test_hidden_and_banned_are_excluded(self):
        a = Player(self.srv, "a", "Alpha")
        ra = a.play(300000, 1000)
        self.assertEqual(len(game_api.find_suspects(self.app)), 1)
        game_api.set_run_hidden(self.app, self.run_id(ra["clientRunId"]), True)
        self.assertEqual(game_api.find_suspects(self.app), [])

    def test_empty_database(self):
        self.assertEqual(game_api.find_suspects(self.app), [])


class CliTest(unittest.TestCase):
    """실제 명령줄로 같은 DB를 열어 본다."""

    def setUp(self):
        self.srv = TestServer()
        self.env = dict(os.environ, DATA=self.srv.cfg.data, BOUNDS=os.path.join(FIXTURES, "bounds-design.json"))
        self.env.pop("GOOGLE_CLIENT_ID", None)

    def tearDown(self):
        self.srv.close()

    def cli(self, *args, ok=True):
        r = subprocess.run([sys.executable, CLI] + list(args), capture_output=True, text=True,
                           encoding="utf-8", env=self.env, timeout=60)
        if ok:
            self.assertEqual(r.returncode, 0, r.stderr)
        return r

    def test_commands(self):
        a = Player(self.srv, "a", "Alpha")
        b = Player(self.srv, "b", "Bravo")
        ra = a.play(300000, 1000)
        b.play(240000, 100)
        out = self.cli("stats").stdout
        self.assertIn("사용자 2명", out)
        self.assertIn("판 ranked: 2개", out)
        out = self.cli("suspects").stdout
        self.assertIn("Alpha", out)
        self.assertIn("의심 기록 1개", out)
        rid = str(self._run_id(ra["clientRunId"]))
        self.assertIn("숨김", self.cli("hide", rid).stdout)
        self.assertEqual(self._board(), ["Bravo"])
        self.cli("unhide", rid)
        self.assertEqual(self._board(), ["Alpha", "Bravo"])
        self.cli("ban", str(b.id))
        self.assertEqual(self._board(), ["Alpha"])
        self.cli("unban", str(b.id))
        self.assertEqual(self._board(), ["Alpha", "Bravo"])
        self.cli("rename", str(b.id), "Renamed")
        self.assertEqual(self._board(), ["Alpha", "Renamed"])
        self.assertIn("다시 만듦", self.cli("rebuild-best").stdout)
        self.assertEqual(self._board(), ["Alpha", "Renamed"])

    def _run_id(self, cid):
        with self.srv.app.db.read() as c:
            return c.execute("SELECT id FROM runs WHERE client_run_id=?", (cid,)).fetchone()[0]

    def _board(self):
        # 다른 프로세스가 DB를 고쳤으므로 서버의 순위표 캐시를 비워 새로 읽게 한다(캐시 수명 30초는 별도 시험)
        self.srv.app.boards.clear()
        return [e["nickname"] for e in self.srv.client().get("/api/leaderboard").json["entries"]]

    def test_errors_exit_nonzero(self):
        self.assertNotEqual(self.cli("hide", "999", ok=False).returncode, 0)
        self.assertNotEqual(self.cli("ban", "999", ok=False).returncode, 0)
        self.assertNotEqual(self.cli("rename", "1", "x", ok=False).returncode, 0)
        self.assertNotEqual(self.cli("hide", "abc", ok=False).returncode, 0)
        self.assertNotEqual(self.cli("nope", ok=False).returncode, 0)
        self.assertNotEqual(self.cli(ok=False).returncode, 0)

    def test_serve_requires_client_id(self):
        r = self.cli("serve", ok=False)
        self.assertNotEqual(r.returncode, 0)
        self.assertIn("GOOGLE_CLIENT_ID", r.stderr)


if __name__ == "__main__":
    unittest.main()
