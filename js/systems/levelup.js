// 레벨업 후보 생성과 선택. 후보 버퍼와 카드 객체 3개는 미리 만들어 재사용한다(열 때 배열, 객체를 새로 만들지 않는다).
(function () {
  function mkCard() { return { type: '', id: '', name: '', color: '', tag: '', desc: '' }; }
  var lu = LW.levelup = {
    cands: [mkCard(), mkCard(), mkCard()],   // 화면에 보이는 카드 {type, id, name, color, tag, desc}
    n: 0,                                    // 카드 수(1~3)
    focus: 0,
    openedAt: 0
  };

  function fmt(v) { return String(Math.round(v * 100) / 100); }

  // 다음 레벨에서 바뀌는 수치 한 줄
  function weaponDiff(def, lv) {
    var a = def.levels[lv - 1], b = def.levels[lv], out = '', keys = def.keys;
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i];
      if (a[k] !== b[k]) out += (out ? ', ' : '') + def.labels[k] + ' ' + fmt(a[k]) + '→' + fmt(b[k]);
    }
    return out;
  }

  // 후보 풀 버퍼: 종류(0 무기, 1 패시브), 정의, 현재 레벨(0이면 새 항목), 가중치
  var MAXP = 32;
  var pType = new Int8Array(MAXP), pLv = new Int8Array(MAXP), pW = new Float32Array(MAXP), pDef = new Array(MAXP), pn = 0;
  function addCand(type, def, lv, w) {
    if (pn >= MAXP) return;
    pType[pn] = type; pDef[pn] = def; pLv[pn] = lv; pW[pn] = w; pn++;
  }

  // 보유 무기 중 Lv8 미만, 슬롯이 남았으면 아직 없는 무기. 보유 1.5, 새 항목 1.0
  function buildPool() {
    var g = LW.game, list = g.weapons, i, j;
    pn = 0;
    for (i = 0; i < list.length; i++) {
      var w = list[i];
      if (w.lv >= w.def.maxLv || w.evolved) continue;
      addCand(0, w.def, w.lv, 1.5);
    }
    if (list.length < LW.WEAPON_SLOTS) {
      for (i = 0; i < LW.WEAPONS.length; i++) {
        var def = LW.WEAPONS[i], owned = false;
        for (j = 0; j < list.length; j++) if (list[j].def === def) owned = true;
        if (!owned) addCand(0, def, 0, 1.0);
      }
    }
    var pl = g.passives;
    for (i = 0; i < pl.length; i++) {
      if (pl[i].lv >= pl[i].def.maxLv) continue;
      addCand(1, pl[i].def, pl[i].lv, 1.5);
    }
    if (pl.length < LW.PASSIVE_SLOTS) {
      for (i = 0; i < LW.PASSIVES.length; i++) {
        var pd = LW.PASSIVES[i], own = false;
        for (j = 0; j < pl.length; j++) if (pl[j].def === pd) own = true;
        if (!own) addCand(1, pd, 0, 1.0);
      }
    }
  }

  // 후보 i를 카드 c에 채운다
  function fillCard(c, i) {
    var def = pDef[i], lv = pLv[i];
    c.type = pType[i] === 0 ? 'weapon' : 'passive';
    c.id = def.id; c.name = def.name; c.color = def.color;
    if (lv > 0) {
      c.tag = 'Lv ' + lv + ' → ' + (lv + 1);
      c.desc = pType[i] === 0 ? weaponDiff(def, lv) : def.desc;
    } else {
      c.tag = '새로 얻음';
      c.desc = pType[i] === 0 ? '레벨 1' : def.desc;
    }
  }

  lu.open = function () {
    var g = LW.game, i;
    buildPool();
    if (pn === 0) {
      var h = lu.cands[0];
      h.type = 'heal'; h.id = 'oil'; h.name = '등잔 기름'; h.color = '#ffd34d'; h.tag = '회복'; h.desc = 'HP 30 회복';
      lu.n = 1;
    } else {
      // 중복 없이 최대 3개. 뽑은 항목은 맨 뒤 항목으로 덮어 뺀다.
      lu.n = 0;
      while (lu.n < 3 && pn > 0) {
        var total = 0;
        for (i = 0; i < pn; i++) total += pW[i];
        var r = LW.rand() * total, pick = pn - 1;
        for (i = 0; i < pn; i++) { r -= pW[i]; if (r < 0) { pick = i; break; } }
        fillCard(lu.cands[lu.n++], pick);
        var last = --pn;
        pType[pick] = pType[last]; pDef[pick] = pDef[last]; pLv[pick] = pLv[last]; pW[pick] = pW[last];
      }
    }
    lu.focus = 0;
    lu.openedAt = performance.now();
    g.setState('LEVELUP');
    LW.input.onOverlayOpen();
    LW.audio.levelup();
  };

  lu.choose = function (i) {
    var g = LW.game;
    if (g.state !== 'LEVELUP' || i < 0 || i >= lu.n) return;
    var c = lu.cands[i];
    if (c.type === 'weapon') {
      var list = g.weapons, found = null;
      for (var k = 0; k < list.length; k++) if (list[k].def.id === c.id) found = list[k];
      if (found) found.lv++;
      else list.push(LW.makeWeapon(c.id, list.length));
    } else if (c.type === 'passive') {
      var pl = g.passives, pf = null;
      for (var q = 0; q < pl.length; q++) if (pl[q].def.id === c.id) pf = pl[q];
      if (pf) pf.lv++;
      else pl.push({ def: LW.PASSIVE_BY_ID[c.id], lv: 1 });
    } else if (c.type === 'heal') {
      var P = LW.player;
      P.hp = Math.min(P.maxHp, P.hp + 30);
    }
    LW.player.recomputeStats();
    g.pending--;
    if (g.pending > 0) lu.open();      // 여러 레벨을 넘었으면 창이 연속으로 뜬다
    else g.setState('PLAYING');
  };

  // ===== 상자 =====
  // 일반 상자: 진화 가능한 무기가 있으면 그중 하나를 진화, 없으면 보유 항목 하나를 레벨업, 그것도 없으면 HP 30 회복.
  // 보스 상자는 이 판정을 3회 반복한다. 결과는 CHEST 창에 목록으로 보여준다.
  var chest = LW.chest = { results: [], boss: false, openedAt: 0 };
  var evoBuf = [], itemBuf = [];

  function findEvolvable(out) {
    var g = LW.game, list = g.weapons, i, j;
    out.length = 0;
    for (i = 0; i < list.length; i++) {
      var w = list[i];
      if (w.evolved || w.lv < w.def.maxLv) continue;
      var evo = LW.EVO_BY_WEAPON[w.def.id];
      if (!evo) continue;
      for (j = 0; j < g.passives.length; j++) {
        if (g.passives[j].def.id === evo.passive && g.passives[j].lv >= 1) { out.push(w); break; }
      }
    }
    return out;
  }
  chest.hasEvolvable = function () { return findEvolvable(evoBuf).length > 0; };

  function rollOne() {
    var g = LW.game, P = LW.player, i;
    var evs = findEvolvable(evoBuf);
    if (evs.length > 0) {
      var w = evs[(LW.rand() * evs.length) | 0], evo = LW.EVO_BY_WEAPON[w.def.id];
      var from = w.def.name;
      w.evolved = true; w.evo = evo; w.cdT = 0.2; w.stT = 0.2; w.on = false; w.burstLeft = 0; w.volley = 0;
      chest.results.push({ text: '진화! ' + from + ' → ' + evo.name, color: evo.color, evo: true });
      return;
    }
    itemBuf.length = 0;
    for (i = 0; i < g.weapons.length; i++) {
      if (g.weapons[i].lv < g.weapons[i].def.maxLv && !g.weapons[i].evolved) itemBuf.push(g.weapons[i]);
    }
    for (i = 0; i < g.passives.length; i++) {
      if (g.passives[i].lv < g.passives[i].def.maxLv) itemBuf.push(g.passives[i]);
    }
    if (itemBuf.length > 0) {
      var it = itemBuf[(LW.rand() * itemBuf.length) | 0];
      var nm = it.evo ? it.evo.name : it.def.name;
      chest.results.push({ text: nm + ' Lv ' + it.lv + ' → ' + (it.lv + 1), color: it.def.color, evo: false });
      it.lv++;
      return;
    }
    P.hp = Math.min(P.maxHp, P.hp + 30);
    chest.results.push({ text: 'HP 30 회복', color: '#ffd34d', evo: false });
  }

  chest.open = function (boss) {
    var g = LW.game, rolls = boss ? 3 : 1;
    chest.results.length = 0;
    chest.boss = !!boss;
    for (var i = 0; i < rolls; i++) {
      rollOne();
      LW.player.recomputeStats();
    }
    g.chestsOpened++;
    chest.openedAt = performance.now();
    g.setState('CHEST');
    LW.input.onOverlayOpen();
    LW.audio.chest();
  };

  chest.close = function () {
    var g = LW.game;
    if (g.state !== 'CHEST') return;
    g.setState('PLAYING');
  };
})();
