// 자동 검사 모드: ?autotest=N
// 오류를 모으고, 플레이어를 자동으로 움직이고, N초가 지나면 결과 JSON을 <pre id="autotest">에 쓴다.
// 결과 JSON: ok는 "수집된 오류가 없음", reached는 "목표 시각에 도달했거나 승리", died는 "사망으로 끝남"이다.
// 보조 옵션: &start=초(그 시각부터 시작, N은 그 뒤로 더 돌 시간), &build=all|alt(시작 빌드와 자동 레벨업),
//           &rounds=N(연속 N판, 사망하면 다시 하기), &dieat=초(각 판을 그 시각에 사망시킴),
//           &snapstate=TITLE|RESULT|PAUSED|SETTINGS(그 화면이 그려진 뒤 스냅샷),
//           &crowd=1(적 풀을 가득 채움), &killlast=1(마지막 그림자 HP를 1로),
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

  // 연속 판 검사: 판이 시작된 직후의 풀 활성 수와 상태를 기록해 초기화가 됐는지 본다
  var ROUNDS = LW.params.rounds, roundNo = 1, roundT = 0, roundsDone = 0, resultAt = 0, titleAt = 0, sceneAt = 0, scene = 0;
  at.roundStarts = [];
  at.roundEnds = [];
  // 판이 끝난 시점의 상태(재시작 전에 풀에 무엇이 남아 있었는지 보여 준다)
  function endNote(g) {
    return { time: r2(g.time), kills: g.kills, died: !g.won, level: g.level, enemies: LW.enemies.n, projectiles: LW.projectiles.n,
      areas: LW.areas.n, gems: LW.gems.n, pickups: LW.pickups.n, particles: LW.particles.n };
  }
  function noteRoundStart(g) {
    at.roundStarts.push({
      enemies: LW.enemies.n, projectiles: LW.projectiles.n, areas: LW.areas.n, ebullets: LW.ebullets.n,
      gems: LW.gems.n, pickups: LW.pickups.n, particles: LW.particles.n, dmgNums: LW.dmgNums.n,
      hp: LW.player.hp, maxHp: LW.player.maxHp, time: g.time, level: g.level, kills: g.kills, pending: g.pending,
      weapons: g.weapons.length, passives: g.passives.length, evolved: g.weapons.some(function (w) { return w.evolved; }),
      candles: LW.pickups.nCandle, boss: !!LW.enemies.boss, won: g.won, toast: g.toastT, mapItems: g.mapStats.candleSpawned
    });
    roundT = 0;
  }

  // 효과음 호출 경로 검사: 모든 효과음을 한 번씩 불러 예외가 없는지 본다(맨 처음 판에서만)
  var audioChecked = false;
  function audioCheck() {
    if (audioChecked) return;
    audioChecked = true;
    var names = ['hit', 'gem', 'levelup', 'hurt', 'chest', 'bossWarn', 'win', 'lose', 'start', 'pickup', 'candle'];
    for (var i = 0; i < names.length; i++) {
      try { LW.audio[names[i]](); } catch (e) { push('audio.' + names[i] + ': ' + str(e)); }
    }
    try { LW.audio.vibrate(10); LW.audio.suspend(); LW.audio.resume(); LW.audio.applySettings(); } catch (e2) { push('audio: ' + str(e2)); }
  }

  // 새 판이 시작된 직후 한 번 호출: 시간 건너뛰기와 시작 빌드
  at.setup = function (g) {
    audioCheck();
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
    var now = performance.now(), sst = LW.params.snapState;
    if (g.state === 'TITLE') {
      // snapstate=TITLE이면 타이틀이 그려진 뒤 첫 스냅샷을 찍고 시작한다
      if (sst === 'TITLE' && snapIdx < snaps.length) {
        if (!titleAt) titleAt = now;
        if (now - titleAt < 700) return;
        takeSnap(snaps[snapIdx++]);
      }
      g.start();
      at.setup(g);
      noteRoundStart(g);
    } else if (g.state === 'RESULT') {
      if (!resultAt) resultAt = now;
      var rage = now - resultAt;
      if (sst === 'RESULT' && snapIdx < snaps.length && rage >= 500) takeSnap(snaps[snapIdx++]);
      var more = ROUNDS > 0 && roundNo < ROUNDS;
      if (rage >= 1200 && more) {
        at.roundEnds.push(endNote(g));
        roundsDone = roundNo; roundNo++; resultAt = 0;
        LW.ui.act('retry');            // 결과 화면의 "다시 하기" 버튼과 같은 경로
        at.setup(g);
        noteRoundStart(g);
      } else if (!more && (sst !== 'RESULT' || snapIdx >= snaps.length) && rage >= 100) {
        if (ROUNDS > 0) { at.roundEnds.push(endNote(g)); roundsDone = roundNo; }
        at.finish();
      }
      return;
    } else if (g.state === 'PAUSED' || g.state === 'SETTINGS') {
      // 화면 스냅샷 시나리오: 일시정지와 설정을 연 뒤 찍고 되돌린다
      if (!sceneAt) sceneAt = now;
      if (now - sceneAt >= 500 && snapIdx < snaps.length) {
        takeSnap(snaps[snapIdx++]);
        if (sst === 'PAUSED' || scene === 1) { LW.ui.act(g.state === 'SETTINGS' ? 'back' : 'resume'); }
        else { scene = 1; LW.ui.act('settings'); sceneAt = 0; }
      }
      return;
    } else if (g.state === 'LEVELUP') {
      if (performance.now() - LW.levelup.openedAt >= 500) LW.levelup.choose(0);
    } else if (g.state === 'CHEST') {
      var age = performance.now() - LW.chest.openedAt;
      // 상자 창이 열려 있을 때 스냅샷 시각이 지났다면(&snapchest=1이면 시각과 상관없이 다음 스냅샷을) 창이 그려진 뒤에 찍는다
      if (age >= 150 && snapIdx < snaps.length && (LW.params.snapChest || g.time >= snaps[snapIdx])) takeSnap(snaps[snapIdx++]);
      if (age >= 500) LW.chest.close();
    }
    if (g.state === 'PLAYING' && !LW.params.snapChest && sst !== 'RESULT' && sst !== 'PAUSED' && sst !== 'SETTINGS' && sst !== 'TITLE') {
      while (snapIdx < snaps.length && g.time >= snaps[snapIdx]) takeSnap(snaps[snapIdx++]);
    }
    // 일시정지, 설정 화면 스냅샷: 스냅샷 시각이 되면 일시정지를 연다
    if (g.state === 'PLAYING' && (sst === 'PAUSED' || sst === 'SETTINGS') && snapIdx < snaps.length && g.time >= snaps[snapIdx]) {
      sceneAt = 0; scene = sst === 'SETTINGS' ? 0 : 1;
      LW.ui.act('pause');
      if (sst === 'SETTINGS') LW.ui.act('settings');
    }
    // 연속 판 검사는 마지막 판의 결과 화면에서 끝낸다. 그 밖에는 목표 시각에 끝낸다.
    if (ROUNDS === 0 && g.time >= at.endTime) at.finish();
  };

  // 프레임이 아니라 게임 시간 1스텝마다 호출(game.update에서)
  at.step = function (dt) {
    buildStep(LW.game, dt); eliteStep(LW.game, dt); candleStep(LW.game, dt);
    // dieat: 판이 이 시각이 되면 HP를 0으로 만든다. 실제 사망 경로(game.update의 hp 검사)를 그대로 탄다.
    roundT += dt;
    // crowd=1: 적 풀을 매 스텝 가득 채운다(special 표시, 상한 무시). 풀이 찬 상태에서 보스가 나오는지 검사한다.
    if (LW.params.crowd) {
      var cp = LW.enemies, Pl = LW.player, guard = 0;
      while (cp.n < cp.size && guard++ < 400) {
        var ce = cp.spawnEnemy('mite', Pl.x + 380 + (guard % 40) * 5, Pl.y + ((guard * 37) % 300) - 150, 0, true);
        if (!ce) break;
        ce.special = true;
      }
    }
    // killlast=1: 마지막 그림자의 HP를 1로 만들어 처치 경로("완전한 새벽")를 검사한다
    var bs = LW.enemies.boss;
    if (LW.params.killLast && bs && bs.active && bs.def.id === 'last' && bs.hp > 1) bs.hp = 1;
    if (LW.params.dieAt > 0 && roundT >= LW.params.dieAt) { LW.game.god = false; LW.player.hp = 0; }
  };

  function r2(v) { return Math.round(v * 100) / 100; }
  function round(v, k) { var m = Math.pow(10, k); return Math.round(v * m) / m; }

  at.finish = function (extraError) {
    if (at.done) return;
    at.done = true;
    if (extraError) push(extraError);
    var g = LW.game || {};
    var p = LW.perf || {};
    var res = {
      ok: at.errors.length === 0,
      reached: ROUNDS > 0 ? roundsDone >= ROUNDS : (!!g.won || (g.time || 0) >= at.endTime - 1e-6),
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
      bossActive: !!(LW.enemies.boss && LW.enemies.boss.active),
      audioPlayed: LW.audio.played || 0,
      rounds: ROUNDS,
      roundsDone: roundsDone,
      roundStarts: at.roundStarts,
      roundEnds: at.roundEnds,
      records: LW.records,
      full: !!g.full,
      lastBossKilled: !!g.lastBossKilled,
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
