// 캔버스 UI: HUD, 버튼, 레벨업 카드, 타이틀, 일시정지, 임시 결과 화면, 탭 판정
(function () {
  var ui = LW.ui = { dbgOverlay: LW.params.debug && LW.params.autotest > 0 };
  var FONT = LW.FONT;
  var TAU = Math.PI * 2;

  // ===== 버튼 목록(프레임마다 layout으로 다시 만든다) =====
  var btns = [];
  for (var bi = 0; bi < 12; bi++) btns.push({ id: '', x: 0, y: 0, w: 0, h: 0, label: '', kind: 0 });
  var nBtn = 0;
  var pressId = new Int32Array(8), pressBtn = new Int32Array(8), nPress = 0;
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
  var sprLv = makeSpr(), sprTime = makeSpr(), sprKills = makeSpr();
  var sprW = [], sprP = [];
  for (var si = 0; si < 6; si++) { sprW.push(makeSpr()); sprP.push(makeSpr()); }

  // ===== 글자 도우미(오버레이와 타이틀용) =====
  function text(ctx, str, x, y, size, color, align, weight) {
    ctx.font = (weight || 'bold') + ' ' + size + 'px ' + FONT;
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
    } else if (st === 'PAUSED') {
      var bh = Math.max(MIN, 52);
      addBtn('resume', v.w / 2 - 100, v.h / 2 - bh / 2, 200, bh, '계속', 3);
    } else if (st === 'RESULT') {
      var rh = Math.max(MIN, 52);
      addBtn('retry', v.w / 2 - 100, v.h * 0.62, 200, rh, '다시 하기', 3);
      addBtn('title', v.w / 2 - 100, v.h * 0.62 + rh + 12, 200, rh, '타이틀', 3);
    } else if (st === 'LEVELUP') {
      var n = LW.levelup.cands.length;
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
    var g = LW.game;
    switch (id) {
      case 'pause': g.setState('PAUSED'); break;
      case 'resume': g.setState('PLAYING'); break;
      case 'retry': g.start(); break;
      case 'title': g.setState('TITLE'); break;
      case 'c0': LW.levelup.choose(0); break;
      case 'c1': LW.levelup.choose(1); break;
      case 'c2': LW.levelup.choose(2); break;
      case 'd_time': g.time += 60; break;
      case 'd_lvl': g.addXp(g.xpNeed - g.xp); break;
      case 'd_ovl': ui.dbgOverlay = !ui.dbgOverlay; break;
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

  function handleKey(code) {
    var g = LW.game, st = g.state, lu = LW.levelup;
    if (LW.params.debug && code === 'F2') { ui.dbgOverlay = !ui.dbgOverlay; return; }
    if (st === 'TITLE') {
      if (code === 'Enter' || code === 'Space') g.start();
    } else if (st === 'PLAYING') {
      if (code === 'Escape' || code === 'KeyP') g.setState('PAUSED');
      else if (LW.params.debug) {
        if (code === 'KeyL') g.addXp(g.xpNeed - g.xp);
        else if (code === 'KeyT') g.time += 60;
        else if (code === 'KeyI') g.god = !g.god;
        else if (code === 'KeyW') dbgCycleWeapon();
      }
    } else if (st === 'PAUSED') {
      if (code === 'Escape' || code === 'KeyP' || code === 'Enter') g.setState('PLAYING');
    } else if (st === 'LEVELUP') {
      var n = lu.cands.length;
      if (code === 'Digit1') lu.choose(0);
      else if (code === 'Digit2') lu.choose(1);
      else if (code === 'Digit3') lu.choose(2);
      else if (code === 'ArrowUp' || code === 'ArrowLeft') lu.focus = (lu.focus + n - 1) % n;
      else if (code === 'ArrowDown' || code === 'ArrowRight') lu.focus = (lu.focus + 1) % n;
      else if (code === 'Enter') lu.choose(lu.focus);
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
        if (nPress < 8) { pressId[nPress] = id; pressBtn[nPress] = btnAt(x, y); nPress++; }
      } else {
        var idx = -1;
        for (k = 0; k < nPress; k++) if (pressId[k] === id) { idx = k; break; }
        if (idx < 0) continue;
        var b = pressBtn[idx];
        pressId[idx] = pressId[nPress - 1]; pressBtn[idx] = pressBtn[nPress - 1]; nPress--;
        if (type === 2) continue;
        if (b >= 0) {
          // 누른 버튼과 같은 버튼 위에서 뗐을 때만 눌린 것으로 본다
          if (btnAt(x, y) === b) { ui.act(btns[b].id); ui.layout(); }
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
    setSpr(sprLv, g.level, 'Lv ' + g.level, 15, '#ffe9a8');
    drawSpr(ctx, sprLv, s.l + 8, ty, 0);
    var sec = Math.floor(g.time);
    setSpr(sprTime, sec, LW.fmtTime(sec), 18, '#ffffff');
    drawSpr(ctx, sprTime, v.w / 2, ty, 1);
    var pauseW = Math.max(44 / v.scale, 44);
    setSpr(sprKills, g.kills, '처치 ' + g.kills, 14, '#e8e8f0');
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
      setSpr(spr, w.lv, String(w.lv), 10, '#ffffff');
      drawSpr(ctx, spr, x + sz - spr.w + 2, y + sz - spr.h + 3, 0);
    }
  }

  function drawButton(ctx, b) {
    rrect(ctx, b.x, b.y, b.w, b.h, 10);
    ctx.fillStyle = b.kind === 3 ? 'rgba(40,60,66,0.95)' : 'rgba(0,0,0,0.45)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,233,168,0.7)';
    ctx.lineWidth = 2;
    ctx.stroke();
    text(ctx, b.label, b.x + b.w / 2, b.y + b.h / 2 + 1, b.kind === 3 ? 20 : 16, '#ffe9a8');
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
      '적 ' + LW.enemies.n + '  탄 ' + LW.projectiles.n + '  보석 ' + LW.gems.n + '  파티클 ' + LW.particles.n + '  숫자 ' + LW.dmgNums.n,
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
    var lu = LW.levelup, n = lu.cands.length, v = LW.view;
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

  function drawOwlBig(ctx, cx, cy, size, flame, blink, bob) {
    LW.drawOwl(ctx, cx, cy, size / 30, { facing: 0, bob: bob, flame: flame, blink: blink });
  }

  // 타이틀 임시본. 완성본은 S10에서 다듬는다.
  ui.drawTitle = function (ctx) {
    var v = LW.view, s = LW.safe, R = LW.render;
    var t = performance.now() / 1000;
    ctx.fillStyle = R.bgPat;
    ctx.fillRect(0, 0, v.w, v.h);
    dim(ctx, 0.5);
    var short = Math.min(v.w, v.h);
    var size = short * 0.35;
    var ox, oy, tx, ty;
    if (v.portrait) { ox = v.w / 2; oy = v.h * 0.2; tx = v.w / 2; ty = v.h * 0.42; }
    else { ox = v.w * 0.25; oy = v.h / 2; tx = v.w * 0.7; ty = v.h * 0.32; }
    var flick = 1 + 0.06 * Math.sin(t * 15 + Math.sin(t * 5) * 2);
    var blink = (t % 4) < 0.12 ? 1 : 0;
    var bob = Math.sin(t * Math.PI) * 2;
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.7;
    ctx.drawImage(R.glow, ox - size * 1.3, oy + size * 0.2 - size * 1.3, size * 2.6, size * 2.6);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    drawOwlBig(ctx, ox, oy, size, flick, blink, bob);
    text(ctx, 'Lanternwake', tx, ty, 38, '#ffe9a8');
    text(ctx, '등불지기', tx, ty + 36, 22, '#ffffff');
    ctx.globalAlpha = 0.5 + 0.5 * Math.abs(Math.sin(t * 2.5));
    text(ctx, '탭하여 시작', tx, ty + 90, 20, '#ffd34d');
    ctx.globalAlpha = 1;
    text(ctx, '터치: 화면을 누르고 끌어 이동', tx, ty + 130, 13, '#c9d6da', 'center', 'normal');
    text(ctx, '키보드: WASD 또는 방향키, Enter 시작', tx, ty + 150, 13, '#c9d6da', 'center', 'normal');
    text(ctx, 'v' + LW.VERSION, v.w - s.r - 8, v.h - s.b - 10, 11, '#8aa0a6', 'right', 'normal');
  };

  ui.draw = function (ctx, g) {
    ui.layout();
    var v = LW.view, i, st = g.state;
    drawHud(ctx, g);
    if (st === 'PLAYING') drawJoystick(ctx);
    for (i = 0; i < nBtn && st !== 'LEVELUP'; i++) {
      if (btns[i].id === 'resume' || btns[i].id === 'retry' || btns[i].id === 'title') continue;
      drawButton(ctx, btns[i]);
    }
    if (st === 'LEVELUP') drawCards(ctx);
    else if (st === 'PAUSED') {
      dim(ctx, 0.6);
      text(ctx, '일시정지', v.w / 2, v.h / 2 - 70, 30, '#ffe9a8');
      for (i = 0; i < nBtn; i++) drawButton(ctx, btns[i]);
    } else if (st === 'RESULT') {
      dim(ctx, 0.7);
      var won = g.won;
      text(ctx, won ? '새벽이 밝았다' : '등불이 꺼졌다', v.w / 2, v.h * 0.34 + 0, 30, '#ffe9a8');
      drawOwlBig(ctx, v.w / 2, v.h * 0.2, Math.min(v.w, v.h) * 0.22, won ? 1 : 0, 0, 0);
      text(ctx, '생존 ' + LW.fmtTime(g.time) + '   레벨 ' + g.level + '   처치 ' + g.kills, v.w / 2, v.h * 0.34 + 40, 16, '#ffffff');
      for (i = 0; i < nBtn; i++) drawButton(ctx, btns[i]);
    }
    if (ui.dbgOverlay && LW.params.debug) drawDebug(ctx);
  };
})();
