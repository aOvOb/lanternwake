// 패시브 10종. apply(P, lv)는 기본값 위에 레벨 효과를 더한다. recomputeStats가 처음부터 다시 계산한다.
(function () {
  LW.PASSIVES = [
    { id: 'P1', code: 'P1', name: '무쇠 팔찌', color: '#d9694a', maxLv: 5, desc: '피해 +10%',
      apply: function (P, lv) { P.stats.might += 0.10 * lv; } },
    { id: 'P2', code: 'P2', name: '쾌속 태엽', color: '#e8c24a', maxLv: 5, desc: '쿨다운 -8%',
      apply: function (P, lv) { P.stats.cooldown -= 0.08 * lv; } },
    { id: 'P3', code: 'P3', name: '확장 렌즈', color: '#5ab8e8', maxLv: 5, desc: '범위 +10%',
      apply: function (P, lv) { P.stats.area += 0.10 * lv; } },
    { id: 'P4', code: 'P4', name: '밀랍 모래시계', color: '#d8c08a', maxLv: 5, desc: '지속 시간 +12%',
      apply: function (P, lv) { P.stats.duration += 0.12 * lv; } },
    { id: 'P5', code: 'P5', name: '질풍 깃털', color: '#9ad8c8', maxLv: 5, desc: '투사체 속도 +10%',
      apply: function (P, lv) { P.stats.projSpeed += 0.10 * lv; } },
    { id: 'P6', code: 'P6', name: '가벼운 장화', color: '#a0846a', maxLv: 5, desc: '이동 속도 +8%',
      apply: function (P, lv) { P.moveMul += 0.08 * lv; } },
    { id: 'P7', code: 'P7', name: '빛샘 심장', color: '#ff6a8a', maxLv: 5, desc: '최대 HP +20, 재생 +0.2/초',
      apply: function (P, lv) { P.maxHp += 20 * lv; P.regen += 0.2 * lv; } },
    { id: 'P8', code: 'P8', name: '자석 돌', color: '#8a8ae8', maxLv: 5, desc: '보석 흡수 거리 +30%',
      apply: function (P, lv) { P.magnet += 60 * 0.30 * lv; } },
    { id: 'P9', code: 'P9', name: '수호 갑각', color: '#7a8a96', maxLv: 5, desc: '받는 피해 -1',
      apply: function (P, lv) { P.armor += lv; } },
    { id: 'P10', code: 'P10', name: '쌍둥이 거울', color: '#d8a0e8', maxLv: 2, desc: '무기 개수 +1',
      apply: function (P, lv) { P.stats.amount += lv; } }
  ];
  LW.PASSIVE_BY_ID = {};
  for (var i = 0; i < LW.PASSIVES.length; i++) LW.PASSIVE_BY_ID[LW.PASSIVES[i].id] = LW.PASSIVES[i];
})();
