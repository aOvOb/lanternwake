// 64 단위 균일 그리드. 카운팅 정렬 3단계(세기, 누적합, 채우기)로 할당 없이 다시 만든다.
(function () {
  var MAXC = LW.GRID_MAX;
  var CELL = LW.CELL, INV = 1 / CELL;
  var start = new Int32Array(MAXC * MAXC + 2);
  var fillPos = new Int32Array(MAXC * MAXC + 1);
  var cellOf = new Int32Array(LW.POOL.enemies);
  var order = new Int32Array(LW.POOL.enemies);
  var radii = [120, 260, 520];

  var grid = LW.grid = {
    cols: 1, rows: 1, ox: 0, oy: 0, start: start, order: order, src: null,
    // 시야가 정해질 때 셀 수를 계산한다
    resize: function () {
      var v = LW.view, m = LW.GRID_MARGIN * 2;
      grid.cols = Math.min(MAXC, Math.ceil((v.w + m) / CELL));
      grid.rows = Math.min(MAXC, Math.ceil((v.h + m) / CELL));
    },
    // pool: 적 풀. 카메라 기준으로 영역을 잡는다
    rebuild: function (pool) {
      var v = LW.view, cam = LW.render.cam;
      var cols = grid.cols, rows = grid.rows, cells = cols * rows;
      var items = pool.items, n = pool.n, i, c;
      var ox = grid.ox = cam.x - v.w / 2 - LW.GRID_MARGIN;
      var oy = grid.oy = cam.y - v.h / 2 - LW.GRID_MARGIN;
      grid.src = pool;
      for (c = 0; c <= cells; c++) start[c] = 0;
      for (i = 0; i < n; i++) {
        var e = items[i];
        var fx = (e.x - ox) * INV, fy = (e.y - oy) * INV;
        if (!e.active || fx < 0 || fy < 0 || fx >= cols || fy >= rows) { cellOf[i] = -1; continue; }
        c = ((fy | 0) * cols) + (fx | 0);
        cellOf[i] = c;
        start[c + 1]++;
      }
      for (c = 0; c < cells; c++) start[c + 1] += start[c];
      for (c = 0; c < cells; c++) fillPos[c] = start[c];
      for (i = 0; i < n; i++) {
        c = cellOf[i];
        if (c >= 0) order[fillPos[c]++] = i;
      }
    },
    // 반경 r 안(중심 기준)의 적 인덱스를 out에 담고 개수를 돌려준다
    queryRadius: function (x, y, r, out) {
      var items = grid.src.items, cols = grid.cols, rows = grid.rows;
      var cx0 = Math.floor((x - r - grid.ox) * INV), cx1 = Math.floor((x + r - grid.ox) * INV);
      var cy0 = Math.floor((y - r - grid.oy) * INV), cy1 = Math.floor((y + r - grid.oy) * INV);
      if (cx0 < 0) cx0 = 0; if (cy0 < 0) cy0 = 0;
      if (cx1 >= cols) cx1 = cols - 1; if (cy1 >= rows) cy1 = rows - 1;
      var r2 = r * r, m = 0, cap = out.length;
      for (var cy = cy0; cy <= cy1; cy++) {
        for (var cx = cx0; cx <= cx1; cx++) {
          var c = cy * cols + cx;
          for (var k = start[c], end = start[c + 1]; k < end; k++) {
            var i = order[k], e = items[i];
            if (!e.active) continue;
            var dx = e.x - x, dy = e.y - y;
            if (dx * dx + dy * dy <= r2 && m < cap) out[m++] = i;
          }
        }
      }
      return m;
    },
    // 가장 가까운 적의 인덱스. 없으면 -1
    nearest: function (x, y) {
      var items = grid.src.items, buf = LW.qbuf;
      for (var ri = 0; ri < 3; ri++) {
        var m = grid.queryRadius(x, y, radii[ri], buf);
        if (m > 0) {
          var best = -1, bd = 1e12;
          for (var k = 0; k < m; k++) {
            var e = items[buf[k]];
            var dx = e.x - x, dy = e.y - y, d = dx * dx + dy * dy;
            if (d < bd) { bd = d; best = buf[k]; }
          }
          return best;
        }
      }
      return -1;
    }
  };
  grid.resize();
})();
