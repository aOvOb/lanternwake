# 코드 리뷰 1 (e63c494..be252ea, S1~S4) 요약

리뷰어: architect(Opus). 줄 번호는 be252ea 기준이라 지금 코드에서는 위치가 다를 수 있다.

## 필수
1. 자동 검사가 사망해도 통과로 나온다 (`js/autotest.js:49,61`, `tools/smoke.sh:52-55`). 결과 JSON에 `reached`(g.time >= N 또는 승리)와 `died`를 넣고, smoke.sh는 `ok && reached`일 때만 0을 돌려준다. 사망 허용은 `SMOKE_ALLOW_DEATH=1`. DECISIONS.md의 ok 정의도 고친다.

## 권장
2. 파티클과 데미지 숫자가 게임 난수 `LW.rand`를 써서 화질 단계에 따라 스폰이 달라진다. 그리기 전용 `LW.fxRand`를 따로 둔다 (`effects.js`, `behaviors.js:75`, `util.js`).
3. autotest만 프레임당 최대 60스텝으로 따라잡는다 (`game.js:116`). `LW.MAX_STEPS` 그대로 쓴다.
4. 그리기 루프 안 할당과 폰트 변경: `ui.js` HUD 문자열 매 프레임 생성(206,209,212,237), 일시정지 버튼 `text()`로 폰트 변경(249), `render.js:292` owlLantern 객체 리터럴 반환, `render.js:351` 폰트 문자열 이어 붙이기. 값 비교 후 바뀔 때만 만들고, 라벨은 문자 캐시, 폰트는 상수, 등불 위치는 공용 객체.
5. 레벨업 창 열 때 update 안에서 배열, 객체, splice 할당 (`levelup.js:46-60`). 후보 버퍼와 카드 객체 3개를 미리 만들어 재사용.
6. 방향 전환 한 번에 resize 이벤트 3개로 스프라이트 3번 재생성, 새 판마다 전체 화면 비네트 캔버스 새로 생성 (`platform.js:62-64`, `render.js:140-145,238-247`, `game.js:36`). resize는 rAF 한 번으로 묶고, 캔버스 재사용, newRun에서는 dprCap이 바뀐 경우만 재생성. iOS 캔버스 메모리 한도 위험.
7. safe-area를 방향 전환 직후 늦게 읽을 수 있음, 백버퍼는 innerWidth 기준인데 CSS는 100vw/100dvh (`platform.js:13-31`, `index.html:13`). resize 뒤 300ms에 readSafe 한 번 더, canvas style 크기를 JS에서 cssW/cssH px로 지정.
8. 눌림 포인터 목록 `held`가 blur, lostpointercapture에서 안 지워짐 (`input.js:19,90-97,109-112`). 마우스 ID 1이 남아 오버레이 뒤 첫 클릭이 사라지거나 무시 목록 8칸이 차면 입력 보호가 꺼짐. blur, hidden에서 nHeld=0, lostpointercapture는 up(e,true).
9. 버튼 판정을 배열 인덱스로 비교 (`ui.js:171,181`). 버튼 id로 비교.
10. Wake Lock이 LEVELUP에서 풀리고 요청 중 해제가 무시됨 (`game.js:22`, `platform.js:75-89`). PLAYING, LEVELUP, CHEST에서 유지, 원하는 상태 플래그를 두고 요청 완료 시 false면 release.
11. 설계 수치 차이: 불꽃 흔들림 0.9±0.2를 `1 + 0.08*sin()`으로 (`render.js:290`), 병합 보석 빨강 표시 누락 (`pickups.js:14-18`), 디버그 버튼 위치가 설계(왼쪽 위)와 다름 (`ui.js:89-94`). 고치거나 DECISIONS에 기록.
12. `spawn(0)`이 무제한 (`util.js:49`). `limit === undefined ? size : limit`. (2묶음 coder에게 먼저 전달함)
13. smoke.sh 서버는 127.0.0.1, Chrome은 localhost로 접속 (`smoke.sh:15,36`). `http://127.0.0.1:$PORT/`로 통일.

## 위험 요소
- autotest는 조이스틱, 키보드, UI 탭 판정을 거치지 않고 카드도 첫 장만 고른다. 입력 보호는 실기기 검사가 필요하다.
- 공용 버퍼 `LW.qbuf`를 순회하는 중 처치 처리 안에서 queryRadius를 부르면 버퍼가 덮어써진다. (2묶음 coder에게 먼저 전달함)
- document 전체 touchstart를 preventDefault하는 상태에서 iOS 오디오 잠금 해제가 되는지 확인 필요.
