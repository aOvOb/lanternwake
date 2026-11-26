#!/usr/bin/env node
// server/bounds.json의 자동 영역을 게임 데이터에서 다시 만든다. Node 기본 모듈만 쓴다.
//
//   node tools/gen-bounds.js [--out 파일] [--config 파일] [--util 파일] [--waves 파일]
//
// 읽는 값
//   js/config.js        LW.WIN_TIME(초), LW.VERSION
//   js/util.js          LW.xpReq(n)(레벨 n에서 n+1로 가는 경험치)
//   js/data/waves.js    LW.EVENTS 중 type이 'elite', 'boss'인 항목(t는 초)
// 자동 영역: winMs, maxLevel, elites, bosses, lastBossT, xpToReach
// 손으로 정하는 값(kpmMax, minRankedVersion)은 기존 파일의 값을 그대로 둔다.
// 파일이 없으면 kpmMax는 분당 1200, minRankedVersion은 LW.VERSION으로 시작한다.
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const MAX_LEVEL = 200;       // DESIGN-ACCOUNT.md 6.2 range 검사의 레벨 상한
const MAX_MINUTES = 15;      // kpmMax 길이(15분 판)
const DEFAULT_KPM_MAX = 1200;

function parseArgs(argv) {
  const opt = {
    out: path.join(ROOT, 'server', 'bounds.json'),
    config: path.join(ROOT, 'js', 'config.js'),
    util: path.join(ROOT, 'js', 'util.js'),
    waves: path.join(ROOT, 'js', 'data', 'waves.js')
  };
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i] && argv[i].replace(/^--/, '');
    if (!(key in opt) || argv[i + 1] === undefined) {
      throw new Error('사용법: node tools/gen-bounds.js [--out 파일] [--config 파일] [--util 파일] [--waves 파일]');
    }
    opt[key] = path.resolve(argv[i + 1]);
  }
  return opt;
}

// 브라우저용 스크립트를 vm에서 순서대로 실행해 LW 객체를 얻는다.
function loadLW(files) {
  const sandbox = {
    location: { search: '' },
    URLSearchParams: URLSearchParams,
    isSecureContext: true,
    navigator: { userAgent: 'node' },
    console: console
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  for (const f of files) {
    try {
      vm.runInContext(fs.readFileSync(f, 'utf8'), sandbox, { filename: f });
    } catch (e) {
      throw new Error(path.relative(ROOT, f) + ' 실행 실패: ' + e.message +
        ' (브라우저 전용 API를 더했다면 tools/gen-bounds.js의 sandbox에도 더해야 한다)');
    }
  }
  if (!sandbox.LW) throw new Error('LW 객체가 만들어지지 않았다');
  return sandbox.LW;
}

function buildAuto(LW) {
  if (!(LW.WIN_TIME > 0)) throw new Error('LW.WIN_TIME이 없다');
  if (typeof LW.xpReq !== 'function') throw new Error('LW.xpReq가 없다');
  const events = Array.isArray(LW.EVENTS) ? LW.EVENTS : [];
  const elites = [];
  const bosses = [];
  for (const ev of events) {
    if (!(ev.t >= 0)) throw new Error('이벤트 t가 숫자가 아니다: ' + JSON.stringify(ev));
    if (ev.type === 'elite') elites.push([ev.t, ev.n === undefined ? 1 : ev.n]);
    else if (ev.type === 'boss') bosses.push(ev.t);
  }
  elites.sort((a, b) => a[0] - b[0]);
  bosses.sort((a, b) => a - b);
  for (const e of elites) {
    if (!Number.isInteger(e[1]) || e[1] < 1) throw new Error('엘리트 마릿수가 정수가 아니다: ' + e);
  }
  // xpToReach[L]: 레벨 1에서 레벨 L까지 올라가는 데 필요한 경험치 합(인덱스 0은 자리 채움)
  const xpToReach = [0, 0];
  for (let L = 2; L <= MAX_LEVEL; L++) xpToReach.push(xpToReach[L - 1] + LW.xpReq(L - 1));
  return {
    winMs: Math.round(LW.WIN_TIME * 1000),
    maxLevel: MAX_LEVEL,
    elites: elites,
    bosses: bosses,
    lastBossT: bosses.length ? bosses[bosses.length - 1] : 0,
    xpToReach: xpToReach
  };
}

function readManual(file, LW) {
  let old = {};
  if (fs.existsSync(file)) old = JSON.parse(fs.readFileSync(file, 'utf8'));
  const kpmMax = Array.isArray(old.kpmMax) && old.kpmMax.length === MAX_MINUTES
    ? old.kpmMax : new Array(MAX_MINUTES).fill(DEFAULT_KPM_MAX);
  const minRankedVersion = typeof old.minRankedVersion === 'string' ? old.minRankedVersion : String(LW.VERSION);
  return { kpmMax: kpmMax, minRankedVersion: minRankedVersion };
}

// 키마다 한 줄. 배열은 한 줄에 붙여 쓴다.
function format(obj) {
  const lines = Object.keys(obj).map((k) => '  ' + JSON.stringify(k) + ': ' + JSON.stringify(obj[k]));
  return '{\n' + lines.join(',\n') + '\n}\n';
}

function main() {
  const opt = parseArgs(process.argv.slice(2));
  const LW = loadLW([opt.config, opt.util, opt.waves]);
  const auto = buildAuto(LW);
  const manual = readManual(opt.out, LW);
  const out = Object.assign(
    { _comment: '자동 영역(winMs부터 xpToReach까지)은 tools/gen-bounds.js가 다시 쓴다. kpmMax, minRankedVersion은 손으로 정한다. elites는 [t초, 마릿수].' },
    auto, manual);
  const text = format(out);
  const same = fs.existsSync(opt.out) && fs.readFileSync(opt.out, 'utf8') === text;
  if (!same) {
    fs.mkdirSync(path.dirname(opt.out), { recursive: true });
    fs.writeFileSync(opt.out, text);
  }
  console.log((same ? 'unchanged ' : 'wrote ') + path.relative(process.cwd(), opt.out) +
    ': winMs=' + auto.winMs + ' elites=' + auto.elites.length + ' bosses=' + auto.bosses.length);
}

try {
  main();
} catch (e) {
  console.error('gen-bounds: ' + e.message);
  process.exit(1);
}
