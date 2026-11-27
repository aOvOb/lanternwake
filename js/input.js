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

  // 눌림 상태를 모두 지운다(포커스를 잃거나 화면이 숨겨질 때). 남은 포인터 id가 다음 입력을 막지 않게 한다.
  inp.resetPointers = function () {
    nHeld = 0; nIgn = 0;
    inp.releaseJoy();
    inp.evN = 0;
    if (LW.ui) LW.ui.clearPress();
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
    if (LW.game.state === 'RANKING') { drag.id = e.pointerId; drag.y = e.clientY; drag.total = 0; }
    if (LW.game.state === 'PLAYING' && !joy.active && !LW.ui.hit(x, y)) {
      joy.active = true; joy.id = e.pointerId;
      joy.cx = joy.x = e.clientX; joy.cy = joy.y = e.clientY;
      joy.sx = 0; joy.sy = 0;
    } else {
      pushEv(0, e.pointerId, x, y);
    }
  });
  // 순위표 목록의 세로 끌기: 프레임 사이에 쌓인 이동량(CSS px)을 ui 가 가져간다. 8px 넘게 움직이면 탭이 아니라 끌기로 본다.
  var drag = { id: -1, y: 0, total: 0 };
  inp.dragDy = 0;
  canvas.addEventListener('pointermove', function (e) {
    if (joy.active && e.pointerId === joy.id) updateJoy(e.clientX, e.clientY);
    if (drag.id === e.pointerId) {
      inp.dragDy += e.clientY - drag.y; drag.total += Math.abs(e.clientY - drag.y); drag.y = e.clientY;
    }
  });
  canvas.addEventListener('wheel', function (e) { e.preventDefault(); inp.dragDy -= e.deltaY; }, { passive: false });
  function up(e, cancel) {
    nHeld = delId(held, nHeld, e.pointerId);
    if (has(ign, nIgn, e.pointerId) >= 0) { nIgn = delId(ign, nIgn, e.pointerId); return; }
    if (joy.active && joy.id === e.pointerId) { inp.releaseJoy(); return; }
    if (drag.id === e.pointerId) { drag.id = -1; if (drag.total > 8) cancel = true; }   // 끌었으면 버튼이 눌린 것으로 보지 않는다
    pushEv(cancel ? 2 : 1, e.pointerId, toLx(e.clientX), toLy(e.clientY));
  }
  canvas.addEventListener('pointerup', function (e) { up(e, false); });
  canvas.addEventListener('pointercancel', function (e) { up(e, true); });
  // 캡처가 풀렸는데 up이 오지 않은 포인터는 취소로 처리한다. 이미 처리된 포인터는 무시한다.
  canvas.addEventListener('lostpointercapture', function (e) {
    if (has(held, nHeld, e.pointerId) >= 0) up(e, true);
  });

  // 키보드
  var PREVENT = { ArrowUp: 1, ArrowDown: 1, ArrowLeft: 1, ArrowRight: 1, Space: 1, Enter: 1, Escape: 1 };
  window.addEventListener('keydown', function (e) {
    // 닉네임 폼(입력란, 취소, 확인 버튼)의 키는 게임 키로 처리하지 않는다
    if (e.target && e.target.closest && e.target.closest('#nick')) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (PREVENT[e.code] || e.code.indexOf('Key') === 0 || e.code.indexOf('Digit') === 0) e.preventDefault();
    if (e.repeat) return;
    keys[e.code] = true;
    if (performance.now() >= inp.lockUntil) pushKey(e.code);
  });
  window.addEventListener('keyup', function (e) { keys[e.code] = false; });
  window.addEventListener('blur', function () {
    keys = {};
    inp.resetPointers();
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
