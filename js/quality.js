// 화질 단계와 동적 하향.
// 자동(auto)일 때만 내린다. 최근 3초 프레임 간격의 평균이 19ms를 넘으면 한 단계 낮추고,
// 한 판 안에서는 다시 올리지 않는다(새 판의 reset에서 첫 단계로 돌아간다).
(function () {
  var WINDOW = 3;          // 판정 창(초). 단계를 바꾸면 창을 비우므로 직후 3초도 판정하지 않는다
  var LIMIT = 0.019;       // 평균 프레임 간격 한계(초)
  var winT = 0, winN = 0;
  var q = LW.quality = {
    level: 0,
    dprCap: 2,
    particleCap: 150,
    dmgCap: 40,
    name: 'HIGH',
    auto: true,            // 동적 하향을 쓰는가
    drops: 0,              // 이번 판에서 내린 횟수
    lastAvgMs: 0,          // 마지막 판정의 평균 프레임 간격(ms)
    apply: function (lv) {
      var t = LW.QUALITY[lv];
      q.level = lv;
      q.name = t.name;
      q.dprCap = t.dpr;
      q.particleCap = t.particles;
      q.dmgCap = LW.settings.dmgNumbers ? t.dmgNums : 0;
    },
    reset: function () {
      var s = LW.settings.quality;
      var lv = 0;
      q.auto = s === 'auto';
      if (s === 'low') lv = 2;
      else if (s === 'high') lv = 0;
      else if (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) lv = 1;
      // 측정 전용: ?ql=0|1|2는 설정과 상관없이 단계를 고정한다
      if (LW.params.ql >= 0) { lv = LW.params.ql; q.auto = false; }
      q.drops = 0; q.lastAvgMs = 0;
      winT = 0; winN = 0;
      q.apply(lv);
      q.startName = q.name;
    },
    // 프레임마다 호출. frameDt는 직전 프레임과의 간격(초). PLAYING에서만 판정한다.
    sample: function (frameDt) {
      if (!q.auto || LW.game.state !== 'PLAYING') return;
      winT += frameDt; winN++;
      if (winT < WINDOW) return;
      var avg = winT / winN;
      winT = 0; winN = 0;
      q.lastAvgMs = avg * 1000;
      if (avg <= LIMIT || q.level >= LW.QUALITY.length - 1) return;
      q.apply(q.level + 1);
      q.drops++;
      // DPR 상한이 바뀌면 백버퍼와 스프라이트 캐시를 새 배율로 다시 만든다
      LW.platform.resize();
    }
  };
  q.reset();
})();
