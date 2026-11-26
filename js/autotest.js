// 자동 검사 모드: ?autotest=N
// 오류를 모으고, 플레이어를 자동으로 움직이고, N초가 지나면 결과 JSON을 <pre id="autotest">에 쓴다.
// 보조 옵션: &start=초(그 시각부터 시작, N은 그 뒤로 더 돌 시간), &build=all|alt(시작 빌드와 자동 레벨업),
//           &god=1(무적), &snap=T1,T2(게임 초에 캔버스를 PNG base64로 <pre id="snap-T">에 기록)
(function () {
  var N = LW.params.autotest;
  var START = LW.params.start;
  var at = LW.autotest = { active: N > 0, done: false, errors: [], seconds: N, angle: 0, endTime: START + N, snapsTaken: [] };
  var dir = { x: 0, y: 0 };
  var snaps = LW.params.snap.slice().sort(function (a, b) { return a - b; });
  var snapIdx = 0;
  if (!at.active) return;

  function str(v) {
    try { return typeof v === 'string' ? v : (v && v.stack) || JSON.stringify(v); }
    catch (e) { return String(v); }
  }
  function push(msg) { if (at.errors.length < 50) at.errors.push(msg); }

  var prevOnError = window.onerror;
  window.onerror = function (msg, src, line, col) {
    push('onerror: ' + msg + ' (' + src + ':' + line + ':' + col + ')');
    if (prevOnError) return prevOnError.apply(this, arguments);
    return false;
  };
  window.addEventListener('unhandledrejection', function (e) {
    push('unhandledrejection: ' + str(e.reason));
  });
  var origErr = console.error;
  console.error = function () {
    var parts = [];
    for (var i = 0; i < arguments.length; i++) parts.push(str(arguments[i]));
    push('console.error: ' + parts.join(' '));
    return origErr.apply(console, arguments);
  };

  // 게임 시간 1스텝마다 호출: 플레이어가 원을 그리며 움직인다
  at.tick = function (dt) {
    at.angle += dt * 0.5;
    dir.x = Math.cos(at.angle); dir.y = Math.sin(at.angle);
    LW.input.auto = dir;
  };

  // 빌드별 시작 무기와 패시브. 아직 없는 항목(구현 전 단계)은 건너뛴다.
  var BUILDS = {
    all: { w: ['ember', 'orbit', 'halo', 'scythe', 'bell', 'disc'], p: ['P2', 'P4', 'P7', 'P1', 'P3', 'P5'] },
    alt: { w: ['ember', 'flask', 'seed'], p: ['P8', 'P9', 'P6', 'P10', 'P1', 'P7'] }
  };
  var buildCfg = BUILDS[LW.params.build] || null;
  var stepT = 0, stepRR = 0;

  // 새 판이 시작된 직후 한 번 호출: 시간 건너뛰기와 시작 빌드
  at.setup = function (g) {
    if (START > 0) {
      g.time = START;
      if (LW.spawner.skipTo) LW.spawner.skipTo(START);
    }
    stepT = 0; stepRR = 0;
    if (!buildCfg) return;
    var boostW = START > 0 ? Math.min(7, Math.floor(START / 60)) : 0;
    var boostP = START > 0 ? Math.min(4, Math.floor(START / 200)) : 0;
    var i, id;
    g.weapons = [];
    for (i = 0; i < buildCfg.w.length; i++) {
      id = buildCfg.w[i];
      if (!LW.WEAPON_BY_ID[id]) continue;
      var w = LW.makeWeapon(id, g.weapons.length);
      w.lv = Math.min(w.def.maxLv, 1 + boostW);
      g.weapons.push(w);
    }
    g.passives = [];
    for (i = 0; i < buildCfg.p.length; i++) {
      id = buildCfg.p[i];
      if (!LW.PASSIVE_BY_ID || !LW.PASSIVE_BY_ID[id]) continue;
      var pd = LW.PASSIVE_BY_ID[id];
      g.passives.push({ def: pd, lv: Math.min(pd.maxLv, 1 + boostP) });
    }
    LW.player.recomputeStats();
  };

  // 2초마다 무기 하나의 레벨을 올린다. 진화 조건이 갖춰진 무기가 있으면 상자를 지급한다.
  function buildStep(g, dt) {
    if (!buildCfg) return;
    stepT += dt;
    if (stepT < 2) return;
    stepT -= 2;
    var list = g.weapons, n = list.length, k;
    for (k = 0; k < n; k++) {
      var w = list[(stepRR + k) % n];
      if (w.lv < w.def.maxLv && !w.evolved) { w.lv++; stepRR = (stepRR + k + 1) % n; break; }
    }
    LW.player.recomputeStats();
    if (LW.chest && LW.chest.hasEvolvable() && g.giveChest) g.giveChest(false);
  }

  function takeSnap(t) {
    var url = '';
    try { url = LW.canvas.toDataURL('image/png'); } catch (e) { push('snap: ' + str(e)); }
    var pre = document.createElement('pre');
    pre.id = 'snap-' + t;
    pre.textContent = url.slice(url.indexOf(',') + 1);
    document.body.appendChild(pre);
    at.snapsTaken.push(t);
  }

  // 프레임마다 호출: 타이틀 통과, 카드와 상자 자동 처리, 스냅샷, 종료 판정
  at.frame = function () {
    if (at.done) return;
    var g = LW.game;
    if (!g) return;
    if (g.state === 'TITLE') {
      g.start();
      at.setup(g);
    } else if (g.state === 'LEVELUP') {
      if (performance.now() - LW.levelup.openedAt >= 500) LW.levelup.choose(0);
    } else if (g.state === 'CHEST') {
      if (performance.now() - LW.chest.openedAt >= 500) LW.chest.close();
    }
    if (g.state === 'PLAYING') {
      while (snapIdx < snaps.length && g.time >= snaps[snapIdx]) takeSnap(snaps[snapIdx++]);
    }
    if (g.time >= at.endTime || g.state === 'RESULT') at.finish();
  };

  // 프레임이 아니라 게임 시간 1스텝마다 호출(game.update에서)
  at.step = function (dt) { buildStep(LW.game, dt); };

  function round(v, k) { var m = Math.pow(10, k); return Math.round(v * m) / m; }

  at.finish = function (extraError) {
    if (at.done) return;
    at.done = true;
    if (extraError) push(extraError);
    var g = LW.game || {};
    var p = LW.perf || {};
    var res = {
      ok: at.errors.length === 0,
      errors: at.errors,
      gameTime: round(g.time || 0, 2),
      level: g.level || 0,
      kills: g.kills || 0,
      enemiesActive: LW.enemies ? LW.enemies.n : 0,
      maxEnemies: p.maxEnemies || 0,
      avgUpdateMs: p.updN ? round(p.updSum / p.updN, 4) : 0,
      avgRenderMs: p.rndN ? round(p.rndSum / p.rndN, 4) : 0,
      state: g.state || '',
      start: START,
      weapons: (g.weapons || []).map(function (w) {
        return { id: w.def.id, level: w.lv, evolved: !!w.evolved };
      }),
      passives: (g.passives || []).map(function (p) { return { id: p.def.id, level: p.lv }; }),
      bossesSeen: g.bossesSeen || [],
      eventsFired: LW.spawner && LW.spawner.fired ? LW.spawner.fired : {},
      spawned: LW.spawner && LW.spawner.spawned ? LW.spawner.spawned : {},
      maxNormal: p.maxNormal || 0,
      chestsOpened: g.chestsOpened || 0,
      snaps: at.snapsTaken
    };
    var pre = document.createElement('pre');
    pre.id = 'autotest';
    pre.textContent = JSON.stringify(res);
    document.body.appendChild(pre);
  };

  // 게임이 시작되지 못한 경우에도 JSON이 남도록 하는 감시 타이머
  setTimeout(function () {
    at.finish('watchdog: 게임 시간 ' + N + '초에 도달하지 못함');
  }, N * 1500 + 8000);
})();
