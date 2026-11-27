// 상태 기계와 루프
// 상태: TITLE, PLAYING, LEVELUP, CHEST, PAUSED, SETTINGS, RESULT
(function () {
  var DT = LW.DT;
  var g = LW.game = {
    state: 'TITLE',
    time: 0, kills: 0, level: 1, xp: 0, xpNeed: LW.xpReq(1), pending: 0,
    weapons: [], passives: [], chestN: 0, chestB: 0, chestsOpened: 0, bossesSeen: [], bannerText: '', bannerT: 0, dmgBySlot: new Float64Array(LW.WEAPON_SLOTS),
    god: false, won: false,
    mapStats: { candleSpawned: 0, candleBroken: 0, candleMax: 0, oil: 0, bell: 0, light: 0, purified: 0 },
    toastText: '', toastT: 0, flashT: 0,
    full: false, lastBossKilled: false,
    prevBest: { time: 0, kills: 0, level: 0, runs: 0 },
    newBest: { time: false, kills: false, level: false }
  };
  var perf = LW.perf = {
    updSum: 0, updN: 0, rndSum: 0, rndN: 0, updLast: 0, rndLast: 0, fps: 60, maxEnemies: 0, maxNormal: 0, maxAreas: 0
  };

  var last = 0, acc = 0;
  var BURN = LW.params.burn;
  // bench: 프레임 간격(ms)을 미리 잡아 둔 배열에 기록한다(측정 중 할당 없음). 최대 240fps로 계산.
  var benchDt = LW.params.bench > 0 ? new Float32Array(LW.params.bench * 240 + 600) : null, benchN = 0;
  perf.benchFrames = function () { return benchDt ? benchDt.subarray(0, benchN) : null; };

  g.setState = function (s) {
    var prev = g.state;
    if (prev === s) return;
    g.state = s;
    if (prev === 'PLAYING') LW.input.releaseJoy();
    // 화면 꺼짐 방지는 진행 중인 상태(레벨업, 상자 포함)에서 유지한다
    LW.platform.wakeLock(s === 'PLAYING' || s === 'LEVELUP' || s === 'CHEST');
    if (s === 'PAUSED' || s === 'RESULT' || s === 'TITLE' || s === 'SETTINGS') LW.input.onOverlayOpen();
    LW.ui.onState(s);
    if (s === 'PLAYING') LW.audio.resume();       // 일시정지를 풀면 오디오도 다시 연다
  };

  // 새 판 시작: 모든 풀과 상태를 처음으로 돌린다
  g.newRun = function () {
    g.time = 0; g.kills = 0; g.level = 1; g.xp = 0; g.xpNeed = LW.xpReq(1); g.pending = 0;
    g.won = false;
    g.god = LW.params.stress || LW.params.god;
    g.dmgBySlot.fill(0);
    g.passives = [];
    g.chestN = 0; g.chestB = 0; g.chestsOpened = 0;
    g.bossesSeen = []; g.bannerT = 0; g.bossKilled = 0;
    g.toastT = 0; g.flashT = 0; g.full = false; g.lastBossKilled = false;
    var rc = LW.records, pb = g.prevBest;
    pb.time = rc.bestTime; pb.kills = rc.bestKills; pb.level = rc.bestLevel; pb.runs = rc.runs;
    var ms = g.mapStats;
    ms.candleSpawned = 0; ms.candleBroken = 0; ms.candleMax = 0; ms.oil = 0; ms.bell = 0; ms.light = 0; ms.purified = 0;
    LW.enemies.reset(); LW.projectiles.reset(); LW.areas.reset(); LW.ebullets.reset();
    LW.gems.reset(); LW.pickups.reset(); LW.effects.reset();
    LW.player.reset();
    LW.quality.reset();
    LW.platform.resize();
    LW.spawner.reset();
    g.weapons = [LW.makeWeapon('ember', 0)];
    perf.maxEnemies = 0; perf.maxNormal = 0; perf.maxAreas = 0;
    last = performance.now(); acc = 0;
  };

  g.start = function () {
    g.newRun();
    g.setState('PLAYING');
    LW.audio.start();
  };

  g.addXp = function (v) {
    g.xp += v;
    while (g.xp >= g.xpNeed) {
      g.xp -= g.xpNeed;
      g.level++;
      g.xpNeed = LW.xpReq(g.level);
      g.pending++;
    }
  };

  // 화면 위쪽에 잠깐 보이는 안내 글(맵 아이템을 받았을 때)
  g.toast = function (t) { g.toastText = t; g.toastT = 2; };

  // 상자를 받는다. 실제로 여는 것은 갱신 11단계다.
  g.giveChest = function (boss) { if (boss) g.chestB++; else g.chestN++; };

  // 15:00 승리 연출: 시야 안 적이 흩어지며 사라지고, 남은 적과 탄은 지운다
  function vanishAll() {
    var v = LW.view, P = LW.player, items = LW.enemies.items, n = LW.enemies.n;
    for (var i = 0; i < n; i++) {
      var e = items[i];
      if (!e.active || Math.abs(e.x - P.x) > v.w / 2 || Math.abs(e.y - P.y) > v.h / 2) continue;
      LW.effects.burst(e.x, e.y, 2, 0);
    }
    LW.enemies.reset(); LW.ebullets.reset(); LW.areas.reset(); LW.projectiles.reset();
  }

  // 판 종료. 승리는 15:00 생존이고, 14:00 보스를 처치했으면 "완전한 새벽"이다.
  g.end = function (won) {
    g.won = !!won;
    g.full = g.won && g.lastBossKilled;
    var pb = g.prevBest, nb = g.newBest, t = Math.floor(g.time);
    // 첫 판은 비교할 이전 기록이 없어 갱신 표시를 하지 않는다
    nb.time = pb.runs > 0 && t > pb.time;
    nb.kills = pb.runs > 0 && g.kills > pb.kills;
    nb.level = pb.runs > 0 && g.level > pb.level;
    LW.finishRun(g, g.won, g.full);
    LW.ui.refreshBest();
    if (g.won) vanishAll();
    LW.ui.buildResult(g);
    LW.audio[won ? 'win' : 'lose']();
    g.setState('RESULT');
  };

  g.onHidden = function () {
    if (g.state === 'PLAYING') g.setState('PAUSED');
    LW.audio.suspend();
    LW.commitProgress(g);
    LW.platform.wakeLock(false);
    LW.input.resetPointers();
  };
  g.onVisible = function () {
    last = performance.now();
    acc = 0;
  };

  function update(dt) {
    var P = LW.player;
    if (LW.autotest.active) { LW.autotest.tick(dt); LW.autotest.step(dt); }
    // 1. 시간
    g.time += dt;
    if (g.bannerT > 0) g.bannerT -= dt;
    if (g.toastT > 0) g.toastT -= dt;
    if (g.flashT > 0) g.flashT -= dt;
    if (g.time >= LW.WIN_TIME) { g.end(true); return; }
    LW.spawner.update(dt);                 // 2
    P.update(dt);                          // 3
    LW.render.cam.x = P.x; LW.render.cam.y = P.y;
    LW.grid.rebuild(LW.enemies);           // 4
    LW.weapons.update(dt);                 // 5
    LW.projectiles.update(dt);             // 6
    LW.areas.update(dt);
    LW.enemies.update(dt);                 // 7
    LW.collision.update(dt);               // 8
    LW.enemies.compact();
    LW.pickups.update(dt);                 // 9
    LW.effects.update(dt);                 // 10
    if (LW.enemies.n > perf.maxEnemies) perf.maxEnemies = LW.enemies.n;
    if (LW.areas.n > perf.maxAreas) perf.maxAreas = LW.areas.n;
    if (P.hp <= 0) { g.end(false); return; }
    if (g.pending > 0) LW.levelup.open();  // 11
    else if (g.chestB > 0) { g.chestB--; LW.chest.open(true); }
    else if (g.chestN > 0) { g.chestN--; LW.chest.open(false); }
  }

  // 헤드리스의 가상 시간에서는 rAF가 거의 돌지 않으므로, 자동 검사 때만 타이머로 돌린다
  function schedule() {
    // bench는 실제 시간으로 재야 하므로 rAF를 쓴다
    if (LW.autotest.active && !LW.params.bench) setTimeout(function () { frame(performance.now()); }, 16);
    else requestAnimationFrame(frame);
  }

  function frame(now) {
    if (LW.autotest.done) return;
    schedule();
    var frameDt = Math.min((now - last) / 1000, 0.25);
    if (frameDt < 0) frameDt = 0;
    last = now;
    if (frameDt > 0) perf.fps += (1 / frameDt - perf.fps) * 0.05;

    LW.ui.handleInput();
    if (LW.autotest.active) LW.autotest.frame();

    acc += frameDt;
    var steps = 0, maxSteps = LW.MAX_STEPS;
    var t0 = performance.now();
    while (acc >= DT && steps < maxSteps) {
      if (g.state === 'PLAYING') update(DT);
      acc -= DT; steps++;
    }
    if (steps === maxSteps) acc = 0;
    var t1 = performance.now();
    LW.quality.sample(frameDt);
    LW.render.frame(g);
    var t2 = performance.now();
    LW.input.endFrame();

    if (BURN > 0) { var tb = performance.now(); while (performance.now() - tb < BURN) { /* 측정용 부하 */ } }
    if (g.state === 'PLAYING') {
      if (benchDt && benchN < benchDt.length && g.time > LW.params.start + 2) benchDt[benchN++] = frameDt * 1000;   // 시작 직후 2초는 예열이라 뺀다
      perf.updLast = t1 - t0; perf.rndLast = t2 - t1;
      perf.updSum += perf.updLast; perf.updN++;
      perf.rndSum += perf.rndLast; perf.rndN++;
    }
  }

  g.run = function () {
    last = performance.now();
    schedule();
  };
})();
