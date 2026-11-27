#!/usr/bin/env bash
# install-game.sh를 실제 서버 없이 시험한다. 사용법: bash deploy/test-install.sh
#
# 가짜 루트(PREFIX) 폴더를 만들고, docker와 curl은 가짜 명령으로 바꿔 끼운 뒤
# 설치를 여러 번 실행해 멱등성, 비밀값 유지, --client-id, 릴리스 3개 유지, 되돌리기를 확인한다.
# Git Bash에는 심볼릭 링크 권한이 없으므로 MSYS의 winsymlinks:lnk 방식을 쓴다.
set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
case $(uname -s) in MINGW* | MSYS*) export MSYS=winsymlinks:lnk ;; esac

T=$(mktemp -d)
trap 'rm -rf "$T"' EXIT
FAKE=$T/root
STUBS=$T/stubs
LOG=$T/docker.log
mkdir -p "$FAKE/srv/stack" "$STUBS" "$T/bundles"
: > "$LOG"

pass=0
fail=0
check() { # 설명, 조건 명령...
  local msg=$1
  shift
  if "$@" > /dev/null 2>&1; then
    pass=$((pass + 1))
    echo "  ok   $msg"
  else
    fail=$((fail + 1))
    echo "  FAIL $msg"
  fi
}

# ---------------------------------------------------------------- 가짜 서버 환경
cat > "$FAKE/srv/stack/docker-compose.yml" <<'EOF'
services:
  caddy:
    image: caddy:2
    restart: unless-stopped

  yubal:
    build: ./yubal-image
    restart: unless-stopped

networks:
  tunnel:
    ipam:
      config:
        - subnet: 172.30.0.0/24
EOF
printf '{\n\tlog default {\n\t\tlevel WARN\n\t}\n}\n\naovob7.duckdns.org {\n\trespond "aovob7 home" 200\n}' > "$FAKE/srv/stack/Caddyfile"  # 끝 줄바꿈 없음

# 가짜 docker: 인자를 기록한다. ps -q game은 $T/running 파일이 있을 때만 값을 낸다.
# FAIL_VALIDATE 파일이 있으면 caddy validate가 실패한다.
cat > "$STUBS/docker" <<EOF
#!/usr/bin/env bash
echo "docker \$*" >> "$LOG"
case "\$*" in
  *"ps -q game"*) [ -f "$T/running" ] && echo abc123 ;;
  *"caddy validate"*) [ -f "$T/FAIL_VALIDATE" ] && { echo "bad caddyfile" >&2; exit 1; } ;;
  *"up -d"*) touch "$T/running" ;;
esac
exit 0
EOF
cat > "$STUBS/curl" <<'EOF'
#!/usr/bin/env bash
echo '{"ok":true,"version":"1.0.0"}'
EOF
chmod +x "$STUBS/docker" "$STUBS/curl"
# Git Bash의 mv -T는 .lnk 방식 링크의 이름을 망가뜨린다. 시험에서만 링크 교체를 흉내 낸다(실서버는 GNU mv -T의 rename).
case $(uname -s) in
  MINGW* | MSYS*)
    cat > "$STUBS/mv" <<'EOS'
#!/usr/bin/env bash
if [ "${1:-}" = "-T" ] && [ -L "$2" ]; then
  target=$(readlink "$2")
  rm -f "$2" "$3"
  ln -s "$target" "$3"
else
  exec /usr/bin/mv "$@"
fi
EOS
    chmod +x "$STUBS/mv"
    ;;
esac

run() { # 묶음 폴더, 추가 인자...
  local b=$1
  shift
  PATH="$STUBS:$PATH" PREFIX="$FAKE" HEALTH_SLEEP=0 bash ${XTRACE:+-x} "$b/install-game.sh" "$@"
}

snapshot() { # 가짜 루트의 모든 파일 내용과 링크 대상
  (
    cd "$FAKE"
    find . | LC_ALL=C sort | while IFS= read -r p; do
      if [ -L "$p" ]; then
        echo "L $p -> $(readlink "$p")"
      elif [ -f "$p" ]; then
        echo "F $p $(sha256sum < "$p")"
      else
        echo "D $p"
      fi
    done
  )
}

# ---------------------------------------------------------------- 묶음 만들기
echo "[묶음]"
SKIP_RELEASE_CHECK=1 bash "$ROOT/tools/deploy.sh" > /dev/null
B0=$T/bundles/b0
mkdir "$B0"
tar -xzf "$ROOT/deploy/dist/lanternwake-game.tar.gz" -C "$B0"
check "묶음에 필요한 파일이 있다" bash -c "cd '$B0' && test -f install-game.sh && test -f VERSION && test -f static/index.html && test -f static/sw.js && test -f server/game_api.py && test -f stack/game.compose.yml && test -f stack/game.Caddyfile"
VER=$(tr -d '\r\n' < "$B0/VERSION")

make_bundle() { # 이름, 버전, 정적 파일에 더할 내용(비면 그대로)
  local d=$T/bundles/$1
  cp -a "$B0" "$d"
  printf '%s\n' "$2" > "$d/VERSION"
  if [ -n "$3" ]; then printf '%s\n' "$3" > "$d/static/extra.txt"; fi
  (cd "$d/static" && find . -type f | LC_ALL=C sort | xargs sha256sum) | sha256sum | cut -d' ' -f1 > "$d/static.sha256"
}

# ---------------------------------------------------------------- 1회차
echo "[1회차 설치]"
run "$B0" > "$T/run1.out" || { cat "$T/run1.out"; exit 1; }
S=$FAKE/srv/stack
W=$FAKE/srv/owl-web/game
check "pepper가 32바이트로 생겼다" test "$(wc -c < "$S/game-data/pepper")" -eq 32
check "game.env에 자리표시 ID가 들어갔다" grep -qx 'GOOGLE_CLIENT_ID=not-set-yet' "$S/game.env"
check "current가 releases/$VER 를 가리킨다" test "$(readlink "$W/current")" = "releases/$VER"
check "릴리스에 index.html이 있다" test -f "$W/releases/$VER/index.html"
check "서버 코드가 놓였다" test -f "$S/game/game_api.py" -a -f "$S/game/bounds.json"
check "install-game.sh가 복사됐다" test -f "$S/game/install-game.sh"
check "compose에 game이 한 번 들어갔다" test "$(grep -c '^  game:' "$S/docker-compose.yml")" -eq 1
check "compose의 기존 서비스와 networks가 남았다" bash -c "grep -q '^  yubal:' '$S/docker-compose.yml' && grep -q '^networks:' '$S/docker-compose.yml' && grep -q 'subnet: 172.30.0.0/24' '$S/docker-compose.yml'"
check "game 블록이 networks 앞에 있다" bash -c "[ \$(grep -n '^  game:' '$S/docker-compose.yml' | cut -d: -f1) -lt \$(grep -n '^networks:' '$S/docker-compose.yml' | cut -d: -f1) ]"
check "Caddyfile에 game 사이트가 한 번 들어갔다" test "$(grep -c '^game\.aovob7\.duckdns\.org {' "$S/Caddyfile")" -eq 1
check "Caddyfile의 기존 사이트가 남았다" grep -q 'respond "aovob7 home" 200' "$S/Caddyfile"
check "원본 백업이 있다" bash -c "ls '$S'/backup-game/*/docker-compose.yml '$S'/backup-game/*/Caddyfile"
check "caddy validate 후 reload를 불렀다" bash -c "grep -n 'caddy validate' '$LOG' | head -1 | cut -d: -f1 | xargs -I{} sh -c 'tail -n +{} \"$LOG\" | grep -q \"caddy reload\"'"
check "up -d game을 불렀다" grep -q 'up -d game' "$LOG"
check "다른 서비스를 건드리는 명령이 없다(down, stop, rm, restart caddy)" bash -c "! grep -E 'compose.* (down|stop|rm|kill)( |$)|restart caddy|up -d$' '$LOG'"

PEPPER1=$(sha256sum < "$S/game-data/pepper")
SNAP1=$(snapshot)

# ---------------------------------------------------------------- 2회차(멱등)
echo "[2회차 같은 묶음 다시 실행]"
sleep 1
: > "$LOG"
run "$B0" > "$T/run2.out"
SNAP2=$(snapshot)
check "스냅샷이 비어 있지 않다" test "$(echo "$SNAP1" | wc -l)" -gt 20
check "파일 트리와 내용이 1회차와 같다" test "$SNAP1" = "$SNAP2"
check "pepper가 그대로다" test "$PEPPER1" = "$(sha256sum < "$S/game-data/pepper")"
check "2회차에는 compose, Caddyfile을 다시 바꾸지 않았다" bash -c "! grep -q 'compose에 game 서비스를 덧붙' '$T/run2.out' && ! grep -q 'Caddyfile에 .* 사이트를 덧붙' '$T/run2.out'"
check "2회차에는 컨테이너를 다시 만들지 않았다" bash -c "! grep -q 'force-recreate\|restart game' '$LOG'"

# ---------------------------------------------------------------- --client-id
echo "[--client-id]"
: > "$LOG"
run "$B0" --client-id abc123-x.apps.googleusercontent.com > "$T/run3.out"
check "game.env의 ID가 바뀌었다" grep -qx 'GOOGLE_CLIENT_ID=abc123-x.apps.googleusercontent.com' "$S/game.env"
check "컨테이너를 다시 만들었다" grep -q 'up -d --force-recreate game' "$LOG"
check "pepper가 그대로다" test "$PEPPER1" = "$(sha256sum < "$S/game-data/pepper")"
check "정적 링크는 그대로다" test "$(readlink "$W/current")" = "releases/$VER"
run "$B0" > "$T/run4.out"
check "인자 없이 다시 실행해도 ID가 유지된다" grep -qx 'GOOGLE_CLIENT_ID=abc123-x.apps.googleusercontent.com' "$S/game.env"
check "형식이 틀린 ID는 거부한다" bash -c "! PATH='$STUBS:$PATH' PREFIX='$FAKE' bash '$B0/install-game.sh' --client-id 'bad id' > /dev/null 2>&1"
: > "$LOG"
run "$S/game" --client-id second-id.apps.googleusercontent.com > "$T/run5.out"
check "묶음 없이(--client-id만) 값을 바꿀 수 있다" grep -qx 'GOOGLE_CLIENT_ID=second-id.apps.googleusercontent.com' "$S/game.env"
check "묶음 없이 인자도 없으면 거부한다" bash -c "! PATH='$STUBS:$PATH' PREFIX='$FAKE' bash '$S/game/install-game.sh' > /dev/null 2>&1"
check "묶음 없는 모드는 Caddy를 건드리지 않는다" bash -c "! grep -q 'caddy' '$LOG'"

# ---------------------------------------------------------------- 릴리스 교체와 3개 유지
echo "[릴리스 교체]"
for i in 1 2 3 4; do
  sleep 1
  make_bundle "r$i" "9.0.$i" "내용 $i"
  run "$T/bundles/r$i" > /dev/null
done
check "current가 최신(9.0.4)을 가리킨다" test "$(readlink "$W/current")" = "releases/9.0.4"
check "릴리스는 3개만 남았다" test "$(ls -1 "$W/releases" | wc -l)" -eq 3
check "가장 오래된 것이 지워졌다" test ! -e "$W/releases/$VER"
check "최근 3개가 남았다" bash -c "ls '$W/releases' | tr '\n' ' ' | grep -q '9.0.2 9.0.3 9.0.4'"
check "pepper가 그대로다" test "$PEPPER1" = "$(sha256sum < "$S/game-data/pepper")"

echo "[같은 버전 이름, 다른 내용]"
sleep 1
make_bundle same 9.0.4 "다른 내용"
run "$T/bundles/same" > /dev/null
cur=$(readlink "$W/current")
check "덮어쓰지 않고 해시가 붙은 새 폴더로 간다" bash -c "[ '$cur' != 'releases/9.0.4' ] && [ -f '$W/$cur/extra.txt' ] && [ \"\$(cat '$W/releases/9.0.4/extra.txt')\" = '내용 4' ]"

# ---------------------------------------------------------------- 실패 시 되돌리기
echo "[Caddyfile 검사 실패]"
cat > "$FAKE/srv/stack/Caddyfile" <<'EOF'
aovob7.duckdns.org {
	respond "aovob7 home" 200
}
EOF
BEFORE=$(sha256sum < "$S/Caddyfile")
touch "$T/FAIL_VALIDATE"
set +e
run "$B0" > "$T/run6.out" 2>&1
rc=$?
set -e
rm -f "$T/FAIL_VALIDATE"
check "검사 실패면 종료 코드가 0이 아니다" test "$rc" -ne 0
check "Caddyfile이 원래 내용으로 돌아갔다" test "$BEFORE" = "$(sha256sum < "$S/Caddyfile")"
run "$B0" > /dev/null
check "검사가 통과하면 다음 실행에서 붙는다" grep -q '^game\.aovob7\.duckdns\.org {' "$S/Caddyfile"

echo
echo "통과 $pass, 실패 $fail"
[ "$fail" = 0 ]
