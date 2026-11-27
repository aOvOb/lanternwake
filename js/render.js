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
  // 호출마다 객체를 만들지 않도록 공용 객체를 채워서 돌려준다(바로 쓰고 보관하지 않는다).
  var lanternPos = { x: 0, y: 0 };
  LW.owlLantern = function (facing) {
    lanternPos.x = facing * 9; lanternPos.y = facing === 0 ? 17 : 15;
    return lanternPos;
  };

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
    },
    // 보라 삼각 날개
    moth: function (ctx, r, frame, flash) {
      var wing = flash ? '#fff' : '#6a3fa0', edge = flash ? '#fff' : '#1d0f33', up = frame ? 0.25 : -0.15;
      ctx.lineWidth = 1.6; ctx.lineJoin = 'round'; ctx.strokeStyle = edge;
      ctx.fillStyle = wing;
      tri(ctx, -r * 0.2, 0, -r * 1.5, -r * (0.9 + up), -r * 1.1, r * 0.8); ctx.fill(); ctx.stroke();
      tri(ctx, r * 0.2, 0, r * 1.5, -r * (0.9 + up), r * 1.1, r * 0.8); ctx.fill(); ctx.stroke();
      ctx.fillStyle = flash ? '#fff' : '#2a1a40';
      ellipse(ctx, 0, 0, r * 0.38, r * 0.7); ctx.fill(); ctx.stroke();
      if (!flash) { ctx.fillStyle = '#ffd34d'; circle(ctx, -r * 0.16, -r * 0.3, 1.1); ctx.fill(); circle(ctx, r * 0.16, -r * 0.3, 1.1); ctx.fill(); }
    },
    // 갈색 물방울과 흰 눈
    mudling: function (ctx, r, frame, flash) {
      var sq = frame ? 1.06 : 0.96;
      ctx.lineWidth = 2; ctx.strokeStyle = flash ? '#fff' : '#2a1c10'; ctx.fillStyle = flash ? '#fff' : '#7a5230';
      ctx.beginPath();
      ctx.moveTo(0, -r * 1.1);
      ctx.quadraticCurveTo(r * 1.2 * sq, -r * 0.1, r * 0.9 * sq, r * 0.6);
      ctx.quadraticCurveTo(0, r * 1.15, -r * 0.9 * sq, r * 0.6);
      ctx.quadraticCurveTo(-r * 1.2 * sq, -r * 0.1, 0, -r * 1.1);
      ctx.closePath(); ctx.fill(); ctx.stroke();
      if (!flash) {
        ctx.fillStyle = '#fff'; circle(ctx, -r * 0.32, 0, r * 0.22); ctx.fill(); circle(ctx, r * 0.32, 0, r * 0.22); ctx.fill();
        ctx.fillStyle = '#111'; circle(ctx, -r * 0.3, r * 0.04, r * 0.09); ctx.fill(); circle(ctx, r * 0.34, r * 0.04, r * 0.09); ctx.fill();
      }
    },
    // 연두 원과 돌기
    spore: function (ctx, r, frame, flash) {
      var pul = frame ? 1.06 : 0.97;
      ctx.lineWidth = 1.8; ctx.strokeStyle = flash ? '#fff' : '#26401a'; ctx.fillStyle = flash ? '#fff' : '#8ccf4a';
      for (var i = 0; i < 8; i++) {
        var a = i * Math.PI / 4; circle(ctx, Math.cos(a) * r * 0.95 * pul, Math.sin(a) * r * 0.95 * pul, r * 0.26); ctx.fill(); ctx.stroke();
      }
      circle(ctx, 0, 0, r * 0.85 * pul); ctx.fill(); ctx.stroke();
      if (!flash) { ctx.fillStyle = '#d6f59a'; circle(ctx, -r * 0.2, -r * 0.2, r * 0.3); ctx.fill(); ctx.fillStyle = '#3a5a22'; circle(ctx, r * 0.15, r * 0.2, r * 0.14); ctx.fill(); }
    },
    // 회색 투구와 빨간 눈 틈
    rusthelm: function (ctx, r, frame, flash) {
      ctx.lineWidth = 2; ctx.strokeStyle = flash ? '#fff' : '#1c1d22'; ctx.fillStyle = flash ? '#fff' : '#7d8088';
      ctx.beginPath(); ctx.arc(0, -r * 0.1, r * 0.95, Math.PI, 0); ctx.lineTo(r * 0.95, r * 0.75); ctx.lineTo(-r * 0.95, r * 0.75); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.fillStyle = flash ? '#fff' : '#555860'; ctx.fillRect(-r * 1.05, r * 0.55, r * 2.1, r * 0.35); ctx.strokeRect(-r * 1.05, r * 0.55, r * 2.1, r * 0.35);
      if (!flash) {
        ctx.fillStyle = '#d83a2a'; ctx.fillRect(-r * 0.7, r * 0.0, r * 1.4, r * 0.2 + (frame ? 0.6 : 0));
        ctx.fillStyle = '#a0522d'; ctx.fillRect(-r * 0.5, -r * 0.6, r * 0.25, r * 0.3);
      }
    },
    // 남색 원과 노란 눈동자
    eye: function (ctx, r, frame, flash) {
      ctx.lineWidth = 1.8; ctx.strokeStyle = flash ? '#fff' : '#0a0f2a'; ctx.fillStyle = flash ? '#fff' : '#2a3a8a';
      circle(ctx, 0, 0, r); ctx.fill(); ctx.stroke();
      if (!flash) {
        ctx.fillStyle = '#ffe14d'; ellipse(ctx, 0, 0, r * 0.72, r * (frame ? 0.5 : 0.56)); ctx.fill(); ctx.stroke();
        ctx.fillStyle = '#111'; ellipse(ctx, 0, 0, r * 0.2, r * 0.46); ctx.fill();
      }
    },
    // 회색 둥근 사각형과 엄니
    boar: function (ctx, r, frame, flash) {
      ctx.lineWidth = 2; ctx.strokeStyle = flash ? '#fff' : '#1e1e22'; ctx.fillStyle = flash ? '#fff' : '#8b8d94';
      roundRect(ctx, -r, -r * 0.8, r * 2, r * 1.6, r * 0.5); ctx.fill(); ctx.stroke();
      ctx.fillStyle = flash ? '#fff' : '#eee8d0';
      tri(ctx, -r * 0.55, r * 0.5, -r * 0.2, r * 0.55, -r * 0.45, r * 1.15); ctx.fill(); ctx.stroke();
      tri(ctx, r * 0.55, r * 0.5, r * 0.2, r * 0.55, r * 0.45, r * 1.15); ctx.fill(); ctx.stroke();
      if (!flash) { ctx.fillStyle = '#d83a3a'; circle(ctx, -r * 0.4, -r * 0.2, 1.5); ctx.fill(); circle(ctx, r * 0.4, -r * 0.2, 1.5); ctx.fill(); }
      ctx.strokeStyle = flash ? '#fff' : '#3a3a40'; ctx.lineWidth = 2; ctx.beginPath();
      ctx.moveTo(-r * 0.5, -r * 0.8); ctx.lineTo(-r * 0.3, -r * (1.15 + (frame ? 0.1 : 0))); ctx.moveTo(r * 0.5, -r * 0.8); ctx.lineTo(r * 0.3, -r * (1.15 + (frame ? 0.1 : 0))); ctx.stroke();
    },
    // 검은 V자(날개를 편 실루엣)
    crow: function (ctx, r, frame, flash) {
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      var tip = frame ? 0.5 : 0.1;
      ctx.beginPath(); ctx.moveTo(-r * 1.5, -r * tip); ctx.lineTo(0, r * 0.5); ctx.lineTo(r * 1.5, -r * tip);
      ctx.lineWidth = 4.2; ctx.strokeStyle = flash ? '#fff' : '#08080c'; ctx.stroke();
      ctx.lineWidth = 2; ctx.strokeStyle = flash ? '#fff' : '#3c3c48'; ctx.stroke();
      if (!flash) { ctx.fillStyle = '#e04a4a'; circle(ctx, 0, r * 0.1, 1.1); ctx.fill(); }
    },
    // 보스: 잿더미 거인(재색 덩어리, 주황 균열과 눈)
    colossus: function (ctx, r, frame, flash) {
      ctx.lineWidth = 3; ctx.strokeStyle = flash ? '#fff' : '#17110d'; ctx.fillStyle = flash ? '#fff' : '#5a4f48';
      ctx.beginPath();
      ctx.moveTo(-r * 0.7, r * 0.9); ctx.lineTo(-r * 1.0, r * 0.1); ctx.lineTo(-r * 0.75, -r * 0.7);
      ctx.lineTo(-r * 0.2, -r * 1.0); ctx.lineTo(r * 0.5, -r * 0.85); ctx.lineTo(r * 1.0, -r * 0.2);
      ctx.lineTo(r * 0.85, r * 0.8); ctx.closePath(); ctx.fill(); ctx.stroke();
      if (!flash) {
        ctx.strokeStyle = '#ff7a2a'; ctx.lineWidth = 2.4;
        ctx.beginPath(); ctx.moveTo(-r * 0.5, -r * 0.5); ctx.lineTo(-r * 0.2, -r * 0.05); ctx.lineTo(-r * 0.45, r * 0.45);
        ctx.moveTo(r * 0.45, -r * 0.4); ctx.lineTo(r * 0.2, r * 0.1); ctx.lineTo(r * 0.5, r * 0.6); ctx.stroke();
        ctx.fillStyle = frame ? '#ffd34d' : '#ff9a3c';
        circle(ctx, -r * 0.3, -r * 0.35, r * 0.13); ctx.fill(); circle(ctx, r * 0.3, -r * 0.35, r * 0.13); ctx.fill();
      }
    },
    // 보스: 밤나방 여왕(큰 보라 날개와 왕관)
    queen: function (ctx, r, frame, flash) {
      var up = frame ? 0.2 : -0.1;
      ctx.lineWidth = 2.5; ctx.lineJoin = 'round'; ctx.strokeStyle = flash ? '#fff' : '#1d0f33'; ctx.fillStyle = flash ? '#fff' : '#7a45b8';
      tri(ctx, -r * 0.2, -r * 0.1, -r * 1.5, -r * (1.0 + up), -r * 1.15, r * 0.9); ctx.fill(); ctx.stroke();
      tri(ctx, r * 0.2, -r * 0.1, r * 1.5, -r * (1.0 + up), r * 1.15, r * 0.9); ctx.fill(); ctx.stroke();
      ctx.fillStyle = flash ? '#fff' : '#4a2a7a';
      tri(ctx, -r * 0.2, r * 0.1, -r * 1.0, r * 0.2, -r * 0.8, r * 1.0); ctx.fill(); ctx.stroke();
      tri(ctx, r * 0.2, r * 0.1, r * 1.0, r * 0.2, r * 0.8, r * 1.0); ctx.fill(); ctx.stroke();
      ctx.fillStyle = flash ? '#fff' : '#2a1a40';
      ellipse(ctx, 0, 0, r * 0.42, r * 0.8); ctx.fill(); ctx.stroke();
      if (!flash) {
        ctx.fillStyle = '#ffd34d'; ctx.strokeStyle = '#6a4a10'; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(-r * 0.3, -r * 0.62); ctx.lineTo(-r * 0.3, -r * 1.0); ctx.lineTo(-r * 0.1, -r * 0.78); ctx.lineTo(0, -r * 1.05);
        ctx.lineTo(r * 0.1, -r * 0.78); ctx.lineTo(r * 0.3, -r * 1.0); ctx.lineTo(r * 0.3, -r * 0.62); ctx.closePath(); ctx.fill(); ctx.stroke();
        ctx.fillStyle = '#ff5a8a'; circle(ctx, -r * 0.15, -r * 0.2, 2); ctx.fill(); circle(ctx, r * 0.15, -r * 0.2, 2); ctx.fill();
      }
    },
    // 보스: 마지막 그림자(검은 윤곽과 보랏빛 흰 눈)
    last: function (ctx, r, frame, flash) {
      ctx.lineWidth = 3; ctx.strokeStyle = flash ? '#fff' : '#9a5adf'; ctx.fillStyle = flash ? '#fff' : '#0c0714';
      ctx.beginPath(); ctx.moveTo(-r * 0.95, r * 0.95);
      for (var i = 0; i < 5; i++) {
        ctx.lineTo(-r * 0.95 + (i + 0.5) * r * 0.38, r * (frame ? 0.7 : 0.8));
        ctx.lineTo(-r * 0.95 + (i + 1) * r * 0.38, r * 0.95);
      }
      ctx.lineTo(r * 0.95, -r * 0.1);
      ctx.arc(0, -r * 0.1, r * 0.95, 0, Math.PI, true);
      ctx.closePath(); ctx.fill(); ctx.stroke();
      if (!flash) {
        ctx.fillStyle = '#f4e8ff'; ellipse(ctx, -r * 0.33, -r * 0.2, r * 0.17, r * 0.27); ctx.fill(); ellipse(ctx, r * 0.33, -r * 0.2, r * 0.17, r * 0.27); ctx.fill();
        ctx.fillStyle = '#9a5adf'; circle(ctx, -r * 0.33, -r * 0.18, r * 0.07); ctx.fill(); circle(ctx, r * 0.33, -r * 0.18, r * 0.07); ctx.fill();
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
    if (R.glow) return;     // 크기가 고정이라 한 번만 만든다
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
    // 캔버스 객체는 재사용하고 크기만 다시 지정한다(iOS 캔버스 메모리 한도 대비)
    var c = R.vig || document.createElement('canvas');
    c.width = Math.max(1, cv.width); c.height = Math.max(1, cv.height);
    var cx = c.getContext('2d');
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
      var red = gm.value >= 10 || gm.merged;     // 병합된 보석은 값과 상관없이 빨강
      var s = red ? 6 : 4.5;
      ctx.fillStyle = red ? GEM_COLORS[2] : (gm.value >= 2 ? GEM_COLORS[1] : GEM_COLORS[0]);
      ctx.beginPath();
      ctx.moveTo(gm.x, gm.y - s); ctx.lineTo(gm.x + s * 0.75, gm.y);
      ctx.lineTo(gm.x, gm.y + s); ctx.lineTo(gm.x - s * 0.75, gm.y);
      ctx.closePath();
      ctx.fill();
    }
  }

  // 맵 아이템 그리기. 빛 번짐은 미리 그린 스프라이트를 쓴다.
  function glowAt(ctx, x, y, size, alpha) {
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = alpha;
    ctx.drawImage(R.glow, x - size / 2, y - size / 2, size, size);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  // 상자: 갈색 상자와 금색 걸쇠. 보스 상자는 보라색에 더 크다
  function drawChest(ctx, it, bob) {
    var boss = it.kind === 1, k = boss ? 1.5 : 1;
    glowAt(ctx, it.x, it.y + bob, 56 * k, 0.6);
    var w = 18 * k, h = 13 * k, x = it.x - w / 2, y = it.y - h / 2 + bob;
    roundRect(ctx, x, y, w, h, 2.5);
    ctx.fillStyle = boss ? '#6a3a8a' : '#8a5a34'; ctx.fill();
    ctx.lineWidth = 1.6; ctx.strokeStyle = '#2b1a0e'; ctx.stroke();
    ctx.fillStyle = boss ? '#4a2866' : '#6e4524';
    ctx.fillRect(x + 1, y + 1, w - 2, h * 0.35);
    ctx.fillStyle = '#ffd34d';
    ctx.fillRect(it.x - 2 * k, y + h * 0.3, 4 * k, 5 * k);
  }

  // 촛대: 어두운 금속 받침과 밀랍 기둥, 위에 불꽃. 아무 공격에나 부서진다
  function drawCandle(ctx, it) {
    var x = it.x, y = it.y, fl = 1 + 0.12 * Math.sin(R.time * 11 + x);
    glowAt(ctx, x, y - 8, 48, 0.45);
    ctx.lineJoin = 'round';
    ctx.lineWidth = 1.5; ctx.strokeStyle = '#1c1a16';
    ctx.fillStyle = '#4a4640';
    roundRect(ctx, x - 6, y + 6, 12, 4, 1.5); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#ece0b8';
    roundRect(ctx, x - 3.2, y - 8, 6.4, 15, 1.5); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#c9b98a';
    ctx.fillRect(x + 0.6, y - 7, 1.8, 13);
    LW.drawFlame(ctx, x, y - 13, 8 * fl);
  }

  // 등잔 기름: 둥근 병과 노란 기름
  function drawOil(ctx, it, bob) {
    var x = it.x, y = it.y + bob;
    glowAt(ctx, x, y, 36, 0.5);
    ctx.lineWidth = 1.5; ctx.strokeStyle = '#2b1a0e';
    ctx.fillStyle = '#d9a441';
    circle(ctx, x, y + 1.5, 6.5); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#8a5a34';
    ctx.fillRect(x - 2.2, y - 9, 4.4, 4); ctx.strokeRect(x - 2.2, y - 9, 4.4, 4);
    ctx.fillStyle = 'rgba(255,246,208,0.8)';
    circle(ctx, x - 2.2, y - 0.5, 1.6); ctx.fill();
  }

  // 끌개 종: 금색 종
  function drawBell(ctx, it, bob) {
    var x = it.x, y = it.y + bob;
    glowAt(ctx, x, y, 40, 0.5);
    ctx.lineWidth = 1.5; ctx.strokeStyle = '#3a2a08';
    ctx.fillStyle = '#e8b830';
    ctx.beginPath();
    ctx.moveTo(x - 8, y + 6); ctx.quadraticCurveTo(x - 7, y - 8, x, y - 8);
    ctx.quadraticCurveTo(x + 7, y - 8, x + 8, y + 6); ctx.closePath();
    ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#fff1a8';
    ctx.fillRect(x - 3.5, y - 4, 1.8, 7);
    ctx.fillStyle = '#6a4a10';
    circle(ctx, x, y + 8, 2); ctx.fill();
  }

  // 정화의 빛: 하얀 별 모양 빛덩이
  function drawLight(ctx, it, bob) {
    var x = it.x, y = it.y + bob, pul = 1 + 0.12 * Math.sin(R.time * 8), i;
    glowAt(ctx, x, y, 56 * pul, 0.8);
    ctx.beginPath();
    for (i = 0; i < 8; i++) {
      var a = i * Math.PI / 4, rr = (i & 1) ? 4 : 10 * pul;
      var px = x + Math.cos(a) * rr, py = y + Math.sin(a) * rr;
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fillStyle = '#f4fbff'; ctx.fill();
    ctx.lineWidth = 1.2; ctx.strokeStyle = '#7ac8ff'; ctx.stroke();
  }

  function drawPickups(ctx, l, r, t, b) {
    var items = LW.pickups.items, n = LW.pickups.n;
    for (var i = 0; i < n; i++) {
      var it = items[i];
      if (it.x < l || it.x > r || it.y < t || it.y > b) continue;
      // 수명이 5초 남으면 깜빡인다
      if (it.life > 0 && it.life < 5 && (((it.life * 6) | 0) & 1) === 0) continue;
      var bob = Math.sin(R.time * 3 + it.x) * 1.5;
      switch (it.kind) {
        case 0: case 1: drawChest(ctx, it, bob); break;
        case 2: drawCandle(ctx, it); break;
        case 3: drawOil(ctx, it, bob); break;
        case 4: drawBell(ctx, it, bob); break;
        case 5: drawLight(ctx, it, bob); break;
      }
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
      if (e.elite) {
        ctx.beginPath(); ctx.ellipse(e.x, e.y + e.r * 0.4, e.r * 1.25, e.r * 0.95, 0, 0, TAU);
        ctx.fillStyle = 'rgba(255,211,77,0.18)'; ctx.fill();
        ctx.lineWidth = 2; ctx.strokeStyle = '#ffd34d'; ctx.stroke();
      }
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
    var f = 1 + 0.08 * Math.sin(now * 13 + Math.sin(now * 4.3) * 2.5);   // 불꽃 크기 +-8%
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

  // 가시 원반: 회전하는 가시 원
  function drawDisc(ctx, p) {
    var rot = (p.maxLife - p.life) * 9, r = p.r, i;
    ctx.beginPath();
    for (i = 0; i < 16; i++) {
      var a = rot + i * Math.PI / 8, rr = (i & 1) ? r * 0.62 : r * 1.15;
      var px = p.x + Math.cos(a) * rr, py = p.y + Math.sin(a) * rr;
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fillStyle = '#7bd88f';
    ctx.fill();
    ctx.lineWidth = 1.4;
    ctx.strokeStyle = '#1d4a2a';
    ctx.stroke();
    ctx.fillStyle = '#1d4a2a';
    circle(ctx, p.x, p.y, r * 0.3); ctx.fill();
  }

  function drawProjectiles(ctx, l, r, t, b) {
    var items = LW.projectiles.items, n = LW.projectiles.n;
    ctx.lineCap = 'round';
    for (var i = 0; i < n; i++) {
      var p = items[i];
      if (p.x < l || p.x > r || p.y < t || p.y > b) continue;
      if (p.kind === 1) { drawDisc(ctx, p); continue; }
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

  // 장판, 폭발, 예고, 번개 연출
  var BLAST_FILL = ['255,154,60', '182,224,74', '230,60,60'];
  // 테마별 채우기와 테두리 색 문자열은 미리 만들어 둔다(프레임마다 새로 만들지 않는다)
  var BLAST_FILLS = [], BLAST_STROKES = [];
  for (var bf = 0; bf < BLAST_FILL.length; bf++) {
    BLAST_FILLS.push('rgba(' + BLAST_FILL[bf] + ',0.55)');
    BLAST_STROKES.push('rgba(' + BLAST_FILL[bf] + ',1)');
  }
  function drawAreas(ctx, l, r, t, b) {
    var items = LW.areas.items, n = LW.areas.n, K = LW.AREA, i;
    for (i = 0; i < n; i++) {
      var a = items[i];
      var ext = a.r + 20;
      if (a.x + ext < l || a.x - ext > r || a.y + ext < t || a.y - ext > b) continue;
      var p = a.maxLife > 0 ? 1 - a.life / a.maxLife : 1;
      if (p < 0) p = 0;
      switch (a.kind) {
        case K.POISON:
          ctx.globalAlpha = Math.min(1, a.life / 0.4);
          circle(ctx, a.x, a.y, a.r);
          ctx.fillStyle = a.flag ? 'rgba(90,40,140,0.45)' : 'rgba(122,79,176,0.32)'; ctx.fill();
          ctx.lineWidth = 1.5; ctx.strokeStyle = 'rgba(185,140,240,0.7)'; ctx.stroke();
          ctx.fillStyle = 'rgba(210,180,255,0.5)';
          for (var q = 0; q < 3; q++) {
            var ph = R.time * 1.3 + q * 2.1 + a.x * 0.01;
            circle(ctx, a.x + Math.cos(ph * 2) * a.r * 0.5, a.y - ((ph % 1) - 0.5) * a.r * 0.8, 2.5);
            ctx.fill();
          }
          ctx.globalAlpha = 1;
          break;
        case K.BLAST:
          ctx.globalAlpha = (1 - p) * 0.7;
          circle(ctx, a.x, a.y, a.r * (0.4 + 0.6 * p));
          ctx.fillStyle = BLAST_FILLS[a.flag]; ctx.fill();
          ctx.lineWidth = 2; ctx.strokeStyle = BLAST_STROKES[a.flag]; ctx.stroke();
          ctx.globalAlpha = 1;
          break;
        case K.SWING:
          ctx.globalAlpha = (1 - p) * 0.8;
          ctx.beginPath();
          if (a.flag) {
            ctx.arc(a.x, a.y, a.r * (0.5 + 0.5 * p), 0, TAU);
            ctx.arc(a.x, a.y, a.r * 0.55 * (0.5 + 0.5 * p), 0, TAU, true);
          } else {
            var rr = a.r * (0.7 + 0.3 * p), half = 70 * Math.PI / 180;
            ctx.arc(a.x, a.y, rr, a.ang - half, a.ang + half);
            ctx.arc(a.x, a.y, rr * 0.55, a.ang + half, a.ang - half, true);
          }
          ctx.closePath();
          ctx.fillStyle = 'rgba(143,216,255,0.55)'; ctx.fill();
          ctx.lineWidth = 1.5; ctx.strokeStyle = '#e6f8ff'; ctx.stroke();
          ctx.globalAlpha = 1;
          break;
        case K.BOLT:
          ctx.globalAlpha = Math.min(1, a.life / 0.12);
          circle(ctx, a.x, a.y, a.r);
          ctx.fillStyle = 'rgba(255,242,122,0.4)'; ctx.fill();
          ctx.lineCap = 'round'; ctx.lineJoin = 'round';
          ctx.beginPath();
          ctx.moveTo(a.x + 10, a.y - 150); ctx.lineTo(a.x - 8, a.y - 100);
          ctx.lineTo(a.x + 7, a.y - 55); ctx.lineTo(a.x - 4, a.y - 20); ctx.lineTo(a.x, a.y);
          ctx.lineWidth = 5; ctx.strokeStyle = 'rgba(255,242,122,0.6)'; ctx.stroke();
          ctx.lineWidth = 2; ctx.strokeStyle = '#ffffff'; ctx.stroke();
          ctx.globalAlpha = 1;
          break;
        case K.CHAIN:
          ctx.globalAlpha = Math.min(1, a.life / 0.1);
          ctx.beginPath(); ctx.moveTo(a.sx, a.sy); ctx.lineTo((a.sx + a.x) / 2 + 6, (a.sy + a.y) / 2 - 6); ctx.lineTo(a.x, a.y);
          ctx.lineWidth = 2.5; ctx.strokeStyle = '#fff27a'; ctx.stroke();
          ctx.globalAlpha = 1;
          break;
        case K.FLASK:
          circle(ctx, a.x, a.y, a.r);
          ctx.strokeStyle = 'rgba(185,140,240,0.35)'; ctx.lineWidth = 1; ctx.stroke();
          ctx.fillStyle = '#a56bd8';
          circle(ctx, a.sx + (a.x - a.sx) * p, a.sy + (a.y - a.sy) * p - Math.sin(p * Math.PI) * 50, 5);
          ctx.fill();
          ctx.lineWidth = 1.2; ctx.strokeStyle = '#2a1640'; ctx.stroke();
          break;
        case K.SEED:
          var armed = a.tickT >= 0.5;
          ctx.fillStyle = armed && (((R.time * 6) | 0) & 1) ? '#f4ff9a' : '#b6e04a';
          circle(ctx, a.x, a.y, 4.5); ctx.fill();
          ctx.lineWidth = 1.2; ctx.strokeStyle = '#2f4a10'; ctx.stroke();
          if (armed) {
            ctx.globalAlpha = 0.35; circle(ctx, a.x, a.y, 24);
            ctx.strokeStyle = '#b6e04a'; ctx.stroke(); ctx.globalAlpha = 1;
          }
          break;
        case K.TELE:
          circle(ctx, a.x, a.y, a.r);
          ctx.fillStyle = 'rgba(230,60,60,0.14)'; ctx.fill();
          ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(255,90,90,0.9)'; ctx.stroke();
          circle(ctx, a.x, a.y, a.r * p);
          ctx.fillStyle = 'rgba(230,60,60,0.32)'; ctx.fill();
          break;
      }
    }
  }

  // 돌진 예고선: 멧돼지와 마지막 그림자가 방향을 고정하고 기다리는 동안 그 방향으로 붉은 띠를 보여준다
  function drawChargeLines(ctx, l, r, t, b) {
    var items = LW.enemies.items, n = LW.enemies.n;
    for (var i = 0; i < n; i++) {
      var e = items[i];
      if (!e.active || e.aiState !== 1 || (e.def.ai !== 'charge' && e.def.ai !== 'last')) continue;
      if (e.x < l - 300 || e.x > r + 300 || e.y < t - 300 || e.y > b + 300) continue;
      var len = e.def.ai === 'last' ? 400 * 0.5 : 340 * 0.6;
      var nx = -e.ay * e.r, ny = e.ax * e.r;
      var x2 = e.x + e.ax * (len + e.r), y2 = e.y + e.ay * (len + e.r);
      ctx.globalAlpha = 0.28 + 0.2 * Math.sin(R.time * 30);
      ctx.beginPath();
      ctx.moveTo(e.x + nx, e.y + ny); ctx.lineTo(x2 + nx, y2 + ny);
      ctx.lineTo(x2 - nx, y2 - ny); ctx.lineTo(e.x - nx, e.y - ny);
      ctx.closePath();
      ctx.fillStyle = '#e63c3c'; ctx.fill();
      ctx.globalAlpha = 0.8;
      ctx.lineWidth = 1.5; ctx.strokeStyle = '#ff6a6a'; ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }

  // 적 탄: 어두운 붉은 핵과 주황 테두리
  function drawEBullets(ctx, l, r, t, b) {
    var items = LW.ebullets.items, n = LW.ebullets.n;
    for (var i = 0; i < n; i++) {
      var q = items[i];
      if (q.x < l || q.x > r || q.y < t || q.y > b) continue;
      circle(ctx, q.x, q.y, q.r + 1.5);
      ctx.fillStyle = '#ff7a3a'; ctx.fill();
      circle(ctx, q.x, q.y, q.r * 0.7);
      ctx.fillStyle = '#5a1020'; ctx.fill();
    }
  }

  // 항상 켜진 무기 연출: 재의 원, 등롱 궤도
  function drawWeaponFx(ctx, g) {
    var P = LW.player, list = g.weapons;
    for (var i = 0; i < list.length; i++) {
      var w = list[i], bh = w.def.behavior;
      if (bh === 'halo') {
        circle(ctx, P.x, P.y, w.curR || 55);
        ctx.fillStyle = w.evolved ? 'rgba(255,233,168,0.10)' : 'rgba(185,169,154,0.09)'; ctx.fill();
        ctx.lineWidth = w.pulse > 0 ? 3 : 1.5;
        ctx.strokeStyle = w.evolved ? 'rgba(255,233,168,0.7)' : 'rgba(200,186,172,' + (w.pulse > 0 ? 0.85 : 0.4) + ')';
        ctx.stroke();
      } else if (bh === 'orbit' && w.on) {
        for (var k = 0; k < w.pn; k++) {
          var x = w.px[k], y = w.py[k];
          ctx.globalCompositeOperation = 'lighter';
          ctx.globalAlpha = 0.5;
          ctx.drawImage(R.glow, x - 26, y - 26, 52, 52);
          ctx.globalAlpha = 1;
          ctx.globalCompositeOperation = 'source-over';
          ctx.fillStyle = '#34363e';
          roundRect(ctx, x - 4.5, y - 5.5, 9, 11, 2.2); ctx.fill();
          ctx.lineWidth = 1.3; ctx.strokeStyle = '#15161a'; ctx.stroke();
          ctx.fillStyle = '#ffe08a';
          ctx.fillRect(x - 2.8, y - 3.6, 5.6, 7.2);
          LW.drawFlame(ctx, x, y + 0.5, 7);
        }
      }
    }
  }

  var DMG_FONT = 'bold 11px ' + LW.FONT;
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
      ctx.font = DMG_FONT;
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
    drawAreas(ctx, l, r, t, b);
    drawChargeLines(ctx, l, r, t, b);
    drawGems(ctx, g, l, r, t, b);
    drawPickups(ctx, l, r, t, b);
    drawEnemies(ctx, g, l, r, t, b);
    drawPlayer(ctx, g);
    drawWeaponFx(ctx, g);
    drawProjectiles(ctx, l, r, t, b);
    drawEBullets(ctx, l, r, t, b);
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

    if (g.state === 'TITLE' || g.state === 'ACCOUNT' || g.state === 'RANKING' || (g.state === 'SETTINGS' && LW.ui.settingsFrom === 'TITLE')) {
      R.cam.x = 0; R.cam.y = 0;
      LW.ui.drawTitleScene(ctx, g);
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
