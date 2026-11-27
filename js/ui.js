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
  function setSpr(s, val, str, size, color, weight, plain) {
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
    if (!plain) cx.strokeText(str, 3, size * k * 0.12);
    cx.fillText(str, 3, size * k * 0.12);
    s.w = w / k; s.h = h / k;
  }
  // align: 0 왼쪽, 1 가운데, 2 오른쪽
  function drawSpr(ctx, s, x, y, align) {
    if (align === 1) x -= s.w / 2; else if (align === 2) x -= s.w;
    ctx.drawImage(s.cv, x, y, s.w, s.h);
  }
  var sprLv = makeSpr(), sprTime = makeSpr(), sprKills = makeSpr(), sprBoss = makeSpr();
  var sprG = makeSpr();
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
  ui.onState = function (s) {
    confirmTitle = false; confirmDelete = false;
    if (s === 'RANKING') rank.scroll = 0;
    // 타이틀로 돌아오면 미리 받은 표를 채우고 못 올린 기록을 다시 올린다(로그인 상태일 때만 일을 한다)
    if (s === 'TITLE') { LW.account.refillTickets(); LW.account.flushQueue(); }
    // 계정 화면에 들어올 때 서버가 꺼져 있었다면 다시 확인한다
    if (s === 'ACCOUNT' && LW.account.enabled && LW.account.status !== 'online') LW.account.onOnline();
  };
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
      // Android Chrome에서 설치 이벤트를 받았을 때만 "앱 설치" 버튼을 보인다
      if (LW.pwa.canInstall()) addBtn('install', tcx - 80, v.h - s.b - 16 - th * 2 - 10, 160, th, '앱 설치', 3);
      // 계정과 순위표(서버 기능이 켜진 환경에서만). 왼쪽 위 계정, 오른쪽 위 순위표.
      if (LW.account.enabled) {
        var nk = LW.account.nickname;
        if (nk !== lastNick) { lastNick = nk; acctLabel = nk.length > 7 ? nk.slice(0, 7) + '…' : nk; }
        addBtn('account', s.l + 12, s.t + 12, 124, th, LW.account.loggedIn && acctLabel ? acctLabel : '로그인', 7);
        addBtn('ranking', v.w - s.r - 12 - 100, s.t + 12, 100, th, '순위표', 7);
      }
    } else if (st === 'ACCOUNT') {
      layoutAccount(MIN);
    } else if (st === 'RANKING') {
      layoutRanking(MIN);
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
          LW.account.onRunAbort();
          ui.refreshBest();
        }
        g.setState('TITLE');
        break;
      case 'install': LW.pwa.install(); break;
      case 'account': if (g.state === 'TITLE') g.setState('ACCOUNT'); break;
      case 'ranking':
        if (g.state !== 'TITLE') break;
        rank.board = 'time';
        g.setState('RANKING');
        LW.account.fetchBoard('time');
        LW.account.fetchBoard('kills');
        break;
      case 'tab_time': case 'tab_kills':
        rank.board = id === 'tab_time' ? 'time' : 'kills';
        rank.scroll = 0;
        break;
      case 'glogin': LW.account.login(); break;
      case 'nick_edit': ui.openNick(); break;
      case 'logout': LW.account.logout().then(function (ok) { if (ok) say('로그아웃했어요'); }); break;
      case 'delete':
        if (!confirmDelete) {
          confirmDelete = true;
          var un = LW.account.queueCount();
          delLabel = un > 0 ? '올리지 못한 기록 ' + un + '개도 지워져요. 한 번 더' : '정말 삭제할까요? 한 번 더';
          break;
        }
        confirmDelete = false;
        LW.account.deleteAccount().then(function (ok) { if (ok) say('계정을 삭제했어요'); });
        break;
      case 'settings': ui.settingsFrom = g.state === 'PAUSED' ? 'PAUSED' : 'TITLE'; g.setState('SETTINGS'); break;
      case 'back': g.setState(g.state === 'ACCOUNT' || g.state === 'RANKING' ? 'TITLE' : ui.settingsFrom); break;
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
    } else if (st === 'SETTINGS' || st === 'ACCOUNT') {
      if (code === 'Escape' || code === 'Backspace') ui.act('back');
    } else if (st === 'RANKING') {
      if (code === 'Escape' || code === 'Backspace') ui.act('back');
      else if (code === 'ArrowDown') rank.scroll += ROW_H * 3;
      else if (code === 'ArrowUp') rank.scroll -= ROW_H * 3;
      else if (code === 'ArrowLeft') ui.act('tab_time');
      else if (code === 'ArrowRight') ui.act('tab_kills');
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
    if (g.state === 'RANKING') { rank.scroll -= inp.dragDy / LW.view.scale; }
    inp.dragDy = 0;
    // 로그인 직후 닉네임을 아직 안 정했으면 한 번 입력을 연다(자동 검사 중에는 열지 않는다)
    if (LW.account.promptNick && g.state === 'TITLE' && !nickOpen && !LW.autotest.active) {
      LW.account.promptNick = false;
      g.setState('ACCOUNT');
      ui.openNick();
    }
    if (nickOpen) { inp.evN = 0; inp.keyN = 0; nPress = 0; return; }
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
    var k = b.kind, google = k === 6;
    rrect(ctx, b.x, b.y, b.w, b.h, 10);
    ctx.fillStyle = google ? '#ffffff' : (k === 9 ? 'rgba(110,92,30,0.95)' : (k === 3 || k === 7 ? 'rgba(40,60,66,0.95)' : 'rgba(0,0,0,0.45)'));
    // 서버에 연결할 수 없으면 구글 로그인 버튼을 흐리게 한다
    if (google && !LW.net.up) ctx.globalAlpha = 0.45;
    ctx.fill();
    ctx.strokeStyle = google ? '#8a8a8a' : 'rgba(255,233,168,0.7)';
    ctx.lineWidth = 2;
    ctx.stroke();
    var sp = sprBtn[i];
    var fs = k === 3 || k === 9 ? 20 : (k === 7 ? 15 : (google ? 17 : 16));
    if (spChg(sp, b.label)) setSpr(sp, b.label, b.label, fs, google ? '#1f1f1f' : '#ffe9a8', google ? 'normal' : 'bold', google);
    if (google) {
      // 구글 로그인 버튼의 "G" 표지(공식 로고 파일이 없어 글자로 그린다)
      if (spChg(sprG, 'G')) setSpr(sprG, 'G', 'G', 22, '#4285f4', 'bold', true);
      drawSpr(ctx, sprG, b.x + 22, b.y + b.h / 2 - sprG.h / 2 + 1, 1);
      drawSpr(ctx, sp, b.x + b.w / 2 + 14, b.y + b.h / 2 - sp.h / 2 + 1, 1);
      ctx.globalAlpha = 1;
    } else drawSpr(ctx, sp, b.x + b.w / 2, b.y + b.h / 2 - sp.h / 2 + 1, 1);
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
    var ch = LW.chest, v = LW.view, res = ch.results, n = ch.n;
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
    // 계정과 순위표는 타이틀의 배경만 어둡게 깔고 그 위에 그린다(올빼미와 안내 글은 그리지 않는다)
    if (g.state === 'ACCOUNT' || g.state === 'RANKING') {
      ctx.fillStyle = LW.render.bgPat;
      ctx.fillRect(0, 0, LW.view.w, LW.view.h);
      dim(ctx, 0.82);
      return g.state === 'ACCOUNT' ? drawAccount(ctx) : drawRanking(ctx);
    }
    titleScene(ctx, g);
    if (g.state === 'TITLE') {
      for (var bi2 = 0; bi2 < nBtn; bi2++) drawButton(ctx, btns[bi2], bi2);
      if (LW.account.enabled && LW.account.status === 'offline') {
        text(ctx, '오프라인', LW.safe.l + 12 + 62, LW.safe.t + 12 + Math.max(44 / LW.view.scale, 44) + 10, 11, '#ff9a8a', 'center', 'normal');
      }
      // iOS Safari는 설치 이벤트가 없어 안내 한 줄만 보인다(홈 화면에 추가한 앱 안에서는 숨김)
      if (LW.pwa.showIosHint()) {
        var vw = LW.view, sf = LW.safe;
        text(ctx, '공유 버튼, 홈 화면에 추가', vw.portrait ? vw.w / 2 : vw.w * 0.7, vw.h - sf.b - 16 - Math.max(44 / vw.scale, 44) - 18, 13, '#ffe9a8', 'center', 'normal');
      }
    } else drawSettings(ctx);
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
    if (LW.account.resultLine) text(ctx, LW.account.resultLine, cx, ly + (res.best ? 54 : 28), 14, '#9fd0ff', 'center', 'normal');
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

  // ===== 계정과 순위표 화면 =====
  // 배경은 타이틀의 바닥 무늬를 어둡게 깐 것이고, 글자는 fillText 로 그린다(고정 문구는 줄바꿈을 한 번만 계산한다).
  var nickOpen = false, delLabel = '';
  var rank = { board: 'time', scroll: 0, maxScroll: 0, top: 0, bottom: 0, left: 0, w: 0, statusY: 0, meY: 0 };
  var ROW_H = 30;
  var ac = { cx: 0, statusY: 0, nickY: 0, infoY: 0, textX: 0, textY: 0, textW: 0, backY: 0 };
  var confirmDelete = false;
  var acctLabel = '', lastNick = null;
  var mctx = document.createElement('canvas').getContext('2d');
  var wraps = {};
  function say(m) { LW.account.msg = m; LW.account.msgAt = performance.now(); }

  // 공백 기준 줄바꿈(한 단어가 폭보다 길면 글자 단위로 자른다). 폭이 같으면 이전 결과를 재사용한다.
  function wrap(id, str, size, maxW) {
    var c = wraps[id];
    if (c && c.w === maxW) return c.lines;
    mctx.font = fontOf(size, 'normal');
    var words = str.split(' '), lines = [], cur = '', i, j;
    for (i = 0; i < words.length; i++) {
      var t = cur ? cur + ' ' + words[i] : words[i];
      if (mctx.measureText(t).width <= maxW) { cur = t; continue; }
      if (cur) { lines.push(cur); cur = ''; }
      t = words[i];
      while (mctx.measureText(t).width > maxW && t.length > 1) {
        for (j = t.length - 1; j > 1 && mctx.measureText(t.slice(0, j)).width > maxW; j--) { /* 자를 위치 찾기 */ }
        lines.push(t.slice(0, j)); t = t.slice(j);
      }
      cur = t;
    }
    if (cur) lines.push(cur);
    wraps[id] = { w: maxW, lines: lines };
    return lines;
  }

  var HELP_GUEST = '로그인하면 기록과 설정이 다른 기기와 이어지고 순위표에 오를 수 있어요. 구글에서는 계정 번호만 받고, 이메일과 이름은 받지 않아요.';
  var HELP_PRIVACY = '저장하는 것은 계정 번호의 해시, 닉네임, 판 기록, 설정 3가지예요. 순위표에는 닉네임과 기록, 달성일만 나와요. 구글 쪽 연결은 구글 계정 설정의 "서드 파티 연결"에서 끊을 수 있어요.';

  function layoutAccount(MIN) {
    var v = LW.view, s = LW.safe, A = LW.account;
    var bh = Math.max(MIN, v.portrait ? 50 : 44);
    var bw, bx, y;
    if (v.portrait) {
      bw = Math.min(300, v.w - 40 - s.l - s.r); bx = (v.w - bw) / 2;
      ac.cx = v.w / 2;
    } else {
      bw = Math.min(260, v.w * 0.4); bx = Math.max(s.l + 24, v.w * 0.27 - bw / 2);
      ac.cx = bx + bw / 2;
    }
    ac.statusY = s.t + 70;
    y = s.t + 92;
    if (!A.loggedIn) {
      addBtn('glogin', bx, y, bw, bh, 'Google 계정으로 로그인', 6);
      y += bh + 16;
    } else {
      ac.nickY = y + 26;
      y += 52;
      addBtn('nick_edit', bx, y, bw, bh, '닉네임 바꾸기', 3); y += bh + 8;
      ac.infoY = y + 8; y += 50;
      addBtn('logout', bx, y, bw, bh, '로그아웃', 3); y += bh + 8;
      addBtn('delete', bx, y, bw, bh, confirmDelete ? delLabel : '계정 삭제', 3); y += bh + 8;
    }
    ac.backY = v.h - s.b - 16 - bh;
    if (v.portrait) {
      addBtn('back', bx, ac.backY, bw, bh, '뒤로', 3);
      ac.textX = v.w / 2 - Math.min(v.w - 48, 360) / 2; ac.textW = Math.min(v.w - 48, 360); ac.textY = y + 6;
    } else {
      // 가로 화면은 높이가 모자라 "뒤로"를 오른쪽 열 아래에 둔다
      ac.textX = Math.max(v.w * 0.56, bx + bw + 24); ac.textW = v.w - s.r - 24 - ac.textX; ac.textY = s.t + 92;
      addBtn('back', ac.textX, ac.backY, Math.min(260, ac.textW), bh, '뒤로', 3);
    }
  }

  var statusStrs = {
    off: '이 환경에서는 계정 기능을 쓸 수 없어요', checking: '서버에 연결하는 중',
    offlineGuest: '오프라인: 지금은 로그인할 수 없어요 (인터넷 연결이 필요해요)',
    offlineIn: '오프라인: 기록은 연결되면 올라가요', onlineIn: '온라인'
  };
  var accInfo = { t: -1, k: -1, l: -1, q: -1, rec: '', up: '' };

  function drawAccount(ctx) {
    var v = LW.view, s = LW.safe, A = LW.account, i;
    text(ctx, '계정', v.w / 2, s.t + 38, 28, '#ffe9a8');
    var st = A.status, str = st === 'off' ? statusStrs.off : (st === 'checking' ? statusStrs.checking
      : (st === 'offline' ? (A.loggedIn ? statusStrs.offlineIn : statusStrs.offlineGuest) : (A.loggedIn ? statusStrs.onlineIn : '')));
    if (str) text(ctx, str, ac.cx, ac.statusY, 12, st === 'offline' ? '#ff9a8a' : '#9fd0ff', 'center', 'normal');
    for (i = 0; i < nBtn; i++) drawButton(ctx, btns[i], i);
    var y = ac.textY, q = 0;
    if (A.loggedIn) {
      text(ctx, '닉네임', ac.cx, ac.nickY - 20, 12, '#c9d6da', 'center', 'normal');
      text(ctx, A.nickname, ac.cx, ac.nickY + 2, 22, '#ffffff');
      var r = A.records();
      q = A.queueCount();
      if (accInfo.t !== r.bestTimeMs || accInfo.k !== r.bestKills || accInfo.l !== r.bestLevel || accInfo.q !== q) {
        accInfo.t = r.bestTimeMs; accInfo.k = r.bestKills; accInfo.l = r.bestLevel; accInfo.q = q;
        accInfo.rec = '서버 기록  ' + LW.fmtTime(r.bestTimeMs / 1000) + '   처치 ' + r.bestKills + '   레벨 ' + r.bestLevel;
        accInfo.up = q > 0 ? '올리지 못한 기록 ' + q + '개' : '올리지 못한 기록 없음';
      }
      text(ctx, accInfo.rec, ac.cx, ac.infoY, 13, '#ffe9a8', 'center', 'normal');
      text(ctx, accInfo.up, ac.cx, ac.infoY + 20, 13, q > 0 ? '#ffd34d' : '#c9d6da', 'center', 'normal');
    }
    // 안내문: 게스트면 로그인 안내와 개인정보, 로그인 상태면 개인정보만
    var maxY = ac.backY - 26, lines, k;
    if (!A.loggedIn) {
      lines = wrap('guest', HELP_GUEST, 13, ac.textW);
      for (k = 0; k < lines.length && y < maxY; k++) { text(ctx, lines[k], ac.textX, y, 13, '#e8e8f0', 'left', 'normal'); y += 18; }
      y += 8;
    }
    lines = wrap('priv', HELP_PRIVACY, 12, ac.textW);
    for (k = 0; k < lines.length && y < maxY; k++) { text(ctx, lines[k], ac.textX, y, 12, '#9fb2b8', 'left', 'normal'); y += 17; }
    if (A.msg && performance.now() - A.msgAt < 4000) text(ctx, A.msg, v.w / 2, ac.backY - 14, 14, '#ffd34d');
  }

  // 닉네임 입력: 캔버스 UI 에서 유일한 DOM 폼. 열려 있는 동안 캔버스 입력은 무시한다.
  var nickForm = document.getElementById('nick'), nickIn = document.getElementById('nickIn');
  var nickErr = document.getElementById('nickErr');
  var nickBusy = false;
  ui.nickOpen = function () { return nickOpen; };
  ui.openNick = function () {
    if (!nickForm || nickOpen || !LW.account.loggedIn) return;
    nickOpen = true;
    nickIn.value = LW.account.nicknameSet ? LW.account.nickname : '';
    nickErr.textContent = '';
    nickForm.style.display = 'flex';
    LW.input.resetPointers();
    try { nickIn.focus(); } catch (e) { /* 무시 */ }
  };
  ui.closeNick = function () {
    if (!nickForm) return;
    nickOpen = false;
    nickForm.style.display = 'none';
    try { nickIn.blur(); } catch (e) { /* 무시 */ }
    LW.input.onOverlayOpen();
  };
  if (nickForm) {
    nickForm.addEventListener('submit', function (e) {
      e.preventDefault();
      if (nickBusy) return;
      nickBusy = true;
      LW.account.setNickname(nickIn.value).then(function (r) {
        nickBusy = false;
        if (r.ok) { ui.closeNick(); say('닉네임을 저장했어요'); }
        else nickErr.textContent = r.error;
      });
    });
    document.getElementById('nickCancel').addEventListener('click', function () { ui.closeNick(); });
    nickForm.addEventListener('click', function (e) { if (e.target === nickForm) ui.closeNick(); });
    nickIn.addEventListener('keydown', function (e) { if (e.key === 'Escape') { e.preventDefault(); ui.closeNick(); } });
  }

  function layoutRanking(MIN) {
    var v = LW.view, s = LW.safe, A = LW.account;
    var cw = Math.min(v.w - 24 - s.l - s.r, 420), cx = (v.w - cw) / 2;
    var th = Math.max(MIN, 40), ty = s.t + 56, bh = Math.max(MIN, 46);
    addBtn('tab_time', cx, ty, cw / 2 - 4, th, '생존 시간', rank.board === 'time' ? 9 : 3);
    addBtn('tab_kills', cx + cw / 2 + 4, ty, cw / 2 - 4, th, '처치 수', rank.board === 'kills' ? 9 : 3);
    var by = v.h - s.b - 14 - bh;
    addBtn('back', cx, by, cw, bh, '뒤로', 3);
    rank.left = cx; rank.w = cw;
    rank.statusY = ty + th + 14;
    rank.top = ty + th + 28;
    rank.meY = by - 22;
    rank.bottom = rank.meY - 14;
    var n = A.boards[rank.board].rows.length;
    rank.maxScroll = Math.max(0, n * ROW_H - (rank.bottom - rank.top));
    if (rank.scroll > rank.maxScroll) rank.scroll = rank.maxScroll;
    if (rank.scroll < 0) rank.scroll = 0;
  }

  var rkStat = { f: -1, st: false, board: '', str: '' };
  function pad2(n) { return n < 10 ? '0' + n : '' + n; }
  function rankStatus(b) {
    if (b.loading) return '불러오는 중';
    if (rkStat.f !== b.fetchedAt || rkStat.st !== b.stale || rkStat.board !== rank.board) {
      rkStat.f = b.fetchedAt; rkStat.st = b.stale; rkStat.board = rank.board;
      var at = '';
      if (b.fetchedAt) { var d = new Date(b.fetchedAt); at = pad2(d.getHours()) + ':' + pad2(d.getMinutes()); }
      if (b.stale) rkStat.str = at ? '오프라인: 저장된 순위표 (갱신 ' + at + ')' : '오프라인: 저장된 순위표가 없어요';
      else rkStat.str = '갱신 ' + at;
    }
    return rkStat.str;
  }

  function drawRanking(ctx) {
    var v = LW.view, s = LW.safe, A = LW.account, i;
    var b = A.boards[rank.board], rows = b.rows, n = rows.length;
    text(ctx, '순위표', v.w / 2, s.t + 30, 26, '#ffe9a8');
    for (i = 0; i < nBtn; i++) drawButton(ctx, btns[i], i);
    text(ctx, rankStatus(b), v.w / 2, rank.statusY, 12, b.stale ? '#ff9a8a' : '#9fd0ff', 'center', 'normal');

    var top = rank.top, h = rank.bottom - rank.top, cx = rank.left, cw = rank.w;
    if (n === 0) {
      text(ctx, b.loading ? '불러오는 중' : (b.stale ? '오프라인이에요' : '아직 기록이 없어요'), v.w / 2, top + h / 2, 16, '#c9d6da', 'center', 'normal');
    } else {
      ctx.save();
      ctx.beginPath(); ctx.rect(cx, top, cw, h); ctx.clip();
      var first = Math.max(0, Math.floor(rank.scroll / ROW_H)), last = Math.min(n - 1, Math.ceil((rank.scroll + h) / ROW_H));
      var ry;
      for (i = first; i <= last; i++) {
        ry = top + i * ROW_H - rank.scroll;
        ctx.fillStyle = rows[i].mine ? 'rgba(255,211,77,0.22)' : (i & 1 ? 'rgba(255,255,255,0.05)' : 'rgba(255,255,255,0.02)');
        ctx.fillRect(cx, ry, cw, ROW_H - 2);
      }
      // 칸(열)마다 모아서 그려 글꼴 전환을 줄인다
      for (i = first; i <= last; i++) text(ctx, rows[i].rank, cx + 30, top + i * ROW_H - rank.scroll + ROW_H / 2 - 1, 13, '#ffe9a8', 'right');
      for (i = first; i <= last; i++) text(ctx, rows[i].name, cx + 42, top + i * ROW_H - rank.scroll + ROW_H / 2 - 1, 14, rows[i].mine ? '#ffd34d' : '#ffffff', 'left');
      for (i = first; i <= last; i++) text(ctx, rows[i].sub, cx + cw - 82, top + i * ROW_H - rank.scroll + ROW_H / 2 - 1, 11, rows[i].dawn ? '#ffe9a8' : '#9fb2b8', 'right', 'normal');
      for (i = first; i <= last; i++) text(ctx, rows[i].val, cx + cw - 10, top + i * ROW_H - rank.scroll + ROW_H / 2 - 1, 15, '#ffd34d', 'right');
      ctx.restore();
      curFont = '';             // restore 가 ctx.font 를 되돌렸으니 text() 의 글꼴 기억도 지운다
    }
    // 내 순위 고정 줄. 게스트는 로그인 안내.
    var mine = A.loggedIn && b.hasMe;
    var me = !A.loggedIn ? '로그인하면 순위에 오를 수 있어요' : (b.hasMe ? b.meStr : '아직 순위에 오른 기록이 없어요');
    text(ctx, me, v.w / 2, rank.meY, 15, mine ? '#7be38d' : '#c9d6da', 'center', mine ? 'bold' : 'normal');
  }

  ui.refreshBest();
})();
