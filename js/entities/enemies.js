// 적 풀과 갱신(AI, 넉백, 밀어내기, 재배치)
(function () {
  var uidSeq = 0;

  function make() {
    return {
      active: false, uid: 0, def: null, x: 0, y: 0, vx: 0, vy: 0, r: 8,
      hp: 1, maxHp: 1, speed: 0, dmg: 0, xp: 0, elite: false, boss: false,
      kbRes: 0, kbX: 0, kbY: 0, slowT: 0, slowMul: 1, freezeT: 0, flashT: 0,
      aiState: 0, aiT: 0, hitCd: new Float32Array(6)
    };
  }
  var pool = LW.enemies = LW.makePool(LW.POOL.enemies, make);

  // minutes: 경과 분. 시간 보정은 스폰할 때 한 번만 적용한다
  pool.spawnEnemy = function (defId, x, y, minutes) {
    var e = pool.spawn();
    if (!e) return null;
    var d = LW.ENEMIES[defId];
    e.def = d; e.uid = ++uidSeq;
    e.x = x; e.y = y; e.vx = 0; e.vy = 0; e.r = d.r;
    e.maxHp = d.hp * (1 + 0.15 * minutes);
    e.hp = e.maxHp;
    e.speed = d.speed;
    e.dmg = d.dmg * (1 + 0.05 * minutes);
    e.xp = d.xp;
    e.elite = false; e.boss = false;
    e.kbRes = d.kbRes; e.kbX = 0; e.kbY = 0;
    e.slowT = 0; e.slowMul = 1; e.freezeT = 0; e.flashT = 0;
    e.aiState = 0; e.aiT = 0;
    e.hitCd.fill(0);
    return e;
  };

  pool.update = function (dt) {
    var items = pool.items, n = pool.n, P = LW.player, v = LW.view, grid = LW.grid;
    var KB = LW.KB_SCALE;
    var kbDecay = Math.max(0, 1 - 10 * dt);
    var far = Math.max(v.w, v.h) / 2 + 400, far2 = far * far;
    var i;

    // 1) 이동, 넉백, 타이머
    for (i = 0; i < n; i++) {
      var e = items[i];
      if (!e.active) continue;
      if (e.flashT > 0) e.flashT -= dt;
      if (e.slowT > 0) { e.slowT -= dt; if (e.slowT <= 0) e.slowMul = 1; }
      var dx = P.x - e.x, dy = P.y - e.y;
      var d = Math.sqrt(dx * dx + dy * dy);
      if (e.freezeT > 0) {
        e.freezeT -= dt;
        e.vx = 0; e.vy = 0;
      } else if (d > 0.01) {
        // 행동은 S8에서 종류별로 늘린다. 지금은 추적만 한다.
        var sp = e.speed * e.slowMul;
        e.vx = dx / d * sp; e.vy = dy / d * sp;
      }
      e.x += (e.vx + e.kbX * KB) * dt;
      e.y += (e.vy + e.kbY * KB) * dt;
      e.kbX *= kbDecay; e.kbY *= kbDecay;
    }

    // 2) 밀어내기: 시야 안의 적만, 이웃 최대 8
    var left = P.x - v.w / 2 - 32, right = P.x + v.w / 2 + 32;
    var top = P.y - v.h / 2 - 32, bottom = P.y + v.h / 2 + 32;
    var cols = grid.cols, rows = grid.rows, start = grid.start, order = grid.order;
    for (i = 0; i < n; i++) {
      var a = items[i];
      if (!a.active || a.boss) continue;
      if (a.x < left || a.x > right || a.y < top || a.y > bottom) continue;
      var fx = Math.floor((a.x - grid.ox) / LW.CELL), fy = Math.floor((a.y - grid.oy) / LW.CELL);
      if (fx < 0 || fy < 0 || fx >= cols || fy >= rows) continue;
      var cnt = 0;
      for (var cy = fy - 1; cy <= fy + 1 && cnt < 8; cy++) {
        if (cy < 0 || cy >= rows) continue;
        for (var cx = fx - 1; cx <= fx + 1 && cnt < 8; cx++) {
          if (cx < 0 || cx >= cols) continue;
          var c = cy * cols + cx;
          for (var k = start[c], end = start[c + 1]; k < end && cnt < 8; k++) {
            var j = order[k];
            if (j === i) continue;
            var o = items[j];
            if (!o.active) continue;
            var ex = a.x - o.x, ey = a.y - o.y, rr = a.r + o.r;
            var d2 = ex * ex + ey * ey;
            if (d2 >= rr * rr) continue;
            cnt++;
            var dd = Math.sqrt(d2);
            if (dd < 0.001) { ex = i < j ? 0.01 : -0.01; ey = 0; dd = 0.01; }
            var push = (rr - dd) * 0.35 / dd;
            a.x += ex * push; a.y += ey * push;
          }
        }
      }
    }

    // 3) 재배치: 너무 멀어지면 처치 처리 없이 플레이어 이동 방향 쪽 테두리로 옮긴다
    for (i = 0; i < n; i++) {
      var f = items[i];
      if (!f.active || f.boss) continue;
      var rx = f.x - P.x, ry = f.y - P.y;
      if (rx * rx + ry * ry > far2) LW.spawner.relocate(f);
    }
  };

  pool.reset = function () { pool.clear(); };
})();
