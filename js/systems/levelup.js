// 레벨업 후보 생성과 선택. 패시브 후보는 S6에서 같은 방식으로 더한다.
(function () {
  var lu = LW.levelup = {
    cands: [],       // 후보 카드 {type, id, name, color, tag, desc}
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

  // 후보 풀: 보유 무기 중 Lv8 미만, 슬롯이 남았으면 아직 없는 무기. 보유 1.5, 새 항목 1.0
  function buildPool(out, ws) {
    var g = LW.game, list = g.weapons, i, j;
    for (i = 0; i < list.length; i++) {
      var w = list[i];
      if (w.lv >= w.def.maxLv || w.evolved) continue;
      out.push({
        type: 'weapon', id: w.def.id, name: w.def.name, color: w.def.color,
        tag: 'Lv ' + w.lv + ' → ' + (w.lv + 1), desc: weaponDiff(w.def, w.lv)
      });
      ws.push(1.5);
    }
    if (list.length < LW.WEAPON_SLOTS) {
      for (i = 0; i < LW.WEAPONS.length; i++) {
        var def = LW.WEAPONS[i], owned = false;
        for (j = 0; j < list.length; j++) if (list[j].def === def) owned = true;
        if (owned) continue;
        out.push({ type: 'weapon', id: def.id, name: def.name, color: def.color, tag: '새로 얻음', desc: '레벨 1' });
        ws.push(1.0);
      }
    }
  }

  function buildPassives(out, ws) {
    var g = LW.game, list = g.passives, i, j;
    for (i = 0; i < list.length; i++) {
      var p = list[i];
      if (p.lv >= p.def.maxLv) continue;
      out.push({ type: 'passive', id: p.def.id, name: p.def.name, color: p.def.color,
        tag: 'Lv ' + p.lv + ' → ' + (p.lv + 1), desc: p.def.desc });
      ws.push(1.5);
    }
    if (list.length < LW.PASSIVE_SLOTS) {
      for (i = 0; i < LW.PASSIVES.length; i++) {
        var def = LW.PASSIVES[i], owned = false;
        for (j = 0; j < list.length; j++) if (list[j].def === def) owned = true;
        if (owned) continue;
        out.push({ type: 'passive', id: def.id, name: def.name, color: def.color, tag: '새로 얻음', desc: def.desc });
        ws.push(1.0);
      }
    }
  }

  lu.open = function () {
    var g = LW.game;
    var pool = [], ws = [];
    buildPool(pool, ws);
    buildPassives(pool, ws);
    lu.cands = [];
    if (pool.length === 0) {
      lu.cands.push({ type: 'heal', id: 'oil', name: '등잔 기름', color: '#ffd34d', tag: '회복', desc: 'HP 30 회복' });
    } else {
      // 중복 없이 최대 3개
      for (var n = 0; n < 3 && pool.length > 0; n++) {
        var total = 0, i;
        for (i = 0; i < ws.length; i++) total += ws[i];
        var pick = LW.weightedPick(ws, total);
        lu.cands.push(pool[pick]);
        pool.splice(pick, 1); ws.splice(pick, 1);
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
    if (g.state !== 'LEVELUP' || i < 0 || i >= lu.cands.length) return;
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
