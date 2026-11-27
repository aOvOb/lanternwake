// 통신 계층: 같은 출처의 /api/ 만 부른다. 실패해도 예외를 던지지 않고 { ok, status, data } 로 돌려준다.
(function () {
  var net = LW.net = {
    online: navigator.onLine !== false,   // 브라우저가 알려 주는 연결 상태
    up: false,                            // /api/health 가 성공했는가(서버가 살아 있는가)
    checked: false                        // health 를 한 번이라도 끝냈는가
  };

  // 요청 한 번. timeoutMs 안에 응답이 없으면 끊는다. 반환 Promise 는 항상 이행된다.
  net.request = function (method, path, body, timeoutMs, opts) {
    var ctl = typeof AbortController === 'function' ? new AbortController() : null;
    var timer = ctl ? setTimeout(function () { ctl.abort(); }, timeoutMs || 8000) : 0;
    var init = { method: method, credentials: 'same-origin', cache: 'no-store' };
    if (ctl) init.signal = ctl.signal;
    if (opts && opts.manualRedirect) init.redirect = 'manual';
    if (method !== 'GET') {
      // 서버는 쓰기 요청에 Content-Length 와 JSON 형식을 요구한다(본문이 없어도 {} 를 보낸다)
      init.headers = { 'Content-Type': 'application/json' };
      init.body = JSON.stringify(body === undefined || body === null ? {} : body);
    }
    return fetch(LW.API + path, init).then(function (r) {
      clearTimeout(timer);
      if (r.type === 'opaqueredirect') return { ok: true, status: 303, data: null, redirect: true };
      return r.text().then(function (t) {
        var data = null;
        try { data = t ? JSON.parse(t) : null; } catch (e) { /* JSON 이 아니면 null */ }
        return { ok: r.ok, status: r.status, data: data };
      });
    }).catch(function () {
      clearTimeout(timer);
      return { ok: false, status: 0, data: null, netError: true };
    });
  };
  net.get = function (path, timeoutMs) { return net.request('GET', path, null, timeoutMs); };
  net.post = function (path, body, timeoutMs) { return net.request('POST', path, body, timeoutMs); };
  net.put = function (path, body, timeoutMs) { return net.request('PUT', path, body, timeoutMs); };
  net.del = function (path, body, timeoutMs) { return net.request('DELETE', path, body, timeoutMs); };

  // 서버 상태 확인. 성공하면 up, 아니면 down. 서버가 없거나 JSON 이 아니면(정적 서버가 404 를 줄 때 등) 실패로 본다.
  net.health = function () {
    return net.get('health', 3000).then(function (r) {
      net.up = !!(r.ok && r.data && r.data.ok === true);
      net.checked = true;
      return net.up;
    });
  };

  // 실패한 작업의 재시도 예약: 30초, 60초, 120초, 최대 10분 간격. key 마다 하나만 예약한다.
  var STEPS = [30, 60, 120, 600], tries = {}, timers = {};
  net.schedule = function (key, fn) {
    if (timers[key]) return;
    var n = tries[key] || 0;
    tries[key] = n + 1;
    timers[key] = setTimeout(function () { timers[key] = 0; fn(); }, STEPS[Math.min(n, STEPS.length - 1)] * 1000);
  };
  net.resetBackoff = function (key) { tries[key] = 0; };

  window.addEventListener('online', function () {
    net.online = true;
    if (LW.account) LW.account.onOnline();
  });
  window.addEventListener('offline', function () {
    net.online = false;
    net.up = false;
    if (LW.account) LW.account.onOffline();
  });
})();
