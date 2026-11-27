// 적 밸런스 표. ai: chase 추적, flutter 흔들며 추적, shoot 거리 유지와 사격, charge 예고 뒤 돌진,
// fly 직선 비행(떼 이벤트), colossus, queen, last는 보스 패턴
(function () {
  function D(id, name, hp, speed, dmg, xp, r, kbRes, ai, extra) {
    var d = { id: id, name: name, hp: hp, speed: speed, dmg: dmg, xp: xp, r: r, kbRes: kbRes, ai: ai, shape: id };
    if (extra) for (var k in extra) d[k] = extra[k];
    return d;
  }
  LW.ENEMIES = {
    mite: D('mite', '그을음 진드기', 5, 75, 3, 1, 8, 0, 'chase'),
    moth: D('moth', '그림자 나방', 8, 105, 4, 1, 9, 0, 'flutter'),
    mudling: D('mudling', '진흙 덩이', 30, 50, 5, 3, 14, 0.3, 'chase'),
    spore: D('spore', '부푼 포자', 20, 60, 5, 2, 12, 0, 'chase'),
    rusthelm: D('rusthelm', '녹슨 투구병', 70, 62, 7, 5, 15, 0.6, 'chase'),
    eye: D('eye', '어스름 눈', 28, 58, 4, 4, 12, 0.2, 'shoot'),
    boar: D('boar', '땅거미 멧돼지', 55, 65, 8, 5, 15, 0.5, 'charge'),
    crow: D('crow', '재까마귀', 6, 190, 4, 1, 9, 0, 'fly', { noReloc: true }),
    colossus: D('colossus', '잿더미 거인', 2500, 55, 20, 100, 36, 1, 'colossus', { boss: true }),
    queen: D('queen', '밤나방 여왕', 7000, 70, 22, 100, 32, 1, 'queen', { boss: true }),
    last: D('last', '마지막 그림자', 18000, 80, 28, 100, 40, 1, 'last', { boss: true })
  };
})();
