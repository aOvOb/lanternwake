// 충돌: 적 접촉(접촉 중인 적 가운데 피해가 가장 큰 1마리만 적용)과 적 탄
(function () {
  LW.collision = {
    update: function (dt) {
      var P = LW.player, g = LW.game, buf = LW.qbuf, items = LW.enemies.items;
      var m = LW.grid.queryRadius(P.x, P.y, P.r + LW.MAX_ENEMY_R, buf);
      var best = 0;
      for (var k = 0; k < m; k++) {
        var e = items[buf[k]];
        if (!e.active) continue;
        var dx = e.x - P.x, dy = e.y - P.y, rr = P.r + e.r;
        if (dx * dx + dy * dy <= rr * rr && e.dmg > best) best = e.dmg;
      }
      if (best > 0 && P.invuln <= 0 && !g.god) P.hurt(best);

      // 적 탄: 이동, 수명, 플레이어 피격
      var bp = LW.ebullets, bi = bp.items;
      for (var i = bp.n - 1; i >= 0; i--) {
        var b = bi[i];
        b.x += b.vx * dt; b.y += b.vy * dt;
        b.life -= dt;
        if (b.life <= 0) { bp.remove(i); continue; }
        var bx = P.x - b.x, by = P.y - b.y, rr = P.r + b.r;
        if (bx * bx + by * by <= rr * rr) {
          if (P.invuln <= 0 && !g.god) P.hurt(b.dmg);
          bp.remove(i);   // 무적 중에 맞아도 탄은 사라진다
        }
      }
    }
  };
})();
