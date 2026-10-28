// 유체를 자원의 변화로 — 머신 면의 한 행에 유체 연결이 서서 그 행엔 인서터가 못 선다(자리 없음) · 파이프가 세로줄 칸까지 쓰면 그 칸도 막힌다.
//   node 유체.cjs <판 묶음 확정|찾기> <머신 수 최대> <모양>
//     모양: 가운데(머신마다 가운데 행 자리 없음) · 가운데막힘(같은 행의 세로줄 칸도 막힘) · 첫머신(머신 1 의 맨 위 행만 자리 없음)
'use strict';
const { K, linesOf, smallSides, ruleDirs, searchRows, setGeom } = require('./모델.cjs');
const { build3 } = require('./도달영역.cjs');
const { casesOf } = require('./세로줄.cjs');
const [mode, maxN, shape] = [process.argv[2] || '확정', Number(process.argv[3] || 4), process.argv[4] || '가운데'];
const look = process.env.LOOK ?? 99;
function geomOf(N) {
  const top = [null]; for (let m = 1; m <= N; m++) top[m] = 3 * (m - 1);
  const noSeat = new Set(), blocked = new Set();
  for (let m = 1; m <= N; m++) {
    if (shape === '가운데' || shape === '가운데막힘') { noSeat.add(top[m] + 1); if (shape === '가운데막힘') blocked.add(top[m] + 1); }
    if (shape === '첫머신' && m === 1) noSeat.add(top[m]);
  }
  return { top, blocked, noSeat };
}
const t0 = Date.now(); const byN = new Map(); const misses = [];
for (const [N, items] of casesOf(mode)) {
  if (N > maxN) continue;
  const geom = geomOf(N);
  const orders = items.length === 2 && items[0].kind !== 'pair' ? [items, [items[1], items[0]]] : [items];
  let y = false, c = false;
  for (const its of orders) {
    const lineSets = its.map((it) => linesOf(it, N));
    const combos = lineSets.map((ls) => [...smallSides(ls)]).reduce((acc, list) => acc.flatMap((a) => list.map((s) => [...a, s])), [[]]);
    let yAll = true, cAll = true;
    for (const combo of combos) {
      const ls = []; lineSets.forEach((set, k) => set.forEach((L, i) => ls.push({ ...L, small: combo[k].get(i) || [] })));
      const dirs = ruleDirs(ls);
      if (cAll && !build3(N, ls, dirs, { look, geom }).ok) cAll = false;
      if (yAll) { setGeom(geom); if (!searchRows(N, ls, dirs)) yAll = false; setGeom(null); }
      if (!yAll && !cAll) break;
    }
    if (yAll) y = true; if (cAll) c = true;
    if (y && c) break;
  }
  const t = byN.get(N) || [0, 0, 0, 0]; t[0]++; if (y) t[1]++; if (c) t[2]++; if (c && !y) t[3]++; byN.set(N, t);
  if (y && !c && misses.length < 4) misses.push({ N, items: items.map((i) => [i.name, i.kind, i.splits, i.betweens]) });
}
console.log(`유체 ${shape} · 판 묶음 ${mode}`);
for (const [N, [n, y, c, bad]] of byN) console.log(`  머신 ${N}대: ${n} 판 — 잣대가 놓음 ${y} · 짓는 법이 지음 ${c}${bad ? ` · 짓는 법만(틀림) ${bad}` : ''}`);
for (const m of misses) console.log(`    놓침: N${m.N} ${JSON.stringify(m.items)}`);
console.log(`  ${((Date.now() - t0) / 1000).toFixed(0)}초`);
