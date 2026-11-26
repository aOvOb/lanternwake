// 아군 투사체 풀. kind 0: 화살류(관통 수만큼 맞히고 사라짐), kind 1: 가시 원반(튕김, 재타격 간격)
(function () {
  function make() {
    return {
      active: false, kind: 0, slot: 0, x: 0, y: 0, vx: 0, vy: 0, dx: 0, dy: 0, r: 5,
      dmg: 0, pierce: 1, life: 0, hitIds: new Int32Array(16), hitN: 0, extra: 0,
      hitGap: 0, turn: 0, speed: 0, maxLife: 0
    };
  }
  var pool = LW.projectiles = LW.makePool(LW.POOL.projectiles, make);

  // 방향 (dx, dy)는 단위 벡터. extra에는 넉백 값을 넣는다.
  pool.fire = function (slot, x, y, dx, dy, speed, r, dmg, pierce, life, kb) {
    var p = pool.spawn();
    if (!p) return null;
    p.kind = 0; p.slot = slot; p.x = x; p.y = y;
    p.dx = dx; p.dy = dy; p.vx = dx * speed; p.vy = dy * speed; p.speed = speed;
    p.r = r; p.dmg = dmg; p.pierce = pierce; p.life = life; p.maxLife = life;
    p.hitN = 0; p.extra = kb; p.hitGap = 0; p.turn = 0;
    return p;
  };

  // 가시 원반: 관통 무한, 같은 적은 hitGap초에 한 번만 맞는다. turn은 초당 회전각(칼날 폭풍)
  pool.fireDisc = function (slot, x, y, dx, dy, speed, r, dmg, life, kb, hitGap, turn) {
    var p = pool.fire(slot, x, y, dx, dy, speed, r, dmg, 1, life, kb);
    if (!p) return null;
    p.kind = 1; p.hitGap = hitGap; p.turn = turn;
    return p;
  };

  // 원반 방향을 가장 가까운 적 쪽으로 turn 만큼 튼다
  function steer(p, dt) {
    var idx = LW.grid.nearest(p.x, p.y);
    if (idx < 0) return;
    var e = LW.enemies.items[idx];
    var tx = e.x - p.x, ty = e.y - p.y, d = Math.sqrt(tx * tx + ty * ty);
    if (d < 0.01) return;
    tx /= d; ty /= d;
    var cross = p.dx * ty - p.dy * tx, dot = p.dx * tx + p.dy * ty;
    var ang = Math.atan2(cross, dot), maxA = p.turn * dt;
    if (ang > maxA) ang = maxA; else if (ang < -maxA) ang = -maxA;
    var c = Math.cos(ang), s = Math.sin(ang);
    var nx = p.dx * c - p.dy * s, ny = p.dx * s + p.dy * c;
    p.dx = nx; p.dy = ny; p.vx = nx * p.speed; p.vy = ny * p.speed;
  }

  pool.update = function (dt) {
    var items = pool.items, grid = LW.grid, buf = LW.qbuf, enemies = LW.enemies.items;
    var maxR = LW.MAX_ENEMY_R, time = LW.game.time, v = LW.view, cam = LW.render.cam;
    for (var i = pool.n - 1; i >= 0; i--) {
      var p = items[i];
      if (p.kind === 1) {
        if (p.turn > 0) steer(p, dt);
        // 시야 가장자리에서 튕긴다
        var lx = cam.x - v.w / 2 + p.r, rx = cam.x + v.w / 2 - p.r;
        var ty2 = cam.y - v.h / 2 + p.r, by = cam.y + v.h / 2 - p.r;
        if (p.x < lx && p.vx < 0 || p.x > rx && p.vx > 0) { p.vx = -p.vx; p.dx = -p.dx; }
        if (p.y < ty2 && p.vy < 0 || p.y > by && p.vy > 0) { p.vy = -p.vy; p.dy = -p.dy; }
      }
      p.x += p.vx * dt; p.y += p.vy * dt;
      p.life -= dt;
      if (p.life <= 0) { pool.remove(i); continue; }

      var m = grid.queryRadius(p.x, p.y, p.r + maxR, buf);
      for (var k = 0; k < m; k++) {
        var e = enemies[buf[k]];
        if (!e.active) continue;
        var dx = e.x - p.x, dy = e.y - p.y, rr = p.r + e.r;
        if (dx * dx + dy * dy > rr * rr) continue;
        if (p.kind === 1) {
          if (e.hitCd[p.slot] > time) continue;
          e.hitCd[p.slot] = time + p.hitGap;
          LW.dealDamage(e, p.dmg, p.slot, p.dx, p.dy, p.extra);
          continue;
        }
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
