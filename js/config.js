// LW 네임스페이스 생성. 이 파일에서만 window.LW를 만든다.
window.LW = window.LW || {};
(function () {
  var q = new URLSearchParams(location.search);

  LW.VERSION = '0.1.0';
  LW.DT = 1 / 60;
  LW.MAX_STEPS = 4;
  LW.WIN_TIME = 900;

  // 주소 매개변수
  LW.params = {
    debug: q.get('debug') === '1',
    stress: q.get('stress') === '1',
    nosw: q.get('nosw') === '1',
    autotest: Math.max(0, Number(q.get('autotest')) || 0),
    // 자동 검사 보조 옵션: god=1 무적, build=all|alt 시작 빌드, start=초 시간 건너뛰기, snap=게임 초 목록
    god: q.get('god') === '1',
    elite: q.get('elite') === '1',
    candle: q.get('candle') === '1',
    snapChest: q.get('snapchest') === '1',
    // 자동 검사: rounds=N 연속 N판(사망 후 다시 하기), dieAt=초 각 판을 그 시각에 강제로 사망시킴,
    // snapstate=TITLE|RESULT|PAUSED|SETTINGS 그 화면에서 스냅샷
    rounds: Math.max(0, Math.floor(Number(q.get('rounds')) || 0)),
    killLast: q.get('killlast') === '1',
    dieAt: Math.max(0, Number(q.get('dieat')) || 0),
    snapState: q.get('snapstate') || '',
    build: q.get('build') || '',
    start: Math.max(0, Number(q.get('start')) || 0),
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
