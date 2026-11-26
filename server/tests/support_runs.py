"""판 제출 시험 도구: 검사를 통과하는 정상 판 생성기와 로그인한 플레이어."""
import math
import uuid


def make_run(time_ms=300000, kills=200, cid=None, ticket=None, ver="0.1.0", won=None,
             full_dawn=False, elites=0, bosses=0, **over):
    """bounds-design.json의 모든 검사를 통과하는 판. 처치 수는 분마다 고르게 나누고,
    레벨은 경험치 상한보다 한참 낮게(1 + sqrt(누적 처치) / 2) 잡는다."""
    minutes = -(-time_ms // 60000)
    base, extra = divmod(kills, minutes)
    kpm = [base + (1 if i < extra else 0) for i in range(minutes)]
    lvm, cum = [], 0
    for v in kpm:
        cum += v
        lvm.append(1 + math.isqrt(max(cum, 0)) // 2)
    run = {
        "clientRunId": cid or str(uuid.uuid4()),
        "ticket": ticket,
        "ver": ver,
        "timeMs": time_ms,
        "kills": kills,
        "level": lvm[-1],
        "won": (time_ms == 900000) if won is None else won,
        "fullDawn": full_dawn,
        "elites": elites,
        "bosses": bosses,
        "kpm": kpm,
        "lvm": lvm,
        "endedAt": 1764100000,
    }
    run.update(over)
    return run


class Player:
    """로그인한 사용자 한 명."""

    def __init__(self, srv, sub, nickname=None):
        self.srv = srv
        self.c = srv.client()
        srv.login_ok(self.c, sub=sub)
        self.sub = sub
        if nickname:
            r = self.c.put("/api/me/nickname", {"nickname": nickname})
            assert r.status == 200, r.body
        self.id = self.c.get("/api/me").json["user"]["id"]

    def tickets(self, n=1):
        r = self.c.post("/api/runs/tickets", {"count": n})
        assert r.status == 200, r.body
        return r.json["tickets"]

    def submit(self, *runs):
        return self.c.post("/api/runs", {"runs": list(runs)})

    def submit_ok(self, *runs):
        r = self.submit(*runs)
        assert r.status == 200, (r.status, r.body)
        return r.json["results"]

    def play(self, time_ms=300000, kills=200, **over):
        """표를 받고, 판 길이만큼 시계를 돌린 뒤 제출한다. 첫 결과를 돌려준다."""
        t = self.tickets(1)[0]
        self.srv.clock.advance(time_ms / 1000.0 + 1)
        return self.submit_ok(make_run(time_ms, kills, ticket=t["id"], **over))[0]
