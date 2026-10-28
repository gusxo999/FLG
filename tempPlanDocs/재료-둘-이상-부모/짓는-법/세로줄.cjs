// 짓는 법 — 세로줄 하나(받는 쪽 · 팔 길이 1)를 위에서 아래로 한 번 지나가며 행마다 주인을 정한다(CLAUDE.md ㉨ · 출입구-차례 §6.10).
//   찾기가 없다: 행마다 *지역 판단 하나* 로 정하고 되돌리지 않는다. 잣대는 세로줄-전수.cjs 의 모델(모델.cjs) — 그 모델의 finalCheck 가
//   덩어리 · 이웃으로 새기 · 지하벨트 종류를 판정한다. 전수(찾기)는 이 판들을 *다 놓을 수 있다* 고 냈으므로, 짓는 법도 다 놓아야 한다.
//
//   node 세로줄.cjs 확정    품목마다 줄 둘까지 · 머신 2~8대(면 규칙 §4.4 의 980 판)
//   node 세로줄.cjs 찾기    품목마다 끊는 자리 둘까지(줄 셋까지) · 머신 2~6대(면 규칙 §4.4 의 4,456 + 짝 446 판)
//   node 세로줄.cjs 셋      품목 셋 — 셋째 품목은 두 대 이하의 짧은 줄(출입구-규칙 ⑤)
//   node 세로줄.cjs 보기 <판 번호>   못 지은 판 하나를 행마다
'use strict';
const M = require('./모델.cjs');
const { K, MAXD, linesOf, smallSides, finalCheck, picksPerMachine, subsets, ruleDirs } = M;
const MAXRANGE = Math.max(...Object.values(MAXD));
const HALF = Number(process.env.HALF ?? 10);  // 옆에서 붙인 입구(레인 하나)의 값
const STRADDLE = Number(process.env.STRADDLE ?? 0);  // 경계를 걸치는 줄의 덤
const MEMO = process.env.MEMO !== '0';           // 경계 상태가 같으면 앞보기 답을 다시 쓴다
const LOOK = isNaN(Number(process.env.LOOK ?? 'gmax')) ? (process.env.LOOK ?? 'gmax') : Number(process.env.LOOK);   // 앞을 몇 머신 보나(0 · 1)

// ── 짓는 법 ──────────────────────────────────────────────────────────────
// 줄 i 의 상태: 칸 목록 · 마지막 땅 위 행 · 열린 덩어리 길이 · 덩어리 수 · 머신마다 받은 칸 수.
// 행 r 에서 판단(위에서부터 차례로 보고, 처음 걸리는 하나로 정한다):
//   강제 1 — 열린 덩어리가 한 칸이고 그 줄이 아래에 더 지나야 하면: 가운데 덩어리는 두 칸 이상이어야 한다(위 덩어리라도 짝이면 두 칸).
//   강제 2 — 땅속으로 간 줄이 사거리 끝에 닿았고 아래에 더 지나야 하면: 지금 올라와야 한다.
//   강제 3 — 이 머신에서 받아야 할 칸 수가 남은 행 수와 같으면: 지금 가져야 한다.
//   고름 1 — 열린 덩어리가 한 칸이고 아래에 더 지나야 하는 줄(한 칸 덩어리를 피한다).
//   고름 2 — 이 머신에서 여유(남은 행 − 받을 칸)가 가장 적은 줄.
//   고름 3 — 줄 번호(품목 차례).
// 어느 판단이든 *물건이 이웃 줄로 새는데 막을 수 없는* 자리는 그 줄에 주지 않는다(새기 검사는 지역 — 바로 위 행만 본다).
function build(N, lines, dirs) {
  const nL = lines.length;
  const need = lines.map((L) => (L.kind === 'pair' ? 2 : 1));
  const mOf = (r) => (r >= 0 && r < 3 * N ? Math.floor(r / 3) + 1 : null);
  const lo = lines.map((L, i) => (dirs[i] === 'S' && L.a === 1 ? -K : 3 * (L.a - 1)));
  const hi = lines.map((L, i) => (dirs[i] === 'N' && L.b === N ? 3 * N - 1 + K : 3 * L.b - 1));
  const st = lines.map(() => ({ last: null, open: 0, chunks: 0, got: new Map(), mustExtend: false }));
  const owner = new Map();
  const gotIn = (i, m) => st[i].got.get(m) || 0;
  // r 아래(r 포함)에서 아직 받아야 할 칸이 있나
  const future = (i, r) => {
    const L = lines[i], m0 = mOf(r);
    for (let m = Math.max(L.a, m0 ?? (r < 0 ? 1 : N + 1)); m <= L.b; m++) if (gotIn(i, m) < need[i]) return true;
    return false;
  };
  // 줄 i 가 행 r 을 가지면 바로 위 행(r-1)과의 사이에서 물건이 새고 막을 수도 없나
  const leaks = (i, r) => {
    const a = owner.get(r - 1);
    if (a === undefined || a === i) return false;
    const di = dirs[i], da = dirs[a];
    if (di !== da) return false; // 서로 반대로 흐르면 마주 보거나 등진다
    if (da === 'S') {
      // a 가 r-1 에서 끝나고(아래에 더 없음) i 가 r 에서 처음 시작하면 a 의 끝이 i 의 첫 칸으로 민다
      if (future(a, r)) return false;                       // a 는 r-1 에서 땅속으로 든다(입구 — 안 민다)
      if (st[i].last !== null) return false;                 // i 는 땅속에서 나온다(출구 — 뒤에서 안 받는다)
      return st[a].open === 1 && st[a].chunks > 1;           // a 의 끝이 출구면 막을 수 없다(벨트면 막는 칸으로 바꾼다)
    }
    // 둘 다 위로 흐른다: i 의 맨 위 칸(r)이 i 의 끝 — r-1 의 a 가 아래에서 처음 시작하는 칸이면 i 의 끝이 a 로 민다
    if (st[i].last !== null) return false;                   // i 가 이미 위에 칸이 있다 — r 은 i 의 끝이 아니다
    if (future(a, r)) return false;                          // a 는 아래에서 땅속으로 올라온다(r-1 은 a 의 출구)
    return 'extend';                                         // i 의 끝이 벨트여야 막을 수 있다 — r+1 도 i 가 가져야 한다
  };
  const take = (i, r) => {
    const s = st[i];
    if (s.last === r - 1) s.open++; else { s.chunks++; s.open = 1; }
    s.last = r;
    const m = mOf(r);
    if (m !== null) s.got.set(m, gotIn(i, m) + 1);
    owner.set(r, i);
  };
  for (let r = -K; r <= 3 * N - 1 + K; r++) {
    const m = mOf(r);
    const rowsLeft = m === null ? 0 : 3 * m - r; // r 포함, 이 머신의 남은 행
    const cand = [];
    for (let i = 0; i < nL; i++) {
      if (r < lo[i] || r > hi[i]) continue;
      const lk = leaks(i, r);
      if (lk === true) continue;
      const s = st[i], L = lines[i];
      const fut = future(i, r);
      const needHere = m !== null && L.a <= m && m <= L.b ? need[i] - gotIn(i, m) : 0;
      const openOne = s.last === r - 1 && s.open === 1;
      const topChunk = s.chunks === 1;
      let forced = 0;
      // 강제 0 — 앞 행에서 끝을 벨트로 만들기로 한 줄
      if (s.mustExtend && s.last === r - 1) forced = 1;
      // 강제 1
      if (openOne && fut) {
        const middle = !topChunk;
        const pairFirst = topChunk && dirs[i] === 'S' && L.kind === 'pair';
        if (middle || pairFirst) forced = 1;
      }
      if (openOne && !fut && dirs[i] === 'N' && L.kind === 'pair' && s.chunks >= 1) forced = 1; // 위로 흐르는 짝의 첫 덩어리(맨 아래)
      // 강제 2
      if (!forced && s.last !== null && s.last < r - 1 && fut && r - s.last >= MAXRANGE) forced = 2;
      // 강제 3
      if (!forced && needHere > 0 && needHere >= rowsLeft) forced = 3;
      const wants = forced || needHere > 0 || (openOne && fut);
      if (!wants) continue;
      // 이 칸이 줄에게 무엇인가 — 잇기(바로 위가 제 칸) · 첫 덩어리 · 마지막 덩어리 · 가운데 덩어리(두 칸 이상이어야 해 다음 행도 든다)
      const extend = s.last === r - 1;
      const futAfter = (() => { const save = s.got.get(m); if (m !== null) s.got.set(m, (save || 0) + 1); const f = future(i, r); if (m !== null) { if (save === undefined) s.got.delete(m); else s.got.set(m, save); } return f; })();
      const kind = extend ? 0 : s.last === null ? 1 : futAfter ? 2 : 1;
      // 끝자리 — 줄이 위에서 처음 서는 칸(↓ 의 시작 · ↑ 의 끝)은 위로, 줄이 아래에서 마지막인 칸(↓ 의 끝 · ↑ 의 시작)은 아래로
      const term = s.last === null ? 0 : futAfter ? 1 : 2;
      cand.push({ i, forced, needHere, openOne: openOne && fut, kind, term, ext: lk === 'extend', slack: needHere > 0 ? rowsLeft - needHere : 99 });
    }
    if (!cand.length) continue;
    const forcedC = cand.filter((c) => c.forced);
    if (forcedC.length > 1) return { ok: false, why: `행 ${r}: 강제가 둘 — ${forcedC.map((c) => c.i).join(',')}`, owner };
    let pick = forcedC[0];
    if (!pick) {
      // 고름 — 이 머신의 남은 행이 받을 칸보다 많을 때만 한 칸 덩어리를 잇는 줄을 먼저 본다(남는 행이 없으면 받을 줄이 먼저)
      const needSum = cand.reduce((t, c) => t + c.needHere, 0);
      const spare = rowsLeft > needSum;
      cand.sort((p, q) => (spare ? q.openOne - p.openOne : 0) || (p.slack - q.slack) || (p.kind - q.kind) || (p.i - q.i));
      pick = cand[0];
    }
    take(pick.i, r);
    st[pick.i].mustExtend = !!pick.ext;
  }
  // 받아야 할 칸을 다 받았나
  for (let i = 0; i < nL; i++)
    for (let m = lines[i].a; m <= lines[i].b; m++)
      if (gotIn(i, m) < need[i]) return { ok: false, why: `줄 ${i} 이 머신 ${m} 에서 칸이 모자라다`, owner };
  return { ok: finalCheck(N, lines, dirs, owner), why: '잣대(finalCheck)가 거절', owner };
}

// ── 짓는 법 둘째 판 — 머신 한 대씩 ─────────────────────────────────────────
// 머신 하나의 세 행을 한 번에 정한다. 그 머신의 칸을 받아야 하는 줄들로 세 행을 채우는 배열을 정해진 차례로 늘어놓고, 게임 규칙에 걸리지
// 않는 것 가운데 값이 가장 작은 것을 고른다. 보는 것은 그 머신의 세 행과 바로 위 행뿐이고, 고른 것은 되돌리지 않는다.
// 게임 규칙(지역): 가운데 덩어리는 두 칸 이상 · 짝의 첫 덩어리는 두 칸 이상 · 땅속은 사거리 안 · 같은 방향 두 줄에서
//   *한 줄의 아래 끝 바로 아래에 다른 줄의 위 끝* 이 오면 물건이 샌다(↓ 는 끝 → 시작, ↑ 는 시작 → 끝) — 미는 쪽 끝이 벨트면 막는 칸으로 막는다.
// 값: 옆에서 붙인 입구(레인 하나) 10 · 칸을 하나 더 씀 3 · 받을 필요 없는 다음 머신 첫 행을 빼앗음 2 · 막는 칸 1.
let NAMES = null, TRACE = null;
const WORK = { n: 0, skips: 0, decisions: 0 };
function build2(N, lines, dirs, look = LOOK, trace = null) {
  NAMES = lines.map((L, i) => `${L.item}${L.a}-${L.b}${dirs[i] === 'S' ? '↓' : '↑'}`); TRACE = trace;
  const nL = lines.length;
  const need = lines.map((L) => (L.kind === 'pair' ? 2 : 1));
  const needIn = (i, m) => (lines[i].a <= m && m <= lines[i].b ? need[i] : 0);
  const futAfterM = (i, m) => lines[i].b > m;                 // 다음 머신부터 받을 칸이 있나
  const cells = lines.map(() => []);                          // 위에서부터 정한 행들
  const owner = new Map();
  const promised = new Map();                                 // 머신 번호 → 그 머신 첫 행을 가져야 하는 줄(앞 머신이 끝을 벨트로 본 줄)
  const memo = new Map();                                     // 경계 상태 → 앞보기 답
  const depthAt = (m) => {
    if (typeof look === 'number') return look;
    const act = lines.filter((L) => L.a <= m && m <= L.b);
    if (look === 'gmin') return Math.min(...act.map((L) => L.b - L.a + 1));
    if (look === 'gmax') return Math.max(...act.map((L) => L.b - L.a + 1));
    if (look === 'rmax') return Math.max(0, ...act.map((L) => L.b - m));       // 지나는 줄들이 앞으로 더 방문할 머신 수의 최댓값
    if (look === 'rmin') { const r = act.map((L) => L.b - m).filter((x) => x > 0); return r.length ? Math.min(...r) : 0; }
    if (look === 'event') {                                    // 다음에 줄이 끝나거나 시작하는 머신까지
      const d = [...lines.filter((L) => L.b > m).map((L) => L.b - m), ...lines.filter((L) => L.a > m).map((L) => L.a - m)];
      return d.length ? Math.min(...d) : 0;
    }
    throw new Error('look');
  };
  for (let m = 1; m <= N; m++) {
    const rej = TRACE ? [] : null;
    const ranked = arrangements(m, rej);
    if (TRACE) TRACE.push({ m, rejects: rej, ranked: ranked.map((c) => ({ arr: c.arr, sc: c.sc })) });
    // 앞을 한 머신 본다 — 다음 머신에 서는 배열이 하나라도 남는 것 가운데 값이 가장 작은 것
    let pick = null;
    for (const cand of ranked) {
      commit(m, cand.arr, cand.prom);
      const okNext = viable(m + 1, depthAt(m));
      uncommit(m, cand.arr);
      if (TRACE) TRACE.push({ m, arr: cand.arr, sc: cand.sc, okNext, look });
      if (okNext) { pick = cand; break; }
      WORK.skips++;
    }
    if (!pick) return { ok: false, why: `머신 ${m}: 서는 배열이 없다`, owner };
    WORK.decisions++;
    commit(m, pick.arr, pick.prom);
  }
  return { ok: finalCheck(N, lines, dirs, owner), why: '잣대(finalCheck)가 거절', owner };

  // 머신 m 부터 d 대 안에 서는 배열이 이어지나(앞을 d 대 본다)
  // 경계의 상태 — 머신 m 부터 뒤가 보는 것은 이것뿐이다(줄마다: 섰나 · 마지막 땅 위 칸이 경계에서 몇 행 위 · 끝 덩어리 길이 · 덩어리 수 · 첫 덩어리 길이,
  // 그리고 바로 위 행의 주인 · 다음 머신에 걸린 약속). 같은 상태에서 이미 본 답은 다시 안 본다(memo 는 build2 머리에).
  function boundaryKey(m, d) {
    const t = 3 * (m - 1);
    const per = cells.map((c) => {
      if (!c.length) return '-';
      let tail = 0; for (let k = c.length - 1; k >= 0 && c[k] === c[c.length - 1] - (c.length - 1 - k); k--) tail++;
      let chunks = 0, first = 0; for (let k = 0; k < c.length; k++) { if (k === 0 || c[k] !== c[k - 1] + 1) chunks++; if (chunks === 1) first++; }
      return [Math.min(t - c[c.length - 1], MAXRANGE + 1), Math.min(tail, 2), Math.min(chunks, 2), Math.min(first, 2)].join('.');
    });
    return `${m}|${d}|${owner.get(t - 1) ?? '-'}|${promised.get(m) ?? '-'}|${per.join(',')}`;
  }
  function viable(m, d) {
    if (m > N || d === 0) return true;
    const key = MEMO ? boundaryKey(m, d) : null;
    if (key && memo.has(key)) return memo.get(key);
    WORK.n++;
    let ok = false;
    for (const c of arrangements(m)) {
      commit(m, c.arr, c.prom);
      ok = viable(m + 1, d - 1);
      uncommit(m, c.arr);
      if (ok) break;
    }
    if (key) memo.set(key, ok);
    return ok;
  }
  function rowsOf(m) { const t = 3 * (m - 1); return [t, t + 1, t + 2]; }
  function commit(m, arr, prom) { const rows = rowsOf(m); arr.forEach((o, k) => { if (o >= 0) { owner.set(rows[k], o); cells[o].push(rows[k]); } }); if (prom !== undefined) promised.set(m + 1, prom); }
  function uncommit(m, arr) { const rows = rowsOf(m); arr.forEach((o, k) => { if (o >= 0) { owner.delete(rows[k]); cells[o].pop(); } }); promised.delete(m + 1); }
  // 머신 m 의 서는 배열을 값 차례로(같은 값이면 늘어놓은 차례)
  function arrangements(m, rec = null) {
    const rows = rowsOf(m), t = rows[0];
    const prevOwner = owner.get(t - 1);
    const mustCont = new Set();
    if (prevOwner !== undefined) {
      const c = cells[prevOwner];
      let len = 0; for (let k = c.length - 1; k >= 0 && c[k] === t - 1 - (c.length - 1 - k); k--) len++;
      let chunksBefore = 0; for (let k = 0; k < c.length; k++) if (k === 0 || c[k] !== c[k - 1] + 1) chunksBefore++;
      if (len === 1 && futAfterM(prevOwner, m - 1) && (chunksBefore > 1 || (lines[prevOwner].kind === 'pair' && dirs[prevOwner] === 'S'))) mustCont.add(prevOwner);
    }
    if (promised.has(m)) mustCont.add(promised.get(m));
    const pool = [];
    for (let i = 0; i < nL; i++) if (needIn(i, m) > 0 || mustCont.has(i)) pool.push(i);
    const opts = [-1, ...pool];
    const out = [];
    let seq = 0;
    for (const x of opts) for (const y of opts) for (const z of opts) {
      const arr = [x, y, z];
      if ([...mustCont].some((i) => arr[0] !== i)) continue;   // 이어 와야 하는 줄은 첫 행
      const prom = [], why = [];
      const sc = scoreArr(m, rows, arr, prom, why);
      if (sc !== null && prom.length <= 1) out.push({ sc, arr, prom: prom[0], seq: seq++ });
      else if (rec) rec.push({ arr, why: why[0] || '다음 머신에 약속이 둘' });
    }
    out.sort((p, q) => p.sc - q.sc || p.seq - q.seq);
    return out;
  }

  // 배열 하나의 값 — 게임 규칙에 걸리면 null
  function scoreArr(m, rows, arr, prom, why) {
    const no = (w) => { if (why) why.push(w); return null; };
    const nm = (i) => NAMES ? NAMES[i] : `줄 ${i}`;
    let sc = 0;
    const t = rows[0];
    const cnt = new Map();
    arr.forEach((o) => { if (o >= 0) cnt.set(o, (cnt.get(o) || 0) + 1); });
    for (let i = 0; i < nL; i++) {
      const n = cnt.get(i) || 0, nd = needIn(i, m);
      if (n < nd) return no(`${nm(i)} 가 이 머신에서 칸 ${nd} 이 필요한데 ${n}`);
      if (n > nd + 1) return no(`${nm(i)} 가 칸을 너무 많이 쓴다`);
      if (n > nd && nd > 0) sc += 3;
    }
    // 위에서 이어 와야만 하는 줄은 첫 행을 가져야 한다
    const prevOwner = owner.get(t - 1);
    // 줄마다 칸 목록(위 + 이 머신)
    const after = lines.map((_, i) => cells[i].concat(rows.filter((_, k) => arr[k] === i)));
    // 행 범위
    for (let k = 0; k < 3; k++) {
      const i = arr[k]; if (i < 0) continue;
      const L = lines[i], r = rows[k];
      if (r < 3 * (L.a - 1) || r > 3 * L.b - 1) return no(`${nm(i)} 는 이 머신에 설 수 없다(범위 밖)`);
    }
    for (let i = 0; i < nL; i++) {
      const c = after[i]; if (!c.length) continue;
      const fut = futAfterM(i, m);
      // 덩어리로 자른다(위에서부터)
      const ch = []; for (const r of c) { if (ch.length && ch[ch.length - 1].at(-1) === r - 1) ch[ch.length - 1].push(r); else ch.push([r]); }
      const lastRow = c[c.length - 1];
      const openAtBottom = lastRow === rows[2] && fut;          // 아래 머신으로 이어질 수 있다 — 아직 안 닫혔다
      for (let j = 0; j < ch.length; j++) {
        const closed = !(j === ch.length - 1 && openAtBottom);
        if (!closed) continue;
        const isTop = j === 0, isBottom = j === ch.length - 1 && !fut;
        const flowFirst = dirs[i] === 'S' ? isTop : isBottom;
        const flowLast = dirs[i] === 'S' ? isBottom : isTop;
        if (ch[j].length === 1 && !flowFirst && !flowLast) {
          // 가운데 덩어리 한 칸 — 단, 아직 아래가 정해지지 않은 맨 아래 덩어리는 위에서 처리
          return no(`${nm(i)} 의 가운데 덩어리가 한 칸(땅속 출구 다음에 바로 입구가 와야 하는데 칸이 하나뿐)`);
        }
        if (ch[j].length === 1 && flowFirst && !flowLast) {
          if (lines[i].kind === 'pair') return no(`${nm(i)} 는 짝이라 첫 덩어리가 두 칸이어야 한다`);
          if (ch[j][0] >= t) sc += HALF;                         // 옆에서 붙인 입구 — 레인 하나(이 머신에서 생긴 것만)
        }
      }
      // 땅속 사거리
      for (let k = 1; k < c.length; k++) if (c[k] - c[k - 1] > MAXRANGE) return no(`${nm(i)} 의 땅속이 사거리를 넘는다`);
      if (fut && 3 * m - lastRow > MAXRANGE) return no(`${nm(i)} 가 다음 머신까지 땅속으로 못 닿는다`);       // 다음 머신 첫 행까지 못 닿는다
      // 맨 아래 덩어리가 한 칸으로 열려 있고 가운데 덩어리가 될 것이면 다음 머신 첫 행을 가져야 한다
      if (openAtBottom) {
        const lastCh = ch[ch.length - 1];
        const willBeMiddle = ch.length > 1 || (dirs[i] === 'S' && lines[i].kind === 'pair');
        if (lastCh.length === 1 && willBeMiddle && needIn(i, m + 1) === 0) sc += 2;
      }
    }
    // 경계를 걸치는 줄을 반긴다 — 맨 아래 행의 줄이 다음 머신도 받아야 하면(걸칠 수 있다) · 첫 행의 줄이 바로 위 행에서 이어 오면
    if (STRADDLE) {
      const bot = arr[2], top = arr[0];
      // 걸쳐서 득을 보는 줄은 다음 머신 너머까지 가는 줄이다 — 그 덩어리가 가운데 덩어리라 두 칸이 있어야 한다. 곧 끝나는 줄은 한 칸 덩어리로 된다
      if (bot >= 0 && needIn(bot, m + 1) > 0 && futAfterM(bot, m + 1)) sc -= STRADDLE;
      if (top >= 0 && owner.get(t - 1) === top) sc -= STRADDLE;
    }
    // 새기 — (위 행, 이 머신 첫 행) · (첫, 둘째) · (둘째, 셋째)
    const ownAt = (r) => { const k = r - t; if (k >= 0 && k < 3) return arr[k] >= 0 ? arr[k] : undefined; return owner.get(r); };
    for (let r = t; r < t + 3; r++) {
      const A = ownAt(r - 1), B = ownAt(r);
      if (A === undefined || B === undefined || A === B || dirs[A] !== dirs[B]) continue;
      const cA = after[A], cB = after[B];
      const aBottom = !futAfterM(A, m) && cA[cA.length - 1] === r - 1;   // A 는 r-1 에서 아래로 더 없다
      const bTop = cB[0] === r;                                           // B 는 r 에서 위로 처음 선다
      if (!aBottom || !bTop) continue;
      // 미는 쪽: ↓ 면 A 의 끝(r-1), ↑ 면 B 의 끝(r). 그 끝이 벨트면(덩어리 두 칸 이상이거나 덩어리가 하나뿐) 막는 칸으로 막는다
      const pusher = dirs[A] === 'S' ? A : B, cp = after[pusher];
      const chP = []; for (const x of cp) { if (chP.length && chP[chP.length - 1].at(-1) === x - 1) chP[chP.length - 1].push(x); else chP.push([x]); }
      const endChunk = dirs[A] === 'S' ? chP[chP.length - 1] : chP[0];
      const pusherOpen = dirs[A] === 'N' && futAfterM(B, m) && cB[cB.length - 1] === t + 2; // ↑ 의 끝 덩어리가 아래로 이어질 수 있다
      const pusherMore = futAfterM(pusher, m) || cp[cp.length - 1] > endChunk[endChunk.length - 1]; // 미는 쪽 줄이 끝 덩어리 뒤에 칸이 더 있나
      const belt = endChunk.length >= 2 || (chP.length === 1 && !pusherMore) || pusherOpen;
      if (!belt) return no(`${nm(pusher)} 의 끝(땅속 출구)이 ${nm(pusher === A ? B : A)} 의 시작을 민다 — 물건이 섞이고 막을 수 없다`);
      if (!(endChunk.length >= 2 || (chP.length === 1 && !pusherMore)) && pusherOpen) prom.push(pusher); // 다음 머신 첫 행으로 이어 가야 벨트다
      sc += 1;
    }
    return sc;
  }
}

// ── 판 묶음 — 세로줄-전수.cjs 와 같은 범위 ─────────────────────────────────
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

// 판 하나 — 작은 몫의 모든 경우 · 품목 차례 둘(어느 품목이 먼저인가)에서 하나라도 지으면 선다고 본다
function runOne(N, items) {
  const orders = items.length === 2 && items[0].kind !== 'pair' ? [items, [items[1], items[0]]] : [items];
  let lastFail = null;
  for (const its of orders) {
    const lineSets = its.map((it) => linesOf(it, N));
    const sideLists = lineSets.map((ls) => [...smallSides(ls)]);
    const combos = sideLists.reduce((acc, list) => acc.flatMap((a) => list.map((s) => [...a, s])), [[]]);
    let allOk = true;
    for (const combo of combos) {
      const lines = [];
      lineSets.forEach((ls, k) => ls.forEach((L, i) => lines.push({ ...L, small: combo[k].get(i) || [] })));
      const dirs = ruleDirs(lines);
      const res = (process.env.BUILD === '1' ? build : build2)(N, lines, dirs);
      if (!res.ok) { allOk = false; lastFail = { N, lines, dirs, res }; break; }
    }
    if (allOk) return { ok: true };
  }
  return { ok: false, fail: lastFail };
}

function showFail(f) {
  const { N, lines, dirs, res } = f;
  const names = lines.map((L, i) => `${L.item}${L.a}-${L.b}${dirs[i] === 'S' ? '↓' : '↑'}${(L.small || []).length ? '(작은몫 ' + L.small + ')' : ''}`);
  const out = [`  ${names.join(' · ')} — ${res.why}`];
  for (let r = -K; r <= 3 * N - 1 + K; r++) {
    const m = r >= 0 && r < 3 * N ? Math.floor(r / 3) + 1 : ' ';
    const o = res.owner.get(r);
    out.push(`    행 ${String(r).padStart(3)} 머신 ${m}  ${o === undefined ? '.' : names[o]}`);
  }
  return out.join('\n');
}

module.exports = { build, build2, casesOf, runOne, arrangementsTrace: null };
if (require.main === module) {
const MODE = process.argv[2] || '확정';
const t0 = Date.now();
if (MODE === '보기') {
  const [mode, idx] = [process.argv[3] || '확정', Number(process.argv[4] || 0)];
  const fails = casesOf(mode).map(([N, items]) => runOne(N, items)).filter((r) => !r.ok);
  console.log(showFail(fails[idx].fail));
  process.exit(0);
}
const cases = casesOf(MODE);
const byN = new Map();
const fails = [];
let maxWork = 0;
for (const [N, items] of cases) {
  const w0 = WORK.n;
  const r = runOne(N, items);
  maxWork = Math.max(maxWork, WORK.n - w0);
  const t = byN.get(N) || [0, 0]; t[1]++; if (r.ok) t[0]++; byN.set(N, t);
  if (!r.ok) fails.push(r.fail);
}
for (const [N, [ok, tot]] of byN) console.log(`  머신 ${N}대: ${ok}/${tot}`);
console.log(`  합 ${cases.length - fails.length}/${cases.length} · ${((Date.now() - t0) / 1000).toFixed(1)}초 · 앞보기로 본 머신 ${WORK.n}(판 하나에 많아야 ${maxWork}) · 머신마다 고른 횟수 ${WORK.decisions} 가운데 값이 가장 작은 배열을 앞보기가 건너뛴 횟수 ${WORK.skips}`);
const why = new Map();
for (const f of fails) { const k = f.res.why.replace(/\d+/g, '#'); why.set(k, (why.get(k) || 0) + 1); }
for (const [k, v] of why) console.log(`    못 지은 까닭: ${k} — ${v}`);
for (const f of fails.slice(0, Number(process.env.SHOW ?? 2))) console.log(showFail(f));
if (process.env.DUMP) require('fs').writeFileSync(process.env.DUMP, JSON.stringify(fails.map((f) => ({ N: f.N, lines: f.lines, dirs: f.dirs }))));

}
