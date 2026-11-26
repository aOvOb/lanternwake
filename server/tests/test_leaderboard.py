"""S18: 순위표 정렬(6.3), 캐시, 내 순위, 숨김과 차단 반영."""
import unittest

from support import TestServer
from support_runs import Player, make_run
import game_api


class BoardBase(unittest.TestCase):
    def setUp(self):
        self.srv = TestServer()
        self.guest = self.srv.client()

    def tearDown(self):
        self.srv.close()

    def board(self, name="time", client=None, **query):
        q = "&".join("%s=%s" % kv for kv in query.items())
        r = (client or self.guest).get("/api/leaderboard?board=%s%s" % (name, "&" + q if q else ""))
        self.assertEqual(r.status, 200, r.body)
        return r.json

    def names(self, name="time", **query):
        self.srv.clock.advance(31)      # 30초 캐시를 넘긴다
        return [e["nickname"] for e in self.board(name, **query)["entries"]]


class OrderingTest(BoardBase):
    def test_time_board_ties_break_by_kills_then_earlier(self):
        a = Player(self.srv, "a", "Alpha")
        b = Player(self.srv, "b", "Bravo")
        c = Player(self.srv, "c", "Charlie")
        d = Player(self.srv, "d", "Delta")
        a.play(300000, 200)       # 같은 시간, 처치 200, 먼저
        b.play(300000, 250)       # 같은 시간, 처치 더 많음
        c.play(300000, 200)       # a와 완전히 같지만 나중
        d.play(240000, 900)       # 더 짧은 시간
        self.assertEqual(self.names("time"), ["Bravo", "Alpha", "Charlie", "Delta"])

    def test_kills_board_ties_break_by_shorter_time_then_earlier(self):
        a = Player(self.srv, "a", "Alpha")
        b = Player(self.srv, "b", "Bravo")
        c = Player(self.srv, "c", "Charlie")
        d = Player(self.srv, "d", "Delta")
        a.play(300000, 200)
        b.play(240000, 200)       # 같은 처치 수를 더 빨리
        c.play(300000, 200)       # a와 같고 나중
        d.play(60000, 600)        # 처치 수가 가장 많음
        self.assertEqual(self.names("kills"), ["Delta", "Bravo", "Alpha", "Charlie"])

    def test_boards_differ(self):
        long_run = Player(self.srv, "long", "Longer")
        fast = Player(self.srv, "fast", "Fastkill")
        long_run.play(600000, 300)
        fast.play(120000, 800)
        self.assertEqual(self.names("time"), ["Longer", "Fastkill"])
        self.assertEqual(self.names("kills"), ["Fastkill", "Longer"])

    def test_win_runs_tie_on_time_and_split_by_kills(self):
        a = Player(self.srv, "a", "Alpha")
        b = Player(self.srv, "b", "Bravo")
        a.play(900000, 1000, bosses=3, elites=12, full_dawn=True)
        b.play(900000, 1200)
        j = self.board("time")
        self.srv.clock.advance(31)
        j = self.board("time")
        self.assertEqual([e["nickname"] for e in j["entries"]], ["Bravo", "Alpha"])
        self.assertEqual([e["fullDawn"] for e in j["entries"]], [False, True])

    def test_one_best_row_per_user_per_board(self):
        a = Player(self.srv, "a", "Alpha")
        a.play(300000, 200)
        a.play(240000, 150)          # 시간도 처치도 더 낮은 판
        a.play(360000, 220)
        self.assertEqual(self.names("time"), ["Alpha"])
        e = self.board("time")["entries"][0]
        self.assertEqual((e["timeMs"], e["kills"]), (360000, 220))
        rows = [tuple(r) for r in self.srv.app.db.conn.execute("SELECT board, v1, v2 FROM best ORDER BY board")]
        self.assertEqual(rows, [("kills", 220, -360000), ("time", 360000, 220)])

    def test_worse_later_run_does_not_replace_best(self):
        a = Player(self.srv, "a", "Alpha")
        a.play(300000, 200)
        a.play(120000, 80)
        e = self.board("time")["entries"][0]
        self.assertEqual((e["timeMs"], e["kills"]), (300000, 200))

    def test_equal_run_keeps_earlier_achieved_time(self):
        a = Player(self.srv, "a", "Alpha")
        a.play(300000, 200)
        first = [r[0] for r in self.srv.app.db.conn.execute("SELECT achieved_at FROM best WHERE board='time'")][0]
        a.play(300000, 200)
        again = [r[0] for r in self.srv.app.db.conn.execute("SELECT achieved_at FROM best WHERE board='time'")][0]
        self.assertEqual(first, again)

    def test_unranked_and_rejected_runs_never_reach_the_board(self):
        a = Player(self.srv, "a", "Alpha")
        a.submit_ok(make_run(300000, 200))                       # 표 없음
        a.submit_ok(make_run(300000, 200, level=0))              # 거부
        self.assertEqual(self.names("time"), [])


class ResponseShapeTest(BoardBase):
    def test_entry_fields_and_no_user_id(self):
        a = Player(self.srv, "a", "Alpha")
        res = a.play(300000, 200)
        self.assertEqual(res["rank"], {"time": 1, "kills": 1})
        j = self.board("time")
        self.assertEqual(set(j), {"board", "updatedAt", "entries"})
        self.assertEqual(j["board"], "time")
        (e,) = j["entries"]
        self.assertEqual(set(e), {"rank", "nickname", "timeMs", "kills", "level", "fullDawn", "at"})
        self.assertEqual((e["rank"], e["nickname"], e["timeMs"], e["kills"], e["fullDawn"]), (1, "Alpha", 300000, 200, False))
        self.assertNotIn("id", e)
        self.assertNotIn("userId", e)
        self.assertEqual(j["entries"][0]["level"], make_run(300000, 200)["level"])

    def test_no_store_header_and_public(self):
        r = self.guest.get("/api/leaderboard")
        self.assertEqual(r.status, 200)
        self.assertEqual(r.json["entries"], [])
        self.assertEqual(r.header("cache-control"), "no-store")
        self.assertNotIn("me", r.json)

    def test_query_validation(self):
        for q in ("board=x", "board=", "limit=0", "limit=abc", "limit=-1", "board=time&limit=1.5", "limit=1234567"):
            r = self.guest.get("/api/leaderboard?" + q)
            self.assertEqual((r.status, r.json), (400, {"error": "bad_request"}), q)

    def test_default_board_is_time_and_limit_is_clamped(self):
        players = [Player(self.srv, "p%d" % i, "Player%02d" % i) for i in range(3)]
        for i, p in enumerate(players):
            p.play(60000, 10 + i)
        self.srv.clock.advance(31)
        self.assertEqual(self.guest.get("/api/leaderboard").json["board"], "time")
        self.assertEqual(len(self.board("time", limit=2)["entries"]), 2)
        self.assertEqual(len(self.board("time", limit=500)["entries"]), 3)
        self.assertEqual([e["rank"] for e in self.board("time", limit=2)["entries"]], [1, 2])

    def test_top_100_only(self):
        with self.srv.app.db.tx() as c:
            now = self.srv.app.now()
            for i in range(120):
                cur = c.execute("INSERT INTO users(sub_hash,nickname,nickname_key,created_at,last_seen_at)"
                                " VALUES(?,?,?,?,?)", ("h%d" % i, "N%03d" % i, "n%03d" % i, now, now))
                run = c.execute("INSERT INTO runs(user_id,client_run_id,ver,time_ms,kills,level,won,full_dawn,elites,"
                                "bosses,detail,status,submitted_at) VALUES(?,?,?,?,?,1,0,0,0,0,'{}','ranked',?)",
                                (cur.lastrowid, "cid-%05d" % i, "0.1.0", 60000 + i, 10, now))
                c.execute("INSERT INTO best VALUES(?,?,?,?,?,?)", (cur.lastrowid, "time", run.lastrowid, 60000 + i, 10, now))
        j = self.board("time", limit=1000)
        self.assertEqual(len(j["entries"]), 100)
        self.assertEqual(j["entries"][0]["nickname"], "N119")


class CacheAndMeTest(BoardBase):
    def test_board_is_cached_for_30_seconds(self):
        a = Player(self.srv, "a", "Alpha")
        a.play(300000, 200)
        self.srv.clock.freeze()
        b = Player(self.srv, "b", "Bravo")
        bt = b.tickets(1)[0]
        self.srv.clock.frozen += 400                       # 표의 경과 시간 검사를 통과시킨다
        self.assertEqual(len(self.board("time")["entries"]), 1)     # 여기서 캐시가 만들어진다
        res = b.submit_ok(make_run(300000, 300, ticket=bt["id"]))[0]
        self.assertEqual(res["status"], "ranked")
        self.assertEqual(len(self.board("time")["entries"]), 1)     # 캐시된 옛 목록
        self.srv.clock.frozen += 29
        self.assertEqual(len(self.board("time")["entries"]), 1)
        self.srv.clock.frozen += 2
        self.assertEqual([e["nickname"] for e in self.board("time")["entries"]], ["Bravo", "Alpha"])

    def test_each_board_has_its_own_cache(self):
        a = Player(self.srv, "a", "Alpha")
        a.play(300000, 200)
        self.srv.clock.advance(31)
        t = self.board("time")["updatedAt"]
        self.srv.clock.advance(10)
        k = self.board("kills")["updatedAt"]
        self.assertGreater(k, t)

    def test_me_for_logged_in_user_with_record(self):
        a = Player(self.srv, "a", "Alpha")
        b = Player(self.srv, "b", "Bravo")
        a.play(300000, 200)
        b.play(240000, 400)
        j = self.board("time", client=b.c)
        self.assertEqual(j["me"], {"rank": 2, "timeMs": 240000, "kills": 400})
        j = self.board("kills", client=b.c)
        self.assertEqual(j["me"], {"rank": 1, "timeMs": 240000, "kills": 400})
        self.assertEqual(self.board("time", client=a.c)["me"]["rank"], 1)

    def test_me_is_fresh_even_if_entries_are_cached(self):
        a = Player(self.srv, "a", "Alpha")
        self.srv.clock.freeze()
        t = a.tickets(1)[0]
        self.srv.clock.frozen += 400
        self.board("time")                     # 빈 목록이 캐시된다
        a.submit_ok(make_run(300000, 200, ticket=t["id"]))
        j = self.board("time", client=a.c)
        self.assertEqual(j["entries"], [])
        self.assertEqual(j["me"]["rank"], 1)

    def test_no_me_without_record_or_login(self):
        Player(self.srv, "a", "Alpha").play(300000, 200)
        nobody = Player(self.srv, "n", "Nobody")
        self.assertNotIn("me", self.board("time", client=nobody.c))
        self.assertNotIn("me", self.board("time"))

    def test_rank_in_run_result_matches_leaderboard(self):
        a = Player(self.srv, "a", "Alpha")
        b = Player(self.srv, "b", "Bravo")
        a.play(300000, 200)
        res = b.play(240000, 400)
        self.assertEqual(res["rank"], {"time": 2, "kills": 1})

    def test_invalid_session_cookie_is_treated_as_guest(self):
        c = self.srv.client()
        c.jar["__Host-lw_s"] = "junk"
        self.assertEqual(c.get("/api/leaderboard").status, 200)

    def test_rate_limit_30_per_minute(self):
        self.srv.clock.freeze()
        codes = [self.guest.get("/api/leaderboard").status for _ in range(31)]
        self.assertEqual(codes[30], 429)


class RankOfTest(BoardBase):
    def test_rank_is_position_with_total_order(self):
        ps = [Player(self.srv, "p%d" % i, "Player%d" % i) for i in range(5)]
        for i, p in enumerate(ps):
            p.play(60000, 100)       # 전부 같은 값. 먼저 낸 사람이 위
        with self.srv.app.db.read() as c:
            ranks = [game_api.rank_of(c, "time", p.id) for p in ps]
        self.assertEqual(ranks, [1, 2, 3, 4, 5])
        self.assertEqual(self.names("time"), ["Player%d" % i for i in range(5)])


if __name__ == "__main__":
    unittest.main()
