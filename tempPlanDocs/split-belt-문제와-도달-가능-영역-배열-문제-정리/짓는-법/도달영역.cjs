// 도달 가능 영역 배열 고르기 — 셋째 판(2026-10-22). 2026-10-25 에 `../../재료-둘-이상-부모/짓는-법/도달영역.cjs`(기록)를 옮겨 와 옆 입구에 C8 을 넣었다.
//   줄마다 `otherDir`(다른 모듈 면의 방향) — 옆 입구는 이 면의 방향이 그것과 같을 때만(모델.cjs sideLoadWhy). 결과의 `sideLoaded` 는 옆 입구를 쓴 줄과 그 방향.
//   SIDELOAD=0 이면 옆 입구를 아예 안 쓴다(견줌용 — 옛 FULLLANE).
//   머신 0(기둥 위 끝 너머 세 행) · 머신 1..N · 머신 N+1(기둥 아래 끝 너머 세 행)을 위에서부터 한 대씩 짓는다.
//   새 후보 — 줄이 제 머신 범위보다 *흐름이 오는 쪽* 에서 들어올 수 있다:
//     ↓ 줄은 제 첫 머신보다 위(위 머신의 행 · 기둥 위 끝 너머)에서 시작해 땅속으로 제 범위에 닿는다.
//     ↑ 줄은 제 마지막 머신에서 시작하지 않고 *아래로 이어 간다* 고 정한 뒤(미룸), 아래 머신의 행 · 기둥 아래 끝 너머에서 시작한다.
//     범위 밖 칸에는 인서터를 두지 않는다(그 머신은 그 줄에서 안 집는다). 값 5.
//   나머지(거르기 → 값 → 앞보기)는 세로줄.cjs 와 같다.
//
//   node 도달영역.cjs 확정|찾기|셋        잣대와 견준다(세로줄.cjs 의 판 묶음)
'use strict';
const { K, MAXD, finalCheck, assignTypes, linesOf, smallSides, ruleDirs, sideLoadWhy, sideLoadedLines } = require('./모델.cjs');
const MAXRANGE = Math.max(...Object.values(MAXD));
const SIZE = process.env.VALUE === 'size';   // 값을 크기의 잣대(규칙 8)로만 — 기둥 끝 너머로 늘어난 행만 센다
const NOSIDE = process.env.SIDELOAD === '0';   // 옆 입구를 아예 안 쓴다(견줌용)
const HALF = SIZE ? 0 : Number(process.env.HALF ?? 10), EXTRA = SIZE ? 0 : 3, OUTSIDE = SIZE ? 0 : 5, BLOCK = SIZE ? 0 : 1;
const LOOK = process.env.LOOK ?? 99;   // 정한 것(사용자 2026-10-22): 끝까지 — 남은 단위 전부를 채울 길이 있나를 경계 상태마다 한 번 센다(옛 정함 2026-10-21 방문 수 최댓값 · `gext` 는 비교용)
const WORK = { looks: 0, decisions: 0, skips: 0 };

// 지금까지 정한 칸에서 닫힌 땅속(입구와 출구가 다 정해진 것)과 막는 칸으로 지하벨트 종류를 나눌 수 있나 — 열린 땅속은 아직 안 본다
function typableWith(lines, dirs, after, fut) {
  const segs = [], ends = [], role = new Map();
  lines.forEach((L, i) => {
    const rows = after[i]; if (!rows.length) return;
    const flow = dirs[i] === 'S' ? rows : rows.slice().reverse(), step = dirs[i] === 'S' ? 1 : -1;
    const ch = []; for (const r of flow) { if (ch.length && ch[ch.length - 1].at(-1) + step === r) ch[ch.length - 1].push(r); else ch.push([r]); }
    // ↑ 줄이 아래로 이어 가면 맨 아래 덩어리는 흐름의 첫 덩어리가 아니다 — 그 앞의 땅속은 아직 열렸다
    const openBefore = dirs[i] === 'N' && fut(i);
    const openAfter = dirs[i] === 'S' && fut(i);
    ch.forEach((c, j) => {
      c.forEach((r) => role.set(r, { i, kind: 'belt' }));
      if (j > 0 || openBefore) role.get(c[0]).kind = 'exit';
      if (j < ch.length - 1 || openAfter) role.get(c.at(-1)).kind = 'entrance';
      if (j < ch.length - 1) segs.push({ from: c.at(-1), to: ch[j + 1][0], dir: dirs[i], line: i });
    });
    if (!fut(i)) ends[i] = flow.at(-1);
    // 주는 줄의 흐름 끝 칸은 옆으로 나간다(↑ 은 맨 위 칸 — 늘 정해졌다 · ↓ 은 끝났을 때 맨 아래 칸)
    if (L.give) { if (dirs[i] === 'N') role.get(rows[0]).kind = 'side'; else if (!fut(i)) role.get(flow.at(-1)).kind = 'side'; }
  });
  const blockers = [];
  const outs = (c) => c.kind === 'belt' || c.kind === 'exit', acc = (c) => c.kind === 'belt' || c.kind === 'entrance' || c.kind === 'blocker';
  for (const [r, A] of [...role].sort((a, b) => a[0] - b[0])) {
    const B = role.get(r + 1); if (!B || B.i === A.i) continue;
    if (B.kind === 'side' && dirs[A.i] === 'S' && outs(A) && ends[A.i] === r && A.kind === 'belt') { A.kind = 'blocker'; blockers.push({ at: r, dir: 'S' }); continue; }
    if (A.kind === 'side' && dirs[B.i] === 'N' && outs(B) && ends[B.i] === r + 1 && B.kind === 'belt') { B.kind = 'blocker'; blockers.push({ at: r + 1, dir: 'N' }); continue; }
    if (dirs[A.i] === 'S' && outs(A) && dirs[B.i] === 'S' && acc(B) && ends[A.i] === r && A.kind === 'belt') { A.kind = 'blocker'; blockers.push({ at: r, dir: 'S' }); }
    if (dirs[B.i] === 'N' && outs(B) && dirs[A.i] === 'N' && acc(A) && ends[B.i] === r + 1 && B.kind === 'belt') { B.kind = 'blocker'; blockers.push({ at: r + 1, dir: 'N' }); }
  }
  return assignTypes(segs, blockers, lines);
}

// 짓는 단위 — 기둥 위 끝 너머 세 행 · 머신 · 머신 사이 틈의 행 · 기둥 아래 끝 너머 세 행. geom.top[m] = 머신 m 의 첫 행, geom.blocked = 쓸 수 없는 행.
function unitsOf(N, geom) {
  const top = (m) => (geom ? geom.top[m] : 3 * (m - 1));
  const us = [{ rows: [top(1) - 3, top(1) - 2, top(1) - 1], m: null, mBefore: 0, kind: '위 끝 너머' }];
  for (let m = 1; m <= N; m++) {
    us.push({ rows: [top(m), top(m) + 1, top(m) + 2], m, mBefore: m, kind: `머신 ${m}` });
    if (m < N && top(m + 1) > top(m) + 3) {
      const rows = []; for (let r = top(m) + 3; r < top(m + 1); r++) rows.push(r);
      us.push({ rows, m: null, mBefore: m, kind: `틈 ${m}|${m + 1}` });
    }
  }
  const bot = top(N) + 2;
  us.push({ rows: [bot + 1, bot + 2, bot + 3], m: null, mBefore: N, kind: '아래 끝 너머' });
  return { us, top, bottom: (m) => top(m) + 2 };
}

function build3(N, lines, dirs0, opts = {}) {
  // opts.freeDirs: 작은 몫이 없는 줄(방향이 자유)의 방향을 짓는 법이 고른다 — 그 줄이 처음 칸을 갖는 단위에서(↓ · ↑ 둘 다 늘어놓는다)
  const dirs = dirs0.slice();
  const undecided = new Set(opts.freeDirs ? lines.map((_, i) => i).filter((i) => !(lines[i].small || []).length) : []);
  const typableSoFar = (after, fut) => typableWith(lines, dirs, after, fut);
  // opts.order: 줄 번호를 벽 위에서 아래로 늘어놓은 것(링크 단계의 목표 차례) · opts.gap: 두 행 이상 떨어져야 하는 쌍 · opts.geom: 틈 · 막힌 행
  const ORDER = opts.order ? { on: opts.order, gap: opts.gap || [] } : null;
  const look = opts.look ?? LOOK, trace = opts.trace ?? null;
  const { us, top, bottom } = unitsOf(N, opts.geom);
  const blocked = (opts.geom && opts.geom.blocked) || new Set();
  const U = us.length;
  const unitOfMachine = new Map(); us.forEach((x, u) => { if (x.m) unitOfMachine.set(x.m, u); });
  const nL = lines.length;
  const names = new Proxy([], { get: (_, k) => (k === 'join' ? (sep) => lines.map((L, i) => names[i]).join(sep) : (typeof k === 'string' && /^\d+$/.test(k)) ? `${lines[+k].item}${lines[+k].a}-${lines[+k].b}${undecided.has(+k) ? '?' : dirs[+k] === 'S' ? '↓' : '↑'}` : undefined) });
  const need = lines.map((L) => (L.kind === 'pair' ? 2 : 1));
  const needIn = (i, u) => { const m = us[u].m; return m && lines[i].a <= m && m <= lines[i].b ? need[i] : 0; };
  const cells = lines.map(() => []);
  const owner = new Map();
  const promised = new Map();
  let deferred = new Set();                 // 제 마지막 머신 아래로 이어 가는 ↑ 줄(아직 시작 칸을 못 놓았다)
  const memo = new Map();
  // ↓ 줄이 제 첫 머신보다 위에서 들어올 수 있나 — 아직 안 섰고, 땅속 한 번으로 제 범위에 닿는 거리
  const earlyOK = (i, u) => (dirs[i] === 'S' || undecided.has(i)) && !cells[i].length && lines[i].a > us[u].mBefore && top(lines[i].a) - us[u].rows[0] <= MAXRANGE + 2;
  // 앞보기 거리(단위 수) — 지나는 줄이 실제로 닿을 수 있는 끝까지: ↓ 줄은 제 끝 머신, ↑ 줄은 아래로 미룰 수 있으니 기둥 아래 끝 너머까지
  const gext = (u) => {
    let d = 1;
    const mb = us[u].mBefore;
    lines.forEach((L, i) => {
      const early = (dirs[i] === 'S' || undecided.has(i)) && L.a > mb && (cells[i].length > 0 || earlyOK(i, u));
      const passing = (L.a <= mb && mb <= L.b) || deferred.has(i) || early;
      if (passing) d = Math.max(d, (dirs[i] === 'S' && !undecided.has(i) ? unitOfMachine.get(L.b) : U - 1) - u);
    });
    return d;
  };
  const depthAt = (u) => (typeof look === 'number' ? look : look === 'gext' ? gext(u) : Number(look));

  for (let u = 0; u < U; u++) {
    let ranked = arrangements(u, trace ? [] : null);
    if (u === 0 && opts.forceTop) ranked = ranked.filter((c) => c.arr.every((o, k) => o === opts.forceTop[k]));   // 보기용 — 위 끝 너머 배열을 못 박는다
    if (opts.force && opts.force[u]) ranked = ranked.filter((c) => JSON.stringify(c.arr) === JSON.stringify(opts.force[u].arr) && JSON.stringify([...c.D].sort()) === JSON.stringify([...opts.force[u].D].sort()));   // 풀이 보기용 — 앞 단위의 고름을 못 박는다
    let pick = null;
    for (const c of ranked) {
      const save = commit(u, c);
      const ok = viable(u + 1, depthAt(u));
      uncommit(u, c, save);
      if (trace) trace.push({ u, kind: us[u].kind, arr: c.arr, D: [...c.D], sc: c.sc, ok });
      if (ok) { pick = c; break; }
      WORK.skips++;
    }
    if (!pick) return { ok: false, why: `${us[u].kind}: 서는 배열이 없다`, owner, names: lines.map((_, i) => names[i]), dirs: dirs.slice(), sideLoaded: [] };
    WORK.decisions++;
    commit(u, pick);
  }
  return { ok: finalCheck(N, lines, dirs, owner), why: '잣대(finalCheck)가 거절', owner, names: lines.map((_, i) => names[i]), dirs: dirs.slice(), sideLoaded: sideLoadedLines(lines, dirs, owner) };

  function commit(u, c) {
    const rows = us[u].rows;
    c.arr.forEach((o, k) => { if (o >= 0) { owner.set(rows[k], o); cells[o].push(rows[k]); } });
    const save = { deferred, prom: promised.get(u + 1), decided: [] };
    for (const [i, d] of c.dirSet || []) { save.decided.push([i, dirs[i]]); dirs[i] = d; undecided.delete(i); }
    deferred = c.D;
    if (c.prom !== undefined) promised.set(u + 1, c.prom); else promised.delete(u + 1);
    return save;
  }
  function uncommit(u, c, save) {
    const rows = us[u].rows;
    c.arr.forEach((o, k) => { if (o >= 0) { owner.delete(rows[k]); cells[o].pop(); } });
    for (const [i, d] of save.decided) { dirs[i] = d; undecided.add(i); }
    deferred = save.deferred;
    if (save.prom !== undefined) promised.set(u + 1, save.prom); else promised.delete(u + 1);
  }
  function key(u, d) {
    const t = us[u].rows[0];
    const per = cells.map((c) => {
      if (!c.length) return '-';
      let tail = 0; for (let k = c.length - 1; k >= 0 && c[k] === c[c.length - 1] - (c.length - 1 - k); k--) tail++;
      let chunks = 0, first = 0; for (let k = 0; k < c.length; k++) { if (k === 0 || c[k] !== c[k - 1] + 1) chunks++; if (chunks === 1) first++; }
      return [Math.min(t - c[c.length - 1], MAXRANGE + 1), Math.min(tail, 2), Math.min(chunks, 2), Math.min(first, 2)].join('.');
    });
    const near = []; for (let r = t - MAXRANGE - 1; r < t; r++) near.push(owner.get(r) ?? '.');
    // 끝까지 닿는 앞보기는 남은 거리와 상관없이 답이 같다 — 거리를 '끝' 으로 적어 경계 상태마다 한 번만 센다
    return `${u}|${u + d >= U ? '끝' : d}|${promised.get(u) ?? '-'}|${[...deferred].sort().join('.')}|${per.join(',')}|${near.join('')}|${lines.map((_, i) => (undecided.has(i) ? '?' : dirs[i])).join('')}`;
  }
  function viable(u, d) {
    if (u >= U) return finalCheck(N, lines, dirs, owner);       // 끝까지 닿았다 — 지하벨트 종류까지 다 본다
    if (d <= 0) return true;
    const k = key(u, d);
    if (memo.has(k)) return memo.get(k);
    WORK.looks++;
    let ok = false;
    for (const c of arrangements(u)) {
      const save = commit(u, c);
      ok = viable(u + 1, d - 1);
      uncommit(u, c, save);
      if (ok) break;
    }
    memo.set(k, ok);
    return ok;
  }

  // 단위 u 의 서는 배열(값 차례). rec 를 주면 빠진 배열과 까닭을 적는다.
  function arrangements(u, rec = null) {
    const unit = us[u], rows = unit.rows, t = rows[0];
    const must = new Set();
    const p = owner.get(t - 1);
    if (p !== undefined && u > 0) {
      const c = cells[p];
      let len = 0; for (let k = c.length - 1; k >= 0 && c[k] === t - 1 - (c.length - 1 - k); k--) len++;
      let chunks = 0; for (let k = 0; k < c.length; k++) if (k === 0 || c[k] !== c[k - 1] + 1) chunks++;
      const futP = lines[p].b > us[u - 1].mBefore || deferred.has(p);
      if (len === 1 && futP && (chunks > 1 || (lines[p].kind === 'pair' && dirs[p] === 'S'))) must.add(p);
    }
    if (promised.has(u)) must.add(promised.get(u));
    if (must.size > 1) return [];
    const pool = new Set();
    for (let i = 0; i < nL; i++) {
      const L = lines[i];
      if (needIn(i, u) > 0 || must.has(i) || deferred.has(i)) pool.add(i);
      if (earlyOK(i, u)) pool.add(i);
      if (dirs[i] === 'S' && cells[i].length && L.a > (unit.m || unit.mBefore + 1)) pool.add(i); // 일찍 선 ↓ 줄은 제 범위에 닿기 전까지 계속 후보(첫 덩어리를 늘리거나 땅 위로 지난다)
      if (!unit.m && L.a <= unit.mBefore && unit.mBefore < L.b && cells[i].length) pool.add(i); // 틈을 지나는 줄이 틈의 행에 서기
    }
    const poolA = [...pool];
    const opts = [-1, ...poolA];
    // 미룰 수 있는 ↑ 줄 — 제 마지막 머신이거나 이미 미룬 줄(기둥 아래 끝 너머에서는 더 못 미룬다)
    const elig = u < U - 1 ? poolA.filter((i) => !undecided.has(i) && dirs[i] === 'N' && (lines[i].b === unit.m || deferred.has(i))) : [];
    const out = [];
    let seq = 0;
    const arr = new Array(rows.length).fill(-1);
    const fill = (k) => {
      if (k === rows.length) {
        if (must.size && arr[0] !== [...must][0]) return;
        const fresh = [...new Set(arr.filter((o) => o >= 0 && undecided.has(o)))];   // 이 단위에서 처음 서는 방향 자유 줄
        for (let dm = 0; dm < 1 << fresh.length; dm++) {
          const dirSet = fresh.map((i, q) => [i, dm >> q & 1 ? 'N' : 'S']);
          const keep = dirSet.map(([i]) => [i, dirs[i]]);
          for (const [i, d] of dirSet) { dirs[i] = d; undecided.delete(i); }
          const eligD = u < U - 1 ? [...elig, ...fresh.filter((i) => dirs[i] === 'N' && lines[i].b === unit.m)] : [];
          for (let mask = 0; mask < 1 << eligD.length; mask++) {
            const D = new Set();
            eligD.forEach((i, q) => { if (mask >> q & 1) D.add(i); });
            let bad = false;
            for (const i of deferred) if (!arr.includes(i) && !D.has(i)) bad = true;   // 미룬 줄이 칸을 안 가지면 계속 미룬다
            if (bad) continue;
            const prom = [], why = [];
            const sc = score(u, rows, arr, D, prom, why);
            if (sc !== null && prom.length <= 1) out.push({ arr: arr.slice(), D, dirSet, prom: prom[0], sc, seq: seq++ });
            else if (rec) rec.push({ arr: arr.slice(), D: [...D], why: why[0] || '다음 단위에 약속이 둘' });
          }
          for (const [i, d] of keep) { dirs[i] = d; undecided.add(i); }
        }
        return;
      }
      for (const o of blocked.has(rows[k]) ? [-1] : opts) { arr[k] = o; fill(k + 1); }
      arr[k] = -1;
    };
    fill(0);
    out.sort((a, b) => a.sc - b.sc || a.seq - b.seq);
    if (rec && trace) trace.push({ u, kind: unit.kind, rejects: rec, ranked: out.map((c) => ({ arr: c.arr, D: [...c.D], sc: c.sc })) });
    return out;
  }

  function score(u, rows, arr, D, prom, why) {
    const no = (w) => { why.push(w); return null; };
    const unit = us[u], t = rows[0], last = rows[rows.length - 1];
    const fut = (i) => lines[i].b > unit.mBefore || D.has(i);
    let sc = 0;
    const cnt = new Map();
    arr.forEach((o) => { if (o >= 0) cnt.set(o, (cnt.get(o) || 0) + 1); });
    const noSeat = (opts.geom && opts.geom.noSeat) || null;
    const cntSeat = new Map();
    arr.forEach((o, k) => { if (o >= 0 && !(noSeat && noSeat.has(rows[k]))) cntSeat.set(o, (cntSeat.get(o) || 0) + 1); });
    for (let i = 0; i < nL; i++) {
      const n = cnt.get(i) || 0, nd = needIn(i, u);
      if (nd > 0 && (cntSeat.get(i) || 0) < nd) return no(`${names[i]} 가 ${unit.kind} 에서 인서터가 설 칸을 ${nd} 개 못 받는다`);
      if (n < nd) return no(`${names[i]} 가 ${unit.kind} 에서 칸 ${nd} 이 필요한데 ${n}`);
      if (nd > 0 && n > nd + 1) return no(`${names[i]} 가 칸을 너무 많이 쓴다`);
      if (nd === 0 && unit.m && n > 2) return no(`${names[i]} 가 범위 밖에서 칸을 너무 많이 쓴다`);
      if (nd > 0 && n > nd) sc += EXTRA;
    }
    for (let k = 0; k < rows.length; k++) {
      const i = arr[k]; if (i < 0) continue;
      const L = lines[i], r = rows[k];
      if (dirs[i] === 'S') {
        if (r > bottom(L.b)) return no(`${names[i]} 는 제 끝 머신 아래에 못 선다`);
        if (r < top(L.a)) sc += OUTSIDE;                         // 위에서 들어오는 길
      } else {
        if (r < top(L.a)) return no(`${names[i]} 는 제 끝 머신 위에 못 선다`);
        if (r > bottom(L.b)) { if (!deferred.has(i)) return no(`${names[i]} 는 미루지 않았다`); sc += OUTSIDE; }
      }
    }
    if (SIZE && (u === 0 || u === U - 1)) {                      // 기둥 끝 너머로 늘어난 행 수(규칙 8 의 둘째 잣대)
      const used = rows.filter((_, k) => arr[k] >= 0);
      if (used.length) sc += u === 0 ? top(1) - Math.min(...used) : Math.max(...used) - bottom(N);
    }
    const after = lines.map((_, i) => cells[i].concat(rows.filter((_, k) => arr[k] === i)));
    for (let i = 0; i < nL; i++) {
      const c = after[i]; if (!c.length) continue;
      const f = fut(i);
      const ch = []; for (const r of c) { if (ch.length && ch[ch.length - 1].at(-1) === r - 1) ch[ch.length - 1].push(r); else ch.push([r]); }
      const lastRow = c[c.length - 1];
      const openAtBottom = lastRow === last && f;
      for (let j = 0; j < ch.length; j++) {
        if (j === ch.length - 1 && openAtBottom) continue;
        if (ch[j].at(-1) < t - 1) continue;                     // 앞 단위에서 이미 본 덩어리
        const isTop = j === 0, isBottom = j === ch.length - 1 && !f;
        const flowFirst = dirs[i] === 'S' ? isTop : isBottom, flowLast = dirs[i] === 'S' ? isBottom : isTop;
        if (ch[j].length === 1 && !flowFirst && !flowLast) return no(`${names[i]} 의 가운데 덩어리가 한 칸`);
        if (lines[i].give && flowLast && ch[j].length === 1 && (ch.length > 1 || (dirs[i] === 'N' && f))) return no(`${names[i]} 는 주는 줄이라 끝 칸에서 옆으로 꺾여 나가야 하는데 그 칸이 땅속 출구다`);
        if (ch[j].length === 1 && flowFirst && !flowLast && !lines[i].give) {
          if (lines[i].kind === 'pair') return no(`${names[i]} 는 짝이라 첫 덩어리가 두 칸이어야 한다`);
          const why = NOSIDE ? '옆 입구를 안 쓰는 셈' : sideLoadWhy(lines[i], dirs[i]);
          if (why) return no(`${names[i]} 의 첫 덩어리가 한 칸(옆 입구)인데 ${why}`);
          if (ch[j][0] >= t) sc += HALF;
        }
      }
      for (let k = 1; k < c.length; k++) if (c[k] - c[k - 1] > MAXRANGE) return no(`${names[i]} 의 땅속이 사거리를 넘는다`);
      if (f && last + 1 - lastRow > MAXRANGE) return no(`${names[i]} 가 다음 단위까지 땅속으로 못 닿는다`);
    }
    const own = (r) => { const k = r - t; if (k >= 0 && k < rows.length) return arr[k] >= 0 ? arr[k] : undefined; return owner.get(r); };
    const giveEnd = (i, r) => lines[i].give && (dirs[i] === 'S' ? !fut(i) && after[i][after[i].length - 1] === r : after[i][0] === r);
    for (let r = t; r <= last; r++) {
      const A = own(r - 1), B = own(r);
      if (A === undefined || B === undefined || A === B) continue;
      const cA = after[A], cB = after[B];
      // 옆으로 나가는 주는 줄의 끝 칸은 위 · 아래 어느 줄의 끝이 밀어도 옆에서 받는다
      const sidePush = (dirs[A] === 'S' && !fut(A) && cA[cA.length - 1] === r - 1 && !giveEnd(A, r - 1) && giveEnd(B, r)) ? A
        : (dirs[B] === 'N' && cB[0] === r && !giveEnd(B, r) && giveEnd(A, r - 1)) ? B : null;
      if (sidePush === null && dirs[A] !== dirs[B]) continue;
      const aBottom = !fut(A) && cA[cA.length - 1] === r - 1;
      const bTop = cB[0] === r;
      if (sidePush === null && (!aBottom || !bTop)) continue;
      const pusher = sidePush !== null ? sidePush : dirs[A] === 'S' ? A : B, cp = after[pusher];
      if (giveEnd(pusher, pusher === A ? r - 1 : r)) continue;   // 주는 줄의 끝은 옆으로 나간다 — 안 민다
      const chP = []; for (const x of cp) { if (chP.length && chP[chP.length - 1].at(-1) === x - 1) chP[chP.length - 1].push(x); else chP.push([x]); }
      const endChunk = dirs[pusher] === 'S' ? chP[chP.length - 1] : chP[0];
      const pusherMore = fut(pusher) || cp[cp.length - 1] > endChunk[endChunk.length - 1];
      const pusherOpen = dirs[pusher] === 'N' && pusher === B && fut(B) && cB[cB.length - 1] === last;
      const belt = endChunk.length >= 2 || (chP.length === 1 && !pusherMore) || pusherOpen;
      if (!belt) return no(`${names[pusher]} 의 끝(땅속 출구)이 ${names[pusher === A ? B : A]} 의 시작을 민다 — 물건이 섞이고 막을 수 없다`);
      if (cp.length === 1 && !pusherMore && !lines[pusher].give) {   // 칸 하나뿐인 줄의 끝을 막는 칸으로 — 그 칸이 옆에서 들어오는 첫 칸이라 옆 입구다
        const why = NOSIDE ? '옆 입구를 안 쓰는 셈' : sideLoadWhy(lines[pusher], dirs[pusher]);
        if (why) return no(`${names[pusher]} 는 칸 하나뿐이라 막는 칸(짝 없는 입구)이 옆에서 받는데 ${why}`);
      }
      if (!(endChunk.length >= 2 || (chP.length === 1 && !pusherMore)) && pusherOpen) prom.push(pusher);
      sc += BLOCK;
    }
    // 벽의 차례 — 이 배열로 벽을 건너는 행이 정해진 줄(↓ 은 첫 칸 · ↑ 은 끝난 줄의 맨 아래 칸)과 차례를 견준다
    if (ORDER) {
      const ent = (i) => {
        const c = after[i]; if (!c.length) return null;
        const topEntry = (dirs[i] === 'S') !== !!lines[i].give;          // 받는 ↓ · 주는 ↑ 은 맨 위 칸, 받는 ↑ · 주는 ↓ 은 맨 아래 칸
        return topEntry ? c[0] : fut(i) ? null : c[c.length - 1];
      };
      const on = ORDER.on;
      for (let k = 0; k < on.length; k++) for (let q = k + 1; q < on.length; q++) {
        const up = on[k], dn = on[q], eu = ent(up), ed = ent(dn);
        if (ed !== null && eu === null) return no(`${names[up]} 가 ${names[dn]} 보다 위에서 벽을 건너야 하는데 아직 안 섰다`);
        if (ed !== null && eu !== null && !(eu < ed)) return no(`${names[up]} 가 ${names[dn]} 보다 위에서 벽을 건너야 한다`);
      }
      for (const [i, j] of ORDER.gap) { const a = ent(i), b = ent(j); if (a !== null && b !== null && Math.abs(a - b) < 2) return no(`${names[i]} 와 ${names[j]} 의 출입구는 두 행 이상 떨어져야 한다(반드시 건너는 쌍)`); }
    }
    if (process.env.TYPECHECK !== '0' && !typableSoFar(after, fut)) return no('지하벨트 종류를 못 나눈다(같은 방향으로 겹치는 땅속 · 막는 칸이 고른 종류보다 많다)');
    return sc;
  }
}

module.exports = { build3, unitsOf, WORK };

if (require.main === module) {
  const { casesOf } = require('./판-묶음.cjs');
  const OTHER = process.env.OTHER;   // S · N 이면 모든 줄의 otherDir — 다른 면이 그 방향으로 흐른다고 놓는다
  const MODE = process.argv[2] || '확정';
  const t0 = Date.now();
  const GIVE = process.env.GIVE === '1';   // 첫 품목을 주는 줄(출력)로 — 출력과 입력이 한 세로줄
  const cases = casesOf(MODE).filter(([, items]) => !GIVE || items[0].kind === 'single').map(([N, items]) => [N, GIVE ? items.map((it, k) => (k === 0 ? { ...it, give: true } : it)) : items]);
  const fails = [];
  const byN = new Map();
  for (const [N, items] of cases) {
    const orders = items.length === 2 && items[0].kind !== 'pair' && !GIVE ? [items, [items[1], items[0]]] : [items];
    let okAny = false, lastFail = null;
    for (const its of orders) {
      const lineSets = its.map((it) => linesOf(it, N));
      const sideLists = lineSets.map((ls) => [...smallSides(ls)]);
      const combos = sideLists.reduce((acc, list) => acc.flatMap((a) => list.map((s) => [...a, s])), [[]]);
      let allOk = true;
      for (const combo of combos) {
        const ls = []; lineSets.forEach((set, k) => set.forEach((L, i) => ls.push({ ...L, small: combo[k].get(i) || [], give: !!its[k].give, ...(OTHER ? { otherDir: OTHER } : {}), ...(NOSIDE ? { noSideLoad: true } : {}) })));
        const dirs = ruleDirs(ls);
        const res = build3(N, ls, dirs);
        if (!res.ok) { allOk = false; lastFail = { N, lines: ls, dirs, res }; break; }
      }
      if (allOk) { okAny = true; break; }
    }
    const tt = byN.get(N) || [0, 0]; tt[1]++; if (okAny) tt[0]++; byN.set(N, tt);
    if (!okAny) fails.push(lastFail);
  }
  for (const [N, [ok, tot]] of byN) console.log(`  머신 ${N}대: ${ok}/${tot}`);
  console.log(`  합 ${cases.length - fails.length}/${cases.length} · ${((Date.now() - t0) / 1000).toFixed(1)}초 · 앞보기로 본 머신 ${WORK.looks} · 고른 횟수 ${WORK.decisions} 가운데 앞보기가 바꾼 것 ${WORK.skips}`);
  for (const f of fails.slice(0, 3)) console.log(`    못 지음: N${f.N} ${f.res.names.join(' · ')} — ${f.res.why}`);
}
