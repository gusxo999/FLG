// 걸침을 피하면 줄이 몇 개 느나 — S7 과 같은 격자(378 판). 견적서 S11.
//   node 걸침-피하기.cjs
//
// 걸침 없는 끊기 — 끊는 자리마다 부모 쪽 · 자식 쪽이 다 머신 경계(끊는-길.cjs 의 pClean · cClean).
// 자식의 남는 몫 — 끊는-길.cjs 는 마지막 자식만 덜 낸다고 놓는다(누적 양 하나로 양 끝을 끊는 꼴).
//   C1 은 어느 자식이든 덜 돌아도 된다 — 그래서 *아무 자식이나 쉰다* 를 따로 센다: 부모를 이어진 무리로 나누고,
//   무리마다 자식 ⌈무리의 양 ÷ p⌉ 대가 그 줄에만 싣는다. 자식 대수의 합 ≤ M 이면 선다.
// 받는 쪽만 보는 고름(O5 의 2026-10-23 판) — 부모 쪽 걸침이 없는 길 가운데 위에서부터 이른 끊기(사전순 첫 길)를 고르면, 양 끝이 다 깨끗한 길이 같은 줄 수에 있어도 자식 쪽에 걸침이 남나.
// 견주는 것 — 걸침을 허락할 때의 줄 수 최소(끊는-길.cjs 의 minLines — C2 · C3 · C4 두 편 합쳐 · R18 · 정확히 반은 작은 몫 없음)보다 몇 줄 더 드나.
'use strict';
const { C, K, GRID, setup, count, minLines } = require('./끊는-길.cjs');
const UPTO = 12; // 걸침 없는 끊기를 찾을 때 줄 수 최소 위로 몇 줄까지 보나

function freeSlackBoth(g, Lmax = 40) {
  const { N, ds, ps, Cs, M } = g;
  let best = new Array(N + 1).fill(Infinity); best[0] = 0; // best[i] = 부모 i 대까지 쓴 자식 대수 최소
  for (let L = 1; L <= Lmax; L++) {
    const nb = new Array(N + 1).fill(Infinity);
    for (let i = 0; i < N; i++) if (best[i] < Infinity)
      for (let j = i + 1; j <= N && (j - i) * ds <= Cs; j++)
        nb[j] = Math.min(nb[j], best[i] + Math.ceil(((j - i) * ds) / ps));
    if (nb[N] <= M) return L;
    best = nb;
  }
  return Infinity;
}
const gcd = (a, b) => (b ? gcd(b, a % b) : a);

console.log(`# 걸침-피하기.cjs — 줄 상한 ${C}/s · 격자 1/${K} /s · 머신 한 대의 양 격자 ${GRID.join(' · ')} · 걸침 없는 끊기는 줄 수 최소 + ${UPTO} 까지 찾는다`);
const rows = { both: new Map(), free: new Map(), pOnly: new Map(), cOnly: new Map() };
const tally = (m, k) => m.set(k, (m.get(k) || 0) + 1);
let cfg = 0, noneLcm = 0, noneAll = 0, bothAtLs = 0, o5miss = 0;
const o5eg = [];
const eg = [];
for (const N of [2, 3, 4, 5, 6, 7, 8]) for (const d of GRID) for (const p of GRID) {
  const g = setup(N, d, p);
  if (g.M > 8 || g.Ts <= g.Cs) continue;
  cfg++;
  const Ls = minLines(g, {}, 4);
  const add = (m, L) => tally(m, L === Infinity ? '없음' : `+${L - Ls}`);
  const Lb = minLines(g, { pClean: true, cClean: true }, UPTO), Lf = freeSlackBoth(g);
  add(rows.both, Lb); add(rows.free, Lf);
  add(rows.pOnly, minLines(g, { pClean: true }, UPTO));
  add(rows.cOnly, minLines(g, { cClean: true }, UPTO));
  if (Lb === Infinity) { noneAll++; if ((g.ds * g.ps) / gcd(g.ds, g.ps) > g.Cs) noneLcm++; }
  if (Ls < Infinity && Lb === Ls) {
    bothAtLs++;
    const r = count(g, Ls, { pClean: true, collect: 1 });
    const left = r.found[0].filter((ci) => !r.cls[ci].Q.b).length;
    if (left) { o5miss++; if (o5eg.length < 3) o5eg.push(`부모 ${N}×${d} · 자식 ${g.M}×${p}`); }
  }
  if (Lb === Infinity && Lf < Infinity && eg.length < 4) eg.push(`부모 ${N}×${d} · 자식 ${g.M}×${p}(줄 ${Lf})`);
}
const show = (m) => [...m.entries()].sort().map(([k, v]) => `${k} ${v}`).join(' · ');
console.log(`판 ${cfg} — 걸침을 허락할 때의 줄 수 최소보다 몇 줄 더 드나`);
console.log(`  양 끝 다 걸침 없음 · 마지막 자식만 덜 냄: ${show(rows.both)}`);
console.log(`    없음 ${noneAll} 판 가운데 d 와 p 의 최소공배수가 줄 상한을 넘는 판 ${noneLcm}`);
console.log(`  양 끝 다 걸침 없음 · 아무 자식이나 쉼: ${show(rows.free)}`);
console.log(`    마지막 자식만으로는 없고 아무 자식이나 쉬면 있는 보기: ${eg.join(' / ')}`);
console.log(`  부모 쪽만 걸침 없음: ${show(rows.pOnly)}`);
console.log(`  자식 쪽만 걸침 없음: ${show(rows.cOnly)}`);
console.log(`  받는 쪽만 보는 고름 — 같은 줄 수에 양 끝이 다 깨끗한 길이 있는 ${bothAtLs} 판 가운데 자식 쪽에 걸침을 남기는 판 ${o5miss}(보기: ${o5eg.join(' / ')})`);
