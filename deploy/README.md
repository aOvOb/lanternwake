# 배포 (서버 한 번 설치, 이후 갱신도 같은 명령)

먼저 `node tools/release.js <새버전>`을 실행해 둔다(안 했으면 2번이 알려 준다).

1. 로컬에서 묶음 만들기

   ```
   bash tools/deploy.sh
   ```

2. 서버로 옮기기 (평소 서버 접속에 쓰는 ssh 옵션을 그대로 붙인다)

   ```
   scp deploy/dist/lanternwake-game.tar.gz ubuntu@<서버주소>:/tmp/
   ```

3. 서버에서 실행하기

   ```
   d=$(mktemp -d) && tar -xzf /tmp/lanternwake-game.tar.gz -C "$d" && sudo bash "$d/install-game.sh"; rm -rf "$d" /tmp/lanternwake-game.tar.gz
   ```

설치는 서버 안에서 Caddy에 바로 접속해(`--resolve`) `/api/health` 응답을 확인한다. 응답이 나오면 끝이고, 여러 번 실행해도 안전하다.

게임 백업이 들어 있는 `owl-backup`(OwL-server 레포의 `ops/owl-backup`)도 묶음에 들어 있어 같은 명령이 `/usr/local/sbin/owl-backup`에 설치하고 `systemctl start owl-backup`을 한 번 실행한다. 백업이 실패해도 게임 설치는 성공으로 끝나고, 마지막에 `journalctl -u owl-backup -n 30`을 출력한다. 묶음을 만들 때 OwL-server를 최신으로 받아 둔다.

게임 점검 메일은 설치가 끝난 뒤 집 PC에서 `New-Item ~/oci-retry/monitor/game-enabled`를 해야 켜진다(OwL-server HANDOFF.md 참고).

구글 클라이언트 ID가 생기면 서버에서 값만 바꾼다.

```
sudo bash /srv/stack/game/install-game.sh --client-id <ID>.apps.googleusercontent.com
```

묶음 만들기와 설치 스크립트 점검은 `bash deploy/test-install.sh`로 로컬에서 시험한다.
