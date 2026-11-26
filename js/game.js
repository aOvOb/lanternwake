// 상태 기계와 루프
// 상태: TITLE, PLAYING, LEVELUP, CHEST, PAUSED, SETTINGS, RESULT
(function () {
  var DT = LW.DT;
  var g = LW.game = {
    state: 'TITLE',
    time: 0, kills: 0, level: 1, xp: 0, xpNeed: LW.xpReq(1), pending: 0,
    weapons: [], passives: [], chestN: 0, chestB: 0, chestsOpened: 0, bossesSeen: [], dmgBySlot: new Float64Array(LW.WEAPON_SLOTS),
    god: false, won: false
  };
  var perf = LW.perf = {
    updSum: 0, updN: 0, rndSum: 0, rndN: 0, updLast: 0, rndLast: 0, fps: 60, maxEnemies: 0
  };

  var last = 0, acc = 0;

  g.setState = function (s) {
    var prev = g.state;
    if (prev === s) return;
    g.state = s;
    if (prev === 'PLAYING') LW.input.releaseJoy();
    LW.platform.wakeLock(s === 'PLAYING');
    if (s === 'PAUSED' || s === 'RESULT' || s === 'TITLE') LW.input.onOverlayOpen();
  };

  // 새 판 시작: 모든 풀과 상태를 처음으로 돌린다
  g.newRun = function () {
    g.time = 0; g.kills = 0; g.level = 1; g.xp = 0; g.xpNeed = LW.xpReq(1); g.pending = 0;
    g.won = false;
    g.god = LW.params.stress || LW.params.god;
    g.dmgBySlot.fill(0);
    g.passives = [];
    g.chestN = 0; g.chestB = 0; g.chestsOpened = 0;
    g.bossesSeen = [];
    LW.enemies.reset(); LW.projectiles.reset(); LW.areas.reset();
    LW.gems.reset(); LW.pickups.reset(); LW.effects.reset();
    LW.player.reset();
    LW.quality.reset();
    LW.platform.resize();
    LW.spawner.reset();
    g.weapons = [LW.makeWeapon('ember', 0)];
    perf.maxEnemies = 0;
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

  // 상자를 받는다. 실제로 여는 것은 갱신 11단계다.
  g.giveChest = function (boss) { if (boss) g.chestB++; else g.chestN++; };

  g.end = function (won) {
    g.won = !!won;
    LW.audio[won ? 'win' : 'lose']();
    g.setState('RESULT');
  };

  g.onHidden = function () {
    if (g.state === 'PLAYING') g.setState('PAUSED');
    LW.audio.suspend();
    LW.platform.wakeLock(false);
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
    if (P.hp <= 0) { g.end(false); return; }
    if (g.pending > 0) LW.levelup.open();  // 11
    else if (g.chestB > 0) { g.chestB--; LW.chest.open(true); }
    else if (g.chestN > 0) { g.chestN--; LW.chest.open(false); }
  }

  // 헤드리스의 가상 시간에서는 rAF가 거의 돌지 않으므로, 자동 검사 때만 타이머로 돌린다
  function schedule() {
    if (LW.autotest.active) setTimeout(function () { frame(performance.now()); }, 16);
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
    var steps = 0, maxSteps = LW.autotest.active ? 60 : LW.MAX_STEPS;
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

    if (g.state === 'PLAYING') {
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
