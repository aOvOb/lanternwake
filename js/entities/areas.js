// 장판, 폭발, 예고, 번개 연출 풀. 종류마다 갱신이 다르다.
(function () {
  // 종류: 독 장판, 폭발 연출, 낫 휘두름 연출, 낙뢰 연출, 날아가는 항아리, 씨앗, 적 예고 원, 연쇄 번개 선
  var K = LW.AREA = { POISON: 1, BLAST: 2, SWING: 3, BOLT: 4, FLASK: 5, SEED: 6, TELE: 7, CHAIN: 8 };

  function make() {
    return {
      active: false, kind: 0, slot: 0, x: 0, y: 0, r: 0, dmg: 0, life: 0, maxLife: 0, tick: 0, tickT: 0, extra: 0,
      sx: 0, sy: 0, ang: 0, flag: 0
    };
  }
  var pool = LW.areas = LW.makePool(LW.POOL.areas, make);

  // 새 장판. 나머지 필드는 호출한 쪽에서 채운다.
  pool.add = function (kind, slot, x, y, r, dmg, life) {
    var a = pool.spawn();
    if (!a) return null;
    a.kind = kind; a.slot = slot; a.x = x; a.y = y; a.r = r; a.dmg = dmg;
    a.life = a.maxLife = life;
    a.tick = 0; a.tickT = 0; a.extra = 0; a.sx = 0; a.sy = 0; a.ang = 0; a.flag = 0;
    return a;
  };

  // 폭발 연출. theme: 0 주황, 1 연두, 2 빨강
  pool.blast = function (x, y, r, theme) {
    var a = pool.add(K.BLAST, 0, x, y, r, 0, 0.25);
    if (a) a.flag = theme;
    return a;
  };

  function explodeSeed(a) {
    LW.damageCircle(a.x, a.y, a.r, a.dmg, a.slot, a.extra);
    pool.blast(a.x, a.y, a.r, 1);
    LW.effects.burst(a.x, a.y, 4, 1);
    // 폭화 정원: 폭발마다 주변 3곳에 작은 폭발(tick 개수, sx 반경, sy 피해 배율)
    for (var i = 0; i < a.tick; i++) {
      var ang = LW.rand() * 6.2832, d = a.r * (0.5 + LW.rand() * 0.6);
      var mx = a.x + Math.cos(ang) * d, my = a.y + Math.sin(ang) * d;
      LW.damageCircle(mx, my, a.sx, a.dmg * a.sy, a.slot, a.extra * 0.5);
      pool.blast(mx, my, a.sx, 1);
    }
  }

  // 독 장판 안의 적을 중심으로 끌어당긴다(탐식의 늪). 보스는 제외
  function pull(a, dt) {
    var buf = LW.qbuf, items = LW.enemies.items;
    var m = LW.grid.queryRadius(a.x, a.y, a.r, buf);
    var step = 60 * dt;
    for (var k = 0; k < m; k++) {
      var e = items[buf[k]];
      if (!e.active || e.boss) continue;
      var dx = a.x - e.x, dy = a.y - e.y, d = Math.sqrt(dx * dx + dy * dy);
      if (d < 0.5) continue;
      var s = step < d ? step : d;
      e.x += dx / d * s; e.y += dy / d * s;
    }
  }

  pool.update = function (dt) {
    var items = pool.items, P = LW.player;
    for (var i = pool.n - 1; i >= 0; i--) {
      var a = items[i];
      a.life -= dt;
      switch (a.kind) {
        case K.POISON:
          a.tickT -= dt;
          if (a.tickT <= 0 && a.life > 0) {
            a.tickT += 0.5;
            LW.damageCircle(a.x, a.y, a.r, a.dmg, a.slot, 0);
          }
          if (a.flag === 1 && a.life > 0) pull(a, dt);
          break;
        case K.SEED:
          a.tickT += dt;
          if (a.life > 0 && a.tickT >= 0.5 && LW.enemyNear(a.x, a.y, 24)) a.life = 0;
          break;
      }
      if (a.life > 0) continue;
      // 끝날 때의 처리
      if (a.kind === K.FLASK) {
        var p = pool.add(K.POISON, a.slot, a.x, a.y, a.r, a.dmg, a.extra);
        if (p) { p.flag = a.flag; p.tickT = 0.1; }
      } else if (a.kind === K.SEED) {
        explodeSeed(a);
      } else if (a.kind === K.TELE) {
        // 예고가 끝나면 터진다. 플레이어가 원 안에 있으면 피해
        var dx = P.x - a.x, dy = P.y - a.y, rr = a.r + P.r * 0.5;
        if (dx * dx + dy * dy <= rr * rr && P.invuln <= 0 && !LW.game.god) P.hurt(a.dmg);
        pool.blast(a.x, a.y, a.r, 2);
      }
      pool.remove(i);
    }
  };

  pool.reset = function () { pool.clear(); };
})();
