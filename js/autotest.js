// 자동 검사 모드: ?autotest=N
// 오류를 모으고, 플레이어를 자동으로 움직이고, N초가 지나면 결과 JSON을 <pre id="autotest">에 쓴다.
// 결과 JSON: ok는 "수집된 오류가 없음", reached는 "목표 시각에 도달했거나 승리", died는 "사망으로 끝남"이다.
// 보조 옵션: &start=초(그 시각부터 시작, N은 그 뒤로 더 돌 시간), &build=all|alt(시작 빌드와 자동 레벨업),
//           &god=1(무적), &elite=1(15초마다 엘리트), &candle=1(6초마다 가까운 촛대), &snap=T1,T2(게임 초에 캔버스를 PNG base64로 <pre id="snap-T">에 기록)
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
    // 상자와 아이템이 떨어져 있으면 가장 가까운 것 쪽으로 간다(획득 경로 검사). 촛대는 부서져야 해서 목표로 삼지 않는다.
    var pk = LW.pickups, P = LW.player, best = 1e12;
    for (var i = 0; i < pk.n; i++) {
      if (pk.items[i].kind === LW.PK.CANDLE) continue;
      var dx = pk.items[i].x - P.x, dy = pk.items[i].y - P.y, d2 = dx * dx + dy * dy;
      if (d2 < best && d2 < 640000) { best = d2; var d = Math.sqrt(d2) || 1; dir.x = dx / d; dir.y = dy / d; }
    }
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

  var candleT = 0;
  // &candle=1: 6초마다 가까운 곳에 촛대를 만든다(촛대 부수기, 세 아이템 경로 검사용)
  function candleStep(g, dt) {
    if (!LW.params.candle) return;
    candleT += dt;
    if (candleT < 6) return;
    candleT -= 6;
    LW.spawnCandle(true);
  }

  var eliteT = 0, eliteRR = 0;
  // &elite=1: 15초마다 엘리트를 하나 만든다(엘리트, 상자 경로 검사용)
  function eliteStep(g, dt) {
    if (!LW.params.elite) return;
    eliteT += dt;
    if (eliteT < 15) return;
    eliteT -= 15;
    var ids = ['mite', 'moth', 'mudling', 'spore', 'rusthelm', 'eye', 'boar'], tries = 0, id;
    while (tries++ < ids.length) {
      id = ids[eliteRR++ % ids.length];
      if (LW.ENEMIES[id]) { LW.spawner.spawnElite(id); return; }
    }
  }

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
      var age = performance.now() - LW.chest.openedAt;
      // 상자 창이 열려 있을 때 스냅샷 시각이 지났다면(&snapchest=1이면 시각과 상관없이 다음 스냅샷을) 창이 그려진 뒤에 찍는다
      if (age >= 150 && snapIdx < snaps.length && (LW.params.snapChest || g.time >= snaps[snapIdx])) takeSnap(snaps[snapIdx++]);
      if (age >= 500) LW.chest.close();
    }
    if (g.state === 'PLAYING' && !LW.params.snapChest) {
      while (snapIdx < snaps.length && g.time >= snaps[snapIdx]) takeSnap(snaps[snapIdx++]);
    }
    if (g.time >= at.endTime || g.state === 'RESULT') at.finish();
  };

  // 프레임이 아니라 게임 시간 1스텝마다 호출(game.update에서)
  at.step = function (dt) { buildStep(LW.game, dt); eliteStep(LW.game, dt); candleStep(LW.game, dt); };

  function round(v, k) { var m = Math.pow(10, k); return Math.round(v * m) / m; }

  at.finish = function (extraError) {
    if (at.done) return;
    at.done = true;
    if (extraError) push(extraError);
    var g = LW.game || {};
    var p = LW.perf || {};
    var res = {
      ok: at.errors.length === 0,
      reached: !!g.won || (g.time || 0) >= at.endTime - 1e-6,
      died: g.state === 'RESULT' && !g.won,
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
      dmgBySlot: g.dmgBySlot ? Array.prototype.map.call(g.dmgBySlot, Math.round) : [],
      passives: (g.passives || []).map(function (p) { return { id: p.def.id, level: p.lv }; }),
      bossesSeen: g.bossesSeen || [],
      eventsFired: LW.spawner && LW.spawner.fired ? LW.spawner.fired : {},
      spawned: LW.spawner && LW.spawner.spawned ? LW.spawner.spawned : {},
      maxNormal: p.maxNormal || 0,
      chestsOpened: g.chestsOpened || 0,
      mapItems: g.mapStats || {},
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
