// 스폰 표. S2에서는 첫 구간 하나만 둔다. 전체 표는 S8에서 채운다.
// 마지막 구간을 넘어가면 마지막 구간을 계속 쓴다.
(function () {
  LW.WAVES = [
    { from: 0, to: 60, weights: { mite: 100 }, rate: 1.5, minAlive: 10 }
  ];
  LW.EVENTS = [];
})();
