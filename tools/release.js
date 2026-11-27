// 버전 올리기와 캐시 목록 갱신
// 사용법: node tools/release.js 1.0.1
// 1. js/config.js의 LW.VERSION과 sw.js의 VERSION을 바꾼다.
// 2. 배포 대상(index.html, manifest.webmanifest, js/**/*.js, icons/*.png)을 훑어 sw.js의 ASSETS를 다시 쓴다. server/ 는 훑지 않는다.
//    배포 파일(./ 를 뺀 ASSETS)의 내용 해시를 sw.js 의 BUILD 와 캐시 이름에 쓴다. 버전을 올리지 않고 파일만 바꿔도 sw.js 바이트가 바뀐다.
//    tools/deploy.sh 가 같은 방식으로 다시 계산해 다르면 묶음을 만들지 않는다. 계산식: 경로를 바이트순으로 정렬하고,
//    줄마다 "<파일 내용(CR 제거)의 sha256>  <./ 없는 경로>" 와 줄바꿈(LF)을 이어 붙인 글의 sha256(sha256sum 출력과 같은 모양).
// 3. tools/gen-bounds.js 를 불러 server/bounds.json 의 자동 영역(엘리트, 보스 시각, 경험치 표)을 게임 데이터에 맞춘다.
// 파일을 하나라도 바꿔 배포할 때는 반드시 실행한다. 바이트가 바뀐 sw.js가 곧 갱신 신호다.
'use strict';
const fs = require('fs');
const crypto = require('crypto');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const ver = process.argv[2];
if (!/^\d+\.\d+\.\d+$/.test(ver || '')) {
  console.error('사용법: node tools/release.js <숫자.숫자.숫자>');
  process.exit(2);
}

function walk(dir, out) {
  for (const name of fs.readdirSync(dir).sort()) {
    const p = path.join(dir, name);
    if (fs.statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}
function rel(p) { return './' + path.relative(ROOT, p).split(path.sep).join('/'); }
// 줄바꿈(CRLF 또는 LF)은 그대로 둔다
function edit(file, fn) {
  const p = path.join(ROOT, file);
  const before = fs.readFileSync(p, 'utf8');
  const after = fn(before);
  if (after === before) console.log(file + ': 변경 없음');
  else { fs.writeFileSync(p, after); console.log(file + ': 갱신'); }
}
function sub(src, re, to, label) {
  if (!re.test(src)) { console.error(label + ' 위치를 찾지 못했다'); process.exit(1); }
  return src.replace(re, to);
}

const assets = ['./', './index.html', './manifest.webmanifest']
  .concat(walk(path.join(ROOT, 'js'), []).filter(function (p) { return p.endsWith('.js'); }).map(rel))
  .concat(walk(path.join(ROOT, 'icons'), []).filter(function (p) { return p.endsWith('.png'); }).map(rel));

for (const a of assets) {
  if (a !== './' && !fs.existsSync(path.join(ROOT, a))) { console.error('없는 파일: ' + a); process.exit(1); }
}

edit('js/config.js', function (s) { return sub(s, /(LW\.VERSION = ')[^']*(')/, '$1' + ver + '$2', 'LW.VERSION'); });

// 배포 파일 내용 해시(config.js 의 버전을 쓴 뒤에 계산한다). 줄바꿈 차이(CRLF, LF)로 달라지지 않게 CR 을 뺀다.
function sha(buf) { return crypto.createHash('sha256').update(buf).digest('hex'); }
const build = sha(assets.filter(function (a) { return a !== './'; }).map(function (a) { return a.slice(2); }).sort().map(function (p) {
  const raw = fs.readFileSync(path.join(ROOT, p));
  return sha(Buffer.from(raw.filter(function (b) { return b !== 13; }))) + '  ' + p + '\n';
}).join(''));

edit('sw.js', function (s) {
  s = sub(s, /(const VERSION = ')[^']*(')/, '$1' + ver + '$2', 'VERSION');
  s = sub(s, /(const BUILD = ')[^']*(')/, '$1' + build + '$2', 'BUILD');
  const nl = s.indexOf('\r\n') >= 0 ? '\r\n' : '\n';
  const list = assets.map(function (a) { return "'" + a + "'"; }).join(',' + nl + '  ');
  return sub(s, /\/\* @assets-start \*\/[\s\S]*?\/\* @assets-end \*\//, function () {
    return '/* @assets-start */' + nl + '  ' + list + nl + '  /* @assets-end */';
  }, '@assets');
});
console.log('버전 ' + ver + ', 캐시 파일 ' + assets.length + '개, 내용 해시 ' + build.slice(0, 12));

const gb = require('child_process').spawnSync(process.execPath, [path.join(__dirname, 'gen-bounds.js')], { stdio: 'inherit' });
if (gb.status !== 0) { console.error('gen-bounds 실패'); process.exit(1); }
