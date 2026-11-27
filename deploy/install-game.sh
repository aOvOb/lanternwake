#!/usr/bin/env bash
# Lanternwake 서버 설치와 갱신. 서버에서 sudo로 실행한다. 여러 번 실행해도 안전하다.
#
#   sudo bash install-game.sh [--client-id <ID>.apps.googleusercontent.com]
#
# 하는 일(순서대로):
#   1. 폴더 만들기, pepper(계정 식별자 키)가 없을 때만 만들기, game.env 만들기
#   2. 정적 파일을 /srv/owl-web/game/releases/<버전>/ 에 풀고 current 링크를 한 번에 교체, 옛 릴리스는 3개만 유지
#   3. 서버 코드를 /srv/stack/game/ 에 두기
#   4. compose에 game 서비스가 없으면 그 블록만 덧붙이고, game 컨테이너 올리기
#   5. Caddyfile에 game 사이트가 없으면 그 블록만 덧붙이고, 검사한 뒤 reload
#   6. https://game.aovob7.duckdns.org/api/health 확인
#
# 이미 있는 비밀값(pepper)과 구글 클라이언트 ID는 건드리지 않는다. 다른 OwL 서비스는 멈추거나 다시 만들지 않는다.
#
# 구글 클라이언트 ID는 나중에 값만 바꿀 수 있다. 묶음 없이도 된다(설치 때 /srv/stack/game/install-game.sh 로 복사해 둔다).
#   sudo bash /srv/stack/game/install-game.sh --client-id <ID>.apps.googleusercontent.com
#
# 환경 변수(시험용): PREFIX(가짜 루트 폴더), HEALTH_URL, HEALTH_SLEEP(재시도 간격 초)
set -euo pipefail
umask 022

HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
SELF=$HERE/$(basename "${BASH_SOURCE[0]}")
PREFIX=${PREFIX:-}
STACK=$PREFIX/srv/stack
WEB=$PREFIX/srv/owl-web/game
CODE=$STACK/game
DATA=$STACK/game-data
ENVF=$STACK/game.env
COMPOSE=$STACK/docker-compose.yml
CADDYFILE=$STACK/Caddyfile
BACKUPS=$STACK/backup-game
GAME_UID=10001   # docker-compose.yml의 game.user, ops/owl-backup의 GAME_UID와 같은 값
DOMAIN=game.aovob7.duckdns.org
HEALTH_URL=${HEALTH_URL:-https://$DOMAIN/api/health}
HEALTH_SLEEP=${HEALTH_SLEEP:-5}
KEEP=3
PLACEHOLDER_ID=not-set-yet

say() { printf '== %s\n' "$*"; }
die() { printf '오류: %s\n' "$*" >&2; exit 1; }
dc() { docker compose -f "$COMPOSE" "$@"; }
# 가짜 루트(PREFIX)로 시험할 때는 소유자를 바꾸지 않는다.
own() { if [ -z "$PREFIX" ]; then chown "$@"; fi; }

usage() { awk 'NR > 1 { if ($0 !~ /^#/) exit; sub(/^# ?/, ""); print }' "$SELF"; }

# ---------------------------------------------------------------- 인자
CLIENT_ID=
while [ $# -gt 0 ]; do
  case $1 in
    --client-id)
      [ $# -ge 2 ] || die "--client-id 뒤에 값이 필요합니다."
      CLIENT_ID=$2
      shift 2
      ;;
    --client-id=*)
      CLIENT_ID=${1#*=}
      shift
      ;;
    -h | --help)
      usage
      exit 0
      ;;
    *) die "알 수 없는 인자: $1" ;;
  esac
done
if [ -n "$CLIENT_ID" ]; then
  [[ $CLIENT_ID =~ ^[A-Za-z0-9._-]+\.apps\.googleusercontent\.com$ ]] \
    || die "클라이언트 ID 형식이 아닙니다(…apps.googleusercontent.com): $CLIENT_ID"
fi

if [ -z "$PREFIX" ] && [ "$(id -u)" != 0 ]; then
  die "root로 실행해야 합니다: sudo bash $0"
fi

# 묶음(static/ 등)이 있으면 전체 설치, 없으면 --client-id만 바꾸는 모드다.
FULL=1
[ -d "$HERE/static" ] || FULL=0
if [ "$FULL" = 0 ] && [ -z "$CLIENT_ID" ]; then
  die "묶음 파일(static/)이 없습니다. 이 폴더에서는 --client-id 로 값만 바꿀 수 있습니다."
fi

command -v docker > /dev/null || die "docker가 없습니다."
command -v curl > /dev/null || die "curl이 없습니다."
[ -f "$COMPOSE" ] || die "$COMPOSE 가 없습니다. OwL 서버 구성(setup.sh)이 먼저 필요합니다."
[ -f "$CADDYFILE" ] || die "$CADDYFILE 이 없습니다."

if [ "$FULL" = 1 ]; then
  for f in VERSION static.sha256 static/index.html server/game_api.py server/bounds.json; do
    [ -f "$HERE/$f" ] || die "묶음에 $f 가 없습니다. deploy.sh로 다시 만드세요."
  done
fi

# ---------------------------------------------------------------- 1. 폴더, pepper, game.env
say "폴더와 비밀값"
install -d -m 755 "$CODE"
mkdir -p "$DATA"
chmod 700 "$DATA"
own "$GAME_UID:$GAME_UID" "$DATA"

# pepper: 없거나 비어 있을 때만 만든다. 있으면 절대 바꾸지 않는다(바꾸면 모든 계정이 새 사용자가 된다).
if [ ! -s "$DATA/pepper" ]; then
  ( umask 077; head -c 32 /dev/urandom > "$DATA/pepper" )
  chmod 600 "$DATA/pepper"
  echo "pepper를 새로 만들었습니다."
else
  echo "pepper가 이미 있어 그대로 둡니다."
fi
own "$GAME_UID:$GAME_UID" "$DATA/pepper"
# 서버는 16바이트 미만이면 시작하지 않는다. 고치지는 않고 알린다.
[ "$(wc -c < "$DATA/pepper")" -ge 16 ] || die "$DATA/pepper 가 16바이트보다 짧습니다. 직접 확인하세요(자동으로 바꾸지 않습니다)."

CURRENT_ID=
if [ -f "$ENVF" ]; then
  CURRENT_ID=$(sed -n 's/^GOOGLE_CLIENT_ID=//p' "$ENVF" | tail -n 1)
fi
if [ -n "$CLIENT_ID" ]; then
  NEW_ID=$CLIENT_ID
elif [ -n "$CURRENT_ID" ]; then
  NEW_ID=$CURRENT_ID
else
  NEW_ID=$PLACEHOLDER_ID
fi
ENV_CHANGED=0
if [ "$NEW_ID" != "$CURRENT_ID" ]; then
  tmp=$(mktemp "$ENVF.XXXXXX")
  if [ -f "$ENVF" ]; then
    grep -v '^GOOGLE_CLIENT_ID=' "$ENVF" > "$tmp" || true
  fi
  printf 'GOOGLE_CLIENT_ID=%s\n' "$NEW_ID" >> "$tmp"
  chmod 600 "$tmp"
  mv -f "$tmp" "$ENVF"
  echo "game.env: GOOGLE_CLIENT_ID를 $NEW_ID 로 적었습니다."
  # 처음 만든 경우가 아니라 값이 바뀐 경우만 컨테이너를 다시 만든다.
  if [ -n "$CURRENT_ID" ]; then ENV_CHANGED=1; fi
else
  echo "game.env: GOOGLE_CLIENT_ID 그대로($NEW_ID)."
fi

CODE_CHANGED=0
if [ "$FULL" = 1 ]; then
  # ---------------------------------------------------------------- 2. 정적 파일
  say "정적 파일"
  VER=$(tr -d '\r\n ' < "$HERE/VERSION")
  SHA=$(tr -d '\r\n ' < "$HERE/static.sha256")
  [[ $VER =~ ^[0-9A-Za-z._-]+$ ]] || die "버전 형식이 이상합니다: $VER"
  [[ $SHA =~ ^[0-9a-f]{64}$ ]] || die "static.sha256 형식이 이상합니다."
  install -d -m 755 "$WEB" "$WEB/releases"
  rm -rf "$WEB"/releases/.*.tmp "$WEB"/current.new
  REL=$VER
  # 같은 버전 이름인데 내용이 다르면(release.js 없이 다시 배포) 해시를 붙여 새 폴더로 만든다. 쓰던 폴더를 덮어쓰지 않는다.
  if [ -d "$WEB/releases/$REL" ] && [ "$(cat "$WEB/releases/$REL/.bundle-sha" 2> /dev/null || true)" != "$SHA" ]; then
    REL=$VER-${SHA:0:8}
  fi
  if [ -d "$WEB/releases/$REL" ]; then
    echo "releases/$REL 은 이미 있어 그대로 씁니다."
  else
    stage=$WEB/releases/.$REL.tmp
    mkdir -p "$stage"
    cp -a "$HERE/static/." "$stage/"
    printf '%s\n' "$SHA" > "$stage/.bundle-sha"
    chmod -R a+rX "$stage"
    mv "$stage" "$WEB/releases/$REL"
    echo "releases/$REL 에 풀었습니다."
  fi
  [ -f "$WEB/releases/$REL/index.html" ] || die "releases/$REL/index.html 이 없습니다."
  if [ -e "$WEB/current" ] && [ ! -L "$WEB/current" ]; then
    die "$WEB/current 가 링크가 아닙니다. 직접 확인하세요."
  fi
  if [ "$(readlink "$WEB/current" 2> /dev/null || true)" = "releases/$REL" ]; then
    echo "current는 이미 releases/$REL 입니다."
  else
    ln -sfn "releases/$REL" "$WEB/current.new"
    mv -T "$WEB/current.new" "$WEB/current"
    echo "current -> releases/$REL (원자적 교체)"
  fi
  touch "$WEB/releases/$REL"
  # 옛 릴리스는 최근 KEEP개만 남긴다. 지금 쓰는 릴리스는 항상 남긴다.
  cur=$(readlink "$WEB/current")
  cur=${cur#releases/}
  n=0
  while IFS= read -r d; do
    d=${d%/}
    n=$((n + 1))
    if [ "$n" -le "$KEEP" ] || [ "${d##*/}" = "$cur" ]; then continue; fi
    rm -rf -- "$d"
    echo "옛 릴리스 삭제: ${d##*/}"
  done < <(ls -1dt "$WEB"/releases/*/ 2> /dev/null || true)

  # ---------------------------------------------------------------- 3. 서버 코드
  say "서버 코드"
  for f in game_api.py bounds.json; do
    if cmp -s "$HERE/server/$f" "$CODE/$f"; then
      echo "$f 변경 없음"
    else
      install -m 644 "$HERE/server/$f" "$CODE/$f.new"
      mv -f "$CODE/$f.new" "$CODE/$f"
      CODE_CHANGED=1
      echo "$f 갱신"
    fi
  done
  # --client-id만 바꿀 때 쓰도록 이 스크립트도 같이 둔다.
  if ! cmp -s "$SELF" "$CODE/install-game.sh"; then
    install -m 755 "$SELF" "$CODE/install-game.sh"
  fi

  # ---------------------------------------------------------------- 4. compose의 game 서비스
  say "compose"
  stamp=$(date +%Y%m%d-%H%M%S)
  if grep -q '^  game:' "$COMPOSE"; then
    echo "compose에 game 서비스가 이미 있습니다."
  else
    [ -f "$HERE/stack/game.compose.yml" ] \
      || die "compose에 game 서비스가 없고 묶음에도 블록이 없습니다. OwL-server 레포를 찾지 못한 채 deploy.sh를 돌렸는지 확인하세요."
    mkdir -p "$BACKUPS/$stamp"
    cp -a "$COMPOSE" "$BACKUPS/$stamp/docker-compose.yml"
    new=$COMPOSE.new
    # services 아래 마지막 서비스 뒤(다음 최상위 키 앞)에 game 블록을 끼운다. 다른 줄은 그대로다.
    awk -v blockfile="$HERE/stack/game.compose.yml" '
      function emit(   l) { while ((getline l < blockfile) > 0) print l; close(blockfile); done = 1 }
      /^services:/ { ins = 1 }
      ins && !done && /^[A-Za-z_]/ && !/^services:/ { emit(); print "" }
      { print }
      END { if (!done) { print ""; emit() } }
    ' "$COMPOSE" > "$new"
    if ! dc_check=$(docker compose -f "$new" config -q 2>&1); then
      rm -f "$new"
      die "game 블록을 넣은 compose가 올바르지 않습니다(원본은 그대로): $dc_check"
    fi
    cat "$new" > "$COMPOSE"
    rm -f "$new"
    echo "compose에 game 서비스를 덧붙였습니다. 원본 백업: $BACKUPS/$stamp/docker-compose.yml"
  fi
fi

# ---------------------------------------------------------------- game 컨테이너
say "game 컨테이너"
EXISTED=$(dc ps -q game 2> /dev/null || true)
if [ "$ENV_CHANGED" = 1 ]; then
  dc up -d --force-recreate game
elif [ "$CODE_CHANGED" = 1 ] && [ -n "$EXISTED" ]; then
  dc up -d game
  dc restart game
else
  dc up -d game
fi

if [ "$FULL" = 1 ]; then
  # ---------------------------------------------------------------- 5. Caddyfile의 game 사이트
  say "Caddy"
  # Caddyfile은 단일 파일 바인드 마운트라서, 새 파일로 바꾸지 않고 내용만 덮어쓴다(HANDOFF.md 13장).
  site_re=${DOMAIN//./\\.}
  if grep -q "^$site_re[ {]" "$CADDYFILE"; then
    echo "Caddyfile에 $DOMAIN 사이트가 이미 있습니다."
  else
    [ -f "$HERE/stack/game.Caddyfile" ] \
      || die "Caddyfile에 game 사이트가 없고 묶음에도 블록이 없습니다. OwL-server 레포를 찾지 못한 채 deploy.sh를 돌렸는지 확인하세요."
    mkdir -p "$BACKUPS/$stamp"
    cp -a "$CADDYFILE" "$BACKUPS/$stamp/Caddyfile"
    new=$(mktemp "$CADDYFILE.XXXXXX")
    cat "$CADDYFILE" > "$new"
    if [ -n "$(tail -c 1 "$new")" ]; then echo >> "$new"; fi
    echo >> "$new"
    cat "$HERE/stack/game.Caddyfile" >> "$new"
    cat "$new" > "$CADDYFILE"
    rm -f "$new"
    echo "Caddyfile에 $DOMAIN 사이트를 덧붙였습니다. 원본 백업: $BACKUPS/$stamp/Caddyfile"
  fi
  # 검사에 실패하면 가장 최근 백업이 아니라 이번에 만든 백업으로 되돌린다. 백업이 없으면(이미 있던 경우) 되돌릴 것이 없다.
  if ! check_out=$(dc exec -T caddy caddy validate --config /etc/caddy/Caddyfile 2>&1); then
    if [ -f "$BACKUPS/$stamp/Caddyfile" ]; then
      cat "$BACKUPS/$stamp/Caddyfile" > "$CADDYFILE"
      die "Caddyfile 검사 실패, 원래 내용으로 되돌렸습니다: $check_out"
    fi
    die "Caddyfile 검사 실패(이번 실행에서 바꾼 것은 없음): $check_out"
  fi
  dc exec -T caddy caddy reload --config /etc/caddy/Caddyfile
fi

# ---------------------------------------------------------------- 6. 헬스 체크
say "헬스 체크 $HEALTH_URL"
# 처음에는 Caddy가 새 도메인의 인증서를 받는 데 1~2분 걸릴 수 있어 최대 2분 기다린다.
ok=0
for _ in $(seq 1 24); do
  if body=$(curl -fsS --max-time 10 "$HEALTH_URL" 2> /dev/null) && [[ $body == *'"ok":true'* ]]; then
    ok=1
    break
  fi
  sleep "$HEALTH_SLEEP"
done
if [ "$ok" != 1 ]; then
  echo "헬스 체크 실패. 컨테이너 로그:" >&2
  dc logs --tail 20 game >&2 || true
  die "https://$DOMAIN 이 응답하지 않습니다. 인증서 발급이 늦을 수 있으니 잠시 뒤 같은 명령을 다시 실행해도 됩니다."
fi
echo "응답: $body"

say "완료"
if [ "$FULL" = 1 ]; then echo "버전 ${VER:-?} -> releases/${REL:-?}"; fi
if [ "$NEW_ID" = "$PLACEHOLDER_ID" ]; then
  echo "구글 로그인은 아직 안 됩니다. 클라이언트 ID를 받으면:"
  echo "  sudo bash /srv/stack/game/install-game.sh --client-id <ID>.apps.googleusercontent.com"
fi
