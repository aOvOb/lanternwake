// 시험용: DESIGN.md 5.4 시간대별 스폰 표의 이벤트 열을 LW.EVENTS 형식으로 옮겼다.
// 실제 js/data/waves.js(S8)가 채워지기 전에도 서버 검사를 시험하려고 쓴다.
// 이 파일에서 bounds-design.json을 만든다:
//   node tools/gen-bounds.js --waves server/tests/fixtures/waves-design.js --out server/tests/fixtures/bounds-design.json
(function () {
  LW.WAVES = [{ from: 0, to: 60, weights: { mite: 100 }, rate: 1.5, minAlive: 10 }];
  LW.EVENTS = [
    { t: 120, type: 'elite', enemy: 'mudling', n: 1 },
    { t: 150, type: 'swarm', n: 16 },
    { t: 210, type: 'elite', enemy: 'spore', n: 1 },
    { t: 240, type: 'elite', enemy: 'rusthelm', n: 1 },
    { t: 270, type: 'ring', n: 40 },
    { t: 300, type: 'boss', id: 'colossus' },
    { t: 360, type: 'elite', enemy: 'boar', n: 1 },
    { t: 450, type: 'swarm', n: 24 },
    { t: 480, type: 'elite', enemy: 'eye', n: 2 },
    { t: 540, type: 'elite', enemy: 'mudling', n: 1 },
    { t: 570, type: 'ring', n: 48 },
    { t: 600, type: 'boss', id: 'mothqueen' },
    { t: 660, type: 'elite', enemy: 'rusthelm', n: 2 },
    { t: 720, type: 'elite', enemy: 'boar', n: 1 },
    { t: 750, type: 'swarm', n: 32 },
    { t: 780, type: 'elite', enemy: 'eye', n: 1 },
    { t: 780, type: 'elite', enemy: 'rusthelm', n: 1 },
    { t: 810, type: 'ring', n: 56 },
    { t: 840, type: 'boss', id: 'lastshadow' }
  ];
})();
