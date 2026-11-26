// 화질 단계. S12에서 동적 하향(sample)을 채운다. 지금은 시작 단계만 정한다.
(function () {
  var q = LW.quality = {
    level: 0,
    dprCap: 2,
    particleCap: 150,
    dmgCap: 40,
    name: 'HIGH',
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
      if (s === 'low') lv = 2;
      else if (s === 'high') lv = 0;
      else if (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) lv = 1;
      q.apply(lv);
    },
    sample: function (frameDt) { /* S12 */ }
  };
  q.reset();
})();
