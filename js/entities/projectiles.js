// 아군 투사체 풀
(function () {
  function make() {
    return {
      active: false, kind: 0, slot: 0, x: 0, y: 0, vx: 0, vy: 0, dx: 0, dy: 0, r: 5,
      dmg: 0, pierce: 1, life: 0, hitIds: new Int32Array(16), hitN: 0, extra: 0
    };
  }
  var pool = LW.projectiles = LW.makePool(LW.POOL.projectiles, make);

  // 방향 (dx, dy)는 단위 벡터. extra에는 넉백 값을 넣는다.
  pool.fire = function (slot, x, y, dx, dy, speed, r, dmg, pierce, life, kb) {
    var p = pool.spawn();
    if (!p) return null;
    p.kind = 0; p.slot = slot; p.x = x; p.y = y;
    p.dx = dx; p.dy = dy; p.vx = dx * speed; p.vy = dy * speed;
    p.r = r; p.dmg = dmg; p.pierce = pierce; p.life = life;
    p.hitN = 0; p.extra = kb;
    return p;
  };

  pool.update = function (dt) {
    var items = pool.items, grid = LW.grid, buf = LW.qbuf, enemies = LW.enemies.items;
    var maxR = LW.MAX_ENEMY_R;
    for (var i = pool.n - 1; i >= 0; i--) {
      var p = items[i];
      p.x += p.vx * dt; p.y += p.vy * dt;
      p.life -= dt;
      if (p.life <= 0) { pool.remove(i); continue; }

      var m = grid.queryRadius(p.x, p.y, p.r + maxR, buf);
      for (var k = 0; k < m; k++) {
        var e = enemies[buf[k]];
        if (!e.active) continue;
        var dx = e.x - p.x, dy = e.y - p.y, rr = p.r + e.r;
        if (dx * dx + dy * dy > rr * rr) continue;
        var seen = false;
        for (var h = 0; h < p.hitN; h++) if (p.hitIds[h] === e.uid) { seen = true; break; }
        if (seen) continue;
        if (p.hitN < 16) p.hitIds[p.hitN++] = e.uid;
        LW.dealDamage(e, p.dmg, p.slot, p.dx, p.dy, p.extra);
        if (--p.pierce <= 0) { pool.remove(i); break; }
      }
    }
  };

  pool.reset = function () { pool.clear(); };
})();
