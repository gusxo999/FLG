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
 * | `lanes`(`${면}\|${깊이}` → 구간들) | 그 깊이에서 어느 행이 먹혔나 | 그 깊이 열에서 찬 행([laneClear]) |
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
 * 요구하는 것이 그것 하나다(`tempPlanDocs/트렁크벨트-경로모델/ §9.7` ㉢) — 장부 셋을 순서대로
 * 밀던 옛 모양으로는 되돌릴 방법이 없었다.
 */

/** 칸 하나의 주인. `"pipe"` = 유체 상자가 미리 먹은 좌석, 수 = 그룹 순번. */
export type FaceCellOwner = number | "pipe";

/** 좌석 열의 깊이 — 면 바로 바깥 한 칸. 팔은 언제나 여기 앉는다. */
export const SEAT_DEPTH = 1;

export interface FaceTable {
  /** 머신 하나가 이 면에 가진 길이 방향 칸 수 — W/E 면은 `h`, N/S 면은 `w`. */
  readonly rowsPerMachine: number;
  /** 이 면이 걸치는 머신 수. `행` 은 `0 .. rowsPerMachine × count − 1`. */
  readonly machineCount: number;
  /** `${행}|${깊이}` → 주인. 없으면 빈칸. */
  readonly cells: Map<string, FaceCellOwner>;
  /** 다음 그룹에게 줄 순번 — 주인을 구분해야 [groupsOn] 을 셀 수 있다. */
  nextOwner: number;
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
export function copyFaceTable(t: FaceTable): FaceTable {
  return { ...t, cells: new Map(t.cells) };
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
export function laneClear(t: FaceTable, depth: number, lo: number, hi: number): boolean {
  for (let r = lo; r <= hi; r++) if (t.cells.has(key(r, depth))) return false;
  return true;
}

/** 그룹 하나에게 순번을 발급한다 — [claimSeats]·[claimLane] 이 같은 값을 써야 한다. */
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

/** 깊이 `depth` 의 행 구간 `[lo, hi]` 를 `owner` 에게 준다. */
export function claimLane(
  t: FaceTable,
  depth: number,
  lo: number,
  hi: number,
  owner: number,
): void {
  for (let r = lo; r <= hi; r++) t.cells.set(key(r, depth), owner);
}
