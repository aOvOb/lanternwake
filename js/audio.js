// 오디오 틀. 합성 효과음은 S11에서 채운다. 호출 지점은 지금부터 이 이름을 쓴다.
(function () {
  function nop() {}
  LW.audio = {
    init: nop, suspend: nop, resume: nop,
    hit: nop, gem: nop, levelup: nop, hurt: nop, chest: nop,
    bossWarn: nop, win: nop, lose: nop, start: nop, pickup: nop, candle: nop,
    vibrate: function (ms) {
      if (!LW.settings.vibrate) return;
      try { if (navigator.vibrate) navigator.vibrate(ms); } catch (e) { /* 무시 */ }
    }
  };
})();
