/**
 * **잠수의 셈** — 땅속으로 지나갈 행들에서 터널(몸통 구간)을 세우고, 그 터널이 줄의 조건을 지키나 잰다.
 * 고르지 않는다 — 누가 잠수하나 · 어느 종류인가는 정책(`module/policy/link.diveRelief` · `module/policy/underground`)이 정한다.
 *
 * ```
 * 몸통     땅속 행 구간 [a, b] — 땅 위엔 그 줄의 칸이 없다(남의 포트가 그 위에 선다)
 * 입출구   a−1 · b+1 — 그 줄 자신의 칸. 인서터는 여기서 집고 놓는다(몸통에서만 못 한다)
 * ```
 *
 * 규칙은 `docs/auto-layout/module/trunk-blocked.md` §1 · §4.
 */

/** 몸통 구간(닫힘) — 표의 행 번호. */
export type TunnelBody = readonly [number, number];

/**
 * **땅속으로 지나갈 행들 → 몸통 구간.** 붙은 행은 한 몸통이고, 두 몸통 사이가 **한 행**이면 합친다 —
 * 앞 몸통의 출구와 뒤 몸통의 입구가 같은 칸이 되기 때문이다(한 칸에 지하 둘은 못 선다).
 * 사이가 두 행 이상이면 출구 다음 칸이 입구라 따로 둔다.
 */
export function tunnelBodies(rows: Iterable<number>): TunnelBody[] {
  const sorted = [...new Set(rows)].sort((a, b) => a - b);
  const out: Array<[number, number]> = [];
  for (const r of sorted) {
    const last = out[out.length - 1];
    if (last && r - last[1] <= 2) last[1] = r; // 붙었거나(1) 입출구가 겹친다(2)
    else out.push([r, r]);
  }
  return out;
}

/** 몸통의 행 전부. */
export function bodyRows(bodies: readonly TunnelBody[]): number[] {
  const out: number[] = [];
  for (const [a, b] of bodies) for (let r = a; r <= b; r++) out.push(r);
  return out;
}

/**
 * **입출구가 될 수 없는 행** — 포트가 붙는 끝(`topT`), 집는 쪽이면 흐름의 끝(`farT`)까지. 싣는 쪽의 먼 끝은 수집이
 * 시작하는 칸이라 입구가 서도 된다(인서터는 입구에 놓는다).
 */
export function fixedRowsOf(span: readonly [number, number], flowToSouth: boolean, side: "from" | "to"): number[] {
  const topT = flowToSouth ? span[1] : span[0];
  const farT = flowToSouth ? span[0] : span[1];
  return side === "from" ? [topT] : [topT, farT];
}

/** 터널이 그 줄에서 안 되는 까닭 — 없으면 선다. */
export type TunnelFault =
  /** 몸통에 그 줄의 인서터 행이 있다 — 인서터는 몸통에서 못 집는다(T2) */
  | "seat"
  /** 입출구가 구간 밖이거나 **고정 행**이다 — 포트가 붙는 칸 · 입력의 종착 칸에는 지하가 서면 안 된다(T3) */
  | "end"
  /** 입구에서 출구까지 물리 거리가 사거리를 넘는다(T3) */
  | "range";

/**
 * **몸통들이 그 줄의 조건을 지키나** — T2(인서터 행 아님) · T3(입출구가 구간 안 · 고정 행 아님 · 사거리 안).
 *
 * 고정 행(`fixed`)은 지하가 서면 안 되는 그 줄의 칸이다 — 포트가 붙는 끝(`topT` — 납품이 상자를 벨트로 바꾸면 그 칸에
 * 옆에서 들어온다)과, 집는 쪽이면 흐름의 끝(종착이 그 칸의 방향을 늦게 정하고 지하 입구로 바꾸기도 한다).
 *
 * 길이는 `lengthOf(입구행, 출구행)` 로 잰다 — 표의 행은 머신 사이 gap 을 안 세므로, 몸통이 머신 경계를 건너면
 * 그 gap 폭을 더해야 물리 거리가 된다. 그 폭은 장부가 안다(`module/ledger/seat.tunnelLength`).
 */
export function tunnelFault(
  bodies: readonly TunnelBody[],
  span: readonly [number, number],
  seatRows: ReadonlySet<number>,
  fixed: ReadonlySet<number>,
  lengthOf: (entrance: number, exit: number) => number,
  maxDistance: number,
): TunnelFault | undefined {
  for (const [a, b] of bodies) {
    for (let r = a; r <= b; r++) if (seatRows.has(r)) return "seat";
    for (const m of [a - 1, b + 1]) if (m < span[0] || m > span[1] || fixed.has(m)) return "end";
    if (lengthOf(a - 1, b + 1) > maxDistance) return "range";
  }
  return undefined;
}
