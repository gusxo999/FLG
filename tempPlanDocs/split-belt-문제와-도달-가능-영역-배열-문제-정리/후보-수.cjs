// 품목 하나에서 걸침 후보 제거 뒤 남는 후보가 몇인가 — 6 단계가 고를 것의 크기(2026-10-28).
//   U9=1 node 후보-수.cjs      (U9 를 켜야 정해진 규칙이다 — 끊는-길.cjs 머리말)
// 센 것은 꼴이다 — 맡는 머신 · 걸친 머신 · 작은 몫의 줄이 같은 후보를 하나로 센다. 같은 꼴 안에서 줄의 양이 조금 다른 것은 6 단계도 ② 도 가리지 않는다.
// U10(아무 자식이나 덜 돈다)은 아직 없다 — 끊는-길.cjs 는 마지막 자식만 덜 낸다. 넣으면 자식 쪽 꼴이 는다.
// 칸 쓰임 — 부모 쪽 걸친 머신들과 자식 쪽 걸친 머신들이 같은 꼴을 하나로 센 것. 6 단계가 칸 수(E2)와 걸친 머신 수(O5)로 고를 때 보는 것은 이것뿐이다.
'use strict';
const { GRID, setup, count, minLines } = require('./끊는-길.cjs');
const q = (xs, f) => { const s = [...xs].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(f * s.length))]; };
const show = (xs) => `가운데 ${q(xs, 0.5)} · 90% ${q(xs, 0.9)} · 가장 많은 ${Math.max(...xs)}`;

const t0 = Date.now();
const R = { a: [], sa: [], b: [], sb: [] };
let cfg = 0;
for (const N of [2, 3, 4, 5, 6, 7, 8]) for (const d of GRID) for (const p of GRID) {
  const g = setup(N, d, p);
  if (g.M > 8 || g.Ts <= g.Cs) continue;
  const L0 = minLines(g, {}, 4);
  if (L0 === Infinity) continue;
  cfg++;
  for (const [L, n, s] of [[L0, 'a', 'sa'], [L0 + 1, 'b', 'sb']]) {
    const r = count(g, L, { collect: 1e7 });
    const slot = new Set(r.found.map((path) => {
      const cs = path.map((ci) => r.cls[ci]);
      return cs.filter((c) => !c.P.b).map((c) => c.P.i).join(',') + '|' + cs.filter((c) => c.Q && !c.Q.b).map((c) => c.Q.i).join(',');
    }));
    R[n].push(r.n); R[s].push(slot.size);
  }
}
console.log(`# 후보-수.cjs — ${process.env.U9 === '1' ? 'U9 켬' : 'U9 끔(옛 반반 가정)'} · 범위 안의 격자(부모 2 ~ 8 대 · 자식 8 대까지) ${cfg} 판 · ${Date.now() - t0} ms`);
console.log(`줄 수 최소 — 꼴 ${show(R.a)} · 칸 쓰임 ${show(R.sa)}`);
console.log(`한 줄 더   — 꼴 ${show(R.b)} · 칸 쓰임 ${show(R.sb)}`);

console.log('\n범위 밖 — 같은 d · p 로 부모 대수만 늘린다(꼴의 수 · 세기만 하고 늘어놓지 않는다)');
for (const [d, p] of [[4, 11], [5, 9], [3, 5], [6, 9]]) {
  const out = [];
  for (const N of [4, 8, 12, 16, 24]) {
    const g = setup(N, d, p), t = Date.now();
    const L = minLines(g, {}, 4);
    out.push(L === Infinity ? `${N}대 —` : `${N}대 줄 ${L}: ${count(g, L).n} · 한 줄 더 ${count(g, L + 1).n} [${Date.now() - t} ms]`);
  }
  console.log(`  부모 d ${d} · 자식 p ${p} — ${out.join(' / ')}`);
}
