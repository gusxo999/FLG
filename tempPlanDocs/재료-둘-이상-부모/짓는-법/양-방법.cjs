// split belt 할당량(양) → 도달 가능 영역 배열(자리) 를 잇는 방법 넷을 같은 판에서 견준다 — 머신마다 쓰는 양을 넣은 시험판.
//   node 양-방법.cjs '<품목 JSON>'          품목 JSON: {"X":[머신 1 이 쓰는 양, 머신 2, ...], "Y":[...]} (단위 /s)
//   node 양-방법.cjs 찾기 <머신 수> <판 수>  방법끼리 결과가 갈리는 판을 마구 뽑아 찾는다
// 벨트 한 줄 15/s · 레인 하나 7.5/s(시험 기준). 방향이 자유인 줄의 방향은 면이 고른다(freeDirs). 앞보기는 끝까지.
//
// 붓기는 모두 위에서부터 · 한 줄이 위 · 아래 양쪽에서 작은 몫을 받지 않는다(그러면 그 머신을 덜어 내 다음 줄이 맡는다 — 정한 것 2026-10-08 · 줄이 늘 수 있다).
// 방법 1 — 가득 채워 끊는다(지금 붓기). 못 지으면 벨트 한 줄 더(그때는 여유가 생기므로 머신 사이 끊기 먼저).
// 방법 2 — 여유가 허락하면 머신 사이에서 끊는다(두 줄에 걸친 머신을 안 만든다). 못 지으면 벨트 한 줄 더.
// 방법 3 — 방법 1 로 짓고, 막히면 막힌 머신에 가장 가까운 걸친 머신을 머신 사이 끊기로 옮기고 그 아래를 다시 부어 짓는다. 다 해도 안 되면 벨트 한 줄 더.
// 방법 5 — 면이 머신마다 인서터 칸 수(지금은 셋)만 미리 알려 주고, split belt 가 그 수를 지키는 끊기 가운데
//          벨트가 적고 · 두 줄에 걸친 머신이 가장 적은 것 하나를 고른다(품목들을 함께 본다 · 면에 묻지 않는다). 면은 받은 줄로 짓기만 한다.
// 방법 4 — 끊을 수 있는 자리(머신 사이 · 가득 채운 걸침)의 모든 이음을 목록으로 넘기고 면이 그 안에서 고른다.
//          (여기서는 목록을 다 지어 보아 *설 것이 있나* 만 본다 — 한 번 지나가며 고르는 꼴은 아직 안 만들었다)
'use strict';
const { linesOf, ruleDirs } = require('./모델.cjs');
const { build3 } = require('./도달영역.cjs');
// 줄 하나가 나르는 양의 상한 = 고른 가장 빠른 벨트의 운반량 ÷ 2(인서터는 늘 먼 레인에 놓는다 — 레인 하나). 시험 기준 벨트 30/s → 15/s.
// 옆에서 붙인 지하 입구는 레인 하나를 들인다 — 줄이 이미 레인 하나이므로 양으로는 더 깎지 않는다(2026-10-25 고침 · 옛 값 LANE=7.5 는 레인을 두 번 나눴다).
// (사이드로드는 옆 벨트의 두 레인을 닿은 쪽 레인 하나로 접는다 — docs/factorio/belt-lane-semantics.md ③ · 지하 입구는 한 레인만 들인다 — 사용자 2026-10-08)
const C = 15, LANE = Number(process.env.LANE ?? 15), EPS = 1e-9;
const FREE = process.env.FREE !== '0';   // 방향이 자유인 줄의 방향을 면이 고른다(기본) · FREE=0 이면 규칙 방향(위 끝 줄 ↓ · 아래 끝 줄 ↑ · 가운데는 작은 몫 쪽)

// 끊는 자리(누적 양 xs)로 줄을 만든다 — 줄마다 머신 범위 · 양 · 작은 몫 · 레인 하나로 되나
function linesOfCuts(name, d, xs) {
  const N = d.length, P = [0]; for (let m = 1; m <= N; m++) P[m] = P[m - 1] + d[m - 1];
  const splits = [], betweens = [], smallAt = []; // smallAt[k] = 끊기 k 의 작은 몫이 위 줄('u')인가 아래 줄('d')인가
  for (const x of xs) {
    let m = 1; while (m <= N && P[m] < x - EPS) m++;
    if (Math.abs(P[m] - x) < EPS) { betweens.push(m); smallAt.push(null); }
    else { const up = x - P[m - 1], dn = P[m] - x; splits.push(m); smallAt.push(up < dn - EPS ? 'u' : 'd'); }   // 같으면 아래 줄이 작은 몫
  }
  const item = { name, kind: 'single', splits, betweens };
  const ls = linesOf(item, N);
  const amounts = [...xs, P[N]].map((x, k) => x - (k ? xs[k - 1] : 0));
  if (amounts.some((a) => a <= EPS || a > C + EPS)) return null;
  ls.forEach((L, k) => { L.small = []; L.amount = amounts[k]; L.halfLane = amounts[k] <= LANE + EPS; });
  smallAt.forEach((s, k) => { if (s === 'u') ls[k].small.push(ls[k].b); else if (s === 'd') ls[k + 1].small.push(ls[k + 1].a); });
  if (ls.some((L) => L.small.length > 1)) return null; // 한 줄이 위 · 아래 양쪽에서 작은 몫을 받지 않는다(정한 것 2026-10-08)
  return { item, lines: ls, xs };
}
const total = (d) => d.reduce((s, v) => s + v, 0);
const prefix = (d) => { const P = [0]; d.forEach((v, i) => P.push(P[i] + v)); return P; };
// 위에서부터 붓기 — x0 부터(앞 끊기는 그대로) · preferBoundary 면 여유가 허락할 때 머신 사이에서 끊는다
function pour(d, L, preferBoundary, x0 = 0, smallTop0 = false) {
  const P = prefix(d), T = total(d), xs = []; let x = x0, smallTop = smallTop0, k = 1;
  while (T - x > C + EPS) {
    let b = x; for (let m = 1; m <= d.length; m++) if (P[m] > x + EPS && P[m] <= x + C + EPS) b = P[m];
    const full = x + C;
    let m = 1; while (P[m] < full - EPS) m++;
    const onEdge = Math.abs(P[m] - full) < EPS, up = full - P[m - 1], dn = P[m] - full;
    let cut;
    if (preferBoundary && b > x + EPS && T - b <= Math.max(1, L - k) * C + EPS) cut = b;
    else if (onEdge) cut = full;
    else if (smallTop && up < dn - EPS && b > x + EPS) cut = b;   // 위에서 작은 몫을 받은 줄은 아래에서 또 안 받는다 — 그 머신을 덜어 낸다
    else cut = full;
    const split = !(Math.abs(P.find((p) => p >= cut - EPS) - cut) < EPS);
    smallTop = split && !(cut - P[m - 1] < P[m] - cut - EPS);   // 다음 줄이 위에서 작은 몫을 받나
    xs.push(cut); x = cut; k++;
  }
  return xs;
}
const fillFull = (d, L) => pour(d, L, false);
const boundaryFirst = (d, L) => pour(d, L, true);
// 방법 4 의 목록 — 끊기마다 머신 사이(누적 양 = 머신 경계) 또는 가득 채운 걸침(앞 끊기 + 15)
function allCuts(d, L) {
  const P = prefix(d), T = total(d), out = [];
  const rec = (k, x, xs) => {
    if (k === L) { if (T - x <= C + EPS && T - x > EPS) out.push(xs.slice()); return; }
    const opts = new Set(P.filter((p) => p > x + EPS && p < T - EPS && p <= x + C + EPS));
    if (x + C < T - EPS) opts.add(x + C);
    for (const o of [...opts].sort((a, b) => a - b)) if (T - o <= (L - k) * C + EPS) { xs.push(o); rec(k + 1, o, xs); xs.pop(); }
  };
  rec(1, 0, []);
  return out;
}
function combine(N, parts) {
  if (parts.some((p) => !p)) return null;
  const lines = parts.flatMap((p) => p.lines);
  const per = new Array(N + 1).fill(0); for (const L of lines) for (let m = L.a; m <= L.b; m++) per[m]++;
  const over = per.findIndex((v, m) => m > 0 && v > 3);
  if (over > 0) return { lines, seatsOver: true, overAt: over };
  return { lines };
}
function tryBuild(N, set, look = 99) {
  if (!set) return { ok: false, why: '줄을 만들 수 없다(작은 몫 규칙)' };
  if (set.seatsOver) return { ok: false, why: `머신 ${set.overAt}: 인서터 칸이 넷 이상 든다(면 하나에 셋)` };
  return build3(N, set.lines, ruleDirs(set.lines), { look, freeDirs: FREE });
}
const splitsOf = (set) => set.lines.reduce((s, L, i, a) => s + (i && a[i - 1].item === L.item && a[i - 1].b === L.a ? 1 : 0), 0);
const Ls = (D) => Object.fromEntries(Object.entries(D).map(([k, d]) => [k, Math.ceil(total(d) / C - EPS)]));

function method(D, which) {
  const r = method0(D, which), L0 = Ls(D);
  if (r.set && r.set.lines) r.belts = r.set.lines.length - Object.values(L0).reduce((a, b) => a + b, 0);
  return r;
}
function method0(D, which) {
  const names = Object.keys(D), N = D[names[0]].length, L0 = Ls(D);
  const make = (pour, extra = {}) => combine(N, names.map((n) => linesOfCuts(n, D[n], pour(D[n], L0[n] + (extra[n] || 0)))));
  const steps = [];
  // 벨트 한 줄 더 — 한 품목에 줄 하나를 더 주고, 그 줄 수의 끊기 가운데 걸친 머신이 적은 것부터 지어 본다(방법마다 같은 물러남)
  const fallback = () => {
    for (const n of names) {
      const lists = names.map((k) => (k === n ? allCuts(D[k], L0[k] + 1) : [pourOf(k)]).map((xs) => linesOfCuts(k, D[k], xs)).filter(Boolean));
      const sets = lists.reduce((acc, list) => acc.flatMap((a) => list.map((x) => [...a, x])), [[]]).map((ps) => combine(N, ps)).filter((x) => x && !x.seatsOver).sort((a, b) => splitsOf(a) - splitsOf(b));
      for (const set of sets) { const r = tryBuild(N, set); if (r.ok) { steps.push({ what: `벨트 한 줄 더(${n})`, set, r }); return { ok: true, set, steps }; } }
    }
    steps.push({ what: '벨트 한 줄 더 — 그래도 안 선다' });
    return { ok: false, steps };
  };
  const pourOf = (k) => (which === 2 || which === 5 ? boundaryFirst : fillFull)(D[k], L0[k]);
  if (which === 5) {
    // 면에서 받는 것은 머신마다 인서터 칸 수 하나뿐 — 그 수를 지키는 끊기 가운데 벨트가 적고 · 걸친 머신이 적은 것 하나를 split belt 가 고른다(면에 묻지 않는다)
    const seats = Number(process.env.SEATS || 3);
    for (const extraN of [null, ...names]) {
      const lists = names.map((n) => allCuts(D[n], L0[n] + (n === extraN ? 1 : 0)).map((xs) => linesOfCuts(n, D[n], xs)).filter(Boolean));
      const sets = lists.reduce((acc, list) => acc.flatMap((x) => list.map((y) => [...x, y])), [[]]).map((ps) => combine(N, ps)).filter((x) => x && !x.seatsOver);
      if (!sets.length) continue;
      sets.sort((p, q) => splitsOf(p) - splitsOf(q));
      const set = sets[0], r = tryBuild(N, set);
      steps.push({ what: extraN ? `칸 수를 지키는 끊기(벨트 한 줄 더 — ${extraN}) ${sets.length} 가지 가운데 걸친 머신이 가장 적은 것` : `칸 수를 지키는 끊기 ${sets.length} 가지 가운데 걸친 머신이 가장 적은 것`, set, r });
      if (r.ok) return { ok: true, set, steps };   // 못 지으면 벨트 한 줄 더 한 목록에서 같은 규칙으로 하나를 고른다(면에 여러 번 묻지 않는다 — 한 줄 늘 때마다 한 번)
    }
    steps.push({ what: '칸 수를 지키는 끊기로 못 지었다' });
    return { ok: false, steps };
  }
  if (which === 1 || which === 2) {
    const set = make(which === 1 ? fillFull : boundaryFirst); const r = tryBuild(N, set); steps.push({ what: which === 1 ? '가득 채워 끊기' : '여유로 머신 사이 끊기', set, r });
    if (r.ok) return { ok: true, belts: 0, set, steps };
    return fallback();
  }
  if (which === 3) {
    let xsOf = Object.fromEntries(names.map((n) => [n, fillFull(D[n], L0[n])]));
    const tried = new Set();
    for (let round = 0; round < 6; round++) {
      const set = combine(N, names.map((n) => linesOfCuts(n, D[n], xsOf[n])));
      const r = tryBuild(N, set); steps.push({ what: round ? '걸친 머신 하나를 옮겨 다시' : '가득 채워 끊기', set, r });
      if (r.ok) return { ok: true, belts: 0, set, steps, rounds: round };
      if (!set || set.seatsOver === undefined && false) break;
      // 막힌 자리 — 앞을 안 보고 지으면 막히는 머신
      const g = set && !set.seatsOver ? build3(N, set.lines, ruleDirs(set.lines), { look: 0, freeDirs: FREE }) : { why: set ? `머신 ${set.overAt}` : '' };
      const mm = /머신 (\d+)/.exec(g.why || ''); const stuck = mm ? Number(mm[1]) : /아래 끝/.test(g.why || '') ? N + 1 : 0;
      steps[steps.length - 1].stuck = stuck;
      // 걸친 머신 후보 — 막힌 머신에 가까운 차례
      const cand = [];
      for (const n of names) { const P = prefix(D[n]); xsOf[n].forEach((x, k) => { let m = 1; while (P[m] < x - EPS) m++; if (Math.abs(P[m] - x) > EPS) cand.push({ n, k, m, P }); }); }
      cand.sort((a, b) => Math.abs(a.m - stuck) - Math.abs(b.m - stuck) || a.m - b.m);
      let moved = false;
      for (const c of cand) {
        const key = `${c.n}${c.m}`; if (tried.has(key)) continue;
        for (const b of [c.P[c.m - 1], c.P[c.m]]) {
          const xs = xsOf[c.n].slice(0, c.k); const prev = c.k ? xs[c.k - 1] : 0;
          if (b <= prev + EPS || b - prev > C + EPS) continue;
          xs.push(b); xs.push(...pour(D[c.n], 0, false, b, false));   // 그 아래는 다시 부어 끊는다(줄 수는 늘지 않아야 한다)
          if (xs.length > xsOf[c.n].length) continue;
          xsOf = { ...xsOf, [c.n]: xs }; tried.add(key); moved = true; steps[steps.length - 1].move = `${c.n} 의 머신 ${c.m}`; break;
        }
        if (moved) break;
      }
      if (!moved) break;
    }
    return { ...fallback(), steps };
  }
  // 방법 4
  // 줄 수를 늘리지 않는 목록부터 · 없으면 한 품목에 한 줄 더 한 목록
  const tries = [Object.fromEntries(names.map((n) => [n, 0])), ...names.map((n) => Object.fromEntries(names.map((k) => [k, k === n ? 1 : 0])))];
  let size = 0;
  for (const extra of tries) {
    const lists = names.map((n) => allCuts(D[n], L0[n] + extra[n]).map((xs) => linesOfCuts(n, D[n], xs)).filter(Boolean));
    const combos = lists.reduce((acc, list) => acc.flatMap((a) => list.map((s) => [...a, s])), [[]]);
    const sets = combos.map((ps) => combine(N, ps)).filter((s) => s && !s.seatsOver).sort((a, b) => splitsOf(a) - splitsOf(b));
    size += sets.length;
    for (const set of sets) { const r = tryBuild(N, set); if (r.ok) return { ok: true, set, steps: [{ what: `목록 ${sets.length} 가지 가운데`, set, r }], listSize: sets.length }; }
  }
  return { ok: false, steps: [{ what: `목록 ${size} 가지 — 서는 것 없음` }], listSize: size };
}
function describe(set) {
  if (!set || !set.lines) return '(줄 없음)';
  return set.lines.map((L) => `${L.item}${L.a}-${L.b} ${L.amount.toFixed(1)}/s${L.small.length ? ` 작은 몫 머신 ${L.small}` : ''}${L.halfLane ? ' (레인 하나로 됨)' : ''}`).join(' · ');
}
module.exports = { method, describe, linesOfCuts, allCuts, fillFull, boundaryFirst, pour, total, prefix, C, LANE, EPS };

if (require.main === module) {
  if (process.argv[2] === '찾기') {
    const N = Number(process.argv[3] || 5), want = Number(process.argv[4] || 5);
    let seed = 7; const rnd = (n) => { seed = (seed * 1103515245 + 12345) % 2147483648; return Math.floor(seed / 65536) % n; };
    const tally = {}, examples = {}; let found = 0;
    for (let t = 0; t < Number(process.env.TRIES || 4000) && found < want; t++) {
      const D = { X: Array.from({ length: N }, () => 3 + rnd(8)), Y: Array.from({ length: N }, () => 2 + rnd(6)) };
      const L0 = Ls(D); if (L0.X < 3) continue;
      const r = [1, 2, 3, 4, 5].map((w) => method(D, w));
      const sig = r.map((x) => (x.ok ? (x.belts ? `+${x.belts}` : x.rounds ? `서기(${x.rounds}번 다시)` : '서기') : '안 섬')).join(' | ');
      const kind = r[0].steps[0].r && !r[0].steps[0].r.ok ? (/인서터 칸이 넷/.test(r[0].steps[0].r.why) ? ' [칸 수]' : ' [배열]') : '';
      tally[sig + kind] = (tally[sig + kind] || 0) + 1;
      if (!examples[sig + kind]) examples[sig + kind] = JSON.stringify(D);
      if (r[0].belts && r[1].belts && r[2].ok && !r[2].belts && r[3].ok && !r[3].belts) { found++; console.log(JSON.stringify(D), '→', sig); }
    }
    console.log(JSON.stringify(tally, null, 1));
    for (const [k, v] of Object.entries(examples)) console.log(`보기 ${k}: ${v}`);
  } else {
    const D = JSON.parse(process.argv[2]);
    for (const w of [1, 2, 3, 4, 5]) {
      const r = method(D, w);
      console.log(`\n방법 ${w}: ${r.ok ? `선다${r.belts ? ' — 벨트 한 줄 더' : ''}` : '안 선다'}`);
      for (const s of r.steps) console.log(`  · ${s.what}: ${describe(s.set)}\n      → ${s.r ? (s.r.ok ? '선다' : '안 선다 — ' + s.r.why) : ''}${s.stuck !== undefined ? ` · 앞을 안 보면 머신 ${s.stuck} 에서 막힘` : ''}${s.move ? ` · 옮김: ${s.move}` : ''}`);
    }
  }
}
