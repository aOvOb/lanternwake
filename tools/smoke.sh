#!/usr/bin/env bash
# 자동 검사: 로컬 서버를 띄우고 헤드리스 Chrome으로 ?autotest=N 을 실행해 결과 JSON을 출력한다.
# 사용법: tools/smoke.sh [게임 시간 초, 기본 60]
# 추가 주소 매개변수는 환경 변수 SMOKE_QUERY로 넘긴다(예: SMOKE_QUERY="&stress=1&debug=1").
# 통과 조건: JSON이 있고, ok(오류 없음)이고, reached(목표 시각 도달 또는 승리)일 것.
# 사망으로 끝나는 검사 옵션은 SMOKE_QUERY에 &god=1을 더하거나, 환경 변수 SMOKE_ALLOW_DEATH=1로 사망 종료를 허용한다.
# 종료 코드: 통과면 0, 아니면 1
export PYTHONIOENCODING=utf-8
SECS="${1:-60}"
PORT=8765
CHROME="/c/Program Files/Google/Chrome/Application/chrome.exe"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# 가상 시간 예산(ms): 게임 시간의 2배에 여유 15초
BUDGET=$((SECS * 2000 + 15000))

TMP="$(mktemp -d)"
cd "$ROOT" || exit 1
python -m http.server "$PORT" --bind 127.0.0.1 >/dev/null 2>&1 &
SRV=$!

cleanup() {
  kill "$SRV" 2>/dev/null
  # Windows 네이티브 python이면 kill로 안 죽을 수 있어 포트 점유 프로세스도 정리한다
  WINPID="$(netstat -ano 2>/dev/null | tr -d '\r' | awk -v p=":$PORT" '$2 ~ p"$" && $4=="LISTENING" {print $5}' | head -n1)"
  [ -n "$WINPID" ] && taskkill //F //PID "$WINPID" >/dev/null 2>&1
  rm -rf "$TMP"
}
trap cleanup EXIT

# 서버가 뜰 때까지 잠깐 기다린다
for _ in $(seq 1 30); do
  python -c "import urllib.request;urllib.request.urlopen('http://127.0.0.1:$PORT/index.html')" >/dev/null 2>&1 && break
  sleep 0.2
done

DOM="$(timeout $((SECS * 3 + 90)) "$CHROME" --headless=new --disable-gpu \
  --user-data-dir="$TMP/profile" --window-size=412,915 \
  --virtual-time-budget="$BUDGET" --dump-dom \
  "http://127.0.0.1:$PORT/index.html?autotest=$SECS&nosw=1$SMOKE_QUERY" 2>/dev/null)"

JSON="$(printf '%s' "$DOM" | tr -d '\r' | python -c "
import re, sys
html = sys.stdin.read()
m = re.search(r'<pre id=\"autotest\">(.*?)</pre>', html, re.S)
if m:
    import html as h
    print(h.unescape(m.group(1)))
")"

if [ -z "$JSON" ]; then
  echo "autotest JSON 없음"
  exit 1
fi
echo "$JSON"
printf '%s' "$JSON" | SMOKE_ALLOW_DEATH="$SMOKE_ALLOW_DEATH" python -c "
import json, os, sys
d = json.load(sys.stdin)
allow = os.environ.get('SMOKE_ALLOW_DEATH') == '1'
if not d.get('ok'):
    print('실패: 오류가 수집됨')
    sys.exit(1)
if not d.get('reached') and not allow:
    print('실패: 목표 시각에 도달하지 못함(died=%s). 사망이 정상인 검사면 god=1 또는 SMOKE_ALLOW_DEATH=1을 쓴다' % d.get('died'))
    sys.exit(1)
"
