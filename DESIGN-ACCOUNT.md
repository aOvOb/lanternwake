# Lanternwake(등불지기) 계정 설계: 구글 계정 로그인

기준일 2026-11-26. 본 설계(`DESIGN.md`)와 결정 기록(`DECISIONS.md`)을 바탕으로 한다. 서버 구성은 OwL-server 레포(`docker-compose.yml`, `Caddyfile`, `HANDOFF.md`, `authgate/authgate.py`, `ops/owl-backup`)를 읽고 그 방식에 맞췄다. "확인 필요"는 아직 검증하지 못한 부분이다.

---

## 0. 결정과 근거

**결정:** 로그인 없이 게스트로 바로 플레이하고, 구글 로그인은 선택 기능으로 둔다. 로그인 방식은 구글 OpenID Connect의 리디렉션 방식(`response_type=id_token`, `response_mode=form_post`, 범위는 `openid`만)이다. 서버는 파이썬 표준 라이브러리만 쓰는 작은 API(`game` 컨테이너, SQLite)이고, 세션은 HttpOnly 쿠키로 한다. 로그인하면 기록과 설정이 여러 기기에서 동기화되고, 전체 순위표(최고 생존 시간, 처치 수)에 오른다.

**근거:**
- 외부 스크립트(`accounts.google.com/gsi/client`)와 iframe 버튼이 필요 없다. 캔버스로 그린 버튼에서 같은 출처의 `/api/auth/start`로 이동하기만 하면 된다. 그래서 "UI는 캔버스로만 그린다"(결정 6), "외부 URL을 쓰지 않는다"(2장 규칙)를 지킨다. 구글은 iOS에서 팝업 대신 리디렉션 방식을 요구한다. 이 방식은 처음부터 리디렉션이라 그 제약에 걸리지 않는다.
- `id_token`을 서버로 직접 POST 받기 때문에 클라이언트 비밀(client secret)이 필요 없고, 서버가 구글 토큰 엔드포인트를 부를 일도 없다. 서버가 하는 일은 구글 공개키(JWKS)로 서명을 검증하는 것뿐이다.
- 범위를 `openid` 하나로 줄이면 ID 토큰에 이메일, 이름, 사진이 들어오지 않는다. 받는 값은 `sub`(구글 계정 고유 번호)뿐이다. 순위표 이름은 사용자가 정한 닉네임만 쓰므로 이름도 필요 없다. 구글 동의 화면에도 최소 항목만 나온다.
- 파이썬 표준 라이브러리 서버는 기존 authgate와 같은 방식(`python:3.12-alpine` 이미지, 스크립트를 읽기 전용으로 마운트, 이미지 빌드 없음)이다. 메모리는 수십 MB 수준이고, 의존성 업데이트 관리가 없다. SQLite는 파이썬에 들어 있고, 백업도 기존 Gonic DB와 같은 방식(`sqlite3 .backup`)으로 한다.

**과금 0원 확인:**
- 구글 OAuth 클라이언트 ID 만들기와 로그인 자체는 무료이고 결제 계정 연결 없이 된다. 구글 클라우드 프로젝트를 만들 때 결제 계정을 연결하라는 안내가 나와도 건너뛸 수 있다(콘솔 화면 문구는 확인 필요).
- 범위가 `openid`, `email`, `profile` 안이면 앱이 "테스트" 상태여도 테스트 사용자 목록 없이 누구나 로그인할 수 있고, 7일 만료도 없다(Google 문서 "Manage App Audience"). "프로덕션"으로 게시할 때 인증 심사가 필요 없는지는 확인 필요. 심사를 요구하면 "테스트" 상태로 둬도 된다.
- Firebase, Supabase, Identity Platform은 쓰지 않는다. 서버는 기존 오라클 Always Free 서버에 컨테이너 하나를 더할 뿐이다.

---

## 1. 기능 범위

| 구분 | 게스트 | 로그인 |
|---|---|---|
| 플레이 | 바로 시작, 오프라인 가능 | 같음 |
| 기록 | 이 기기 localStorage | 서버에 저장, 기기 간 동기화 |
| 설정 | 이 기기 | 소리, 진동, 데미지 숫자만 동기화. 화질은 기기마다 다르므로 동기화하지 않음 |
| 순위표 | 보기만 가능 | 보기, 내 기록 등록, 내 순위 표시 |
| 오프라인 판 | 해당 없음 | 대기열에 두었다가 온라인일 때 올림 |

- 로그인은 TITLE 화면에서만 시작한다. 로그인 과정에서 페이지가 구글로 이동하므로 진행 중인 판이 없을 때만 허용한다.
- 처음 로그인한 기기에 게스트 기록이 있으면 한 번만 계정 기록에 합친다(최고값은 큰 값, 횟수는 더함). 이 값은 개인 기록에만 들어가고 순위표에는 들어가지 않는다. 검증할 수 없는 값이기 때문이다.
- 하지 않는 것: 친구, 채팅, 프로필 사진, 이메일 알림, 계정 이전, 웹 관리자 화면. 관리 작업은 서버 CLI로 한다.

---

## 2. 선택지 비교

### 2.1 로그인 방식

| 안 | 장점 | 단점 |
|---|---|---|
| A. GIS 버튼(팝업) | 구글 공식 버튼, 구현이 짧음 | 외부 스크립트와 iframe 필요. 캔버스 UI 원칙 위반. 구글 문서상 iOS에서는 팝업 대신 리디렉션 필요 |
| B. GIS 버튼(리디렉션, `login_uri`) | iOS 대응 | A의 외부 스크립트와 iframe 문제는 그대로 |
| C. 서버 코드 흐름(`response_type=code`) | 토큰이 TLS로 서버에 직접 옴 | 클라이언트 비밀을 서버에 보관하고 토큰 교환 호출 필요 |
| **D. OIDC 리디렉션 + `id_token` + `form_post` (추천)** | 외부 스크립트 없음, 비밀 없음, 캔버스 버튼 가능, 처음부터 리디렉션이라 iOS 제약 없음 | 브라우저를 거쳐 오는 토큰이라 서명 검증이 필수(어차피 요구사항). 콜백이 다른 사이트에서 오는 POST라 로그인 상태 쿠키는 `SameSite=None`이어야 함 |

구글 OIDC discovery 문서에서 `response_types_supported`에 `id_token`이, `response_modes_supported`에 `form_post`가 있음을 확인했다.

### 2.2 백엔드 언어와 저장소

| 안 | 메모리 | 유지보수 |
|---|---|---|
| **파이썬 표준 라이브러리 + sqlite3 (추천)** | 약 20~30MB | authgate와 같은 방식. 빌드 없음. RS256 검증 약 20줄을 직접 작성 |
| 파이썬 + `cryptography` 패키지 | 약 30~40MB | charts처럼 Dockerfile 빌드 필요. 패키지 업데이트 관리 |
| Node 24 (`crypto.verify`, `node:sqlite`) | 약 50MB | 의존성은 없으나 서버 레포에 Node 운영 경험이 없음 |
| Go | 약 10MB | 빌드 도구와 배포 파이프라인을 새로 만들어야 함 |
| Kotlin/Spring(OwL 백엔드 방식) | 200MB 이상 | 이 규모에 과함 |

RS256 서명 검증은 RFC 8017 8.2.2의 "인코딩해서 통째로 비교" 방식으로 한다. 서명을 `pow(s, e, n)`으로 풀고, 기대값 `00 01 FF..FF 00 || SHA-256 DigestInfo || 해시`를 직접 만들어 전체 바이트를 `hmac.compare_digest`로 비교한다. 패딩을 파싱하지 않으므로 알려진 서명 위조 버그(Bleichenbacher 계열)가 생길 여지가 없다. 리뷰에서 이 직접 구현이 받아들여지지 않으면 `cryptography` 패키지 안으로 바꾼다(aarch64 musl용 wheel 제공 여부는 확인 필요).

### 2.3 세션 방식

| 안 | 판단 |
|---|---|
| **HttpOnly 쿠키(추천)** | API가 게임과 같은 출처(`game.aovob7.duckdns.org/api`)라 쿠키가 자연스럽다. 스크립트가 세션 값을 읽을 수 없어 XSS로 훔쳐 가기 어렵다 |
| Bearer 토큰(localStorage) | iOS는 스크립트로 쓴 저장소를 7일 미사용 시 지울 수 있다. 스크립트에서 읽을 수 있어 XSS에 약하다 |

세션 값은 무작위 32바이트이고, DB에는 SHA-256 해시만 둔다. DB가 새어도 세션을 쓸 수 없고, 로그아웃과 계정 삭제 때 바로 무효화할 수 있다.

---

## 3. 구성도

```
[휴대폰 PWA / 브라우저]
  index.html + js/*.js (캔버스 UI)
  sw.js: /api/* 는 손대지 않음(캐시 안 함, index.html로 대체 안 함)
  localStorage: records, settings, account, queue, tickets, board
        |
        | HTTPS (같은 출처)
        v
[오라클 Always Free 서버, Docker compose (/srv/stack)]
  caddy (443)
    game.aovob7.duckdns.org
      /api/*  --reverse_proxy-->  game:8080 (X-Real-IP 전달)
      그 밖   --file_server-->    /srv/owl-web/game/current (읽기 전용 마운트)
  game (python:3.12-alpine, 새 서비스)
    /app/game_api.py, /app/bounds.json   (./game, 읽기 전용)
    /data/game.db, /data/pepper          (./game-data)
        |
        | HTTPS, 서버에서 바깥으로(공개키만 받음)
        v
  https://www.googleapis.com/oauth2/v3/certs (구글 JWKS)

[로그인 흐름]
  PWA --GET /api/auth/start--> game --302--> accounts.google.com/o/oauth2/v2/auth
  구글 --POST(form) /api/auth/callback {id_token, state}--> game
  game: 상태 쿠키 대조, 서명/aud/iss/exp/nonce 검증, 사용자 생성, 세션 쿠키 발급
  game --303--> /?login=ok --> PWA가 GET /api/me
```

---

## 4. 로그인 흐름 상세

1. 사용자가 TITLE의 "Google 계정으로 로그인"을 누른다. 오프라인이면 버튼을 흐리게 하고 "인터넷 연결이 필요해요"를 보여준다.
2. 클라이언트가 `location.href = './api/auth/start'`로 이동한다.
3. 서버(`GET /api/auth/start`):
   - 무작위 32바이트 `c`를 만든다.
   - 쿠키 `__Host-lw_login=c; Path=/; Max-Age=600; HttpOnly; Secure; SameSite=None`을 내린다. 구글의 콜백이 다른 사이트에서 오는 POST라서 `SameSite=None`이어야 이 쿠키가 같이 온다.
   - 302로 `https://accounts.google.com/o/oauth2/v2/auth`로 보낸다. 매개변수는 다음과 같다.
     - `client_id`: 환경 변수 `GOOGLE_CLIENT_ID`
     - `redirect_uri`: `https://game.aovob7.duckdns.org/api/auth/callback`
     - `response_type=id_token`, `response_mode=form_post`, `scope=openid`
     - `state=c`, `nonce=hex(sha256(c))`, `prompt=select_account`
4. 사용자가 구글 계정을 고른다.
5. 구글이 `POST /api/auth/callback`으로 `id_token`, `state`를 form으로 보낸다(오류면 `error`).
6. 서버 검증 순서:
   1. 쿠키 `__Host-lw_login`이 있고 `state`와 같다(`compare_digest`). 다르면 거부한다(로그인 CSRF 방지).
   2. JWT 헤더의 `alg`가 `RS256`이고 `kid`가 있다. 다른 알고리즘(`none`, `HS256`)은 거부한다.
   3. `kid`에 맞는 공개키를 JWKS 캐시에서 찾는다. 없으면 JWKS를 다시 받는다(5분에 최대 1회). 캐시 수명은 응답의 `Cache-Control: max-age`를 따른다. 키 길이가 2048비트 미만이면 거부한다.
   4. 서명을 2.2의 방식으로 검증한다.
   5. 클레임을 검사한다.
      - `iss`가 `https://accounts.google.com` 또는 `accounts.google.com`
      - `aud`가 `GOOGLE_CLIENT_ID`와 같음. `azp`가 있으면 그것도 같음
      - `exp > 지금 - 60초`, `iat < 지금 + 300초`
      - `nonce == hex(sha256(c))`
7. `sub_hash = HMAC-SHA256(pepper, sub)`로 사용자를 찾거나 만든다. 새 사용자의 닉네임은 `등불지기` + 숫자 4자리(겹치면 다시 뽑음), `nickname_set = 0`이다.
8. 세션을 만들고 `__Host-lw_s=<토큰>; Path=/; Max-Age=15552000(180일); HttpOnly; Secure; SameSite=Lax`를 내린다. 로그인 상태 쿠키는 지운다.
9. 303으로 `/?login=ok`(실패하면 `/?login=fail&r=<사유 코드>`)로 보낸다. 돌아갈 주소는 고정이다. 매개변수로 받지 않으므로 오픈 리디렉션이 생기지 않는다.
10. 클라이언트는 시작할 때 `login` 매개변수를 보고 `history.replaceState`로 주소에서 지운 뒤 `GET /api/me`를 부른다. `nickname_set`이 0이면 닉네임 정하기 화면을 한 번 띄운다(건너뛰기 가능).

- 세션 연장: 요청 때 `last_used_at`이 하루 넘게 지났으면 만료를 180일 뒤로 다시 잡고 쿠키를 새로 내린다.
- 로그아웃: `POST /api/auth/logout`이 세션 행을 지우고 쿠키를 `Max-Age=0`으로 지운다.
- iOS 홈 화면 앱(standalone)에서 구글 페이지로 나갔다가 돌아올 때 같은 앱 안(같은 쿠키 저장소)으로 돌아오는지는 확인 필요. 돌아오지 않으면 S24의 대안(로그인 코드 회수)을 넣는다.
- 개발 모드(`--dev`)에서는 쿠키 이름에서 `__Host-`를 빼고 `Secure`를 끈다. `http://localhost:8080`에서 시험하기 위해서다.

---

## 5. API 목록

공통 규칙:
- 모든 응답은 JSON(`application/json; charset=utf-8`)이고 `Cache-Control: no-store`를 붙인다. 예외는 `/api/auth/start`(302)와 `/api/auth/callback`(303)이다.
- 오류 형식은 `{ "error": "<코드>" }`이다. 코드: `no_session`(401), `forbidden`(403), `bad_request`(400), `invalid_nickname`(400), `nickname_taken`(409), `too_soon`(429), `rate_limited`(429, `Retry-After` 헤더), `too_large`(413), `length_required`(411), `banned`(403), `server_error`(500).
- 상태를 바꾸는 요청(POST, PUT, DELETE)은 아래를 모두 만족해야 한다. `/api/auth/callback`만 예외이고, 대신 상태 쿠키로 보호한다.
  - `Origin` 헤더가 `https://game.aovob7.duckdns.org`와 정확히 같다. `duckdns.org`가 공개 접미사 목록에 있어서 `owl.`, `music.`, `dl.` 같은 다른 하위 도메인은 같은 사이트로 취급된다. 그래서 SameSite만으로는 다른 하위 도메인에서 오는 요청을 막지 못한다.
  - 본문이 있으면 `Content-Type: application/json`이다.
  - `Content-Length`가 있고 32KB 이하다. chunked 본문은 411로 거부한다.
- 로그인이 필요한 요청은 세션 쿠키로 사용자를 찾는다. 차단된 사용자는 `banned`를 받는다.

| 메서드, 경로 | 로그인 | 요청 | 응답 |
|---|---|---|---|
| `GET /api/health` | X | 없음 | `{ "ok": true, "version": "1.0.0" }` |
| `GET /api/auth/start` | X | 없음 | 302, 구글 인증 주소. 로그인 상태 쿠키 발급 |
| `POST /api/auth/callback` | X | form: `id_token`, `state` (또는 `error`) | 303, `/?login=ok` 또는 `/?login=fail&r=<state, token, aud, exp, nonce, google, rate>`. 세션 쿠키 발급 |
| `POST /api/auth/logout` | O | `{}` | `{ "ok": true }`, 세션 쿠키 삭제 |
| `GET /api/me` | O | 없음 | `{ "user": { "id": 12, "nickname": "오렌", "nicknameSet": true, "createdAt": 1764100000 }, "records": { "bestTimeMs": 512300, "bestKills": 1500, "bestLevel": 33, "wins": 0, "runs": 14, "fullDawns": 0 }, "settings": { "sound": true, "vibrate": true, "dmgNumbers": true }, "settingsRev": 1764100123456, "imported": false }` |
| `PUT /api/me/nickname` | O | `{ "nickname": "오렌" }` | `{ "nickname": "오렌" }` 또는 `invalid_nickname`, `nickname_taken`, `too_soon`(24시간에 1회. 첫 설정은 예외) |
| `PUT /api/me/settings` | O | `{ "settings": {...}, "rev": 1764100123456 }` | `{ "settings": {...}, "rev": <저장된 rev> }`. 받은 rev가 저장된 rev보다 클 때만 덮어쓴다 |
| `POST /api/me/import` | O | `{ "records": { "bestTime": 412.5, "bestKills": 980, "bestLevel": 31, "wins": 0, "runs": 14, "fullDawns": 0 } }` | `{ "records": {...합친 결과...} }`. 계정당 1회(`imported` 표시). 두 번째부터 409 `already_imported` |
| `DELETE /api/me` | O | `{ "confirm": "DELETE" }` | `{ "ok": true }`. 사용자와 관련 행 전부 삭제, 쿠키 삭제 |
| `POST /api/runs/tickets` | O | `{ "count": 1 }` (1~5) | `{ "tickets": [ { "id": "b64url 22자", "issuedAt": 1764100000, "expiresAt": 1765309600 } ] }`. 미사용 표가 6장을 넘으면 넘는 만큼 가장 오래된 미사용 표를 지우고 준다 |
| `POST /api/runs` | O | `{ "runs": [ RunSummary, ... ] }` (최대 20개) | `{ "results": [ { "clientRunId": "...", "status": "ranked", "rank": { "time": 14, "kills": 3 } } ], "records": {...} }` |
| `GET /api/leaderboard?board=time\|kills&limit=50` | X | 없음 | `{ "board": "time", "updatedAt": 1764100000, "entries": [ { "rank": 1, "nickname": "오렌", "timeMs": 900000, "kills": 4120, "level": 52, "fullDawn": true, "at": 1764000000 } ], "me": { "rank": 37, "timeMs": 512300, "kills": 1500 } }`. `me`는 로그인했고 기록이 있을 때만. 서버가 보드별로 30초 캐시 |

`RunSummary` 형식:
```json
{
  "clientRunId": "uuid v4 (crypto.randomUUID 또는 getRandomValues)",
  "ticket": "b64url 22자 또는 null",
  "ver": "1.0.3",
  "timeMs": 512300,
  "kills": 1500,
  "level": 33,
  "won": false,
  "fullDawn": false,
  "elites": 6,
  "bosses": 1,
  "kpm": [12, 40, 75, 110, 150, 140, 170, 190, 210, 203],
  "lvm": [4, 8, 12, 15, 18, 21, 24, 27, 30, 33],
  "endedAt": 1764100000
}
```
- `kpm[i]`: i분째(i*60초 이상 (i+1)*60초 미만) 처치 수. 길이는 `ceil(timeMs / 60000)`이고 최대 15다.
- `lvm[i]`: i분째가 끝났을 때(또는 판이 끝났을 때)의 레벨.
- `endedAt`: 기기 시각(초). 표시용이고 검증에 쓰지 않는다.
- 결과 `status`: `ranked`(순위 반영), `unranked`(개인 기록만 반영, `reason`: `no_ticket`, `ticket_expired`, `old_version`), `duplicate`(이미 받은 `clientRunId`, 처음 결과를 다시 돌려줌), `rejected`(값이 말이 안 됨, 개인 기록에도 넣지 않음, `reason`에 검사 이름).
- 같은 `clientRunId`를 다시 보내도 결과가 같다(멱등). 대기열이 같은 판을 두 번 올려도 안전하다.

---

## 6. 순위표 조작 방지 (현실적인 수준)

클라이언트 코드는 공개되어 있으므로 결과에 서명을 붙여도 의미가 없다. 목표는 "손으로 만든 요청이나 메모리 수정으로 말이 안 되는 기록을 올리는 것"을 막고, 남은 의심 기록은 관리자가 CLI로 숨기는 것이다.

### 6.1 판 시작 표(ticket)
- 판을 시작할 때 클라이언트가 `POST /api/runs/tickets {count:1}`로 새 표를 받는다(제한 시간 3초, 게임은 기다리지 않음).
- 온라인일 때 TITLE에서 표를 5장까지 미리 받아 둔다(`lanternwake.v1.tickets`). 오프라인으로 시작한 판은 이 중 하나를 쓴다.
- 판이 끝날 때 새 표가 도착했으면 그것을 쓰고, 미리 받은 표는 다시 넣어 둔다. 둘 다 없으면 `ticket: null`로 올리고 `unranked`가 된다.
- 표는 한 번만 쓸 수 있고 14일 뒤 만료된다. 사용자당 미사용 표는 최대 6장이다.

### 6.2 서버 검사 (하나라도 실패하면 `rejected`)
값의 근거는 `server/bounds.json`이다. 이 파일은 `tools/gen-bounds.js`가 `js/data/waves.js`(엘리트, 보스 시각), 3.9의 경험치 식, `LW.WIN_TIME`에서 만든다. 게임 밸런스와 서버 검사가 한 곳에서 나온다.

| 이름 | 규칙 |
|---|---|
| `range` | `0 < timeMs <= winMs(900000)`, `kills >= 0`, `1 <= level <= 200`, 정수 |
| `win` | `won`이면 `timeMs == winMs`. `won`이 아니면 `timeMs < winMs` |
| `dawn` | `fullDawn`이면 `won`이고 `bosses >= 1`이고 마지막 보스 등장 시각(840초) 이후까지 살아 있음 |
| `events` | `elites <= timeMs 이전 엘리트 이벤트 마릿수 합`, `bosses <= timeMs 이전 보스 수` |
| `shape` | `kpm`, `lvm` 길이가 `ceil(timeMs/60000)`. `sum(kpm) == kills`. `lvm`은 줄어들지 않고 마지막 값이 `level` |
| `kpm` | `kpm[i] <= kpmMax[i]`. 처음 값은 분당 1200으로 넉넉하게 두고, S15 플레이 기록과 서버에 쌓인 기록의 99.9 백분위 x 1.3으로 다시 정한다 |
| `xp` | 각 분 i에 대해 `xpToReach(lvm[i]) <= 5 x (0~i분 누적 처치) + 20 x (i분까지의 엘리트 이벤트 수) + 100 x (i분까지의 보스 수)`. 일반 적 XP 최대값이 5(rusthelm, boar)이고 엘리트 20, 보스 보석 100이기 때문이다. 상자는 플레이어 레벨을 올리지 않으므로 식에 넣지 않는다 |
| `elapsed` | `서버 지금 - ticket.issuedAt >= timeMs/1000 - 5초`. 일시정지와 백그라운드 시간은 더 길어질 뿐이라 정상 플레이는 항상 통과한다 |
| `ticket` | 표가 이 사용자의 것이고 아직 안 썼다. 사용 처리는 트랜잭션 안에서 `UPDATE ... WHERE used_at IS NULL`로 원자적으로 한다 |

- `ver`가 `bounds.json`의 `minRankedVersion`보다 낮으면 `unranked`(`old_version`)다. 밸런스를 크게 바꾸면 이 값을 올리고, 필요하면 CLI `rebuild-best`로 순위표를 다시 만든다.
- 순위 반영(`ranked`) 조건: 검사를 통과했고, 표가 유효하고, 버전이 맞고, `timeMs >= 30000`이다.
- 남는 허점: 수정한 클라이언트로 실제 시간을 들여 플레이하면 모든 검사를 통과할 수 있다. 미리 받은 표 6장으로 오래된 표를 써서 한꺼번에 올릴 수도 있다(`elapsed`가 약해짐). 그래서 관리 CLI에 `suspects`(분당 처치가 상위 0.1%이거나 미리 받은 표로 1위가 된 기록)와 `hide <runId>`, `ban <userId>`를 둔다.

### 6.3 순위 계산
- 보드 `time`: 값 `timeMs` 내림차순, 같으면 `kills` 내림차순, 같으면 먼저 달성한 기록.
- 보드 `kills`: 값 `kills` 내림차순, 같으면 `timeMs` 오름차순(빨리 잡은 쪽), 같으면 먼저 달성한 기록.
- 사용자마다 보드별 최고 기록 1개만 `best` 표에 둔다. `ranked` 판이 들어올 때 더 좋으면 바꾼다.
- 15:00 승리가 많아지면 `time` 보드 상위가 모두 15:00이 된다. 그래서 같은 시간일 때 처치 수로 가르고, 화면에 "완전한 새벽" 표시를 붙인다.
- 내 순위: `best`에서 나보다 좋은 행 수 + 1. 차단된 사용자와 숨긴 기록은 뺀다.

---

## 7. 요청 제한과 보안 규칙

### 7.1 요청 제한 (game_api.py 안의 메모리 토큰 버킷)
Caddy 기본 이미지(`caddy:2`)에는 요청 제한 기능이 없다(플러그인 빌드 필요). 그래서 앱에서 한다. IP는 Caddy가 넣는 `X-Real-IP`만 믿는다. game 컨테이너는 `expose`만 하고 포트를 열지 않으므로 Caddy만 접근할 수 있다.

| 대상 | 기준 | 한도 |
|---|---|---|
| 모든 `/api/*` | IP | 분당 120 |
| `/api/auth/*` | IP | 분당 10 |
| 새 계정 생성 | IP | 하루 5 |
| `GET /api/leaderboard` | IP | 분당 30 (서버 30초 캐시) |
| `POST /api/runs` | 사용자 | 시간당 30회 요청, 하루 300판 |
| `POST /api/runs/tickets` | 사용자 | 시간당 30회 |
| `PUT /api/me/nickname` | 사용자 | DB 기준 24시간 1회 |
| `PUT /api/me/settings` | 사용자 | 분당 10 |

- 초과하면 429와 `Retry-After`를 돌려준다. 버킷은 10분마다 오래된 항목을 지운다. IP는 메모리에만 두고 DB나 로그에 남기지 않는다.

### 7.2 그 밖의 보안 규칙
- 세션 쿠키 `__Host-lw_s`: `HttpOnly; Secure; SameSite=Lax; Path=/`, Domain 속성 없음. `__Host-` 접두사는 Domain을 붙일 수 없게 해서, 쿠키가 다른 하위 도메인으로 퍼지지 않는다.
- CSRF: 5장의 `Origin` 검사와 JSON `Content-Type` 강제. 다른 출처가 JSON을 보내려면 사전 요청(preflight)이 필요하고, 서버는 CORS 헤더를 내지 않으므로 막힌다.
- 닉네임: NFC로 정규화하고 2~12자, 한글 완성형(가-힣), 영문, 숫자, `_`만 허용한다. 비교용 키는 소문자 변환 값이고 UNIQUE다. 예약어(`관리자`, `운영자`, `admin`, `등불지기`로 시작하면서 숫자만 붙은 형태 등)와 짧은 금칙어 목록을 둔다. 금칙어 목록이 충분한지는 확인 필요. 클라이언트는 닉네임을 캔버스 `fillText`로만 그리므로 HTML 주입 경로가 없다.
- 서버 로그(`docker logs`)에는 오류 종류와 경로만 쓴다. 토큰, 쿠키, `sub`, IP는 쓰지 않는다.
- Caddy의 game 사이트에는 접근 로그를 켜지 않는다. IP가 남기 때문이다. 문제 추적이 필요하면 그때 잠깐 켠다.
- 응답 헤더(Caddy): `Content-Security-Policy: frame-ancestors 'none'`, `X-Content-Type-Options: nosniff`. 로그인 버튼이 있는 화면을 다른 사이트가 iframe으로 감싸지 못하게 한다.

---

## 8. DB 스키마 (SQLite, `/data/game.db`)

시작할 때 `PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=3000;`을 건다. 스키마 버전은 `PRAGMA user_version`으로 관리하고, 서버가 시작할 때 차례대로 올린다. 연결은 하나를 두고 `threading.Lock`으로 감싼다. 동시 사용자가 적어서 이것으로 충분하다. 시각은 모두 유닉스 초(정수)다.

```sql
CREATE TABLE users (
  id                  INTEGER PRIMARY KEY,
  sub_hash            TEXT    NOT NULL UNIQUE,   -- HMAC-SHA256(pepper, sub)의 hex
  nickname            TEXT    NOT NULL,
  nickname_key        TEXT    NOT NULL UNIQUE,   -- NFC + 소문자
  nickname_set        INTEGER NOT NULL DEFAULT 0,
  nickname_changed_at INTEGER,
  imported            INTEGER NOT NULL DEFAULT 0,
  banned              INTEGER NOT NULL DEFAULT 0,
  created_at          INTEGER NOT NULL,
  last_seen_at        INTEGER NOT NULL
);

CREATE TABLE sessions (
  token_hash   TEXT    PRIMARY KEY,              -- sha256(세션 토큰) hex
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at   INTEGER NOT NULL,
  last_used_at INTEGER NOT NULL,
  expires_at   INTEGER NOT NULL
);
CREATE INDEX sessions_user ON sessions(user_id);

CREATE TABLE settings (
  user_id    INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  json       TEXT    NOT NULL,                   -- {"sound":true,"vibrate":true,"dmgNumbers":true}
  rev        INTEGER NOT NULL,                   -- 클라이언트가 보낸 변경 시각(ms)
  updated_at INTEGER NOT NULL
);

CREATE TABLE records (
  user_id      INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  best_time_ms INTEGER NOT NULL DEFAULT 0,
  best_kills   INTEGER NOT NULL DEFAULT 0,
  best_level   INTEGER NOT NULL DEFAULT 0,
  wins         INTEGER NOT NULL DEFAULT 0,
  runs         INTEGER NOT NULL DEFAULT 0,
  full_dawns   INTEGER NOT NULL DEFAULT 0,
  updated_at   INTEGER NOT NULL
);

CREATE TABLE tickets (
  id         TEXT    PRIMARY KEY,                -- 무작위 16바이트 b64url
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  issued_at  INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at    INTEGER
);
CREATE INDEX tickets_user_unused ON tickets(user_id) WHERE used_at IS NULL;

CREATE TABLE runs (
  id            INTEGER PRIMARY KEY,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  client_run_id TEXT    NOT NULL,
  ticket_id     TEXT,
  ticket_age_s  INTEGER,                         -- 제출 시각 - 표 발급 시각
  ver           TEXT    NOT NULL,
  time_ms       INTEGER NOT NULL,
  kills         INTEGER NOT NULL,
  level         INTEGER NOT NULL,
  won           INTEGER NOT NULL,
  full_dawn     INTEGER NOT NULL,
  elites        INTEGER NOT NULL,
  bosses        INTEGER NOT NULL,
  detail        TEXT    NOT NULL,                -- {"kpm":[...],"lvm":[...]}
  status        TEXT    NOT NULL,                -- ranked | unranked | rejected
  reason        TEXT,
  hidden        INTEGER NOT NULL DEFAULT 0,
  submitted_at  INTEGER NOT NULL,
  UNIQUE (user_id, client_run_id)
);
CREATE INDEX runs_user ON runs(user_id, submitted_at);

CREATE TABLE best (
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  board       TEXT    NOT NULL,                  -- 'time' | 'kills'
  run_id      INTEGER NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  v1          INTEGER NOT NULL,                  -- time: time_ms,  kills: kills
  v2          INTEGER NOT NULL,                  -- time: kills,    kills: -time_ms
  achieved_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, board)
);
CREATE INDEX best_rank ON best(board, v1 DESC, v2 DESC, achieved_at ASC);
```

- `v2`에 `-time_ms`를 넣어 두 보드 모두 "v1 내림차순, v2 내림차순, 달성 시각 오름차순" 하나의 규칙으로 정렬한다.
- 정리 작업(서버 시작 시와 6시간마다): 만료된 세션과 표 삭제, `rejected` 판은 30일 뒤 삭제.
- 크기 추정: 판 1개 약 300바이트. 사용자 100명이 하루 10판씩 1년 하면 약 110MB다. 필요해지면 `unranked`의 `detail`을 90일 뒤 비우는 정리를 더한다.

---

## 9. 개인정보

- 구글에서 받는 값: `sub` 하나. 범위가 `openid`라서 이메일, 이름, 사진은 토큰에 들어오지 않는다.
- 저장하는 값: `sub`의 HMAC(`sub_hash`), 닉네임, 판 기록, 설정 3개, 세션 해시.
- **이메일은 받지도 저장하지도 않는다.** 근거:
  - 이메일로 할 일이 없다. 알림을 보내지 않고, 계정 찾기는 같은 구글 계정으로 다시 로그인하면 된다.
  - 저장하지 않으면 유출되어도 연락처가 나가지 않는다.
  - 계정 삭제 요청은 앱 안의 "계정 삭제" 버튼으로 받는다. 이메일로 본인을 확인할 필요가 없다.
- `sub`를 그대로 두지 않고 HMAC으로 바꾸는 이유: DB만 새었을 때 구글 계정과 바로 이어지지 않게 하려는 것이다. pepper(`/data/pepper`, 서버 첫 실행 때 32바이트 생성)는 백업에 포함한다. pepper를 잃으면 모든 계정이 고아가 되기 때문이다. 백업은 이미 비공개 버킷에 있고, DB와 pepper가 함께 새면 `sub` 평문과 같은 수준이 될 뿐 더 나빠지지 않는다.
- IP는 요청 제한용으로 메모리에만 둔다.
- 순위표에는 닉네임, 기록, 달성일만 나온다. 사용자 번호(`id`)도 내보내지 않는다.
- ACCOUNT 화면에 위 내용을 짧은 안내문으로 둔다. 구글 쪽 연결 해제는 구글 계정 설정의 "서드 파티 연결"에서 할 수 있다는 안내도 함께 둔다.

---

## 10. 클라이언트 변경 사항 (파일별)

순서는 12장의 단계를 따른다. 모든 경로는 `C:\Users\junys\dev\survivor-game\` 기준이다.

| 파일 | 변경 |
|---|---|
| `index.html` | `js/net.js`, `js/account.js` 스크립트 태그를 `storage.js` 바로 뒤에 더한다. 닉네임 입력용 숨긴 폼 `<form id="nick"><input id="nickIn" maxlength="12" autocomplete="off" enterkeyhint="done"></form>`과 CSS를 더한다. 입력 글자 크기는 16px 이상이다(iOS가 16px 미만 입력란에 초점이 가면 화면을 확대한다). 이 폼의 `touch-action`은 `manipulation`으로 둔다 |
| `js/config.js` | `LW.API = './api/'`, `LW.ACCOUNT = isSecureContext && !LW.params.noacct`, `LW.TICKET_POOL = 5`, `LW.QUEUE_MAX = 50` |
| `js/storage.js` | 새 키: `lanternwake.v1.account`(`{ uid, nickname, nicknameSet, records, imported, importDone }`), `lanternwake.v1.queue`(`[{ uid, run }]`), `lanternwake.v1.tickets`(`[{ uid, id, issuedAt, expiresAt }]`), `lanternwake.v1.board`(`{ time:{...,fetchedAt}, kills:{...} }`). 설정에 `rev`(마지막 변경 시각 ms)를 더한다. 기존 키 형식은 바꾸지 않는다(필드 추가는 `load`가 기본값으로 채움) |
| `js/net.js` (새 파일) | `LW.net.get/post/put/del(path, body)`: `fetch(LW.API + path, { credentials:"same-origin", headers:{"Content-Type":"application/json"} })`, `AbortController`로 8초 제한(표 요청은 3초). 응답을 `{ ok, status, data }`로 통일. `navigator.onLine`과 `online`, `offline` 이벤트로 `LW.net.online` 유지. 실패하면 30초, 60초, 120초, 최대 10분 간격으로 다시 시도하는 예약 함수 `LW.net.schedule(fn)` |
| `js/account.js` (새 파일) | 아래 표 참고 |
| `js/platform.js` | 문서 단위 `touchstart`, `touchmove`의 `preventDefault`에서 대상이 `#nick` 안이면 건너뛴다(그렇지 않으면 입력란에 초점이 가지 않는다). `online` 이벤트에서 `LW.account.flushQueue()` |
| `js/game.js` | `newRun()`에서 판 요약 버퍼를 만든다: `kpm = new Uint16Array(15)`, `lvm = new Uint8Array(15)`, `elites`, `bosses`, `clientRunId`. 갱신 루프 안에서는 새 객체를 만들지 않는다. 분 경계를 넘을 때 `lvm[m] = level`. `newRun()`에서 `LW.account.onRunStart()`, `end(won)`에서 요약을 일반 배열로 바꿔 `LW.account.onRunEnd(summary)`(판이 끝난 뒤라 할당해도 된다). 판 시작과 끝 모두 네트워크를 기다리지 않는다. 상태 `ACCOUNT`, `RANKING`을 더한다. 둘 다 TITLE에서만 들어가고 "뒤로"로 TITLE에 돌아간다. 들어갈 때 오버레이 입력 보호(결정 5)를 건다 |
| `killEnemy`가 있는 파일 | 처치할 때 `run.kpm[min(floor(time/60), 14)]++`, 엘리트면 `run.elites++`, 보스면 `run.bosses++`. `killEnemy`의 실제 위치는 S3 구현을 따른다(확인 필요) |
| `js/ui.js` | 아래 표 참고 |
| `sw.js` | fetch 처리 맨 앞에서 다른 출처이거나 경로에 `/api/`가 들어 있으면 `return`한다(응답하지 않고 브라우저에 맡김). 현재 설계(6.4)는 navigate 요청을 모두 `index.html`로 응답하므로, 이 처리가 없으면 `/api/auth/start`로의 이동이 게임 화면으로 바뀌어 로그인이 안 된다. GET 외 요청은 이미 처리하지 않는다 |
| `icons/google-g.png` (새 파일) | 구글 로그인 브랜딩 가이드의 공식 "G" 로고. 사용 조건은 확인 필요. SW 캐시 목록에는 `release.js`가 자동으로 넣는다 |
| `tools/release.js` | 끝에 `tools/gen-bounds.js`를 호출한다. 배포 목록 수집에서 `server/`가 빠지는지 확인한다(현재 수집 대상 glob에 없음) |
| `tools/gen-bounds.js` (새 파일) | Node 기본 모듈만 사용. `vm`으로 `js/config.js`, `js/data/waves.js`를 읽어 엘리트와 보스 시각, `WIN_TIME`, 3.9의 경험치 누적표(`xpToReach[1..200]`)를 계산해 `server/bounds.json`의 자동 영역을 다시 쓴다. 손으로 정하는 `kpmMax`, `minRankedVersion`은 보존한다 |
| `tools/deploy.sh` (새 파일) | 11.5 참고 |
| `server/game_api.py`, `server/bounds.json`, `server/test_game_api.py`, `server/fixtures/` (새 폴더) | 11.1 참고. 정적 배포 대상이 아니다 |

`js/account.js`의 함수:

| 함수 | 하는 일 |
|---|---|
| `init()` | 주소의 `login` 매개변수를 처리하고 지운다. 저장된 계정 정보로 먼저 표시한 뒤, 온라인이면 `GET /api/me`로 갱신한다. 401이면 GUEST로 바꾸고 대기열은 `uid`별로 남겨 둔다 |
| `login()` | 온라인이고 TITLE일 때만 `location.href = LW.API + "auth/start"` |
| `logout()`, `deleteAccount()` | 서버 호출 후 계정, 표 저장소를 비운다. 대기열은 해당 `uid` 항목을 지운다(삭제 전 "올리지 못한 기록 N개" 안내) |
| `setNickname(name)` | 클라이언트에서 같은 규칙으로 먼저 검사한 뒤 `PUT /api/me/nickname` |
| `syncSettings()` | 서버 rev가 크면 받아서 적용하고, 로컬 rev가 크면 올린다. `quality`는 제외 |
| `importOnce()` | 서버 `imported`가 거짓이고, 이 기기의 `importDone`이 거짓이고, 로컬 `runs > 0`이면 `POST /api/me/import`. 성공하면 `importDone = true`. 이 기기에서는 다시 하지 않는다 |
| `refillTickets()` | 로그인, 온라인, TITLE 상태에서 미리 받은 표를 `LW.TICKET_POOL`장까지 채운다. 만료된 표는 버린다 |
| `onRunStart()` | 미리 받은 표 하나를 예약하고, 새 표 요청을 보낸다(3초 제한) |
| `onRunEnd(summary)` | 새 표가 있으면 그것을, 없으면 예약한 표를 붙인다. 쓰지 않은 표는 다시 넣는다. 게스트면 로컬 기록만 갱신한다. 로그인 상태면 대기열에 `{ uid, run }`을 넣고 `flushQueue()` |
| `flushQueue()` | 같은 `uid` 항목만 20개씩 `POST /api/runs`. 결과를 받은 항목(`ranked`, `unranked`, `duplicate`, `rejected`)은 지운다. 네트워크 오류와 5xx면 남기고 `LW.net.schedule`로 다시 시도. 401이면 멈추고 다시 로그인 안내. 대기열이 `LW.QUEUE_MAX`를 넘으면 가장 오래된 항목부터 버린다 |
| `fetchBoard(board)` | 성공하면 저장, 실패하면 저장된 것과 "마지막 갱신 시각"을 돌려준다 |

`js/ui.js`의 화면:

| 화면 | 내용 |
|---|---|
| TITLE | 왼쪽 위에 계정 버튼(게스트면 "로그인", 로그인이면 닉네임), "순위표" 버튼. 최고 기록은 로그인 상태면 서버 기록과 대기열을 합친 값 |
| ACCOUNT | 게스트: "Google 계정으로 로그인" 버튼(공식 G 로고와 문구), 안내문. 로그인: 닉네임과 "바꾸기", 올리지 못한 기록 수, 로그아웃, 계정 삭제(두 번 확인), 개인정보 안내 |
| 닉네임 편집 | 캔버스 위에 `#nick` 폼만 보이고 초점을 준다. Enter나 "확인"으로 저장하고 폼을 숨긴다. "취소"는 폼만 숨긴다 |
| RANKING | 탭 2개("생존 시간", "처치 수"), 상위 50, 화면 아래에 내 순위 고정 줄. 오프라인이면 저장본과 갱신 시각. 목록은 세로 끌기로 넘긴다(입력 모듈의 포인터 이벤트 사용) |
| RESULT | 한 줄 추가: "기록 올리는 중", "순위 반영: 생존 14위, 처치 3위", "오프라인: 연결되면 올라가요", "순위 제외: 이전 버전" |

화면 문구 예:
- ACCOUNT 안내: "로그인하면 기록과 설정이 다른 기기와 이어지고 순위표에 오를 수 있어요. 구글에서는 계정 번호만 받고, 이메일과 이름은 받지 않아요."
- 닉네임 오류: "2~12자, 한글, 영문, 숫자, _만 쓸 수 있어요", "이미 쓰는 이름이에요", "닉네임은 하루에 한 번 바꿀 수 있어요"
- 로그인 실패: "로그인하지 못했어요. 다시 시도해 주세요."

본 설계와 다르게 바뀌는 점:
- 결정 6(UI는 모두 캔버스): 닉네임 입력 하나만 DOM 폼을 쓴다. 캔버스에서 한글 입력기(IME)와 모바일 키보드를 직접 다룰 방법이 없기 때문이다.
- 6.7 배포 경로: `/srv/game`이 아니라 `/srv/owl-web/game/current`(릴리스 폴더와 링크)로 바꾼다. 11.2, 11.5 참고.

---

## 11. 서버 변경 사항

### 11.1 `server/game_api.py` 구성 (게임 레포에 둠)
서버 코드는 게임 레포 `server/`에 둔다. 검사 기준(`bounds.json`)이 게임 데이터에서 나오므로 같은 레포에서 같이 바뀌어야 하기 때문이다. compose와 Caddyfile은 OwL-server 레포에서 고친다.

- 파이썬 3.12 표준 라이브러리만: `http.server.ThreadingHTTPServer`, `sqlite3`, `hashlib`, `hmac`, `secrets`, `json`, `urllib.request`, `unicodedata`, `threading`.
- 부분: 설정과 상수, DB 열기와 스키마 올리기, JWKS 캐시와 RS256 검증, 세션, 요청 제한, 판 검사, 라우터, 정리 작업 스레드, CLI. 예상 600~800줄.
- 환경 변수: `GOOGLE_CLIENT_ID`(필수, 없으면 시작하지 않음), `PUBLIC_ORIGIN`(기본 `https://game.aovob7.duckdns.org`), `DATA`(기본 `/data`), `BOUNDS`(기본 `/app/bounds.json`).
- CLI(`docker exec stack-game-1 python /app/game_api.py <명령>`):
  - `serve [--dev] [--static <폴더>]`: `--dev`면 `http://localhost:8080`, `Secure` 끔, `--static`이면 게임 파일도 함께 서빙(로컬 시험용)
  - `stats`: 사용자 수, 오늘 판 수, 상태별 수
  - `suspects`: 6.2의 의심 기록
  - `hide <runId>`, `unhide <runId>`, `ban <userId>`, `unban <userId>`, `rename <userId> <닉네임>`
  - `rebuild-best`: `ranked`이고 숨기지 않았고 `minRankedVersion` 이상인 판으로 `best`를 다시 만든다
- 테스트(`server/test_game_api.py`, `python -m unittest`):
  - RS256 검증: `server/fixtures/`의 시험용 키(JWK)와 서명된 토큰. 고정 파일은 `openssl`로 한 번 만들어 커밋한다(만드는 명령을 테스트 파일 머리 주석에 적음). 정상 토큰 통과, 서명 1비트 변경, `alg=none`, `alg=HS256`, `aud` 다름, `iss` 다름, 만료, `nonce` 다름이 모두 거부되어야 한다
  - 판 검사: 정상 판, 각 검사 실패, 중복 `clientRunId`, 표 재사용, 표 없음
  - 닉네임 규칙, Origin 검사, 요청 제한

### 11.2 `docker-compose.yml` (OwL-server 레포)
`authgate` 서비스 뒤에 더한다. 실제 파일이 기준이며, 아래는 그 요약이다.

```yaml
  game:
    image: python:3.12-alpine
    restart: unless-stopped
    user: "10001:10001"
    command: ["python", "-u", "/app/game_api.py", "serve"]
    env_file:
      - path: ./game.env
        required: false
    environment:
      TZ: Asia/Seoul
      PUBLIC_ORIGIN: https://game.aovob7.duckdns.org
    expose:
      - "8080"
    volumes:
      - ./game:/app:ro
      - ./game-data:/data
    mem_limit: 128m
    read_only: true
    tmpfs:
      - /tmp
    cap_drop:
      - ALL
    security_opt:
      - no-new-privileges:true
    pids_limit: 128
    cpus: "1.0"
    logging:
      driver: json-file
      options:
        max-size: "5m"
        max-file: "3"
```

설계 초안과 달라진 점과 이유:
- 클라이언트 ID는 compose에 적지 않고 `game.env`(`env_file`, 권한 600)에 둔다. 설치 스크립트가 `--client-id`로 값만 바꿀 수 있어야 하고, 그때 compose를 다시 쓰지 않기 위해서다. `required: false`라 파일이 없어도 다른 서비스는 영향받지 않는다(Compose 2.24 이상 필요, 낮으면 설치 스크립트가 compose를 바꾸기 전에 멈춘다).
- `user: "10001:10001"`: 컨테이너가 root로 돌지 않게 한다. `game-data` 폴더(700)와 `pepper`(600)의 소유자도 10001이어야 하고, `ops/owl-backup`의 `GAME_UID`와 같은 값이다.
- `read_only`, `tmpfs: /tmp`, `cap_drop: ALL`, `no-new-privileges`, `pids_limit`, `cpus`: 코드에 취약점이 생겨도 파일을 쓰거나 권한을 올릴 여지를 줄이고, 같은 서버의 음악 서비스가 CPU를 빼앗기지 않게 한다. `game_api.py`가 쓰는 곳은 `/data`(SQLite와 WAL, pepper)뿐이고 `/app`은 이미 읽기 전용이라 동작에 영향이 없다.
- `logging` 상한: 로그가 디스크를 채우지 않게 한다(5MB 3개).
- 기본 네트워크에 붙는다. caddy가 `game:8080`으로 찾고, 컨테이너는 JWKS를 받으러 바깥으로 나갈 수 있다. `tunnel` 네트워크에는 붙이지 않는다.
- 적용: `sudo docker compose -f /srv/stack/docker-compose.yml up -d game`. 다른 컨테이너는 다시 만들어지지 않는다(서비스마다 설정 해시가 따로이고 `depends_on`이 없다). 설치 스크립트가 이 일을 하며, 이미 `game` 블록이 있으면 다시 붙이지 않는다.

### 11.3 `Caddyfile` (OwL-server 레포)
`dl.aovob7.duckdns.org` 블록 뒤에 더한다. 실제 파일이 기준이며, 아래는 그 요약이다.

```
game.aovob7.duckdns.org {
	encode zstd gzip
	header {
		Content-Security-Policy "frame-ancestors 'none'"
		X-Content-Type-Options nosniff
	}
	handle /api/* {
		request_body {
			max_size 64KB
		}
		reverse_proxy game:8080 {
			header_up X-Real-IP {remote_host}
			transport http {
				read_timeout 20s
			}
		}
	}
	handle {
		root * /srv/owl-web/game/current
		@nocache path / /index.html /sw.js /manifest.webmanifest
		header @nocache Cache-Control "no-cache"
		@manifest path /manifest.webmanifest
		header @manifest Content-Type "application/manifest+json"
		file_server
	}
}
```

설계 초안과 달라진 점과 이유:
- `request_body max_size 64KB`: 서버의 본문 상한(32KB)보다 앞에서 큰 요청을 끊는다.
- `read_timeout 20s`: 느리게 보내는 연결이 서버 스레드를 오래 붙잡지 않게 한다.
- `header_up X-Real-IP {remote_host}`: 클라이언트가 보낸 값을 덮어쓴다. `game_api.py`는 요청 제한에 `X-Real-IP`만 쓴다.
- 적용은 설치 스크립트가 한다. 내용만 덮어쓰고(`cat > Caddyfile`, inode 유지), `caddy validate`가 실패하거나 `caddy reload`가 실패하면 이번 실행에서 만든 백업으로 되돌린다. reload 실패 때 되돌리는 이유는, Caddy는 옛 설정으로 계속 돌지만 디스크의 새 블록이 재시작 때 읽혀 모든 사이트가 멈출 수 있기 때문이다. game 서비스를 먼저 올린 뒤 reload한다.
- `/srv/owl-web`은 caddy에 이미 읽기 전용으로 마운트되어 있으므로 compose를 고치지 않는다. 음악 앱의 root는 `/srv/owl-web/current`라서 게임 파일이 owl 도메인으로 노출되지 않는다.
- DuckDNS는 하위 주소도 같은 IP로 응답하므로 DNS 작업은 없다. 인증서는 reload 때 Caddy가 자동으로 받는다.
- `setup.sh`를 다시 실행하면 Caddyfile과 compose가 옛 내용으로 돌아가 `game` 블록이 빠질 수 있다. OwL-server `HANDOFF.md`에 대처 방법이 있다.

### 11.4 백업과 감시 (OwL-server 레포)
- `ops/owl-backup`: Gonic DB처럼 SQLite 일관 사본을 만든다. 구현은 `python:3.12-alpine` 이미지로, game 서비스와 같은 비루트(10001)로 돌린다.
  ```
  docker run --rm --user 10001:10001 -v /srv/stack/game-data:/d -v "$TMP/g":/o python:3.12-alpine \
    python -c 'import sqlite3; s = sqlite3.connect("/d/game.db"); d = sqlite3.connect("/o/game.db"); s.backup(d); d.close(); s.close()'
  ```
  tar 목록에 `srv/stack/game-data/pepper`, `srv/stack/game.env`와 `game.db` 사본을 더한다(있는 것만). 실행 중인 `game.db`, `-wal`, `-shm` 파일은 넣지 않는다.
  - 설계 초안은 `alpine` 이미지와 `sqlite3` 명령, 읽기 전용 마운트였다. 구현은 `apk add`로 패키지를 받지 않아도 되고, WAL 모드 DB를 읽기 전용 마운트에서 열 때의 문제를 피하고, 새 파일이 root 소유로 남지 않도록 파이썬 이미지를 비루트로 돌린다.
  - 게임 쪽이 실패해도 OwL 아카이브는 끝까지 올린 뒤 마지막에 exit 1로 끝난다(모니터가 메일을 보낸다). 원인은 journal의 "game.db backup failed" 줄이다.
  - `pepper`는 계정 식별자를 만드는 키라 다시 만들 수 없어서, "비밀값은 백업에서 뺀다"는 원칙의 예외로 넣는다. 버킷은 비공개이고 인스턴스만 쓸 수 있다.
  - 복구 때는 파일을 푼 뒤 `chown -R 10001:10001 /srv/stack/game-data`, `chmod 700`, `chmod 600 pepper`를 해야 컨테이너가 시작한다.
  - 새 `owl-backup`은 서버의 `/usr/local/sbin/owl-backup`에 설치해야 효력이 있다. 게임 레포의 묶음에 넣어 `install-game.sh`가 설치하고 한 번 실행한다.
- `ops/owl_monitor.py`: `stack-game-1` 점검과 `https://game.<도메인>/api/health` 점검(응답에 `"ok":true`)을 더한다. 모니터는 집 PC에서 레포 파일을 바로 실행하므로, 설치 전에 오탐 메일이 나가지 않게 상태 폴더의 `game-enabled` 파일이 있을 때만 게임 점검을 한다.
- `HANDOFF.md`: 서비스 표에 `game`, 주소 목록에 `game.<도메인>`, 백업 대상에 game DB, 게임 서버 절(설치, 운영, 복구)을 적는다.

### 11.5 배포 (`tools/deploy.sh`, `deploy/install-game.sh`, 게임 레포)
OwL 프런트처럼 릴리스 폴더와 링크 교체로 한 번에 바꾼다. 파일을 덮어쓰는 도중에 SW가 설치되면 옛 파일과 새 파일이 섞여 캐시될 수 있기 때문이다.

설계 초안은 `rsync`와 `ssh`로 서버에 직접 올리는 방식이었다. 구현은 서버에 접속하지 않는 묶음 방식이다. 게임 레포에 서버 주소와 접속 키를 두지 않아도 되고, 같은 설치 스크립트를 여러 번 실행해도 안전하게 만들 수 있기 때문이다.

1. 로컬: `bash tools/deploy.sh`가 `deploy/dist/lanternwake-game.tar.gz`를 만든다. 내용은 `install-game.sh`, `VERSION`, `static.sha256`, `static/`(`index.html`, `manifest.webmanifest`, `sw.js`, `js/`, `icons/`), `server/`(`game_api.py`, `bounds.json`), `stack/`(OwL-server의 game compose 블록, Caddy 블록, `owl-backup`)이다. `sw.js`의 버전과 목록이 맞는지(`node tools/release.js`를 돌렸는지) 먼저 검사한다.
2. 옮기기: 사용자가 평소 쓰는 방법으로 `scp`한다(`deploy/README.md`).
3. 서버: `sudo bash install-game.sh` 한 번. 순서는 폴더와 `pepper`(없을 때만 생성)와 `game.env`, 정적 파일 풀기와 `current` 링크 교체(`mv -T`, 릴리스는 최근 3개만 유지), 서버 코드 두기, compose와 Caddyfile에 블록 덧붙이기(없을 때만), game 컨테이너 올리기, `caddy validate`와 reload(실패하면 되돌림), `owl-backup` 설치와 실행(실패해도 경고만), 헬스 체크, 마지막에 `journalctl -u owl-backup -n 30` 출력이다.
   - 릴리스를 3개만 두는 이유: 되돌릴 수 있는 만큼이면 충분하고, 정적 파일이 약 400KB라도 서버 디스크를 아끼기 위해서다(설계 초안은 5개).
   - 헬스 체크는 서버 안에서 `curl --resolve game.aovob7.duckdns.org:443:127.0.0.1`로 한다. 서버가 자기 공인 IP로 나갔다 돌아오는 경로(헤어핀)에 기대지 않으면서 Caddy, 인증서, game 컨테이너를 모두 거친다.
   - 중간에 실패해도 다시 실행하면 이어서 진행한다. 임시 파일은 종료 때 지운다.
4. 구글 클라이언트 ID는 나중에 `sudo bash /srv/stack/game/install-game.sh --client-id <ID>.apps.googleusercontent.com`으로 값만 바꾼다. ID가 없는 동안에도 서버와 헬스 체크는 동작하고 로그인만 안 된다.
- 로컬 시험: `bash deploy/test-install.sh`(가짜 루트와 가짜 docker, curl, systemctl, journalctl로 반복 실행, 되돌림, 백업 실패를 검사한다).
- 본 설계 6.7의 Caddy 블록과 `/srv/game` 경로는 11.3, 11.5로 대체한다.

---

## 12. 구현 단계 (S16~S24)

- 각 단계는 개별 커밋 단위다.
- S16~S19(서버)는 클라이언트 파일을 건드리지 않으므로 S5~S15와 동시에 진행해도 된다. 새로 만드는 `tools/gen-bounds.js`, `tools/deploy.sh`만 `tools/`에 더해진다.
- S20~S23(클라이언트)은 S13(`sw.js`, `release.js`)과 S10(`storage.js`, TITLE, SETTINGS)이 끝난 뒤에 한다. `kpmMax` 보정은 S15 기록이 있어야 한다.
- S17의 실제 구글 로그인 확인 전에 13장의 1~7번(클라이언트 ID 만들기)이 끝나 있어야 한다.

**S16. 서버 뼈대와 DB**
- 할 일: `server/game_api.py`의 설정, DB 스키마와 `user_version` 올리기, `GET /api/health`, 공통 처리(JSON 응답, `no-store`, Origin 검사, 본문 크기, 411), 요청 제한, 정리 스레드, CLI `serve`(`--dev`, `--static`), `stats`. `server/test_game_api.py` 뼈대.
- 완료 기준:
  - `python server/game_api.py serve --dev --static .` 후 `http://localhost:8080`에서 게임이 열리고 `/api/health`가 `{"ok":true}`다.
  - `Origin` 없는 POST는 403, 33KB 본문은 413, chunked 본문은 411이다.
  - 분당 121번째 요청이 429와 `Retry-After`를 받는다.
  - `python -m unittest server/test_game_api.py`가 통과한다.

**S17. 로그인 서버**
- 할 일: `/api/auth/start`, `/api/auth/callback`, `/api/auth/logout`, `GET /api/me`, `DELETE /api/me`, JWKS 캐시, RS256 검증, 세션 발급과 연장, pepper 생성, `server/fixtures/`.
- 완료 기준:
  - 4장 6번의 거부 사례(서명 변경, `alg=none`, `alg=HS256`, `aud`, `iss`, 만료, `nonce`, `state` 불일치, 상태 쿠키 없음)가 테스트에서 모두 거부된다.
  - 로컬(`--dev`)에서 실제 구글 계정으로 로그인하면 `/api/me`가 200이고, DB `users`에 이메일이나 이름이 없다.
  - 로그아웃 후 같은 쿠키로 `/api/me`가 401이다. 계정 삭제 후 관련 표의 행이 0개다.

**S18. 기록 API**
- 할 일: `/api/runs/tickets`, `/api/runs`(6장 검사 전부), `/api/me/nickname`, `/api/me/settings`, `/api/me/import`, `/api/leaderboard`(30초 캐시), `best` 갱신, CLI `suspects`, `hide`, `ban`, `rename`, `rebuild-best`. `tools/gen-bounds.js`와 `server/bounds.json`.
- 완료 기준:
  - 6.2의 검사마다 실패 사례 테스트가 하나씩 있고 모두 `rejected`가 된다. 정상 판은 `ranked`다.
  - 같은 `clientRunId` 재전송은 `duplicate`이고 기록이 두 번 더해지지 않는다. 같은 표 재사용은 두 번째 판이 `unranked`다.
  - 동점 정렬 테스트(6.3)가 통과한다.
  - `node tools/gen-bounds.js` 결과의 엘리트, 보스 시각이 `js/data/waves.js`의 `LW.EVENTS`와 같다.

**S19. 서버 배포**
- 할 일: OwL-server 레포의 `docker-compose.yml`, `Caddyfile`, `ops/owl-backup`, `ops/owl_monitor.py`, `HANDOFF.md`(11장). 게임 레포의 `tools/deploy.sh`. 서버에 폴더 만들기, `up -d game`, Caddy reload.
- 완료 기준:
  - `curl https://game.aovob7.duckdns.org/api/health`가 `{"ok":true,...}`다.
  - `sudo docker stats --no-stream stack-game-1`의 메모리가 64MB 미만이다.
  - `sudo systemctl start owl-backup` 뒤 새 백업 파일 안에 `game.db`와 `pepper`가 있다.
  - 다른 컨테이너의 `Created` 시각이 바뀌지 않았다(다시 만들어지지 않음).

**S20. 클라이언트 통신 계층**
- 할 일: `js/net.js`, `js/config.js` 상수, `js/storage.js` 새 키, `sw.js`의 `/api/` 제외, `index.html` 스크립트 순서.
- 완료 기준:
  - DevTools 오프라인에서 새로고침해도 게임이 실행되고 오류가 없다.
  - 온라인에서 `/api/` 요청이 Network 탭에 "(ServiceWorker)"로 나오지 않고, Cache Storage에 `/api/` 항목이 없다.
  - 주소창에 `/api/health`를 직접 열면 게임 화면이 아니라 JSON이 보인다(SW 설치 후에도).

**S21. 계정 화면과 로그인**
- 할 일: `js/account.js`의 `init`, `login`, `logout`, `deleteAccount`, `setNickname`, `syncSettings`, `importOnce`. `js/ui.js`의 TITLE 계정 버튼, ACCOUNT, 닉네임 편집. `js/platform.js` 입력란 예외. `icons/google-g.png`.
- 완료 기준:
  - 데스크톱 Chrome과 Android 설치 앱에서 로그인, 닉네임 설정, 로그아웃, 계정 삭제가 된다.
  - 기기 A에서 소리를 끄고 기기 B에서 로그인하면 B의 소리가 꺼진다. 화질 설정은 따라가지 않는다.
  - 닉네임 입력 때 화면이 확대되지 않고, 키보드가 닫히면 캔버스 배치가 원래대로 돌아온다.
  - iPhone 홈 화면 앱에서 로그인한 뒤 그 앱 안에서 로그인 상태다. 실패하면 S24-A를 진행한다.
  - 게스트 기록이 있는 기기에서 처음 로그인하면 계정 기록에 한 번만 합쳐진다. 로그아웃 후 다시 로그인해도 다시 합쳐지지 않는다.

**S22. 판 제출과 대기열**
- 할 일: `js/game.js` 판 요약 버퍼, `killEnemy` 집계, `onRunStart`, `onRunEnd`, `refillTickets`, `flushQueue`, RESULT 한 줄.
- 완료 기준:
  - 온라인 판은 RESULT에 순위가 표시되고 서버 `runs.status`가 `ranked`다.
  - 비행기 모드로 3판을 하면 대기열이 3개이고, 온라인으로 돌아오면 1분 안에 모두 올라가 기록에 반영된다. 미리 받은 표로 했으므로 `ranked`다.
  - 표를 다 쓴 뒤 오프라인으로 한 판은 `unranked`(`no_ticket`)이고 개인 기록에는 반영된다.
  - 콘솔에서 `timeMs`나 `kills`를 바꿔 보낸 요청은 `rejected`다.
  - DevTools Performance의 할당 기록에서 PLAYING 중 판 요약 때문에 생기는 할당이 없다. S12 성능 기준을 유지한다.

**S23. 순위표 화면**
- 할 일: `js/ui.js` RANKING, `fetchBoard`, 저장본 표시.
- 완료 기준:
  - 두 보드가 6.3 규칙대로 정렬되고 내 순위 줄이 보인다. 게스트는 내 순위 줄 대신 "로그인하면 순위에 오를 수 있어요"가 보인다.
  - 오프라인에서는 마지막 저장본과 갱신 시각이 보인다.
  - 50줄을 끌어 넘길 때 휴대폰에서 끊기지 않는다(디버그 오버레이 55fps 이상).
  - 세로와 가로 모두에서 safe 영역 안에 들어간다.

**S24. 실기기 검증과 보정**
- 할 일:
  - 기기 표 확인: iPhone Safari 탭, iPhone 홈 화면 앱, Android Chrome 탭, Android 설치 앱, 데스크톱 Chrome. 항목은 로그인, 새로고침 후 유지, 7일 뒤 유지(가능하면), 오프라인 대기열.
  - S24-A(조건부, iOS 홈 화면 앱 로그인이 실패할 때만): "로그인 코드 회수" 방식을 더한다. 앱이 무작위 값 `v`를 만들어 `h = sha256(v)`로 `/api/auth/start?handoff=<h>`를 연다. 콜백은 세션 대신 `h`에 대기 로그인(5분, 1회)을 기록하고 "게임으로 돌아가세요" 페이지를 보여준다. 앱은 화면이 다시 보일 때와 2초마다(최대 5분) `POST /api/auth/claim {v}`를 불러 자기 쿠키 저장소에 세션을 받는다. 다른 사람이 만든 링크로 로그인시키는 피싱 위험이 있으므로 콜백 페이지에 앱 화면과 같은 4자리 확인 코드를 보여주고 "확인"을 눌러야 끝나게 한다.
  - `kpmMax` 보정: S15 기록과 서버의 `ranked` 판 분포로 정한다. 출시 버전을 `minRankedVersion`으로 정한다.
- 완료 기준: 기기 표가 모두 통과한다. `bounds.json`이 갱신되어 배포되었다. `DECISIONS.md`에 S24 결과가 적혀 있다.

---

## 13. 사용자가 직접 할 일

콘솔 메뉴 이름은 2026년 기준 "Google Auth Platform" 화면을 따른다. 한국어 화면에서는 이름이 다를 수 있어 영어 이름을 괄호에 함께 적었다. 정확한 한국어 표기는 확인 필요.

1. 게임 관리용으로 쓸 구글 계정으로 `https://console.cloud.google.com`에 로그인한다.
2. 화면 위쪽 프로젝트 선택 상자 > "새 프로젝트(New Project)".
   - 프로젝트 이름: `lanternwake`
   - 위치(조직): "조직 없음"
   - "만들기(Create)". 결제 계정 연결을 권하는 안내가 나와도 연결하지 않는다.
3. 위쪽 검색창에 "Google Auth Platform"을 입력해 들어가거나, 왼쪽 메뉴 "API 및 서비스(APIs & Services)" > "OAuth 동의 화면(OAuth consent screen)"으로 들어간다. "시작하기(Get started)"를 누른다.
   - 앱 정보(App Information): 앱 이름 `Lanternwake 등불지기`, 사용자 지원 이메일은 본인 Gmail 선택
   - 대상(Audience): "외부(External)"
   - 연락처 정보(Contact Information): 본인 이메일
   - 완료(Finish): 사용자 데이터 정책에 동의하고 "만들기(Create)"
4. 왼쪽 "브랜딩(Branding)":
   - **앱 로고는 올리지 않는다.** 로고를 올리면 인증 심사 대상이 된다.
   - 앱 홈페이지: `https://game.aovob7.duckdns.org` (비워도 됨)
   - 승인된 도메인(Authorized domains): `aovob7.duckdns.org`를 추가한다. DuckDNS 하위 도메인이 받아들여지는지는 확인 필요. 거부되면 비워 두고 다음으로 간다("테스트" 상태에서는 없어도 동작하는 것으로 알려져 있으나 확인 필요).
   - "저장(Save)"
5. 왼쪽 "데이터 액세스(Data Access)": 아무 범위도 추가하지 않는다. 이 설계는 `openid`만 요청하고, 이 범위는 따로 등록하지 않아도 된다.
6. 왼쪽 "클라이언트(Clients)" > "클라이언트 만들기(Create client)":
   - 애플리케이션 유형(Application type): "웹 애플리케이션(Web application)"
   - 이름(Name): `lanternwake-web`
   - 승인된 자바스크립트 원본(Authorized JavaScript origins): 아래 두 줄
     - `https://game.aovob7.duckdns.org`
     - `http://localhost:8080`
   - 승인된 리디렉션 URI(Authorized redirect URIs): 아래 두 줄. 끝의 `/`까지 글자 하나라도 다르면 `redirect_uri_mismatch` 오류가 난다
     - `https://game.aovob7.duckdns.org/api/auth/callback`
     - `http://localhost:8080/api/auth/callback`
   - "만들기(Create)"
   - 나오는 **클라이언트 ID**(`...apps.googleusercontent.com`)를 복사해 개발자에게 전달한다. 공개 값이라 채팅으로 전달해도 된다.
   - 클라이언트 보안 비밀번호(Client secret)는 이 설계에서 쓰지 않는다. 내려받거나 전달하지 않는다.
   - 설정이 반영되기까지 5분에서 몇 시간이 걸릴 수 있다.
7. 왼쪽 "대상(Audience)": 게시 상태(Publishing status)가 "테스트(Testing)"로 되어 있다.
   - "앱 게시(Publish app)"를 눌러 "프로덕션(In production)"으로 바꾼다.
   - 이때 인증 심사(verification)를 요구하는 안내가 나오면 게시하지 말고 "테스트"로 둔다. `openid`만 요청하는 앱은 테스트 상태에서도 테스트 사용자 등록 없이 누구나 로그인할 수 있다(Google 문서 "Manage App Audience").
8. 서버 적용(개발자가 SSH로 해도 되는 단계): 11.5의 처음 한 번 폴더 만들기, compose의 `GOOGLE_CLIENT_ID` 채우기, `up -d game`, Caddy reload.
9. 실기기 확인: iPhone에서 `https://game.aovob7.duckdns.org`를 홈 화면에 추가하고, 홈 화면 앱에서 로그인해 본다. 결과(앱 안에서 로그인 상태인지, Safari로 넘어가 버리는지)를 개발자에게 알려 준다. S24-A 진행 여부가 이것으로 정해진다.
10. 구글 계정 연결을 끊고 싶을 때: `https://myaccount.google.com/connections`에서 Lanternwake를 지운다. 게임 데이터 삭제는 게임 안 ACCOUNT 화면의 "계정 삭제"로 한다.

---

## 14. 위험 요소와 확인 필요

| 항목 | 내용 | 대응 |
|---|---|---|
| iOS 홈 화면 앱 로그인 | 구글 페이지에서 돌아올 때 같은 앱(같은 쿠키 저장소)으로 돌아오는지 확인 필요. 커뮤니티 보고가 엇갈린다 | S21에서 실기기로 확인하고, 실패하면 S24-A |
| 승인된 도메인 | DuckDNS 하위 도메인을 Branding의 승인된 도메인으로 받아 주는지 확인 필요 | 거부되면 "테스트" 상태로 운영 |
| 게시와 심사 | `openid`만 요청하는 앱을 프로덕션으로 게시할 때 심사가 없는지 확인 필요 | 심사가 필요하면 "테스트" 유지 |
| RS256 직접 구현 | 표준 라이브러리에 RSA 검증이 없어 약 20줄을 직접 쓴다 | 인코딩 후 전체 비교 방식, 거부 사례 테스트. 리뷰에서 거절되면 `cryptography` 패키지로 교체 |
| sw.js의 navigate 처리 | `/api/` 제외를 빠뜨리면 로그인 이동이 게임 화면으로 바뀐다 | S20 완료 기준에 직접 확인 항목을 넣음 |
| 순위표 조작 | 수정한 클라이언트로 실제 시간을 들여 플레이하면 막을 수 없다. 오래된 미리 받은 표로 한꺼번에 올릴 수도 있다 | 검사로 말이 안 되는 값만 막고, `suspects`, `hide`, `ban`으로 처리 |
| `kpmMax` 초기값 | 처음 값(분당 1200)은 추정이다. 너무 낮으면 정상 기록이 거부된다 | S24에서 실제 분포로 보정. 처음에는 넉넉하게 둔다 |
| 밸런스 변경 | S15 이후 수치가 바뀌면 이전 기록과 비교가 공정하지 않다 | `minRankedVersion`과 `rebuild-best` |
| iOS 저장소 삭제 | 7일 넘게 쓰지 않으면 localStorage가 지워질 수 있다(본 설계 위험 요소와 같음). 올리지 못한 대기열과 미리 받은 표가 사라진다 | 받아들인다. 서버 기록은 남는다. 세션 쿠키는 서버가 내린 쿠키라 이 규칙의 대상이 아닌 것으로 알려져 있으나 확인 필요 |
| SameSite=None 상태 쿠키 | Safari의 사이트 간 추적 방지가 구글에서 돌아오는 POST에 이 쿠키를 붙여 주는지 확인 필요. 최상위 이동이라 붙는 것이 정상이다 | S21 iPhone 확인. 실패하면 상태를 쿠키 대신 서버 DB(10분 1회용)에 두는 방식으로 바꾼다 |
| 구글 로고 사용 조건 | 직접 그린 버튼에 공식 G 로고를 넣는 조건은 확인 필요 | 구글 로그인 브랜딩 가이드의 공식 파일과 규칙을 따른다 |
| 닉네임 관리 | 금칙어 목록이 짧다 | `rename`, `ban` CLI |
| 개인정보 고지 | 가명 식별자(`sub` 해시)와 플레이 기록을 모은다. 별도 처리방침 페이지가 필요한지는 확인 필요 | ACCOUNT 화면 안내문, 계정 삭제 기능 제공 |
| 서버 장애, 인증서 만료 | API가 멈추면 로그인과 업로드가 안 된다 | 게임은 오프라인으로 계속 되고 대기열이 나중에 올린다. 감시 목록에 `stack-game-1` 추가 |
| 읽기 전용 마운트 백업 | WAL 모드 DB를 읽기 전용 마운트에서 `.backup`할 수 있는지 확인 필요 | 안 되면 `:ro`를 뺀다 |

---

## 15. DECISIONS.md에 넣을 결정

`## 설계 단계 결정`의 22번 뒤에 이어 붙인다.

23. **로그인 없이 게스트로 바로 플레이하고, 구글 로그인은 선택 기능으로 둔다. 로그인하면 기록과 설정 동기화, 전체 순위표 등록이 된다.** 오프라인 우선 원칙을 지키고, 처음 실행하는 사람이 로그인 때문에 막히지 않는다.
24. **로그인은 구글 OIDC 리디렉션(`response_type=id_token`, `response_mode=form_post`, `scope=openid`)으로 하고, Google Identity Services 스크립트와 버튼은 쓰지 않는다.** 외부 스크립트와 iframe 없이 캔버스 버튼으로 로그인할 수 있고, 클라이언트 비밀이 필요 없다. 구글이 iOS에서 요구하는 리디렉션 방식이기도 하다.
25. **구글에서는 `sub`만 받고 이메일과 이름은 받지 않는다. `sub`는 서버 pepper로 HMAC해서 저장하고, pepper는 백업에 포함한다.** 쓸 일이 없는 개인정보를 모으지 않는다. DB만 새어도 구글 계정과 바로 이어지지 않는다. pepper를 잃으면 계정을 모두 잃으므로 백업한다.
26. **백엔드는 파이썬 표준 라이브러리와 SQLite로 만든 `game` 컨테이너 하나다. authgate와 같은 방식(빌드 없음, 스크립트 읽기 전용 마운트)으로 운영한다. RS256 검증은 RFC 8017 8.2.2의 인코딩 후 전체 비교로 직접 구현한다.** 메모리가 수십 MB이고 의존성 관리가 없다. 패딩을 파싱하지 않아 서명 위조 버그가 생길 여지가 없다.
27. **세션은 `__Host-lw_s` HttpOnly, Secure, SameSite=Lax 쿠키(180일, 사용 시 연장)이고, DB에는 토큰 해시만 둔다. 로그인 중 상태 쿠키는 `__Host-lw_login`, SameSite=None, 10분이다.** API가 같은 출처라 쿠키가 단순하고, 스크립트가 세션을 읽을 수 없다. 구글 콜백이 다른 사이트에서 오는 POST라 상태 쿠키만 SameSite=None이어야 한다.
28. **상태를 바꾸는 API는 `Origin`이 게임 주소와 정확히 같고 본문이 JSON일 때만 받는다.** `duckdns.org`가 공개 접미사라 같은 `aovob7` 아래 다른 서비스가 같은 사이트로 취급되어, SameSite만으로는 막히지 않는다.
29. **순위표 조작 방지는 판 시작 표(1회용, 14일), 경과 시간 비교, `bounds.json` 기반 상관 검사(분당 처치, 경험치로 도달 가능한 레벨, 이벤트 수, 승리 시간)로 한다. 남는 허점은 관리 CLI(`suspects`, `hide`, `ban`)로 처리한다.** 클라이언트가 공개되어 완전한 방지는 불가능하다. 말이 안 되는 기록만 확실히 막고, 나머지는 사람이 본다.
30. **`server/bounds.json`은 `tools/gen-bounds.js`가 `js/data/waves.js`와 경험치 식에서 만들고, `release.js`가 매번 호출한다.** 게임 밸런스와 서버 검사가 어긋나지 않는다.
31. **오프라인 판은 대기열에 두었다가 온라인일 때 올린다. 표는 온라인일 때 5장까지 미리 받아 둔다. 표가 없으면 개인 기록에만 반영한다(`unranked`). 올릴 때 `clientRunId`로 멱등하게 처리한다.** 오프라인으로 한 판도 순위에 오를 수 있고, 재전송해도 중복되지 않는다.
32. **설정 동기화는 소리, 진동, 데미지 숫자 3개만 하고 화질은 기기마다 둔다. 충돌은 변경 시각(rev)이 큰 쪽이 이긴다.** 화질은 기기 성능에 따라 달라야 한다. 값이 3개라 단순한 규칙으로 충분하다.
33. **게스트 기록은 계정당 1회, 기기당 1회만 개인 기록에 합치고 순위표에는 넣지 않는다.** 기록을 잃지 않게 하면서, 검증할 수 없는 값이 순위에 들어가지 않게 한다.
34. **`sw.js`는 `/api/` 경로를 처리하지 않는다(캐시도, `index.html` 대체도 하지 않음).** API 응답이 캐시되지 않고, 로그인 이동이 게임 화면으로 바뀌지 않는다.
35. **닉네임 입력 하나만 DOM 폼을 쓴다(결정 6의 예외). 글자 크기 16px 이상, 문서 단위 터치 차단에서 이 폼은 제외한다.** 캔버스로는 한글 입력기와 모바일 키보드를 다룰 수 없다. iOS의 입력란 확대를 막는다.
36. **요청 제한은 game_api.py 안의 메모리 토큰 버킷으로 하고, IP는 Caddy가 넣는 `X-Real-IP`만 믿는다.** 기본 Caddy 이미지에는 요청 제한 기능이 없다. IP를 디스크에 남기지 않는다.
37. **서버 코드는 게임 레포 `server/`에 두고, compose와 Caddyfile은 OwL-server 레포에서 고친다. 정적 파일은 `/srv/owl-web/game/releases/<버전>`에 올리고 `current` 링크를 한 번에 바꾼다.** 검사 기준이 게임 데이터와 같은 레포에서 바뀐다. 파일을 덮어쓰는 도중에 SW가 섞인 파일을 캐시하는 문제를 막는다.
38. **순위표는 "생존 시간"(동점이면 처치 수)과 "처치 수"(동점이면 짧은 시간) 2개이고, 사용자마다 보드별 최고 기록 1개만 올린다.** 15:00 승리가 몰려도 처치 수로 순위가 갈린다. 한 사람이 순위표를 채우지 못한다.
