// 무기별 update와 공통 피해 함수
(function () {
  // 무기 인스턴스를 만든다. 슬롯 번호는 보유 순서다.
  LW.makeWeapon = function (id, slot) {
    return { def: LW.WEAPON_BY_ID[id], lv: 1, slot: slot, cdT: 0.2, burstLeft: 0, burstT: 0 };
  };

  // 종류별 동작. 새 무기는 여기에 항목을 더한다.
  var B = LW.WEAPON_BEHAVIORS = {};

  // W1 불씨 화살: 가장 가까운 적에게 쏜다. 적이 없으면 마지막 이동 방향. 여러 발은 0.08초 간격 연사.
  function fireDart(w, L) {
    var P = LW.player, b = w.def.base;
    var idx = LW.grid.nearest(P.x, P.y);
    var dx = P.lastDx, dy = P.lastDy;
    if (idx >= 0) {
      var e = LW.enemies.items[idx];
      var ex = e.x - P.x, ey = e.y - P.y, d = Math.sqrt(ex * ex + ey * ey);
      if (d > 0.01) { dx = ex / d; dy = ey / d; }
    }
    LW.projectiles.fire(w.slot, P.x, P.y, dx, dy, b.speed * P.stats.projSpeed, b.r,
      L.dmg * P.stats.might, L.pierce, b.life, b.kb);
  }
  B.dart = {
    update: function (w, dt) {
      var L = w.def.levels[w.lv - 1], S = LW.player.stats;
      w.cdT -= dt;
      if (w.burstLeft <= 0 && w.cdT <= 0) {
        w.burstLeft = L.n + S.amount;
        w.burstT = 0;
        w.cdT += L.cd * Math.max(0.4, S.cooldown);
      }
      if (w.burstLeft > 0) {
        w.burstT -= dt;
        while (w.burstLeft > 0 && w.burstT <= 0) {
          fireDart(w, L);
          w.burstLeft--;
          w.burstT += w.def.base.interval;
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
  LW.killEnemy = function (e) {
    var g = LW.game;
    e.active = false;
    g.kills++;
    LW.spawnGem(e.x, e.y, e.xp);
    var n = LW.quality.level === 0 ? 6 : (LW.quality.level === 1 ? 4 : 2);
    LW.effects.burst(e.x, e.y, n, 2);
  };
})();
