#!/usr/bin/env bash
# 실시간 성능 측정: 헤드리스 Chrome을 --virtual-time-budget 없이 실제 시간으로 돌린다.
# 가상 시간에서는 performance.now가 멈춰 update, render 시간을 잴 수 없기 때문이다.
# 페이지(?bench=초)가 끝나면 결과 JSON을 POST /__bench 로 보내고, 이 스크립트가 그것을 받아 출력한 뒤 Chrome을 끈다.
# 사용법: tools/bench.sh [초, 기본 20]
# 환경 변수:
#   BENCH_QUERY   추가 주소 매개변수(예: "&ql=0&burn=25"). 기본은 13:00 구간(start=780, god=1, build=all)
#   BENCH_WINDOW  창 크기(기본 412,915)
#   BENCH_DSF     기기 픽셀 비율(기본 1). 휴대폰 화소 부하를 보려면 2
# 종료 코드: 결과를 받으면 0, 아니면 1
export PYTHONIOENCODING=utf-8
SECS="${1:-20}"
PORT=8767
CHROME="/c/Program Files/Google/Chrome/Application/chrome.exe"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TMP="$(mktemp -d)"
OUT="$TMP/bench.json"
PROFILE="$TMP/profile"
cd "$ROOT" || exit 1

cat >"$TMP/srv.py" <<'PY'
import http.server, sys
out = sys.argv[2]
class H(http.server.SimpleHTTPRequestHandler):
    def do_POST(self):
        n = int(self.headers.get('Content-Length') or 0)
        body = self.rfile.read(n)
        if self.path == '/__bench':
            with open(out, 'wb') as f:
                f.write(body)
        self.send_response(204)
        self.end_headers()
    def log_message(self, *a):
        pass
http.server.ThreadingHTTPServer(('127.0.0.1', int(sys.argv[1])), H).serve_forever()
PY
python "$TMP/srv.py" "$PORT" "$OUT" >/dev/null 2>&1 &
SRV=$!

cleanup() {
  kill "$SRV" 2>/dev/null
  WINPID="$(netstat -ano 2>/dev/null | tr -d '\r' | awk -v p=":$PORT" '$2 ~ p"$" && $4=="LISTENING" {print $5}' | head -n1)"
  [ -n "$WINPID" ] && taskkill //F //PID "$WINPID" >/dev/null 2>&1
  # 이 스크립트가 띄운 Chrome만 끈다(프로필 경로로 구분). 다른 Chrome 창은 건드리지 않는다.
  WINPROFILE="$(cygpath -w "$PROFILE" 2>/dev/null)"
  powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \"Name='chrome.exe'\" | Where-Object { \$_.CommandLine -like '*bench-profile-marker*' } | ForEach-Object { Stop-Process -Id \$_.ProcessId -Force -ErrorAction SilentlyContinue }" >/dev/null 2>&1
  sleep 1
  rm -rf "$TMP"
}
trap cleanup EXIT

for _ in $(seq 1 30); do
  python -c "import urllib.request;urllib.request.urlopen('http://127.0.0.1:$PORT/index.html')" >/dev/null 2>&1 && break
  sleep 0.2
done

"$CHROME" --headless=new --disable-gpu --user-data-dir="$PROFILE" \
  --window-size=${BENCH_WINDOW:-412,915} --force-device-scale-factor=${BENCH_DSF:-1} \
  --disable-renderer-backgrounding --disable-background-timer-throttling --disable-backgrounding-occluded-windows \
  --no-first-run --no-default-browser-check --bench-profile-marker \
  "http://127.0.0.1:$PORT/index.html?bench=$SECS&nosw=1$BENCH_QUERY" >/dev/null 2>&1 &

# 측정 시간의 2배에 여유 60초까지 기다린다
for _ in $(seq 1 $((SECS * 2 + 60))); do
  [ -s "$OUT" ] && break
  sleep 1
done

if [ ! -s "$OUT" ]; then
  echo "bench 결과 없음"
  exit 1
fi
cat "$OUT"
echo
python -X utf8 -c "
import json, sys
d = json.load(open(sys.argv[1], encoding='utf-8'))
b = d.get('bench', {})
print('ok=%s reached=%s errors=%d' % (d.get('ok'), d.get('reached'), len(d.get('errors', []))))
print('fps %s, frame mean %s ms, p95 %s ms, p99 %s ms, max %s ms, >20ms %s/%s' % (b.get('fps'), b.get('frameMeanMs'), b.get('frameP95Ms'), b.get('frameP99Ms'), b.get('frameMaxMs'), b.get('over20ms'), b.get('frames')))
print('update %s ms, render %s ms, 합계 %.3f ms, 적 최대 %s' % (b.get('updateMs'), b.get('renderMs'), (b.get('updateMs') or 0) + (b.get('renderMs') or 0), b.get('maxEnemies')))
print('화질 %s -> %s (내림 %s회), DPR %s' % (b.get('qualityStart'), b.get('qualityEnd'), b.get('qualityDrops'), b.get('dpr')))
sys.exit(0 if d.get('ok') and d.get('reached') else 1)
" "$OUT"
