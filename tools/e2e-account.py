#!/usr/bin/env python3
"""계정 종단 검사: 개발 서버(tools/devserver.py)와 실시간 헤드리스 Chrome으로
가짜 로그인 -> 판 제출 -> 닉네임 -> 순위표 -> 로그아웃 화면까지 돌리고 스냅샷을 저장한다.

사용법: python tools/e2e-account.py [스냅샷 폴더] [--port 8090] [--seconds 40]
- 서버의 경과 시간 검사(elapsed) 때문에 가상 시간이 아니라 실제 시간으로 돈다(약 1분).
- 통과하면 종료 코드 0. 스냅샷은 PNG로 저장한다(ACCOUNT, RANKING 화면 확인용).
"""
import argparse
import base64
import json
import os
import shutil
import sqlite3
import subprocess
import sys
import tempfile
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CHROME = os.environ.get("CHROME", r"C:\Program Files\Google\Chrome\Application\chrome.exe")
MARK = "lw-e2e-profile-marker"


def kill_tree(p):
    if os.name == "nt":
        subprocess.run(["taskkill", "/T", "/F", "/PID", str(p.pid)], capture_output=True)
    else:
        p.terminate()


def kill_chrome():
    if os.name == "nt":
        ps = ("Get-CimInstance Win32_Process -Filter \"Name='chrome.exe'\" | Where-Object { $_.CommandLine -like '*%s*' }"
              " | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }" % MARK)
        subprocess.run(["powershell", "-NoProfile", "-Command", ps], capture_output=True)


def seed(port, n):
    """개발 서버에 가짜 플레이어 n명을 만들고 30초짜리 판을 올린다(표를 먼저 받고 32초 기다려 elapsed 검사를 통과시킨다)."""
    import http.client

    def call(method, path, cookie, body=None, ip="10.7.0.1"):
        c = http.client.HTTPConnection("127.0.0.1", port, timeout=20)
        h = {"Origin": "http://localhost:%d" % port, "Content-Type": "application/json", "X-Real-IP": ip}
        if cookie:
            h["Cookie"] = cookie
        c.request(method, path, body=json.dumps(body).encode() if body is not None else (b"{}" if method != "GET" else None), headers=h)
        r = c.getresponse()
        data = r.read()
        return r, (json.loads(data) if data and data[:1] in b"{[" else None)

    players = []
    for i in range(n):
        ip = "10.7.%d.%d" % (i // 200, i % 200 + 1)       # 요청 제한(IP별)에 걸리지 않게 사용자마다 다른 주소로 보낸다
        r, _ = call("GET", "/api/dev/login?name=seed%d" % i, None, ip=ip)
        cookie = r.getheader("Set-Cookie").split(";")[0]
        r, t = call("POST", "/api/runs/tickets", cookie, {"count": 1}, ip=ip)
        call("PUT", "/api/me/nickname", cookie, {"nickname": "Seed%02d" % i}, ip=ip)
        players.append((cookie, t["tickets"][0]["id"], i, ip))
    print("시드: 표 %d장을 받았다. 32초 기다린다" % len(players), flush=True)
    time.sleep(32)
    for cookie, tid, i, ip in players:
        kills = 20 + (i * 37) % 90
        run = {"clientRunId": "seed-run-%04d" % i, "ticket": tid, "ver": "0.2.0", "timeMs": 30000 + (i % 7) * 1000, "kills": kills,
               "level": 1, "won": False, "fullDawn": False, "elites": 0, "bosses": 0,
               "kpm": [kills], "lvm": [1], "endedAt": int(time.time())}
        r, d = call("POST", "/api/runs", cookie, {"runs": [run]}, ip=ip)
        if not d or d["results"][0]["status"] not in ("ranked", "unranked"):
            print("시드 실패:", i, d)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("out", nargs="?", default=os.path.join(tempfile.gettempdir(), "lw-e2e-snaps"))
    ap.add_argument("--port", type=int, default=8090)
    ap.add_argument("--seconds", type=int, default=40, help="판을 이 시각에 사망시킨다(30초 미만은 순위 제외)")
    ap.add_argument("--window", default="412,915", help="창 크기. 가로 화면은 915,412")
    ap.add_argument("--seed", type=int, default=0, help="먼저 가짜 플레이어 N명의 판을 서버에 올려 순위표를 채운다(약 35초 더 걸림)")
    ap.add_argument("--offline", action="store_true", help="계정 서버 없이 띄운다(오프라인 표시와 게임 정상 동작 검사)")
    ap.add_argument("--query", default="", help="주소 매개변수를 더한다(예: &debug=1)")
    a = ap.parse_args()
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8")
    os.makedirs(a.out, exist_ok=True)
    work = tempfile.mkdtemp(prefix="lw-e2e-")
    data, sink, profile = (os.path.join(work, n) for n in ("data", "sink", "profile"))
    srv = subprocess.Popen([sys.executable, os.path.join(ROOT, "tools", "devserver.py"), "--port", str(a.port),
                            "--api-port", str(a.port + 1), "--data", data, "--sink", sink] + (["--no-api"] if a.offline else []),
                           stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, encoding="utf-8")
    chrome = None
    ok = False
    try:
        line = ""
        for _ in range(10):            # 계정 서버의 시작 줄이 먼저 나올 수 있다
            line = srv.stdout.readline()
            if line.startswith("ready") or not line:
                break
        if not line.startswith("ready"):
            print("개발 서버가 뜨지 않음:", line)
            return 1
        if a.seed:
            seed(a.port, a.seed)
        url = ("http://localhost:%d/index.html?autotest=%d&rt=1&acct=1&sink=1&devlogin=e2e&god=1&dieat=%d&flow=acct&guestrec=1&nosw=1%s"
               % (a.port, a.seconds + 30, a.seconds, a.query))
        if a.offline:
            url = ("http://localhost:%d/index.html?autotest=%d&rt=1&acct=1&sink=1&devlogin=e2e&god=1&dieat=%d&flow=acct&nosw=1%s"
                   % (a.port, a.seconds + 30, a.seconds, a.query))
        chrome = subprocess.Popen([CHROME, "--headless=new", "--disable-gpu", "--user-data-dir=" + profile, "--window-size=" + a.window,
                                   "--disable-renderer-backgrounding", "--disable-background-timer-throttling",
                                   "--disable-backgrounding-occluded-windows", "--no-first-run", "--" + MARK, url],
                                  stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        res = os.path.join(sink, "result.json")
        end = time.time() + a.seconds * 2 + 120
        while time.time() < end and not os.path.exists(res):
            time.sleep(1)
        if not os.path.exists(res):
            print("결과가 오지 않음")
            return 1
        time.sleep(2)           # 스냅샷 업로드가 끝나기를 기다린다
        d = json.load(open(res, encoding="utf-8"))
        for name in sorted(os.listdir(sink)):
            if name.endswith(".b64"):
                png = os.path.join(a.out, name[:-4] + ".png")
                with open(png, "wb") as f:
                    f.write(base64.b64decode(open(os.path.join(sink, name)).read()))
                print("snap:", png)
        acc = d.get("account", {})
        if a.offline:
            print("오류:", d.get("errors"))
            print("판: gameTime=%s kills=%s" % (d.get("gameTime"), d.get("kills")))
            print("계정:", json.dumps(acc, ensure_ascii=False))
            checks = [
                ("자동 검사 오류 없음(서버가 없어도 게임은 정상)", d.get("ok")),
                ("판이 끝까지 진행됨", (d.get("gameTime") or 0) >= a.seconds - 1),
                ("계정 상태가 offline", acc.get("status") == "offline" and acc.get("netUp") is False),
                ("로그인되지 않은 게스트", acc.get("loggedIn") is False),
                ("결과 줄은 로그인 안내", any("로그인하면 순위에" in x for x in acc.get("flow", [])) or "로그인하면" in str(acc.get("resultLine"))),
                ("순위표는 비어 있음(저장본 없음)", acc.get("boards", {}).get("time", {}).get("rows") == 0 and acc.get("boards", {}).get("time", {}).get("stale") is True),
            ]
            ok = True
            for name, passed in checks:
                print(("통과  " if passed else "실패  ") + name)
                ok = ok and bool(passed)
            return 0 if ok else 1
        con = sqlite3.connect("file:%s?mode=ro" % os.path.join(data, "game.db").replace("\\", "/"), uri=True)
        # 시드 플레이어가 있어도 이 검사의 사용자(닉네임을 AutoOwl로 바꾼 계정)만 본다
        runs = con.execute("SELECT r.status, r.reason, r.time_ms, r.kills, r.level FROM runs r JOIN users u ON u.id = r.user_id"
                           " WHERE u.nickname = 'AutoOwl'").fetchall()
        users = con.execute("SELECT nickname, nickname_set FROM users WHERE nickname = 'AutoOwl'").fetchall()
        total = con.execute("SELECT COUNT(*) FROM runs").fetchone()[0]
        rec = con.execute("SELECT r.best_time_ms, r.best_kills, r.best_level, r.runs FROM records r JOIN users u ON u.id = r.user_id"
                          " WHERE u.nickname = 'AutoOwl'").fetchone()
        st = con.execute("SELECT s.json FROM settings s JOIN users u ON u.id = s.user_id WHERE u.nickname = 'AutoOwl'").fetchone()
        best = con.execute("SELECT b.board, b.v1 FROM best b JOIN users u ON u.id = b.user_id WHERE u.nickname = 'AutoOwl' ORDER BY b.board").fetchall()
        con.close()
        print("오류:", d.get("errors"))
        print("판: died=%s gameTime=%s kills=%s level=%s" % (d.get("died"), d.get("gameTime"), d.get("kills"), d.get("level")))
        print("계정:", json.dumps(acc, ensure_ascii=False))
        print("서버 runs(이 사용자):", runs, "전체", total)
        print("서버 users(이 사용자):", users)
        print("서버 records:", rec, "settings:", st and st[0], "best:", best)
        checks = [
            ("자동 검사 오류 없음", d.get("ok")),
            ("서버가 확인됨", acc.get("status") == "online" and acc.get("netUp") is True),
            ("판이 제출되어 ranked", len(runs) == 1 and runs[0][0] == "ranked"),
            ("결과 줄에 순위 반영", any("순위 반영" in x for x in acc.get("flow", []))),
            ("닉네임이 서버에 저장", users == [("AutoOwl", 1)]),
            ("게스트 기록이 한 번 합쳐짐(최고 120초, 횟수 3+1)", rec is not None and rec[0] == 120000 and rec[3] == 4),
            ("게스트 기록은 순위표에 안 들어감(순위표 값은 이번 판)", best == [("kills", d.get("kills")), ("time", 40017)] or (len(best) == 2 and dict(best).get("time") == runs[0][2])),
            ("소리 꺼짐 설정이 서버에 올라감", st is not None and json.loads(st[0]).get("sound") is False),
            ("순위표 두 보드에 기록", acc.get("boards", {}).get("time", {}).get("rows", 0) >= 1 and acc.get("boards", {}).get("kills", {}).get("rows", 0) >= 1),
            ("마지막은 로그아웃된 게스트", acc.get("loggedIn") is False),
            ("제출 뒤 대기열이 비었음", any("queue=0" in x for x in acc.get("flow", []))),
        ]
        ok = True
        for name, passed in checks:
            print(("통과  " if passed else "실패  ") + name)
            ok = ok and bool(passed)
    finally:
        if chrome:
            kill_chrome()
            try:
                chrome.kill()
            except OSError:
                pass
        kill_tree(srv)
        time.sleep(1)
        shutil.rmtree(work, ignore_errors=True)
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
