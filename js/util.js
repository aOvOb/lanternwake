(function () {
  LW.clamp = function (v, a, b) { return v < a ? a : (v > b ? b : v); };
  LW.lerp = function (a, b, t) { return a + (b - a) * t; };

  // 시드 RNG(mulberry32)
  LW.mulberry32 = function (seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };
  var rng = LW.mulberry32(LW.params.autotest ? LW.params.seed : ((Date.now() ^ (Math.random() * 1e9)) >>> 0));
  LW.rand = function () { return rng(); };
  LW.randRange = function (a, b) { return a + (b - a) * rng(); };
  // 그리기 전용 난수. 파티클과 데미지 숫자처럼 게임 결과에 영향이 없는 곳만 쓴다.
  // 화질 단계에 따라 호출 횟수가 달라져도 게임 난수 흐름이 바뀌지 않게 따로 둔다.
  var fxRng = LW.mulberry32(LW.params.autotest ? 54321 : ((Date.now() ^ (Math.random() * 1e9)) >>> 0));
  LW.fxRand = function () { return fxRng(); };

  // 가중치 랜덤 선택: ws는 숫자 배열, total은 합계
  LW.weightedPick = function (ws, total) {
    var r = rng() * total;
    for (var i = 0; i < ws.length; i++) {
      r -= ws[i];
      if (r < 0) return i;
    }
    return ws.length - 1;
  };

  // mm:ss
  LW.fmtTime = function (sec) {
    var m = Math.floor(sec / 60), s = Math.floor(sec % 60);
    return (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
  };

  // 숫자 문자열 캐시(데미지 숫자용)
  LW.numStr = [];
  for (var i = 0; i < 1000; i++) LW.numStr.push(String(i));

  // 객체 풀: 갱신 중 제거는 active를 끄고 compact()로 한 번에 swap-remove 한다
  LW.makePool = function (size, factory) {
    var items = new Array(size);
    for (var i = 0; i < size; i++) items[i] = factory(i);
    return {
      items: items,
      size: size,
      n: 0,
      spawn: function (limit) {
        if (this.n >= (limit === undefined ? size : limit)) return null;
        var it = items[this.n++];
        it.active = true;
        return it;
      },
      remove: function (i) {
        var last = --this.n;
        var it = items[i];
        items[i] = items[last];
        items[last] = it;
        it.active = false;
      },
      compact: function () {
        for (var i = this.n - 1; i >= 0; i--) if (!items[i].active) this.remove(i);
      },
      clear: function () {
        for (var i = 0; i < this.n; i++) items[i].active = false;
        this.n = 0;
      }
    };
  };

  // 경험치 요구량: 레벨 n에서 n+1로
  LW.xpReq = function (n) {
    if (n < 20) return 5 + 10 * (n - 1);
    var r19 = 5 + 10 * 18;
    if (n < 40) return r19 + 13 * (n - 19);
    return r19 + 13 * 20 + 16 * (n - 39);
  };
})();
