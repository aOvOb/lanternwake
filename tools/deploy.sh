#!/usr/bin/env bash
# 배포 묶음(tar.gz)을 로컬에서 만든다. 서버에는 접속하지 않는다.
# 사용법: bash tools/deploy.sh
# 결과:   deploy/dist/lanternwake-game.tar.gz
#
# 묶음 내용
#   install-game.sh      서버에서 sudo로 실행하는 설치 스크립트(deploy/install-game.sh)
#   VERSION              js/config.js의 LW.VERSION
#   static.sha256        정적 파일 전체의 해시(같은 내용인지 확인용)
#   static/              index.html, manifest.webmanifest, sw.js, js/, icons/
#   server/              game_api.py, bounds.json
#   stack/               OwL-server 레포의 game 서비스 블록과 Caddy 사이트 블록(서버에 없을 때만 쓰임)
#   stack/owl-backup     OwL-server 레포의 ops/owl-backup(game.db와 pepper 백업 포함). 설치 때 항상 /usr/local/sbin/owl-backup 에 둔다
#   BUILD-INFO           만든 시각과 커밋(참고용)
#
# 환경 변수
#   OWL_SERVER_DIR       OwL-server 레포 위치(기본: 이 저장소 옆 ../Owl-player/OwL-server)
#   NO_STACK=1           game 서비스 블록과 Caddy 블록을 넣지 않는다(서버의 compose와 Caddyfile에 game이 이미 있을 때). owl-backup은 있으면 넣는다
#   SKIP_RELEASE_CHECK=1 sw.js 버전과 목록 검사를 건너뛴다(시험용)
set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
OUT_DIR=$ROOT/deploy/dist
OUT=$OUT_DIR/lanternwake-game.tar.gz
OWL_SERVER_DIR=${OWL_SERVER_DIR:-$ROOT/../Owl-player/OwL-server}

die() { printf '오류: %s\n' "$*" >&2; exit 1; }
cd "$ROOT"

# ---------------------------------------------------------------- 버전과 필수 파일
VER=$(sed -n "s/.*LW\.VERSION = '\([^']*\)'.*/\1/p" js/config.js | tr -d '\r' | head -n 1)
[[ $VER =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || die "js/config.js에서 LW.VERSION을 읽지 못했습니다: '$VER'"

for f in index.html manifest.webmanifest sw.js js/main.js icons/icon-192.png server/game_api.py server/bounds.json deploy/install-game.sh; do
  [ -f "$f" ] || die "$f 가 없습니다."
done

# ---------------------------------------------------------------- release.js를 돌렸는지 확인
if [ "${SKIP_RELEASE_CHECK:-0}" != 1 ]; then
  grep -q "^const VERSION = '$VER';" sw.js \
    || die "sw.js의 VERSION이 $VER 가 아닙니다. node tools/release.js $VER 를 먼저 실행하세요."
  listed=$(sed -n '/@assets-start/,/@assets-end/p' sw.js | grep -o "'\./[^']*'" | tr -d "'" | sed 's|^\./||' | grep -v '^$' | LC_ALL=C sort)
  [ -n "$listed" ] || die "sw.js에서 @assets-start와 @assets-end 사이의 목록을 읽지 못했습니다."
  while IFS= read -r p; do
    [ -f "$p" ] || die "sw.js 목록에 있는 $p 파일이 없습니다. node tools/release.js $VER 를 다시 실행하세요."
  done <<< "$listed"
  actual=$( { echo index.html; echo manifest.webmanifest; find js -type f -name '*.js'; find icons -type f -name '*.png'; } | LC_ALL=C sort)
  missing=$(comm -13 <(echo "$listed") <(echo "$actual"))
  [ -z "$missing" ] || die "다음 파일이 sw.js 목록에 없습니다(오프라인에서 안 열림). node tools/release.js $VER 를 다시 실행하세요:
$missing"
fi

# ---------------------------------------------------------------- 묶음 만들기
STAGE=$(mktemp -d)
trap 'rm -rf "$STAGE"' EXIT
mkdir -p "$STAGE/static" "$STAGE/server" "$STAGE/stack"

cp -a index.html manifest.webmanifest sw.js js icons "$STAGE/static/"
cp -a server/game_api.py server/bounds.json "$STAGE/server/"
# 서버에서 CRLF가 섞이면 실행이 깨지므로 줄바꿈을 LF로 맞춘다.
tr -d '\r' < deploy/install-game.sh > "$STAGE/install-game.sh"
chmod 755 "$STAGE/install-game.sh"
printf '%s\n' "$VER" > "$STAGE/VERSION"
SHA=$( (cd "$STAGE/static" && find . -type f | LC_ALL=C sort | xargs sha256sum) | sha256sum | cut -d' ' -f1)
printf '%s\n' "$SHA" > "$STAGE/static.sha256"

# ---------------------------------------------------------------- OwL-server의 game 블록
# 게임 백업이 들어 있는 owl-backup. NO_STACK여도 넣는다(백업은 compose와 별개로 서버에 있어야 한다).
if [ -f "$OWL_SERVER_DIR/ops/owl-backup" ]; then
  tr -d '\r' < "$OWL_SERVER_DIR/ops/owl-backup" > "$STAGE/stack/owl-backup"
  chmod 755 "$STAGE/stack/owl-backup"
  bash -n "$STAGE/stack/owl-backup" || die "OwL-server의 ops/owl-backup 문법이 올바르지 않습니다."
  grep -q 'game-data/pepper' "$STAGE/stack/owl-backup" && grep -q 'game.db' "$STAGE/stack/owl-backup" \
    || die "OwL-server의 ops/owl-backup에 게임 백업이 없습니다. OwL-server를 최신으로 받으세요."
elif [ "${NO_STACK:-0}" != 1 ]; then
  die "OwL-server 레포에서 ops/owl-backup을 찾지 못했습니다: $OWL_SERVER_DIR (OWL_SERVER_DIR로 알려 주세요)"
fi

if [ "${NO_STACK:-0}" = 1 ]; then
  :
else
  [ -f "$OWL_SERVER_DIR/docker-compose.yml" ] && [ -f "$OWL_SERVER_DIR/Caddyfile" ] \
    || die "OwL-server 레포를 찾지 못했습니다: $OWL_SERVER_DIR (OWL_SERVER_DIR로 알려 주세요. 서버에 이미 game 설정이 있으면 NO_STACK=1)"
  # compose: '  game:' 줄부터 다음 서비스나 최상위 키 앞까지(끝의 빈 줄 제외)
  awk '
    /^  game:/ { p = 1 }
    p && !/^  game:/ && /^([A-Za-z_]|  [A-Za-z_])/ { exit }
    p { if ($0 ~ /^[[:space:]]*$/) { blank++; next } while (blank > 0) { print ""; blank-- } print }
  ' "$OWL_SERVER_DIR/docker-compose.yml" | tr -d '\r' > "$STAGE/stack/game.compose.yml"
  # Caddyfile: game 사이트 블록(최상위 '}'까지)
  awk '
    /^game\.aovob7\.duckdns\.org \{/ { p = 1 }
    p { print }
    p && /^\}/ { exit }
  ' "$OWL_SERVER_DIR/Caddyfile" | tr -d '\r' > "$STAGE/stack/game.Caddyfile"
  grep -q '^  game:' "$STAGE/stack/game.compose.yml" && grep -q 'image: python:3.12-alpine' "$STAGE/stack/game.compose.yml" \
    || die "OwL-server의 docker-compose.yml에서 game 서비스를 찾지 못했습니다. OwL-server를 최신으로 받으세요."
  grep -q '^game\.aovob7\.duckdns\.org {' "$STAGE/stack/game.Caddyfile" && [ "$(tail -n 1 "$STAGE/stack/game.Caddyfile")" = "}" ] \
    || die "OwL-server의 Caddyfile에서 game 사이트를 찾지 못했습니다. OwL-server를 최신으로 받으세요."
fi

# NO_STACK이고 owl-backup도 없으면 빈 stack/ 폴더는 지운다.
rmdir "$STAGE/stack" 2> /dev/null || true

game_rev=$(git rev-parse --short HEAD 2> /dev/null || echo unknown)
owl_rev=unknown
if [ "${NO_STACK:-0}" != 1 ]; then owl_rev=$(git -C "$OWL_SERVER_DIR" rev-parse --short HEAD 2> /dev/null || echo unknown); fi
printf 'version %s\nstatic.sha256 %s\ngame-repo %s\nowl-server %s\nbuilt %s\n' \
  "$VER" "$SHA" "$game_rev" "$owl_rev" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$STAGE/BUILD-INFO"

mkdir -p "$OUT_DIR"
tar -czf "$OUT" -C "$STAGE" .

echo "버전 $VER, 정적 파일 해시 ${SHA:0:12}"
echo "만들었습니다: $OUT ($(du -h "$OUT" | cut -f1))"
echo "다음: deploy/README.md 의 명령으로 서버에 옮겨 실행하세요."
