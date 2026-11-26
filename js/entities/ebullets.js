// 적 탄 풀. 이동과 플레이어 피격은 collision.js가 처리한다.
(function () {
  var pool = LW.ebullets = LW.makePool(LW.POOL.enemyBullets, function () {
    return { active: false, x: 0, y: 0, vx: 0, vy: 0, r: 5, dmg: 0, life: 0 };
  });

  // 방향 (dx, dy)는 단위 벡터
  pool.fire = function (x, y, dx, dy, speed, r, dmg, life) {
    var b = pool.spawn();
    if (!b) return null;
    b.x = x; b.y = y; b.vx = dx * speed; b.vy = dy * speed;
    b.r = r; b.dmg = dmg; b.life = life;
    return b;
  };

  // n방향 원형 탄. offset은 시작 각도
  pool.ring = function (x, y, n, offset, speed, r, dmg, life) {
    for (var i = 0; i < n; i++) {
      var a = offset + i * Math.PI * 2 / n;
      pool.fire(x, y, Math.cos(a), Math.sin(a), speed, r, dmg, life);
    }
  };

  pool.reset = function () { pool.clear(); };
})();
