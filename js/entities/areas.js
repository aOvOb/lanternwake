// 장판, 폭발, 예고 풀. 쓰는 무기가 S5에서 들어오므로 지금은 풀과 갱신 뼈대만 둔다.
(function () {
  function make() {
    return { active: false, kind: 0, slot: 0, x: 0, y: 0, r: 0, dmg: 0, life: 0, tick: 0, tickT: 0, extra: 0 };
  }
  var pool = LW.areas = LW.makePool(LW.POOL.areas, make);

  pool.update = function (dt) {
    var items = pool.items;
    for (var i = pool.n - 1; i >= 0; i--) {
      var a = items[i];
      a.life -= dt;
      if (a.life <= 0) pool.remove(i);
    }
  };

  pool.reset = function () { pool.clear(); };
})();
