// 계정 클라이언트 논리 검사(브라우저 없이 vm에서 실행): node tools/test-account.js
// js/config.js, util.js, storage.js, net.js, account.js 를 가짜 fetch, localStorage 와 함께 돌려
// 판 요약 형식, 오프라인 대기열, 시작 표, 재전송 중복, 401, 대기열 상한을 확인한다.
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const ROOT = path.join(__dirname, '..');

// 가짜 서버: up 이 거짓이면 네트워크 오류, session 이 거짓이면 401. 받은 요청을 log 에 쌓는다.
function makeEnv() {
  const store = {};
  const timers = [];
  const srv = { up: true, session: true, log: [], ticketSeq: 0, runs: {}, rev: 0 };
  const sandbox = {
    location: { search: '', pathname: '/', hash: '' },
    history: { replaceState() {} },
    URLSearchParams, AbortController, console, Date, Math, JSON, Uint8Array, Uint16Array, Promise,
    isSecureContext: true,
    navigator: { onLine: true, userAgent: 'node' },
    performance: { now: () => Date.now() },
    crypto: require('crypto').webcrypto,
    localStorage: {
      getItem: (k) => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); }
    },
    setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; },
    clearTimeout: () => {},
    document: { createElement: () => ({}) }
  };
  sandbox.window = sandbox;
  sandbox.addEventListener = () => {};
  sandbox.fetch = (url, init) => {
    const p = String(url).replace('./api/', '');
    const body = init.body ? JSON.parse(init.body) : null;
    srv.log.push({ method: init.method, path: p, body });
    const reply = (status, data) => Promise.resolve({
      ok: status >= 200 && status < 300, status, type: 'basic', text: () => Promise.resolve(JSON.stringify(data))
    });
    if (!srv.up) return Promise.reject(new TypeError('network'));
    if (p === 'health') return reply(200, { ok: true, version: 'x' });
    if (!srv.session) return reply(401, { error: 'no_session' });
    if (p === 'me') {
      return reply(200, { user: { id: 7, nickname: '테스터', nicknameSet: true, createdAt: 1 },
        records: { bestTimeMs: 0, bestKills: 0, bestLevel: 0, wins: 0, runs: 0, fullDawns: 0 },
        settings: { sound: true, vibrate: true, dmgNumbers: true }, settingsRev: 0, imported: true });
    }
    if (p === 'runs/tickets') {
      const out = [];
      for (let i = 0; i < body.count; i++) {
        const id = 'T' + (++srv.ticketSeq);
        if (srv.cap) { while (srv.cap.length >= 6) srv.cap.shift(); srv.cap.push(id); }
        out.push({ id, issuedAt: 1, expiresAt: 4102444800 });
      }
      return reply(200, { tickets: out });
    }
    if (p === 'runs') {
      const results = body.runs.map((r) => {
        if (srv.runs[r.clientRunId]) return { clientRunId: r.clientRunId, status: 'duplicate', first: 'ranked', rank: { time: 1, kills: 1 } };
        srv.runs[r.clientRunId] = r;
        return { clientRunId: r.clientRunId, status: r.ticket ? 'ranked' : 'unranked', reason: r.ticket ? undefined : 'no_ticket', rank: { time: 3, kills: 2 } };
      });
      return reply(200, { results, records: { bestTimeMs: 1000, bestKills: 5, bestLevel: 2, wins: 0, runs: body.runs.length, fullDawns: 0 } });
    }
    if (p === 'auth/logout') return reply(srv.logoutStatus || 200, srv.logoutStatus ? { error: 'x' } : { ok: true });
    if (p.indexOf('leaderboard') === 0) {
      return reply(200, { entries: [{ rank: 1, nickname: '테스터', timeMs: 90000, kills: 40, fullDawn: false }, { rank: 2, nickname: '다른사람', timeMs: 80000, kills: 30, fullDawn: false }],
        me: { rank: 1, timeMs: 90000, kills: 40 }, updatedAt: 5 });
    }
    return reply(404, { error: 'not_found' });
  };
  vm.createContext(sandbox);
  for (const f of ['js/config.js', 'js/util.js', 'js/storage.js']) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), sandbox, { filename: f });
  }
  sandbox.LW.game = { state: 'TITLE' };
  sandbox.LW.audio = { applySettings() {} };
  sandbox.LW.quality = { apply() {}, level: 0 };
  for (const f of ['js/net.js', 'js/account.js']) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), sandbox, { filename: f });
  }
  return { LW: sandbox.LW, srv, store, timers };
}

// g.runStat 을 가진 가짜 게임 상태
function fakeGame(opts) {
  const runStat = { kpm: new Uint16Array(15), lvm: new Uint8Array(15), minute: 0, elites: 0, bosses: 0 };
  const g = Object.assign({ time: 100, kills: 0, level: 1, won: false, full: false, runStat }, opts || {});
  return g;
}
const tick = () => new Promise((r) => setImmediate(r));
async function settle() { for (let i = 0; i < 20; i++) await tick(); }

let passed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log('통과  ' + name); }
  catch (e) { console.log('실패  ' + name + '\n' + (e && e.stack || e)); process.exitCode = 1; }
}

(async function main() {
  await test('판 요약: 패배 판 형식(kpm 합 == kills, lvm 비감소, 마지막 == level)', async () => {
    const { LW } = makeEnv();
    const g = fakeGame({ time: 125.4, kills: 7, level: 4 });
    g.runStat.kpm[0] = 3; g.runStat.kpm[1] = 2; g.runStat.kpm[2] = 2;
    g.runStat.minute = 2; g.runStat.lvm[0] = 2; g.runStat.lvm[1] = 3;
    const s = LW.account.buildSummary(g);
    assert.strictEqual(s.timeMs, 125400);
    assert.strictEqual(s.kpm.length, 3);
    assert.strictEqual(s.kpm.reduce((a, b) => a + b, 0), 7);
    assert.deepStrictEqual(Array.from(s.lvm), [2, 3, 4]);   // vm 안의 배열은 프로토타입이 달라 복사해서 비교한다
    assert.strictEqual(s.won, false);
    assert.ok(/^[A-Za-z0-9-]{8,64}$/.test(s.clientRunId));
    assert.ok(Array.isArray(s.kpm) && Array.isArray(s.lvm));
  });

  await test('판 요약: 승리 판의 timeMs 는 g.time 과 상관없이 정확히 900000(리뷰 B6)', async () => {
    const { LW } = makeEnv();
    const g = fakeGame({ time: 900.0167, kills: 9, level: 30, won: true, full: true });
    g.runStat.kpm[14] = 9; g.runStat.minute = 14;
    for (let i = 0; i < 14; i++) g.runStat.lvm[i] = Math.min(30, i + 5);
    const s = LW.account.buildSummary(g);
    assert.strictEqual(s.timeMs, 900000);
    assert.strictEqual(s.kpm.length, 15);
    assert.strictEqual(s.lvm.length, 15);
    assert.strictEqual(s.lvm[14], 30);
    assert.strictEqual(s.fullDawn, true);
  });

  await test('판 요약: 분 경계에 딱 걸린 판(60.000초)은 길이 1이고 처치가 합쳐진다', async () => {
    const { LW } = makeEnv();
    const g = fakeGame({ time: 60, kills: 5, level: 2 });
    g.runStat.kpm[0] = 3; g.runStat.kpm[1] = 2; g.runStat.minute = 1; g.runStat.lvm[0] = 2;
    const s = LW.account.buildSummary(g);
    assert.strictEqual(s.timeMs, 60000);
    assert.strictEqual(s.kpm.length, 1);
    assert.strictEqual(s.kpm[0], 5);
    assert.strictEqual(s.lvm[0], 2);
  });

  // 로그인 상태까지 만든다(me 확인과 표 채우기)
  async function loggedIn() {
    const env = makeEnv();
    await env.LW.account.init();
    await env.LW.net.health();
    await env.LW.account.onOnline();
    await settle();
    assert.strictEqual(env.LW.account.loggedIn, true);
    return env;
  }

  await test('로그인 뒤 미리 받은 표가 5장 채워진다', async () => {
    const { LW, srv } = await loggedIn();
    assert.strictEqual(LW.account.ticketCount(), 5);
    assert.strictEqual(srv.log.filter((l) => l.path === 'runs/tickets')[0].body.count, 5);
  });

  await test('온라인 판: 새 표가 있으면 새 표를 쓰고 미리 받은 표는 돌려놓는다', async () => {
    const { LW, srv } = await loggedIn();
    const A = LW.account;
    A.onRunStart();
    await settle();                                  // 새 표 응답 도착
    const before = A.ticketCount();                  // 하나는 예약으로 빠져 있다
    assert.strictEqual(before, 4);
    A.onRunEnd(fakeGame({ time: 40, kills: 3, level: 2 }));
    await settle();
    const posted = srv.log.filter((l) => l.path === 'runs').pop().body.runs[0];
    assert.ok(/^T\d+$/.test(posted.ticket), '표가 붙어야 한다');
    assert.strictEqual(A.ticketCount(), 5, '쓰지 않은 표는 풀로 돌아와 5장');
    assert.strictEqual(A.queueCount(), 0);
    assert.ok(A.resultLine.indexOf('순위 반영') === 0, A.resultLine);
  });

  await test('오프라인으로 3판: 대기열이 3개, 온라인이 되면 한 번에 올라가고 모두 표가 붙어 ranked', async () => {
    const { LW, srv } = await loggedIn();
    const A = LW.account;
    srv.up = false; LW.net.up = false;
    for (let i = 0; i < 3; i++) {
      A.onRunStart();
      A.onRunEnd(fakeGame({ time: 40 + i, kills: 3 + i, level: 2 }));
      await settle();
    }
    assert.strictEqual(A.queueCount(), 3);
    assert.ok(A.resultLine.indexOf('오프라인') === 0, A.resultLine);
    srv.log.length = 0; srv.up = true;
    await A.onOnline();
    await settle();
    assert.strictEqual(A.queueCount(), 0);
    const posts = srv.log.filter((l) => l.path === 'runs');
    assert.strictEqual(posts.length, 1, '한 요청에 모두 올라간다');
    assert.strictEqual(posts[0].body.runs.length, 3);
    for (const r of posts[0].body.runs) assert.ok(r.ticket, '미리 받은 표가 붙어 있어야 한다');
    assert.strictEqual(new Set(posts[0].body.runs.map((r) => r.ticket)).size, 3, '표는 판마다 다르다');
  });

  await test('표를 다 쓴 뒤 오프라인 판은 ticket null 로 올라간다(서버가 unranked 로 처리)', async () => {
    const { LW, srv } = await loggedIn();
    const A = LW.account;
    srv.up = false; LW.net.up = false;
    for (let i = 0; i < 6; i++) { A.onRunStart(); A.onRunEnd(fakeGame({ time: 40, kills: 3, level: 2 })); }
    await settle();
    srv.up = true; srv.log.length = 0;
    await A.onOnline(); await settle();
    const tickets = srv.log.filter((l) => l.path === 'runs')[0].body.runs.map((r) => r.ticket);
    assert.strictEqual(tickets.filter((t) => t).length, 5);
    assert.strictEqual(tickets.filter((t) => !t).length, 1);
  });

  await test('같은 판을 다시 보내 duplicate 가 와도 대기열에서 지운다(멱등)', async () => {
    const { LW, srv } = await loggedIn();
    const A = LW.account;
    A.onRunStart(); A.onRunEnd(fakeGame({ time: 40, kills: 3, level: 2 })); await settle();
    const sent = srv.log.filter((l) => l.path === 'runs')[0].body.runs[0];
    assert.strictEqual(A.queueCount(), 0);
    // 서버가 이미 받은 id 를 가진 항목이 대기열에 다시 들어온 상황
    srv.up = false; LW.net.up = false;
    A.onRunStart(); A.onRunEnd(fakeGame({ time: 41, kills: 3, level: 2 })); await settle();
    const second = A.queueCount();
    assert.strictEqual(second, 1);
    srv.runs[Object.keys(srv.runs).pop()] = true;      // 받은 것으로 표시
    srv.up = true;
    await A.onOnline(); await settle();
    assert.strictEqual(A.queueCount(), 0);
    assert.ok(sent.clientRunId);
  });

  await test('401 이면 게스트로 돌아가되 대기열은 uid 별로 남는다', async () => {
    const { LW, srv, store } = await loggedIn();
    const A = LW.account;
    srv.up = false; LW.net.up = false;
    A.onRunStart(); A.onRunEnd(fakeGame({ time: 40, kills: 3, level: 2 })); await settle();
    srv.up = true; srv.session = false;
    await A.onOnline(); await settle();
    assert.strictEqual(A.loggedIn, false);
    const queue = JSON.parse(store['lanternwake.v1.queue']);
    assert.strictEqual(queue.length, 1);
    assert.strictEqual(queue[0].uid, 7);
  });

  await test('대기열은 50개를 넘으면 가장 오래된 것부터 버린다', async () => {
    const { LW, srv, store } = await loggedIn();
    const A = LW.account;
    srv.up = false; LW.net.up = false;
    for (let i = 0; i < 55; i++) A.onRunEnd(fakeGame({ time: 31 + i, kills: i, level: 2 }));
    await settle();
    const queue = JSON.parse(store['lanternwake.v1.queue']);
    assert.strictEqual(queue.length, 50);
    assert.strictEqual(queue[0].run.timeMs, 36000, '가장 오래된 5개가 버려진다');
  });

  await test('타이틀로 3번 나간 뒤에도 표가 남고 다음 판이 표를 단다', async () => {
    const { LW, srv } = await loggedIn();
    const A = LW.account;
    const before = A.ticketCount();
    for (let i = 0; i < 3; i++) {
      A.onRunStart(); await settle();                // 표 예약과 새 표 도착
      A.onRunAbort();                                // 일시정지에서 타이틀로
    }
    assert.ok(A.ticketCount() >= before, '표가 줄지 않는다: ' + A.ticketCount());
    srv.up = false; LW.net.up = false;
    A.onRunStart(); A.onRunEnd(fakeGame({ time: 40, kills: 3, level: 2 }));
    srv.up = true; srv.log.length = 0;
    await A.onOnline(); await settle();
    assert.ok(srv.log.filter((l) => l.path === 'runs')[0].body.runs[0].ticket, '다음 판에 표가 붙어야 한다');
  });

  await test('새 판을 시작할 때 이전 판이 끝나지 않았으면 그 판의 표를 풀로 돌려놓는다', async () => {
    const { LW } = await loggedIn();
    const A = LW.account;
    for (let i = 0; i < 4; i++) { A.onRunStart(); await settle(); }   // onRunEnd 도 onRunAbort 도 없이 새 판
    assert.ok(A.ticketCount() >= 5, '표가 줄지 않는다: ' + A.ticketCount());
  });

  await test('타이틀로 나가기를 반복해도 서버 상한(6장, 오래된 표 삭제)에서 들고 있는 표가 지워지지 않는다', async () => {
    const env = makeEnv();
    env.srv.cap = [];                                  // 켜면 가짜 서버가 미사용 표를 6장까지만 두고 오래된 것부터 지운다
    await env.LW.account.init(); await env.LW.net.health(); await env.LW.account.onOnline(); await settle();
    const { LW, srv } = env, A = LW.account;
    for (let i = 0; i < 10; i++) { A.onRunStart(); await settle(); A.onRunAbort(); }
    const held = LW.storage.loadTickets().map((t) => t.id);
    assert.ok(held.length >= 5, '표 ' + held.length + '장');
    for (const id of held) assert.ok(srv.cap.indexOf(id) >= 0, id + ' 가 서버에서 지워졌다');
  });

  await test('30초 미만 판은 표를 붙이지 않고 풀로 돌려놓는다', async () => {
    const { LW, srv } = await loggedIn();
    const A = LW.account;
    A.onRunStart(); await settle();
    A.onRunEnd(fakeGame({ time: 12, kills: 1, level: 1 })); await settle();
    const posted = srv.log.filter((l) => l.path === 'runs').pop().body.runs[0];
    assert.strictEqual(posted.ticket, null);
    assert.strictEqual(A.ticketCount(), 6, '예약한 표와 새 표가 모두 풀로 돌아온다');
  });

  await test('시험 매개변수(cheat)가 켜진 판은 제출하지 않고 표를 돌려놓는다, devlogin 이면 제출한다', async () => {
    const { LW, srv } = await loggedIn();
    const A = LW.account;
    LW.params.cheat = true;
    A.onRunStart(); await settle();
    srv.log.length = 0;
    A.onRunEnd(fakeGame({ time: 900, kills: 9, level: 9, won: true })); await settle();
    assert.strictEqual(A.resultLine, '시험 모드: 순위 제외');
    assert.strictEqual(A.queueCount(), 0);
    assert.ok(srv.log.every((l) => l.path !== 'runs'), '제출하지 않는다');
    assert.ok(A.ticketCount() >= 5, '표가 풀로 돌아온다');
    LW.params.devLogin = 'tester';
    A.onRunStart(); A.onRunEnd(fakeGame({ time: 40, kills: 3, level: 2 })); await settle();
    assert.ok(srv.log.some((l) => l.path === 'runs'), 'devlogin 이면 제출한다');
  });

  await test('로그아웃: 서버가 실패(5xx, 429, 403)하면 로그인 상태를 유지하고, 성공이나 401 이면 게스트로 돌아간다', async () => {
    for (const code of [500, 429, 403]) {
      const { LW, srv } = await loggedIn();
      srv.logoutStatus = code;
      const ok = await LW.account.logout();
      assert.strictEqual(ok, false, String(code));
      assert.strictEqual(LW.account.loggedIn, true, String(code));
      assert.ok(LW.account.msg.indexOf('로그아웃하지 못했어요') === 0);
    }
    for (const code of [0, 401]) {
      const { LW, srv } = await loggedIn();
      srv.logoutStatus = code;
      assert.strictEqual(await LW.account.logout(), true, String(code));
      assert.strictEqual(LW.account.loggedIn, false, String(code));
    }
  });

  await test('로그아웃 뒤 순위표 저장본에 이전 계정의 강조 줄과 내 순위가 남지 않는다', async () => {
    const { LW, store } = await loggedIn();
    const A = LW.account;
    await A.fetchBoard('time');
    assert.strictEqual(A.boards.time.rows[0].mine, true);
    assert.ok(A.boards.time.meStr.indexOf('내 순위 1위') === 0);
    await A.logout();
    assert.strictEqual(A.boards.time.rows[0].mine, false);
    assert.strictEqual(A.boards.time.meStr, '');
    assert.strictEqual(A.boards.time.hasMe, false);
    assert.strictEqual(JSON.parse(store['lanternwake.v1.board']).time.me, null);
  });

  await test('닉네임을 바꾸면 순위표 강조 줄을 새 닉네임으로 다시 계산한다', async () => {
    const { LW, srv } = await loggedIn();
    const A = LW.account;
    await A.fetchBoard('time');
    assert.strictEqual(A.boards.time.rows[1].mine, false);
    const orig = LW.net.put;
    LW.net.put = () => Promise.resolve({ ok: true, status: 200, data: { nickname: '다른사람' } });
    const r = await A.setNickname('다른사람');
    LW.net.put = orig;
    assert.strictEqual(r.ok, true);
    assert.strictEqual(A.boards.time.rows[0].mine, false);
    assert.strictEqual(A.boards.time.rows[1].mine, true);
  });

  await test('게스트: 서버를 부르지 않고 안내 줄만 남긴다', async () => {
    const env = makeEnv();
    env.srv.up = false;
    await env.LW.account.init();
    env.LW.account.onRunStart();
    env.LW.account.onRunEnd(fakeGame({ time: 40, kills: 3, level: 2 }));
    assert.strictEqual(env.LW.account.resultLine, '로그인하면 순위에 오를 수 있어요');
    assert.strictEqual(env.LW.account.status, 'offline');
    assert.ok(env.srv.log.every((l) => l.path === 'health'));
  });

  console.log(passed + '개 통과');
})();
