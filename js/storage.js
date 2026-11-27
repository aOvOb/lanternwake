// localStorage 읽기와 쓰기. 모든 접근을 try/catch로 감싼다.
(function () {
  var KEY_REC = 'lanternwake.v1.records';
  var KEY_SET = 'lanternwake.v1.settings';
  var DEF_REC = { bestTime: 0, bestKills: 0, bestLevel: 0, wins: 0, runs: 0, fullDawns: 0 };
  var DEF_SET = { sound: true, vibrate: true, dmgNumbers: true, quality: 'auto' };

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
  function save(key, obj) {
    try { localStorage.setItem(key, JSON.stringify(obj)); } catch (e) { /* 무시 */ }
  }

  LW.storage = {
    loadRecords: function () { return load(KEY_REC, DEF_REC); },
    saveRecords: function (r) { save(KEY_REC, r); },
    loadSettings: function () { return load(KEY_SET, DEF_SET); },
    saveSettings: function (s) { save(KEY_SET, s); }
  };
  LW.settings = LW.storage.loadSettings();
  LW.records = LW.storage.loadRecords();

  // 설정을 바꾼 뒤 저장한다
  LW.saveSettings = function () { LW.storage.saveSettings(LW.settings); };

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
