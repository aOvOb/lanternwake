// 스폰: 시간대별 표(LW.WAVES), 이벤트(LW.EVENTS), 재배치
(function () {
  var sp = LW.spawner = { acc: 0, evIdx: 0, fired: {}, spawned: {} };
  var pt = { x: 0, y: 0 };
  var prepared = null, events = null;
  var TAU = Math.PI * 2;
  var BOSS_WARN = 3;          // 보스 등장 3초 전에 경고
  var STALE = 5;              // 이 시간보다 오래 지난 이벤트는 시간 건너뛰기로 보고 건너뛴다

  // 구간마다 종류와 가중치를 배열로 미리 만든다. 이벤트는 시각순으로 정렬하고 보스 경고를 끼워 넣는다.
  function prepare() {
    prepared = [];
    for (var i = 0; i < LW.WAVES.length; i++) {
      var w = LW.WAVES[i], ids = [], ws = [], total = 0;
      for (var k in w.weights) { ids.push(k); ws.push(w.weights[k]); total += w.weights[k]; }
      prepared.push({ from: w.from, to: w.to, ids: ids, ws: ws, total: total, rate: w.rate, minAlive: w.minAlive });
    }
    events = [];
    for (var j = 0; j < LW.EVENTS.length; j++) {
      var ev = LW.EVENTS[j];
      if (ev.type === 'boss') events.push({ t: ev.t - BOSS_WARN, type: 'warn', id: ev.id });
      events.push(ev);
    }
    events.sort(function (a, b) { return a.t - b.t; });
  }
  function pickWave(t) {
    for (var i = 0; i < prepared.length; i++) if (t >= prepared[i].from && t < prepared[i].to) return prepared[i];
    return prepared[prepared.length - 1];
  }

  // 시야 사각형을 48 단위 넓힌 테두리 위의 무작위 지점. 변 길이에 비례해 고른다.
  function borderPoint() {
    var v = LW.view, P = LW.player;
    var W = v.w / 2 + 48, H = v.h / 2 + 48;
    var t = LW.rand() * (4 * W + 4 * H), x, y;
    if (t < 2 * W) { x = -W + t; y = -H; }
    else if ((t -= 2 * W) < 2 * H) { x = W; y = -H + t; }
    else if ((t -= 2 * H) < 2 * W) { x = W - t; y = H; }
    else { t -= 2 * W; x = -W; y = H - t; }
    pt.x = P.x + x; pt.y = P.y + y;
  }

  // 재배치: 플레이어 이동 방향 쪽 테두리로 옮긴다
  sp.relocate = function (e) {
    var P = LW.player;
    borderPoint();
    var dot = (pt.x - P.x) * P.lastDx + (pt.y - P.y) * P.lastDy;
    if (dot < 0) { pt.x = 2 * P.x - pt.x; pt.y = 2 * P.y - pt.y; }
    e.x = pt.x; e.y = pt.y; e.kbX = 0; e.kbY = 0;
  };

  function spawnOne(w, minutes) {
    borderPoint();
    var id = w.ids[LW.weightedPick(w.ws, w.total)];
    return LW.enemies.spawnEnemy(id, pt.x, pt.y, minutes);
  }

  // 엘리트 한 마리를 시야 테두리에 만든다
  sp.spawnElite = function (defId) {
    borderPoint();
    var e = LW.enemies.spawnEnemy(defId, pt.x, pt.y, LW.game.time / 60);
    if (e) LW.enemies.makeElite(e);
    return e;
  };

  // 떼 이벤트: 시야 한쪽 가장자리에서 반대쪽으로, 진행 방향에 수직인 줄로 지나간다(까마귀)
  sp.spawnSwarm = function (n) {
    var v = LW.view, P = LW.player, d = (LW.rand() * 4) | 0;
    var dx = d === 0 ? 1 : (d === 1 ? -1 : 0), dy = d === 2 ? 1 : (d === 3 ? -1 : 0);
    var horiz = dx !== 0;
    var along = (horiz ? v.w : v.h) / 2 + 48, lateral = horiz ? v.h : v.w;
    var spacing = n > 1 ? Math.min(28, lateral * 0.9 / (n - 1)) : 0;
    var shift = (LW.rand() - 0.5) * 80;
    var minutes = LW.game.time / 60;
    for (var i = 0; i < n; i++) {
      var off = (i - (n - 1) / 2) * spacing + shift;
      var x = P.x - dx * along + (horiz ? 0 : off), y = P.y - dy * along + (horiz ? off : 0);
      var e = LW.enemies.spawnEnemy('crow', x, y, minutes);
      if (!e) break;
      e.special = true; e.ax = dx; e.ay = dy;
    }
  };

  // 포위 이벤트: 플레이어 중심의 타원 위에 진드기를 같은 간격으로 놓는다
  sp.spawnRing = function (n) {
    var v = LW.view, P = LW.player, minutes = LW.game.time / 60;
    var rx = v.w / 2 + 60, ry = v.h / 2 + 60;
    for (var i = 0; i < n; i++) {
      var a = i * TAU / n;
      var e = LW.enemies.spawnEnemy('mite', P.x + Math.cos(a) * rx, P.y + Math.sin(a) * ry, minutes);
      if (!e) break;
      e.special = true;
    }
  };

  sp.spawnBossAt = function (id) {
    borderPoint();
    return LW.enemies.spawnBoss(id, pt.x, pt.y);
  };

  function fire(ev) {
    var g = LW.game, k;
    sp.fired[ev.type] = (sp.fired[ev.type] || 0) + 1;
    switch (ev.type) {
      case 'elite': for (k = 0; k < ev.n; k++) sp.spawnElite(ev.enemy); break;
      case 'swarm': sp.spawnSwarm(ev.n); break;
      case 'ring': sp.spawnRing(ev.n); break;
      case 'warn':
        g.bannerText = '경고  ' + LW.ENEMIES[ev.id].name + '이(가) 다가온다';
        g.bannerT = BOSS_WARN;
        LW.audio.bossWarn();
        LW.audio.vibrate(200);
        break;
      case 'boss': sp.spawnBossAt(ev.id); break;
    }
  }

  // 시야 사각형을 64 단위 넓힌 안에 있는 적 수. 상한에 세는 일반 적 수는 normal에 담는다.
  var scan = { near: 0, normal: 0 };
  function count() {
    var v = LW.view, P = LW.player, items = LW.enemies.items, n = LW.enemies.n, c = 0, nm = 0;
    var hw = v.w / 2 + 64, hh = v.h / 2 + 64;
    for (var i = 0; i < n; i++) {
      var e = items[i];
      if (!e.active) continue;
      if (!e.special) nm++;
      var dx = e.x - P.x, dy = e.y - P.y;
      if (dx < hw && dx > -hw && dy < hh && dy > -hh) c++;
    }
    scan.near = c; scan.normal = nm;
  }

  // 시간 건너뛰기(자동 검사의 start, 디버그 T키): t보다 STALE초 넘게 지난 이벤트는 건너뛴다
  sp.skipTo = function (t) {
    while (sp.evIdx < events.length && events[sp.evIdx].t < t - STALE) sp.evIdx++;
  };

  sp.reset = function () {
    sp.acc = 0; sp.evIdx = 0; sp.fired = {}; sp.spawned = {};
    prepare();
  };

  sp.update = function (dt) {
    var g = LW.game, enemies = LW.enemies, cap = LW.ENEMY_CAP, perf = LW.perf;
    var minutes = g.time / 60;
    var w = pickWave(g.time), k;

    // 이벤트
    sp.skipTo(g.time);
    while (sp.evIdx < events.length && events[sp.evIdx].t <= g.time) fire(events[sp.evIdx++]);

    count();
    var normal = scan.normal;

    // 부하 측정용: 300마리를 빠르게 채워 유지한다
    if (LW.params.stress) {
      for (k = 0; k < 12 && normal < cap; k++) if (spawnOne(w, 0)) normal++;
      if (normal > perf.maxNormal) perf.maxNormal = normal;
      return;
    }

    if (normal < cap) {
      if (scan.near < w.minAlive) {
        var add = Math.ceil((w.minAlive - scan.near) / 2);
        for (k = 0; k < add && normal < cap; k++) if (spawnOne(w, minutes)) normal++;
      }
      sp.acc += w.rate * dt;
      while (sp.acc >= 1) {
        sp.acc -= 1;
        if (normal < cap && spawnOne(w, minutes)) normal++;
      }
    }
    if (normal > perf.maxNormal) perf.maxNormal = normal;
  };
})();
