(function () {
  var P = LW.player = {
    x: 0, y: 0, r: 12,
    hp: 100, maxHp: 100, speed: 150, moveMul: 1, magnet: 60, armor: 0, regen: 0,
    invuln: 0, facing: 1, lastDx: 1, lastDy: 0, animT: 0,
    stats: { might: 1, cooldown: 1, area: 1, duration: 1, projSpeed: 1, amount: 0 }
  };

  // 패시브를 얻거나 레벨이 오를 때만 호출한다. 기본값에서 다시 계산한다.
  // 최대 HP가 늘면 늘어난 만큼 현재 HP도 오른다.
  P.recomputeStats = function () {
    var s = P.stats, old = P.maxHp;
    s.might = 1; s.cooldown = 1; s.area = 1; s.duration = 1; s.projSpeed = 1; s.amount = 0;
    P.moveMul = 1;
    P.maxHp = 100; P.magnet = 60; P.armor = 0; P.regen = 0;
    var list = LW.game ? LW.game.passives : null;
    if (list) for (var i = 0; i < list.length; i++) list[i].def.apply(P, list[i].lv);
    if (P.maxHp > old) P.hp += P.maxHp - old;
    if (P.hp > P.maxHp) P.hp = P.maxHp;
  };

  P.heal = function (n) { P.hp = Math.min(P.maxHp, P.hp + n); };

  P.reset = function () {
    P.x = 0; P.y = 0;
    P.invuln = 0; P.facing = 1; P.lastDx = 1; P.lastDy = 0; P.animT = 0;
    P.maxHp = 100;
    P.recomputeStats();
    P.hp = P.maxHp;
  };

  P.update = function (dt) {
    var inp = LW.input;
    inp.getMove();
    var mx = inp.mx, my = inp.my;
    var sp = P.speed * P.moveMul;
    P.x += mx * sp * dt;
    P.y += my * sp * dt;
    var m2 = mx * mx + my * my;
    if (m2 > 0.0004) {
      var m = Math.sqrt(m2);
      P.lastDx = mx / m; P.lastDy = my / m;
      P.animT += dt * 1.5;
    }
    if (mx > 0.1) P.facing = 1; else if (mx < -0.1) P.facing = -1;
    P.animT += dt;
    if (P.invuln > 0) P.invuln -= dt;
    if (P.regen > 0 && P.hp < P.maxHp) {
      P.hp += P.regen * dt;
      if (P.hp > P.maxHp) P.hp = P.maxHp;
    }
  };

  // 받는 피해는 max(1, 피해 - armor). 맞은 뒤 0.4초 무적
  P.hurt = function (dmg) {
    var a = dmg - P.armor;
    if (a < 1) a = 1;
    P.hp -= a;
    P.invuln = LW.INVULN;
    LW.audio.hurt();
    LW.audio.vibrate(30);
  };
})();
