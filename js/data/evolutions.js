// 진화 8종. 조건: 기반 무기 Lv8 + 짝 패시브 1레벨 이상 + 상자. L은 진화 후 최종 수치(레벨 표와 같은 키).
// 특수 효과 필드: ring 연사 N번째마다 8방향 탄, always 항상 켜짐, orbitR 궤도 반경, hitGap 재타격 간격,
// slow 감속 비율, regen 재생, circle 360도, freeze 빙결 초, chain 연쇄 수, chainR 연쇄 거리, chainMul 연쇄 피해 배율,
// turn 초당 회전각, pull 끌어당김, mini 작은 폭발 수, miniR 작은 폭발 반경, miniMul 작은 폭발 피해 배율
(function () {
  LW.EVOLUTIONS = [
    { id: 'sunlance', weapon: 'ember', passive: 'P2', name: '태양창 연사', color: '#ffb347',
      L: { dmg: 30, cd: 0.9, n: 6, pierce: 5, interval: 0.05, r: 8, speed: 520, ring: 3 } },
    { id: 'lanternring', weapon: 'orbit', passive: 'P4', name: '영원의 등롱환', color: '#ffe27a',
      L: { dmg: 35, n: 6, dur: 0, cd: 0, always: true, orbitR: 95, hitGap: 0.35 } },
    { id: 'sanctuary', weapon: 'halo', passive: 'P7', name: '정화의 성역', color: '#ffe9a8',
      L: { dmg: 20, r: 120, tick: 0.4, slow: 0.3, regen: 1.5 } },
    { id: 'halfmoon', weapon: 'scythe', passive: 'P1', name: '혹한의 반달', color: '#bfeaff',
      L: { dmg: 45, cd: 1.0, range: 140, n: 1, circle: true, freeze: 0.6 } },
    { id: 'stormtower', weapon: 'bell', passive: 'P3', name: '폭풍 종탑', color: '#fff9b0',
      L: { dmg: 45, cd: 1.8, n: 7, r: 60, chain: 2, chainR: 150, chainMul: 0.6 } },
    { id: 'bladestorm', weapon: 'disc', passive: 'P5', name: '칼날 폭풍', color: '#a8f0b8',
      L: { dmg: 24, n: 6, r: 18, dur: 5.0, speed: 340, cd: 2.5, turn: 1.5 } },
    { id: 'gluttonswamp', weapon: 'flask', passive: 'P8', name: '탐식의 늪', color: '#c48cf0',
      L: { dmg: 16, r: 70, dur: 4.0, n: 4, cd: 3.5, pull: 60 } },
    { id: 'burstgarden', weapon: 'seed', passive: 'P9', name: '폭화 정원', color: '#d2f06a',
      L: { dmg: 60, r: 80, n: 5, cd: 2.0, mini: 3, miniR: 35, miniMul: 0.5 } }
  ];
  LW.EVO_BY_WEAPON = {};
  for (var i = 0; i < LW.EVOLUTIONS.length; i++) LW.EVO_BY_WEAPON[LW.EVOLUTIONS[i].weapon] = LW.EVOLUTIONS[i];
})();
