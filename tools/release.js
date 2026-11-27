// 버전 올리기와 캐시 목록 갱신
// 사용법: node tools/release.js 1.0.1
// 1. js/config.js의 LW.VERSION과 sw.js의 VERSION을 바꾼다.
// 2. 배포 대상(index.html, manifest.webmanifest, js/**/*.js, icons/*.png)을 훑어 sw.js의 ASSETS를 다시 쓴다.
// 파일을 하나라도 바꿔 배포할 때는 반드시 실행한다. 바이트가 바뀐 sw.js가 곧 갱신 신호다.
'use strict';
const fs = require('fs');
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
edit('sw.js', function (s) {
  s = sub(s, /(const VERSION = ')[^']*(')/, '$1' + ver + '$2', 'VERSION');
  const nl = s.indexOf('\r\n') >= 0 ? '\r\n' : '\n';
  const list = assets.map(function (a) { return "'" + a + "'"; }).join(',' + nl + '  ');
  return sub(s, /\/\* @assets-start \*\/[\s\S]*?\/\* @assets-end \*\//, function () {
    return '/* @assets-start */' + nl + '  ' + list + nl + '  /* @assets-end */';
  }, '@assets');
});
console.log('버전 ' + ver + ', 캐시 파일 ' + assets.length + '개');
