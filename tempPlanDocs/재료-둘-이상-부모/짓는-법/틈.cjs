// 틈을 자원의 변화로 — 머신 사이에 3행 틈이 있을 때 세로줄이 서나. 잣대(찾기)도 같은 모양으로 돌려 견준다.
//   node 틈.cjs <머신 수 최대> <틈 자리> <막힌 행>
//     틈 자리: 짝(1|2 · 3|4 …) · 모두(머신 사이마다) · 가운데(한 곳)
//     막힌 행: 없음(틈의 세 행을 세로줄이 다 쓸 수 있다) · 모두(틈의 행은 틈의 줄이 쓴다 — 세로줄은 땅속으로만 지난다) · 첫행(틈의 첫 행만 막힘)
'use strict';
const M = require('./모델.cjs');
const { K, linesOf, smallSides, ruleDirs, searchRows, setGeom } = M;
const { build3 } = require('./도달영역.cjs');
const { casesOf } = require('./세로줄.cjs');
const maxN = Number(process.argv[2] || 4), where = process.argv[3] || '짝', blockKind = process.argv[4] || '없음';
const GAP = 3;
function geomOf(N) {
  const gapAfter = new Set();
  for (let m = 1; m < N; m++) {
    if (where === '짝' && m % 2 === 1) gapAfter.add(m);
    if (where === '모두') gapAfter.add(m);
    if (where === '가운데' && m === Math.floor(N / 2)) gapAfter.add(m);
  }
  const top = [null]; let r = 0; const blocked = new Set();
  for (let m = 1; m <= N; m++) {
    top[m] = r; r += 3;
    if (gapAfter.has(m)) {
      for (let k = 0; k < GAP; k++) { if (blockKind === '모두' || (blockKind === '첫행' && k === 0)) blocked.add(r + k); }
      r += GAP;
    }
  }
  return { top, blocked };
}
const t0 = Date.now();
const byN = new Map(); const misses = [];
for (const [N, items] of casesOf('찾기')) {
  if (N > maxN) continue;
  const geom = geomOf(N);
  const orders = items.length === 2 && items[0].kind !== 'pair' ? [items, [items[1], items[0]]] : [items];
  let y = false, c = false;
  // 잣대 — 작은 몫의 모든 경우가 서야 선다(짓는 법과 같은 판정)
  for (const its of orders) {
    const lineSets = its.map((it) => linesOf(it, N));
    const combos = lineSets.map((ls) => [...smallSides(ls)]).reduce((acc, list) => acc.flatMap((a) => list.map((s) => [...a, s])), [[]]);
    let yAll = true, cAll = true;
    for (const combo of combos) {
      const ls = []; lineSets.forEach((set, k) => set.forEach((L, i) => ls.push({ ...L, small: combo[k].get(i) || [] })));
      const dirs = ruleDirs(ls);
      if (!c || true) { const r = build3(N, ls, dirs, { geom }); if (!r.ok) cAll = false; }
      setGeom(geom); const s = !!searchRows(N, ls, dirs); setGeom(null);
      if (!s) yAll = false;
      if (!yAll && !cAll) break;
    }
    if (yAll) y = true; if (cAll) c = true;
    if (y && c) break;
  }
  const t = byN.get(N) || [0, 0, 0, 0]; t[0]++; if (y) t[1]++; if (c) t[2]++; if (c && !y) t[3]++; byN.set(N, t);
  if (y && !c && misses.length < 4) misses.push({ N, items: items.map((i) => [i.name, i.splits, i.betweens]) });
}
console.log(`틈 ${where} · 막힌 행 ${blockKind}`);
for (const [N, [n, y, c, bad]] of byN) console.log(`  머신 ${N}대: ${n} 판 — 잣대가 놓음 ${y} · 짓는 법이 지음 ${c}${bad ? ` · 짓는 법만(틀림) ${bad}` : ''}`);
for (const m of misses) console.log(`    놓침: N${m.N} ${JSON.stringify(m.items)}`);
console.log(`  ${((Date.now() - t0) / 1000).toFixed(0)}초`);
