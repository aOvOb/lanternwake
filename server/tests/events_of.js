// 시험용 도우미: waves 파일의 LW.EVENTS에서 엘리트와 보스만 뽑아 JSON으로 찍는다.
// gen-bounds.js와 따로 만든 구현이라, 둘이 같은 결과를 내는지 비교하는 데 쓴다.
//   node server/tests/events_of.js js/data/waves.js
'use strict';
const fs = require('fs');
const LW = {};
new Function('LW', fs.readFileSync(process.argv[2], 'utf8'))(LW);
const ev = LW.EVENTS || [];
console.log(JSON.stringify({
  elites: ev.filter((e) => e.type === 'elite').map((e) => [e.t, e.n || 1]).sort((a, b) => a[0] - b[0]),
  bosses: ev.filter((e) => e.type === 'boss').map((e) => e.t).sort((a, b) => a - b)
}));
