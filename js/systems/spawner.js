// 스폰. S2에서는 첫 구간 표를 쓰고, 시간대별 표는 S8에서 늘린다.
(function () {
  var sp = LW.spawner = { acc: 0 };
  var pt = { x: 0, y: 0 };
  var prepared = null;

  // 구간마다 종류와 가중치를 배열로 미리 만든다
  function prepare() {
    prepared = [];
    for (var i = 0; i < LW.WAVES.length; i++) {
      var w = LW.WAVES[i], ids = [], ws = [], total = 0;
      for (var k in w.weights) { ids.push(k); ws.push(w.weights[k]); total += w.weights[k]; }
      prepared.push({ from: w.from, to: w.to, ids: ids, ws: ws, total: total, rate: w.rate, minAlive: w.minAlive });
    }
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

  // 엘리트 한 마리를 시야 테두리에 만든다
  sp.spawnElite = function (defId) {
    borderPoint();
    var e = LW.enemies.spawnEnemy(defId, pt.x, pt.y, LW.game.time / 60);
    if (e) LW.enemies.makeElite(e);
    return e;
  };

  function spawnOne(w, minutes) {
    borderPoint();
    var id = w.ids[LW.weightedPick(w.ws, w.total)];
    LW.enemies.spawnEnemy(id, pt.x, pt.y, minutes);
  }

  // 시야 사각형을 64 단위 넓힌 안에 있는 적 수
  function countNear() {
    var v = LW.view, P = LW.player, items = LW.enemies.items, n = LW.enemies.n, c = 0;
    var hw = v.w / 2 + 64, hh = v.h / 2 + 64;
    for (var i = 0; i < n; i++) {
      var e = items[i];
      if (!e.active) continue;
      var dx = e.x - P.x, dy = e.y - P.y;
      if (dx < hw && dx > -hw && dy < hh && dy > -hh) c++;
    }
    return c;
  }

  sp.reset = function () { sp.acc = 0; prepare(); };

  sp.update = function (dt) {
    var g = LW.game, enemies = LW.enemies, cap = LW.ENEMY_CAP;
    var minutes = g.time / 60;
    var w = pickWave(g.time), k;

    // 부하 측정용: 300마리를 빠르게 채워 유지한다
    if (LW.params.stress) {
      for (k = 0; k < 12 && enemies.n < cap; k++) spawnOne(w, 0);
      return;
    }

    if (enemies.n >= cap) return;
    var near = countNear();
    if (near < w.minAlive) {
      var add = Math.ceil((w.minAlive - near) / 2);
      for (k = 0; k < add && enemies.n < cap; k++) spawnOne(w, minutes);
    }
    sp.acc += w.rate * dt;
    while (sp.acc >= 1) {
      sp.acc -= 1;
      if (enemies.n < cap) spawnOne(w, minutes);
    }
  };
})();
