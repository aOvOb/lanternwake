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

  // 마지막으로 만든 백버퍼 크기와 DPR. 같으면 스프라이트와 비네트를 다시 만들지 않는다.
  var built = { w: 0, h: 0, dpr: 0 };

  // 크기, DPR, safe-area, 그리드, 스프라이트 캐시를 다시 계산한다.
  // 크기와 DPR이 그대로면 safe-area만 다시 읽는다(새 판 시작이나 중복 이벤트 때 비용을 아낀다).
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
    if (built.w === cssW && built.h === cssH && built.dpr === v.dprUsed) { readSafe(); return; }
    built.w = cssW; built.h = cssH; built.dpr = v.dprUsed;
    canvas.width = Math.round(cssW * v.dprUsed);
    canvas.height = Math.round(cssH * v.dprUsed);
    // 표시 크기는 백버퍼와 같은 기준(innerWidth, innerHeight)으로 JS에서 지정한다
    canvas.style.width = cssW + 'px';
    canvas.style.height = cssH + 'px';
    readSafe();
    if (LW.grid) LW.grid.resize();
    if (LW.render) LW.render.onResize();
  };

  // 방향 전환 한 번에 resize, orientationchange, visualViewport resize가 연달아 온다.
  // 다음 프레임에 한 번만 다시 계산하고, 300ms 뒤에 한 번 더 확인한다(safe-area가 늦게 바뀌는 기기 대비).
  var rzPending = false, rzTimer = 0;
  function scheduleResize() {
    if (!rzPending) {
      rzPending = true;
      requestAnimationFrame(function () { rzPending = false; LW.platform.resize(); });
    }
    clearTimeout(rzTimer);
    rzTimer = setTimeout(function () { LW.platform.resize(); }, 300);
  }

  // 제스처와 기본 동작 차단
  function prevent(e) { e.preventDefault(); }
  document.addEventListener('touchstart', prevent, { passive: false });
  document.addEventListener('touchmove', prevent, { passive: false });
  document.addEventListener('gesturestart', prevent, { passive: false });
  document.addEventListener('gesturechange', prevent, { passive: false });
  document.addEventListener('dblclick', prevent, { passive: false });
  document.addEventListener('contextmenu', prevent, { passive: false });

  window.addEventListener('resize', scheduleResize);
  window.addEventListener('orientationchange', scheduleResize);
  if (window.visualViewport) window.visualViewport.addEventListener('resize', scheduleResize);

  // 백그라운드 전환
  document.addEventListener('visibilitychange', function () {
    if (!LW.game) return;
    if (document.hidden) LW.game.onHidden(); else LW.game.onVisible();
  });
  window.addEventListener('pagehide', function () { if (LW.game) LW.game.onHidden(); });

  // Wake Lock: 원하는 상태(want)를 먼저 기록한다. 요청이 끝났을 때 want가 꺼져 있으면 바로 해제한다.
  var lock = null, want = false, pending = false;
  function releaseLock() {
    if (!lock) return;
    var l = lock;
    lock = null;
    try { l.release().catch(function () { /* 무시 */ }); } catch (e) { /* 무시 */ }
  }
  LW.platform.wakeLock = function (on) {
    want = !!on;
    try {
      if (!want) { releaseLock(); return; }
      if (lock || pending || !navigator.wakeLock) return;
      pending = true;
      navigator.wakeLock.request('screen').then(function (l) {
        pending = false;
        if (!want) { try { l.release().catch(function () { /* 무시 */ }); } catch (e) { /* 무시 */ } return; }
        lock = l;
        l.addEventListener('release', function () { if (lock === l) lock = null; });
      }).catch(function () { pending = false; /* 실패는 무시 */ });
    } catch (e) { pending = false; }
  };
  LW.platform.wakeLockOn = function () { return !!lock; };

  // 서비스 워커: 등록은 S13. nosw=1이면 등록된 것을 모두 해제한다.
  if (LW.params.nosw && navigator.serviceWorker && navigator.serviceWorker.getRegistrations) {
    navigator.serviceWorker.getRegistrations().then(function (regs) {
      for (var i = 0; i < regs.length; i++) regs[i].unregister();
    }).catch(function () { /* 무시 */ });
  }
})();
