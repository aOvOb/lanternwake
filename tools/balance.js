#!/usr/bin/env node
// 밸런스 점검(DESIGN.md S15): 봇이 시드별로 15분 완주를 시도한 결과를 모아 표와 JSON으로 낸다.
//
//   node tools/balance.js [--mode 1|naive|both] [--seeds 1,2,3,4,5] [--secs 900] [--jobs 4] [--out 파일] [--query "&추가=옵션"]
//
// 헤드리스 Chrome으로 ?autotest=초&bot=모드&seed=시드 를 실행하고(무적 없음), 결과 JSON의 bot 항목을 읽는다.
// 정적 서버는 이 스크립트가 직접 띄운다. Chrome 경로는 환경 변수 CHROME으로 바꿀 수 있다. Node 기본 모듈만 쓴다.
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { execFile } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const CHROME = process.env.CHROME || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };

function parseArgs(argv) {
  const o = { mode: 'both', seeds: [1, 2, 3, 4, 5], secs: 900, jobs: 4, out: '', query: '' };
  for (let i = 0; i < argv.length; i += 2) {
    const k = (argv[i] || '').replace(/^--/, ''), v = argv[i + 1];
    if (!(k in o) || v === undefined) throw new Error('사용법: node tools/balance.js [--mode 1|naive|both] [--seeds 1,2,3] [--secs 900] [--jobs 4] [--out 파일] [--query "&옵션"]');
    if (k === 'seeds') o.seeds = v.split(',').map(Number).filter(Boolean);
    else if (k === 'secs' || k === 'jobs') o[k] = Number(v);
    else o[k] = v;
  }
  return o;
}

function serve() {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      let p = decodeURIComponent(req.url.split('?')[0]);
      if (p === '/') p = '/index.html';
      const f = path.join(ROOT, p);
      if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      fs.createReadStream(f).pipe(res);
    });
    srv.listen(0, '127.0.0.1', () => resolve(srv));
  });
}

function runOne(port, mode, seed, secs, extra) {
  return new Promise((resolve) => {
    const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'lw-bal-'));
    const url = `http://127.0.0.1:${port}/index.html?autotest=${secs}&nosw=1&bot=${mode}&seed=${seed}${extra}`;
    const args = ['--headless=new', '--disable-gpu', `--user-data-dir=${prof}`, '--window-size=412,915',
      `--virtual-time-budget=${secs * 2000 + 15000}`, '--dump-dom', url];
    const t0 = Date.now();
    execFile(CHROME, args, { maxBuffer: 64 * 1024 * 1024, timeout: (secs * 3 + 90) * 1000 }, (err, stdout) => {
      try { fs.rmSync(prof, { recursive: true, force: true }); } catch (e) { /* 무시 */ }
      const m = /<pre id="autotest">([\s\S]*?)<\/pre>/.exec(stdout || '');
      let json = null;
      if (m) {
        const txt = m[1].replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&');
        try { json = JSON.parse(txt); } catch (e) { /* 무시 */ }
      }
      resolve({ mode, seed, wallSec: Math.round((Date.now() - t0) / 1000), err: err ? String(err.message).slice(0, 200) : '', json });
    });
  });
}

async function pool(tasks, n) {
  const out = new Array(tasks.length);
  let next = 0;
  async function worker() {
    while (next < tasks.length) { const i = next++; out[i] = await tasks[i](); }
  }
  await Promise.all(Array.from({ length: n }, worker));
  return out;
}

function median(a) {
  if (!a.length) return null;
  const s = a.slice().sort((x, y) => x - y), h = s.length >> 1;
  return s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2;
}

async function main() {
  const opt = parseArgs(process.argv.slice(2));
  const modes = opt.mode === 'both' ? ['1', 'naive'] : [opt.mode];
  const srv = await serve();
  const port = srv.address().port;
  const tasks = [];
  for (const m of modes) for (const s of opt.seeds) tasks.push(() => runOne(port, m, s, opt.secs, opt.query));
  const res = await pool(tasks, opt.jobs);
  srv.close();

  const rows = res.map((r) => {
    const j = r.json, b = j && j.bot;
    return {
      mode: r.mode, seed: r.seed, wallSec: r.wallSec, ok: !!(j && j.ok), errors: j ? j.errors.slice(0, 3) : [r.err || 'JSON 없음'],
      won: b ? b.won : false, deathTime: b ? b.deathTime : null, endTime: b ? b.endTime : null,
      level: b ? b.level : 0, kills: b ? b.kills : 0, evolutions: b ? b.evolutions : 0, evoAt: b ? b.evoAt : [],
      dmgPerMin: b ? b.dmgPerMin : [], dmgTotal: b ? b.dmgTotal : 0,
      weapons: j ? j.weapons.map((w) => w.id + ':' + w.level + (w.evolved ? '*' : '')) : [],
      passives: j ? j.passives.map((p) => p.id + ':' + p.level) : []
    };
  });

  const summary = {};
  for (const m of modes) {
    const rs = rows.filter((r) => r.mode === m);
    const deaths = rs.filter((r) => r.deathTime !== null).map((r) => r.deathTime);
    const sumMin = new Array(15).fill(0);
    for (const r of rs) r.dmgPerMin.forEach((v, i) => { sumMin[i] += v; });
    const peak = sumMin.indexOf(Math.max(...sumMin));
    summary[m] = {
      runs: rs.length, wins: rs.filter((r) => r.won).length,
      winRate: rs.length ? Math.round(rs.filter((r) => r.won).length / rs.length * 100) : 0,
      deathMedianSec: median(deaths), deathMinSec: deaths.length ? Math.min(...deaths) : null,
      evolutionsAvg: rs.length ? Math.round(rs.reduce((a, r) => a + r.evolutions, 0) / rs.length * 10) / 10 : 0,
      dmgPerMinSum: sumMin, peakMinute: peak + ':00~' + (peak + 1) + ':00'
    };
  }

  const fmt = (t) => t === null ? '-' : Math.floor(t / 60) + ':' + String(Math.floor(t % 60)).padStart(2, '0');
  console.log('모드\t시드\t결과\t사망\t레벨\t처치\t진화\t진화 시각\t오류');
  for (const r of rows) {
    console.log([r.mode, r.seed, r.won ? '완주' : (r.deathTime !== null ? '사망' : '미완'), fmt(r.deathTime), r.level, r.kills, r.evolutions,
      r.evoAt.map(fmt).join(','), r.ok ? '' : r.errors.join(' | ')].join('\t'));
  }
  console.log(JSON.stringify(summary));
  const out = opt.out || path.join(os.tmpdir(), 'lw-balance.json');
  fs.writeFileSync(out, JSON.stringify({ secs: opt.secs, seeds: opt.seeds, rows, summary }, null, 1));
  console.log('저장: ' + out);
}

main().catch((e) => { console.error(e.message); process.exit(1); });
