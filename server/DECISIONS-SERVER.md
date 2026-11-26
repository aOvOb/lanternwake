# 계정 서버 구현 중 결정 (S16~S18)

DESIGN-ACCOUNT.md에서 모호했던 부분을 구현하면서 정한 내용이다. 메인 `DECISIONS.md`가 아니라 이 파일에 둔다.

## 구성과 실행

- 테스트는 설계의 `server/test_game_api.py` 대신 `server/tests/`에 둔다. 실행은 저장소 루트에서 `python -m unittest discover -s server/tests`다. 시험용 RSA 키는 `server/tests/fixtures/test_keys.json`(`gen_test_keys.py`가 표준 라이브러리만으로 생성)이다.
- `--dev`의 데이터 폴더 기본값은 `server/.devdata/`(git 제외)다. `DATA` 환경 변수가 있으면 그것을 쓴다.
- `bounds.json`의 기본 경로는 `game_api.py`와 같은 폴더다. 컨테이너에서는 `/app/bounds.json`과 같다.
- 개발 모드(`--dev`)의 로그인 상태 쿠키는 `SameSite` 속성을 생략한다. `http`에서는 `Secure`를 못 쓰고, `Secure` 없는 `SameSite=None`은 브라우저가 버리기 때문이다. 브라우저 기본값(Lax, 구글에서 오는 POST에 대한 2분 예외)에 기댄다. 실제 구글 로그인으로 확인이 필요하다.

## bounds.json (gen-bounds.js)

- 자동 영역은 `winMs`, `maxLevel`(200), `elites`([t초, 마릿수]), `bosses`, `lastBossT`, `xpToReach`(인덱스가 레벨, `xpToReach[L]`은 1에서 L까지 올리는 누적 경험치)다. 손으로 정하는 값은 `kpmMax`(분마다 1200 x 15개)와 `minRankedVersion`(처음엔 `LW.VERSION`)이다.
- `type`이 `elite`인 이벤트는 `n`(없으면 1)마리, `boss`는 1마리로 센다. 한 시각에 엘리트가 둘이면 이벤트 둘로 적어도 된다.
- `js/data/waves.js`의 `LW.EVENTS`는 지금 비어 있다(S8 전). 그래서 커밋된 `server/bounds.json`의 `elites`, `bosses`도 비어 있다. S8이 끝난 뒤 `node tools/gen-bounds.js`를 다시 돌리고 커밋해야 한다. 그 전에 클라이언트가 엘리트 처치를 올리면 `events` 검사에서 rejected가 된다.
- 서버 시험은 DESIGN.md 5.4 표를 옮긴 `tests/fixtures/waves-design.js`에서 만든 `bounds-design.json`을 쓴다. 실제 게임 데이터가 바뀌어도 서버 시험이 흔들리지 않는다.
- `gen-bounds.js`는 `js/config.js`, `js/util.js`, waves 파일을 `vm`에서 순서대로 실행한다. 이 파일들이 브라우저 전용 API(`document` 등)를 최상위에서 부르면 sandbox에 같은 스텁을 더해야 한다.

## 판 검사

- 시각 경계: 이벤트 시각 `t`가 `t x 1000 <= timeMs`이면 등장한 것으로 센다. 분별 `xp` 검사의 기준 시각은 `min((i+1) x 60000, timeMs)`다.
- 표 검사 해석: 6.2 표의 `ticket` 줄과 S18 완료 기준("같은 표 재사용은 두 번째 판이 unranked")이 충돌해서, 표가 없거나 남의 것이거나 이미 쓴 경우는 `unranked`(`no_ticket`), 만료는 `unranked`(`ticket_expired`)로 한다. 표가 유효할 때 `elapsed` 검사만 `rejected`다.
- 검사 순서: 형식(`range`, `ver`) -> `range` -> `win` -> `dawn` -> `events` -> `shape` -> `kpm` -> `xp` -> 버전(`old_version`) -> 30초 미만(`too_short`) -> 표 -> `elapsed`. 거부된 판과 `old_version`, `too_short` 판은 표를 쓰지 않는다.
- 설계에 없는 사유 코드를 더했다. `too_short`(30초 미만, unranked), `ver`(버전 형식 오류, rejected), `client_run_id`와 `shape`(항목이 객체가 아니거나 `clientRunId` 형식 오류. 저장하지 않고 결과만 돌려줌).
- `clientRunId`는 `[A-Za-z0-9-]` 8~64자다. `ver`는 `숫자.숫자.숫자`이고 버전은 숫자로 비교한다(`0.10.0 > 0.9.0`).
- 같은 `clientRunId`를 다시 보내면 `{"status":"duplicate","first":<처음 status>,"reason":<처음 reason>,"rank":<처음이 ranked면 현재 순위>}`를 돌려준다. 내용을 바꿔 보내도 처음 결과가 우선이다.
- `/api/runs`는 한 요청 전체가 하나의 트랜잭션이다. 서버 오류가 나면 일부만 저장되지 않는다(클라이언트가 같은 요청을 다시 보내도 안전).
- 하루 300판은 DB의 최근 24시간 제출 행 수로 센다(rejected 포함, 저장하지 않는 `client_run_id` 오류는 제외). 시간당 30회 요청은 메모리 버킷이다.
- `suspects`: `kpm_top`은 `ranked`, 숨기지 않음, 차단 아님 판의 분당 최대 처치 수가 99.9 백분위 이상인 판이다(100판 미만이면 최댓값 하나). `pre_ticket_rank1_<보드>`는 그 보드 1위이고 표를 받은 지 `판 길이 + 1시간`이 넘은 판이다.

## 순위표와 계정

- `achieved_at`은 서버가 받은 시각(초)이다. 기기 시각(`endedAt`)은 쓰지 않는다. 같은 값이면 먼저 제출한 쪽이 위이고, 그것도 같으면 사용자 번호가 작은 쪽이다.
- 같은 값의 판이 다시 들어와도 `best`는 바꾸지 않는다(먼저 달성한 시각 유지).
- 순위표 응답의 `entries`는 보드별 30초 캐시(상위 100)이고 `me`는 매번 새로 계산한다. 캐시는 닉네임 변경, 계정 삭제, 숨김, 차단, `rebuild-best` 때 서버 프로세스 안에서 비운다. CLI는 다른 프로세스라 실행 중인 서버의 캐시는 최대 30초 뒤에 반영된다.
- `limit`은 1~100(기본 50)이고 100을 넘으면 100으로 줄인다. 비어 있거나 숫자가 아니거나 0이면 400이다. `board`가 `time`, `kills`가 아니면 400이다.
- 닉네임: 지금 이름과 같으면(NFC 기준) 아무 일도 하지 않고 200이다(자동 닉네임을 그대로 두는 경우 포함, `nicknameSet`은 그대로). 검사에 실패하거나 중복인 시도는 24시간 쿨다운을 시작하지 않는다. 관리자 `rename`은 형식과 중복만 보고 예약어, 금칙어, 쿨다운은 건너뛴다. 금칙어는 짧은 목록(욕설 10개 안팎)이다.
- 설정: 저장된 것이 없고 받은 `rev`가 0이면 아무것도 저장하지 않고 기본값을 돌려준다. 3개 키 외의 값은 버린다.
- 가져오기: `bestTime`(초)은 ms로 바꾸고 900초로 줄인다. 처치 수 100만, 레벨 200, 횟수 100만을 넘는 값은 상한으로 줄인다. 필드가 빠지면 0이다. 숫자 형식이 틀리면 400이고, 실패한 요청은 `imported`를 켜지 않는다.

## 공통 처리

- 쓰기 요청의 검사 순서는 요청 제한 -> `Origin` -> 411 -> 413 -> `Content-Type` -> 라우트다. 없는 경로도 먼저 403, 411, 413을 받는다. 본문 없는 쓰기 요청도 `Content-Length: 0`이 있어야 한다.
- 연결은 요청마다 닫는다(HTTP/1.0). 거부한 요청의 본문은 64KB까지 읽어 버려서, 클라이언트가 응답 전에 연결 재설정을 받지 않게 한다. 소켓 시간 제한은 15초다.
- 로그인 콜백의 요청 제한 초과는 JSON 429가 아니라 `303 /?login=fail&r=rate`로 돌려준다(브라우저 이동이라서).
- 차단된 사용자도 로그인(세션 발급)은 된다. 이후 모든 로그인 필요 API가 403 `banned`를 돌려준다.
- `X-Real-IP`가 없으면 소켓 상대 주소를 쓴다(로컬 시험용).
- JWKS를 못 받으면 남아 있는 옛 키로 계속 검증한다. 다시 받기는 5분에 한 번이다. `max-age`는 60초에서 24시간 사이로 맞추고, 헤더가 없으면 1시간이다.

## 작업 이력

- S16 파일(`server/game_api.py` 뼈대, `server/tests/support.py`, `test_server_basics.py`)은 같은 작업 트리의 다른 coder가 만든 커밋 `1e9e2f7`(S5)에 함께 들어갔다. 이미 푸시된 이력이라 고치지 않았다.
