// 자동 검사 모드: ?autotest=N
// 오류를 모으고, 플레이어를 자동으로 움직이고, N초가 지나면 결과 JSON을 <pre id="autotest">에 쓴다.
(function () {
  var N = LW.params.autotest;
  var at = LW.autotest = { active: N > 0, done: false, errors: [], seconds: N, angle: 0 };
  var dir = { x: 0, y: 0 };
  if (!at.active) return;

  function str(v) {
    try { return typeof v === 'string' ? v : (v && v.stack) || JSON.stringify(v); }
    catch (e) { return String(v); }
  }
  function push(msg) { if (at.errors.length < 50) at.errors.push(msg); }

  var prevOnError = window.onerror;
  window.onerror = function (msg, src, line, col) {
    push('onerror: ' + msg + ' (' + src + ':' + line + ':' + col + ')');
    if (prevOnError) return prevOnError.apply(this, arguments);
    return false;
  };
  window.addEventListener('unhandledrejection', function (e) {
    push('unhandledrejection: ' + str(e.reason));
  });
  var origErr = console.error;
  console.error = function () {
    var parts = [];
    for (var i = 0; i < arguments.length; i++) parts.push(str(arguments[i]));
    push('console.error: ' + parts.join(' '));
    return origErr.apply(console, arguments);
  };

  // 게임 시간 1스텝마다 호출: 플레이어가 원을 그리며 움직인다
  at.tick = function (dt) {
    at.angle += dt * 0.5;
    dir.x = Math.cos(at.angle); dir.y = Math.sin(at.angle);
    LW.input.auto = dir;
  };

  // 프레임마다 호출: 타이틀 통과, 카드 자동 선택, 종료 판정
  at.frame = function () {
    if (at.done) return;
    var g = LW.game;
    if (!g) return;
    if (g.state === 'TITLE') {
      g.start();
    } else if (g.state === 'LEVELUP') {
      if (performance.now() - LW.levelup.openedAt >= 500) LW.levelup.choose(0);
    }
    if (g.time >= N || g.state === 'RESULT') at.finish();
  };

  function round(v, k) { var m = Math.pow(10, k); return Math.round(v * m) / m; }

  at.finish = function (extraError) {
    if (at.done) return;
    at.done = true;
    if (extraError) push(extraError);
    var g = LW.game || {};
    var p = LW.perf || {};
    var res = {
      ok: at.errors.length === 0,
      errors: at.errors,
      gameTime: round(g.time || 0, 2),
      level: g.level || 0,
      kills: g.kills || 0,
      enemiesActive: LW.enemies ? LW.enemies.n : 0,
      maxEnemies: p.maxEnemies || 0,
      avgUpdateMs: p.updN ? round(p.updSum / p.updN, 4) : 0,
      avgRenderMs: p.rndN ? round(p.rndSum / p.rndN, 4) : 0,
      state: g.state || ''
    };
    var pre = document.createElement('pre');
    pre.id = 'autotest';
    pre.textContent = JSON.stringify(res);
    document.body.appendChild(pre);
  };

  // 게임이 시작되지 못한 경우에도 JSON이 남도록 하는 감시 타이머
  setTimeout(function () {
    at.finish('watchdog: 게임 시간 ' + N + '초에 도달하지 못함');
  }, N * 1500 + 8000);
})();
