// 레인 하나짜리 입구가 꼭 드는 판에서 — 그 입구를 *어느 줄* 에만 허락하면 서나(가운데 줄 · 맨 위 줄 · 맨 아래 줄)
'use strict';
const { linesOf, smallSides, ruleDirs } = require('./모델.cjs');
const { build3 } = require('./도달영역.cjs');
const { casesOf } = require('./세로줄.cjs');
const maxN = Number(process.argv[2] || 5);
const roleOf = (ls, i) => { const same = ls.map((L, k) => [L, k]).filter(([L]) => L.item === ls[i].item).sort((p, q) => p[0].a - q[0].a); const pos = same.findIndex(([, k]) => k === i); return same.length === 1 ? '하나' : pos === 0 ? '맨위' : pos === same.length - 1 ? '맨아래' : '가운데'; };
const tally = new Map();
for (const [N, items] of casesOf('찾기')) {
  if (N > maxN) continue;
  const lineSets = items.map((it) => linesOf(it, N));
  const combos = lineSets.map((ls) => [...smallSides(ls)]).reduce((acc, list) => acc.flatMap((a) => list.map((s) => [...a, s])), [[]]);
  for (const combo of combos) {
    const base = []; lineSets.forEach((set, k) => set.forEach((L, i) => base.push({ ...L, small: combo[k].get(i) || [] })));
    const dirs = ruleDirs(base);
    const full = build3(N, base.map((L) => ({ ...L, halfLane: false })), dirs, { look: 99 }).ok;
    if (full) continue;
    const any = build3(N, base, dirs, { look: 99 }).ok;
    const res = { 판: 1, 아무줄: any ? 1 : 0 };
    for (const role of ['가운데', '맨위', '맨아래', '하나']) {
      const ls = base.map((L, i) => ({ ...L, halfLane: roleOf(base, i) === role }));
      res[role] = build3(N, ls, dirs, { look: 99 }).ok ? 1 : 0;
    }
    const t = tally.get(N) || {}; for (const k in res) t[k] = (t[k] || 0) + res[k]; tally.set(N, t);
  }
}
for (const [N, t] of tally) console.log(`  머신 ${N}대: 온 레인으로 안 서는 경우 ${t.판} — 레인 하나 입구를 아무 줄에나 ${t.아무줄} · 가운데 줄에만 ${t.가운데} · 맨 위 줄에만 ${t.맨위} · 맨 아래 줄에만 ${t.맨아래} · 줄 하나인 품목에만 ${t.하나}`);
