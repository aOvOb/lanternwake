"""S18: 판 시작 표, 기록 제출 검사(6.2), 멱등성, 개인 기록, 요청 제한."""
import threading
import unittest

from support import TestServer
from support_runs import Player, make_run


class RunsBase(unittest.TestCase):
    def setUp(self):
        self.srv = TestServer()
        self.p = Player(self.srv, "runner")
        self.c = self.p.c

    def tearDown(self):
        self.srv.close()

    def db(self, sql, args=()):
        with self.srv.app.db.read() as c:
            return [tuple(r) for r in c.execute(sql, args).fetchall()]

    def records(self):
        return self.c.get("/api/me").json["records"]

    def valid_ticket_run(self, time_ms=300000, kills=200, **over):
        """표를 받아 판 길이만큼 시계를 돌려 둔 정상 판."""
        t = self.p.tickets(1)[0]
        self.srv.clock.advance(time_ms / 1000.0 + 1)
        return make_run(time_ms, kills, ticket=t["id"], **over), t["id"]


class TicketTest(RunsBase):
    def test_issue_one_ticket(self):
        r = self.c.post("/api/runs/tickets", {"count": 1})
        self.assertEqual(r.status, 200)
        (t,) = r.json["tickets"]
        self.assertEqual(len(t["id"]), 22)
        self.assertEqual(t["expiresAt"] - t["issuedAt"], 14 * 86400)
        self.assertAlmostEqual(t["issuedAt"], self.srv.app.now(), delta=2)
        self.assertEqual(self.db("SELECT COUNT(*) FROM tickets WHERE used_at IS NULL"), [(1,)])

    def test_ids_are_unique(self):
        ids = {t["id"] for _ in range(1) for t in self.p.tickets(5)}
        self.assertEqual(len(ids), 5)

    def test_count_must_be_1_to_5(self):
        for bad in (0, 6, -1, "1", 1.5, True, None, [1]):
            r = self.c.post("/api/runs/tickets", {"count": bad})
            self.assertEqual((r.status, r.json), (400, {"error": "bad_request"}), bad)

    def test_missing_count_means_one(self):
        r = self.c.post("/api/runs/tickets", {})
        self.assertEqual(len(r.json["tickets"]), 1)

    def test_unused_tickets_capped_at_6(self):
        self.assertEqual(len(self.p.tickets(5)), 5)
        self.assertEqual(len(self.p.tickets(5)), 5)       # 상한에서는 오래된 표를 지우고 새로 준다
        self.assertEqual(len(self.p.tickets(1)), 1)
        self.assertEqual(self.db("SELECT COUNT(*) FROM tickets WHERE used_at IS NULL"), [(6,)])

    def test_cap_deletes_oldest_unused_tickets_first(self):
        first = self.p.tickets(5)
        self.srv.clock.advance(10)
        second = self.p.tickets(1)[0]
        self.srv.clock.advance(10)
        fresh = self.p.tickets(2)                          # 6 + 2 - 6 = 2장을 지운다
        left = {r[0] for r in self.db("SELECT id FROM tickets WHERE used_at IS NULL")}
        self.assertEqual(len(left), 6)
        self.assertNotIn(first[0]["id"], left)
        self.assertNotIn(first[1]["id"], left)
        for t in first[2:] + [second] + fresh:
            self.assertIn(t["id"], left)

    def test_cap_never_deletes_used_tickets_or_other_users(self):
        other = Player(self.srv, "other")
        theirs = other.tickets(5)
        ts = self.p.tickets(5)
        self.p.tickets(1)
        self.srv.clock.advance(400)
        self.p.submit_ok(make_run(ticket=ts[0]["id"]))     # 하나를 쓴다
        self.p.tickets(5)                                  # 미사용 5 + 5 - 6 = 4장 삭제
        self.assertEqual(self.db("SELECT COUNT(*) FROM tickets WHERE used_at IS NOT NULL"), [(1,)])
        left = {r[0] for r in self.db("SELECT id FROM tickets WHERE user_id=?", (other.id,))}
        self.assertEqual(left, {t["id"] for t in theirs})

    def test_leaked_tickets_do_not_block_new_ones(self):
        # 클라이언트가 표를 잃어버려도(서버에는 미사용으로 남음) 다음 요청이 빈 배열을 받지 않는다
        for _ in range(3):
            self.p.tickets(2)
        self.assertEqual(len(self.p.tickets(1)), 1)
        t = self.p.tickets(1)[0]
        self.srv.clock.advance(400)
        self.assertEqual(self.p.submit_ok(make_run(ticket=t["id"]))[0]["status"], "ranked")

    def test_used_tickets_free_a_slot(self):
        ts = self.p.tickets(5)
        self.p.tickets(1)
        self.srv.clock.advance(400)
        self.p.submit_ok(make_run(ticket=ts[0]["id"]))
        self.p.tickets(1)                                  # 빈 자리가 있어 지우는 표가 없다
        self.assertEqual(self.db("SELECT COUNT(*) FROM tickets WHERE used_at IS NULL"), [(6,)])
        self.assertEqual(self.db("SELECT COUNT(*) FROM tickets"), [(7,)])

    def test_expired_tickets_do_not_count(self):
        self.p.tickets(5)
        self.p.tickets(1)
        self.srv.clock.advance(15 * 86400)
        self.assertEqual(len(self.p.tickets(5)), 5)

    def test_30_requests_per_hour(self):
        self.srv.clock.freeze()
        codes = []
        for _ in range(31):
            r = self.c.post("/api/runs/tickets", {"count": 1})
            codes.append(r.status)
        self.assertEqual(codes[:30], [200] * 30)
        self.assertEqual(codes[30], 429)
        self.assertEqual(r.json, {"error": "rate_limited"})
        self.assertGreaterEqual(int(r.header("retry-after")), 1)

    def test_requires_login_and_origin(self):
        self.assertEqual(self.srv.client().post("/api/runs/tickets", {"count": 1}).status, 401)
        self.assertEqual(self.c.post("/api/runs/tickets", {"count": 1}, origin=False).status, 403)


class RunCheckTest(RunsBase):
    """6.2의 검사마다 실패 사례가 하나씩 있고 모두 rejected가 된다."""

    def assert_rejected(self, run, reason):
        res = self.p.submit_ok(run)[0]
        self.assertEqual(res["status"], "rejected", res)
        self.assertEqual(res["reason"], reason, res)
        self.assertEqual(res["clientRunId"], run["clientRunId"])
        self.assertEqual(self.records()["runs"], 0)       # 개인 기록에도 넣지 않는다
        self.assertEqual(self.db("SELECT COUNT(*) FROM best"), [(0,)])
        return res

    def test_normal_run_is_ranked(self):
        run, _ = self.valid_ticket_run()
        res = self.p.submit_ok(run)[0]
        self.assertEqual(res, {"clientRunId": run["clientRunId"], "status": "ranked",
                               "rank": {"time": 1, "kills": 1}})
        rec = self.records()
        self.assertEqual(rec, {"bestTimeMs": 300000, "bestKills": 200, "bestLevel": run["level"],
                               "wins": 0, "runs": 1, "fullDawns": 0})

    def test_range_time(self):
        for t in (0, -5, 900001, 10 ** 12):
            self.assert_rejected(make_run(300000, 100, timeMs=t), "range")

    def test_range_level_and_kills_and_counts(self):
        self.assert_rejected(make_run(level=0), "range")
        self.assert_rejected(make_run(level=201), "range")
        self.assert_rejected(make_run(kills=-1), "range")
        self.assert_rejected(make_run(elites=-1), "range")
        self.assert_rejected(make_run(bosses=-1), "range")

    def test_range_wrong_types(self):
        for field, value in (("timeMs", 300000.0), ("timeMs", "300000"), ("timeMs", True), ("kills", 1.5),
                             ("level", None), ("won", 0), ("fullDawn", "no"), ("elites", None), ("bosses", [])):
            run = make_run()
            run[field] = value
            self.assert_rejected(run, "range")

    def test_range_missing_field(self):
        run = make_run()
        del run["timeMs"]
        self.assert_rejected(run, "range")

    def test_bad_version_format(self):
        for v in ("1.0", "abc", "", None, 1, "1.0.0.0", "1.0.x"):
            self.assert_rejected(make_run(ver=v), "ver")

    def test_win_won_but_not_full_time(self):
        self.assert_rejected(make_run(300000, 100, won=True), "win")

    def test_win_full_time_but_not_won(self):
        self.assert_rejected(make_run(900000, 900, won=False), "win")

    def test_dawn_requires_won(self):
        self.assert_rejected(make_run(300000, 100, full_dawn=True, bosses=1), "dawn")

    def test_dawn_requires_boss(self):
        self.assert_rejected(make_run(900000, 900, full_dawn=True, bosses=0), "dawn")

    def test_events_too_many_elites(self):
        # 5분(300초)까지의 엘리트 이벤트는 120, 210, 240초의 3마리
        self.assert_rejected(make_run(300000, 100, elites=4), "events")

    def test_events_too_many_bosses(self):
        # 5분까지 보스는 300초의 1마리. 보스 2마리는 10분 이후에야 가능하다
        self.assert_rejected(make_run(300000, 100, bosses=2), "events")

    def test_events_at_boundaries_are_accepted(self):
        run, _ = self.valid_ticket_run(300000, 100, elites=3, bosses=1)
        self.assertEqual(self.p.submit_ok(run)[0]["status"], "ranked")

    def test_events_before_first_boss(self):
        self.assert_rejected(make_run(299000, 100, bosses=1), "events")

    def test_shape_kpm_length(self):
        run = make_run()
        run["kpm"] = run["kpm"][:-1]
        self.assert_rejected(run, "shape")
        run = make_run()
        run["kpm"] = run["kpm"] + [0]
        self.assert_rejected(run, "shape")

    def test_shape_lvm_length(self):
        run = make_run()
        run["lvm"] = run["lvm"][:-1]
        self.assert_rejected(run, "shape")

    def test_shape_sum_mismatch(self):
        run = make_run()
        run["kpm"][0] += 1
        self.assert_rejected(run, "shape")

    def test_shape_lvm_decreasing(self):
        run = make_run(300000, 400)
        run["lvm"][2], run["lvm"][3] = run["lvm"][3], run["lvm"][2]
        self.assertGreater(run["lvm"][2], run["lvm"][3])
        self.assert_rejected(run, "shape")

    def test_shape_lvm_last_not_level(self):
        run = make_run()
        run["level"] = run["lvm"][-1] - 1
        self.assert_rejected(run, "shape")

    def test_shape_wrong_types(self):
        for field, value in (("kpm", "abc"), ("kpm", None), ("lvm", {"a": 1}), ("kpm", [1.5] * 5),
                             ("lvm", ["x"] * 5), ("kpm", [True] * 5), ("kpm", [-1, 0, 0, 0, 201])):
            run = make_run()
            run[field] = value
            self.assert_rejected(run, "shape")

    def test_shape_more_than_15_minutes_is_impossible(self):
        run = make_run(900000, 900)
        run["kpm"] = run["kpm"] + [0]
        run["lvm"] = run["lvm"] + [run["lvm"][-1]]
        self.assert_rejected(run, "shape")

    def test_kpm_over_limit(self):
        run = make_run(60000, 1300)
        self.assert_rejected(run, "kpm")

    def test_kpm_at_limit_is_accepted(self):
        run, _ = self.valid_ticket_run(60000, 1200)
        self.assertEqual(self.p.submit_ok(run)[0]["status"], "ranked")

    def test_xp_level_unreachable(self):
        # 첫 1분에 1마리만 잡았는데 레벨 50
        run = make_run(60000, 1, level=50, lvm=[50])
        self.assert_rejected(run, "xp")

    def test_xp_checked_every_minute_not_only_at_end(self):
        run = make_run(300000, 400)
        run["lvm"][0] = 30          # 첫 1분 80마리로는 못 닿는 레벨
        run["lvm"][1:] = [30] * 4
        run["level"] = 30
        self.assert_rejected(run, "xp")

    def test_xp_counts_elites_and_bosses(self):
        # 처치 1마리로 레벨 11(누적 경험치 500)은 불가, 엘리트 3마리(60)와 보스(100)를 더해도 165라서 불가
        run = make_run(300000, 1, elites=3, bosses=1, level=11, lvm=[1, 1, 1, 1, 11])
        run["kpm"] = [1, 0, 0, 0, 0]
        self.assert_rejected(run, "xp")
        # 같은 시간에 처치 70마리면 5x70 + 60 + 100 = 510 >= 500 이라서 통과
        ok = make_run(300000, 70, elites=3, bosses=1, level=11, lvm=[3, 3, 3, 3, 11])
        ok["kpm"] = [70, 0, 0, 0, 0]
        ok, _ = self._with_ticket(ok)
        self.assertEqual(self.p.submit_ok(ok)[0]["status"], "ranked")

    def _with_ticket(self, run):
        t = self.p.tickets(1)[0]
        self.srv.clock.advance(run["timeMs"] / 1000.0 + 1)
        run["ticket"] = t["id"]
        return run, t["id"]

    def test_elapsed_too_short(self):
        t = self.p.tickets(1)[0]
        res = self.assert_rejected(make_run(300000, 200, ticket=t["id"]), "elapsed")
        self.assertNotIn("rank", res)

    def test_elapsed_allows_5_seconds_slack(self):
        t = self.p.tickets(1)[0]
        self.srv.clock.advance(300 - 5 - 1)
        self.assertEqual(self.p.submit_ok(make_run(300000, 200, ticket=t["id"]))[0]["reason"], "elapsed")
        self.srv.clock.advance(3)
        res = self.p.submit_ok(make_run(300000, 200, ticket=t["id"]))[0]
        self.assertEqual(res["status"], "ranked")

    def test_rejected_run_does_not_consume_ticket(self):
        t = self.p.tickets(1)[0]
        self.srv.clock.advance(400)
        bad = make_run(300000, 200, ticket=t["id"], level=0)
        self.assertEqual(self.p.submit_ok(bad)[0]["status"], "rejected")
        self.assertEqual(self.db("SELECT used_at FROM tickets"), [(None,)])
        good = make_run(300000, 200, ticket=t["id"])
        self.assertEqual(self.p.submit_ok(good)[0]["status"], "ranked")

    def test_rejected_run_is_stored_for_idempotency(self):
        run = make_run(kills=-1)
        self.p.submit_ok(run)
        again = self.p.submit_ok(run)[0]
        self.assertEqual(again["status"], "duplicate")
        self.assertEqual(again["first"], "rejected")
        self.assertEqual(again["reason"], "range")
        self.assertEqual(self.db("SELECT COUNT(*) FROM runs"), [(1,)])

    def test_huge_numbers_do_not_crash(self):
        run = make_run()
        run["timeMs"] = 10 ** 30
        run["kills"] = -10 ** 30
        self.assert_rejected(run, "range")


class RunStatusTest(RunsBase):
    def test_no_ticket_is_unranked_but_counts_personally(self):
        res = self.p.submit_ok(make_run(300000, 200))[0]
        self.assertEqual(res["status"], "unranked")
        self.assertEqual(res["reason"], "no_ticket")
        rec = self.records()
        self.assertEqual((rec["runs"], rec["bestKills"], rec["bestTimeMs"]), (1, 200, 300000))
        self.assertEqual(self.db("SELECT COUNT(*) FROM best"), [(0,)])

    def test_unknown_ticket_is_unranked(self):
        res = self.p.submit_ok(make_run(ticket="doesnotexist1234567890"))[0]
        self.assertEqual((res["status"], res["reason"]), ("unranked", "no_ticket"))

    def test_garbage_ticket_values_are_unranked(self):
        for tk in (12345, "x" * 100, {"a": 1}, ""):
            res = self.p.submit_ok(make_run(ticket=tk))[0]
            self.assertEqual((res["status"], res["reason"]), ("unranked", "no_ticket"), tk)

    def test_other_users_ticket_is_unranked_and_stays_unused(self):
        other = Player(self.srv, "other")
        t = other.tickets(1)[0]
        self.srv.clock.advance(400)
        res = self.p.submit_ok(make_run(ticket=t["id"]))[0]
        self.assertEqual((res["status"], res["reason"]), ("unranked", "no_ticket"))
        self.assertEqual(self.db("SELECT used_at FROM tickets WHERE id=?", (t["id"],)), [(None,)])
        # 원래 주인은 그 표를 쓸 수 있다
        res = other.submit_ok(make_run(ticket=t["id"]))[0]
        self.assertEqual(res["status"], "ranked")

    def test_ticket_reuse_second_run_is_unranked(self):
        run1, tid = self.valid_ticket_run()
        self.assertEqual(self.p.submit_ok(run1)[0]["status"], "ranked")
        run2 = make_run(300000, 250, ticket=tid)
        res = self.p.submit_ok(run2)[0]
        self.assertEqual((res["status"], res["reason"]), ("unranked", "no_ticket"))
        self.assertEqual(self.records()["runs"], 2)
        self.assertEqual(self.records()["bestKills"], 250)      # 개인 기록에는 반영
        board = self.c.get("/api/leaderboard?board=kills").json
        self.assertEqual(board["entries"][0]["kills"], 200)      # 순위표에는 첫 판만

    def test_expired_ticket(self):
        t = self.p.tickets(1)[0]
        self.srv.clock.advance(14 * 86400 + 5)
        res = self.p.submit_ok(make_run(ticket=t["id"]))[0]
        self.assertEqual((res["status"], res["reason"]), ("unranked", "ticket_expired"))
        self.assertEqual(self.db("SELECT used_at FROM tickets WHERE id=?", (t["id"],)), [(None,)])

    def test_old_version_is_unranked_and_keeps_ticket(self):
        run, tid = self.valid_ticket_run(ver="0.0.9")
        res = self.p.submit_ok(run)[0]
        self.assertEqual((res["status"], res["reason"]), ("unranked", "old_version"))
        self.assertEqual(self.db("SELECT used_at FROM tickets WHERE id=?", (tid,)), [(None,)])
        self.assertEqual(self.records()["runs"], 1)

    def test_version_comparison_is_numeric(self):
        run, _ = self.valid_ticket_run(ver="0.10.0")
        self.assertEqual(self.p.submit_ok(run)[0]["status"], "ranked")

    def test_under_30_seconds_is_unranked(self):
        run, _ = self.valid_ticket_run(29000, 20)
        res = self.p.submit_ok(run)[0]
        self.assertEqual((res["status"], res["reason"]), ("unranked", "too_short"))
        run, _ = self.valid_ticket_run(30000, 20)
        self.assertEqual(self.p.submit_ok(run)[0]["status"], "ranked")

    def test_ticket_age_is_recorded(self):
        run, _ = self.valid_ticket_run()
        self.p.submit_ok(run)
        (age,) = self.db("SELECT ticket_age_s FROM runs")[0]
        self.assertAlmostEqual(age, 301, delta=2)

    def test_win_run_counts_wins_and_full_dawns(self):
        run, _ = self.valid_ticket_run(900000, 1500, full_dawn=True, bosses=3, elites=12)
        res = self.p.submit_ok(run)[0]
        self.assertEqual(res["status"], "ranked")
        rec = self.records()
        self.assertEqual((rec["wins"], rec["fullDawns"], rec["bestTimeMs"]), (1, 1, 900000))

    def test_personal_best_takes_max_and_runs_sum(self):
        self.p.submit_ok(make_run(300000, 200))
        self.p.submit_ok(make_run(120000, 500))
        rec = self.records()
        self.assertEqual((rec["runs"], rec["bestTimeMs"], rec["bestKills"]), (2, 300000, 500))


class IdempotencyTest(RunsBase):
    def test_duplicate_client_run_id(self):
        run, _ = self.valid_ticket_run()
        first = self.p.submit_ok(run)[0]
        self.assertEqual(first["status"], "ranked")
        again = self.p.submit_ok(run)[0]
        self.assertEqual(again["status"], "duplicate")
        self.assertEqual(again["first"], "ranked")
        self.assertEqual(again["rank"], first["rank"])
        rec = self.records()
        self.assertEqual((rec["runs"], rec["bestKills"]), (1, 200))
        self.assertEqual(self.db("SELECT COUNT(*) FROM runs"), [(1,)])

    def test_duplicate_does_not_double_count(self):
        run = make_run(300000, 200)
        for _ in range(3):
            self.p.submit_ok(run)
        self.assertEqual(self.records()["runs"], 1)

    def test_duplicate_inside_one_batch(self):
        run = make_run(300000, 200)
        res = self.p.submit_ok(run, run)
        self.assertEqual([r["status"] for r in res], ["unranked", "duplicate"])
        self.assertEqual(self.records()["runs"], 1)

    def test_same_client_run_id_for_different_users_is_independent(self):
        other = Player(self.srv, "other")
        run = make_run(300000, 200, cid="shared-id-0001")
        self.assertEqual(self.p.submit_ok(run)[0]["status"], "unranked")
        self.assertEqual(other.submit_ok(run)[0]["status"], "unranked")

    def test_changed_content_with_same_id_returns_first_result(self):
        run = make_run(300000, 200, cid="same-id-12345")
        self.p.submit_ok(run)
        cheat = make_run(300000, 999, cid="same-id-12345")
        res = self.p.submit_ok(cheat)[0]
        self.assertEqual(res["status"], "duplicate")
        self.assertEqual(self.records()["bestKills"], 200)

    def test_concurrent_use_of_one_ticket_ranks_exactly_one(self):
        t = self.p.tickets(1)[0]
        self.srv.clock.advance(400)
        results, errors = [], []

        def go(i):
            try:
                results.append(self.p.submit_ok(make_run(300000, 100 + i, ticket=t["id"]))[0]["status"])
            except Exception as e:      # pragma: no cover
                errors.append(e)

        threads = [threading.Thread(target=go, args=(i,)) for i in range(8)]
        for th in threads:
            th.start()
        for th in threads:
            th.join()
        self.assertEqual(errors, [])
        self.assertEqual(sorted(results), ["ranked"] + ["unranked"] * 7)


class BatchTest(RunsBase):
    def test_batch_up_to_20(self):
        res = self.p.submit_ok(*[make_run(60000, 50) for _ in range(20)])
        self.assertEqual(len(res), 20)
        self.assertEqual(self.records()["runs"], 20)

    def test_batch_limits(self):
        self.assertEqual(self.p.submit(*[make_run() for _ in range(21)]).status, 400)
        self.assertEqual(self.p.submit().status, 400)
        for body in ({}, {"runs": "x"}, {"runs": {}}, {"runs": None}):
            self.assertEqual(self.c.post("/api/runs", body).status, 400, body)

    def test_results_keep_order_and_mix_statuses(self):
        good, _ = self.valid_ticket_run(300000, 200)
        bad = make_run(kills=-3)
        notick = make_run(300000, 100)
        res = self.p.submit_ok(bad, good, notick)
        self.assertEqual([r["status"] for r in res], ["rejected", "ranked", "unranked"])
        self.assertEqual([r["clientRunId"] for r in res],
                         [bad["clientRunId"], good["clientRunId"], notick["clientRunId"]])

    def test_response_has_records(self):
        r = self.p.submit(make_run(300000, 200))
        self.assertEqual(r.json["records"]["runs"], 1)

    def test_non_dict_item_and_bad_client_run_id(self):
        res = self.p.submit_ok(5, "x", None, {"clientRunId": "short"}, {"clientRunId": 12},
                               make_run(cid="bad id with spaces"))
        self.assertEqual([r["status"] for r in res], ["rejected"] * 6)
        self.assertEqual([r["reason"] for r in res],
                         ["shape", "shape", "shape", "client_run_id", "client_run_id", "client_run_id"])
        self.assertEqual(self.db("SELECT COUNT(*) FROM runs"), [(0,)])

    def test_batch_is_atomic_on_server_error(self):
        # 중간에 서버 오류가 나도 일부만 저장되지 않는다(트랜잭션)
        import game_api
        real = game_api.process_run
        calls = []

        def boom(app, c, uid, raw, now):
            calls.append(1)
            if len(calls) == 2:
                raise RuntimeError("시험용 오류")
            return real(app, c, uid, raw, now)

        game_api.process_run = boom
        try:
            r = self.p.submit(make_run(), make_run(), make_run())
        finally:
            game_api.process_run = real
        self.assertEqual(r.status, 500)
        self.assertEqual(r.json, {"error": "server_error"})
        self.assertEqual(self.db("SELECT COUNT(*) FROM runs"), [(0,)])
        self.assertEqual(self.records()["runs"], 0)

    def test_requires_login_origin_and_json(self):
        self.assertEqual(self.srv.client().post("/api/runs", {"runs": [make_run()]}).status, 401)
        self.assertEqual(self.c.post("/api/runs", {"runs": [make_run()]}, origin=False).status, 403)
        self.assertEqual(self.c.post("/api/runs", raw_body=b"{", ).status, 400)


class RunRateLimitTest(RunsBase):
    def test_30_requests_per_hour(self):
        self.srv.clock.freeze()
        codes = [self.p.submit(make_run(60000, 10)).status for _ in range(31)]
        self.assertEqual(codes[:30], [200] * 30)
        self.assertEqual(codes[30], 429)

    def test_300_runs_per_day(self):
        for i in range(15):
            r = self.p.submit(*[make_run(kills=-1) for _ in range(20)])     # 거부된 판도 센다
            self.assertEqual(r.status, 200, i)
            self.srv.clock.advance(130)        # 시간당 요청 제한(30회)에 걸리지 않게 천천히
        r = self.p.submit(make_run(kills=-1))
        self.assertEqual(r.status, 429)
        self.assertEqual(r.json, {"error": "rate_limited"})
        self.assertGreaterEqual(int(r.header("retry-after")), 1)
        self.srv.clock.advance(86400)
        self.assertEqual(self.p.submit(make_run()).status, 200)


if __name__ == "__main__":
    unittest.main()
