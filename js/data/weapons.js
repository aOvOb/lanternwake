// 무기 밸런스 표. S3에서는 W1 불씨 화살만 있다. W2~W8은 S5에서 추가한다.
(function () {
  // rows: [피해, 쿨다운, 발수, 관통]. null은 윗 레벨 값을 그대로 쓴다는 뜻이다.
  function build(rows) {
    var out = [], cur = [0, 0, 0, 0];
    for (var i = 0; i < rows.length; i++) {
      for (var j = 0; j < 4; j++) if (rows[i][j] !== null) cur[j] = rows[i][j];
      out.push({ dmg: cur[0], cd: cur[1], n: cur[2], pierce: cur[3] });
    }
    return out;
  }

  LW.WEAPONS = [
    {
      id: 'ember', code: 'W1', name: '불씨 화살', behavior: 'dart', color: '#ff9a3c', maxLv: 8,
      base: { speed: 420, r: 5, life: 1.5, kb: 4, interval: 0.08 },
      labels: { dmg: '피해', n: '발수', pierce: '관통', cd: '쿨다운' },
      levels: build([
        [10, 1.20, 1, 1],
        [null, null, 2, null],
        [15, null, null, null],
        [null, 1.10, 3, null],
        [null, null, null, 2],
        [20, 1.00, 4, null],
        [null, null, null, 3],
        [25, 0.90, 5, null]
      ])
    }
  ];
  LW.WEAPON_BY_ID = {};
  for (var i = 0; i < LW.WEAPONS.length; i++) LW.WEAPON_BY_ID[LW.WEAPONS[i].id] = LW.WEAPONS[i];
})();
