// 적 풀과 갱신(AI, 넉백, 밀어내기, 재배치)
(function () {
  var uidSeq = 0;

  function make() {
    return {
      active: false, uid: 0, def: null, x: 0, y: 0, vx: 0, vy: 0, r: 8,
      hp: 1, maxHp: 1, speed: 0, dmg: 0, xp: 0, elite: false, boss: false, special: false,
      summoned: false, kbRes: 0, kbX: 0, kbY: 0, slowT: 0, slowMul: 1, freezeT: 0, flashT: 0,
      aiState: 0, aiT: 0, aiT2: 0, ax: 0, ay: 0, hitCd: new Float32Array(6)
    };
  }
  var pool = LW.enemies = LW.makePool(LW.POOL.enemies, make);

  var TAU = Math.PI * 2;

  // 추적: 플레이어 쪽으로 속도 sp
  function chase(e, dx, dy, d, sp) {
    if (d > 0.01) { e.vx = dx / d * sp; e.vy = dy / d * sp; }
  }

  // 돌진 상태 기계(멧돼지, 마지막 그림자). 0 대기와 추적, 1 예고선, 2 돌진.
  // 대기 시간이 끝났고 거리 조건이 맞으면 예고를 시작한다. 방향은 예고 시작 때 고정한다.
  function charge(e, dt, dx, dy, d, sp, cycle, range, warn, dashT, dashSp) {
    if (e.aiState === 0) {
      chase(e, dx, dy, d, sp);
      e.aiT -= dt;
      if (e.aiT <= 0 && d <= range && d > 0.01) {
        e.aiState = 1; e.aiT = warn; e.ax = dx / d; e.ay = dy / d;
      }
    } else if (e.aiState === 1) {
      e.vx = 0; e.vy = 0;
      e.aiT -= dt;
      if (e.aiT <= 0) { e.aiState = 2; e.aiT = dashT; }
    } else {
      e.vx = e.ax * dashSp; e.vy = e.ay * dashSp;
      e.aiT -= dt;
      if (e.aiT <= 0) { e.aiState = 0; e.aiT = cycle; }
    }
  }

  // 적 종류별 행동. e.vx, e.vy를 정한다.
  function ai(e, dt, dx, dy, d) {
    var sp = e.speed * e.slowMul, ux = d > 0.01 ? dx / d : 0, uy = d > 0.01 ? dy / d : 0, k;
    switch (e.def.ai) {
      case 'flutter':
        // 진행 방향의 수직으로 3Hz로 흔들며 추적(가로 속도 진폭 120)
        var sw = Math.sin(LW.game.time * TAU * 3 + e.uid) * 120;
        e.vx = ux * sp - uy * sw; e.vy = uy * sp + ux * sw;
        break;
      case 'shoot':
        // 160~220 거리를 유지하고, 2.8초마다 탄 발사
        if (d > 220) { e.vx = ux * sp; e.vy = uy * sp; }
        else if (d < 160) { e.vx = -ux * sp; e.vy = -uy * sp; }
        else { e.vx = 0; e.vy = 0; }
        e.aiT -= dt;
        if (e.aiT <= 0) {
          if (d < 320) { LW.ebullets.fire(e.x, e.y, ux, uy, 170, 5, 9, 4); e.aiT += 2.8; }
          else e.aiT = 0.2;
        }
        break;
      case 'charge':
        // 4초마다, 거리 350 이하면 0.5초 예고선 뒤 340/s로 0.6초 돌진
        charge(e, dt, dx, dy, d, sp, 4, 350, 0.5, 0.6, 340);
        break;
      case 'fly':
        // 직선 비행(방향은 ax, ay). 수명이 다하면 처치 처리 없이 사라진다
        e.vx = e.ax * e.speed; e.vy = e.ay * e.speed;
        e.aiT -= dt;
        if (e.aiT <= 0) e.active = false;
        break;
      case 'colossus':
        chase(e, dx, dy, d, sp);
        e.aiT -= dt;
        if (e.aiT <= 0) {
          e.aiT += 4;
          LW.areas.add(LW.AREA.TELE, 0, LW.player.x, LW.player.y, 110, 25, 0.8);
        }
        break;
      case 'queen':
        chase(e, dx, dy, d, sp);
        e.aiT -= dt;
        if (e.aiT <= 0) {
          e.aiT += 5;
          LW.ebullets.ring(e.x, e.y, 12, LW.rand() * TAU, 140, 6, 12, 6);
        }
        e.aiT2 -= dt;
        if (e.aiT2 <= 0) {
          e.aiT2 += 8;
          // 살아 있는 소환 나방이 상한(24)이면 더 부르지 않는다
          var alive = 0, list = LW.enemies.items, cnt = LW.enemies.n;
          for (k = 0; k < cnt; k++) if (list[k].active && list[k].summoned) alive++;
          for (k = 0; k < 8 && alive < LW.SUMMON_CAP; k++, alive++) {
            var a = k * TAU / 8, m = LW.enemies.spawnEnemy('moth', e.x + Math.cos(a) * 50, e.y + Math.sin(a) * 50, LW.game.time / 60);
            if (m) { m.special = true; m.summoned = true; }
          }
        }
        break;
      case 'last':
        // 5초마다 0.6초 예고선 뒤 400/s로 0.5초 돌진, 4초마다 16방향 탄
        charge(e, dt, dx, dy, d, sp, 5, 99999, 0.6, 0.5, 400);
        e.aiT2 -= dt;
        if (e.aiT2 <= 0) {
          e.aiT2 += 4;
          LW.ebullets.ring(e.x, e.y, 16, LW.rand() * TAU, 150, 6, 14, 6);
        }
        break;
      default:
        chase(e, dx, dy, d, sp);
    }
  }

  // minutes: 경과 분. 시간 보정은 스폰할 때 한 번만 적용한다
  // 보스가 아닌 적은 풀 끝 BOSS_RESERVE칸을 쓰지 않는다. 보스 칸이 찰 일이 없게 하기 위해서다.
  pool.spawnEnemy = function (defId, x, y, minutes, isBoss) {
    var e = pool.spawn(isBoss ? undefined : pool.size - LW.BOSS_RESERVE);
    if (!e) return null;
    e.summoned = false;
    var d = LW.ENEMIES[defId];
    e.def = d; e.uid = ++uidSeq;
    e.x = x; e.y = y; e.vx = 0; e.vy = 0; e.r = d.r;
    e.maxHp = d.hp * (1 + 0.15 * minutes);
    e.hp = e.maxHp;
    e.speed = d.speed;
    e.dmg = d.dmg * (1 + 0.05 * minutes);
    e.xp = d.xp;
    e.elite = false; e.boss = false; e.special = false;
    e.kbRes = d.kbRes; e.kbX = 0; e.kbY = 0;
    e.slowT = 0; e.slowMul = 1; e.freezeT = 0; e.flashT = 0;
    e.aiState = 0; e.aiT = 0; e.aiT2 = 0; e.ax = 0; e.ay = 0;
    // 첫 행동 시점을 흩어 놓는다
    if (d.ai === 'shoot') e.aiT = LW.rand() * 2.8;
    else if (d.ai === 'charge') e.aiT = 1 + LW.rand() * 3;
    else if (d.ai === 'colossus') e.aiT = 2;
    else if (d.ai === 'queen') { e.aiT = 3; e.aiT2 = 6; }
    else if (d.ai === 'last') { e.aiT = 4; e.aiT2 = 3; }
    else if (d.ai === 'fly') e.aiT = 6;
    var sc = LW.spawner.spawned;
    sc[defId] = (sc[defId] || 0) + 1;
    e.hitCd.fill(0);
    return e;
  };

  // 엘리트 보정: HP x12, 반경 x1.5, 접촉 피해 x1.5, 속도 x0.9, XP 20, 넉백 저항 0.8. 상한과 무관한 특수 적이다.
  pool.makeElite = function (e) {
    e.elite = true; e.special = true;
    e.maxHp *= 12; e.hp = e.maxHp;
    e.r *= 1.5; e.dmg *= 1.5; e.speed *= 0.9;
    e.xp = 20; e.kbRes = 0.8;
    return e;
  };

  // 풀이 가득 찼을 때 보스 자리를 만든다. 일반 적을 먼저, 없으면 보스가 아닌 아무 적을 고른다.
  function freeFarthest() {
    var P = LW.player, items = pool.items, n = pool.n, best = -1, bd = -1, bs = false, i;
    for (i = 0; i < n; i++) {
      var e = items[i];
      if (!e.active || e.boss) continue;
      var dx = e.x - P.x, dy = e.y - P.y, d2 = dx * dx + dy * dy;
      // 일반 적(special 아님)이 항상 먼저다
      if (best < 0 || (bs && !e.special) || (bs === e.special && d2 > bd)) { best = i; bd = d2; bs = e.special; }
    }
    if (best < 0) return false;
    items[best].active = false;
    pool.compact();
    return true;
  }

  // 보스: 시간 보정 없이 표의 값 그대로. 넉백, 빙결, 끌어당김이 통하지 않고 상한과 무관하다.
  pool.spawnBoss = function (defId, x, y) {
    var e = pool.spawnEnemy(defId, x, y, 0, true);
    if (!e) {
      // 예약 칸까지 찼다면 플레이어에서 가장 먼 적 하나를 처치 처리 없이 지우고 그 칸을 쓴다
      if (!freeFarthest()) return null;
      e = pool.spawnEnemy(defId, x, y, 0, true);
      if (!e) return null;
    }
    e.boss = true; e.special = true; e.xp = 100; e.kbRes = 1;
    pool.boss = e;
    LW.game.bossesSeen.push(defId);
    return e;
  };

  pool.update = function (dt) {
    var items = pool.items, n = pool.n, P = LW.player, v = LW.view, grid = LW.grid;
    var KB = LW.KB_SCALE;
    var kbDecay = Math.max(0, 1 - 10 * dt);
    var far = Math.max(v.w, v.h) / 2 + 400, far2 = far * far;
    var i;

    // 1) 이동, 넉백, 타이머
    for (i = 0; i < n; i++) {
      var e = items[i];
      if (!e.active) continue;
      if (e.flashT > 0) e.flashT -= dt;
      if (e.slowT > 0) { e.slowT -= dt; if (e.slowT <= 0) e.slowMul = 1; }
      var dx = P.x - e.x, dy = P.y - e.y;
      var d = Math.sqrt(dx * dx + dy * dy);
      if (e.freezeT > 0) {
        e.freezeT -= dt;
        e.vx = 0; e.vy = 0;
      } else {
        ai(e, dt, dx, dy, d);
        if (!e.active) continue;      // 까마귀가 수명이 다해 사라졌다
      }
      e.x += (e.vx + e.kbX * KB) * dt;
      e.y += (e.vy + e.kbY * KB) * dt;
      e.kbX *= kbDecay; e.kbY *= kbDecay;
    }

    // 2) 밀어내기: 시야 안의 적만, 이웃 최대 8
    var left = P.x - v.w / 2 - 32, right = P.x + v.w / 2 + 32;
    var top = P.y - v.h / 2 - 32, bottom = P.y + v.h / 2 + 32;
    var cols = grid.cols, rows = grid.rows, start = grid.start, order = grid.order;
    for (i = 0; i < n; i++) {
      var a = items[i];
      if (!a.active || a.boss) continue;
      if (a.x < left || a.x > right || a.y < top || a.y > bottom) continue;
      var fx = Math.floor((a.x - grid.ox) / LW.CELL), fy = Math.floor((a.y - grid.oy) / LW.CELL);
      if (fx < 0 || fy < 0 || fx >= cols || fy >= rows) continue;
      var cnt = 0;
      for (var cy = fy - 1; cy <= fy + 1 && cnt < 8; cy++) {
        if (cy < 0 || cy >= rows) continue;
        for (var cx = fx - 1; cx <= fx + 1 && cnt < 8; cx++) {
          if (cx < 0 || cx >= cols) continue;
          var c = cy * cols + cx;
          for (var k = start[c], end = start[c + 1]; k < end && cnt < 8; k++) {
            var j = order[k];
            if (j === i) continue;
            var o = items[j];
            if (!o.active) continue;
            var ex = a.x - o.x, ey = a.y - o.y, rr = a.r + o.r;
            var d2 = ex * ex + ey * ey;
            if (d2 >= rr * rr) continue;
            cnt++;
            var dd = Math.sqrt(d2);
            if (dd < 0.001) { ex = i < j ? 0.01 : -0.01; ey = 0; dd = 0.01; }
            var push = (rr - dd) * 0.35 / dd;
            a.x += ex * push; a.y += ey * push;
          }
        }
      }
    }

    // 3) 재배치: 너무 멀어지면 처치 처리 없이 플레이어 이동 방향 쪽 테두리로 옮긴다
    for (i = 0; i < n; i++) {
      var f = items[i];
      if (!f.active || f.boss || f.def.noReloc) continue;
      var rx = f.x - P.x, ry = f.y - P.y;
      if (rx * rx + ry * ry > far2) LW.spawner.relocate(f);
    }
  };

  pool.reset = function () { pool.clear(); pool.boss = null; };
})();
