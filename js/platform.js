// 뷰포트, DPR, safe-area, 제스처 차단, 백그라운드 처리, Wake Lock
(function () {
  var canvas = document.getElementById('game');
  var ctx = canvas.getContext('2d', { alpha: false });
  var safeEl = document.getElementById('safe');

  LW.canvas = canvas;
  LW.ctx = ctx;
  LW.view = { w: 450, h: 800, cssW: 450, cssH: 800, scale: 1, offX: 0, offY: 0, dpr: 1, dprUsed: 1, portrait: true, letterbox: false };
  LW.safe = { t: 0, r: 0, b: 0, l: 0 };
  LW.platform = {};

  function readSafe() {
    var v = LW.view;
    var cs = getComputedStyle(safeEl);
    var pt = parseFloat(cs.paddingTop) || 0;
    var pr = parseFloat(cs.paddingRight) || 0;
    var pb = parseFloat(cs.paddingBottom) || 0;
    var pl = parseFloat(cs.paddingLeft) || 0;
    // 레터박스로 이미 비워진 폭만큼은 빼고, 논리 단위로 바꾼다
    LW.safe.t = Math.max(0, pt - v.offY) / v.scale;
    LW.safe.b = Math.max(0, pb - v.offY) / v.scale;
    LW.safe.l = Math.max(0, pl - v.offX) / v.scale;
    LW.safe.r = Math.max(0, pr - v.offX) / v.scale;
  }

  // 크기, DPR, safe-area, 그리드, 스프라이트 캐시를 다시 계산한다
  LW.platform.resize = function () {
    var v = LW.view;
    var cssW = Math.max(1, window.innerWidth);
    var cssH = Math.max(1, window.innerHeight);
    var short = Math.min(cssW, cssH);
    var scale = short / LW.SHORT;
    var longU = Math.min(LW.MAX_LONG, Math.max(cssW, cssH) / scale);
    v.cssW = cssW;
    v.cssH = cssH;
    v.scale = scale;
    v.portrait = cssH >= cssW;
    v.w = v.portrait ? LW.SHORT : longU;
    v.h = v.portrait ? longU : LW.SHORT;
    v.offX = (cssW - v.w * scale) / 2;
    v.offY = (cssH - v.h * scale) / 2;
    v.letterbox = v.offX > 1 || v.offY > 1;
    v.dpr = window.devicePixelRatio || 1;
    v.dprUsed = Math.min(v.dpr, LW.quality.dprCap);
    canvas.width = Math.round(cssW * v.dprUsed);
    canvas.height = Math.round(cssH * v.dprUsed);
    readSafe();
    if (LW.grid) LW.grid.resize();
    if (LW.render) LW.render.onResize();
  };

  // 제스처와 기본 동작 차단
  function prevent(e) { e.preventDefault(); }
  document.addEventListener('touchstart', prevent, { passive: false });
  document.addEventListener('touchmove', prevent, { passive: false });
  document.addEventListener('gesturestart', prevent, { passive: false });
  document.addEventListener('gesturechange', prevent, { passive: false });
  document.addEventListener('dblclick', prevent, { passive: false });
  document.addEventListener('contextmenu', prevent, { passive: false });

  window.addEventListener('resize', LW.platform.resize);
  window.addEventListener('orientationchange', LW.platform.resize);
  if (window.visualViewport) window.visualViewport.addEventListener('resize', LW.platform.resize);

  // 백그라운드 전환
  document.addEventListener('visibilitychange', function () {
    if (!LW.game) return;
    if (document.hidden) LW.game.onHidden(); else LW.game.onVisible();
  });
  window.addEventListener('pagehide', function () { if (LW.game) LW.game.onHidden(); });

  // Wake Lock
  var lock = null;
  LW.platform.wakeLock = function (on) {
    try {
      if (on) {
        if (lock || !navigator.wakeLock) return;
        navigator.wakeLock.request('screen').then(function (l) {
          lock = l;
          l.addEventListener('release', function () { if (lock === l) lock = null; });
        }).catch(function () { /* 실패는 무시 */ });
      } else if (lock) {
        var l = lock;
        lock = null;
        l.release().catch(function () { /* 무시 */ });
      }
    } catch (e) { /* 무시 */ }
  };

  // 서비스 워커: 등록은 S13. nosw=1이면 등록된 것을 모두 해제한다.
  if (LW.params.nosw && navigator.serviceWorker && navigator.serviceWorker.getRegistrations) {
    navigator.serviceWorker.getRegistrations().then(function (regs) {
      for (var i = 0; i < regs.length; i++) regs[i].unregister();
    }).catch(function () { /* 무시 */ });
  }
})();
