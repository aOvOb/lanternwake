// 무기별 update와 공통 피해 함수
// 수치는 LW.weaponLevel(w)가 돌려주는 표 값(진화하면 진화 표 값)에 플레이어 배율을 곱해 쓴다.
(function () {
  var TAU = Math.PI * 2;
  var cand = new Int32Array(LW.POOL.enemies);

  // 무기 인스턴스를 만든다. 슬롯 번호는 보유 순서다.
  LW.makeWeapon = function (id, slot) {
    return {
      def: LW.WEAPON_BY_ID[id], lv: 1, slot: slot, cdT: 0.2, burstLeft: 0, burstT: 0,
      evolved: false, evo: null,
      ang: 0, on: false, stT: 0.2, tickT: 0.2, volley: 0, regenT: 0, pulse: 0, curR: 0,
      px: new Float32Array(8), py: new Float32Array(8), pn: 0
    };
  };
  LW.weaponLevel = function (w) { return w.evo ? w.evo.L : w.def.levels[w.lv - 1]; };
  LW.weaponName = function (w) { return w.evo ? w.evo.name : w.def.name; };
  LW.weaponColor = function (w) { return w.evo ? w.evo.color : w.def.color; };

  // 반경 r 안의 모든 적에게 피해. 중심에서 바깥 방향으로 넉백. 맞힌 수를 돌려준다.
  LW.damageCircle = function (x, y, r, dmg, slot, kb) {
    var buf = LW.qbuf, items = LW.enemies.items, hit = 0;
    LW.hitCandles(x, y, r);      // 촛대도 같은 범위에 닿으면 부서진다(qbuf를 쓰지 않는다)
    var m = LW.grid.queryRadius(x, y, r + LW.MAX_ENEMY_R, buf);
    for (var k = 0; k < m; k++) {
      var e = items[buf[k]];
      if (!e.active) continue;
      var dx = e.x - x, dy = e.y - y, rr = r + e.r;
      var d2 = dx * dx + dy * dy;
      if (d2 > rr * rr) continue;
      var d = Math.sqrt(d2);
      LW.dealDamage(e, dmg, slot, d > 0.01 ? dx / d : 0, d > 0.01 ? dy / d : 0, kb);
      hit++;
    }
    return hit;
  };

  // 반경 r 안(적 반경 포함)에 적이 있는지
  LW.enemyNear = function (x, y, r) {
    var buf = LW.qbuf, items = LW.enemies.items;
    var m = LW.grid.queryRadius(x, y, r + LW.MAX_ENEMY_R, buf);
    for (var k = 0; k < m; k++) {
      var e = items[buf[k]];
      if (!e.active) continue;
      var dx = e.x - x, dy = e.y - y, rr = r + e.r;
      if (dx * dx + dy * dy <= rr * rr) return true;
    }
    return false;
  };

  // 종류별 동작. 새 무기는 여기에 항목을 더한다.
  var B = LW.WEAPON_BEHAVIORS = {};

  // 쿨다운 배율 적용
  function cdOf(L) { return L.cd * Math.max(0.4, LW.player.stats.cooldown); }

  // W1 불씨 화살: 가장 가까운 적에게 쏜다. 적이 없으면 마지막 이동 방향. 여러 발은 연사.
  function aim(out) {
    var P = LW.player;
    var idx = LW.grid.nearest(P.x, P.y);
    out.x = P.lastDx; out.y = P.lastDy;
    if (idx >= 0) {
      var e = LW.enemies.items[idx];
      var ex = e.x - P.x, ey = e.y - P.y, d = Math.sqrt(ex * ex + ey * ey);
      if (d > 0.01) { out.x = ex / d; out.y = ey / d; }
    }
  }
  var dir = { x: 0, y: 0 };
  function fireDart(w, L) {
    var P = LW.player, b = w.def.base, S = P.stats;
    aim(dir);
    LW.projectiles.fire(w.slot, P.x, P.y, dir.x, dir.y, (L.speed || b.speed) * S.projSpeed, L.r || b.r,
      L.dmg * S.might, L.pierce, b.life, b.kb);
  }
  B.dart = {
    update: function (w, dt) {
      var L = LW.weaponLevel(w), S = LW.player.stats, P = LW.player;
      w.cdT -= dt;
      if (w.burstLeft <= 0 && w.cdT <= 0) {
        w.burstLeft = L.n + S.amount;
        w.burstT = 0;
        w.cdT += cdOf(L);
        w.volley++;
        // 태양창 연사: 일정 연사마다 8방향 원형 탄 추가
        if (L.ring && w.volley % L.ring === 0) {
          for (var i = 0; i < 8; i++) {
            var a = i * TAU / 8;
            LW.projectiles.fire(w.slot, P.x, P.y, Math.cos(a), Math.sin(a), (L.speed || w.def.base.speed) * S.projSpeed,
              L.r || w.def.base.r, L.dmg * S.might, 1, w.def.base.life, w.def.base.kb);
          }
        }
      }
      if (w.burstLeft > 0) {
        var iv = L.interval || w.def.base.interval;
        w.burstT -= dt;
        while (w.burstLeft > 0 && w.burstT <= 0) {
          fireDart(w, L);
          w.burstLeft--;
          w.burstT += iv;
        }
      }
    }
  };

  // W2 등롱 궤도: 지속 시간 동안 켜졌다가 쿨다운 동안 꺼진다. 같은 적은 hitGap초에 한 번만 맞는다.
  B.orbit = {
    update: function (w, dt) {
      var L = LW.weaponLevel(w), S = LW.player.stats, P = LW.player, b = w.def.base;
      if (L.always) w.on = true;
      else {
        w.stT -= dt;
        if (w.stT <= 0) {
          if (w.on) { w.on = false; w.stT = cdOf(L); }
          else { w.on = true; w.stT = L.dur * S.duration; }
        }
      }
      if (!w.on) { w.pn = 0; return; }
      w.ang += b.spin * dt;
      var n = Math.min(8, L.n + S.amount);
      var R = (L.orbitR || b.orbitR) * S.area, rad = b.r * S.area;
      var gap = L.hitGap || b.hitGap, time = LW.game.time, dmg = L.dmg * S.might;
      var buf = LW.qbuf, items = LW.enemies.items, grid = LW.grid;
      w.pn = n; w.curR = R;
      for (var i = 0; i < n; i++) {
        var a = w.ang + i * TAU / n;
        var x = P.x + Math.cos(a) * R, y = P.y + Math.sin(a) * R;
        w.px[i] = x; w.py[i] = y;
        LW.hitCandles(x, y, rad);
        var m = grid.queryRadius(x, y, rad + LW.MAX_ENEMY_R, buf);
        for (var k = 0; k < m; k++) {
          var e = items[buf[k]];
          if (!e.active || e.hitCd[w.slot] > time) continue;
          var dx = e.x - x, dy = e.y - y, rr = rad + e.r;
          var d2 = dx * dx + dy * dy;
          if (d2 > rr * rr) continue;
          e.hitCd[w.slot] = time + gap;
          var d = Math.sqrt(d2);
          LW.dealDamage(e, dmg, w.slot, d > 0.01 ? dx / d : 0, d > 0.01 ? dy / d : 0, b.kb);
        }
      }
    }
  };

  // W3 재의 원: 항상 켜져 있는 오라. 틱마다 반경 안의 적 전부에게 피해
  B.halo = {
    update: function (w, dt) {
      var L = LW.weaponLevel(w), S = LW.player.stats, P = LW.player;
      var R = L.r * S.area;
      w.curR = R;
      if (w.pulse > 0) w.pulse -= dt;
      w.tickT -= dt;
      if (w.tickT <= 0) {
        w.tickT += L.tick;
        w.pulse = 0.12;
        LW.hitCandles(P.x, P.y, R);
        var buf = LW.qbuf, items = LW.enemies.items, cnt = 0, dmg = L.dmg * S.might;
        var m = LW.grid.queryRadius(P.x, P.y, R + LW.MAX_ENEMY_R, buf);
        for (var k = 0; k < m; k++) {
          var e = items[buf[k]];
          if (!e.active) continue;
          var dx = e.x - P.x, dy = e.y - P.y, rr = R + e.r;
          var d2 = dx * dx + dy * dy;
          if (d2 > rr * rr) continue;
          var d = Math.sqrt(d2);
          LW.dealDamage(e, dmg, w.slot, d > 0.01 ? dx / d : 0, d > 0.01 ? dy / d : 0, w.def.base.kb);
          cnt++;
          // 정화의 성역: 범위 안 적 감속
          if (L.slow && e.active) { e.slowT = L.tick + 0.1; e.slowMul = 1 - L.slow; }
        }
        if (L.regen && cnt > 0) w.regenT = L.tick + 0.1;
      }
      if (w.regenT > 0) {
        w.regenT -= dt;
        if (P.hp < P.maxHp) P.hp = Math.min(P.maxHp, P.hp + L.regen * dt);
      }
    }
  };

  // W4 서리 낫: 마지막 이동 방향 중심 140도 부채꼴. 휘두름 수만큼 같은 간격으로 나눠 동시에 벤다.
  B.scythe = {
    update: function (w, dt) {
      var L = LW.weaponLevel(w), S = LW.player.stats, P = LW.player, b = w.def.base;
      w.cdT -= dt;
      if (w.cdT > 0) return;
      w.cdT += cdOf(L);
      var n = Math.min(4, L.n + S.amount), circle = !!L.circle;
      var range = L.range * S.area, dmg = L.dmg * S.might;
      var base = Math.atan2(P.lastDy, P.lastDx), i;
      var cosHalf = Math.cos(b.arc * Math.PI / 360);
      for (i = 0; i < n; i++) {
        var a = base + i * TAU / n;
        w.px[i] = Math.cos(a); w.py[i] = Math.sin(a);
        var ar = LW.areas.add(LW.AREA.SWING, w.slot, P.x, P.y, range, 0, b.anim);
        if (ar) { ar.ang = a; ar.flag = circle ? 1 : 0; }
        if (circle) break;
      }
      LW.hitCandlesFan(P.x, P.y, range, w.px, w.py, circle ? 1 : n, cosHalf, circle);
      var buf = LW.qbuf, items = LW.enemies.items;
      var m = LW.grid.queryRadius(P.x, P.y, range + LW.MAX_ENEMY_R, buf);
      for (var k = 0; k < m; k++) {
        var e = items[buf[k]];
        if (!e.active) continue;
        var dx = e.x - P.x, dy = e.y - P.y, rr = range + e.r;
        var d2 = dx * dx + dy * dy;
        if (d2 > rr * rr) continue;
        var d = Math.sqrt(d2), ux = d > 0.01 ? dx / d : 0, uy = d > 0.01 ? dy / d : 0;
        var inside = circle;
        for (i = 0; i < n && !inside; i++) if (ux * w.px[i] + uy * w.py[i] >= cosHalf) inside = true;
        if (!inside && d > e.r) continue;
        LW.dealDamage(e, dmg, w.slot, ux, uy, b.kb);
        if (L.freeze && !e.boss && e.active) e.freezeT = L.freeze * (e.elite ? 0.5 : 1);
      }
    }
  };

  // W5 번개 종: 시야 안의 서로 다른 적을 무작위로 골라 낙뢰
  B.bell = {
    update: function (w, dt) {
      var L = LW.weaponLevel(w), S = LW.player.stats, P = LW.player, v = LW.view;
      w.cdT -= dt;
      if (w.cdT > 0) return;
      w.cdT += cdOf(L);
      var items = LW.enemies.items, n = LW.enemies.n, c = 0, i;
      var hw = v.w / 2, hh = v.h / 2;
      for (i = 0; i < n; i++) {
        var e = items[i];
        if (!e.active) continue;
        var dx = e.x - P.x, dy = e.y - P.y;
        if (dx < hw && dx > -hw && dy < hh && dy > -hh) cand[c++] = i;
      }
      var strikes = Math.min(c, L.n + S.amount);
      var r = L.r * S.area, dmg = L.dmg * S.might, kb = w.def.base.kb;
      for (i = 0; i < strikes; i++) {
        var j = i + ((LW.rand() * (c - i)) | 0);
        var t = cand[i]; cand[i] = cand[j]; cand[j] = t;
        var tg = items[cand[i]];
        if (!tg.active) continue;
        var x = tg.x, y = tg.y;
        LW.damageCircle(x, y, r, dmg, w.slot, kb);
        LW.areas.add(LW.AREA.BOLT, w.slot, x, y, r, 0, 0.25);
        if (L.chain) chain(w, L, x, y, r, dmg);
      }
    }
  };

  // 폭풍 종탑: 맞은 지점에서 chainR 안의 가장 가까운 적 chain마리에게 연쇄
  function chain(w, L, x, y, r, dmg) {
    var buf = LW.qbuf, items = LW.enemies.items;
    var m = LW.grid.queryRadius(x, y, L.chainR, buf);
    var b1 = -1, b2 = -1, d1 = 1e12, d2v = 1e12;
    for (var k = 0; k < m; k++) {
      var e = items[buf[k]];
      if (!e.active) continue;
      var dx = e.x - x, dy = e.y - y, d2 = dx * dx + dy * dy, rr = r + e.r;
      if (d2 <= rr * rr) continue;       // 낙뢰에 이미 맞은 적은 제외
      if (d2 < d1) { b2 = b1; d2v = d1; b1 = buf[k]; d1 = d2; }
      else if (d2 < d2v) { b2 = buf[k]; d2v = d2; }
    }
    for (var i = 0; i < L.chain && i < 2; i++) {
      var pi = i === 0 ? b1 : b2;
      if (pi < 0) continue;
      var t = items[pi];
      if (!t.active) continue;
      var a = LW.areas.add(LW.AREA.CHAIN, w.slot, t.x, t.y, 0, 0, 0.2);
      if (a) { a.sx = x; a.sy = y; }
      LW.dealDamage(t, dmg * L.chainMul, w.slot, 0, 0, 0);
    }
  }

  // W6 가시 원반: 무작위 방향으로 던진다
  B.disc = {
    update: function (w, dt) {
      var L = LW.weaponLevel(w), S = LW.player.stats, P = LW.player, b = w.def.base;
      w.cdT -= dt;
      if (w.cdT > 0) return;
      w.cdT += cdOf(L);
      var n = L.n + S.amount;
      for (var i = 0; i < n; i++) {
        var a = LW.rand() * TAU;
        LW.projectiles.fireDisc(w.slot, P.x, P.y, Math.cos(a), Math.sin(a), L.speed * S.projSpeed,
          (L.r || b.r) * S.area, L.dmg * S.might, L.dur * S.duration, b.kb, b.hitGap, L.turn || 0);
      }
    }
  };

  // W7 늪안개 항아리: 300 단위 안의 무작위 적 위치로 던진다. 없으면 무작위 지점
  B.flask = {
    update: function (w, dt) {
      var L = LW.weaponLevel(w), S = LW.player.stats, P = LW.player, b = w.def.base;
      w.cdT -= dt;
      if (w.cdT > 0) return;
      w.cdT += cdOf(L);
      var items = LW.enemies.items, en = LW.enemies.n, R2 = b.range * b.range;
      var n = L.n + S.amount;
      for (var i = 0; i < n; i++) {
        var cnt = 0, k, e, tx, ty;
        for (k = 0; k < en; k++) {
          e = items[k];
          if (!e.active) continue;
          var dx = e.x - P.x, dy = e.y - P.y;
          if (dx * dx + dy * dy <= R2) cnt++;
        }
        if (cnt > 0) {
          var pick = (LW.rand() * cnt) | 0;
          for (k = 0; k < en; k++) {
            e = items[k];
            if (!e.active) continue;
            var ex = e.x - P.x, ey = e.y - P.y;
            if (ex * ex + ey * ey > R2) continue;
            if (pick-- === 0) { tx = e.x; ty = e.y; break; }
          }
        } else {
          var ang = LW.rand() * TAU, dd = Math.sqrt(LW.rand()) * b.range;
          tx = P.x + Math.cos(ang) * dd; ty = P.y + Math.sin(ang) * dd;
        }
        var a = LW.areas.add(LW.AREA.FLASK, w.slot, tx, ty, L.r * S.area, L.dmg * S.might, b.fly);
        if (a) { a.sx = P.x; a.sy = P.y; a.extra = L.dur * S.duration; a.flag = L.pull ? 1 : 0; }
      }
    }
  };

  // W8 폭화 씨앗: 플레이어 위치에 떨군다. 2개 이상이면 반경 60 안에 흩뿌린다.
  B.seed = {
    update: function (w, dt) {
      var L = LW.weaponLevel(w), S = LW.player.stats, P = LW.player, b = w.def.base;
      w.cdT -= dt;
      if (w.cdT > 0) return;
      w.cdT += cdOf(L);
      var n = L.n + S.amount;
      for (var i = 0; i < n; i++) {
        var x = P.x, y = P.y;
        if (n > 1) {
          var ang = LW.rand() * TAU, dd = Math.sqrt(LW.rand()) * b.scatter;
          x += Math.cos(ang) * dd; y += Math.sin(ang) * dd;
        }
        var a = LW.areas.add(LW.AREA.SEED, w.slot, x, y, L.r * S.area, L.dmg * S.might, b.life);
        if (a) {
          a.extra = b.kb;
          a.tick = L.mini || 0; a.sx = L.miniR || 0; a.sy = L.miniMul || 0;
        }
      }
    }
  };

  LW.weapons = {
    update: function (dt) {
      var list = LW.game.weapons;
      for (var i = 0; i < list.length; i++) {
        var w = list[i];
        B[w.def.behavior].update(w, dt);
      }
    }
  };

  // 공통 피해 함수
  LW.dealDamage = function (e, amount, slot, kx, ky, kb) {
    var g = LW.game;
    e.hp -= amount;
    e.flashT = 0.08;
    g.dmgBySlot[slot] += amount;
    LW.effects.dmgNum(e.x, e.y - e.r, amount);
    if (!e.boss) {
      var k = kb * (1 - e.kbRes);
      e.kbX += kx * k; e.kbY += ky * k;
    }
    LW.audio.hit();
    if (e.hp <= 0 && e.active) LW.killEnemy(e);
  };

  // 풀에서의 제거는 enemies.compact()가 한 번에 한다(질의 결과의 인덱스를 지키기 위해)
  // 주의: dealDamage와 killEnemy 안에서는 LW.qbuf를 쓰는 질의(queryRadius, nearest)를 부르지 않는다.
  // 호출한 쪽이 qbuf를 순회 중이라 덮어써진다. 포자 폭발은 예고 장판으로 미뤄서 처리한다.
  LW.killEnemy = function (e) {
    var g = LW.game;
    e.active = false;
    g.kills++;
    LW.spawnGem(e.x, e.y, e.xp);
    // 기름: 일반 적 0.3%, 엘리트는 상자와 함께 50%
    if (e.elite) { LW.dropChest(e.x, e.y, false); if (LW.rand() < 0.5) LW.dropOil(e.x + 16, e.y, true); }
    else if (!e.boss && LW.rand() < 0.003) LW.dropOil(e.x, e.y, false);
    if (e.boss) { LW.dropChest(e.x, e.y, true); g.bossKilled = (g.bossKilled || 0) + 1; }
    // 부푼 포자: 0.6초 예고 뒤 반경 55 폭발(플레이어 피해 14). 질의 없이 장판으로 미룬다
    if (e.def.id === 'spore') LW.areas.add(LW.AREA.TELE, 0, e.x, e.y, 55, 14, 0.6);
    var n = LW.quality.level === 0 ? 6 : (LW.quality.level === 1 ? 4 : 2);
    LW.effects.burst(e.x, e.y, n, 2);
  };
})();
