// 품목 둘(X · Y)이 같은 부모 N 대를 함께 쓸 때 — 함께 쓰는 면이 세는 것만으로 짝을 맞추면 무엇이 달라지나(2026-10-28 · 견적서 S12 · 정의 2판 §4.3)
//   node 품목-둘-짝.cjs
// 품목마다 끊는-길.cjs(U9 · 자식은 마지막만 덜 낸다 — U10 없음)의 꼴을 *함께 쓰는 면이 세는 것* — 부모 쪽 걸친 머신들 · 걸친 머신 수(두 끝 합쳐) — 으로 묶는다.
// 칸 셋 · 품목 둘 · 부모 머신마다 두 품목을 다 받는다 → 한 부모 머신에서 두 품목이 함께 걸치지 않으면 칸이 맞다(정의 2판 §4.1).
// 짓지 않는다 — 칸 셈만이다.
'use strict';
const path = require('path');
process.env.U9 = '1'; // U9 는 정해진 규칙이다(정의 U9)
const { GRID, setup, count, minLines } = require(path.join(__dirname, '끊는-길.cjs'));
const key = (s) => (s.b ? `B${s.i}` : `S${s.i}${s.small[0]}`);

// 품목 하나의 줄 L 개 꼴을 묶는다 — 꼴의 수와, 함께 쓰는 면이 세는 것의 목록
function summaries(g, L) {
  const r = count(g, L, { collect: 1e7 });
  const shapes = new Set(), m = new Map();
  for (const p of r.found) {
    const cs = p.map((ci) => r.cls[ci]);
    shapes.add(cs.map((c) => key(c.P) + '|' + key(c.Q)).join(' '));
    const st = cs.reduce((s, c) => s + (c.P.b ? 0 : 1) + (c.Q.b ? 0 : 1), 0);
    const ps = cs.filter((c) => !c.P.b).map((c) => c.P.i);
    m.set(ps.join(',') + '#' + st, { ps: new Set(ps), st });
  }
  return { shapes: shapes.size, list: [...m.values()] };
}
const items = new Map(); // N → 품목들
for (const N of [2, 3, 4, 5, 6, 7, 8]) for (const d of GRID) for (const p of GRID) {
  const g = setup(N, d, p);
  if (g.M > 8 || g.Ts <= g.Cs) continue;
  const L0 = minLines(g, {}, 4); if (L0 === Infinity) continue;
  if (!items.has(N)) items.set(N, []);
  items.get(N).push({ d, p, s: [summaries(g, L0), summaries(g, L0 + 1)] });
}
const q = (xs, f) => { const s = [...xs].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(f * s.length))]; };
const show = (xs) => `가운데 ${q(xs, 0.5)} · 90% ${q(xs, 0.9)} · 가장 많은 ${Math.max(...xs)}`;
const all = [...items.values()].flat();
console.log(`# 품목-둘-짝.cjs — U9 켬 · 자식은 마지막만 덜 낸다(U10 없음) · 칸 셋 · 품목 둘이 같은 부모 N 대(2 ~ 8)를 쓴다 · 머신 한 대의 양은 끊는-길.cjs 의 격자`);
console.log(`품목 하나(범위 안 ${all.length} 판 · 줄 수 최소) — 꼴 ${show(all.map((x) => x.s[0].shapes))}`);
console.log(`  함께 쓰는 면이 세는 것으로 묶으면 ${show(all.map((x) => x.s[0].list.length))}`);
console.log(`  그 가운데 걸친 머신이 가장 적은 것 ${show(all.map((x) => { const mn = Math.min(...x.s[0].list.map((s) => s.st)); return x.s[0].list.filter((s) => s.st === mn).length; }))}`);

const fits = (a, b) => { for (const i of a.ps) if (b.ps.has(i)) return false; return true; };
const S = { pairs: 0, A: 0, B: 0, C: 0, D: 0, D1: 0, Dn: 0 }, eg = { B: [], C: [], D: [] };
for (const [N, list] of items) for (let i = 0; i < list.length; i++) for (let j = i; j < list.length; j++) {
  const X = list[i], Y = list[j], X0 = X.s[0].list, Y0 = Y.s[0].list;
  S.pairs++;
  const minX = Math.min(...X0.map((s) => s.st)), minY = Math.min(...Y0.map((s) => s.st));
  const mm = [];
  for (const a of X0) if (a.st === minX) for (const b of Y0) if (b.st === minY) mm.push(fits(a, b));
  const any0 = X0.some((a) => Y0.some((b) => fits(a, b)));
  const tag = `N${N} X(d${X.d} p${X.p}) Y(d${Y.d} p${Y.p})`;
  if (mm.every(Boolean)) S.A++;
  else if (mm.some(Boolean)) { S.B++; if (eg.B.length < 4) eg.B.push(tag); }
  else if (any0) { S.C++; if (eg.C.length < 4) eg.C.push(tag); }
  else {
    S.D++; if (eg.D.length < 4) eg.D.push(tag);
    const any1 = X.s[1].list.some((a) => Y0.some((b) => fits(a, b))) || X0.some((a) => Y.s[1].list.some((b) => fits(a, b)));
    if (any1) S.D1++; else S.Dn++;
  }
}
console.log(`\n짝 ${S.pairs}`);
console.log(`A 품목마다 걸친 머신이 가장 적은 꼴을 아무거나 골라도 맞는다 ${S.A}`);
console.log(`B 그 가운데 맞는 짝도 안 맞는 짝도 있다 — 함께 봐야 안 맞는 짝을 피한다 ${S.B}  ${eg.B.join(' / ')}`);
console.log(`C 가장 적은 꼴끼리는 하나도 안 맞고, 같은 줄 수의 다른 꼴로는 맞는다 — 걸친 머신을 하나 더 쓴다 ${S.C}  ${eg.C.join(' / ')}`);
console.log(`D 같은 줄 수로는 하나도 안 맞는다 ${S.D} — 한 품목에 줄 하나 더면 맞는다 ${S.D1} · 그래도 안 맞는다 ${S.Dn}  ${eg.D.join(' / ')}`);
