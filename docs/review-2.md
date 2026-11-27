# 코드 리뷰 2

- 범위 A: 게임 S5~S8, `git diff be252ea..e2250b3 -- js/ tools/ index.html`. 기준은 DESIGN.md 4~5장과 DECISIONS.md다.
- 범위 B: 계정 서버 S16~S18, `794d038` 시점의 server/ 전체와 tools/gen-bounds.js. 기준은 DESIGN-ACCOUNT.md와 server/DECISIONS-SERVER.md다.
- 줄 번호는 위 커밋 시점 파일 기준이다. 작업 트리의 현재 줄 번호와 다를 수 있다.

## A. 게임 (S5~S8)

### A1 [필수] 풀이 차면 보스가 나오지 않음
- 위치: js/systems/spawner.js:96-99 (`spawnBossAt`), js/entities/enemies.js:149-151 (`spawnBoss`), js/entities/enemies.js:88-94 (여왕 소환), js/systems/spawner.js:85-93 (포위 진드기 special)
- 문제: 일반 적 300 상한은 special이 아닌 적만 센다. 포위 진드기, 여왕 소환 나방, 엘리트, 까마귀가 모두 special이라 여유분 60을 함께 쓴다. 풀이 차면 `pool.spawn()`이 null을 돌려주고 `spawnBoss`도 null로 끝난다. 경고 배너와 진동은 이미 나간 뒤다.
- 실패 상황: 13:00 무렵에는 일반 적이 300 가까이 유지된다. 13:30 포위 진드기 56마리와 11:00, 12:00, 13:00 엘리트가 남아 있으면 360칸이 찬다. 그러면 14:00 마지막 그림자가 생기지 않고 경고만 뜬다. 10:00 여왕을 잡지 못하면 8초마다 나방 8마리가 상한 없이 쌓여서 풀이 더 빨리 찬다.
- 고칠 방법:
  1. 보스용 예약 칸을 둔다. 보스가 아닌 special 스폰은 `pool.spawn(LW.POOL.enemies - 4)`로 제한한다.
  2. `spawnBoss`는 풀이 가득 차 있으면, 플레이어에서 가장 먼 일반 적 1마리를 처치 처리 없이 지우고 그 칸을 쓴다.
  3. 여왕 소환 나방의 동시 수에 상한을 둔다(예: 살아 있는 소환 나방 24마리).

### A2 [필수] 가시 원반의 재타격 간격이 원반끼리 공유됨
- 위치: js/entities/projectiles.js:70-74
- 문제: 원반은 `e.hitCd[p.slot]`을 쓴다. 그래서 같은 무기의 모든 원반이 적 1마리당 쿨다운 하나를 같이 쓴다. DESIGN.md 3.6은 원반마다 `hitIds`와 짝을 이루는 `Float32Array(16)` 쿨다운으로 정했다. DECISIONS.md에도 이 변경 기록이 없다.
- 실패 상황: 칼날 폭풍은 원반 6~8개가 모두 가장 가까운 적 쪽으로 방향을 튼다(projectiles.js:32-45). 원반이 한 적에게 모여도 0.4초에 한 번만 맞는다. 단일 대상 DPS가 설계값의 1/6~1/8로 떨어진다. Lv8 원반 4개도 같은 문제가 있다.
- 고칠 방법: 투사체에 `hitT: new Float32Array(16)`을 더한다. kind 1에서 `hitIds[h] === e.uid`인 칸을 찾아 `hitT[h] > time`이면 건너뛴다. 없으면 빈 칸이나 만료된 칸에 uid와 `time + hitGap`을 넣는다. `fireDisc`에서 `hitN = 0`으로 초기화한다.

### A3 [권장] 장판 풀(120)이 차면 게임 판정용 장판이 조용히 빠짐
- 위치: js/entities/areas.js:15-17, 25-28, 36-41. 호출 위치: js/entities/enemies.js:77 (거인 내려찍기 TELE), js/weapons/behaviors.js:377 (포자 TELE), 312 (항아리), 332 (씨앗)
- 문제: 연출(BLAST, BOLT, CHAIN, SWING)과 판정(TELE, POISON, FLASK, SEED)이 같은 120칸을 쓴다. 꽉 차면 `add`가 null을 돌려주고 호출한 쪽은 그냥 넘어간다.
- 실패 상황: 진화 무기 여러 개에 쿨다운 -40%를 갖추면 장판 수가 늘어난다. 폭화 정원은 1회 폭발에 연출 4칸을 쓰고, 탐식의 늪은 장판 약 18개가 겹친다. 여기에 포자 대량 처치까지 겹치면 상한에 닿을 수 있다. 그러면 보스 내려찍기와 포자 폭발이 일어나지 않고, 씨앗과 항아리도 사라진다. 실제 최대치는 확인 필요다(`&build=all&start=780&debug=1`로 `LW.areas.n` 최대값 측정).
- 고칠 방법: 연출용 add는 `pool.spawn(LW.POOL.areas - 24)`처럼 상한을 낮춰서 판정용 칸을 남긴다. 디버그 오버레이에 장판 최대 수를 더한다.

### A4 [권장] 번개 종이 앞선 낙뢰로 죽은 대상을 건너뛰어 낙뢰 수가 줄어듦
- 위치: js/weapons/behaviors.js:229-238
- 문제: 앞선 낙뢰의 `damageCircle`이 뒤 후보를 죽이면 `if (!tg.active) continue;`로 그 낙뢰를 버린다. 후보가 남아 있어도 다시 뽑지 않는다.
- 실패 상황: 적이 촘촘하고 HP가 낮을 때(예: 반경 60인 폭풍 종탑) 낙뢰 7개 중 일부가 나가지 않는다.
- 고칠 방법: 낙뢰 수와 후보 인덱스를 따로 센다. 남은 후보에서 살아 있는 적이 나올 때까지 계속 뽑는다.

### A5 [권장] `bossKilled`가 보스 종류를 구분하지 않음
- 위치: js/weapons/behaviors.js:375
- 문제: 아무 보스나 잡으면 1씩 오른다. DESIGN.md 5.4의 "완전한 새벽"은 14:00 보스(last)를 잡았을 때만이다. 서버 `dawn` 검사(`bosses >= 1`)와도 의미를 맞춰야 한다.
- 실패 상황: S10에서 `bossKilled > 0`으로 완전한 새벽을 판정하면, 거인만 잡고 15:00까지 버틴 판도 완전한 새벽이 된다.
- 고칠 방법: `if (e.def.id === 'last') g.lastBossKilled = true;`를 따로 두고, 결과 화면과 제출값 `fullDawn`은 이 값으로 정한다.

### A6 [권장] 화면 그리기에서 매 프레임 문자열을 만듦
- 위치: js/render.js:538-539
- 문제: 폭발 장판마다 매 프레임 `'rgba(' + ... + ')'` 문자열을 두 개 새로 만든다. 갱신 루프는 아니지만 모바일 GC 부담이 생긴다.
- 고칠 방법: 테마별 fill과 stroke 문자열을 미리 배열로 만들어 둔다.

### 확인했고 문제없는 항목
- qbuf 중첩 질의: dealDamage와 killEnemy 안에는 질의가 없다(spawnGem, dropChest, areas.add, effects만 부름). orbit, halo, scythe, projectiles, areas(POISON 뒤 pull, SEED 판정 뒤 폭발), bell(damageCircle 뒤 chain) 모두 질의가 순서대로 실행되고 겹치지 않는다. 원반의 steer(nearest)도 같은 반복의 queryRadius보다 먼저 끝난다.
- 갱신 루프 안 할당: 매 프레임 실행되는 경로에는 할당이 없다. levelup.open, chest.open, 경고 문구 조립은 이벤트 때 한 번씩만 할당하므로 문제 삼지 않는다.
- 진화 조건: Lv8, 짝 패시브 Lv1 이상, 상자 순서가 설계와 같다. 진화 무기는 레벨업 후보와 상자 레벨업 후보에서 빠진다.
- 슬롯 제한: 무기와 패시브 모두 6칸이다. 무기 슬롯 번호는 0~5라 `hitCd(6)`, `dmgBySlot(6)` 범위 안이다.
- hitCd: 궤도 무기가 슬롯 단위로 공유하는 것은 설계("같은 적은 0.5초에 한 번")와 같다. 문제는 A2의 원반뿐이다.
- 보스 이벤트 중복: prepare는 reset에서만 실행되고, evIdx로 한 번씩만 꺼낸다. 중복은 없다. 다만 A1처럼 경고만 나가고 보스가 없는 경우가 있다.
- 수치: 무기 8종, 패시브 10종, 진화 8종, 적 8종, 보스 3종, 스폰 표와 이벤트가 DESIGN.md 4~5장과 같다.
- O(n^2) 경로: 없다. 밀어내기는 이웃 8마리로 끊고, bell과 flask의 전체 순회는 쿨다운마다 O(n)이다. 투사체와 궤도의 질의 반경은 작다.

## B. 계정 서버 (S16~S18)

### B1 [필수] S8 뒤에도 bounds.json의 엘리트와 보스 목록이 비어 있음
- 위치: server/bounds.json:5-7 (`"elites": [], "bosses": [], "lastBossT": 0`). e2250b3 시점에도 같다. 검사 위치: server/game_api.py:1054-1057
- 문제: DECISIONS-SERVER.md 16줄에 "S8 뒤 gen-bounds를 다시 돌려 커밋"이라고 적혀 있지만 아직 하지 않았다.
- 실패 상황: 엘리트나 보스를 1마리라도 잡은 정상 판이 모두 `events`로 rejected된다. `fullDawn` 판은 모두 `dawn`이나 `events`로 거부된다. 2:00이 지나면 사실상 모든 판이 대상이다.
- 고칠 방법: `node tools/gen-bounds.js`를 실행하고 bounds.json을 커밋한다. 다시 생기지 않도록, 임시 파일로 gen-bounds를 돌려서 커밋된 bounds.json과 자동 영역이 같은지 보는 시험을 server/tests에 더한다.

### B2 [권장] ValueError를 연결 끊김으로 보고 응답을 보내지 않음
- 위치: server/game_api.py:492-495. 원인 위치: 1402 (`ls.isdigit()` 다음 `int(ls)`), 470 과 542-544 (Content-Length), 505 (`parse_qs(max_num_fields=20)`)
- 문제: `str.isdigit()`는 위 첨자 2(U+00B2) 같은 유니코드 숫자에도 True를 돌려준다. 그 뒤 `int()`에서 ValueError가 난다. 필드 20개를 넘는 질의도 ValueError를 낸다. dispatch는 ValueError를 OSError와 같이 다뤄서 아무 응답도 보내지 않는다.
- 실패 상황: `GET /api/leaderboard?limit=%C2%B2`, 필드가 21개인 질의, Content-Length 값이 바이트 0xB2인 요청이 400이 아니라 빈 응답을 받는다. 앞으로 처리 코드에서 생기는 다른 ValueError도 500 없이 묻힌다.
- 고칠 방법: 숫자 검사는 `re.fullmatch(r"[0-9]{1,9}", s)`로 바꾼다. dispatch에서는 `ConnectionError`, `TimeoutError`만 조용히 넘기고, 나머지 ValueError는 400이나 500 응답을 보낸다.

### B3 [권장] 차단된 사용자는 로그아웃과 계정 삭제를 못 함
- 위치: server/game_api.py:557-565, 935 (logout), 968 (DELETE /api/me)
- 문제: login="required" 라우트는 차단 사용자에게 403 banned를 돌려준다. DESIGN-ACCOUNT.md 9장은 계정 삭제를 앱 안의 버튼으로만 받는다고 정했다.
- 실패 상황: 차단된 사용자는 자기 데이터를 지울 방법이 없다. HttpOnly 세션 쿠키도 지울 수 없다.
- 고칠 방법: route에 `allow_banned` 옵션을 더하고 logout과 DELETE /api/me에만 켠다. DECISIONS-SERVER.md 47줄도 함께 고친다. 설계 의도는 확인 필요다.

### B4 [권장] 느린 연결이 스레드를 계속 잡을 수 있음
- 위치: server/game_api.py:418 (`timeout = SOCKET_TIMEOUT`), 550 (`rfile.read(n)`), 586-592 (스레드 수 제한 없음)
- 문제: 15초 시간 제한은 recv 한 번마다 걸린다. 요청 전체에 걸리는 제한이 아니다. 본문을 14초마다 1바이트씩 보내면 32KB 본문 하나로 연결을 매우 오래 붙잡을 수 있다. 스레드 수에는 상한이 없다.
- 실패 상황: IP당 분당 120 연결까지 받으므로 느린 연결이 계속 쌓이면 스레드와 메모리가 고갈된다. Caddy가 요청 본문을 버퍼링하거나 시간 제한을 거는지는 확인 필요다.
- 고칠 방법: `Server.process_request`에서 `BoundedSemaphore(64)`를 쓰고, 넘치면 바로 503을 보낸다. 본문은 전체 마감 시각(예: 10초)을 두고 나눠 읽는다. Caddyfile에도 `request_body`와 `transport http { read_timeout }` 설정을 둔다.

### B5 [권장] 시작 직후 JWKS 받기에 실패하면 5분 동안 로그인이 안 됨
- 위치: server/game_api.py:711-723
- 문제: 키가 하나도 없을 때도 재시도 간격이 300초다.
- 실패 상황: 컨테이너가 시작될 때 외부망이 잠깐 끊기면 첫 로그인부터 5분 동안 모두 `token`으로 실패한다.
- 고칠 방법: `self.keys`가 비어 있으면 재시도 간격을 30초로 줄인다.

### B6 [권장] 승리 판의 timeMs는 정확히 900000이어야 함 (클라이언트 작업 주의)
- 위치: server/game_api.py:1049-1053
- 문제: `won`이면 `timeMs == winMs`를 요구한다. 게임은 `g.time += 1/60`을 누적하므로, 승리한 프레임의 g.time이 900.0167처럼 900을 조금 넘을 수 있다.
- 실패 상황: S19 이후 클라이언트가 `Math.round(g.time*1000)`을 그대로 보내면 승리 판이 `win`으로 rejected될 수 있다.
- 고칠 방법: 클라이언트는 승리 판의 timeMs를 `LW.WIN_TIME*1000`으로 고정해서 보낸다. 서버를 바꾸지 않는다면 DESIGN-ACCOUNT.md 10장에 이 규칙을 적어 둔다.

### 확인했고 문제없는 항목
- RS256 검증: 서명 길이와 `s < n`을 검사하고, EMSA-PKCS1-v1_5 기대값 전체를 `compare_digest`로 비교한다. 패딩을 해석하지 않으므로 패딩 파싱 오류를 노린 서명 위조 경로가 없다. alg는 RS256으로 고정하고, 키는 2048비트 이상, e는 3 이상의 홀수만 받는다. 클레임은 서명을 확인한 뒤에 본다. iss, aud(목록이면 azp 필수), azp, exp 60초, iat 300초, nonce = sha256(state) 모두 설계와 같다.
- JWKS 캐시: 모르는 kid로 다시 받기를 유도해도 5분에 1회로 제한된다. 받기에 실패하면 옛 키를 유지한다. 받기는 별도 Lock 안에서 하므로 DB Lock과 엉키지 않는다.
- 세션 쿠키: `__Host-` 접두사, HttpOnly, Secure, SameSite=Lax, Domain 없음. DB에는 토큰의 sha256만 둔다. 로그인 상태 쿠키는 SameSite=None이고 state와 compare_digest로 비교한다. 돌아갈 주소가 고정이라 오픈 리디렉션이 없다.
- Origin 검사: POST, PUT, DELETE 모두 Origin이 정확히 같아야 한다. JSON Content-Type도 강제한다. 콜백만 예외이고, 대신 state 쿠키로 보호한다. 없는 경로도 먼저 403을 받는다.
- SQL 인젝션: 모든 질의가 `?` 매개변수다. executescript는 상수 스키마에만 쓴다.
- 요청 제한: X-Real-IP는 Caddy의 `header_up X-Real-IP {remote_host}`가 덮어쓰고 컨테이너는 expose만 하므로 설계대로다. runs, tickets, settings는 사용자 기준이다.
- 판 제출: 검사 순서와 사유 코드가 DECISIONS-SERVER.md와 같다. 표 사용은 `UPDATE ... WHERE used_at IS NULL`의 rowcount로 원자적으로 처리한다. 한 요청 전체가 트랜잭션 하나다. clientRunId 중복은 UNIQUE 제약과 같은 트랜잭션 안의 조회로 막는다. 큰 정수, 실수, bool, NaN 입력도 is_int, is_number로 걸러진다. 설계가 이미 인정한 허점(미리 받은 표, 수정한 클라이언트로 실제 시간 플레이) 밖의 우회 경로는 찾지 못했다.
- 동시성: 연결 하나를 Lock으로 감싸고 쓰기는 BEGIN IMMEDIATE로 한다. WAL과 busy_timeout으로 CLI 프로세스와도 함께 쓸 수 있다. 순위표 캐시 dict는 Lock 없이 쓰지만, 경합이 나도 최대 30초 늦은 값이 보일 뿐이다.
- tools/gen-bounds.js: config, util, waves를 vm에서 실행해 자동 영역을 만들고 손으로 정하는 값은 그대로 둔다. xpToReach 계산이 DESIGN.md 3.9 식과 같다. 결함은 없고, B1의 재실행만 필요하다.
