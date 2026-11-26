// 파티클과 데미지 숫자. 화면에 보이는 상한은 화질 단계가 정한다.
(function () {
  var COLORS = ['#ffd34d', '#ff9a3c', '#c9a0ff', '#e8e8f0'];

  var particles = LW.particles = LW.makePool(LW.POOL.particles, function () {
    return { active: false, x: 0, y: 0, vx: 0, vy: 0, life: 0, maxLife: 1, r: 2, color: '#fff' };
  });
  var dmgNums = LW.dmgNums = LW.makePool(LW.POOL.dmgNums, function () {
    return { active: false, x: 0, y: 0, life: 0, str: '' };
  });

  var fx = LW.effects = {};

  fx.burst = function (x, y, n, colorIdx) {
    for (var i = 0; i < n; i++) {
      var p = particles.spawn(LW.quality.particleCap);
      if (!p) return;
      var a = LW.rand() * 6.2832, s = 40 + LW.rand() * 80;
      p.x = x; p.y = y; p.vx = Math.cos(a) * s; p.vy = Math.sin(a) * s;
      p.maxLife = p.life = 0.3 + LW.rand() * 0.2;
      p.r = 1.5 + LW.rand() * 1.5;
      p.color = COLORS[(colorIdx + (i & 1)) % COLORS.length];
    }
  };

  fx.dmgNum = function (x, y, amount) {
    var cap = LW.quality.dmgCap;
    if (cap <= 0) return;
    var d = dmgNums.spawn(cap);
    if (!d) return;
    var v = Math.round(amount);
    d.x = x + (LW.rand() - 0.5) * 8; d.y = y; d.life = 0.6;
    d.str = v < 1000 ? LW.numStr[v < 0 ? 0 : v] : '999+';
  };

  fx.update = function (dt) {
    var i, it;
    for (i = particles.n - 1; i >= 0; i--) {
      it = particles.items[i];
      it.life -= dt;
      if (it.life <= 0) { particles.remove(i); continue; }
      it.x += it.vx * dt; it.y += it.vy * dt;
      it.vx *= 0.94; it.vy *= 0.94;
    }
    for (i = dmgNums.n - 1; i >= 0; i--) {
      it = dmgNums.items[i];
      it.life -= dt;
      if (it.life <= 0) { dmgNums.remove(i); continue; }
      it.y -= 30 * dt;
    }
  };

  fx.reset = function () { particles.clear(); dmgNums.clear(); };
})();
