// 잣대 — 방향을 규칙(면 규칙 §3.4: 맨 위 줄 ↓ · 맨 아래 줄 ↑ · 가운데 줄은 작은 몫 쪽)으로 두고도 찾기가 놓을 수 있나. 짓는 법은 이 방향을 쓰므로
// 이것이 안 서는 판은 짓는 법도 못 짓는 것이 정상이다.
'use strict';
const { K, linesOf, smallSides, searchRows, picksPerMachine, subsets, ruleDirs } = require('./모델-온레인.cjs');
const t0 = Date.now();
let tot = 0, bad = 0; const fails = [];
const [N0, N1] = (process.argv[2] || '2-6').split('-').map(Number);   // 머신 수 범위 — node 잣대-온레인.cjs 6-6
for (let N = N0; N <= (N1 || N0); N++) {
  const ms = Array.from({ length: N }, (_, i) => i + 1), bs = Array.from({ length: N - 1 }, (_, i) => i + 1);
  const cutsets = [];
  for (const sp of subsets(ms, 2)) for (const bt of subsets(bs, 2)) if (sp.length + bt.length <= 2) cutsets.push({ sp, bt });
  const cases = [];
  for (const cx of cutsets) for (const cy of cutsets) {
    if (cx.sp.some((m) => cx.bt.includes(m) || cx.bt.includes(m - 1))) continue;
    if (cy.sp.some((m) => cy.bt.includes(m) || cy.bt.includes(m - 1))) continue;
    cases.push([{ name: 'X', kind: 'single', splits: cx.sp, betweens: cx.bt }, { name: 'Y', kind: 'single', splits: cy.sp, betweens: cy.bt }]);
  }
  for (const bp of subsets(bs, 2)) for (const bq of subsets(bs, 2)) cases.push([{ name: 'P', kind: 'pair', splits: [], betweens: bp }, { name: 'Q', kind: 'single', splits: [], betweens: bq }]);
  let nb = 0, nt = 0;
  for (const items of cases) {
    if (picksPerMachine(N, items).slice(1).some((v) => v > 3)) continue;
    nt++;
    const lineSets = items.map((it) => linesOf(it, N));
    const sideLists = lineSets.map((ls) => [...smallSides(ls)]);
    const combos = sideLists.reduce((acc, list) => acc.flatMap((a) => list.map((s) => [...a, s])), [[]]);
    for (const combo of combos) {
      const lines = [];
      lineSets.forEach((ls, k) => ls.forEach((L, i) => lines.push({ ...L, small: combo[k].get(i) || [] })));
      if (!searchRows(N, lines, ruleDirs(lines), -K, 3 * N - 1 + K)) { nb++; fails.push(JSON.stringify(items.map((i) => [i.name, i.splits, i.betweens]))); break; }
    }
  }
  tot += nt; bad += nb;
  console.log(`  머신 ${N}대: 규칙 방향으로 안 서는 판 ${nb}/${nt}  (${((Date.now() - t0) / 1000).toFixed(0)}초)`);
}
console.log(`  합 ${bad}/${tot}`);
require('fs').writeFileSync('잣대-온레인-안섬.json', JSON.stringify(fails));
