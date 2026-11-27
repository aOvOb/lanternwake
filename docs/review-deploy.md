# 게임 서버 배포 변경 리뷰 (2026-11-27)

대상
- OwL-server: ef9e01f, 6c32514, 509ed4a
- survivor-game: 75e9ab9, 86b3903 (설계 DESIGN-ACCOUNT.md 11장, server/game_api.py)

방법: 정적 분석. 로컬에서 `bash deploy/test-install.sh` 실행(39개 통과). 게임 추가 전 compose(ef9e01f^)에 deploy.sh와 install-game.sh의 awk를 그대로 적용해 결과 diff 확인(game 블록이 yubal 뒤, networks 앞에만 들어감). 집 PC 작업 스케줄러와 monitor.log 확인.

## 지적 목록

### 1. [필수] 모니터 변경이 이미 운영 중이며 오탐 메일이 나갔다
- 위치: OwL-server `ops/owl_monitor.py:25`, `:31`, `:54`, `HANDOFF.md:283`
- 문제: 작업 스케줄러 "OwL Monitor"는 레포 파일 `C:/Users/junys/dev/Owl-player/OwL-server/ops/owl_monitor.py`를 바로 실행한다. 그래서 커밋하는 순간 새 점검이 켜졌다. HANDOFF.md:283의 "설치한 뒤에 바꿉니다"는 이 구조에서는 지킬 수 없다.
- 실패 상황: monitor.log 2026-11-27 10:34에 `game`(TLS 오류)과 `down-stack-game-1` 메일이 이미 나갔다. 게임을 설치하기 전까지 문제 상태가 계속되어, 그동안 다른 진짜 장애 메일과 섞인다.
- 고칠 방법: 게임 설치를 바로 진행하면 회복 메일과 함께 해소된다. 설치가 늦어지면 모니터 변경을 잠시 되돌린다. HANDOFF.md:283은 "모니터는 레포 파일을 직접 실행하므로, 모니터 변경은 게임 설치 뒤에 커밋하거나 받는다"로 고친다.

### 2. [필수] 새 owl-backup이 서버에 배포되지 않아 pepper가 백업되지 않는다
- 위치: OwL-server `ops/install-backup.sh:6`, `HANDOFF.md:225`, `HANDOFF.md:278-284`(게임 절)
- 문제: 서버는 `/usr/local/sbin/owl-backup` 사본을 실행한다. 이 사본은 `install-backup.sh`를 다시 실행해야 바뀐다. install-game.sh도, HANDOFF의 게임 절도 이 단계를 말하지 않는다.
- 실패 상황: 게임 설치 뒤 계정이 생겨도 game.db와 pepper가 백업에 들어가지 않는다. 디스크가 고장 나면 pepper를 잃는다. pepper는 다시 만들 수 없으므로 모든 계정이 새 사용자가 된다.
- 고칠 방법: HANDOFF 게임 절에 설치 직후 단계를 적는다. `sudo install -m 0755 ops/owl-backup /usr/local/sbin/owl-backup`(또는 `sudo bash ops/install-backup.sh`), `sudo systemctl start owl-backup`, 그다음 가장 최근 아카이브를 `sudo tar -tzf <파일> | grep -E "game.db|pepper"`로 확인한다.

### 3. [필수, 확인 필요] 기존 OwL 백업이 이번 변경 전부터 실패 중이다
- 위치: 서버 `owl-backup.service`(원인 확인 필요). 근거: monitor.log 2026-11-24 15:49 "매일 백업 실패(결과: exit-code)", 이후 backup 문제가 781회 기록됨
- 문제: 이번 커밋이 원인은 아니다. 서버에는 아직 옛 owl-backup이 돌고 있기 때문이다. 다만 2번을 해도 백업이 실패하면 pepper는 서버 밖에 남지 않는다.
- 실패 상황: 백업이 계속 실패하는 동안 게임 계정이 쌓이고, 디스크를 잃으면 OwL 데이터와 게임 계정을 함께 잃는다.
- 고칠 방법: `sudo journalctl -u owl-backup -n 50`으로 원인을 찾아 고친다. 그 다음에 2번의 확인 절차를 밟는다. 새 스크립트는 게임 쪽 실패도 exit 1로 끝내므로, 원인을 구분하려면 journal의 "game.db backup failed" 줄을 본다.

### 4. [권장] Caddy reload가 실패하면 디스크의 Caddyfile을 되돌리지 않는다
- 위치: survivor-game `deploy/install-game.sh:279`
- 문제: validate가 실패할 때만 백업으로 되돌린다(272-278). reload가 실패하면 `set -e`로 바로 끝나서, 디스크에는 game 블록이 남는다. Caddy는 reload에 실패하면 옛 설정으로 계속 돌기 때문에 당장은 문제가 없다.
- 실패 상황: 나중에 서버 재부팅이나 caddy 재시작 때 그 파일을 읽는다. 블록에 validate가 못 잡은 문제가 있으면 caddy가 뜨지 않고 owl, admin, music, dl까지 모두 멈춘다. 가능성은 낮다.
- 고칠 방법: reload를 `if ! out=$(dc exec -T caddy caddy reload --config /etc/caddy/Caddyfile 2>&1); then ...; fi`로 감싸고, 실패하면 `$BACKUPS/$stamp/Caddyfile`이 있을 때 `cat`으로 내용을 되돌린 뒤 die한다.

### 5. [권장, 확인 필요] 헬스 체크가 서버에서 자기 공인 IP로 접속한다
- 위치: survivor-game `deploy/install-game.sh:36`, `:287`
- 문제: 서버 안에서 `https://game.aovob7.duckdns.org`에 접속하려면 OCI 공인 IP로 나갔다 돌아와야 한다(헤어핀). 이 경로가 되는지는 확인 필요.
- 실패 상황: 경로가 막히면 모든 설치가 끝난 뒤 마지막에 "응답하지 않습니다"로 실패한다. 다시 실행해도 같다. 기존 서비스에는 영향이 없지만 성공 여부를 잘못 판단하게 된다.
- 고칠 방법: `curl -fsS --max-time 10 --resolve "$DOMAIN:443:127.0.0.1" "$HEALTH_URL"`로 바꾼다. Caddy, 인증서, game 컨테이너를 모두 거치면서 헤어핀은 피한다. HEALTH_URL을 덮어쓰는 시험 모드에서는 `--resolve`를 빼도록 분기한다.

### 6. [권장] game 컨테이너 격리를 더 할 수 있다
- 위치: OwL-server `docker-compose.yml:33-57`
- 문제: 비루트(10001), 코드 `:ro`, 메모리 128m, 로그 상한은 되어 있다. 루트 파일 시스템 쓰기, 커널 권한(capability), 프로세스 수, CPU는 제한하지 않는다. 같은 서버의 음악 서비스와 CPU를 나눠 쓴다.
- 실패 상황: game_api.py에 취약점이 생기면 컨테이너 안에 파일을 쓰거나 권한 상승을 시도할 여지가 남는다. 요청이 몰리면 CPU를 많이 써서 OwL 응답이 느려질 수 있다(요청 제한과 MAX_CONNS 64로 일부 막힘).
- 고칠 방법: game 서비스에 `read_only: true`, `tmpfs: [/tmp]`, `cap_drop: [ALL]`, `security_opt: ["no-new-privileges:true"]`, `pids_limit: 128`, `cpus: "1.0"`을 더한다. 적용은 `up -d game`이므로 game만 다시 만들어진다. 이미 설치한 서버는 install-game.sh가 블록을 다시 붙이지 않으므로 compose를 직접 고쳐야 한다.

### 7. [권장] 백업 정책 문구와 실제 내용이 다르고, 복구 절차가 없다
- 위치: OwL-server `ops/owl-backup:6-7`, `:32`, `HANDOFF.md:225`
- 문제: 머리 주석은 "비밀값은 일부러 뺀다"고 하지만 이제 pepper가 버킷에 올라간다. 버킷은 비공개이고 인스턴스 주체로만 쓰므로 당장 노출되지는 않는다. HANDOFF에는 복구 절차가 없다.
- 실패 상황: 버킷이나 아카이브가 새어 나가면, pepper와 game.db(sub_hash)로 특정 구글 계정이 이 게임 사용자인지 확인할 수 있다. 복구할 때 파일을 root 소유로 풀면 game 컨테이너(10001)가 game.db에 쓰지 못해 시작하지 못한다.
- 고칠 방법: 머리 주석에 "pepper는 다시 만들 수 없어 예외로 넣는다"를 적는다. 노출 위험을 줄이려면 pepper만 오프라인 공개키로 암호화(예: age)해서 넣는 방법이 있다. 다만 복구가 복잡해지므로 지금 구조를 받아들여도 된다. HANDOFF에 복구 한 줄을 더한다: 푼 뒤 `chown -R 10001:10001 /srv/stack/game-data && chmod 700 /srv/stack/game-data && chmod 600 /srv/stack/game-data/pepper`.

### 8. [권장] setup.sh를 다시 실행하면 compose에서도 game이 빠질 수 있다
- 위치: OwL-server `HANDOFF.md:284`, `setup.sh:57`, `setup.sh:144`
- 문제: HANDOFF는 Caddyfile만 경고한다. setup.sh는 `/home/ubuntu/deploy/docker-compose.yml`을 복사하고 `up -d --remove-orphans`를 실행한다.
- 실패 상황: deploy 폴더의 compose가 game 추가 전 사본이면 game 컨테이너가 고아로 지워진다. 데이터는 남지만 게임 API가 멈춘다.
- 고칠 방법: HANDOFF.md:284에 "compose도 같다. 다시 실행하기 전에 deploy 폴더를 최신 레포로 맞추거나, 실행 뒤 install-game.sh를 다시 실행한다"를 더한다.

### 9. [권장] 임시 파일 정리
- 위치: survivor-game `deploy/README.md:20`, `deploy/install-game.sh:262-268`
- 문제: README 명령은 `mktemp -d` 폴더와 `/tmp/lanternwake-game.tar.gz`를 지우지 않는다. install-game.sh는 `$CADDYFILE.XXXXXX`를 만든 뒤 중간에 실패하면 남긴다(trap 없음).
- 실패 상황: 실행할 때마다 /tmp에 수백 KB가 쌓인다. Ubuntu의 tmpfiles 정리나 재부팅으로 지워지므로 디스크 위험은 없다. `/srv/stack/Caddyfile.XXXXXX`는 남아도 동작에는 영향이 없다.
- 고칠 방법: README 3번 끝에 `; rm -rf "$d" /tmp/lanternwake-game.tar.gz`를 붙인다. 스크립트는 SELF를 이미 /srv/stack/game에 복사하므로 지워도 된다. 스크립트에는 Caddy 임시 파일용 `trap`을 둔다.

### 10. [권장] 설계 문서가 구현과 다르다
- 위치: survivor-game `DESIGN-ACCOUNT.md:450-524`(11.2~11.5)
- 문제: 구현은 game.env(env_file), uid 10001, 로그 상한, request_body와 read_timeout, python 이미지로 하는 백업, `/api/health` 감시, 릴리스 3개, 묶음과 sudo 설치 방식을 쓴다. 설계는 compose에 ID 직접 기입, 릴리스 5개, rsync와 ssh 방식이다.
- 실패 상황: 나중에 설계 문서를 보고 손으로 적용하면 game.env 없이 띄우거나 소유자를 잘못 맞춘다.
- 고칠 방법: 11장을 구현에 맞춰 고치고, 바뀐 이유를 한 줄씩 적는다.

### 11. [권장] game.db가 커지면 OwL 백업 업로드 전체가 막힌다
- 위치: survivor-game `server/game_api.py:309-315`, OwL-server `ops/backup_upload.py:28`
- 문제: 지우는 것은 만료 세션, 만료 표, 30일 지난 rejected 판뿐이다. 정상 판은 계속 쌓인다. 판 제출은 사용자당 시간당 30개로 제한되어 있어 빠르게 커지지는 않는다.
- 실패 상황: 아카이브가 200MB를 넘으면 OwL 데이터까지 포함한 아카이브 전체가 업로드되지 않는다. 지금 규모에서는 먼 이야기다.
- 고칠 방법: owl-status나 모니터에 game.db 크기를 더하고, 일정 크기(예: 50MB)를 넘으면 알린다. 필요해지면 오래된 비순위 판의 detail을 비우는 정리 작업을 더한다.

## 확인한 결과 문제없는 부분
- `up -d game`은 game만 만든다. game에는 depends_on이 없다. 설정 해시는 서비스마다 따로 계산하고, networks 정의는 바뀌지 않았다. owl-blue와 owl-green은 `docker run --network stack_default`로 띄워 compose 라벨이 없으므로 고아로 취급되지 않는다. 프로젝트 이름은 폴더 이름 `stack`으로 같다.
- compose와 Caddyfile은 모두 `cat >`로 내용만 덮어써서 inode가 유지된다(HANDOFF 276줄의 함정을 피함). compose는 `config -q` 검사를 통과한 뒤에만 덮어쓴다. Caddyfile은 validate가 실패하면 이번 실행에서 만든 백업으로 되돌린다.
- 중간에 실패한 뒤 다시 실행해도 안전하다: compose 검사 실패(원본 그대로), up 실패(다음 실행에서 블록 있음으로 건너뜀), validate 실패(되돌림), reload나 헬스 체크 실패(다시 실행하면 이어서 진행). pepper는 비어 있을 때만 만든다. current 링크는 `mv -T`로 한 번에 바뀐다. 같은 버전에 내용이 다르면 해시를 붙인 새 폴더를 쓴다.
- 따옴표와 경로 공백 처리가 맞다. VER와 SHA는 정규식으로 검사한다. 묶음은 직접 만들고 ubuntu 사용자(비루트)로 풀기 때문에 tar의 `../` 위험이 낮다.
- 권한: game-data 700(10001), pepper 600(10001), game.env 600(root, 공개 값만 있음), 코드 644 root에 `:ro` 마운트. 8080은 호스트에 공개하지 않고(expose만) Caddy의 `/api/*`로만 들어온다. `header_up X-Real-IP {remote_host}`가 값을 덮어쓰고, game_api.py는 X-Real-IP만 쓴다(X-Forwarded-For는 안 씀). HTTP 관리 경로는 없고, `/api/dev/login`은 운영 모드에서 404다.
- 헬스 응답은 `separators=(",", ":")`로 만들어져 `"ok":true` 비교와 맞는다. ID가 `not-set-yet`이어도 서버는 뜬다.
- 백업: bash 4.4 이상이라 빈 배열이 `set -u`에 걸리지 않는다. 게임 쪽이 실패해도 OwL 아카이브는 올린 뒤 실패로 끝난다. 백업 컨테이너도 10001로 돌아 root 소유 파일을 남기지 않는다.
- 과금: 새 OCI 자원이 없다. 로그는 5MB 3개, Caddy 게임 접근 로그는 없음, 릴리스는 3개와 current, backup-game 폴더는 블록을 붙일 때만 생긴다. 버킷은 1GB 상한이 유지된다. 정적 파일은 약 400KB라 아웃바운드 부담이 작다.

## 위험 요소
- Compose 버전: `env_file`의 `path`와 `required`는 Compose 2.24 이상이 필요하다. 서버 버전은 확인 필요. 낮으면 install-game.sh:228 검사에서 compose를 바꾸기 전에 멈추므로 안전하게 실패한다.
- Caddy reload는 모든 사이트 설정을 다시 올린다. owl-blue와 owl-green의 능동 헬스 체크가 새로 시작되므로, 꺼져 있는 쪽으로 첫 요청이 가면 lb_try_duration(15초) 안에서 재시도되어 잠깐 느려질 수 있다. 사람이 적은 시간에 실행한다.
- 서버의 /srv/stack/docker-compose.yml과 Caddyfile이 레포와 같은지는 확인 필요. 스크립트는 덧붙이기만 하므로 달라도 기존 내용은 바뀌지 않는다.

## 판정
실행해도 된다. 기존 서비스를 멈추거나 바꿀 경로는 찾지 못했다. 다만 실행 직후 2번(새 백업 배포)과 3번(기존 백업 실패 원인)을 처리해야 pepper가 안전하다.

## 처리 결과 (2026-11-27)

- 1: 모니터는 상태 폴더의 `game-enabled` 파일이 있을 때만 게임을 점검한다. 꺼져 있으면 열린 게임 경보는 복구 메일 없이 지운다. `--dry-run` 추가(OwL-server 1521189).
- 2: `tools/deploy.sh`가 OwL-server의 `ops/owl-backup`을 묶음에 넣고, `install-game.sh`가 `/usr/local/sbin/owl-backup`에 설치한 뒤 `systemctl start owl-backup`을 실행한다(실패해도 경고만). 마지막에 `journalctl -u owl-backup -n 30 --no-pager`를 출력한다.
- 3: 서버에서 `journalctl`을 직접 봐야 한다. 이 환경에서는 서버에 접속하지 않았다.
- 4: reload 실패 시 이번 실행의 백업으로 Caddyfile을 되돌린다.
- 5: 헬스 체크에 `--resolve "$DOMAIN:443:127.0.0.1"`을 쓴다. `HEALTH_URL`을 덮어쓰면 쓰지 않는다.
- 6: game 서비스에 `read_only`, `tmpfs /tmp`, `cap_drop ALL`, `no-new-privileges`, `pids_limit 128`, `cpus 1.0`(OwL-server c5c745a). `game_api.py`의 쓰기는 `/data`(SQLite, WAL, pepper)뿐이고 임시 파일 API를 쓰지 않아 정적 검토로 동작한다고 판단했다. 실제 컨테이너 실행은 이 PC에 docker가 없어 시험하지 못했다.
- 7: `ops/owl-backup` 머리 주석에 pepper 예외를 적고, HANDOFF에 복구 `chown` 한 줄을 더했다.
- 8: HANDOFF에 setup.sh 재실행 시 compose도 같다는 경고를 더했다.
- 9: README 3번 끝에 임시 파일 삭제를 붙이고, `install-game.sh`는 `trap`으로 임시 파일을 지운다.
- 10: DESIGN-ACCOUNT.md 11.2부터 11.5를 구현에 맞추고 바뀐 이유를 적었다.
- 11: HANDOFF에 메모만 남겼다.

