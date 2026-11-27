// 시간대별 스폰 표와 이벤트(초 단위). 마지막 구간을 넘어가면 마지막 구간을 계속 쓴다.
(function () {
  function W(from, to, weights, rate, minAlive) { return { from: from * 60, to: to * 60, weights: weights, rate: rate, minAlive: minAlive }; }
  LW.WAVES = [
    W(0, 1, { mite: 100 }, 0.8, 6),
    W(1, 2, { mite: 70, moth: 30 }, 1, 8),
    W(2, 3, { mite: 40, moth: 30, mudling: 30 }, 1.1, 10),
    W(3, 4, { moth: 30, mudling: 40, spore: 30 }, 1.2, 12),
    W(4, 5, { mite: 20, mudling: 30, spore: 20, rusthelm: 30 }, 1.4, 15),
    W(5, 6, { moth: 40, spore: 20, rusthelm: 40 }, 1.3, 14),
    W(6, 7, { moth: 30, rusthelm: 30, eye: 20, boar: 20 }, 5, 75),
    W(7, 8, { mudling: 25, spore: 20, eye: 25, boar: 30 }, 6, 95),
    W(8, 9, { mite: 20, rusthelm: 30, eye: 30, boar: 20 }, 7, 115),
    W(9, 10, { mite: 15, moth: 15, mudling: 15, spore: 15, rusthelm: 15, eye: 15, boar: 10 }, 8, 140),
    W(10, 11, { moth: 50, eye: 30, boar: 20 }, 6, 110),
    W(11, 12, { spore: 20, rusthelm: 30, eye: 20, boar: 30 }, 9, 170),
    W(12, 13, { mite: 30, mudling: 20, rusthelm: 25, boar: 25 }, 10, 200),
    W(13, 14, { moth: 20, spore: 20, rusthelm: 20, eye: 20, boar: 20 }, 11, 230),
    W(14, 15, { moth: 30, rusthelm: 35, boar: 35 }, 10, 210)
  ];

  // type: elite(enemy, n), swarm(n, 까마귀 떼), ring(n, 진드기 포위), boss(id)
  function E(m, s, ev) { ev.t = m * 60 + s; return ev; }
  LW.EVENTS = [
    E(2, 0, { type: 'elite', enemy: 'mudling', n: 1 }),
    E(2, 30, { type: 'swarm', n: 16 }),
    E(3, 30, { type: 'elite', enemy: 'spore', n: 1 }),
    E(4, 0, { type: 'elite', enemy: 'rusthelm', n: 1 }),
    E(4, 30, { type: 'ring', n: 40 }),
    E(5, 0, { type: 'boss', id: 'colossus' }),
    E(6, 0, { type: 'elite', enemy: 'boar', n: 1 }),
    E(7, 30, { type: 'swarm', n: 24 }),
    E(8, 0, { type: 'elite', enemy: 'eye', n: 2 }),
    E(9, 0, { type: 'elite', enemy: 'mudling', n: 1 }),
    E(9, 30, { type: 'ring', n: 48 }),
    E(10, 0, { type: 'boss', id: 'queen' }),
    E(11, 0, { type: 'elite', enemy: 'rusthelm', n: 2 }),
    E(12, 0, { type: 'elite', enemy: 'boar', n: 1 }),
    E(12, 30, { type: 'swarm', n: 32 }),
    E(13, 0, { type: 'elite', enemy: 'eye', n: 1 }),
    E(13, 0, { type: 'elite', enemy: 'rusthelm', n: 1 }),
    E(13, 30, { type: 'ring', n: 56 }),
    E(14, 0, { type: 'boss', id: 'last' })
  ];
})();
