// 판 묶음 — 짓는 법과 잣대를 견줄 판들. `../../재료-둘-이상-부모/짓는-법/세로줄.cjs` 의 casesOf 를 그대로 옮겼다(2026-10-25 · 옛 판 묶음과 같은 판).
//   확정 — 품목 둘 · 품목마다 끊는 자리 하나까지 · 머신 2 ~ 8대(980 판)
//   찾기 — 품목 둘 · 품목마다 끊는 자리 둘까지 · 머신 2 ~ 6대(4,902 판)
//   셋   — 품목 셋 · 머신 2 ~ 8대(14 판)
// 머신 한 대에 닿는 줄이 셋(그 면의 인서터 칸)을 넘는 판은 뺀다.
'use strict';
const { picksPerMachine, subsets } = require('./모델.cjs');

function casesOf(mode) {
  const out = [];
  if (mode === '확정') {
    for (let N = 2; N <= 8; N++) {
      const ms = Array.from({ length: N }, (_, i) => i + 1), bs = Array.from({ length: N - 1 }, (_, i) => i + 1);
      const one = [{ sp: [], bt: [] }, ...ms.map((m) => ({ sp: [m], bt: [] })), ...bs.map((b) => ({ sp: [], bt: [b] }))];
      for (const cx of one) for (const cy of one) out.push([N, [{ name: 'X', kind: 'single', splits: cx.sp, betweens: cx.bt }, { name: 'Y', kind: 'single', splits: cy.sp, betweens: cy.bt }]]);
      for (const bp of [[], ...bs.map((b) => [b])]) for (const bq of [[], ...bs.map((b) => [b])]) out.push([N, [{ name: 'P', kind: 'pair', splits: [], betweens: bp }, { name: 'Q', kind: 'single', splits: [], betweens: bq }]]);
    }
  } else if (mode === '찾기') {
    for (let N = 2; N <= 6; N++) {
      const ms = Array.from({ length: N }, (_, i) => i + 1), bs = Array.from({ length: N - 1 }, (_, i) => i + 1);
      const cutsets = [];
      for (const sp of subsets(ms, 2)) for (const bt of subsets(bs, 2)) if (sp.length + bt.length <= 2) cutsets.push({ sp, bt });
      for (const cx of cutsets) for (const cy of cutsets) {
        if (cx.sp.some((m) => cx.bt.includes(m) || cx.bt.includes(m - 1))) continue;
        if (cy.sp.some((m) => cy.bt.includes(m) || cy.bt.includes(m - 1))) continue;
        out.push([N, [{ name: 'X', kind: 'single', splits: cx.sp, betweens: cx.bt }, { name: 'Y', kind: 'single', splits: cy.sp, betweens: cy.bt }]]);
      }
      for (const bp of subsets(bs, 2)) for (const bq of subsets(bs, 2)) out.push([N, [{ name: 'P', kind: 'pair', splits: [], betweens: bp }, { name: 'Q', kind: 'single', splits: [], betweens: bq }]]);
    }
  } else if (mode === '셋') {
    for (let N = 2; N <= 8; N++) for (const k of [1, 2]) {
      const bt = []; for (let m = k; m < N; m += k) bt.push(m);
      out.push([N, [{ name: 'X', kind: 'single', splits: [], betweens: [] }, { name: 'Y', kind: 'single', splits: [], betweens: [] }, { name: 'Z', kind: 'single', splits: [], betweens: bt }]]);
    }
  }
  return out.filter(([N, items]) => !picksPerMachine(N, items).slice(1).some((v) => v > 3));
}

module.exports = { casesOf };
