// 기둥이 길 때 — 잣대(찾기) 없이 짓는 법만. 다 짓나 · 앞보기가 얼마나 드나(판 하나에 들여다본 머신 수)
'use strict';
const { linesOf, smallSides, ruleDirs, picksPerMachine, subsets } = require('./모델.cjs');
const { build3, WORK } = require('./도달영역.cjs');
const Ns = process.argv[2].split(',').map(Number), every = Number(process.argv[3] || 1);
for (const N of Ns) {
  const ms = Array.from({ length: N }, (_, i) => i + 1), bs = Array.from({ length: N - 1 }, (_, i) => i + 1);
  const cutsets = [];
  for (const sp of subsets(ms, 2)) for (const bt of subsets(bs, 2)) if (sp.length + bt.length <= 2) cutsets.push({ sp, bt });
  const cases = [];
  for (const cx of cutsets) for (const cy of cutsets) {
    if (cx.sp.some((m) => cx.bt.includes(m) || cx.bt.includes(m - 1)) || cy.sp.some((m) => cy.bt.includes(m) || cy.bt.includes(m - 1))) continue;
    const items = [{ name: 'X', kind: 'single', splits: cx.sp, betweens: cx.bt }, { name: 'Y', kind: 'single', splits: cy.sp, betweens: cy.bt }];
    if (!picksPerMachine(N, items).slice(1).some((v) => v > 3)) cases.push(items);
  }
  let ok = 0, tot = 0, maxW = 0, sumW = 0, buildMs = 0; const t0 = Date.now();
  cases.forEach((items, idx) => {
    if (idx % every) return;
    tot++;
    let good = false;
    for (const its of [items, [items[1], items[0]]]) {
      const lineSets = its.map((it) => linesOf(it, N));
      const combos = lineSets.map((ls) => [...smallSides(ls)]).reduce((acc, list) => acc.flatMap((a) => list.map((s) => [...a, s])), [[]]);
      let all = true;
      for (const combo of combos) {
        const ls = []; lineSets.forEach((set, k) => set.forEach((L, i) => ls.push({ ...L, small: combo[k].get(i) || [] })));
        const w0 = WORK.looks;
        const b0 = performance.now(); const r = build3(N, ls, ruleDirs(ls)); buildMs += performance.now() - b0;
        const w = WORK.looks - w0; maxW = Math.max(maxW, w); sumW += w;
        if (!r.ok) { all = false; break; }
      }
      if (all) { good = true; break; }
    }
    if (good) ok++;
  });
  console.log(`  머신 ${N}대: ${ok}/${tot} 판(${every}개에 하나) · 판 하나에 들여다본 머신 평균 ${(sumW / tot).toFixed(0)} · 짓기 한 번에 많아야 ${maxW} · 판 하나 짓는 데 평균 ${(buildMs / tot).toFixed(0)}ms · 모두 ${((Date.now() - t0) / 1000).toFixed(0)}초(판 목록 만들기 포함)`);
}
