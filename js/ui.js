// 캔버스 UI: HUD, 버튼, 레벨업 카드, 타이틀, 일시정지, 임시 결과 화면, 탭 판정
(function () {
  var ui = LW.ui = { dbgOverlay: LW.params.debug && LW.params.autotest > 0 };
  var FONT = LW.FONT;
  var TAU = Math.PI * 2;

  // ===== 버튼 목록(프레임마다 layout으로 다시 만든다) =====
  var btns = [];
  for (var bi = 0; bi < 12; bi++) btns.push({ id: '', x: 0, y: 0, w: 0, h: 0, label: '', kind: 0 });
  var nBtn = 0;
  var pressId = new Int32Array(8), pressBid = ['', '', '', '', '', '', '', ''], nPress = 0;   // 누른 포인터와 누른 버튼 id
  var CARD_IDS = ['c0', 'c1', 'c2'];

  function addBtn(id, x, y, w, h, label, kind) {
    if (nBtn >= btns.length) return null;
    var b = btns[nBtn++];
    b.id = id; b.x = x; b.y = y; b.w = w; b.h = h; b.label = label || ''; b.kind = kind || 0;
    return b;
  }
  function btnAt(x, y) {
    for (var i = nBtn - 1; i >= 0; i--) {
      var b = btns[i];
      if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) return i;
    }
    return -1;
  }
  ui.hit = function (x, y) { return btnAt(x, y) >= 0; };
  ui.clearPress = function () { nPress = 0; };
  ui.onResize = function () { /* 문자 캐시는 ppu가 바뀌면 setSpr가 알아서 다시 그린다 */ };

  // ===== 캐시되는 문자 =====
  function makeSpr() { return { val: null, k: 0, cv: document.createElement('canvas'), w: 0, h: 0 }; }
  // 값이 바뀌었는지 먼저 확인해서, 바뀔 때만 문자열을 만든다
  function spChg(s, val) { return s.val !== val || s.k !== LW.render.ppu; }
  function setSpr(s, val, str, size, color, weight) {
    var k = LW.render.ppu;
    if (s.val === val && s.k === k) return;
    s.val = val; s.k = k;
    var c = s.cv, cx = c.getContext('2d');
    var font = (weight || 'bold') + ' ' + (size * k) + 'px ' + FONT;
    cx.font = font;
    var w = Math.ceil(cx.measureText(str).width) + 6, h = Math.ceil(size * k * 1.4) + 2;
    c.width = w; c.height = h;
    cx.font = font;
    cx.textBaseline = 'top';
    cx.lineJoin = 'round';
    cx.lineWidth = 3 * k * 0.6;
    cx.strokeStyle = 'rgba(0,0,0,0.7)';
    cx.fillStyle = color;
    cx.strokeText(str, 3, size * k * 0.12);
    cx.fillText(str, 3, size * k * 0.12);
    s.w = w / k; s.h = h / k;
  }
  // align: 0 왼쪽, 1 가운데, 2 오른쪽
  function drawSpr(ctx, s, x, y, align) {
    if (align === 1) x -= s.w / 2; else if (align === 2) x -= s.w;
    ctx.drawImage(s.cv, x, y, s.w, s.h);
  }
  var sprLv = makeSpr(), sprTime = makeSpr(), sprKills = makeSpr(), sprBoss = makeSpr();
  var sprW = [], sprP = [];
  for (var si = 0; si < 6; si++) { sprW.push(makeSpr()); sprP.push(makeSpr()); }

  // ===== 글자 도우미(오버레이와 타이틀용) =====
  // 폰트 문자열은 (굵기, 크기)마다 한 번만 만들고, 같은 폰트면 ctx.font를 다시 지정하지 않는다
  var FONTS = { bold: {}, normal: {} }, curFont = '';
  function fontOf(size, weight) {
    var t = weight === 'normal' ? FONTS.normal : FONTS.bold;
    return t[size] || (t[size] = (weight === 'normal' ? 'normal ' : 'bold ') + size + 'px ' + FONT);
  }
  function text(ctx, str, x, y, size, color, align, weight) {
    var f = fontOf(size, weight);
    if (f !== curFont) { ctx.font = f; curFont = f; }
    ctx.textAlign = align || 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = color;
    ctx.fillText(str, x, y);
  }
  function rrect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  // ===== 레이아웃 =====
  // 설정 버튼 라벨은 상수로 두어 프레임마다 문자열을 만들지 않는다
  var L_SOUND = ['소리: 꺼짐', '소리: 켜짐'], L_VIB = ['진동: 꺼짐', '진동: 켜짐'], L_DMG = ['데미지 숫자: 꺼짐', '데미지 숫자: 켜짐'];
  var L_Q = { auto: '화질: 자동', high: '화질: 높음', low: '화질: 낮음' };
  var confirmTitle = false;               // 일시정지에서 "타이틀로"를 한 번 눌렀는지
  ui.settingsFrom = 'TITLE';              // 설정 화면을 연 곳(TITLE 또는 PAUSED)
  ui.bestStr = '';                        // 타이틀의 최고 기록 한 줄
  ui.onState = function () { confirmTitle = false; };
  var cardN = 0;
  ui.layout = function () {
    var g = LW.game, v = LW.view, s = LW.safe;
    var MIN = 44 / v.scale;
    nBtn = 0;
    var st = g.state;
    if (st === 'PLAYING') {
      var bs = Math.max(MIN, 44);
      addBtn('pause', v.w - s.r - 8 - bs, s.t + 14, bs, bs, 'II', 1);
      if (LW.params.debug) {
        var ds = Math.max(MIN, 40);
        addBtn('d_time', v.w - s.r - 8 - ds, s.t + 14 + bs + 8, ds, ds, '+60', 2);
        addBtn('d_lvl', v.w - s.r - 8 - ds, s.t + 14 + bs + 8 + (ds + 6), ds, ds, 'LV', 2);
        addBtn('d_ovl', v.w - s.r - 8 - ds, s.t + 14 + bs + 8 + (ds + 6) * 2, ds, ds, 'F2', 2);
      }
    } else if (st === 'TITLE') {
      var th = Math.max(MIN, 44), tcx = v.portrait ? v.w / 2 : v.w * 0.7;
      addBtn('settings', tcx - 60, v.h - s.b - 16 - th, 120, th, '설정', 3);
    } else if (st === 'PAUSED') {
      var bh = Math.max(MIN, 52), y1 = v.h / 2 - bh * 1.5 - 12;
      addBtn('resume', v.w / 2 - 110, y1, 220, bh, '계속', 3);
      addBtn('settings', v.w / 2 - 110, y1 + bh + 12, 220, bh, '설정', 3);
      addBtn('title', v.w / 2 - 110, y1 + (bh + 12) * 2, 220, bh, confirmTitle ? '정말 나갈까요? 한 번 더' : '타이틀로', 3);
    } else if (st === 'SETTINGS') {
      var sh = Math.max(MIN, 48), sy = v.h / 2 - (sh * 5 + 14 * 4) / 2 + 20;
      var cfg = LW.settings;
      addBtn('set_sound', v.w / 2 - 120, sy, 240, sh, L_SOUND[cfg.sound ? 1 : 0], 3);
      addBtn('set_vib', v.w / 2 - 120, sy + (sh + 14), 240, sh, L_VIB[cfg.vibrate ? 1 : 0], 3);
      addBtn('set_dmg', v.w / 2 - 120, sy + (sh + 14) * 2, 240, sh, L_DMG[cfg.dmgNumbers ? 1 : 0], 3);
      addBtn('set_q', v.w / 2 - 120, sy + (sh + 14) * 3, 240, sh, L_Q[cfg.quality] || L_Q.auto, 3);
      addBtn('back', v.w / 2 - 120, sy + (sh + 14) * 4, 240, sh, '뒤로', 3);
    } else if (st === 'RESULT') {
      var rh = Math.max(MIN, 52);
      if (v.portrait) {
        var ry = v.h - s.b - 20 - rh * 2 - 12;
        addBtn('retry', v.w / 2 - 100, ry, 200, rh, '다시 하기', 3);
        addBtn('title', v.w / 2 - 100, ry + rh + 12, 200, rh, '타이틀', 3);
      } else {
        var ry2 = v.h - s.b - 16 - rh, cx2 = v.w * 0.22;
        addBtn('retry', cx2 - 155, ry2, 150, rh, '다시 하기', 3);
        addBtn('title', cx2 + 5, ry2, 150, rh, '타이틀', 3);
      }
    } else if (st === 'CHEST') {
      addBtn('chest_ok', 0, 0, v.w, v.h, '', 5);
    } else if (st === 'LEVELUP') {
      var n = LW.levelup.n;
      cardN = n;
      if (v.portrait) {
        var cw = Math.min(v.w - 32, 400), gap = 12;
        var avail = v.h - s.t - s.b - 120;
        var ch = Math.min(120, (avail - gap * (n - 1)) / n);
        var y0 = v.h / 2 - (ch * n + gap * (n - 1)) / 2 + 24;
        for (var i = 0; i < n; i++) addBtn(CARD_IDS[i], (v.w - cw) / 2, y0 + i * (ch + gap), cw, ch, '', 4);
      } else {
        var gap2 = 14;
        var cw2 = Math.min(240, (v.w - s.l - s.r - 32 - gap2 * (n - 1)) / n);
        var ch2 = Math.min(150, v.h - s.t - s.b - 100);
        var x0 = v.w / 2 - (cw2 * n + gap2 * (n - 1)) / 2;
        for (var j = 0; j < n; j++) addBtn(CARD_IDS[j], x0 + j * (cw2 + gap2), v.h / 2 - ch2 / 2 + 22, cw2, ch2, '', 4);
      }
    }
  };

  // ===== 입력 처리 =====
  ui.act = function (id) {
    var g = LW.game, cfg = LW.settings;
    switch (id) {
      case 'pause': g.setState('PAUSED'); break;
      case 'resume': g.setState('PLAYING'); break;
      case 'retry': g.start(); break;
      case 'title':
        if (g.state === 'PAUSED') {
          // 한 번 더 눌러야 나간다. 나가기 전에 진행 중인 기록을 저장한다.
          if (!confirmTitle) { confirmTitle = true; break; }
          LW.commitProgress(g);
          ui.refreshBest();
        }
        g.setState('TITLE');
        break;
      case 'settings': ui.settingsFrom = g.state === 'PAUSED' ? 'PAUSED' : 'TITLE'; g.setState('SETTINGS'); break;
      case 'back': g.setState(ui.settingsFrom); break;
      case 'set_sound': cfg.sound = !cfg.sound; LW.saveSettings(); LW.audio.applySettings(); break;
      case 'set_vib': cfg.vibrate = !cfg.vibrate; LW.saveSettings(); LW.audio.vibrate(30); break;
      case 'set_dmg': cfg.dmgNumbers = !cfg.dmgNumbers; LW.saveSettings(); LW.quality.apply(LW.quality.level); break;
      case 'set_q':
        cfg.quality = cfg.quality === 'auto' ? 'high' : (cfg.quality === 'high' ? 'low' : 'auto');
        LW.saveSettings();
        LW.quality.reset();
        LW.platform.resize();
        break;
      case 'c0': LW.levelup.choose(0); break;
      case 'c1': LW.levelup.choose(1); break;
      case 'c2': LW.levelup.choose(2); break;
      case 'chest_ok': LW.chest.close(); break;
      case 'd_time': g.time += 60; break;
      case 'd_lvl': g.addXp(g.xpNeed - g.xp); break;
      case 'd_ovl': ui.dbgOverlay = !ui.dbgOverlay; break;
    }
  };

  // 타이틀의 최고 기록 한 줄을 다시 만든다(저장된 기록이 바뀔 때만 부른다)
  ui.refreshBest = function () {
    var r = LW.records;
    ui.bestStr = r.runs > 0 || r.bestTime > 0
      ? '최고 기록  ' + LW.fmtTime(r.bestTime) + '   처치 ' + r.bestKills + '   레벨 ' + r.bestLevel + (r.wins > 0 ? '   승리 ' + r.wins : '')
      : '';
  };

  // 결과 화면에 보일 문자열과 무기별 누적 피해 줄을 판이 끝날 때 한 번 만든다
  var res = ui.res = { head: '', sub: '', stat: '', best: '', rows: [], total: 0 };
  ui.buildResult = function (g) {
    var won = g.won;
    res.head = won ? (g.full ? '완전한 새벽' : '새벽이 밝았다') : '등불이 꺼졌다';
    res.sub = won && g.full ? '마지막 그림자를 쓰러뜨렸다' : '';
    res.stat = '생존 ' + LW.fmtTime(g.time) + '   레벨 ' + g.level + '   처치 ' + g.kills;
    var nb = g.newBest, parts = '';
    if (nb.time) parts += '시간';
    if (nb.kills) parts += (parts ? ', ' : '') + '처치';
    if (nb.level) parts += (parts ? ', ' : '') + '레벨';
    res.best = parts ? '최고 기록 갱신: ' + parts : '';
    res.rows.length = 0;
    var max = 1, i;
    res.total = 0;
    for (i = 0; i < g.weapons.length; i++) { if (g.dmgBySlot[i] > max) max = g.dmgBySlot[i]; res.total += g.dmgBySlot[i]; }
    for (i = 0; i < g.weapons.length; i++) {
      var w = g.weapons[i], d = Math.round(g.dmgBySlot[i]);
      res.rows.push({ name: LW.weaponName(w) + ' Lv' + w.lv, color: LW.weaponColor(w), str: String(d), ratio: g.dmgBySlot[i] / max });
    }
  };

  // 디버그 W키: 무기 8종의 Lv1과 Lv8을 하나씩 차례로 단독 장착한다
  var dbgW = -1;
  function dbgCycleWeapon() {
    var g = LW.game;
    dbgW = (dbgW + 1) % (LW.WEAPONS.length * 2);
    var w = LW.makeWeapon(LW.WEAPONS[dbgW >> 1].id, 0);
    w.lv = (dbgW & 1) ? w.def.maxLv : 1;
    g.weapons = [w];
    LW.player.recomputeStats();
  }

  // 디버그 E키: 엘리트를 하나 만든다(있는 일반 적 종류를 차례로)
  var dbgE = 0;
  function dbgElite() {
    var ids = ['mite', 'moth', 'mudling', 'spore', 'rusthelm', 'eye', 'boar'], k = 0, id;
    for (var tries = 0; tries < ids.length; tries++) {
      id = ids[dbgE++ % ids.length];
      if (LW.ENEMIES[id]) { LW.spawner.spawnElite(id); return; }
    }
  }

  // 디버그 B키: 보스 3종을 차례로 바로 만든다
  var dbgB = 0;
  function dbgBoss() {
    var ids = ['colossus', 'queen', 'last'];
    LW.spawner.spawnBossAt(ids[dbgB++ % 3]);
  }

  function handleKey(code) {
    var g = LW.game, st = g.state, lu = LW.levelup;
    if (LW.params.debug && code === 'F2') { ui.dbgOverlay = !ui.dbgOverlay; return; }
    if (code === 'KeyM' && st !== 'LEVELUP' && st !== 'CHEST') {
      LW.settings.sound = !LW.settings.sound; LW.saveSettings(); LW.audio.applySettings();
      return;
    }
    if (st === 'TITLE') {
      if (code === 'Enter' || code === 'Space') g.start();
    } else if (st === 'SETTINGS') {
      if (code === 'Escape' || code === 'Backspace') ui.act('back');
    } else if (st === 'PLAYING') {
      if (code === 'Escape' || code === 'KeyP') g.setState('PAUSED');
      else if (LW.params.debug) {
        if (code === 'KeyL') g.addXp(g.xpNeed - g.xp);
        else if (code === 'KeyT') g.time += 60;
        else if (code === 'KeyI') g.god = !g.god;
        else if (code === 'KeyW') dbgCycleWeapon();
        else if (code === 'KeyE') dbgElite();
        else if (code === 'KeyB') dbgBoss();
        else if (code === 'KeyC') g.giveChest(false);
        else if (code === 'KeyK') LW.spawnCandle(true);
      }
    } else if (st === 'PAUSED') {
      if (code === 'Escape' || code === 'KeyP' || code === 'Enter') g.setState('PLAYING');
    } else if (st === 'LEVELUP') {
      var n = lu.n;
      if (code === 'Digit1') lu.choose(0);
      else if (code === 'Digit2') lu.choose(1);
      else if (code === 'Digit3') lu.choose(2);
      else if (code === 'ArrowUp' || code === 'ArrowLeft') lu.focus = (lu.focus + n - 1) % n;
      else if (code === 'ArrowDown' || code === 'ArrowRight') lu.focus = (lu.focus + 1) % n;
      else if (code === 'Enter') lu.choose(lu.focus);
    } else if (st === 'CHEST') {
      if (code === 'Enter' || code === 'Space') LW.chest.close();
    } else if (st === 'RESULT') {
      if (code === 'Enter') g.start();
    }
  }

  ui.handleInput = function () {
    var inp = LW.input, g = LW.game, i, k;
    ui.layout();
    for (i = 0; i < inp.evN; i++) {
      var type = inp.evType[i], id = inp.evId[i], x = inp.evX[i], y = inp.evY[i];
      if (type === 0) {
        if (nPress < 8) {
          var bi0 = btnAt(x, y);
          pressId[nPress] = id; pressBid[nPress] = bi0 >= 0 ? btns[bi0].id : ''; nPress++;
        }
      } else {
        var idx = -1;
        for (k = 0; k < nPress; k++) if (pressId[k] === id) { idx = k; break; }
        if (idx < 0) continue;
        var bid = pressBid[idx];
        pressId[idx] = pressId[nPress - 1]; pressBid[idx] = pressBid[nPress - 1]; nPress--;
        if (type === 2) continue;
        if (bid !== '') {
          // 누른 버튼과 같은 버튼(id) 위에서 뗐을 때만 눌린 것으로 본다. 배열 위치는 레이아웃이 바뀌면 달라질 수 있다.
          var cur = btnAt(x, y);
          if (cur >= 0 && btns[cur].id === bid) { ui.act(bid); ui.layout(); }
        } else if (g.state === 'TITLE') {
          g.start();
        }
      }
    }
    inp.evN = 0;
    for (i = 0; i < inp.keyN; i++) handleKey(inp.keyQ[i]);
    inp.keyN = 0;
  };

  // ===== 그리기 =====
  function drawHud(ctx, g) {
    var v = LW.view, s = LW.safe, P = LW.player;
    var k = LW.render.ppu;
    // 경험치 바
    var bx = 0, bw = v.w, by = s.t, bh = 8;
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(bx, by, bw, bh);
    ctx.fillStyle = '#4fc3f7';
    var ratio = g.xpNeed > 0 ? g.xp / g.xpNeed : 0;
    ctx.fillRect(bx, by, bw * Math.min(1, ratio), bh);

    // 레벨, 타이머, 처치 수
    var ty = s.t + 14;
    if (spChg(sprLv, g.level)) setSpr(sprLv, g.level, 'Lv ' + g.level, 15, '#ffe9a8');
    drawSpr(ctx, sprLv, s.l + 8, ty, 0);
    var sec = Math.floor(g.time);
    if (spChg(sprTime, sec)) setSpr(sprTime, sec, LW.fmtTime(sec), 18, '#ffffff');
    drawSpr(ctx, sprTime, v.w / 2, ty, 1);
    var pauseW = Math.max(44 / v.scale, 44);
    if (spChg(sprKills, g.kills)) setSpr(sprKills, g.kills, '처치 ' + g.kills, 14, '#e8e8f0');
    drawSpr(ctx, sprKills, v.w - s.r - 8 - pauseW - 8, ty, 2);

    // 무기와 패시브 칸(표시 전용)
    var sz = 28, gap = 4, i, sx, sy;
    for (i = 0; i < LW.WEAPON_SLOTS; i++) {
      if (v.portrait) { sx = s.l + 8 + i * (sz + gap); sy = v.h - s.b - 8 - sz * 2 - gap; }
      else { sx = s.l + 8; sy = s.t + 48 + i * (sz + gap); }
      slot(ctx, sx, sy, sz, g.weapons[i], sprW[i]);
      if (v.portrait) { sx = s.l + 8 + i * (sz + gap); sy = v.h - s.b - 8 - sz; }
      else { sx = s.l + 8 + sz + gap; sy = s.t + 48 + i * (sz + gap); }
      slot(ctx, sx, sy, sz, g.passives[i], sprP[i]);
    }
  }

  // 보스 HP 바(경험치 바 아래)와 경고 배너
  function drawBoss(ctx, g) {
    var v = LW.view, s = LW.safe, b = LW.enemies.boss;
    if (b && b.active && b.boss) {
      var bw = Math.min(v.w - 150, 300), bx = (v.w - bw) / 2, by = s.t + 44;
      ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(bx - 2, by - 2, bw + 4, 12);
      ctx.fillStyle = '#c0392b'; ctx.fillRect(bx, by, bw * Math.max(0, b.hp / b.maxHp), 8);
      setSpr(sprBoss, b.def.name, b.def.name, 12, '#ffd9d9');
      drawSpr(ctx, sprBoss, v.w / 2, by + 11, 1);
    }
    if (g.bannerT > 0) {
      var by2 = v.h * 0.22, h = 54;
      var a = Math.min(1, g.bannerT / 0.4) * (0.75 + 0.25 * Math.sin(performance.now() / 90));
      ctx.globalAlpha = a;
      ctx.fillStyle = 'rgba(150,20,30,0.8)'; ctx.fillRect(0, by2, v.w, h);
      ctx.fillStyle = '#ff6a6a'; ctx.fillRect(0, by2, v.w, 3); ctx.fillRect(0, by2 + h - 3, v.w, 3);
      text(ctx, g.bannerText, v.w / 2, by2 + h / 2, 20, '#ffffff');
      ctx.globalAlpha = 1;
    }
  }

  // 맵 아이템 안내 글과 정화의 빛 섬광
  function drawToast(ctx, g) {
    var v = LW.view;
    if (g.flashT > 0) {
      ctx.globalAlpha = Math.min(1, g.flashT / 0.35) * 0.65;
      ctx.fillStyle = '#f4fbff';
      ctx.fillRect(0, 0, v.w, v.h);
      ctx.globalAlpha = 1;
    }
    if (g.toastT > 0) {
      ctx.globalAlpha = g.toastT > 0.5 ? 1 : g.toastT / 0.5;
      text(ctx, g.toastText, v.w / 2, v.h * 0.3, 18, '#ffe9a8');
      ctx.globalAlpha = 1;
    }
  }

  function slot(ctx, x, y, sz, w, spr) {
    rrect(ctx, x, y, sz, sz, 5);
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.fill();
    ctx.strokeStyle = w ? (w.evolved ? '#ffd34d' : 'rgba(255,233,168,0.8)') : 'rgba(255,255,255,0.2)';
    ctx.lineWidth = w && w.evolved ? 3 : 1.5;
    ctx.stroke();
    if (w) {
      ctx.fillStyle = w.evo ? w.evo.color : w.def.color;
      ctx.beginPath(); ctx.arc(x + sz / 2, y + sz / 2 - 2, 7, 0, TAU); ctx.fill();
      if (spChg(spr, w.lv)) setSpr(spr, w.lv, String(w.lv), 10, '#ffffff');
      drawSpr(ctx, spr, x + sz - spr.w + 2, y + sz - spr.h + 3, 0);
    }
  }

  // 버튼 라벨은 칸마다 문자 캐시를 쓴다(그릴 때 폰트를 바꾸지 않는다)
  var sprBtn = [];
  for (var sb = 0; sb < 12; sb++) sprBtn.push(makeSpr());
  function drawButton(ctx, b, i) {
    rrect(ctx, b.x, b.y, b.w, b.h, 10);
    ctx.fillStyle = b.kind === 3 ? 'rgba(40,60,66,0.95)' : 'rgba(0,0,0,0.45)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,233,168,0.7)';
    ctx.lineWidth = 2;
    ctx.stroke();
    var sp = sprBtn[i];
    if (spChg(sp, b.label)) setSpr(sp, b.label, b.label, b.kind === 3 ? 20 : 16, '#ffe9a8');
    drawSpr(ctx, sp, b.x + b.w / 2, b.y + b.h / 2 - sp.h / 2 + 1, 1);
  }

  function drawJoystick(ctx) {
    var j = LW.input.joy, v = LW.view;
    if (!j.active) return;
    var cx = (j.cx - v.offX) / v.scale, cy = (j.cy - v.offY) / v.scale;
    var kx = (j.x - v.offX) / v.scale, ky = (j.y - v.offY) / v.scale;
    ctx.beginPath(); ctx.arc(cx, cy, LW.JOY.R / v.scale, 0, TAU);
    ctx.fillStyle = 'rgba(255,255,255,0.08)'; ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.3)'; ctx.lineWidth = 2; ctx.stroke();
    ctx.beginPath(); ctx.arc(kx, ky, LW.JOY.knob / v.scale, 0, TAU);
    ctx.fillStyle = 'rgba(255,255,255,0.3)'; ctx.fill();
  }

  function drawDebug(ctx) {
    var P = LW.perf, v = LW.view, s = LW.safe;
    var lines = [
      'FPS ' + P.fps.toFixed(0) + '  update ' + P.updLast.toFixed(2) + 'ms  render ' + P.rndLast.toFixed(2) + 'ms',
      '적 ' + LW.enemies.n + '  탄 ' + LW.projectiles.n + '  보석 ' + LW.gems.n + '  장판 ' + LW.areas.n + '/' + P.maxAreas + '  파티클 ' + LW.particles.n + '  숫자 ' + LW.dmgNums.n,
      '화질 ' + LW.quality.name + '  DPR ' + v.dprUsed.toFixed(2) + '/' + v.dpr.toFixed(2) + '  시야 ' + v.w.toFixed(0) + 'x' + v.h.toFixed(0)
    ];
    var g = LW.game, i;
    for (i = 0; i < g.weapons.length; i++) {
      var w = g.weapons[i];
      var L = LW.weaponLevel(w), txt = '';
      for (var key in L) txt += ' ' + key + ' ' + (Math.round(L[key] * 100) / 100);
      lines.push('슬롯' + i + ' ' + LW.weaponName(w) + ' Lv' + w.lv + ' 누적 ' + Math.round(g.dmgBySlot[i]));
      lines.push('  ' + txt);
    }
    var S = g.passives, ps = '';
    for (i = 0; i < S.length; i++) ps += ' ' + S[i].def.code + ':' + S[i].lv;
    lines.push('패시브' + (ps || ' 없음'));
    var st = LW.player.stats;
    lines.push('피해x' + st.might.toFixed(2) + ' 쿨x' + st.cooldown.toFixed(2) + ' 범위x' + st.area.toFixed(2) + ' 지속x' + st.duration.toFixed(2) + ' 속도x' + st.projSpeed.toFixed(2) + ' +' + st.amount);
    lines.push('이동x' + LW.player.moveMul.toFixed(2) + ' HP ' + LW.player.maxHp + ' 재생 ' + LW.player.regen.toFixed(1) + ' 자석 ' + LW.player.magnet + ' 방어 ' + LW.player.armor);
    ctx.font = '10px monospace';
    curFont = '';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    var y = s.t + 70;
    for (i = 0; i < lines.length; i++) {
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(s.l + 4, y - 1, ctx.measureText(lines[i]).width + 6, 12);
      ctx.fillStyle = '#9fffb0';
      ctx.fillText(lines[i], s.l + 7, y);
      y += 13;
    }
  }

  function dim(ctx, a) {
    var v = LW.view;
    ctx.fillStyle = 'rgba(5,10,14,' + a + ')';
    ctx.fillRect(0, 0, v.w, v.h);
  }

  function drawCards(ctx) {
    var lu = LW.levelup, n = lu.n, v = LW.view;
    dim(ctx, 0.7);
    var titleY = btns[0] ? btns[0].y - 34 : v.h * 0.2;
    if (titleY < LW.safe.t + 20) titleY = LW.safe.t + 20;
    text(ctx, '레벨 업!', v.w / 2, titleY, 28, '#ffe9a8');
    for (var i = 0; i < n && i < nBtn; i++) {
      var b = btns[i], c = lu.cands[i];
      rrect(ctx, b.x, b.y, b.w, b.h, 12);
      ctx.fillStyle = 'rgba(22,48,58,0.97)';
      ctx.fill();
      ctx.strokeStyle = i === lu.focus ? '#ffd34d' : 'rgba(255,233,168,0.35)';
      ctx.lineWidth = i === lu.focus ? 3 : 1.5;
      ctx.stroke();
      var ix = b.x + 34, iy = b.y + b.h / 2;
      ctx.beginPath(); ctx.arc(ix, iy, 20, 0, TAU);
      ctx.fillStyle = c.color; ctx.fill();
      ctx.strokeStyle = '#0b1418'; ctx.lineWidth = 2; ctx.stroke();
      var tx = b.x + 66;
      text(ctx, (i + 1) + '. ' + c.name, tx, b.y + b.h * 0.28, 17, '#ffffff', 'left');
      text(ctx, c.tag, tx, b.y + b.h * 0.5, 14, '#ffd34d', 'left');
      text(ctx, c.desc, tx, b.y + b.h * 0.72, 12, '#c9d6da', 'left', 'normal');
    }
  }

  // 상자 창: 결과 목록. 탭이나 Enter로 닫는다.
  function drawChest(ctx) {
    var ch = LW.chest, v = LW.view, res = ch.results, n = res.length;
    dim(ctx, 0.7);
    var rowH = 46, cw = Math.min(v.w - 32, 400);
    var h = 70 + n * rowH + 40, x = (v.w - cw) / 2, y = v.h / 2 - h / 2;
    rrect(ctx, x, y, cw, h, 14);
    ctx.fillStyle = 'rgba(22,48,58,0.97)'; ctx.fill();
    ctx.strokeStyle = ch.boss ? '#c48cf0' : '#ffd34d'; ctx.lineWidth = 2.5; ctx.stroke();
    text(ctx, ch.boss ? '보스 상자' : '상자', v.w / 2, y + 32, 26, ch.boss ? '#e6c8ff' : '#ffe9a8');
    for (var i = 0; i < n; i++) {
      var r = res[i], ry = y + 70 + i * rowH + rowH / 2;
      ctx.beginPath(); ctx.arc(x + 28, ry, 13, 0, TAU);
      ctx.fillStyle = r.color; ctx.fill();
      ctx.strokeStyle = '#0b1418'; ctx.lineWidth = 2; ctx.stroke();
      text(ctx, r.text, x + 52, ry, 16, r.evo ? '#ffd34d' : '#ffffff', 'left');
    }
    ctx.globalAlpha = 0.5 + 0.5 * Math.abs(Math.sin(performance.now() / 400));
    text(ctx, '탭하여 닫기', v.w / 2, y + h - 22, 14, '#c9d6da', 'center', 'normal');
    ctx.globalAlpha = 1;
  }

  function drawOwlBig(ctx, cx, cy, size, flame, blink, bob) {
    LW.drawOwl(ctx, cx, cy, size / 30, { facing: 0, bob: bob, flame: flame, blink: blink });
  }

  // ===== 타이틀 =====
  // 불꽃 크기는 0.1초마다 목표값(+-6%)을 새로 고르고 보간한다. 눈은 3~5초마다 0.12초 감는다.
  var tl = { flame: 1, target: 1, nextT: 0, lastT: 0, blinkAt: -1 };
  var VERSION_STR = 'v' + LW.VERSION;
  function titleScene(ctx, g) {
    var v = LW.view, s = LW.safe, R = LW.render;
    var t = performance.now() / 1000;
    var dt = t - tl.lastT; tl.lastT = t;
    if (dt > 0.2) dt = 0.2;
    if (t >= tl.nextT) { tl.target = 1 + (LW.fxRand() * 2 - 1) * 0.06; tl.nextT = t + 0.1; }
    tl.flame += (tl.target - tl.flame) * Math.min(1, dt * 20);
    if (tl.blinkAt < 0) tl.blinkAt = t + 3;
    else if (t >= tl.blinkAt + 0.12) tl.blinkAt = t + 3 + LW.fxRand() * 2;
    var blink = t >= tl.blinkAt && t < tl.blinkAt + 0.12 ? 1 : 0;
    var bob = Math.sin(t * Math.PI) * 2;        // 2초 주기, 2 단위

    ctx.fillStyle = R.bgPat;
    ctx.fillRect(0, 0, v.w, v.h);
    dim(ctx, 0.5);
    var size = Math.min(v.w, v.h) * 0.35;
    var ox, oy, tx, ty;
    if (v.portrait) { ox = v.w / 2; oy = v.h * 0.2; tx = v.w / 2; ty = v.h * 0.42; }
    else { ox = v.w * 0.25; oy = v.h / 2; tx = v.w * 0.7; ty = v.h * 0.28; }
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.7;
    ctx.drawImage(R.glow, ox - size * 1.3, oy + size * 0.2 - size * 1.3, size * 2.6, size * 2.6);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    drawOwlBig(ctx, ox, oy, size, tl.flame, blink, bob);
    text(ctx, 'Lanternwake', tx, ty, 38, '#ffe9a8');
    text(ctx, '등불지기', tx, ty + 36, 22, '#ffffff');
    ctx.globalAlpha = 0.5 + 0.5 * Math.abs(Math.sin(t * 2.5));
    text(ctx, '탭하여 시작', tx, ty + 88, 20, '#ffd34d');
    ctx.globalAlpha = 1;
    if (ui.bestStr) text(ctx, ui.bestStr, tx, ty + 122, 14, '#ffe9a8', 'center', 'normal');
    text(ctx, '터치: 화면을 누르고 끌어 이동', tx, ty + 154, 13, '#c9d6da', 'center', 'normal');
    text(ctx, '키보드: WASD 또는 방향키, Enter 시작, M 소리', tx, ty + 174, 13, '#c9d6da', 'center', 'normal');
    text(ctx, VERSION_STR, v.w - s.r - 8, v.h - s.b - 10, 11, '#8aa0a6', 'right', 'normal');
  }

  // 타이틀 화면(설정을 타이틀에서 열었을 때는 설정도 이 위에 그린다)
  ui.drawTitleScene = function (ctx, g) {
    curFont = '';
    ui.layout();
    titleScene(ctx, g);
    if (g.state === 'TITLE') drawButton(ctx, btns[0], 0);
    else drawSettings(ctx);
  };

  function drawSettings(ctx) {
    var v = LW.view;
    dim(ctx, 0.78);
    text(ctx, '설정', v.w / 2, btns[0].y - 38, 28, '#ffe9a8');
    for (var i = 0; i < nBtn; i++) drawButton(ctx, btns[i], i);
  }

  // ===== 결과 =====
  function drawResult(ctx, g) {
    var v = LW.view, s = LW.safe, i, n = res.rows.length, won = g.won;
    dim(ctx, 0.85);
    var cx, owlY, owlSize = Math.min(v.w, v.h) * (v.portrait ? 0.24 : 0.3);
    var hy, listX, listY, listW;
    if (v.portrait) {
      cx = v.w / 2; owlY = v.h * 0.14; hy = v.h * 0.27;
      listW = Math.min(v.w - 48, 360); listX = (v.w - listW) / 2; listY = v.h * 0.43;
    } else {
      cx = v.w * 0.22; owlY = v.h * 0.26; hy = v.h * 0.5;
      listW = Math.min(300, v.w * 0.42); listX = v.w * 0.5; listY = Math.max(s.t + 56, v.h * 0.2);
    }
    // 승리면 불꽃이 밝고, 패배면 꺼진 등불
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = won ? 0.6 : 0.12;
    ctx.drawImage(LW.render.glow, cx - owlSize * 1.2, owlY + owlSize * 0.2 - owlSize * 1.2, owlSize * 2.4, owlSize * 2.4);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    drawOwlBig(ctx, cx, owlY, owlSize, won ? 1 : 0, 0, 0);
    text(ctx, res.head, cx, hy, 30, won ? (g.full ? '#fff0b0' : '#ffe9a8') : '#c9d6da');
    var ly = hy + 34;
    if (res.sub) { text(ctx, res.sub, cx, ly, 14, '#ffd34d', 'center', 'normal'); ly += 24; }
    text(ctx, res.stat, cx, ly, 16, '#ffffff');
    if (res.best) text(ctx, res.best, cx, ly + 28, 15, '#7be38d');
    // 무기별 누적 피해
    text(ctx, '무기별 누적 피해', listX + listW / 2, listY - 22, 14, '#ffe9a8');
    for (i = 0; i < n; i++) {
      var r = res.rows[i], ry = listY + i * 30;
      ctx.fillStyle = 'rgba(255,255,255,0.08)';
      ctx.fillRect(listX, ry + 16, listW, 5);
      ctx.fillStyle = r.color;
      ctx.fillRect(listX, ry + 16, listW * r.ratio, 5);
      text(ctx, r.name, listX, ry + 6, 13, '#ffffff', 'left', 'normal');
      text(ctx, r.str, listX + listW, ry + 6, 13, '#ffe9a8', 'right');
    }
    for (i = 0; i < nBtn; i++) drawButton(ctx, btns[i], i);
  }

  ui.draw = function (ctx, g) {
    curFont = '';
    ui.layout();
    var v = LW.view, i, st = g.state;
    if (st !== 'RESULT') { drawHud(ctx, g); drawBoss(ctx, g); drawToast(ctx, g); }
    if (st === 'PLAYING') {
      drawJoystick(ctx);
      for (i = 0; i < nBtn; i++) drawButton(ctx, btns[i], i);
    } else if (st === 'LEVELUP') drawCards(ctx);
    else if (st === 'CHEST') drawChest(ctx);
    else if (st === 'PAUSED') {
      dim(ctx, 0.6);
      text(ctx, '일시정지', v.w / 2, btns[0].y - 40, 30, '#ffe9a8');
      for (i = 0; i < nBtn; i++) drawButton(ctx, btns[i], i);
    } else if (st === 'SETTINGS') drawSettings(ctx);
    else if (st === 'RESULT') drawResult(ctx, g);
    if (ui.dbgOverlay && LW.params.debug) drawDebug(ctx);
  };

  ui.refreshBest();
})();
