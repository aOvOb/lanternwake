// 보석(경험치)과 맵 아이템 풀. 맵 아이템은 S9에서 쓴다.
(function () {
  var seq = 0;
  var gems = LW.gems = LW.makePool(LW.POOL.gems, function () {
    return { active: false, x: 0, y: 0, value: 0, homing: false, spd: 0, seq: 0, merged: false };
  });
  // 맵 아이템. kind: 0 상자, 1 보스 상자 (S9에서 촛대와 아이템을 더한다)
  var pk = LW.pickups = LW.makePool(LW.POOL.pickups, function () {
    return { active: false, kind: 0, x: 0, y: 0 };
  });
  LW.PK = { CHEST: 0, BOSS_CHEST: 1 };

  // 상자를 떨어뜨린다. 풀이 가득 차면 바로 받는다.
  LW.dropChest = function (x, y, boss) {
    var it = pk.spawn();
    if (!it) { LW.game.giveChest(boss); return; }
    it.kind = boss ? LW.PK.BOSS_CHEST : LW.PK.CHEST; it.x = x; it.y = y;
  };

  // 보석을 떨어뜨린다. 풀이 가득 차면 가장 오래된 보석에 값을 더하고 빨강으로 표시한다.
  LW.spawnGem = function (x, y, value) {
    var gm = gems.spawn();
    if (!gm) {
      var items = gems.items, oldest = items[0];
      for (var i = 1; i < gems.n; i++) if (items[i].seq < oldest.seq) oldest = items[i];
      oldest.value += value;
      oldest.merged = true;
      return oldest;
    }
    gm.x = x; gm.y = y; gm.value = value; gm.homing = false; gm.spd = 0; gm.seq = ++seq; gm.merged = false;
    return gm;
  };

  // 끌개 종(S9)에서도 쓴다: 모든 보석이 즉시 날아온다
  gems.attractAll = function () {
    for (var i = 0; i < gems.n; i++) gems.items[i].homing = true;
  };

  gems.update = function (dt) {
    var P = LW.player, g = LW.game, items = gems.items;
    var mag2 = P.magnet * P.magnet, got2 = (P.r + 6) * (P.r + 6);
    for (var i = gems.n - 1; i >= 0; i--) {
      var gm = items[i];
      var dx = P.x - gm.x, dy = P.y - gm.y, d2 = dx * dx + dy * dy;
      if (!gm.homing && d2 <= mag2) { gm.homing = true; gm.spd = 200; }
      if (!gm.homing) continue;
      if (gm.spd < 200) gm.spd = 200;
      if (d2 <= got2) {
        g.addXp(gm.value);
        LW.audio.gem();
        gems.remove(i);
        continue;
      }
      gm.spd += 600 * dt;
      var d = Math.sqrt(d2), step = gm.spd * dt;
      if (step > d) step = d;
      gm.x += dx / d * step; gm.y += dy / d * step;
    }
  };

  gems.reset = function () { gems.clear(); seq = 0; };
  pk.reset = function () { pk.clear(); };
  pk.update = function (dt) {
    gems.update(dt);
    var P = LW.player, items = pk.items;
    for (var i = pk.n - 1; i >= 0; i--) {
      var it = items[i];
      var dx = P.x - it.x, dy = P.y - it.y, rr = P.r + (it.kind === LW.PK.BOSS_CHEST ? 18 : 13);
      if (dx * dx + dy * dy > rr * rr) continue;
      LW.game.giveChest(it.kind === LW.PK.BOSS_CHEST);
      pk.remove(i);
    }
  };
})();
