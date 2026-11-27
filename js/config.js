// LW 네임스페이스 생성. 이 파일에서만 window.LW를 만든다.
window.LW = window.LW || {};
(function () {
  var q = new URLSearchParams(location.search);

  LW.VERSION = '0.2.0';
  LW.DT = 1 / 60;
  LW.MAX_STEPS = 4;
  LW.WIN_TIME = 900;

  // 주소 매개변수
  LW.params = {
    debug: q.get('debug') === '1',
    stress: q.get('stress') === '1',
    nosw: q.get('nosw') === '1',
    // bench=초: 실시간 성능 측정(헤드리스 가상 시간에서는 performance.now가 멈춘다).
    // 자동 검사 장치를 쓰되 rAF로 돌리고, 따로 지정하지 않으면 13:00(start=780) 무적 전체 빌드로 시작한다.
    // burn=ms는 프레임마다 그만큼 바쁜 루프를 돌려 부하를 주고, ql=0|1|2는 화질 단계를 고정한다(측정 전용).
    bench: Math.max(0, Number(q.get('bench')) || 0),
    burn: Math.max(0, Number(q.get('burn')) || 0),
    ql: q.get('ql') === null ? -1 : Math.max(0, Math.min(2, Math.floor(Number(q.get('ql')) || 0))),
    autotest: Math.max(0, Number(q.get('autotest')) || Number(q.get('bench')) || 0),
    // 자동 검사 보조 옵션: god=1 무적, build=all|alt 시작 빌드, start=초 시간 건너뛰기, snap=게임 초 목록
    god: q.get('god') === '1' || Number(q.get('bench')) > 0,
    elite: q.get('elite') === '1',
    candle: q.get('candle') === '1',
    snapChest: q.get('snapchest') === '1',
    // 자동 검사: rounds=N 연속 N판(사망 후 다시 하기), dieAt=초 각 판을 그 시각에 강제로 사망시킴,
    // snapstate=TITLE|RESULT|PAUSED|SETTINGS 그 화면에서 스냅샷
    rounds: Math.max(0, Math.floor(Number(q.get('rounds')) || 0)),
    crowd: q.get('crowd') === '1',
    killLast: q.get('killlast') === '1',
    dieAt: Math.max(0, Number(q.get('dieat')) || 0),
    snapState: q.get('snapstate') || '',
    build: q.get('build') || (Number(q.get('bench')) > 0 ? 'all' : ''),
    start: Math.max(0, q.get('start') === null && Number(q.get('bench')) > 0 ? 780 : Number(q.get('start')) || 0),
    snap: (q.get('snap') || '').split(',').map(Number).filter(function (v) { return v > 0; })
  };

  // 화면: 짧은 변 450 단위, 긴 변 최대 1050 단위
  LW.SHORT = 450;
  LW.MAX_LONG = 1050;

  // 풀 용량
  LW.POOL = {
    enemies: 360, projectiles: 500, enemyBullets: 150, areas: 120,
    gems: 250, pickups: 20, particles: 150, dmgNums: 40
  };
  LW.ENEMY_CAP = 300;
  LW.BOSS_RESERVE = 4;      // 풀 끝 몇 칸은 보스 전용(보스가 아닌 스폰은 풀 크기에서 이만큼 뺀 곳까지만)
  LW.SUMMON_CAP = 24;       // 밤나방 여왕이 소환한 나방의 동시 수 상한
  LW.MAX_ENEMY_R = 40;

  // 그리드
  LW.CELL = 64;
  LW.GRID_MARGIN = 256;
  LW.GRID_MAX = 32;

  // 화질 단계
  LW.QUALITY = [
    { name: 'HIGH', dpr: 2, particles: 150, dmgNums: 40 },
    { name: 'MID', dpr: 1.5, particles: 80, dmgNums: 20 },
    { name: 'LOW', dpr: 1, particles: 40, dmgNums: 0 }
  ];

  // 조이스틱(CSS px)
  LW.JOY = { R: 56, dead: 8, knob: 22 };

  LW.INVULN = 0.4;
  LW.OVERLAY_LOCK = 0.4;
  LW.KB_SCALE = 30;
  LW.WEAPON_SLOTS = 6;
  LW.PASSIVE_SLOTS = 6;
  LW.FONT = '"Malgun Gothic","Apple SD Gothic Neo","Noto Sans KR",sans-serif';

  // 질의 결과 공용 버퍼
  LW.qbuf = new Int32Array(512);
})();
