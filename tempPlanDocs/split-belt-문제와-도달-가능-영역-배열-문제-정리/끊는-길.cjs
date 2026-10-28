// U7 — 품목 하나 · 자식 하나 → 부모 하나. 끊는 자리 하나가 양 끝을 함께 끊는다(1판 §1.2 의 1 — 자식은 마지막만 덜 낸다. U10 은 아직 없다 · 정의 2판 §3.2). 견적서 S7 · U9.
//   node 끊는-길.cjs 판 <부모 N> <d> <p> [줄 수 L]   판 하나를 풀어 적는다(끊는 길마다 줄의 방향 · 걸친 머신)
//   node 끊는-길.cjs 훑기                              격자 전부를 세어 요약한다
//
// 끊는 길 — 줄 L 개의 끊는 자리 x(1) < … < x(L−1) 를 *자리의 꼴* 로 센다. 꼴 = 끊는 자리마다 (부모 쪽: 머신 경계 · 어느 머신 안의 어느 쪽)
// × (자식 쪽: 같음). 같은 꼴 안에서 x 를 얼마로 하든 줄의 모양(맡는 머신 · 걸친 머신 · 작은 몫이 어느 줄)은 같다.
// 지킨 것 — C2 줄마다 15/s 이하 · C3 작은 몫을 주고받는 줄의 하류 끝(양 끝 모두) · R18 한 머신은 두 줄까지 ·
//           C4 한 줄은 작은 몫을 많아야 한 번 준다 — **주는 편 · 받는 편을 합쳐 센다**(2026-10-08 후보 2). 2026-10-25 첫 판은 편마다 따로 셌다 — 틀렸다(내력).
//           정확히 반으로 걸치면 작은 몫이 없다(반반 가정 — flow-model §2.3).
//           U9=1 — 정확히 반이면 두 줄 가운데 하나를 작은 몫으로 센다(U9 정함 2026-10-27 — 반인 자리를 읽기 둘로 가르고, 이웃 꼴과 모양이 같으면 이어 붙인다).
//           기본은 아직 반반 가정이다 — 견적서 S7 · S11 이 그것으로 쟀다. 정의를 단계표로 다시 짤 때 기본으로 올리고 다시 잰다.
// 방향 — 걸친 머신이 위 줄에서 작은 몫이면 위 줄은 ↓(하류 끝이 아래), 아래 줄에서 작은 몫이면 아래 줄은 ↑. 부모 · 자식이 같은 꼴이다.
//        C4 를 합쳐 세면 한 줄은 많아야 한 편에서만 방향이 묶인다.
// 고름(opt) — parentOnly 자식 쪽을 안 본다 · pClean · cClean 그쪽에 걸친 머신 없음 ·
//             flowCut 자식과 부모를 한 자리에서 함께 가르는 끊기를 뺀다(U9 의 가) · noHalf 정확히 반으로 걸치는 끊기를 뺀다(U9 의 나)
'use strict';
const C = 15;          // 줄 상한(/s) — 벨트 30/s ÷ 2 (C2 · R16)
const K = 8;           // 격자 — 1/8 /s
const GRID = [1.5, 2, 2.5, 3, 4, 5, 6, 7.5, 9, 10, 12, 15]; // 머신 한 대의 양(/s) — 실제 레시피의 분포가 아니다
const U9 = process.env.U9 === '1';

function setup(N, d, p) {
  const ds = Math.round(d * K), ps = Math.round(p * K), Cs = C * K, Ts = N * ds;
  return { N, d, p, ds, ps, Cs, Ts, M: Math.ceil(Ts / ps) };
}
// x 가 그쪽 기둥에서 머신 경계인가, 어느 머신 안의 어느 쪽인가
function sideOf(x, unit, total) {
  const i = Math.floor(x / unit), r = x - i * unit;
  if (r === 0) return { b: true, i };
  const a = Math.min(unit, total - i * unit); // 자식의 마지막 머신은 덜 낸다(나머지는 쉰다 — C1)
  return { b: false, i, small: 2 * r < a ? 'up' : 2 * r > a ? 'down' : 'half' };
}
const keyOf = (s) => (s.b ? `B${s.i}` : `S${s.i}${s.small[0]}`);

// 꼴 목록 — 격자를 훑어 같은 꼴이 이어진 구간으로 묶는다
function classesOf(g, parentOnly) {
  const out = [];
  for (let x = 1; x < g.Ts; x++) {
    const P = sideOf(x, g.ds, g.Ts), Q = parentOnly ? null : sideOf(x, g.ps, g.Ts);
    const key = keyOf(P) + (Q ? '|' + keyOf(Q) : '');
    const last = out[out.length - 1];
    if (last && last.key === key) last.hi = x;
    else out.push({ key, lo: x, hi: x, P, Q });
  }
  if (!U9) return out;
  const halfAs = (s) => (s && !s.b && s.small === 'half' ? [{ ...s, small: 'up', half: true }, { ...s, small: 'down', half: true }] : [s]);
  const read = out.flatMap((c) => halfAs(c.P).flatMap((P) => halfAs(c.Q).map((Q) => ({ ...c, key: keyOf(P) + (Q ? '|' + keyOf(Q) : ''), P, Q }))));
  // 반을 한쪽으로 읽은 자리는 그쪽이 작은 몫인 이웃 구간과 모양이 같다 — 이어 붙여 한 꼴로 센다(2026-10-28 · 앞 판은 따로 세어 꼴을 부풀렸다).
  // 이웃이 없는 읽기(부모 · 자식이 한 자리에서 함께 반으로 걸쳐 서로 반대로 읽은 것)만 제 꼴로 남는다
  const byKey = new Map(), merged = [];
  for (const c of read) {
    const prev = byKey.get(c.key);
    if (prev && prev.hi + 1 >= c.lo) { prev.hi = Math.max(prev.hi, c.hi); if (prev.P.half && !c.P.half) prev.P = c.P; if (prev.Q && prev.Q.half && !c.Q.half) prev.Q = c.Q; continue; }
    const m = { ...c };
    byKey.set(c.key, m); merged.push(m);
  }
  return merged;
}
// 끊는 자리 a(위) 와 b(아래) 사이 줄의 방향 — 한쪽 기둥에서
function dirOf(topS, botS) {
  const up = topS && !topS.b && topS.small === 'down'; // 위 끝 머신이 이 줄에서 작은 몫 → 하류 끝이 위 → ↑
  const down = botS && !botS.b && botS.small === 'up';  // 아래 끝 머신이 이 줄에서 작은 몫 → ↓
  return up ? '↑' : down ? '↓' : '자유';
}
// 이 줄이 주는 작은 몫의 수 — 위 끝에서 걸친 머신(작은 몫이 아래 줄) · 아래 끝에서 걸친 머신(작은 몫이 위 줄), 두 편 모두
function smallsOn(top, bot) {
  const at = (s, side) => (s && !s.b && s.small === side ? 1 : 0);
  return at(top && top.P, 'down') + at(top && top.Q, 'down') + at(bot && bot.P, 'up') + at(bot && bot.Q, 'up');
}
const sameMachine = (a, b) => a && b && !a.b && !b.b && a.i === b.i; // 한 머신이 세 줄에 걸친다(R18)

// 끊는 길을 센다. opt 는 머리말의 고름 · collect(길을 모은다)
function count(g, L, opt = {}) {
  const half = (s) => s && !s.b && (s.small === 'half' || s.half);
  const cls = classesOf(g, opt.parentOnly).filter((c) =>
    (!opt.pClean || c.P.b) && (!opt.cClean || !c.Q || c.Q.b) &&
    (!opt.flowCut || !c.Q || c.P.b || c.Q.b) && (!opt.noHalf || (!half(c.P) && !half(c.Q))));
  const memo = new Map();
  const found = [];
  const lineOk = (top, bot) => {
    if (smallsOn(top, bot) > 1) return false;                                                  // C4
    if (top && bot && (sameMachine(top.P, bot.P) || sameMachine(top.Q, bot.Q))) return false; // R18
    return true;
  };
  const straddles = (c) => (c.P.b ? 0 : 1) + (c.Q && !c.Q.b ? 1 : 0);
  // 돌려주는 것: { n: 남은 길의 수, min: 남은 끊는 자리의 걸친 머신 수 최소 }
  function rec(k, ci, lo, hi, path) {
    const c = cls[ci];
    if (k === L - 1) {
      if (hi < g.Ts - g.Cs || !lineOk(c, null)) return { n: 0, min: Infinity };
      if (opt.collect && found.length < opt.collect) found.push([...path]);
      return { n: 1, min: straddles(c) };
    }
    const key = `${k}|${ci}|${lo}|${hi}`;
    if (!opt.collect && memo.has(key)) return memo.get(key);
    let n = 0, min = Infinity;
    for (let cj = 0; cj < cls.length; cj++) {
      const d = cls[cj], nlo = Math.max(d.lo, lo + 1), nhi = Math.min(d.hi, hi + g.Cs);
      if (nlo > nhi || !lineOk(c, d)) continue;
      const r = rec(k + 1, cj, nlo, nhi, opt.collect ? [...path, cj] : path);
      n += r.n; if (r.n) min = Math.min(min, r.min);
    }
    const res = { n, min: n ? min + straddles(c) : Infinity };
    if (!opt.collect) memo.set(key, res);
    return res;
  }
  if (L === 1) return { n: g.Ts <= g.Cs ? 1 : 0, min: 0, found, cls };
  let n = 0, min = Infinity;
  for (let ci = 0; ci < cls.length; ci++) {
    const c = cls[ci], lo = c.lo, hi = Math.min(c.hi, g.Cs);
    if (lo > hi || !lineOk(null, c)) continue;
    const r = rec(1, ci, lo, hi, [ci]);
    n += r.n; if (r.n) min = Math.min(min, r.min);
  }
  return { n, min, found, cls };
}
/** 줄 수 최소 — L0 부터 늘려 가며 길이 있는 첫 줄 수. `upTo` 줄 더까지 없으면 Infinity. */
function minLines(g, opt = {}, upTo = 4) {
  const L0 = Math.ceil(g.Ts / g.Cs);
  for (let L = L0; L <= L0 + upTo; L++) if (count(g, L, opt).n > 0) return L;
  return Infinity;
}

const fmt = (x) => String(x / K);
function describe(g, cls, path, L) {
  const cuts = path.map((ci) => cls[ci]);
  const lines = [];
  for (let k = 0; k < L; k++) {
    const top = k ? cuts[k - 1] : null, bot = k < L - 1 ? cuts[k] : null;
    lines.push(`줄${k + 1} 부모 ${dirOf(top && top.P, bot && bot.P)} · 자식 ${dirOf(top && top.Q, bot && bot.Q)}`);
  }
  const where = (s, name) => (s.b ? `${name} ${s.i}·${s.i + 1} 사이` : `${name} ${s.i + 1} 안(작은 몫 ${s.small === 'up' ? '위 줄' : s.small === 'down' ? '아래 줄' : '없음 — 반'})`);
  return cuts.map((c, k) => `  끊는 자리 ${k + 1}: ${fmt(c.lo)} ~ ${fmt(c.hi)} /s — ${where(c.P, '부모')} · ${where(c.Q, '자식')}`).join('\n') + '\n  ' + lines.join(' | ');
}

module.exports = { C, K, GRID, setup, count, minLines };

if (require.main === module) {
  const [mode, ...args] = process.argv.slice(2);
  console.log(`# 끊는-길.cjs — 줄 상한 ${C}/s · 격자 1/${K} /s · 머신 한 대의 양 격자 ${GRID.join(' · ')} · 한 머신은 두 줄까지 · 한 줄은 작은 몫을 두 편 합쳐 한 번까지 · ${U9 ? '정확히 반이면 두 줄 가운데 하나가 작은 몫(U9)' : '정확히 반이면 작은 몫 없음'}`);
  if (mode === '판') {
    const [N, d, p, Lx] = args.map(Number);
    const g = setup(N, d, p);
    const L0 = Math.ceil(g.Ts / g.Cs);
    console.log(`부모 ${N}대 × ${d}/s · 자식 ${g.M}대 × ${p}/s · 합 ${g.Ts / K}/s · 줄 수 최소 ${L0} (여유 ${(L0 * g.Cs - g.Ts) / K}/s)`);
    for (const L of Lx ? [Lx] : [L0, L0 + 1]) {
      const po = count(g, L, { parentOnly: true }), all = count(g, L, { collect: 40 });
      const pc = count(g, L, { pClean: true }), cc = count(g, L, { cClean: true }), both = count(g, L, { pClean: true, cClean: true });
      const fc = count(g, L, { flowCut: true }), nh = count(g, L, { noHalf: true });
      console.log(`\n줄 ${L}개 — 부모만 볼 때 ${po.n} 꼴 · 양 끝을 볼 때 ${all.n} 꼴(부모 쪽 걸침 없음 ${pc.n} · 자식 쪽 걸침 없음 ${cc.n} · 둘 다 ${both.n} · 흐름 경계에서만 ${fc.n} · 반반 없이 ${nh.n}) · 걸친 머신 최소 ${all.n ? all.min : '—'}`);
      all.found.forEach((path, i) => console.log(`길 ${i + 1}\n${describe(g, all.cls, path, L)}`));
    }
  } else if (mode === '훑기') {
    const s = { cfg: 0, slack0: 0, po: 0, two: 0, poNotTwo: 0, pc: 0, cc: 0, both: 0, pcNoBoth: 0, next: 0, none: 0 };
    const eg = [];
    for (const N of [2, 3, 4, 5, 6, 7, 8]) for (const d of GRID) for (const p of GRID) {
      const g = setup(N, d, p);
      if (g.M > 8 || g.Ts <= g.Cs) continue;
      s.cfg++;
      const L0 = Math.ceil(g.Ts / g.Cs);
      if (L0 * g.Cs === g.Ts) s.slack0++;
      const po = count(g, L0, { parentOnly: true }).n > 0, two = count(g, L0).n > 0;
      if (po) s.po++;
      if (two) s.two++;
      if (po && !two) { s.poNotTwo++; if (eg.length < 12) eg.push(`N${N} d${d} p${p}`); }
      if (two) {
        const pc = count(g, L0, { pClean: true }).n > 0, cc = count(g, L0, { cClean: true }).n > 0;
        const both = count(g, L0, { pClean: true, cClean: true }).n > 0;
        if (pc) s.pc++; if (cc) s.cc++; if (both) s.both++; if (pc && !both) s.pcNoBoth++;
      } else if (count(g, L0 + 1).n > 0) s.next++; else s.none++;
    }
    console.log(`판 ${s.cfg}(줄 수 최소에서 여유가 0 인 판 ${s.slack0})`);
    console.log(`줄 수 최소에서 — 부모만 볼 때 서는 판 ${s.po} · 양 끝을 볼 때 서는 판 ${s.two} · 부모만 보면 서는데 양 끝을 보면 안 서는 판 ${s.poNotTwo}`);
    console.log(`  양 끝으로 서는 ${s.two} 판 가운데: 부모 쪽 걸침 없는 길이 있다 ${s.pc} · 자식 쪽 걸침 없는 길 ${s.cc} · 둘 다 없는 길 ${s.both} · 부모 쪽은 깨끗한데 양 끝이 다 깨끗한 길은 없다 ${s.pcNoBoth}`);
    console.log(`  양 끝으로 안 서는 ${s.cfg - s.two} 판: 줄 하나 더면 선다 ${s.next} · 그래도 안 선다 ${s.none}`);
    console.log(`부모만 보면 서는데 양 끝으로 안 서는 판의 보기: ${eg.join(' · ')}`);
  } else {
    console.log('쓰는 법: node 끊는-길.cjs 판 <N> <d> <p> [L] | 훑기');
  }
}
