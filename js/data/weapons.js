// 무기 밸런스 표. 수치는 그 레벨의 최종값이고, null은 윗 레벨 값을 그대로 쓴다는 뜻이다.
// 레벨 객체의 키: dmg 피해, cd 쿨다운, n 개수, pierce 관통, dur 지속, r 반경, tick 틱, range 사거리, speed 속도
(function () {
  function build(keys, rows) {
    var out = [], cur = [], i, j;
    for (j = 0; j < keys.length; j++) cur.push(0);
    for (i = 0; i < rows.length; i++) {
      var L = {};
      for (j = 0; j < keys.length; j++) {
        if (rows[i][j] !== null) cur[j] = rows[i][j];
        L[keys[j]] = cur[j];
      }
      out.push(L);
    }
    return out;
  }

  var N = null;
  LW.WEAPONS = [
    {
      id: 'ember', code: 'W1', name: '불씨 화살', behavior: 'dart', color: '#ff9a3c', maxLv: 8,
      base: { speed: 420, r: 5, life: 1.5, kb: 4, interval: 0.08 },
      keys: ['dmg', 'cd', 'n', 'pierce'],
      labels: { dmg: '피해', n: '발수', pierce: '관통', cd: '쿨다운' },
      levels: build(['dmg', 'cd', 'n', 'pierce'], [
        [10, 1.20, 2, 1],
        [12, N, N, N],
        [15, N, 3, N],
        [N, 1.10, N, N],
        [N, N, 4, 2],
        [20, 1.00, N, N],
        [N, N, 5, 3],
        [25, 0.90, N, N]
      ])
    },
    {
      id: 'orbit', code: 'W2', name: '등롱 궤도', behavior: 'orbit', color: '#ffd34d', maxLv: 8,
      base: { orbitR: 75, spin: 3.5, hitGap: 0.5, kb: 6, r: 9 },
      keys: ['dmg', 'n', 'dur', 'cd'],
      labels: { dmg: '피해', n: '개수', dur: '지속', cd: '쿨다운' },
      levels: build(['dmg', 'n', 'dur', 'cd'], [
        [10, 1, 3.0, 4.0],
        [N, 2, N, N],
        [15, N, N, N],
        [N, 3, 3.5, N],
        [20, N, N, 3.5],
        [N, 4, 4.0, N],
        [25, N, N, 3.0],
        [30, 5, 4.5, N]
      ])
    },
    {
      id: 'halo', code: 'W3', name: '재의 원', behavior: 'halo', color: '#b9a99a', maxLv: 8,
      base: { kb: 1 },
      keys: ['dmg', 'r', 'tick'],
      labels: { dmg: '피해', r: '반경', tick: '틱' },
      levels: build(['dmg', 'r', 'tick'], [
        [5, 55, 0.60],
        [6, 60, N],
        [7, 65, N],
        [8, 70, 0.55],
        [9, 75, N],
        [10, 80, 0.50],
        [12, 85, N],
        [14, 90, 0.45]
      ])
    },
    {
      id: 'scythe', code: 'W4', name: '서리 낫', behavior: 'scythe', color: '#8fd8ff', maxLv: 8,
      base: { arc: 140, anim: 0.2, kb: 8 },
      keys: ['dmg', 'cd', 'range', 'n'],
      labels: { dmg: '피해', cd: '쿨다운', range: '사거리', n: '휘두름' },
      levels: build(['dmg', 'cd', 'range', 'n'], [
        [15, 1.5, 95, 1],
        [18, N, N, N],
        [N, N, N, 2],
        [22, N, 105, N],
        [N, 1.3, N, N],
        [27, N, 115, N],
        [N, N, N, 3],
        [33, 1.1, N, N]
      ])
    },
    {
      id: 'bell', code: 'W5', name: '번개 종', behavior: 'bell', color: '#fff27a', maxLv: 8,
      base: { kb: 0 },
      keys: ['dmg', 'cd', 'n', 'r'],
      labels: { dmg: '피해', cd: '쿨다운', n: '낙뢰', r: '반경' },
      levels: build(['dmg', 'cd', 'n', 'r'], [
        [18, 3.0, 2, 35],
        [N, N, 3, N],
        [24, N, N, N],
        [N, N, 4, 40],
        [N, 2.6, N, N],
        [30, N, 5, N],
        [N, N, N, 48],
        [38, 2.2, 6, N]
      ])
    },
    {
      id: 'disc', code: 'W6', name: '가시 원반', behavior: 'disc', color: '#7bd88f', maxLv: 8,
      base: { r: 10, kb: 3, hitGap: 0.4 },
      keys: ['dmg', 'n', 'dur', 'speed', 'cd'],
      labels: { dmg: '피해', n: '개수', dur: '지속', speed: '속도', cd: '쿨다운' },
      levels: build(['dmg', 'n', 'dur', 'speed', 'cd'], [
        [8, 1, 2.5, 260, 3.0],
        [N, 2, N, N, N],
        [11, N, N, N, N],
        [N, N, 3.0, 290, N],
        [N, 3, N, N, N],
        [14, N, N, N, N],
        [N, N, 3.5, N, N],
        [18, 4, N, N, N]
      ])
    },
    {
      id: 'flask', code: 'W7', name: '늪안개 항아리', behavior: 'flask', color: '#a56bd8', maxLv: 8,
      base: { range: 300, fly: 0.4, tick: 0.5 },
      keys: ['dmg', 'r', 'dur', 'n', 'cd'],
      labels: { dmg: '틱 피해', r: '반경', dur: '지속', n: '개수', cd: '쿨다운' },
      levels: build(['dmg', 'r', 'dur', 'n', 'cd'], [
        [6, 40, 2.0, 1, 4.0],
        [N, N, N, 2, N],
        [N, 48, N, N, N],
        [8, N, 2.5, N, N],
        [N, N, N, 3, N],
        [10, 56, N, N, N],
        [N, N, 3.0, N, N],
        [13, N, N, 4, N]
      ])
    },
    {
      id: 'seed', code: 'W8', name: '폭화 씨앗', behavior: 'seed', color: '#b6e04a', maxLv: 8,
      base: { arm: 0.5, trigger: 24, life: 4, kb: 10, scatter: 60 },
      keys: ['dmg', 'r', 'n', 'cd'],
      labels: { dmg: '피해', r: '폭발 반경', n: '개수', cd: '쿨다운' },
      levels: build(['dmg', 'r', 'n', 'cd'], [
        [25, 50, 1, 2.5],
        [30, N, N, N],
        [N, N, 2, N],
        [N, 58, N, N],
        [38, N, N, 2.2],
        [N, N, 3, N],
        [N, 66, N, N],
        [50, N, 4, N]
      ])
    }
  ];
  LW.WEAPON_BY_ID = {};
  for (var i = 0; i < LW.WEAPONS.length; i++) LW.WEAPON_BY_ID[LW.WEAPONS[i].id] = LW.WEAPONS[i];
})();
