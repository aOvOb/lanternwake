// 계정: 로그인 상태, 닉네임, 설정 동기화, 판 제출 대기열, 시작 표, 순위표 저장본.
// 서버가 없거나 /api/health 가 실패하면 status 가 'offline' 이 되고, 게임은 그대로 돈다.
// 구글 클라이언트 ID 는 이 코드에 없다(서버가 /api/auth/start 에서 처리한다).
(function () {
  var net = LW.net;
  var A = LW.account = {
    enabled: LW.ACCOUNT,
    status: LW.ACCOUNT ? 'checking' : 'off',   // off(계정 기능 없음), checking, offline, online
    loggedIn: false,       // 저장된 계정 정보나 서버 확인으로 로그인 상태인가
    verified: false,       // 이번 실행에서 서버가 세션을 확인했는가
    uid: 0, nickname: '', nicknameSet: false,
    msg: '', msgAt: 0,     // 화면에 잠깐 보이는 안내 글
    resultLine: '',        // 결과 화면의 한 줄(기록 올리는 중, 순위 반영 등)
    promptNick: false,     // 로그인 직후 닉네임을 아직 안 정했으면 true(화면이 한 번 닉네임 입력을 연다)
    loginResult: '',       // 주소의 login 매개변수(ok 또는 fail)
    boards: { time: null, kills: null },
    lastRunId: '', lastStatus: ''
  };

  var acc = LW.storage.loadAccount();
  var queue = LW.storage.loadQueue();
  var tickets = LW.storage.loadTickets();
  var saved = LW.storage.loadBoard();
  var flushing = false, refilling = false, runSeq = 0, settingsTimer = 0;
  var reserved = null, fresh = null;

  function nowSec() { return Math.floor(Date.now() / 1000); }
  function say(m) { A.msg = m; A.msgAt = performance.now(); }

  // 저장된 계정 정보가 있으면 먼저 로그인 상태로 보여 준다(서버 확인은 뒤에)
  if (acc.uid > 0) { A.loggedIn = true; A.uid = acc.uid; A.nickname = acc.nickname; A.nicknameSet = acc.nicknameSet; }

  // ===== 표시용 =====
  A.records = function () { return acc.records; };
  A.queueCount = function () {
    var n = 0;
    for (var i = 0; i < queue.length; i++) if (queue[i].uid === A.uid) n++;
    return n;
  };
  A.ticketCount = function () { return validTickets().length; };

  // ===== 로그인 상태 =====
  function applyMe(d) {
    var u = d.user;
    if (acc.uid !== u.id) acc.importDone = false;      // 다른 계정이면 이 기기의 가져오기 기록은 새로 시작
    A.loggedIn = true; A.verified = true;
    A.uid = acc.uid = u.id;
    A.nickname = acc.nickname = u.nickname;
    A.nicknameSet = acc.nicknameSet = !!u.nicknameSet;
    acc.imported = !!d.imported;
    acc.records = recordsOf(d.records);
    LW.storage.saveAccount(acc);
  }
  function recordsOf(r) {
    return { bestTimeMs: r.bestTimeMs | 0, bestKills: r.bestKills | 0, bestLevel: r.bestLevel | 0, wins: r.wins | 0, runs: r.runs | 0, fullDawns: r.fullDawns | 0 };
  }
  // 게스트로 돌아간다. 대기열은 uid 별로 남겨 두고(다시 로그인하면 올린다), 계정 정보와 그 계정의 표는 지운다.
  function toGuest() {
    var uid = A.uid;
    A.loggedIn = false; A.verified = false; A.uid = 0; A.nickname = ''; A.nicknameSet = false;
    acc.uid = 0; acc.nickname = ''; acc.nicknameSet = false; acc.imported = false; acc.importDone = false;
    acc.records = recordsOf({});
    LW.storage.saveAccount(acc);
    tickets = tickets.filter(function (t) { return t.uid !== uid; });
    LW.storage.saveTickets(tickets);
    reserved = null; fresh = null;
    A.promptNick = false;
  }

  // 서버에서 내 정보를 받아 적용하고, 설정 동기화, 기록 가져오기, 표 채우기, 대기열 올리기를 이어서 한다.
  function refreshMe() {
    return net.get('me', 6000).then(function (r) {
      if (r.ok && r.data && r.data.user) {
        applyMe(r.data);
        syncSettings(r.data.settings, r.data.settingsRev | 0);
        if (A.loginResult === 'ok' && !A.nicknameSet) A.promptNick = true;
        A.loginResult = '';
        return importOnce(r.data).then(function () {
          refillTickets();
          flushQueue();
        });
      }
      if (r.status === 401) { if (A.loggedIn) toGuest(); return; }
      if (r.status === 403 && r.data && r.data.error === 'banned') { say('이 계정은 이용할 수 없어요'); return; }
      if (r.netError || r.status >= 500) { net.up = false; A.status = 'offline'; }
    });
  }

  A.init = function () {
    // 구글에서 돌아온 주소(/?login=ok 또는 ?login=fail&r=사유)를 읽고 주소창에서 지운다
    try {
      var qs = new URLSearchParams(location.search), lr = qs.get('login');
      if (lr === 'ok' || lr === 'fail') {
        A.loginResult = lr;
        qs.delete('login'); qs.delete('r');
        var rest = qs.toString();
        history.replaceState(null, '', location.pathname + (rest ? '?' + rest : '') + location.hash);
        if (lr === 'fail') say('로그인하지 못했어요. 다시 시도해 주세요.');
      }
    } catch (e) { /* 무시 */ }
    if (!A.enabled) return Promise.resolve();
    return net.health().then(function (up) {
      A.status = up ? 'online' : 'offline';
      if (!up) { net.schedule('health', recheck); return; }
      var p = LW.params.devLogin && !A.verified ? A.devLogin(LW.params.devLogin) : refreshMe();
      return p;
    });
  };

  function recheck() {
    return net.health().then(function (up) {
      A.status = up ? 'online' : 'offline';
      if (!up) { net.schedule('health', recheck); return; }
      net.resetBackoff('health');
      return refreshMe();
    });
  }
  A.onOnline = function () { if (A.enabled) recheck(); };
  A.onOffline = function () { if (A.enabled) A.status = 'offline'; };

  // 개발용 가짜 로그인(자동 검사 전용, ?devlogin=이름). 개발 서버가 아니면 404 라서 아무 일도 일어나지 않는다.
  A.devLogin = function (name) {
    return net.request('GET', 'dev/login?name=' + encodeURIComponent(name), null, 5000, { manualRedirect: true }).then(function () {
      A.loginResult = 'ok';
      return refreshMe();
    });
  };

  // 구글 로그인: 같은 출처의 /api/auth/start 로 이동한다(서버가 구글로 보낸다). TITLE 에서만, 서버가 살아 있을 때만.
  A.login = function () {
    if (!A.enabled || !net.up || LW.game.state !== 'ACCOUNT' && LW.game.state !== 'TITLE') return false;
    location.href = LW.API + 'auth/start';
    return true;
  };

  A.logout = function () {
    return net.post('auth/logout', {}, 6000).then(function (r) {
      if (r.netError) { say('오프라인이라 로그아웃할 수 없어요'); return false; }
      toGuest();
      return true;
    });
      // 서버 세션이 살아 있는데 로컬만 게스트로 바꾸면 다음 실행 때 다시 로그인되므로, 성공(또는 이미 세션 없음)일 때만 바꾼다
      if (!r.ok && r.status !== 401) { say('로그아웃하지 못했어요. 다시 시도해 주세요'); return false; }
  };

  A.deleteAccount = function () {
    return net.del('me', { confirm: 'DELETE' }, 8000).then(function (r) {
      if (r.netError) { say('오프라인이라 삭제할 수 없어요'); return false; }
      if (!r.ok && r.status !== 401) { say('삭제하지 못했어요. 다시 시도해 주세요.'); return false; }
      var uid = A.uid;
      queue = queue.filter(function (q) { return q.uid !== uid; });
      LW.storage.saveQueue(queue);
      toGuest();
      return true;
    });
  };

  var NICK_RULE = '2~12자, 한글, 영문, 숫자, _만 쓸 수 있어요';
  A.NICK_RULE = NICK_RULE;
  // 결과: { ok: true } 또는 { ok: false, error: '화면에 보일 문구' }
  A.setNickname = function (name) {
    name = String(name || '').trim();
    if (name.normalize) name = name.normalize('NFC');
    if (!/^[가-힣A-Za-z0-9_]{2,12}$/.test(name)) return Promise.resolve({ ok: false, error: NICK_RULE });
    return net.put('me/nickname', { nickname: name }, 8000).then(function (r) {
      if (r.ok && r.data && r.data.nickname) {
        A.nickname = acc.nickname = r.data.nickname; A.nicknameSet = acc.nicknameSet = true;
        LW.storage.saveAccount(acc);
        return { ok: true };
      }
      var e = r.data && r.data.error;
      if (e === 'nickname_taken') return { ok: false, error: '이미 쓰는 이름이에요' };
      if (e === 'too_soon') return { ok: false, error: '닉네임은 하루에 한 번 바꿀 수 있어요' };
      if (e === 'invalid_nickname') return { ok: false, error: '쓸 수 없는 이름이에요. ' + NICK_RULE };
      if (r.status === 401) { toGuest(); return { ok: false, error: '다시 로그인해 주세요' }; }
      return { ok: false, error: r.netError ? '서버에 연결할 수 없어요' : '저장하지 못했어요. 다시 시도해 주세요.' };
    });
  };

  // ===== 설정 동기화(소리, 진동, 데미지 숫자. 화질은 제외) =====
  function syncBody() {
    var s = LW.settings;
    return { settings: { sound: !!s.sound, vibrate: !!s.vibrate, dmgNumbers: !!s.dmgNumbers }, rev: s.rev };
  }
  function syncSettings(st, rev) {
    if (!st) return;
    var local = LW.settings.rev | 0;
    if (rev > local) {
      LW.applySyncedSettings(st, rev);
      if (LW.audio) LW.audio.applySettings();
      if (LW.quality) LW.quality.apply(LW.quality.level);   // 데미지 숫자 설정이 화질 단계의 숫자 상한에 들어간다
    } else if (local > rev) {
      net.put('me/settings', syncBody(), 6000);
    }
  }
  A.onSettingsChanged = function () {
    if (!A.enabled || !A.loggedIn) return;
    clearTimeout(settingsTimer);
    settingsTimer = setTimeout(function () {
      if (A.loggedIn && net.up) net.put('me/settings', syncBody(), 6000);
    }, 1500);
  };

  // ===== 게스트 기록 한 번 합치기 =====
  function importOnce(me) {
    var r = LW.records;
    if (me.imported || acc.importDone || !(r.runs > 0)) return Promise.resolve();
    var body = { records: { bestTime: r.bestTime, bestKills: r.bestKills, bestLevel: r.bestLevel, wins: r.wins, runs: r.runs, fullDawns: r.fullDawns } };
    return net.post('me/import', body, 8000).then(function (res) {
      if (res.ok && res.data && res.data.records) {
        acc.records = recordsOf(res.data.records); acc.importDone = true; acc.imported = true;
        LW.storage.saveAccount(acc);
      } else if (res.status === 409) {
        acc.importDone = true; LW.storage.saveAccount(acc);
      }
    });
  }

  // ===== 시작 표(ticket) =====
  function validTickets() {
    var t = nowSec() + 60, out = [];
    for (var i = 0; i < tickets.length; i++) if (tickets[i].uid === A.uid && tickets[i].expiresAt > t) out.push(tickets[i]);
    return out;
  }
  function pool(t) { if (t) { tickets.push(t); LW.storage.saveTickets(tickets); } }
  // 이 판이 들고 있던 표(예약, 새로 받은 것)를 풀로 돌려놓는다. 끝나지 않은 판을 버릴 때 쓴다.
  function releaseRun() {
    var a = reserved, b = fresh;
    reserved = null; fresh = null;
    pool(a); pool(b);
  }
  function toTicket(uid, o) { return { uid: uid, id: o.id, issuedAt: o.issuedAt, expiresAt: o.expiresAt }; }

  // 미리 받은 표를 LW.TICKET_POOL 장까지 채운다(로그인, 온라인, TITLE 일 때). 만료된 표는 버린다.
  function refillTickets() {
    if (refilling || !A.loggedIn || !net.up || LW.game.state !== 'TITLE') return Promise.resolve();
    var n = nowSec();
    tickets = tickets.filter(function (t) { return t.expiresAt > n; });
    var need = LW.TICKET_POOL - validTickets().length;
    if (need <= 0) { LW.storage.saveTickets(tickets); return Promise.resolve(); }
    refilling = true;
    var uid = A.uid;
    return net.post('runs/tickets', { count: Math.min(5, need) }, 5000).then(function (r) {
      refilling = false;
      if (r.ok && r.data && r.data.tickets && A.uid === uid) {
        for (var i = 0; i < r.data.tickets.length; i++) tickets.push(toTicket(uid, r.data.tickets[i]));
      }
      LW.storage.saveTickets(tickets);
    });
  }
  A.refillTickets = refillTickets;

  // 판 시작: 미리 받은 표 하나를 예약하고, 새 표를 요청한다(3초 제한, 기다리지 않는다)
  A.onRunStart = function () {
    var seq = ++runSeq, uid = A.uid;
    releaseRun();                    // 이전 판이 끝나지 않았다면(타이틀로 나감, 앱 재개) 그 판의 표를 돌려놓는다
    A.resultLine = ''; A.lastRunId = ''; A.lastStatus = '';
    if (!A.enabled || !A.loggedIn) return;
    var list = validTickets();
    // 끝나지 않은 판의 표가 돌아와 풀이 넘치면 가장 최근 표를 쓰고 새 표는 요청하지 않는다.
    // 서버는 미사용 표가 6장을 넘으면 가장 오래된 표를 지우므로, 풀을 넘겨 요청하면 들고 있는 표가 지워진다.
    var over = list.length > LW.TICKET_POOL;
    if (list.length) {
      reserved = over ? list[list.length - 1] : list[0];
      tickets.splice(tickets.indexOf(reserved), 1);
      LW.storage.saveTickets(tickets);
    }
    if (!net.up || over) return;
    net.post('runs/tickets', { count: 1 }, 3000).then(function (r) {
      if (!(r.ok && r.data && r.data.tickets && r.data.tickets[0])) return;
      var t = toTicket(uid, r.data.tickets[0]);
      if (seq === runSeq && A.uid === uid) fresh = t;     // 판이 아직 진행 중이면 이 판이 쓴다
      else if (A.uid === uid) pool(t);                    // 늦게 도착했으면 다음 판을 위해 넣어 둔다
    });
  };

  // 끝나지 않은 판을 버린다(일시정지에서 타이틀로). 표는 풀로 돌아가고 늦게 오는 새 표도 풀로 간다.
  A.onRunAbort = function () {
    runSeq++;
    releaseRun();
  };

  // ===== 판 요약과 제출 =====
  function uuid() {
    var b = new Uint8Array(16), i;
    try { crypto.getRandomValues(b); } catch (e) { for (i = 0; i < 16; i++) b[i] = Math.random() * 256; }
    b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
    var h = '';
    for (i = 0; i < 16; i++) { h += (b[i] + 256).toString(16).slice(1); if (i === 3 || i === 5 || i === 7 || i === 9) h += '-'; }
    return h;
  }
  // g.runStat 의 버퍼(Uint16Array, Uint8Array)를 서버 형식의 일반 배열로 바꾼다. 판이 끝난 뒤라 할당해도 된다.
  function buildSummary(g) {
    var run = g.runStat, won = !!g.won;
    // 승리 판의 timeMs 는 정확히 900000 이어야 한다(승리 프레임의 g.time 은 900 을 조금 넘을 수 있다, 리뷰 B6)
    var timeMs = won ? LW.WIN_TIME * 1000 : Math.max(1, Math.min(LW.WIN_TIME * 1000 - 1, Math.round(g.time * 1000)));
    var len = Math.max(1, Math.min(15, Math.ceil(timeMs / 60000)));
    var kpm = [], lvm = [], i;
    for (i = 0; i < len; i++) { kpm.push(run.kpm[i]); lvm.push(i < run.minute ? run.lvm[i] : g.level); }
    for (i = len; i < 15; i++) kpm[len - 1] += run.kpm[i];      // 분 경계에 딱 걸린 처치는 마지막 칸에 합친다
    lvm[len - 1] = g.level;
    return {
      clientRunId: uuid(), ticket: null, ver: LW.VERSION, timeMs: timeMs, kills: g.kills, level: g.level,
      won: won, fullDawn: !!g.full, elites: run.elites, bosses: run.bosses, kpm: kpm, lvm: lvm,
      endedAt: nowSec()
    };
  }
  A.buildSummary = buildSummary;

  // 판 종료: 로그인 상태면 대기열에 넣고 올린다. 네트워크를 기다리지 않는다.
  A.onRunEnd = function (g) {
    runSeq++;                       // 이 판의 늦은 표 응답은 pool 로 간다
    if (!A.enabled) return;
    if (LW.params.cheat && !LW.params.devLogin) { A.resultLine = '시험 모드: 순위 제외'; releaseRun(); return; }
    if (!A.loggedIn) { A.resultLine = '로그인하면 순위에 오를 수 있어요'; reserved = null; fresh = null; return; }
    var s = buildSummary(g);
    var t = fresh || reserved;
    if (fresh && reserved) pool(reserved);       // 새 표가 도착했으면 그것을 쓰고 미리 받은 표는 돌려놓는다
    if (s.timeMs < 30000) { pool(t); t = null; }   // 30초 미만 판은 서버가 표를 쓰지 않으므로 붙이지 않고 돌려놓는다
    s.ticket = t ? t.id : null;
    reserved = null; fresh = null;
    queue.push({ uid: A.uid, run: s });
    while (queue.length > LW.QUEUE_MAX) queue.shift();     // 가장 오래된 항목부터 버린다
    LW.storage.saveQueue(queue);
    A.lastRunId = s.clientRunId;
    A.lastStatus = 'pending';
    A.resultLine = net.up ? '기록 올리는 중' : '오프라인: 연결되면 올라가요';
    flushQueue();
  };

  var REASON = {
    old_version: '순위 제외: 이전 버전',
    no_ticket: '순위 제외: 시작 표가 없었어요',
    ticket_expired: '순위 제외: 시작 표가 만료됐어요',
    too_short: '순위 제외: 30초 미만'
  };
  function lineOf(res) {
    var st = res.status === 'duplicate' ? res.first : res.status;
    if (st === 'ranked') {
      var rk = res.rank;
      return rk && typeof rk === 'object' ? '순위 반영: 생존 ' + rk.time + '위, 처치 ' + rk.kills + '위' : '순위 반영';
    }
    if (st === 'unranked') return REASON[res.reason] || '순위 제외';
    return '기록이 받아들여지지 않았어요';
  }

  // 같은 uid 의 항목을 20개씩 올린다. 결과를 받은 항목은 지운다. 네트워크 오류와 5xx 는 남기고 다시 시도를 예약한다.
  function flushQueue() {
    if (flushing || !A.enabled || !A.loggedIn || !net.up) return Promise.resolve();
    var items = [], uid = A.uid;
    for (var i = 0; i < queue.length && items.length < 20; i++) if (queue[i].uid === uid) items.push(queue[i]);
    if (!items.length) return Promise.resolve();
    flushing = true;
    return net.post('runs', { runs: items.map(function (q) { return q.run; }) }, 10000).then(function (r) {
      flushing = false;
      if (r.ok && r.data && r.data.results) {
        var done = {}, k;
        for (k = 0; k < r.data.results.length; k++) {
          var res = r.data.results[k];
          done[res.clientRunId] = true;
          if (res.clientRunId === A.lastRunId) { A.lastStatus = res.status; A.resultLine = lineOf(res); }
        }
        queue = queue.filter(function (q) { return !(q.uid === uid && done[q.run.clientRunId]); });
        LW.storage.saveQueue(queue);
        if (r.data.records) { acc.records = recordsOf(r.data.records); LW.storage.saveAccount(acc); }
        invalidateBoards();
        net.resetBackoff('flush');
        return flushQueue();
      }
      if (r.status === 401) { toGuest(); say('다시 로그인해 주세요'); A.resultLine = '다시 로그인하면 기록이 올라가요'; return; }
      if (r.netError || r.status >= 500 || r.status === 429) {
        if (r.netError) { net.up = false; A.status = 'offline'; }
        if (A.lastStatus === 'pending') A.resultLine = '오프라인: 연결되면 올라가요';
        net.schedule('flush', function () { recheck().then(flushQueue); });
        return;
      }
      if (r.status === 403) return;                       // 차단된 계정: 남겨 두고 멈춘다
      // 그 밖의 4xx 는 다시 보내도 같다: 이 묶음을 버린다
      var drop = {};
      for (k = 0; k < items.length; k++) drop[items[k].run.clientRunId] = true;
      queue = queue.filter(function (q) { return !(q.uid === uid && drop[q.run.clientRunId]); });
      LW.storage.saveQueue(queue);
      if (A.lastStatus === 'pending') A.resultLine = '기록이 받아들여지지 않았어요';
    });
  }
  A.flushQueue = flushQueue;

  // ===== 순위표 =====
  function fmtVal(board, e) {
    return board === 'time' ? LW.fmtTime(e.timeMs / 1000) : String(e.kills);
  }
  // 화면에 그릴 문자열을 받을 때 한 번 만든다(그리는 중에는 문자열을 만들지 않는다)
  function prepare(board, data, fetchedAt) {
    var rows = [], i, e;
    var entries = data.entries || [];
    for (i = 0; i < entries.length; i++) {
      e = entries[i];
      rows.push({
        rank: String(e.rank), name: e.nickname, val: fmtVal(board, e),
        sub: (e.fullDawn ? '완전한 새벽  ' : '') + (board === 'time' ? '처치 ' + e.kills : '생존 ' + LW.fmtTime(e.timeMs / 1000)),
        dawn: !!e.fullDawn, mine: A.loggedIn && e.nickname === A.nickname
      });
    }
    var me = data.me, meStr = '';
    if (me) meStr = '내 순위 ' + me.rank + '위   ' + (board === 'time' ? '생존 ' + LW.fmtTime(me.timeMs / 1000) : '처치 ' + me.kills);
    return { rows: rows, meStr: meStr, hasMe: !!me, updatedAt: data.updatedAt | 0, fetchedAt: fetchedAt, stale: false, loading: false, error: false, raw: data };
  }
  ['time', 'kills'].forEach(function (b) {
    var s = saved[b];
    if (s && s.entries) { A.boards[b] = prepare(b, s, s.fetchedAt | 0); A.boards[b].stale = true; }
    else A.boards[b] = { rows: [], meStr: '', hasMe: false, updatedAt: 0, fetchedAt: 0, stale: true, loading: false, error: false, raw: null };
  });
  function invalidateBoards() { A.boardDirty = true; }

  // 성공하면 저장하고, 실패하면 저장본을 그대로 둔 채 stale(저장본) 표시를 켠다
  A.fetchBoard = function (board) {
    var b = A.boards[board];
    if (b.loading) return Promise.resolve(b);
    b.loading = true;
    return net.get('leaderboard?board=' + board + '&limit=50', 8000).then(function (r) {
      if (r.ok && r.data && r.data.entries) {
        var nb = prepare(board, r.data, Date.now());
        A.boards[board] = nb;
        saved[board] = { entries: r.data.entries, me: r.data.me || null, updatedAt: r.data.updatedAt, fetchedAt: nb.fetchedAt };
        LW.storage.saveBoard(saved);
        A.boardDirty = false;
        return nb;
      }
      b.loading = false; b.stale = true; b.error = true;
      if (r.netError) { net.up = false; A.status = 'offline'; net.schedule('health', recheck); }
      return b;
    });
  };
})();
