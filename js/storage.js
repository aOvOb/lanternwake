// localStorage 읽기와 쓰기. 모든 접근을 try/catch로 감싼다.
(function () {
  var KEY_REC = 'lanternwake.v1.records';
  var KEY_SET = 'lanternwake.v1.settings';
  var DEF_REC = { bestTime: 0, bestKills: 0, bestLevel: 0, wins: 0, runs: 0, fullDawns: 0 };
  // rev는 동기화 대상(소리, 진동, 데미지 숫자)을 마지막으로 바꾼 시각(ms)이다
  var DEF_SET = { sound: true, vibrate: true, dmgNumbers: true, quality: 'auto', rev: 0 };
  var KEY_ACC = 'lanternwake.v1.account';
  var KEY_QUEUE = 'lanternwake.v1.queue';
  var KEY_TICKETS = 'lanternwake.v1.tickets';
  var KEY_BOARD = 'lanternwake.v1.board';
  // 계정 정보: uid 0이면 게스트. records는 서버 기록(ms 단위)의 사본이다.
  var DEF_ACC = {
    uid: 0, nickname: '', nicknameSet: false, imported: false, importDone: false,
    records: { bestTimeMs: 0, bestKills: 0, bestLevel: 0, wins: 0, runs: 0, fullDawns: 0 }
  };

  function load(key, def) {
    var out = {}, k;
    for (k in def) out[k] = def[k];
    try {
      var raw = localStorage.getItem(key);
      if (raw) {
        var o = JSON.parse(raw);
        for (k in def) if (typeof o[k] === typeof def[k]) out[k] = o[k];
      }
    } catch (e) { /* 저장소를 못 쓰면 기본값으로 진행 */ }
    return out;
  }
  // 배열이나 객체를 그대로 읽는다(형식이 다르면 기본값)
  function loadRaw(key, def) {
    try {
      var raw = localStorage.getItem(key);
      if (raw) {
        var o = JSON.parse(raw);
        if (o && typeof o === 'object' && Array.isArray(o) === Array.isArray(def)) return o;
      }
    } catch (e) { /* 무시 */ }
    return def;
  }
  function save(key, obj) {
    try { localStorage.setItem(key, JSON.stringify(obj)); } catch (e) { /* 무시 */ }
  }

  LW.storage = {
    loadRecords: function () { return load(KEY_REC, DEF_REC); },
    saveRecords: function (r) { save(KEY_REC, r); },
    loadSettings: function () { return load(KEY_SET, DEF_SET); },
    saveSettings: function (s) { save(KEY_SET, s); },
    loadAccount: function () {
      var a = load(KEY_ACC, DEF_ACC);
      a.records = load2(a.records, DEF_ACC.records);
      return a;
    },
    saveAccount: function (a) { save(KEY_ACC, a); },
    loadQueue: function () { return loadRaw(KEY_QUEUE, []); },
    saveQueue: function (q) { save(KEY_QUEUE, q); },
    loadTickets: function () { return loadRaw(KEY_TICKETS, []); },
    saveTickets: function (t) { save(KEY_TICKETS, t); },
    loadBoard: function () { return loadRaw(KEY_BOARD, {}); },
    saveBoard: function (b) { save(KEY_BOARD, b); }
  };
  // 저장된 객체의 숫자 필드만 기본값 위에 얹는다
  function load2(o, def) {
    var out = {}, k;
    for (k in def) out[k] = o && typeof o[k] === typeof def[k] ? o[k] : def[k];
    return out;
  }
  LW.settings = LW.storage.loadSettings();
  LW.records = LW.storage.loadRecords();

  // 설정을 바꾼 뒤 저장한다. 동기화 대상 값이 바뀌었으면 rev를 지금 시각으로 올리고 계정 모듈에 알린다(화질은 기기마다 달라 제외).
  function syncSig(s) { return (s.sound ? 1 : 0) + '' + (s.vibrate ? 1 : 0) + (s.dmgNumbers ? 1 : 0); }
  var lastSig = syncSig(LW.settings);
  LW.saveSettings = function () {
    var sig = syncSig(LW.settings), changed = sig !== lastSig;
    if (changed) { lastSig = sig; LW.settings.rev = Date.now(); }
    LW.storage.saveSettings(LW.settings);
    if (changed && LW.account) LW.account.onSettingsChanged();
  };
  // 서버 설정을 받아 적용한다(저장은 하고 rev는 서버 값으로 맞춘다)
  LW.applySyncedSettings = function (st, rev) {
    var s = LW.settings;
    s.sound = !!st.sound; s.vibrate = !!st.vibrate; s.dmgNumbers = !!st.dmgNumbers; s.rev = rev;
    lastSig = syncSig(s);
    LW.storage.saveSettings(s);
  };

  // 진행 중인 판의 최고 기록(시간, 처치, 레벨)만 갱신해 저장한다. 백그라운드 전환 때 부른다(강제 종료 대비).
  // 판 수, 승리 수는 올리지 않는다. 바뀐 것이 있으면 true.
  LW.commitProgress = function (g) {
    var r = LW.records, t = Math.floor(g.time), ch = false;
    if (t > r.bestTime) { r.bestTime = t; ch = true; }
    if (g.kills > r.bestKills) { r.bestKills = g.kills; ch = true; }
    if (g.level > r.bestLevel) { r.bestLevel = g.level; ch = true; }
    if (ch) LW.storage.saveRecords(r);
    return ch;
  };

  // 판이 끝났을 때: 최고 기록과 판 수, 승리 수, 완전한 새벽 수를 저장한다
  LW.finishRun = function (g, won, full) {
    var r = LW.records;
    LW.commitProgress(g);
    r.runs++;
    if (won) r.wins++;
    if (full) r.fullDawns++;
    LW.storage.saveRecords(r);
  };
})();
