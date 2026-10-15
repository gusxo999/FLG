/**
 * **면 좌석표** — **모듈**이 한 방향(W/E/N/S)으로 가진 자리를 그린 **한 장의 표**.
 * 칸 하나 = `(행, 깊이)` 이고, 한 장이 머신 하나가 아니라 **기둥의 머신 전부**를 덮는다.
 *
 * ```
 * W면 (머신 3×3, reach {1,2})
 *         d1(좌석)   d2        d3        d4
 *  행 0   구리선     구리선벨트  구리선포트인 구리선포트상자
 *  행 1   구리선     구리선벨트     ·          ·
 *  행 2   철판          ·       철판벨트      ·
 * ```
 *
 * **세로축은 "모듈의 그 면"이 아니라 "머신들의 그 방향 면을 이어 붙인 것"이다.** W/E 는 둘이
 * 같다(ColumnCluster 라 모든 머신의 x 가 같다). **N/S 는 다르다** — 안쪽 머신의 N/S 는 모듈
 * 바깥이 아니라 이웃과의 **gap** 이고, 표는 그 gap 들까지 한 장에 담는다.
 *
 * **그렇다고 면 무늬가 머신마다 반복되는 것은 아니다** — 행이 머신마다 따로라 조회는 전부
 * `mi` 를 받는다([seatsTaken]·[freeSeatRows]·[groupsOn]). 반복되는 것은 유체 상자 행 하나뿐
 * 이고(프로토타입이 정한 자리라 머신마다 같다), 그래서 [makeFaceTable] 만 전 머신에 찍는다.
 *
 * ## 왜 표인가 — 장부 셋이 하던 일을 하나가 한다
 *
 * 예전엔 면의 상태가 **셋으로 흩어져** 있었다. 셋이 서로 다른 것을 세고 서로를 몰랐다:
 *
 * | 옛 장부 | 무엇을 셌나 | 표에서 |
 * |---|---|---|
 * | `used`(`${머신}:${면}` → 수) | 그 머신 면에 몇 칸 찼나 | `d1` 열에서 찬 칸의 수([seatsTaken]) |
 * | `faceGroups`(같은 열쇠 → 수) | 그 면에 그룹이 몇이냐 | `d1` 열의 **서로 다른 주인** 수([groupsOn]) |
 * | `lanes`(`${면}\|${깊이}` → 구간들) | 그 깊이에서 어느 행이 먹혔나 | 그 깊이 열에서 찬 행([depthClear]) |
 *
 * **유체 상자 행도 표의 칸이다** — 미리 `"pipe"` 로 차 있다. 그래서 옛
 * `skipFluidRows`(논리 순번 ↔ 실제 행 되사상)가 필요 없어졌다: 빈 칸을 앞에서부터 집으면
 * 그 사상이 저절로 나온다. 같은 산술을 두 곳이 갖던 자리가 하나 없어진 것이다.
 *
 * ## 행 번호는 좌표가 아니라 **모듈-로컬 순번**이다
 *
 * `행 = 머신index × rowsPerMachine + 면에서의 칸`. 머신 사이 gap 을 안 세지만 사상이
 * **단조**라 *"두 구간이 겹치나"* 는 실제와 같은 답을 준다 — 배정이 아는 것은 그것뿐이면 된다.
 * 좌표는 [placeLinkSeats] 가 나중에 **더한다**.
 *
 * ## 표는 **값**이다
 *
 * 그래서 복사해서 채워 보고 버릴 수 있다([copyFaceTable]). 트렁크 경로 계획의 배정 3단이
 * 요구하는 것이 그것 하나다(`docs/auto-layout/module/trunk-assignment.md` §15 ㉢) — 장부 셋을 순서대로
 * 밀던 옛 모양으로는 되돌릴 방법이 없었다.
 *
 * ## 칸의 종류와 지하 횡단 기록 — 줄이 땅속으로 비켜 갈 때(`AUTO_LAYOUT_LINK_DIVE`)
 *
 * 주인만으로는 *"이 칸 밑으로 지나갈 수 있나"* 를 못 답한다. 그래서 칸마다 **종류**를 곁들인다([FaceCellKind]).
 * 주인이 줄 하나를 뜻하는 것은 그대로이고, 종류는 그 칸이 **땅 위에 무엇을 세우나**다:
 *
 * ```
 * belt    그 줄의 인서터가 닿는 행의 벨트 · 합류 칸 · 지하 입출구       — 못 비킨다
 * soft    인서터가 안 닿는 행의 자기 벨트                              — 주인이 그 행을 땅속으로 내줄 수 있다
 * port    포트 인서터 · 상자                                           — 못 비키지만 **그 밑으로는** 지나간다
 * tunnel  합친 몸통 사이의 행 — 땅 위엔 아무것도 없지만 열은 그 줄의 것이다
 * ```
 *
 * 종류가 없는 칸은 `belt` 로 읽는다(가장 보수적). 지하 횡단을 들이지 않는 판에서는 아무도 종류를 안 읽는다.
 * **벨트 밑으로는 아무도 안 들어간다** — 한 열에서 두 줄의 구간은 안 겹친다([depthClear] 가 칸으로 막는다). 몸통 위에
 * 남의 벨트를 들이는 것(얹기)은 `tempPlanDocs/재료-둘-이상-부모/judgements.md` J-모양문법 의 몫이다.
 * **지하 횡단 기록**([DiveRecord])은 줄마다 몸통 구간이다 — 먼저 앉은 줄이 **나중에** 비켜 주므로 최종값은 장부에 있다.
 * 규칙은 `docs/auto-layout/module/trunk-blocked.md` §1 · §4.
 */

/** 칸 하나의 주인. `"pipe"` = 유체 상자가 미리 먹은 좌석, 수 = 그룹 순번. */
export type FaceCellOwner = number | "pipe";

/** 좌석 열의 깊이 — 면 바로 바깥 한 칸. 팔은 언제나 여기 앉는다. */
export const SEAT_DEPTH = 1;

/** 칸이 땅 위에 세우는 것 — 머리말 §칸의 종류. 없으면 `belt` 로 읽는다. */
export type FaceCellKind = "belt" | "soft" | "port" | "tunnel";

/**
 * **줄 하나의 지하 횡단 기록** — 지하 횡단할 수 있는 줄만 갖는다(지하 종류를 받은 줄).
 *
 * `bodies` 는 땅속 행 구간(닫힘)들이고 입구 · 출구는 그 바로 앞뒤 행이다(흐름 방향은 계획이 안다 — 칸은 같다).
 * `span` 은 그 줄의 벨트 구간 — 입출구가 구간 **안쪽**에만 설 수 있어서 든다.
 */
export interface DiveRecord {
  readonly depth: number;
  readonly span: readonly [number, number];
  /** 그 줄의 인서터 행(모듈-로컬) — 몸통이 될 수 없다(인서터는 몸통에서 못 집는다). */
  readonly seatRows: readonly number[];
  /** 입출구가 될 수 없는 행 — 포트가 붙는 끝 · 집는 쪽의 흐름 끝(`module/arith/dive.tunnelFault`). */
  readonly fixedRows: readonly number[];
  readonly entityName: string;
  readonly maxDistance: number;
  bodies: Array<readonly [number, number]>;
}

export interface FaceTable {
  /** 머신 하나가 이 면에 가진 길이 방향 칸 수 — W/E 면은 `h`, N/S 면은 `w`. */
  readonly rowsPerMachine: number;
  /** 이 면이 걸치는 머신 수. `행` 은 `0 .. rowsPerMachine × count − 1`. */
  readonly machineCount: number;
  /** `${행}|${깊이}` → 주인. 없으면 빈칸. */
  readonly cells: Map<string, FaceCellOwner>;
  /** `${행}|${깊이}` → 그 칸의 종류(머리말 §칸의 종류). 없으면 `belt`. */
  readonly kinds: Map<string, FaceCellKind>;
  /** 주인 → 지하 횡단 기록. 지하 횡단할 수 있는 줄만 있다. */
  readonly dives: Map<number, DiveRecord>;
  /** 다음 그룹에게 줄 순번 — 주인을 구분해야 [groupsOn] 을 셀 수 있다. */
  nextOwner: number;
}

/** 읽기 전용으로 본 표 — 굳힌 좌석(`SeatedFaces`)이 든다. 다시 쓰려면 [copyFaceTable] 로 복사한다. */
export interface FaceTableView {
  readonly rowsPerMachine: number;
  readonly machineCount: number;
  readonly cells: ReadonlyMap<string, FaceCellOwner>;
  readonly kinds: ReadonlyMap<string, FaceCellKind>;
  readonly dives: ReadonlyMap<number, Readonly<DiveRecord>>;
  readonly nextOwner: number;
}

const key = (row: number, depth: number): string => `${row}|${depth}`;

/** 머신 `mi` 의 `slot` 번째 칸이 표에서 몇 행인가. */
export function rowIndex(t: FaceTable, mi: number, slot: number): number {
  return mi * t.rowsPerMachine + slot;
}

/**
 * 빈 표를 만든다. `pipeRows` 는 **머신 면 안에서의 유체 상자 칸 번호**이고, 머신마다
 * 같은 자리에 있으므로 전 머신에 찍는다.
 */
export function makeFaceTable(
  rowsPerMachine: number,
  machineCount: number,
  pipeRows: readonly number[] = [],
): FaceTable {
  const t: FaceTable = {
    rowsPerMachine: Math.max(1, rowsPerMachine),
    machineCount: Math.max(1, machineCount),
    cells: new Map(),
    kinds: new Map(),
    dives: new Map(),
    nextOwner: 0,
  };
  for (let mi = 0; mi < t.machineCount; mi++)
    for (const r of pipeRows) {
      if (r < 0 || r >= t.rowsPerMachine) continue;
      t.cells.set(key(rowIndex(t, mi, r), SEAT_DEPTH), "pipe");
    }
  return t;
}

/** 표를 통째로 복사한다 — 채워 보고 버리는 시도(백트래킹·사다리)의 전부다. */
export function copyFaceTable(t: FaceTableView): FaceTable {
  return {
    ...t,
    cells: new Map(t.cells),
    kinds: new Map(t.kinds),
    dives: new Map([...t.dives].map(([o, r]) => [o, { ...r, bodies: [...r.bodies] }] as const)),
  };
}

/** 칸 하나 — 주인과 종류. 빈칸이면 `undefined`. 종류가 안 적힌 칸은 `belt` 다(머리말). */
export function cellAt(
  t: FaceTableView,
  row: number,
  depth: number,
): { owner: FaceCellOwner; kind: FaceCellKind } | undefined {
  const owner = t.cells.get(key(row, depth));
  if (owner === undefined) return undefined;
  return { owner, kind: t.kinds.get(key(row, depth)) ?? "belt" };
}

/**
 * 머신 `mi` 의 **빈 좌석 칸**들(오름차순). 파이프가 먹은 칸과 이미 앉은 그룹의 칸을 뺀 것이다.
 *
 * 옛 코드의 `remap(base + j)` 가 이 배열의 `j` 번째와 **같은 값**이다 — 그쪽은 논리 순번을
 * 유체 행만큼 밀어서 구했고, 이쪽은 그냥 빈 칸을 세면 된다.
 */
export function freeSeatRows(t: FaceTable, mi: number): number[] {
  const out: number[] = [];
  for (let s = 0; s < t.rowsPerMachine; s++)
    if (!t.cells.has(key(rowIndex(t, mi, s), SEAT_DEPTH))) out.push(s);
  return out;
}

/** 머신 `mi` 의 좌석 중 **그룹이 쓴** 칸 수 — 파이프는 안 센다(옛 `used`). */
export function seatsTaken(t: FaceTable, mi: number): number {
  let n = 0;
  for (let s = 0; s < t.rowsPerMachine; s++) {
    const o = t.cells.get(key(rowIndex(t, mi, s), SEAT_DEPTH));
    if (typeof o === "number") n++;
  }
  return n;
}

/** 머신 `mi` 의 면에 앉은 **서로 다른 그룹** 수(옛 `faceGroups`). */
export function groupsOn(t: FaceTable, mi: number): number {
  const seen = new Set<number>();
  for (let s = 0; s < t.rowsPerMachine; s++) {
    const o = t.cells.get(key(rowIndex(t, mi, s), SEAT_DEPTH));
    if (typeof o === "number") seen.add(o);
  }
  return seen.size;
}

/**
 * 깊이 `depth` 의 행 구간 `[lo, hi]`(닫힘)이 **비었나**(옛 `lanes` 겹침 판정).
 *
 * 옛 코드는 구간 목록을 들고 `span[0] <= b && a <= span[1]` 로 물었다. 칸으로 물어도 답이
 * 같다 — 구간이 곧 그 칸들이기 때문이다. 그리고 이쪽은 **벨트가 아닌 것**(포트 칸 등)이
 * 같은 깊이에 들어와도 그대로 잡힌다.
 */
export function depthClear(t: FaceTable, depth: number, lo: number, hi: number): boolean {
  for (let r = lo; r <= hi; r++) if (t.cells.has(key(r, depth))) return false;
  return true;
}

/** 그룹 하나에게 순번을 발급한다 — [claimSeats]·[claimDepth] 이 같은 값을 써야 한다. */
export function takeOwner(t: FaceTable): number {
  return t.nextOwner++;
}

/** 머신 `mi` 의 좌석 칸 `slots` 를 `owner` 에게 준다. */
export function claimSeats(
  t: FaceTable,
  mi: number,
  slots: readonly number[],
  owner: number,
): void {
  for (const s of slots) t.cells.set(key(rowIndex(t, mi, s), SEAT_DEPTH), owner);
}

/** 깊이 `depth` 의 행 구간 `[lo, hi]` 를 `owner` 에게 준다. 종류를 주면 함께 적는다(없으면 `belt` 로 읽힌다). */
export function claimDepth(
  t: FaceTable,
  depth: number,
  lo: number,
  hi: number,
  owner: number,
  kind?: FaceCellKind,
): void {
  for (let r = lo; r <= hi; r++) {
    t.cells.set(key(r, depth), owner);
    if (kind) t.kinds.set(key(r, depth), kind);
    else t.kinds.delete(key(r, depth));
  }
}

/** 칸 하나를 비운다 — 비켜 준 줄의 몸통 행([giveRows]). */
function releaseCell(t: FaceTable, row: number, depth: number): void {
  t.cells.delete(key(row, depth));
  t.kinds.delete(key(row, depth));
}

/**
 * **먼저 앉은 줄이 행을 땅속으로 내준다** — 새 몸통 구간 `bodies` 로 바꾸고, 새로 몸통이 된 행의 지면을 비우고,
 * 입출구 행을 단단하게(`belt`) 적는다. **고르지 않는다** — 몸통은 정책이 셌다(`module/policy/link.diveRelief`).
 *
 * **비켜 준 줄의 인서터 · 포트는 안 움직인다** — 비우는 칸이 그 줄의 `soft`(인서터가 안 닿는 벨트)나 이미 `tunnel`
 * 이거나 남이 쓰는 칸(몸통 위에 선 포트)이 아니면 던진다. 되돌리기가 아니라 지면 청구가 줄어드는 것뿐이다.
 */
export function giveRows(t: FaceTable, owner: number, bodies: ReadonlyArray<readonly [number, number]>): void {
  const rec = t.dives.get(owner);
  if (!rec) throw new Error(`먼저 앉은 줄의 지하 횡단 — 주인 ${owner} 는 지하 횡단 기록이 없다`);
  const d = rec.depth;
  const seat = new Set(rec.seatRows);
  /** 옛 입출구 — 몸통을 합치면 그 행도 땅속이 된다. */
  const oldMouths = new Set(rec.bodies.flatMap(([a, b]) => [a - 1, b + 1]));
  for (const [a, b] of bodies) {
    for (let r = a; r <= b; r++) {
      if (seat.has(r)) throw new Error(`먼저 앉은 줄의 지하 횡단 — 행 ${r} 는 주인 ${owner} 의 인서터 행이다(몸통이 될 수 없다)`);
      const c = cellAt(t, r, d);
      if (c && c.owner === owner) {
        if (c.kind !== "soft" && c.kind !== "tunnel" && !oldMouths.has(r))
          throw new Error(`먼저 앉은 줄의 지하 횡단 — (${r}, d${d}) 는 주인 ${owner} 의 ${c.kind} 칸이다(soft 만 내준다)`);
        // 땅 위엔 아무것도 없지만 열은 여전히 그 줄의 것이다 — 남의 벨트가 들어오지 않게 tunnel 로 남긴다
        t.kinds.set(key(r, d), "tunnel");
      }
    }
    for (const m of [a - 1, b + 1]) {
      const c = cellAt(t, m, d);
      if (!c || c.owner !== owner) throw new Error(`먼저 앉은 줄의 지하 횡단 — 입출구 (${m}, d${d}) 가 주인 ${owner} 의 칸이 아니다`);
      t.kinds.set(key(m, d), "belt");
    }
  }
  rec.bodies = bodies.map(([a, b]) => [a, b] as const);
}

/** 몸통 행 위에 남이 서는 칸을 적는다 — 그 칸의 원래 주인(몸통의 주인)은 지운다. */
export function claimOverTunnel(t: FaceTable, row: number, depth: number, owner: number, kind: FaceCellKind): void {
  releaseCell(t, row, depth);
  claimDepth(t, depth, row, row, owner, kind);
}
