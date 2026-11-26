// 카메라, 배경, 스프라이트 캐시, 월드 그리기, 올빼미(LW.drawOwl)
(function () {
  var R = LW.render = { ppu: 1, cam: { x: 0, y: 0 }, bgPat: null, vig: null, glow: null, owl: [], time: 0 };
  var TAU = Math.PI * 2;

  // ===== 도형 도우미 =====
  function ellipse(ctx, x, y, rx, ry) { ctx.beginPath(); ctx.ellipse(x, y, rx, ry, 0, 0, TAU); }
  function circle(ctx, x, y, r) { ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); }
  function tri(ctx, x1, y1, x2, y2, x3, y3) {
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.lineTo(x3, y3); ctx.closePath();
  }
  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  // 불꽃: 물방울 모양. h는 높이
  LW.drawFlame = function (ctx, x, y, h) {
    ctx.beginPath();
    ctx.moveTo(x, y - h * 0.6);
    ctx.quadraticCurveTo(x + h * 0.42, y - h * 0.05, x, y + h * 0.4);
    ctx.quadraticCurveTo(x - h * 0.42, y - h * 0.05, x, y - h * 0.6);
    ctx.fillStyle = '#ffd34d';
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(x, y - h * 0.2);
    ctx.quadraticCurveTo(x + h * 0.2, y + h * 0.08, x, y + h * 0.34);
    ctx.quadraticCurveTo(x - h * 0.2, y + h * 0.08, x, y - h * 0.2);
    ctx.fillStyle = '#fff6d0';
    ctx.fill();
  };

  // 등불 위치(올빼미 중심 기준, 단위 1배 기준). 진행 방향 쪽에 둔다.
  LW.owlLantern = function (facing) { return { x: facing * 9, y: facing === 0 ? 17 : 15 }; };

  // ===== 올빼미 =====
  // x, y: 몸 중심. scale: 1이면 반경 12 단위 크기. opts: { facing, bob, flame, blink }
  // flame < 0이면 불꽃을 그리지 않는다(캐시용). flame 0이면 꺼진 등불.
  LW.drawOwl = function (ctx, x, y, scale, opts) {
    var o = opts || {};
    var f = o.facing || 0;
    var bob = o.bob || 0;
    var flame = o.flame === undefined ? 1 : o.flame;
    var blink = o.blink || 0;
    var lx = f * 9, ly = f === 0 ? 17 : 15;

    ctx.save();
    ctx.translate(x, y + bob * scale);
    ctx.scale(scale, scale);
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = '#2b1a0e';

    // 귀깃
    ctx.fillStyle = '#8a5a34';
    tri(ctx, -9.5, -7, -9, -17, -3, -13.5); ctx.fill(); ctx.stroke();
    tri(ctx, 9.5, -7, 9, -17, 3, -13.5); ctx.fill(); ctx.stroke();
    // 몸과 배
    ellipse(ctx, 0, 3, 10.5, 12); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#e8d3a8';
    ellipse(ctx, 0, 6, 6, 7); ctx.fill();
    // 머리
    ctx.fillStyle = '#8a5a34';
    circle(ctx, 0, -5, 9.5); ctx.fill(); ctx.stroke();
    // 눈
    var ey = -5.5, ex = 4.3;
    if (blink > 0.5) {
      ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.moveTo(-ex - 3.5, ey); ctx.lineTo(-ex + 3.5, ey);
      ctx.moveTo(ex - 3.5, ey); ctx.lineTo(ex + 3.5, ey); ctx.stroke();
      ctx.lineWidth = 1.5;
    } else {
      ctx.fillStyle = '#ffe9a8';
      ctx.lineWidth = 1;
      circle(ctx, -ex, ey, 4.2); ctx.fill(); ctx.stroke();
      circle(ctx, ex, ey, 4.2); ctx.fill(); ctx.stroke();
      ctx.lineWidth = 1.5;
      ctx.fillStyle = '#111';
      circle(ctx, -ex + f * 1.1, ey, 1.9); ctx.fill();
      circle(ctx, ex + f * 1.1, ey, 1.9); ctx.fill();
    }
    // 부리
    ctx.fillStyle = '#e07a2e';
    tri(ctx, f * 0.8 - 1.8, -2.2, f * 0.8 + 1.8, -2.2, f * 0.8, 1.6); ctx.fill();

    // 등불
    ctx.lineWidth = 0.9;
    ctx.beginPath(); ctx.moveTo(lx, ly - 4); ctx.lineTo(lx * 0.45, 11); ctx.stroke();
    ctx.lineWidth = 1.3;
    ctx.strokeStyle = '#15161a';
    ctx.fillStyle = '#34363e';
    roundRect(ctx, lx - 3.6, ly - 4, 7.2, 8.4, 1.8); ctx.fill(); ctx.stroke();
    ctx.fillStyle = flame > 0 ? '#ffe08a' : (flame === 0 ? '#2a2a2e' : '#3b3320');
    ctx.fillRect(lx - 2.2, ly - 2.4, 4.4, 5.2);
    if (flame > 0) LW.drawFlame(ctx, lx, ly + 0.4, 6.2 * flame);
    else if (flame === 0) { ctx.fillStyle = '#7a2a14'; circle(ctx, lx, ly + 2, 0.9); ctx.fill(); }

    // 발
    ctx.strokeStyle = '#2b1a0e';
    ctx.fillStyle = '#e07a2e';
    ctx.lineWidth = 1;
    ellipse(ctx, -4, 14.6, 2.7, 1.7); ctx.fill(); ctx.stroke();
    ellipse(ctx, 4, 14.6, 2.7, 1.7); ctx.fill(); ctx.stroke();
    ctx.restore();
  };

  // ===== 적 모양 =====
  var ENEMY_SHAPES = {
    // 검은 타원과 다리 4개
    mite: function (ctx, r, frame, flash) {
      var body = flash ? '#fff' : '#1b1722';
      var leg = frame ? 1.6 : -1.6;
      ctx.strokeStyle = flash ? '#fff' : '#0a0810';
      ctx.lineWidth = 1.6;
      ctx.lineCap = 'round';
      ctx.beginPath();
      for (var i = 0; i < 2; i++) {
        var yy = (i ? 0.45 : -0.2) * r;
        ctx.moveTo(-r * 0.6, yy); ctx.lineTo(-r * 1.25, yy + leg + (i ? 3 : -3));
        ctx.moveTo(r * 0.6, yy); ctx.lineTo(r * 1.25, yy - leg + (i ? 3 : -3));
      }
      ctx.stroke();
      ctx.fillStyle = body;
      ctx.lineWidth = 1.8;
      ellipse(ctx, 0, 0, r, r * 0.78); ctx.fill(); ctx.stroke();
      if (!flash) {
        ctx.fillStyle = '#d83a3a';
        circle(ctx, -r * 0.3, -r * 0.2, 1.2); ctx.fill();
        circle(ctx, r * 0.3, -r * 0.2, 1.2); ctx.fill();
      }
    }
  };

  function makeCanvas(w, h) {
    var c = document.createElement('canvas');
    c.width = Math.max(1, Math.ceil(w));
    c.height = Math.max(1, Math.ceil(h));
    return c;
  }

  // 적 종류마다 3장: 출렁임 2프레임, 흰색 피격 1장
  function buildEnemySprites() {
    var ppu = R.ppu;
    for (var id in LW.ENEMIES) {
      var d = LW.ENEMIES[id];
      var half = d.r * 1.5 + 6;
      d.sprHalf = half;
      d.spr = [];
      for (var k = 0; k < 3; k++) {
        var c = makeCanvas(half * 2 * ppu, half * 2 * ppu);
        var cx = c.getContext('2d');
        cx.translate(c.width / 2, c.height / 2);
        cx.scale(ppu, ppu);
        ENEMY_SHAPES[d.shape](cx, d.r, k === 1 ? 1 : 0, k === 2);
        d.spr.push(c);
      }
    }
  }

  // 플레이어: 오른쪽 보기 2프레임, 왼쪽 보기 2프레임
  var OWL_W = 44, OWL_H = 56, OWL_OX = 22, OWL_OY = 30;
  function buildOwlSprites() {
    var ppu = R.ppu;
    R.owl.length = 0;
    for (var fi = 0; fi < 2; fi++) {
      for (var b = 0; b < 2; b++) {
        var c = makeCanvas(OWL_W * ppu, OWL_H * ppu);
        var cx = c.getContext('2d');
        LW.drawOwl(cx, OWL_OX * ppu, OWL_OY * ppu, ppu, { facing: fi ? -1 : 1, bob: b ? -1 : 0, flame: -1 });
        R.owl.push(c);
      }
    }
  }

  // 등불 빛 번짐
  function buildGlow() {
    var c = makeCanvas(128, 128), cx = c.getContext('2d');
    var g = cx.createRadialGradient(64, 64, 0, 64, 64, 64);
    g.addColorStop(0, 'rgba(255,190,90,0.7)');
    g.addColorStop(0.4, 'rgba(255,150,60,0.25)');
    g.addColorStop(1, 'rgba(255,140,50,0)');
    cx.fillStyle = g;
    cx.fillRect(0, 0, 128, 128);
    R.glow = c;
  }

  // 배경 타일 128 단위
  function buildBg() {
    var T = 128, ppu = R.ppu;
    var w = Math.round(T * ppu), c = makeCanvas(w, w), cx = c.getContext('2d');
    cx.scale(w / T, w / T);
    cx.fillStyle = '#0b1418';
    cx.fillRect(0, 0, T, T);
    var rnd = LW.mulberry32(777);
    var i, dx, dy;
    for (i = 0; i < 6; i++) {
      var px = rnd() * T, py = rnd() * T, rx = 8 + rnd() * 14, ry = 4 + rnd() * 6;
      for (dx = -T; dx <= T; dx += T) for (dy = -T; dy <= T; dy += T) {
        cx.fillStyle = '#0d1b20';
        ellipse(cx, px + dx, py + dy, rx, ry); cx.fill();
      }
    }
    cx.strokeStyle = '#14272d';
    cx.lineWidth = 1.2;
    cx.lineCap = 'round';
    for (i = 0; i < 16; i++) {
      var gx = rnd() * T, gy = rnd() * T;
      for (dx = -T; dx <= T; dx += T) for (dy = -T; dy <= T; dy += T) {
        cx.beginPath();
        cx.moveTo(gx + dx, gy + dy); cx.lineTo(gx + dx - 2, gy + dy - 5);
        cx.moveTo(gx + dx, gy + dy); cx.lineTo(gx + dx + 2, gy + dy - 6);
        cx.stroke();
      }
    }
    R.bgPat = LW.ctx.createPattern(c, 'repeat');
    if (R.bgPat.setTransform) R.bgPat.setTransform(new DOMMatrix([T / c.width, 0, 0, T / c.height, 0, 0]));
  }

  // 비네트: 캔버스 전체 크기로 한 번만 만든다
  function buildVignette() {
    var cv = LW.canvas;
    var c = makeCanvas(cv.width, cv.height), cx = c.getContext('2d');
    var w = c.width, h = c.height, rr = Math.sqrt(w * w + h * h) / 2;
    var g = cx.createRadialGradient(w / 2, h / 2, rr * 0.45, w / 2, h / 2, rr);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, 'rgba(0,0,0,0.55)');
    cx.fillStyle = g;
    cx.fillRect(0, 0, w, h);
    R.vig = c;
  }

  R.onResize = function () {
    var v = LW.view;
    R.ppu = v.scale * v.dprUsed;
    buildBg();
    buildOwlSprites();
    buildEnemySprites();
    buildGlow();
    buildVignette();
    if (LW.ui) LW.ui.onResize();
  };

  // ===== 월드 그리기 =====
  var GEM_COLORS = ['#4aa3ff', '#5be37d', '#ff5a5a'];

  function drawGems(ctx, g, l, r, t, b) {
    var items = LW.gems.items, n = LW.gems.n;
    for (var i = 0; i < n; i++) {
      var gm = items[i];
      if (gm.x < l || gm.x > r || gm.y < t || gm.y > b) continue;
      var s = gm.value >= 10 ? 6 : 4.5;
      ctx.fillStyle = gm.value >= 10 ? GEM_COLORS[2] : (gm.value >= 2 ? GEM_COLORS[1] : GEM_COLORS[0]);
      ctx.beginPath();
      ctx.moveTo(gm.x, gm.y - s); ctx.lineTo(gm.x + s * 0.75, gm.y);
      ctx.lineTo(gm.x, gm.y + s); ctx.lineTo(gm.x - s * 0.75, gm.y);
      ctx.closePath();
      ctx.fill();
    }
  }

  function drawEnemies(ctx, g, l, r, t, b) {
    var items = LW.enemies.items, n = LW.enemies.n;
    var frameBase = (g.time * 6) | 0;
    for (var i = 0; i < n; i++) {
      var e = items[i];
      if (!e.active || e.x < l || e.x > r || e.y < t || e.y > b) continue;
      var d = e.def;
      var spr = d.spr[e.flashT > 0 ? 2 : ((frameBase + e.uid) & 1)];
      var half = d.sprHalf * (e.r / d.r);
      ctx.drawImage(spr, e.x - half, e.y - half, half * 2, half * 2);
      if (e.hp < e.maxHp) {
        var bw = e.r * 2, by = e.y - e.r - 7;
        ctx.fillStyle = 'rgba(0,0,0,0.6)';
        ctx.fillRect(e.x - e.r, by, bw, 3);
        ctx.fillStyle = '#e04a4a';
        ctx.fillRect(e.x - e.r, by, bw * (e.hp / e.maxHp), 3);
      }
    }
  }

  function drawPlayer(ctx, g) {
    var P = LW.player;
    var now = R.time;
    var f = 0.9 + 0.2 * Math.sin(now * 13 + Math.sin(now * 4.3) * 2.5);   // 불꽃 크기 +-8% 안팎
    var dir = P.facing >= 0 ? 1 : -1;
    var lan = LW.owlLantern(dir);
    var lx = P.x + lan.x, ly = P.y + lan.y;

    // 빛 번짐
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.55 + 0.1 * Math.sin(now * 9);
    ctx.drawImage(R.glow, lx - 80, ly - 80, 160, 160);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';

    var blinkOff = P.invuln > 0 && (((P.invuln * 12) | 0) & 1) === 1;
    if (!blinkOff) {
      var idx = (dir > 0 ? 0 : 2) + (((P.animT * 3.5) | 0) & 1);
      var spr = R.owl[idx];
      ctx.drawImage(spr, P.x - OWL_OX, P.y - OWL_OY, spr.width / R.ppu, spr.height / R.ppu);
      ctx.fillStyle = '#ffe08a';
      ctx.fillRect(lx - 2.2, ly - 2.4, 4.4, 5.2);
      LW.drawFlame(ctx, lx, ly + 0.4, 6.2 * f);
    }
    // HP 바
    var bw = 28;
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(P.x - bw / 2, P.y - 27, bw, 4);
    ctx.fillStyle = '#5be37d';
    var ratio = P.hp > 0 ? P.hp / P.maxHp : 0;
    ctx.fillRect(P.x - bw / 2, P.y - 27, bw * ratio, 4);
  }

  function drawProjectiles(ctx, l, r, t, b) {
    var items = LW.projectiles.items, n = LW.projectiles.n;
    ctx.lineCap = 'round';
    for (var i = 0; i < n; i++) {
      var p = items[i];
      if (p.x < l || p.x > r || p.y < t || p.y > b) continue;
      ctx.strokeStyle = '#ff7a2a';
      ctx.lineWidth = p.r * 0.8;
      ctx.beginPath();
      ctx.moveTo(p.x - p.dx * 12, p.y - p.dy * 12);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
      ctx.fillStyle = '#ffd34d';
      circle(ctx, p.x, p.y, p.r); ctx.fill();
      ctx.fillStyle = '#fff6d0';
      circle(ctx, p.x, p.y, p.r * 0.5); ctx.fill();
    }
  }

  function drawEffects(ctx, l, r, t, b) {
    var items = LW.particles.items, n = LW.particles.n, i;
    for (i = 0; i < n; i++) {
      var p = items[i];
      if (p.x < l || p.x > r || p.y < t || p.y > b) continue;
      ctx.globalAlpha = p.life / p.maxLife;
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x - p.r, p.y - p.r, p.r * 2, p.r * 2);
    }
    ctx.globalAlpha = 1;
    var dn = LW.dmgNums.items, m = LW.dmgNums.n;
    if (m > 0) {
      ctx.font = 'bold 11px ' + LW.FONT;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      for (i = 0; i < m; i++) {
        var d = dn[i];
        ctx.globalAlpha = d.life > 0.2 ? 1 : d.life / 0.2;
        ctx.fillStyle = '#000';
        ctx.fillText(d.str, d.x + 1, d.y + 1);
        ctx.fillStyle = '#fff6d0';
        ctx.fillText(d.str, d.x, d.y);
      }
      ctx.globalAlpha = 1;
    }
  }

  function drawWorld(ctx, g) {
    var v = LW.view, cam = R.cam;
    var l = cam.x - v.w / 2 - 32, r = cam.x + v.w / 2 + 32;
    var t = cam.y - v.h / 2 - 32, b = cam.y + v.h / 2 + 32;
    ctx.save();
    ctx.translate(v.w / 2 - cam.x, v.h / 2 - cam.y);
    ctx.fillStyle = R.bgPat;
    ctx.fillRect(cam.x - v.w / 2, cam.y - v.h / 2, v.w, v.h);
    drawGems(ctx, g, l, r, t, b);
    drawEnemies(ctx, g, l, r, t, b);
    drawPlayer(ctx, g);
    drawProjectiles(ctx, l, r, t, b);
    drawEffects(ctx, l, r, t, b);
    ctx.restore();
  }

  // 한 프레임을 그린다
  R.frame = function (g) {
    var ctx = LW.ctx, v = LW.view, cv = LW.canvas, P = LW.player;
    R.time = performance.now() / 1000;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#0b1418';
    ctx.fillRect(0, 0, cv.width, cv.height);
    var k = v.scale * v.dprUsed;
    ctx.setTransform(k, 0, 0, k, v.offX * v.dprUsed, v.offY * v.dprUsed);
    if (v.letterbox) { ctx.save(); ctx.beginPath(); ctx.rect(0, 0, v.w, v.h); ctx.clip(); }

    if (g.state === 'TITLE') {
      R.cam.x = 0; R.cam.y = 0;
      LW.ui.drawTitle(ctx);
    } else {
      R.cam.x = P.x; R.cam.y = P.y;
      drawWorld(ctx, g);
      // 비네트는 화면 전체 크기 그림이라 변환 없이 그린다
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.drawImage(R.vig, 0, 0);
      ctx.restore();
      LW.ui.draw(ctx, g);
    }
    if (v.letterbox) ctx.restore();
  };
})();
