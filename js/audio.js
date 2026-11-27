// WebAudio 합성 효과음, iOS 잠금 해제, 백그라운드 중단, 진동
// 컨텍스트는 첫 포인터 뗌, 터치 끝, 키 입력에서 만들고 resume한다(iOS는 사용자 동작 안에서만 소리가 열린다).
// 마스터 볼륨은 0.3이고, 설정의 소리가 꺼져 있으면 0이다.
(function () {
  var ctx = null, master = null, unlocked = false;
  var lastHit = 0, lastGem = 0, gemStep = 0;
  var A = LW.audio = { played: 0, ready: false };

  function ensure() {
    if (ctx) return true;
    var C = window.AudioContext || window.webkitAudioContext;
    if (!C) return false;
    try {
      ctx = new C();
      master = ctx.createGain();
      master.gain.value = LW.settings.sound ? 0.3 : 0;
      master.connect(ctx.destination);
    } catch (e) { ctx = null; master = null; return false; }
    return true;
  }

  // 사용자 동작 안에서 호출된다. iOS 잠금 해제를 위해 무음 버퍼를 한 번 재생한다.
  function unlock() {
    if (!ensure()) return;
    try {
      if (ctx.state === 'suspended') ctx.resume();
      if (!unlocked) {
        unlocked = true;
        var b = ctx.createBuffer(1, 1, 22050), s = ctx.createBufferSource();
        s.buffer = b; s.connect(ctx.destination); s.start(0);
      }
      A.ready = true;
    } catch (e) { /* 무시 */ }
  }
  ['pointerup', 'touchend', 'keydown', 'click'].forEach(function (n) {
    window.addEventListener(n, unlock, { passive: true });
  });

  // 지금 소리를 낼 수 있는지. 일시 중단된 컨텍스트에 소리를 쌓지 않는다(자동 검사는 호출 경로 확인을 위해 예외).
  function ok() {
    if (!ctx || !LW.settings.sound) return false;
    return ctx.state === 'running' || LW.params.autotest > 0;
  }

  // 한 음: 주파수 f에서 시작해 end로 미끄러지고(선택), 짧게 올라갔다 사라진다
  function tone(f, type, dur, vol, delay, end) {
    var t = ctx.currentTime + (delay || 0);
    var o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f, t);
    if (end) o.frequency.exponentialRampToValueAtTime(end, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(master);
    o.start(t); o.stop(t + dur + 0.03);
    A.played++;
  }

  function nowMs() { return performance.now(); }

  A.init = unlock;
  A.applySettings = function () {
    if (master) master.gain.value = LW.settings.sound ? 0.3 : 0;
  };
  A.suspend = function () {
    try { if (ctx && ctx.state === 'running') ctx.suspend(); } catch (e) { /* 무시 */ }
  };
  A.resume = function () {
    try { if (ctx && ctx.state === 'suspended') ctx.resume(); } catch (e) { /* 무시 */ }
  };

  // 적 피격: 60ms에 1회만
  A.hit = function () {
    if (!ok()) return;
    var t = nowMs();
    if (t - lastHit < 60) return;
    lastHit = t;
    tone(190, 'square', 0.05, 0.1, 0, 120);
  };
  // 보석: 사인파. 연달아 먹으면 음이 올라간다(0.35초 안에 이어질 때)
  A.gem = function () {
    if (!ok()) return;
    var t = nowMs();
    if (t - lastGem < 35) return;
    gemStep = t - lastGem < 350 ? Math.min(gemStep + 1, 12) : 0;
    lastGem = t;
    tone(660 * Math.pow(2, gemStep / 12), 'sine', 0.09, 0.16);
  };
  // 레벨업: 아르페지오
  A.levelup = function () {
    if (!ok()) return;
    tone(523, 'sine', 0.14, 0.2, 0);
    tone(659, 'sine', 0.14, 0.2, 0.09);
    tone(784, 'sine', 0.14, 0.2, 0.18);
    tone(1047, 'sine', 0.24, 0.22, 0.27);
  };
  // 플레이어 피격: 톱니파
  A.hurt = function () {
    if (!ok()) return;
    tone(170, 'sawtooth', 0.22, 0.26, 0, 70);
  };
  A.chest = function () {
    if (!ok()) return;
    tone(784, 'triangle', 0.16, 0.22, 0);
    tone(1175, 'triangle', 0.16, 0.22, 0.12);
    tone(1568, 'triangle', 0.3, 0.22, 0.24);
  };
  A.bossWarn = function () {
    if (!ok()) return;
    for (var i = 0; i < 3; i++) {
      tone(440, 'square', 0.16, 0.18, i * 0.3);
      tone(311, 'square', 0.16, 0.18, i * 0.3 + 0.15);
    }
  };
  A.win = function () {
    if (!ok()) return;
    var n = [523, 659, 784, 1047, 1319];
    for (var i = 0; i < n.length; i++) tone(n[i], 'triangle', 0.3, 0.22, i * 0.13);
  };
  A.lose = function () {
    if (!ok()) return;
    tone(392, 'sawtooth', 0.5, 0.2, 0, 196);
    tone(262, 'sawtooth', 0.7, 0.2, 0.3, 110);
  };
  // 타이틀에서 시작: 올빼미 울음을 흉내 낸 짧은 2음. 두 번째가 조금 낮다.
  A.start = function () {
    if (!ok()) return;
    tone(520, 'sine', 0.22, 0.26, 0, 480);
    tone(430, 'sine', 0.34, 0.26, 0.28, 380);
  };
  // 맵 아이템을 받을 때, 촛대가 부서질 때
  A.pickup = function () {
    if (!ok()) return;
    tone(880, 'triangle', 0.14, 0.2, 0, 1320);
  };
  A.candle = function () {
    if (!ok()) return;
    tone(320, 'square', 0.09, 0.14, 0, 110);
    tone(1250, 'sine', 0.06, 0.1, 0.03);
  };

  // 진동: 피격 30ms, 보스 경고 200ms. Android만 동작하고 iOS는 아무 일도 없다.
  A.vibrate = function (ms) {
    if (!LW.settings.vibrate) return;
    try { if (navigator.vibrate) navigator.vibrate(ms); } catch (e) { /* 무시 */ }
  };

  // 자동 검사에서는 사용자 동작이 없으므로 컨텍스트를 바로 만들고, 호출 경로가 예외 없이 도는지 본다
  if (LW.params.autotest > 0) ensure();
})();
