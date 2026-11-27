"""S18: tools/gen-bounds.js와 server/bounds.json 읽기. node가 없으면 gen-bounds 시험은 건너뛴다."""
import json
import os
import shutil
import subprocess
import tempfile
import unittest

from support import FIXTURES, HERE, SERVER_DIR
import game_api

ROOT = os.path.dirname(SERVER_DIR)
GEN = os.path.join(ROOT, "tools", "gen-bounds.js")
EVENTS_OF = os.path.join(HERE, "events_of.js")
WAVES_DESIGN = os.path.join(FIXTURES, "waves-design.js")
WAVES_REAL = os.path.join(ROOT, "js", "data", "waves.js")
NODE = shutil.which("node")

# DESIGN.md 5.4 표에서 직접 옮긴 값. gen-bounds와 별개의 정답이다.
DESIGN_ELITES = [[120, 1], [210, 1], [240, 1], [360, 1], [480, 2], [540, 1], [660, 2], [720, 1], [780, 1], [780, 1]]
DESIGN_BOSSES = [300, 600, 840]


def xp_req(n):
    """DESIGN.md 3.9. 레벨 n에서 n+1로 가는 경험치."""
    if n < 20:
        return 5 + 10 * (n - 1)
    r19 = 5 + 10 * 18
    if n < 40:
        return r19 + 13 * (n - 19)
    return r19 + 13 * 20 + 16 * (n - 39)


def run_node(*args):
    return subprocess.run([NODE] + list(args), capture_output=True, text=True, encoding="utf-8", timeout=60)


@unittest.skipUnless(NODE, "node가 없음")
class GenBoundsTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)
        self.out = os.path.join(self.tmp.name, "bounds.json")

    def tearDown(self):
        self.tmp.cleanup()

    def gen(self, waves=WAVES_DESIGN):
        r = run_node(GEN, "--waves", waves, "--out", self.out)
        self.assertEqual(r.returncode, 0, r.stderr)
        with open(self.out, encoding="utf-8") as f:
            return json.load(f)

    def test_events_match_design_table(self):
        b = self.gen()
        self.assertEqual(b["elites"], DESIGN_ELITES)
        self.assertEqual(b["bosses"], DESIGN_BOSSES)
        self.assertEqual(b["lastBossT"], 840)
        self.assertEqual(b["winMs"], 900000)
        self.assertEqual(b["maxLevel"], 200)

    def test_xp_table_matches_design_formula(self):
        b = self.gen()
        table = b["xpToReach"]
        self.assertEqual(len(table), 201)
        self.assertEqual(table[:4], [0, 0, 5, 20])
        total = 0
        for level in range(1, 200):
            self.assertEqual(table[level], total, level)
            total += xp_req(level)
        self.assertEqual(table[200], total)

    def test_fixture_matches_generator_output(self):
        b = self.gen()
        with open(os.path.join(FIXTURES, "bounds-design.json"), encoding="utf-8") as f:
            fixture = json.load(f)
        for key in ("winMs", "maxLevel", "elites", "bosses", "lastBossT", "xpToReach"):
            self.assertEqual(fixture[key], b[key], key)

    def test_real_waves_events_match_gen_output(self):
        """S18 완료 기준: 결과의 엘리트, 보스 시각이 js/data/waves.js의 LW.EVENTS와 같다."""
        b = self.gen(WAVES_REAL)
        r = run_node(EVENTS_OF, WAVES_REAL)
        self.assertEqual(r.returncode, 0, r.stderr)
        expect = json.loads(r.stdout)
        self.assertEqual(b["elites"], expect["elites"])
        self.assertEqual(b["bosses"], expect["bosses"])

    def test_committed_bounds_json_matches_current_game_data(self):
        """리뷰 2 B1: 커밋된 server/bounds.json의 자동 영역이 지금 게임 데이터(config, util, waves)에서
        만든 결과와 같아야 한다. 이벤트를 바꾸고 gen-bounds를 다시 돌리지 않으면 여기서 실패한다."""
        committed = os.path.join(SERVER_DIR, "bounds.json")
        shutil.copyfile(committed, self.out)          # 손으로 정한 값(kpmMax, 버전)을 그대로 이어받는다
        r = run_node(GEN, "--out", self.out)
        self.assertEqual(r.returncode, 0, r.stderr)
        with open(committed, encoding="utf-8") as f:
            want = json.load(f)
        with open(self.out, encoding="utf-8") as f:
            got = json.load(f)
        self.assertEqual(got, want, "server/bounds.json이 낡았다. node tools/gen-bounds.js를 실행하고 커밋하라")
        self.assertIn("unchanged", r.stdout)
        self.assertTrue(want["elites"] and want["bosses"], "S8 이후에는 엘리트와 보스 목록이 비어 있으면 안 된다")

    def test_manual_values_are_preserved(self):
        self.gen()
        with open(self.out, encoding="utf-8") as f:
            b = json.load(f)
        b["kpmMax"] = [7] * 15
        b["minRankedVersion"] = "2.3.4"
        b["elites"] = []                     # 자동 영역은 덮어써진다
        with open(self.out, "w", encoding="utf-8") as f:
            json.dump(b, f)
        b2 = self.gen()
        self.assertEqual(b2["kpmMax"], [7] * 15)
        self.assertEqual(b2["minRankedVersion"], "2.3.4")
        self.assertEqual(b2["elites"], DESIGN_ELITES)

    def test_defaults_for_manual_values(self):
        b = self.gen()
        self.assertEqual(b["kpmMax"], [1200] * 15)
        self.assertRegex(b["minRankedVersion"], r"^\d+\.\d+\.\d+$")

    def test_second_run_is_unchanged(self):
        self.gen()
        r = run_node(GEN, "--waves", WAVES_DESIGN, "--out", self.out)
        self.assertIn("unchanged", r.stdout)

    def test_elite_without_n_counts_as_one_and_unsorted_events_are_sorted(self):
        waves = os.path.join(self.tmp.name, "w.js")
        with open(waves, "w", encoding="utf-8") as f:
            f.write("LW.EVENTS=[{t:500,type:'boss'},{t:100,type:'elite'},{t:50,type:'swarm',n:9},{t:20,type:'boss'}];")
        b = self.gen(waves)
        self.assertEqual((b["elites"], b["bosses"], b["lastBossT"]), ([[100, 1]], [20, 500], 500))

    def test_no_events_gives_empty_lists(self):
        waves = os.path.join(self.tmp.name, "w.js")
        with open(waves, "w", encoding="utf-8") as f:
            f.write("LW.EVENTS=[];")
        b = self.gen(waves)
        self.assertEqual((b["elites"], b["bosses"], b["lastBossT"]), ([], [], 0))

    def test_broken_input_fails_with_message(self):
        waves = os.path.join(self.tmp.name, "w.js")
        with open(waves, "w", encoding="utf-8") as f:
            f.write("throw new Error('깨짐');")
        r = run_node(GEN, "--waves", waves, "--out", self.out)
        self.assertEqual(r.returncode, 1)
        self.assertIn("gen-bounds", r.stderr)
        self.assertFalse(os.path.exists(self.out))
        r = run_node(GEN, "--bogus", "x")
        self.assertEqual(r.returncode, 1)

    def test_output_is_loadable_by_server(self):
        self.gen()
        b = game_api.load_bounds(self.out)
        self.assertEqual(b.win_ms, 900000)


class BoundsClassTest(unittest.TestCase):
    def setUp(self):
        self.b = game_api.load_bounds(os.path.join(FIXTURES, "bounds-design.json"))

    def test_events_before(self):
        b = self.b
        self.assertEqual(b.elites_before(119999), 0)
        self.assertEqual(b.elites_before(120000), 1)
        self.assertEqual(b.elites_before(300000), 3)
        self.assertEqual(b.elites_before(480000), 6)       # 8:00에 2마리
        self.assertEqual(b.elites_before(900000), 12)
        self.assertEqual(b.bosses_before(299999), 0)
        self.assertEqual(b.bosses_before(300000), 1)
        self.assertEqual(b.bosses_before(900000), 3)

    def test_fields(self):
        b = self.b
        self.assertEqual((b.win_ms, b.max_level, b.last_boss_ms), (900000, 200, 840000))
        self.assertEqual(b.min_ranked, (0, 1, 0))
        self.assertEqual(len(b.kpm_max), 15)
        self.assertEqual(b.xp_to_reach[11], 500)

    def test_committed_server_bounds_json_is_valid(self):
        b = game_api.load_bounds(os.path.join(SERVER_DIR, "bounds.json"))
        self.assertEqual(b.win_ms, 900000)
        self.assertEqual(b.xp_to_reach[2], 5)

    def test_bad_files_are_rejected(self):
        with open(os.path.join(FIXTURES, "bounds-design.json"), encoding="utf-8") as f:
            good = json.load(f)
        for key, value in (("winMs", "x"), ("xpToReach", [0, 0]), ("kpmMax", [1]), ("minRankedVersion", "1.0"),
                           ("elites", [[1]]), ("bosses", None)):
            bad = dict(good)
            bad[key] = value
            with self.assertRaises(ValueError, msg=key):
                game_api.Bounds(bad)
        bad = dict(good)
        del bad["lastBossT"]
        with self.assertRaises(ValueError):
            game_api.Bounds(bad)


if __name__ == "__main__":
    unittest.main()
