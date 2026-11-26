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
})();
