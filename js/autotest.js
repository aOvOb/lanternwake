// 자동 검사 모드: ?autotest=N
// 오류를 모으고, 플레이어를 자동으로 움직이고, N초가 지나면 결과 JSON을 <pre id="autotest">에 쓴다.
// 결과 JSON: ok는 "수집된 오류가 없음", reached는 "목표 시각에 도달했거나 승리", died는 "사망으로 끝남"이다.
// 보조 옵션: &start=초(그 시각부터 시작, N은 그 뒤로 더 돌 시간), &build=all|alt(시작 빌드와 자동 레벨업),
//           &rounds=N(연속 N판, 사망하면 다시 하기), &dieat=초(각 판을 그 시각에 사망시킴),
//           &snapstate=TITLE|RESULT|PAUSED|SETTINGS(그 화면이 그려진 뒤 스냅샷),
//           &crowd=1(적 풀을 가득 채움), &killlast=1(마지막 그림자 HP를 1로),
//           &god=1(무적), &elite=1(15초마다 엘리트), &candle=1(6초마다 가까운 촛대), &snap=T1,T2(게임 초에 캔버스를 PNG base64로 <pre id="snap-T">에 기록),
//           &bot=1(밸런스 점검용 휴리스틱 봇: 덜 붐비는 쪽과 보석 쪽으로 이동, 적 탄과 예고를 피하고, 레벨업 카드를 규칙으로 고름),
//           &bot=naive(불씨 화살만 유지하는 무강화 봇: 새 무기와 패시브 카드를 거절), &seed=N(난수 시드, 기본 12345).
//           봇은 input.auto(이동 벡터)로만 움직이고 게임 규칙과 수치는 건드리지 않는다. 결과 JSON의 bot 항목에 사망 시각, 레벨, 처치 수, 진화 수, 분당 받은 피해가 들어간다.
(function () {
  var N = LW.params.autotest;
  var BENCH = LW.params.bench;
  var FLOW = LW.params.flow === 'acct';
  var flow = { active: false, step: 0, t: 0, log: [] };   // 판이 끝난 뒤 계정, 순위표 화면을 거치는 시나리오(flow=acct)
  var acctSince = 0;                                      // acct=1: 계정 준비를 기다리기 시작한 시각
  var benchPlay = 0, benchLast = 0;   // bench: PLAYING 상태로 흐른 실제 시간(ms)
  var START = LW.params.start;
  var at = LW.autotest = { active: N > 0, done: false, errors: [], seconds: N, angle: 0, endTime: START + N, snapsTaken: [] };
  // 게스트 기록과 설정 심기: storage.js 보다 먼저 실행되므로 LW.records 와 LW.settings 가 이 값을 읽는다
  if (LW.params.guestRec && N > 0) {
    try {
      localStorage.setItem('lanternwake.v1.records', JSON.stringify({ bestTime: 120, bestKills: 200, bestLevel: 5, wins: 0, runs: 3, fullDawns: 0 }));
      localStorage.setItem('lanternwake.v1.settings', JSON.stringify({ sound: false, vibrate: true, dmgNumbers: true, quality: 'auto', rev: Date.now() }));
    } catch (e) { /* 무시 */ }
  }
  var dir = { x: 0, y: 0 };
  var snaps = LW.params.snap.slice().sort(function (a, b) { return a - b; });
  var snapIdx = 0;
  if (!at.active) return;

  function str(v) {
    try { return typeof v === 'string' ? v : (v && v.stack) || JSON.stringify(v); }
    catch (e) { return String(v); }
  }
  function push(msg) { if (at.errors.length < 50) at.errors.push(msg); }

  var prevOnError = window.onerror;
  window.onerror = function (msg, src, line, col) {
    push('onerror: ' + msg + ' (' + src + ':' + line + ':' + col + ')');
    if (prevOnError) return prevOnError.apply(this, arguments);
    return false;
  };
  window.addEventListener('unhandledrejection', function (e) {
    push('unhandledrejection: ' + str(e.reason));
  });
  var origErr = console.error;
  console.error = function () {
    var parts = [];
    for (var i = 0; i < arguments.length; i++) parts.push(str(arguments[i]));
    push('console.error: ' + parts.join(' '));
    return origErr.apply(console, arguments);
  };

  // ===== 봇(&bot=1, &bot=naive) =====
  var BOT = LW.params.bot, NAIVE = BOT === 'naive';
  var botDmg = new Float64Array(15);      // 1분 단위로 받은 피해 합(방어력 적용 뒤 실제로 깎인 HP)
  var botEvoAt = [];                      // 진화가 일어난 게임 시각
  var botHooked = false, botT = 0, botPrev = 0;
  var GN = 14, GC = 48, GH = GN * GC / 2;  // 밀도 그리드: 칸 48, 14x14, 플레이어 중심 +-336
  var dens = new Float32Array(GN * GN), blur = new Float32Array(GN * GN);
  var NDIR = 16, COS = [], SIN = [], score = new Float64Array(NDIR);
  var RAY_D = [30, 70, 110, 150], RAY_W = [1, 0.9, 0.7, 0.5];
  var nearBuf = [], nearN = 0;
  for (var bk = 0; bk < NDIR; bk++) { COS.push(Math.cos(bk * Math.PI * 2 / NDIR)); SIN.push(Math.sin(bk * Math.PI * 2 / NDIR)); }

  // 받은 피해를 기록한다. 원래 hurt를 그대로 부르고 HP가 깎인 양만 잰다(규칙은 바뀌지 않는다).
  function botHook() {
    if (botHooked) return;
    botHooked = true;
    var P = LW.player, orig = P.hurt;
    P.hurt = function (dmg) {
      var before = P.hp;
      orig.call(P, dmg);
      var m = Math.min(14, (LW.game.time / 60) | 0);
      botDmg[m] += before - P.hp;
    };
  }

  // 30Hz로 이동 방향을 새로 고른다. 16방향마다 점수를 매겨 가장 높은 방향의 단위 벡터를 input.auto로 넘긴다.
  function botMove(dt) {
    botT -= dt;
    if (botT > 0) return;
    botT = 1 / 30;
    var P = LW.player, sp = P.speed * P.moveMul;
    var items, n, i, k, j, dx, dy, d, dot, e;
    for (k = 0; k < NDIR; k++) score[k] = 0;

    // 1) 주변 적 밀도 그리드(접촉 피해가 클수록, 엘리트와 보스일수록 가중치가 큼)를 3x3으로 흐려 방향별 광선 위를 읽는다
    dens.fill(0);
    items = LW.enemies.items; n = LW.enemies.n; nearN = 0;
    for (i = 0; i < n; i++) {
      e = items[i];
      if (!e.active) continue;
      dx = e.x - P.x; dy = e.y - P.y;
      if (dx <= -GH || dx >= GH || dy <= -GH || dy >= GH) continue;
      var w = 1 + e.dmg * 0.08;
      if (e.elite) w *= 2;
      if (e.boss) w *= 3;
      dens[(((dy + GH) / GC) | 0) * GN + (((dx + GH) / GC) | 0)] += w;
      if (dx * dx + dy * dy < 100 * 100) nearBuf[nearN++] = e;
    }
    for (var gy = 0; gy < GN; gy++) {
      for (var gx = 0; gx < GN; gx++) {
        var sum = 0;
        for (var oy = -1; oy <= 1; oy++) {
          for (var ox = -1; ox <= 1; ox++) {
            var cx = gx + ox, cy = gy + oy;
            if (cx >= 0 && cy >= 0 && cx < GN && cy < GN) sum += dens[cy * GN + cx];
          }
        }
        blur[gy * GN + gx] = sum;
      }
    }
    for (k = 0; k < NDIR; k++) {
      for (j = 0; j < RAY_D.length; j++) {
        var qx = (COS[k] * RAY_D[j] + GH) / GC, qy = (SIN[k] * RAY_D[j] + GH) / GC;
        score[k] -= RAY_W[j] * 0.45 * blur[(qy | 0) * GN + (qx | 0)];
      }
    }
    // 바로 옆의 적 쪽으로는 가지 않는다
    for (i = 0; i < nearN; i++) {
      e = nearBuf[i];
      dx = e.x - P.x; dy = e.y - P.y; d = Math.sqrt(dx * dx + dy * dy) || 1;
      if (d > e.r + P.r + 40) continue;
      for (k = 0; k < NDIR; k++) {
        dot = (dx * COS[k] + dy * SIN[k]) / d;
        if (dot > 0) score[k] -= 5 * dot * (1 + e.dmg * 0.05);
      }
    }

    // 2) 보석 쪽으로
    items = LW.gems.items; n = LW.gems.n;
    for (i = 0; i < n; i++) {
      var gm = items[i];
      if (!gm.active) continue;
      dx = gm.x - P.x; dy = gm.y - P.y; d = Math.sqrt(dx * dx + dy * dy);
      if (d > 320 || d < 1) continue;
      var f = (1 + Math.min(gm.value, 20) * 0.1) * 1.6 / (1 + d / 120) / d;
      for (k = 0; k < NDIR; k++) {
        dot = dx * COS[k] + dy * SIN[k];
        if (dot > 0) score[k] += dot * f;
      }
    }
    // 상자는 진화에 필요하므로 크게, 기름은 HP가 모자랄 때, 끌개 종과 정화의 빛은 조금
    items = LW.pickups.items; n = LW.pickups.n;
    var K = LW.PK, low = P.hp < P.maxHp * 0.7;
    for (i = 0; i < n; i++) {
      var pk = items[i];
      if (!pk.active) continue;
      var kw = pk.kind === K.CHEST || pk.kind === K.BOSS_CHEST ? 4 : (pk.kind === K.OIL ? (low ? 3 : 0.5) : (pk.kind === K.BELL ? 1.5 : (pk.kind === K.LIGHT ? 2 : 0)));
      if (!kw) continue;
      dx = pk.x - P.x; dy = pk.y - P.y; d = Math.sqrt(dx * dx + dy * dy);
      if (d > 700 || d < 1) continue;
      for (k = 0; k < NDIR; k++) {
        dot = (dx * COS[k] + dy * SIN[k]) / d;
        if (dot > 0) score[k] += kw * dot;
      }
    }

    // 3) 적 탄: 방향 k로 가면 탄과 닿는지 0.15~0.8초 앞까지 본다
    items = LW.ebullets.items; n = LW.ebullets.n;
    for (i = 0; i < n; i++) {
      var b = items[i];
      dx = b.x - P.x; dy = b.y - P.y;
      if (dx * dx + dy * dy > 300 * 300) continue;
      var br = b.r + P.r + 8;
      for (k = 0; k < NDIR; k++) {
        for (var t = 0.15; t <= 0.81; t += 0.15) {
          var ex = b.x + b.vx * t - (P.x + COS[k] * sp * t), ey = b.y + b.vy * t - (P.y + SIN[k] * sp * t);
          if (ex * ex + ey * ey < br * br) { score[k] -= 9 * (1.2 - t); break; }
        }
      }
    }

    // 4) 예고 원: 터지는 시각의 위치가 원 안이면 크게 감점
    items = LW.areas.items; n = LW.areas.n;
    for (i = 0; i < n; i++) {
      var a = items[i];
      if (a.kind !== LW.AREA.TELE || a.life <= 0) continue;
      var life = a.life + 0.05, rr = a.r + P.r * 0.5 + 4;
      for (k = 0; k < NDIR; k++) {
        var tx = P.x + COS[k] * sp * life - a.x, ty = P.y + SIN[k] * sp * life - a.y;
        if (tx * tx + ty * ty < rr * rr) score[k] -= 14;
      }
    }

    // 5) 예고선과 돌진: 멧돼지(340/s, 0.6초)와 마지막 그림자(400/s, 0.5초)의 돌진 경로와 겹치는 방향은 감점
    items = LW.enemies.items; n = LW.enemies.n;
    for (i = 0; i < n; i++) {
      e = items[i];
      if (!e.active || e.aiState === 0 || (e.def.ai !== 'charge' && e.def.ai !== 'last')) continue;
      var dsp = e.def.ai === 'charge' ? 340 : 400, dT = e.def.ai === 'charge' ? 0.6 : 0.5;
      var warn = e.aiState === 1 ? e.aiT : 0, dashLeft = e.aiState === 1 ? dT : e.aiT;
      var hr = e.r + P.r + 8;
      for (k = 0; k < NDIR; k++) {
        for (var t2 = 0.05; t2 <= 1.3; t2 += 0.1) {
          var run = t2 - warn;
          if (run < 0) run = 0; else if (run > dashLeft) run = dashLeft;
          var hx = e.x + e.ax * dsp * run - (P.x + COS[k] * sp * t2), hy = e.y + e.ay * dsp * run - (P.y + SIN[k] * sp * t2);
          if (hx * hx + hy * hy < hr * hr) { score[k] -= 12 * (1.5 - t2 * 0.5); break; }
        }
      }
    }

    // 6) 흔들림을 줄이려고 직전 방향을 조금 선호
    score[botPrev] += 0.4;
    score[(botPrev + 1) % NDIR] += 0.2; score[(botPrev + NDIR - 1) % NDIR] += 0.2;
    var best = botPrev;
    for (k = 0; k < NDIR; k++) if (score[k] > score[best]) best = k;
    botPrev = best;
    dir.x = COS[best]; dir.y = SIN[best];
  }

  // 레벨업 카드 점수. 높은 쪽을 고르고, 0 이하는 거절한다(무강화 봇만 거절이 나온다).
  // 보유 무기 레벨업 > 진화 짝 패시브(새로 얻기) > 새 무기(슬롯 채우기) > 진화 짝 패시브 레벨업 > 그 밖의 새 패시브 > 그 밖의 패시브 레벨업
  function botCardScore(c) {
    var g = LW.game, i, w = null, p = null;
    if (c.type === 'heal') return 1;
    if (c.type === 'weapon') {
      for (i = 0; i < g.weapons.length; i++) if (g.weapons[i].def.id === c.id) w = g.weapons[i];
      if (NAIVE) return c.id === 'ember' ? 100 : 0;
      if (!w) return 60;
      var evo = LW.EVO_BY_WEAPON[c.id], partner = false;
      for (i = 0; evo && i < g.passives.length; i++) if (g.passives[i].def.id === evo.passive) partner = true;
      return 100 + w.lv * 2 + (partner ? 6 : 0);
    }
    if (NAIVE) return 0;
    for (i = 0; i < g.passives.length; i++) if (g.passives[i].def.id === c.id) p = g.passives[i];
    var isPartner = false;
    for (i = 0; i < g.weapons.length; i++) {
      var ev = LW.EVO_BY_WEAPON[g.weapons[i].def.id];
      if (ev && ev.passive === c.id && !g.weapons[i].evolved) isPartner = true;
    }
    if (isPartner) return p ? 40 : 90;
    return p ? 20 : 30;
  }
  function botLevelup(g) {
    var lu = LW.levelup, best = -1, bs = 0, i;
    for (i = 0; i < lu.n; i++) {
      var s = botCardScore(lu.cands[i]);
      if (s > bs) { bs = s; best = i; }
    }
    if (best >= 0) { lu.choose(best); return; }
    // 거절: 카드를 고르지 않고 레벨업 창만 닫는다(choose의 끝부분과 같은 경로)
    g.pending--;
    if (g.pending > 0) lu.open();
    else g.setState('PLAYING');
  }

  // 게임 시간 1스텝마다 호출: 플레이어가 원을 그리며 움직인다(봇이면 botMove)
  at.tick = function (dt) {
    if (BOT) { botMove(dt); LW.input.auto = dir; return; }
    at.angle += dt * 0.5;
    dir.x = Math.cos(at.angle); dir.y = Math.sin(at.angle);
    // 상자와 아이템이 떨어져 있으면 가장 가까운 것 쪽으로 간다(획득 경로 검사). 촛대는 부서져야 해서 목표로 삼지 않는다.
    var pk = LW.pickups, P = LW.player, best = 1e12;
    for (var i = 0; i < pk.n; i++) {
      if (pk.items[i].kind === LW.PK.CANDLE) continue;
      var dx = pk.items[i].x - P.x, dy = pk.items[i].y - P.y, d2 = dx * dx + dy * dy;
      if (d2 < best && d2 < 640000) { best = d2; var d = Math.sqrt(d2) || 1; dir.x = dx / d; dir.y = dy / d; }
    }
    LW.input.auto = dir;
  };

  // 빌드별 시작 무기와 패시브. 아직 없는 항목(구현 전 단계)은 건너뛴다.
  var BUILDS = {
    all: { w: ['ember', 'orbit', 'halo', 'scythe', 'bell', 'disc'], p: ['P2', 'P4', 'P7', 'P1', 'P3', 'P5'] },
    alt: { w: ['ember', 'flask', 'seed'], p: ['P8', 'P9', 'P6', 'P10', 'P1', 'P7'] }
  };
  var buildCfg = BUILDS[LW.params.build] || null;
  var stepT = 0, stepRR = 0;

  // 연속 판 검사: 판이 시작된 직후의 풀 활성 수와 상태를 기록해 초기화가 됐는지 본다
  var ROUNDS = LW.params.rounds, roundNo = 1, roundT = 0, roundsDone = 0, resultAt = 0, titleAt = 0, sceneAt = 0, scene = 0;
  at.roundStarts = [];
  at.roundEnds = [];
  // 판이 끝난 시점의 상태(재시작 전에 풀에 무엇이 남아 있었는지 보여 준다)
  function endNote(g) {
    return { time: r2(g.time), kills: g.kills, died: !g.won, level: g.level, enemies: LW.enemies.n, projectiles: LW.projectiles.n,
      areas: LW.areas.n, gems: LW.gems.n, pickups: LW.pickups.n, particles: LW.particles.n };
  }
  function noteRoundStart(g) {
    at.roundStarts.push({
      enemies: LW.enemies.n, projectiles: LW.projectiles.n, areas: LW.areas.n, ebullets: LW.ebullets.n,
      gems: LW.gems.n, pickups: LW.pickups.n, particles: LW.particles.n, dmgNums: LW.dmgNums.n,
      hp: LW.player.hp, maxHp: LW.player.maxHp, time: g.time, level: g.level, kills: g.kills, pending: g.pending,
      weapons: g.weapons.length, passives: g.passives.length, evolved: g.weapons.some(function (w) { return w.evolved; }),
      candles: LW.pickups.nCandle, boss: !!LW.enemies.boss, won: g.won, toast: g.toastT, mapItems: g.mapStats.candleSpawned
    });
    roundT = 0;
  }

  // 효과음 호출 경로 검사: 모든 효과음을 한 번씩 불러 예외가 없는지 본다(맨 처음 판에서만)
  var audioChecked = false;
  function audioCheck() {
    if (audioChecked) return;
    audioChecked = true;
    var names = ['hit', 'gem', 'levelup', 'hurt', 'chest', 'bossWarn', 'win', 'lose', 'start', 'pickup', 'candle'];
    for (var i = 0; i < names.length; i++) {
      try { LW.audio[names[i]](); } catch (e) { push('audio.' + names[i] + ': ' + str(e)); }
    }
    try { LW.audio.vibrate(10); LW.audio.suspend(); LW.audio.resume(); LW.audio.applySettings(); } catch (e2) { push('audio: ' + str(e2)); }
  }

  // 새 판이 시작된 직후 한 번 호출: 시간 건너뛰기와 시작 빌드
  at.setup = function (g) {
    audioCheck();
    if (START > 0) {
      g.time = START;
      if (LW.spawner.skipTo) LW.spawner.skipTo(START);
    }
    stepT = 0; stepRR = 0;
    if (BOT) { botHook(); botDmg.fill(0); botEvoAt.length = 0; botT = 0; botPrev = 0; }
    if (!buildCfg) return;
    var boostW = START > 0 ? Math.min(7, Math.floor(START / 60)) : 0;
    var boostP = START > 0 ? Math.min(4, Math.floor(START / 200)) : 0;
    var i, id;
    g.weapons = [];
    for (i = 0; i < buildCfg.w.length; i++) {
      id = buildCfg.w[i];
      if (!LW.WEAPON_BY_ID[id]) continue;
      var w = LW.makeWeapon(id, g.weapons.length);
      w.lv = Math.min(w.def.maxLv, 1 + boostW);
      g.weapons.push(w);
    }
    g.passives = [];
    for (i = 0; i < buildCfg.p.length; i++) {
      id = buildCfg.p[i];
      if (!LW.PASSIVE_BY_ID || !LW.PASSIVE_BY_ID[id]) continue;
      var pd = LW.PASSIVE_BY_ID[id];
      g.passives.push({ def: pd, lv: Math.min(pd.maxLv, 1 + boostP) });
    }
    LW.player.recomputeStats();
  };

  var candleT = 0;
  // &candle=1: 6초마다 가까운 곳에 촛대를 만든다(촛대 부수기, 세 아이템 경로 검사용)
  function candleStep(g, dt) {
    if (!LW.params.candle) return;
    candleT += dt;
    if (candleT < 6) return;
    candleT -= 6;
    LW.spawnCandle(true);
  }

  var eliteT = 0, eliteRR = 0;
  // &elite=1: 15초마다 엘리트를 하나 만든다(엘리트, 상자 경로 검사용)
  function eliteStep(g, dt) {
    if (!LW.params.elite) return;
    eliteT += dt;
    if (eliteT < 15) return;
    eliteT -= 15;
    var ids = ['mite', 'moth', 'mudling', 'spore', 'rusthelm', 'eye', 'boar'], tries = 0, id;
    while (tries++ < ids.length) {
      id = ids[eliteRR++ % ids.length];
      if (LW.ENEMIES[id]) { LW.spawner.spawnElite(id); return; }
    }
  }

  // 2초마다 무기 하나의 레벨을 올린다. 진화 조건이 갖춰진 무기가 있으면 상자를 지급한다.
  function buildStep(g, dt) {
    if (!buildCfg) return;
    stepT += dt;
    if (stepT < 2) return;
    stepT -= 2;
    var list = g.weapons, n = list.length, k;
    for (k = 0; k < n; k++) {
      var w = list[(stepRR + k) % n];
      if (w.lv < w.def.maxLv && !w.evolved) { w.lv++; stepRR = (stepRR + k + 1) % n; break; }
    }
    LW.player.recomputeStats();
    if (LW.chest && LW.chest.hasEvolvable() && g.giveChest) g.giveChest(false);
  }

  function sinkPost(name, body) {
    if (!LW.params.sink) return;
    try { fetch('/__sink/' + name, { method: 'POST', body: body, keepalive: body.length < 60000 }).catch(function () { /* 무시 */ }); } catch (e) { /* 무시 */ }
  }
  function takeSnap(t) {
    var url = '';
    try { url = LW.canvas.toDataURL('image/png'); } catch (e) { push('snap: ' + str(e)); }
    var pre = document.createElement('pre');
    pre.id = 'snap-' + t;
    pre.textContent = url.slice(url.indexOf(',') + 1);
    document.body.appendChild(pre);
    at.snapsTaken.push(t);
    sinkPost('snap-' + t + '.b64', pre.textContent);
  }

  // 계정 준비 대기(acct=1): 서버 확인과 가짜 로그인, 시작 표 받기가 끝나거나 10초가 지날 때까지 타이틀에서 기다린다
  function acctReady(now) {
    var A = LW.account;
    if (!acctSince) acctSince = now;
    if (now - acctSince > 10000) return true;
    if (A.status === 'checking') return false;
    if (LW.params.devLogin && A.status === 'online' && !A.verified) return false;
    if (A.loggedIn && A.status === 'online' && A.ticketCount() < 1) return false;
    return true;
  }

  // 판이 끝난 뒤 화면 순례: 결과 줄, 계정(닉네임 폼 포함), 순위표 두 보드, 로그아웃 뒤 게스트 화면. 끝나면 false.
  function ptr(type, x, y) {
    LW.canvas.dispatchEvent(new PointerEvent(type, { pointerId: 7, clientX: x, clientY: y, bubbles: true, isPrimary: true, pointerType: 'touch' }));
  }
  function flowTick(g, now) {
    var A = LW.account, ui = LW.ui;
    if (!flow.t) flow.t = now;
    var age = now - flow.t;
    function next() { flow.step++; flow.t = 0; }
    var boardsReady = !A.boards.time.loading && !A.boards.kills.loading;
    switch (flow.step) {
      case 0:
        if ((A.lastStatus !== 'pending' || age > 10000) && age >= 800) {
          flow.log.push('result: ' + A.resultLine + ' queue=' + A.queueCount());
          takeSnap('result'); next();
        }
        break;
      case 1: ui.act('title'); next(); break;
      case 2: if (age >= 400) { ui.act('account'); next(); } break;
      case 3:
        if (age >= 500) {
          takeSnap('account');
          // 닉네임 폼: 열고, 값을 넣고, 제출한다(DOM 폼 경로)
          ui.openNick();
          flow.log.push('nickOpen: ' + ui.nickOpen());
          var inEl = document.getElementById('nickIn');
          inEl.value = 'AutoOwl';
          document.getElementById('nick').dispatchEvent(new Event('submit', { cancelable: true }));
          next();
        }
        break;
      case 4:
        if (!ui.nickOpen() || age > 5000) { flow.log.push('nickname: ' + A.nickname + ' set=' + A.nicknameSet); next(); }
        break;
      case 5: if (age >= 500) { takeSnap('account-nick'); ui.act('back'); next(); } break;
      case 6: ui.act('ranking'); next(); break;
      case 7:
        if (age >= 1500 && boardsReady) { takeSnap('ranking'); flow.sub = 0; ptr('pointerdown', 220, 520); next(); }
        break;
      case 8:
        // 세로 끌기: 실제 포인터 이벤트로 목록을 위로 민다(입력 모듈의 끌기 경로)
        flow.sub++;
        ptr('pointermove', 220, 520 - flow.sub * 70);
        if (flow.sub >= 5) { ptr('pointerup', 220, 520 - flow.sub * 70); next(); }
        break;
      case 9: if (age >= 300) { takeSnap('ranking-scrolled'); ui.act('tab_kills'); next(); } break;
      case 10: if (age >= 500) { takeSnap('ranking-kills'); ui.act('back'); next(); } break;
      case 11: A.logout(); next(); break;
      case 12: if (!A.loggedIn || age > 5000) { ui.act('account'); next(); } break;
      case 13: if (age >= 500) { takeSnap('account-guest'); ui.act('back'); ui.act('ranking'); next(); } break;
      case 14: if (age >= 1500 && boardsReady) { takeSnap('ranking-guest'); next(); } break;
      default: return false;
    }
    return true;
  }

  // 프레임마다 호출: 타이틀 통과, 카드와 상자 자동 처리, 스냅샷, 종료 판정
  at.frame = function () {
    if (at.done) return;
    var g = LW.game;
    if (!g) return;
    var now = performance.now(), sst = LW.params.snapState;
    if (BENCH) {
      if (g.state === 'PLAYING' && benchLast) benchPlay += now - benchLast;
      benchLast = now;
      if (benchPlay >= BENCH * 1000) { at.finish(); return; }
    }
    if (flow.active) { if (!flowTick(g, now)) at.finish(); return; }
    if (g.state === 'TITLE') {
      if (LW.params.acct && !acctReady(now)) return;
      // snapstate=TITLE이면 타이틀이 그려진 뒤 첫 스냅샷을 찍고 시작한다
      if (sst === 'TITLE' && snapIdx < snaps.length) {
        if (!titleAt) titleAt = now;
        if (now - titleAt < 700) return;
        takeSnap(snaps[snapIdx++]);
      }
      g.start();
      at.setup(g);
      noteRoundStart(g);
    } else if (g.state === 'RESULT') {
      if (!resultAt) resultAt = now;
      var rage = now - resultAt;
      if (sst === 'RESULT' && snapIdx < snaps.length && rage >= 500) takeSnap(snaps[snapIdx++]);
      var more = ROUNDS > 0 && roundNo < ROUNDS;
      if (rage >= 1200 && more) {
        at.roundEnds.push(endNote(g));
        roundsDone = roundNo; roundNo++; resultAt = 0;
        LW.ui.act('retry');            // 결과 화면의 "다시 하기" 버튼과 같은 경로
        at.setup(g);
        noteRoundStart(g);
      } else if (!more && (sst !== 'RESULT' || snapIdx >= snaps.length) && rage >= 100) {
        if (ROUNDS > 0) { at.roundEnds.push(endNote(g)); roundsDone = roundNo; }
        if (FLOW && !flow.active) { flow.active = true; return; }
        at.finish();
      }
      return;
    } else if (g.state === 'PAUSED' || g.state === 'SETTINGS') {
      // 화면 스냅샷 시나리오: 일시정지와 설정을 연 뒤 찍고 되돌린다
      if (!sceneAt) sceneAt = now;
      if (now - sceneAt >= 500 && snapIdx < snaps.length) {
        takeSnap(snaps[snapIdx++]);
        if (sst === 'PAUSED' || scene === 1) { LW.ui.act(g.state === 'SETTINGS' ? 'back' : 'resume'); }
        else { scene = 1; LW.ui.act('settings'); sceneAt = 0; }
      }
      return;
    } else if (g.state === 'LEVELUP') {
      if (performance.now() - LW.levelup.openedAt >= 500) { if (BOT) botLevelup(g); else LW.levelup.choose(0); }
    } else if (g.state === 'CHEST') {
      var age = performance.now() - LW.chest.openedAt;
      // 상자 창이 열려 있을 때 스냅샷 시각이 지났다면(&snapchest=1이면 시각과 상관없이 다음 스냅샷을) 창이 그려진 뒤에 찍는다
      if (age >= 150 && snapIdx < snaps.length && (LW.params.snapChest || g.time >= snaps[snapIdx])) takeSnap(snaps[snapIdx++]);
      if (age >= 500) LW.chest.close();
    }
    if (g.state === 'PLAYING' && !LW.params.snapChest && sst !== 'RESULT' && sst !== 'PAUSED' && sst !== 'SETTINGS' && sst !== 'TITLE') {
      while (snapIdx < snaps.length && g.time >= snaps[snapIdx]) takeSnap(snaps[snapIdx++]);
    }
    // 일시정지, 설정 화면 스냅샷: 스냅샷 시각이 되면 일시정지를 연다
    if (g.state === 'PLAYING' && (sst === 'PAUSED' || sst === 'SETTINGS') && snapIdx < snaps.length && g.time >= snaps[snapIdx]) {
      sceneAt = 0; scene = sst === 'SETTINGS' ? 0 : 1;
      LW.ui.act('pause');
      if (sst === 'SETTINGS') LW.ui.act('settings');
    }
    // 연속 판 검사는 마지막 판의 결과 화면에서 끝낸다. 그 밖에는 목표 시각에 끝낸다.
    if (ROUNDS === 0 && !BENCH && g.time >= at.endTime) at.finish();
  };

  // 프레임이 아니라 게임 시간 1스텝마다 호출(game.update에서)
  at.step = function (dt) {
    buildStep(LW.game, dt); eliteStep(LW.game, dt); candleStep(LW.game, dt);
    if (BOT) {
      var evN = 0, wl = LW.game.weapons;
      for (var wi = 0; wi < wl.length; wi++) if (wl[wi].evolved) evN++;
      while (botEvoAt.length < evN) botEvoAt.push(r2(LW.game.time));
    }
    // dieat: 판이 이 시각이 되면 HP를 0으로 만든다. 실제 사망 경로(game.update의 hp 검사)를 그대로 탄다.
    roundT += dt;
    // crowd=1: 적 풀을 매 스텝 가득 채운다(special 표시, 상한 무시). 풀이 찬 상태에서 보스가 나오는지 검사한다.
    if (LW.params.crowd) {
      var cp = LW.enemies, Pl = LW.player, guard = 0;
      while (cp.n < cp.size && guard++ < 400) {
        var ce = cp.spawnEnemy('mite', Pl.x + 380 + (guard % 40) * 5, Pl.y + ((guard * 37) % 300) - 150, 0, true);
        if (!ce) break;
        ce.special = true;
      }
    }
    // killlast=1: 마지막 그림자의 HP를 1로 만들어 처치 경로("완전한 새벽")를 검사한다
    var bs = LW.enemies.boss;
    if (LW.params.killLast && bs && bs.active && bs.def.id === 'last' && bs.hp > 1) bs.hp = 1;
    if (LW.params.dieAt > 0 && roundT >= LW.params.dieAt) { LW.game.god = false; LW.player.hp = 0; }
  };

  function r2(v) { return Math.round(v * 100) / 100; }
  function round(v, k) { var m = Math.pow(10, k); return Math.round(v * m) / m; }

  // bench 통계: 프레임 간격(ms)의 평균, p50, p95, p99, 최대와 update, render 평균, 화질 변화
  function benchStats(p) {
    var f = LW.perf.benchFrames(), n = f ? f.length : 0;
    var sorted = f ? Float32Array.from(f).sort() : [];
    function pct(q) { return n ? round(sorted[Math.min(n - 1, Math.floor(n * q))], 2) : 0; }
    var sum = 0;
    for (var i = 0; i < n; i++) sum += f[i];
    var mean = n ? sum / n : 0;
    return {
      seconds: BENCH, frames: n, playedMs: Math.round(benchPlay),
      fps: mean ? round(1000 / mean, 1) : 0,
      frameMeanMs: round(mean, 2), frameP50Ms: pct(0.5), frameP95Ms: pct(0.95), frameP99Ms: pct(0.99), frameMaxMs: n ? round(sorted[n - 1], 2) : 0,
      over20ms: (function () { var c = 0; for (var j = 0; j < n; j++) if (f[j] > 20) c++; return c; })(),
      updateMs: p.updN ? round(p.updSum / p.updN, 4) : 0,
      renderMs: p.rndN ? round(p.rndSum / p.rndN, 4) : 0,
      qualityStart: LW.quality.startName,
      qualityEnd: LW.quality.name, qualityDrops: LW.quality.drops, dpr: LW.view.dprUsed,
      maxEnemies: p.maxEnemies || 0, burnMs: LW.params.burn,
      ua: navigator.userAgent
    };
  }

  at.finish = function (extraError) {
    if (at.done) return;
    at.done = true;
    if (extraError) push(extraError);
    var g = LW.game || {};
    var p = LW.perf || {};
    var res = {
      ok: at.errors.length === 0,
      reached: BENCH ? benchPlay >= BENCH * 1000 : (ROUNDS > 0 ? roundsDone >= ROUNDS : (!!g.won || (g.time || 0) >= at.endTime - 1e-6)),
      died: g.state === 'RESULT' && !g.won,
      errors: at.errors,
      gameTime: round(g.time || 0, 2),
      level: g.level || 0,
      kills: g.kills || 0,
      enemiesActive: LW.enemies ? LW.enemies.n : 0,
      maxEnemies: p.maxEnemies || 0,
      avgUpdateMs: p.updN ? round(p.updSum / p.updN, 4) : 0,
      avgRenderMs: p.rndN ? round(p.rndSum / p.rndN, 4) : 0,
      state: g.state || '',
      start: START,
      weapons: (g.weapons || []).map(function (w) {
        return { id: w.def.id, level: w.lv, evolved: !!w.evolved };
      }),
      dmgBySlot: g.dmgBySlot ? Array.prototype.map.call(g.dmgBySlot, Math.round) : [],
      passives: (g.passives || []).map(function (p) { return { id: p.def.id, level: p.lv }; }),
      bossesSeen: g.bossesSeen || [],
      eventsFired: LW.spawner && LW.spawner.fired ? LW.spawner.fired : {},
      spawned: LW.spawner && LW.spawner.spawned ? LW.spawner.spawned : {},
      maxNormal: p.maxNormal || 0,
      maxAreas: p.maxAreas || 0,
      chestsOpened: g.chestsOpened || 0,
      mapItems: g.mapStats || {},
      bossActive: !!(LW.enemies.boss && LW.enemies.boss.active),
      audioPlayed: LW.audio.played || 0,
      rounds: ROUNDS,
      roundsDone: roundsDone,
      roundStarts: at.roundStarts,
      roundEnds: at.roundEnds,
      records: LW.records,
      full: !!g.full,
      lastBossKilled: !!g.lastBossKilled,
      snaps: at.snapsTaken
    };
    if (BENCH) res.bench = benchStats(p);
    if (BOT) {
      var evoN = 0;
      for (var q = 0; q < (g.weapons || []).length; q++) if (g.weapons[q].evolved) evoN++;
      res.bot = {
        mode: BOT, seed: LW.params.seed,
        won: !!g.won,
        deathTime: g.state === 'RESULT' && !g.won ? r2(g.time) : null,   // 사망으로 끝났을 때만. 시간 초과로 멈췄으면 null
        endTime: r2(g.time || 0),
        level: g.level || 0, kills: g.kills || 0, evolutions: evoN, evoAt: botEvoAt.slice(),
        dmgPerMin: Array.prototype.map.call(botDmg, function (v) { return Math.round(v); }),
        dmgTotal: Math.round(Array.prototype.reduce.call(botDmg, function (a, v) { return a + v; }, 0))
      };
    }
    if (LW.params.acct) {
      var Ac = LW.account;
      res.account = {
        status: Ac.status, netUp: LW.net.up, loggedIn: Ac.loggedIn, verified: Ac.verified, uid: Ac.uid, nickname: Ac.nickname, nicknameSet: Ac.nicknameSet,
        queue: Ac.queueCount(), tickets: Ac.ticketCount(), lastStatus: Ac.lastStatus, resultLine: Ac.resultLine, records: Ac.records(),
        boards: { time: { rows: Ac.boards.time.rows.length, me: Ac.boards.time.meStr, stale: Ac.boards.time.stale }, kills: { rows: Ac.boards.kills.rows.length, me: Ac.boards.kills.meStr, stale: Ac.boards.kills.stale } },
        flow: flow.log, msg: Ac.msg, search: location.search, settings: { sound: LW.settings.sound, rev: LW.settings.rev }
      };
    }
    var pre = document.createElement('pre');
    pre.id = 'autotest';
    pre.textContent = JSON.stringify(res);
    document.body.appendChild(pre);
    sinkPost('result.json', pre.textContent);
    if (BENCH) {
      // 헤드리스에서 dump-dom을 기다리지 않도록 제목을 바꾸고, 결과를 개발 서버(tools/bench.sh)로 보낸다
      document.title = 'BENCH_DONE';
      try { fetch('/__bench', { method: 'POST', body: pre.textContent, keepalive: true }).catch(function () { /* 무시 */ }); } catch (e) { /* 무시 */ }
    }
  };

  // 게임이 시작되지 못한 경우에도 JSON이 남도록 하는 감시 타이머
  setTimeout(function () {
    at.finish('watchdog: 게임 시간 ' + N + '초에 도달하지 못함');
  }, BENCH ? N * 2000 + 30000 : (LW.params.rt ? N * 2000 + 60000 : N * 1500 + 8000));
})();
