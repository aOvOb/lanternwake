// 보석(경험치)과 맵 아이템 풀(상자, 촛대, 등잔 기름, 끌개 종, 정화의 빛)
(function () {
  var seq = 0;
  var gems = LW.gems = LW.makePool(LW.POOL.gems, function () {
    return { active: false, x: 0, y: 0, value: 0, homing: false, spd: 0, seq: 0, merged: false };
  });
  // 맵 아이템 풀. kind: 0 상자, 1 보스 상자, 2 촛대, 3 등잔 기름, 4 끌개 종, 5 정화의 빛
  // life는 남은 수명(초)이다. 0이면 사라지지 않는다(상자, 촛대).
  var pk = LW.pickups = LW.makePool(LW.POOL.pickups, function () {
    return { active: false, kind: 0, x: 0, y: 0, life: 0 };
  });
  var K = LW.PK = { CHEST: 0, BOSS_CHEST: 1, CANDLE: 2, OIL: 3, BELL: 4, LIGHT: 5 };
  var CANDLE_EVERY = 40, CANDLE_MAX = 3, ITEM_LIFE = 30, CANDLE_HIT_R = 10, CANDLE_FAR = 1000;
  var candleT = CANDLE_EVERY;

  // 상자를 떨어뜨린다. 풀이 가득 차면 바로 받는다.
  LW.dropChest = function (x, y, boss) {
    var it = pk.spawn();
    if (!it) { LW.game.giveChest(boss); return; }
    it.kind = boss ? K.BOSS_CHEST : K.CHEST; it.x = x; it.y = y; it.life = 0;
  };

  // 등잔 기름을 떨어뜨린다. force가 true(엘리트)이고 풀이 가득 차면 바로 HP를 회복한다.
  // 일반 적은 풀 끝 4칸을 촛대와 상자 몫으로 남겨 두고, 없으면 그냥 떨어뜨리지 않는다.
  LW.dropOil = function (x, y, force) {
    if (!force && pk.n >= pk.size - 4) return;
    var it = pk.spawn();
    if (!it) { if (force) LW.player.heal(30); return; }
    it.kind = K.OIL; it.x = x; it.y = y; it.life = ITEM_LIFE;
  };

  pk.nCandle = 0;     // 지금 있는 촛대 수(투사체마다 풀 전체를 훑지 않으려고 따로 센다)

  // 촛대를 만든다. near가 true면 가까이(자동 검사용), 아니면 플레이어에게서 300~600 떨어진 곳.
  // 동시에 최대 3개다.
  LW.spawnCandle = function (near) {
    if (pk.nCandle >= CANDLE_MAX) return null;
    var it = pk.spawn();
    if (!it) return null;
    var P = LW.player, a = LW.rand() * 6.2832;
    var d = near ? 150 + LW.rand() * 100 : 300 + LW.rand() * 300;
    it.kind = K.CANDLE; it.x = P.x + Math.cos(a) * d; it.y = P.y + Math.sin(a) * d; it.life = 0;
    pk.nCandle++;
    LW.game.mapStats.candleSpawned++;
    if (pk.nCandle > LW.game.mapStats.candleMax) LW.game.mapStats.candleMax = pk.nCandle;
    return it;
  };

  // 촛대가 부서진다: 등잔 기름 60%, 끌개 종 25%, 정화의 빛 15% 중 하나가 같은 자리에 나온다.
  function breakCandle(it) {
    var r = LW.rand();
    it.kind = r < 0.6 ? K.OIL : (r < 0.85 ? K.BELL : K.LIGHT);
    it.life = ITEM_LIFE;
    pk.nCandle--;
    LW.game.mapStats.candleBroken++;
    LW.effects.burst(it.x, it.y, 6, 0);
    LW.audio.candle();
  }

  // 아군 공격이 촛대에 닿았는지 확인한다(원). 닿으면 1회로 부서진다. LW.qbuf를 쓰지 않아 어디서든 부를 수 있다.
  LW.hitCandles = function (x, y, r) {
    if (pk.nCandle <= 0) return;
    var items = pk.items;
    for (var i = pk.n - 1; i >= 0; i--) {
      var it = items[i];
      if (it.kind !== K.CANDLE) continue;
      var dx = it.x - x, dy = it.y - y, rr = r + CANDLE_HIT_R;
      if (dx * dx + dy * dy <= rr * rr) breakCandle(it);
    }
  };

  // 부채꼴 또는 원형 베기(서리 낫). ux, uy는 휘두름 방향 단위 벡터 배열, cosHalf는 반각의 코사인
  LW.hitCandlesFan = function (x, y, range, ux, uy, n, cosHalf, circle) {
    if (pk.nCandle <= 0) return;
    var items = pk.items;
    for (var i = pk.n - 1; i >= 0; i--) {
      var it = items[i];
      if (it.kind !== K.CANDLE) continue;
      var dx = it.x - x, dy = it.y - y, rr = range + CANDLE_HIT_R, d2 = dx * dx + dy * dy;
      if (d2 > rr * rr) continue;
      var d = Math.sqrt(d2), vx = d > 0.01 ? dx / d : 0, vy = d > 0.01 ? dy / d : 0, inside = circle || d <= CANDLE_HIT_R;
      for (var k = 0; k < n && !inside; k++) if (vx * ux[k] + vy * uy[k] >= cosHalf) inside = true;
      if (inside) breakCandle(it);
    }
  };

  // 정화의 빛: 시야 안의 일반 적(엘리트와 보스 제외)을 모두 처치한다
  function purify() {
    var v = LW.view, P = LW.player, items = LW.enemies.items, n = LW.enemies.n, hw = v.w / 2, hh = v.h / 2, c = 0;
    for (var i = 0; i < n; i++) {
      var e = items[i];
      if (!e.active || e.elite || e.boss) continue;
      var dx = e.x - P.x, dy = e.y - P.y;
      if (dx < hw && dx > -hw && dy < hh && dy > -hh) { e.hp = 0; LW.killEnemy(e); c++; }
    }
    LW.game.flashT = 0.35;
    return c;
  }

  // 아이템을 받는다
  function take(it) {
    var g = LW.game, ms = g.mapStats;
    switch (it.kind) {
      case K.OIL: LW.player.heal(30); ms.oil++; g.toast('등잔 기름  HP +30'); break;
      case K.BELL: gems.attractAll(); ms.bell++; g.toast('끌개 종  보석이 모여든다'); break;
      case K.LIGHT: ms.purified += purify(); ms.light++; g.toast('정화의 빛'); break;
    }
    LW.audio.pickup();
  }

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
  pk.reset = function () { pk.clear(); pk.nCandle = 0; candleT = CANDLE_EVERY; };
  pk.update = function (dt) {
    gems.update(dt);
    var P = LW.player, items = pk.items;
    candleT -= dt;
    if (candleT <= 0) { candleT += CANDLE_EVERY; LW.spawnCandle(false); }
    for (var i = pk.n - 1; i >= 0; i--) {
      var it = items[i];
      var dx = P.x - it.x, dy = P.y - it.y, d2 = dx * dx + dy * dy;
      if (it.kind === K.CANDLE) {
        // 너무 멀어진 촛대는 없애서 새 촛대가 생길 자리를 낸다
        if (d2 > CANDLE_FAR * CANDLE_FAR) { pk.nCandle--; pk.remove(i); }
        continue;
      }
      if (it.life > 0) {
        it.life -= dt;
        if (it.life <= 0) { pk.remove(i); continue; }
      }
      var rr = P.r + (it.kind === K.BOSS_CHEST ? 18 : (it.kind === K.CHEST ? 13 : 12));
      if (d2 > rr * rr) continue;
      if (it.kind === K.CHEST || it.kind === K.BOSS_CHEST) LW.game.giveChest(it.kind === K.BOSS_CHEST);
      else take(it);
      pk.remove(i);
    }
  };
})();
