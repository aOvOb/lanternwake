#!/usr/bin/env bash
# 스냅샷 추출: 헤드리스 Chrome 스크린샷은 검은 화면이라, 게임이 canvas.toDataURL로 기록한 PNG를 파일로 저장한다.
# 사용법: tools/snap.sh <게임 초 목록, 쉼표 구분> <출력 폴더>
# 예: SNAP_QUERY="&build=all&start=280&god=1" tools/snap.sh 285,300 /tmp/out
# 추가 주소 매개변수는 환경 변수 SNAP_QUERY로 넘긴다. start가 있으면 그 시각부터 시작한다.
# 창 크기는 SNAP_WINDOW(기본 412,915)로 바꾼다. 가로 화면 확인은 SNAP_WINDOW=915,412.
SECS_LIST="$1"
OUT="$2"
if [ -z "$SECS_LIST" ] || [ -z "$OUT" ]; then
  echo "사용법: tools/snap.sh <초 목록> <출력 폴더>"
  exit 2
fi
mkdir -p "$OUT" || exit 1
PORT=8766
CHROME="/c/Program Files/Google/Chrome/Application/chrome.exe"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

START="$(printf '%s' "$SNAP_QUERY" | sed -n 's/.*[&?]start=\([0-9]*\).*/\1/p')"
START="${START:-0}"
MAXT="$(printf '%s' "$SECS_LIST" | tr ',' '\n' | sort -n | tail -n1)"
# autotest 값은 start 뒤로 더 돌 시간이다. 마지막 스냅샷 시각 뒤 1초까지 돌린다.
SECS=$((MAXT - START + 1))
[ "$SECS" -lt 2 ] && SECS=2
BUDGET=$((SECS * 2000 + 15000))

TMP="$(mktemp -d)"
cd "$ROOT" || exit 1
python -m http.server "$PORT" --bind 127.0.0.1 >/dev/null 2>&1 &
SRV=$!

cleanup() {
  kill "$SRV" 2>/dev/null
  WINPID="$(netstat -ano 2>/dev/null | tr -d '\r' | awk -v p=":$PORT" '$2 ~ p"$" && $4=="LISTENING" {print $5}' | head -n1)"
  [ -n "$WINPID" ] && taskkill //F //PID "$WINPID" >/dev/null 2>&1
  rm -rf "$TMP"
}
trap cleanup EXIT

for _ in $(seq 1 30); do
  python -c "import urllib.request;urllib.request.urlopen('http://127.0.0.1:$PORT/index.html')" >/dev/null 2>&1 && break
  sleep 0.2
done

"$CHROME" --headless=new --disable-gpu \
  --user-data-dir="$TMP/profile" --window-size=${SNAP_WINDOW:-412,915} \
  --virtual-time-budget="$BUDGET" --dump-dom \
  "http://127.0.0.1:$PORT/index.html?autotest=$SECS&nosw=1&snap=$SECS_LIST$SNAP_QUERY" \
  >"$TMP/dom.html" 2>/dev/null

python -I - "$TMP/dom.html" "$OUT" <<'EOF'
import base64, html, re, sys
dom = open(sys.argv[1], encoding='utf-8', errors='replace').read().replace('\r', '')
out = sys.argv[2]
n = 0
for m in re.finditer(r'<pre id="snap-([0-9.]+)">(.*?)</pre>', dom, re.S):
    data = html.unescape(m.group(2)).strip()
    if not data:
        print('빈 스냅샷: ' + m.group(1))
        continue
    path = out + '/snap-' + m.group(1) + '.png'
    open(path, 'wb').write(base64.b64decode(data))
    print(path)
    n += 1
r = re.search(r'<pre id="autotest">(.*?)</pre>', dom, re.S)
if r:
    print(html.unescape(r.group(1)))
sys.exit(0 if n else 1)
EOF
