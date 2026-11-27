# 리뷰 3: 최종 코드 리뷰 (39178e5..a7bd1b8)

범위: `git diff 39178e5..a7bd1b8 -- . ':!deploy' ':!tools/deploy.sh' ':!docs'`. 코드는 a7bd1b8 시점을 `git show`로 읽었다.
기준 문서: DESIGN.md, DESIGN-ACCOUNT.md, DECISIONS.md, server/DECISIONS-SERVER.md.
확인한 것: 서버 시험 `python -m unittest discover -s server/tests` 305개 통과, `node tools/test-account.js` 11개 통과.

## 필수

### F1. 시작 표(ticket)가 새어 나가 순위 등록이 최대 14일 막힘
- 위치: `js/account.js:248`, `js/account.js:253-255` (onRunStart), `js/account.js:298-303` (onRunEnd), `js/ui.js:187-196` (일시정지에서 "타이틀로"), `js/account.js:64` (toGuest), `server/game_api.py:1362-1364` (미사용 표 6장 상한)
- 문제: 서버는 사용자당 미사용 표를 6장까지만 준다. 클라이언트가 잃어버린 표도 서버에서는 계속 미사용으로 세어진다. 표를 잃는 경로가 여럿이다.
  1. 판 시작 때 미리 받은 표를 저장소에서 빼고(253-255), 판을 끝내지 않고 "타이틀로" 나가면 onRunEnd가 불리지 않는다. 다음 판의 onRunStart가 `reserved = null; fresh = null;`(248)로 둘 다 버린다. 앱이 판 도중 종료돼도 같다.
  2. 30초 미만 판, 거부된 판은 서버가 표를 쓰지 않는데, 클라이언트는 그 표를 보낸 뒤 버린다(302-303).
  3. 표 요청이 3초(새 표), 5초(채우기) 제한에 걸리면 서버는 발급했는데 클라이언트는 못 받는다.
  4. 로그아웃(toGuest)이 그 계정의 표를 지운다.
- 실패 상황: "타이틀로" 3번 정도, 또는 30초 미만 사망 6번 정도면 클라이언트 표는 0장, 서버 미사용은 6장이 된다. 이후 채우기와 새 표 요청이 모두 빈 배열을 받고, 모든 판이 "순위 제외: 시작 표가 없었어요"가 된다. 표가 만료되는 14일 동안 모든 기기에서 이어진다.
- 고칠 방법:
  1. 서버 `h_tickets`: 상한에 걸리면 가장 오래된 미사용 표(issued_at 순)를 지우고 새로 발급한다. 클라이언트가 표를 잃는 모든 경로(저장소 삭제, 다른 기기 포함)를 한 번에 막는다. 다른 기기의 오프라인 판이 쓰려던 표가 지워지면 그 판은 unranked가 되는데, 이것은 받아들인다.
  2. 클라이언트: 끝나지 않은 판을 버릴 때(일시정지에서 타이틀로, 새 판 시작 때 이전 판이 끝나지 않았을 때) `reserved`와 `fresh`를 `pool()`로 돌려놓는다.
  3. `onRunEnd`: `s.timeMs < 30000`이면 표를 붙이지 않고 `pool(t)`로 돌려놓는다.
  4. `tools/test-account.js`에 "타이틀로 나가기 3번 뒤에도 표가 남는다", 서버 시험에 "상한에서 오래된 표를 지우고 발급한다"를 더한다.

## 권장

### R1. 주소 매개변수만으로 무적, 시간 건너뛰기가 운영에서 켜지고 그 판이 순위에 올라감
- 위치: `js/config.js:26` (god), `js/game.js:46`, `js/ui.js:115` (`+60` 버튼), `js/ui.js:237`, `js/ui.js:323` (KeyI 무적, KeyT 시간)
- 문제: `?god=1`이나 `?debug=1`은 autotest 없이도 동작하고, 이때 `LW.ACCOUNT`는 켜져 있다. 미리 받은 표는 발급된 지 오래돼 `elapsed` 검사를 통과한다.
- 실패 상황: `?god=1`로 15분 버티면 정상 승리로 ranked가 된다. DESIGN-ACCOUNT 223줄이 받아들인 "수정한 클라이언트" 허점보다 훨씬 쉽다(주소만 바꾸면 된다).
- 고칠 방법: config.js에서 `god, stress, debug, start, build, elite, candle, crowd, killLast, bench, burn` 중 하나라도 켜지면 `LW.params.cheat = true`. `account.onRunEnd`에서 `cheat && !devLogin`이면 제출하지 않고 "시험 모드: 순위 제외"만 보인다.

### R2. 순위표 "내 순위" 줄이 틀린 글꼴로 그려짐
- 위치: `js/ui.js:941` (`ctx.restore()`)
- 문제: `text()`는 `curFont`로 마지막 글꼴을 기억한다. 목록을 `ctx.save()`와 `ctx.restore()`로 감싸면 restore가 `ctx.font`를 상태 줄 글꼴(12px normal)로 되돌리는데 `curFont`는 15px bold로 남는다.
- 실패 상황: 로그인했고 순위가 있으면 "내 순위" 줄(15px bold)이 12px normal로 작게 그려진다.
- 고칠 방법: `ctx.restore();` 바로 뒤에 `curFont = '';`.

### R3. 로그아웃이 서버 실패에도 로컬만 게스트로 바꿈
- 위치: `js/account.js:136-142`
- 문제: 네트워크 오류만 실패로 보고, 5xx, 429, 403(Origin 불일치)에서도 `toGuest()`를 부른다. 서버 세션은 살아 있다.
- 실패 상황: 공용 기기에서 로그아웃했다고 보였는데, 다음 실행 때 refreshMe가 그대로 다시 로그인시킨다.
- 고칠 방법: `r.ok || r.status === 401`일 때만 `toGuest()`. 그 밖에는 "로그아웃하지 못했어요. 다시 시도해 주세요"를 보이고 false를 돌려준다.

### R4. 로그아웃이나 계정 전환 뒤 순위표 저장본에 이전 계정 표시가 남음
- 위치: `js/account.js:383` (`mine` 판정을 받을 때 한 번 계산), `js/account.js:58-68` (toGuest가 순위표를 건드리지 않음)
- 실패 상황: 로그아웃한 뒤 오프라인에서 순위표를 열면 이전 계정 줄이 계속 강조된다. 다른 계정으로 로그인한 직후 오프라인이면 이전 계정의 "내 순위"가 보인다.
- 고칠 방법: toGuest와 applyMe(uid가 바뀔 때)에서 `saved[b].me = null`로 지우고, 두 보드를 `prepare()`로 다시 만들어 `mine`을 다시 계산한 뒤 `saveBoard`. 닉네임을 바꾼 뒤에도 같은 재계산을 부른다.

### R5. iOS에서 키보드가 닫힌 뒤 화면이 밀린 채 남을 수 있음 (확인 필요)
- 위치: `js/ui.js:860-866` (closeNick)
- 문제: body가 `position: fixed`라도 iOS는 입력란에 초점이 가면 화면을 위로 밀고, 키보드가 닫힌 뒤 원래대로 돌아오지 않는 경우가 있다. 실기기 확인 전이다.
- 실패 상황: 닉네임을 저장한 뒤 캔버스 터치 좌표가 실제 위치와 어긋난다.
- 고칠 방법: `blur()` 뒤에 `window.scrollTo(0, 0)`과 `LW.platform.resize()`를 부른다. iPhone Safari와 홈 화면 앱에서 확인한다.

### R6. 닉네임 폼의 버튼을 키보드로 누를 수 없음 (데스크톱)
- 위치: `js/input.js:124`
- 문제: `#nickIn`만 제외하므로, Tab으로 "취소"나 "확인"에 초점을 두고 Enter나 Space를 누르면 window keydown이 `preventDefault`해서 버튼이 눌리지 않는다.
- 고칠 방법: `if (e.target && e.target.closest && e.target.closest('#nick')) return;`

### R7. 개발용 로그인에 이중 방어가 없음
- 위치: `server/game_api.py:1002-1015`, `server/game_api.py:1593-1598`, `cmd_serve`의 기본 host
- 현재 상태: 인자 `--dev`로만 켜지고 환경 변수로는 켤 수 없다. 운영 compose 명령은 `["python", "-u", "/app/game_api.py", "serve"]`(OwL-server docker-compose.yml:40)라 운영에서는 꺼져 있다. `tests/test_dev_login.py`가 404를 보장한다.
- 문제: 누가 운영 compose에 `--dev`를 더하면 개발용 로그인이 공개되고, 쿠키에서 `Secure`와 `__Host-`도 빠진다. `game_api.py --dev --static .`을 직접 실행하면 기본 host가 `0.0.0.0`이라 같은 네트워크의 누구나 개발용 로그인을 쓸 수 있다.
- 고칠 방법: `--dev`이면서 `PUBLIC_ORIGIN`이 `https://`로 시작하면 종료한다. `--dev`의 기본 host를 `127.0.0.1`로 둔다.

### R8. 새 버전 알림이 버전 문자열에만 걸려 있음
- 위치: `tools/release.js:48-56`, `tools/deploy.sh:39-52`
- 문제: sw.js의 바이트가 바뀌어야 클라이언트가 갱신된다. 버전을 올리지 않고 data 파일만 바꿔 release.js와 deploy.sh를 돌리면 sw.js는 그대로이고 검사도 통과한다. release.js는 bounds.json을 새 데이터로 다시 만든다.
- 실패 상황: 다른 작업자가 밸런스를 바꾼 뒤 같은 버전으로 배포하면, 클라이언트는 cache-first로 옛 데이터를 계속 쓴다. 서버는 새 bounds로 검사하므로 엘리트, 보스 시각이 바뀐 경우 정상 판이 `events`나 `xp`로 거부된다.
- 고칠 방법: release.js가 ASSETS 내용의 sha256을 `const BUILD = '...'`로 sw.js에 쓰고 캐시 이름에도 넣는다. deploy.sh는 같은 해시를 다시 계산해 다르면 멈춘다.

### R9. 본문을 받은 뒤 소켓 제한 시간이 남은 마감 시간으로 남음
- 위치: `server/game_api.py:571-589` (read_exact, 580줄 `settimeout(left)`)
- 문제: 본문을 받은 뒤 제한 시간을 `SOCKET_TIMEOUT`으로 되돌리지 않는다. 마감 직전에 본문이 끝나면 응답 쓰기의 제한 시간이 1초 미만이 된다.
- 고칠 방법: `finally: self.connection.settimeout(SOCKET_TIMEOUT)`.

## 지적 없음으로 확인한 항목

- sw.js: `/api/`는 respondWith 없이 브라우저에 넘긴다(navigate 포함). 구글 콜백 POST는 GET이 아니라 처리하지 않는다. 다른 출처는 처리하지 않는다. 설치는 `cache: 'reload'`로 HTTP 캐시의 옛 파일을 피하고, `addAll`이 하나라도 실패하면 이전 SW가 그대로 남는다. activate가 이전 `lanternwake-` 캐시를 지운다. skipWaiting과 claim 뒤 새로고침은 TITLE에서만 하고(진행 중이면 TITLE로 돌아올 때), 첫 설치의 controllerchange는 건너뛴다. 정적 파일은 심볼릭 링크 교체로 한 번에 바뀌므로 설치 도중 옛 파일과 새 파일이 섞이지 않는다. 스코프는 `./`(manifest와 같다).
- 판 요약과 서버 검사: 승리 판 timeMs 900000 고정, 그 밖은 1~899999. kpm 칸 수는 `ceil(timeMs/60000)`과 같고, 넘친 처치는 마지막 칸에 합쳐 `sum(kpm) == kills`가 맞다. lvm은 분 경계에서 처치와 줍기보다 먼저 기록되어 단조 증가하고, 마지막 칸은 최종 레벨이다. 경험치 출처는 적 보석뿐이고(일반 5 이하, 엘리트 20, 보스 100, 배율 없음, 합쳐진 보석은 합계 보존) xp 상한 식과 맞다. 엘리트와 보스는 처치 수라 예정 수 이하다. 게임 시간은 실제 시간보다 빨리 가지 않으므로 새 표의 `elapsed`(5초 여유)도 통과한다. a7bd1b8의 bounds.json 엘리트, 보스 시각은 waves.js와 일치한다.
- 대기열: 같은 uid만 20개씩 보내고, 동시 전송은 `flushing`으로 막는다. 응답을 못 받고 다시 보내도 서버가 `duplicate`와 `first`로 답하고 대기열에서 지운다. 401은 게스트로 돌리고 대기열은 uid별로 남긴다. localStorage를 고쳐도 서버 검사를 거치므로 직접 위조하는 것보다 나을 게 없다.
- XSS: 닉네임 폼은 `value`와 `textContent`만 쓴다. 서버 문자열(닉네임, 순위)은 캔버스 `fillText`로만 그린다.
- 쿠키와 Origin: 세션 쿠키는 `__Host-`, `Secure`, `HttpOnly`, `SameSite=Lax`. 쓰기 요청은 Origin이 정확히 같아야 하고, 클라이언트는 같은 출처 fetch라 Origin이 붙는다.
- 모바일: 입력 글자 16px, 뷰포트 확대 금지, 폼 안의 터치는 막지 않는다. 화면이 다시 보일 때의 서버 재확인은 rate limit 안에 든다.
- 성능: update와 render 경로에 새 할당이 없다. runStat은 미리 만든 형식화 배열, 상자 결과는 미리 만든 3칸, 순위표와 계정 화면의 문자열은 데이터가 바뀔 때만 만든다. 화질 하향 판정도 할당이 없다.

## 위험 요소

- iOS 홈 화면 앱 로그인: 구글에서 돌아올 때 같은 앱(같은 쿠키 저장소)으로 돌아오는지 확인 필요(DESIGN-ACCOUNT 139, 694줄). 실패하면 S24-A를 진행한다.
- iOS 홈 화면 앱은 Safari와 저장소를 따로 쓰는 것으로 알려져 있어, 추가 직후 첫 실행을 오프라인으로 하면 열리지 않을 수 있다. 확인 필요.
- 앞으로 bounds를 바꾸는 배포 때는 배포 전에 쌓인 옛 버전의 오프라인 판이 새 bounds로 검사되어 rejected가 될 수 있다. 1.0.0은 이전 계정 클라이언트가 없어 해당 없다.

## 판정

필수 1건(F1 시작 표 누수)을 고친 뒤 배포한다. 권장 항목은 배포 뒤에 처리해도 된다.

## 처리 결과

| 지적 | 처리 | 시험 |
|---|---|---|
| F1 시작 표 누수 | 고침. 방법 1~4를 모두 적용했다. 서버 `h_tickets`는 상한(6장)에서 가장 오래된 미사용 표를 지우고 새로 발급한다(다른 사용자의 표와 사용한 표는 건드리지 않는다). 클라이언트는 `onRunAbort`(일시정지에서 타이틀로)와 `onRunStart`(이전 판이 끝나지 않았을 때)에서 `reserved`, `fresh`를 풀로 돌려놓고, `onRunEnd`는 30초 미만 판에 표를 붙이지 않고 풀로 돌려놓는다. 추가 판단: 풀이 5장을 넘으면(끝나지 않은 판의 표가 돌아온 경우) 가장 최근 표를 쓰고 새 표를 요청하지 않는다. 그렇지 않으면 서버가 가장 오래된 표, 곧 클라이언트가 들고 있는 표를 지운다. 로그아웃이 표를 지우는 경로(4번)는 서버 쪽 삭제로 막힌다. | `test_runs_api.py`(상한에서 오래된 표 삭제, 새어 나간 표가 막지 않음), `tools/test-account.js`(타이틀로 3번 뒤 다음 판에 표가 붙음, 이전 판 미종료, 서버 상한 흉내에서 들고 있는 표가 지워지지 않음, 30초 미만) |
| R1 주소 매개변수 순위 등록 | 고침. `config.js`가 `LW.params.cheat`을 계산하고(god, stress, debug, start, build, elite, candle, crowd, killLast, bench, burn), `account.onRunEnd`가 `cheat && !devLogin`이면 제출하지 않고 "시험 모드: 순위 제외"를 보인다. autotest.js는 건드리지 않았다. | `tools/test-account.js`, `tools/e2e-account.py`(devlogin과 god=1은 그대로 ranked) |
| R2 내 순위 줄 글꼴 | 고침. `ctx.restore()` 뒤에 `curFont = ''`. | 눈으로 확인할 화면 항목(자동 시험 없음) |
| R3 로그아웃 | 고침. `r.ok` 또는 401일 때만 `toGuest()`, 그 밖에는 안내를 보이고 false. | `tools/test-account.js` |
| R4 순위표 저장본 | 고침. toGuest와 계정 전환(applyMe)에서 `me`를 지우고 `rebuildBoards`로 `mine`을 다시 계산해 저장한다. 닉네임 변경 뒤에는 `me`는 두고 `mine`만 다시 계산한다. | `tools/test-account.js` |
| R5 iOS 화면 밀림 | 코드 적용(`blur()` 뒤 `scrollTo(0, 0)`과 `platform.resize()`). 실기기(iPhone Safari, 홈 화면 앱) 확인은 아직 못 했다. | 없음(실기기 확인 필요) |
| R6 닉네임 폼 키보드 | 고침. `closest('#nick')`로 폼 전체를 제외한다. | 브라우저 입력 항목(자동 시험 없음) |
| R7 개발용 로그인 이중 방어 | 고침. `--dev`이면서 `PUBLIC_ORIGIN`이 `https://`로 시작하면 종료하고, `--dev`의 기본 host는 `127.0.0.1`이다(`--host`로 바꿀 수 있고, `tools/devserver.py`는 이미 지정한다). | `test_dev_login.py` |
| R8 새 버전 알림 | 고침. `release.js`가 배포 파일 내용 해시를 `sw.js`의 `BUILD`와 캐시 이름에 쓰고, `deploy.sh`가 다시 계산해 다르면 멈춘다(`SKIP_RELEASE_CHECK=1`이면 건너뜀). 해시는 CR을 뺀 내용으로 계산해 CRLF 체크아웃에서도 같다. 주의: 커밋된 `sw.js`의 BUILD는 이 커밋 시점의 배포 파일 기준이다. 밸런스 작업으로 js 파일이 바뀌면 배포 전에 `node tools/release.js 1.0.0`을 다시 실행해야 한다. | 임시 복사본에서 release 전 차단, release 뒤 통과, data만 수정 시 차단, 재실행 시 sw.js 바이트와 캐시 이름 변경, CRLF 변환 통과를 확인. `bash deploy/test-install.sh` 61개 통과 |
| R9 소켓 제한 시간 | 고침. `read_exact`에 `finally: settimeout(SOCKET_TIMEOUT)`. | `test_review2.py` |
