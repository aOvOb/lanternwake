// 키보드, 플로팅 조이스틱, UI 탭용 포인터 이벤트 큐
(function () {
  var canvas = LW.canvas;
  var J = LW.JOY;

  var inp = LW.input = {
    mx: 0, my: 0,
    auto: null,          // 자동 검사용 이동 입력
    lockUntil: 0,        // 이 시각(ms)까지 입력 잠금
    joy: { active: false, id: -1, cx: 0, cy: 0, x: 0, y: 0, sx: 0, sy: 0 },
    // 포인터 이벤트 큐(0 누름, 1 뗌, 2 취소)
    evType: new Int8Array(32), evId: new Int32Array(32),
    evX: new Float32Array(32), evY: new Float32Array(32), evN: 0,
    keyQ: ['', '', '', '', '', '', '', ''], keyN: 0
  };
  var joy = inp.joy;
  var keys = {};

  var held = new Int32Array(8), nHeld = 0;   // 현재 눌려 있는 포인터
  var ign = new Int32Array(8), nIgn = 0;     // 무시 목록

  function has(arr, n, id) { for (var i = 0; i < n; i++) if (arr[i] === id) return i; return -1; }
  function addId(arr, n, id) { if (n < arr.length && has(arr, n, id) < 0) arr[n++] = id; return n; }
  function delId(arr, n, id) {
    var i = has(arr, n, id);
    if (i >= 0) { arr[i] = arr[n - 1]; n--; }
    return n;
  }

  function pushEv(type, id, x, y) {
    var n = inp.evN;
    if (n >= 32) return;
    inp.evType[n] = type; inp.evId[n] = id; inp.evX[n] = x; inp.evY[n] = y;
    inp.evN = n + 1;
  }
  function pushKey(code) { if (inp.keyN < 8) inp.keyQ[inp.keyN++] = code; }

  function toLx(cx) { return (cx - LW.view.offX) / LW.view.scale; }
  function toLy(cy) { return (cy - LW.view.offY) / LW.view.scale; }

  function updateJoy(cx, cy) {
    var dx = cx - joy.cx, dy = cy - joy.cy;
    var d = Math.sqrt(dx * dx + dy * dy);
    if (d > J.R) {
      // 중심이 손가락 쪽으로 끌려와 거리를 R로 유지한다
      joy.cx = cx - dx / d * J.R;
      joy.cy = cy - dy / d * J.R;
      dx = cx - joy.cx; dy = cy - joy.cy;
      d = J.R;
    }
    joy.x = cx; joy.y = cy;
    var s = (d - J.dead) / (J.R - J.dead);
    s = s < 0 ? 0 : (s > 1 ? 1 : s);
    if (s > 0 && d > 0) { joy.sx = dx / d * s; joy.sy = dy / d * s; }
    else { joy.sx = 0; joy.sy = 0; }
  }

  inp.releaseJoy = function () {
    joy.active = false; joy.id = -1; joy.sx = 0; joy.sy = 0;
  };

  // 오버레이가 열릴 때: 눌려 있던 포인터를 무시 목록에 넣고 0.4초 잠근다
  inp.onOverlayOpen = function () {
    nIgn = 0;
    for (var i = 0; i < nHeld; i++) ign[nIgn++] = held[i];
    inp.releaseJoy();
    inp.evN = 0;
    inp.keyN = 0;
    inp.lockUntil = performance.now() + LW.OVERLAY_LOCK * 1000;
    if (LW.ui) LW.ui.clearPress();
  };

  canvas.addEventListener('pointerdown', function (e) {
    e.preventDefault();
    try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* 무시 */ }
    nHeld = addId(held, nHeld, e.pointerId);
    if (performance.now() < inp.lockUntil) { nIgn = addId(ign, nIgn, e.pointerId); return; }
    var x = toLx(e.clientX), y = toLy(e.clientY);
    if (LW.game.state === 'PLAYING' && !joy.active && !LW.ui.hit(x, y)) {
      joy.active = true; joy.id = e.pointerId;
      joy.cx = joy.x = e.clientX; joy.cy = joy.y = e.clientY;
      joy.sx = 0; joy.sy = 0;
    } else {
      pushEv(0, e.pointerId, x, y);
    }
  });
  canvas.addEventListener('pointermove', function (e) {
    if (joy.active && e.pointerId === joy.id) updateJoy(e.clientX, e.clientY);
  });
  function up(e, cancel) {
    nHeld = delId(held, nHeld, e.pointerId);
    if (has(ign, nIgn, e.pointerId) >= 0) { nIgn = delId(ign, nIgn, e.pointerId); return; }
    if (joy.active && joy.id === e.pointerId) { inp.releaseJoy(); return; }
    pushEv(cancel ? 2 : 1, e.pointerId, toLx(e.clientX), toLy(e.clientY));
  }
  canvas.addEventListener('pointerup', function (e) { up(e, false); });
  canvas.addEventListener('pointercancel', function (e) { up(e, true); });

  // 키보드
  var PREVENT = { ArrowUp: 1, ArrowDown: 1, ArrowLeft: 1, ArrowRight: 1, Space: 1, Enter: 1, Escape: 1 };
  window.addEventListener('keydown', function (e) {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (PREVENT[e.code] || e.code.indexOf('Key') === 0 || e.code.indexOf('Digit') === 0) e.preventDefault();
    if (e.repeat) return;
    keys[e.code] = true;
    if (performance.now() >= inp.lockUntil) pushKey(e.code);
  });
  window.addEventListener('keyup', function (e) { keys[e.code] = false; });
  window.addEventListener('blur', function () {
    keys = {};
    inp.releaseJoy();
  });

  // 이동 벡터: 자동 검사, 키보드, 조이스틱 순
  inp.getMove = function () {
    if (inp.auto) { inp.mx = inp.auto.x; inp.my = inp.auto.y; return; }
    var x = 0, y = 0;
    if (keys.KeyA || keys.ArrowLeft) x -= 1;
    if (keys.KeyD || keys.ArrowRight) x += 1;
    if (keys.KeyW || keys.ArrowUp) y -= 1;
    if (keys.KeyS || keys.ArrowDown) y += 1;
    if (x || y) {
      if (x && y) { x *= 0.70711; y *= 0.70711; }
      inp.mx = x; inp.my = y;
      return;
    }
    inp.mx = joy.sx; inp.my = joy.sy;
  };

  inp.endFrame = function () { inp.evN = 0; inp.keyN = 0; };
})();
