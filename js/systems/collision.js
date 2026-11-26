// 충돌: 적 접촉(접촉 중인 적 가운데 피해가 가장 큰 1마리만 적용). 적 탄은 S8에서 추가한다.
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
    }
  };
})();
