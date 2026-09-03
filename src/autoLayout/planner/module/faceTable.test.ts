/**
 * **[FaceTable] 동치 검증** — 표가 옛 장부 셋과 *같은 답*을 내나.
 *
 * 이것은 산출물 비교가 아니라 **동치 검증**이다. *"배치가 안 바뀐다"* 를 불변으로 쓰면
 * 비교 대상이 미완성일 때 아무것도 증명하지 못하지만(`tempPlanDocs/CLAUDE.md`), 여기서는
 * **옛 장부의 산술을 이 파일 안에 다시 적어 놓고** 표의 답과 맞춰 본다. 그래서 기준선이
 * 무엇이든 상관없이 참·거짓이 갈린다.
 *
 * 옛 장부 셋과 대응(`docs/auto-layout/module/module-planning.md §4.5`):
 *
 * ```
 * used       "${머신}:${면}" → 수        →  seatsTaken   (d1 열에서 찬 칸의 수)
 * faceGroups 같은 열쇠 → 수              →  groupsOn     (d1 열의 서로 다른 주인 수)
 * lanes      "${면}|${깊이}" → 구간들     →  depthClear    (그 깊이 열에서 찬 행)
 * skipFluidRows(논리 순번 → 실제 행)      →  freeSeatRows (빈 칸을 앞에서부터)
 * ```
 */
import { describe, it, expect } from "vitest";
import {
  claimDepth, claimSeats, freeSeatRows, groupsOn, depthClear,
  makeFaceTable, rowIndex, seatsTaken, takeOwner,
} from "./faceTable";

/**
 * **옛 산술 ①** — `linkPlanner.skipFluidRows` 를 그대로 옮긴 것. 논리 순번을 유체 상자 행
 * 개수만큼 밀어 실제 행을 낸다. 표가 이 함수를 대체했으므로 여기서만 산다.
 */
function oldRemap(rows: readonly number[]): (r: number) => number {
  if (!rows.length) return (r) => r;
  const sorted = [...rows].sort((a, b) => a - b);
  return (r) => {
    let v = r;
    for (const s of sorted) if (v >= s) v += 1;
    return v;
  };
}

/** **옛 산술 ②** — `lanes` 의 겹침 판정 `span[0] <= b && a <= span[1]`. */
const oldOverlaps = (taken: readonly (readonly [number, number])[], lo: number, hi: number) =>
  taken.some(([a, b]) => lo <= b && a <= hi);

/** 유체 행 후보 — `0..h-1` 의 모든 부분집합(작은 h 라 전수로 돈다). */
function subsets(h: number): number[][] {
  const out: number[][] = [];
  for (let mask = 0; mask < 1 << h; mask++) {
    const s: number[] = [];
    for (let i = 0; i < h; i++) if (mask & (1 << i)) s.push(i);
    out.push(s);
  }
  return out;
}

describe("FaceTable — 옛 장부와 동치", () => {
  it("freeSeatRows ≡ skipFluidRows(base + t) — 유체 행 전수 대조", () => {
    // 옛 코드: `base` 는 그 머신에서 이미 쓴 **논리** 칸 수이고, 실제 행은 `remap(base + t)` 였다.
    // 표: 빈 칸을 앞에서부터 집는다. 유체 칸이 미리 차 있으므로 되사상이 저절로 나온다.
    const mismatches: string[] = [];
    for (let h = 1; h <= 6; h++) {
      for (const fluid of subsets(h)) {
        const budget = h - fluid.length; // faceSeatArms(h, fluid.length)
        if (budget <= 0) continue;
        // 같은 머신에 그룹을 1칸씩 차례로 앉힌다 — 예산이 다할 때까지.
        const t = makeFaceTable(h, 1, fluid);
        const remap = oldRemap(fluid);
        for (let base = 0; base < budget; base++) {
          const got = freeSeatRows(t, 0)[0];
          const want = remap(base);
          if (got !== want) mismatches.push(`h=${h} fluid=[${fluid}] base=${base}: ${got} ≠ ${want}`);
          claimSeats(t, 0, [got], takeOwner(t));
        }
      }
    }
    expect(mismatches).toEqual([]);
  });

  it("freeSeatRows.slice(0,k) ≡ [remap(base) … remap(base+k−1)] — 여러 팔을 한 번에", () => {
    // 팔이 `k` 개인 그룹은 옛 코드에서 `Array.from({length:k}, (_,t) => remap(base+t))` 였다.
    const t = makeFaceTable(7, 1, [2, 5]);
    const remap = oldRemap([2, 5]);
    let base = 0;
    for (const k of [2, 1, 2]) {
      const got = freeSeatRows(t, 0).slice(0, k);
      const want = Array.from({ length: k }, (_, i) => remap(base + i));
      expect(got).toEqual(want);
      claimSeats(t, 0, got, takeOwner(t));
      base += k;
    }
  });

  it("seatsTaken ≡ 옛 `used` — **파이프 칸은 안 센다**", () => {
    // 이 값은 `insertingPlanner.seatRowsUsed` 로 가고, 거기서 유체 행은 이미 따로 빠진다
    // (`afterPipe − seatRowsUsed`). 파이프를 여기서 또 세면 예산이 두 번 깎인다.
    const t = makeFaceTable(5, 2, [1]);
    expect(seatsTaken(t, 0)).toBe(0); // 파이프만 있는 상태
    claimSeats(t, 0, freeSeatRows(t, 0).slice(0, 2), takeOwner(t));
    expect(seatsTaken(t, 0)).toBe(2);
    expect(seatsTaken(t, 1)).toBe(0); // 머신마다 따로 — 옛 열쇠가 `${머신}:${면}` 이었다
  });

  it("groupsOn ≡ 옛 `faceGroups` — 팔 수가 아니라 **그룹 수**", () => {
    // gap 면의 반출 깊이(exitDepth)가 이 수로 정해진다. 서쪽으로 달리는 줄은 그룹마다
    // 하나씩이지 팔마다 하나가 아니다.
    const t = makeFaceTable(6, 1);
    claimSeats(t, 0, [0, 1, 2], takeOwner(t)); // 팔 3개짜리 그룹 하나
    expect(seatsTaken(t, 0)).toBe(3);
    expect(groupsOn(t, 0)).toBe(1);
    claimSeats(t, 0, [3], takeOwner(t)); // 둘째 그룹
    expect(groupsOn(t, 0)).toBe(2);
  });

  it("depthClear ≡ 옛 구간 겹침 판정 — 전수 대조", () => {
    // 옛 코드는 구간 목록을 들고 물었고, 표는 칸으로 묻는다. 구간이 곧 그 칸들이라 답이 같다.
    const t = makeFaceTable(4, 3); // 행 0..11
    const taken: [number, number][] = [];
    const put = (lo: number, hi: number) => {
      claimDepth(t, 2, lo, hi, takeOwner(t));
      taken.push([lo, hi]);
    };
    put(0, 2);
    put(7, 9);
    for (let lo = 0; lo < 12; lo++)
      for (let hi = lo; hi < 12; hi++)
        expect(depthClear(t, 2, lo, hi), `[${lo},${hi}]`).toBe(!oldOverlaps(taken, lo, hi));
  });

  it("깊이가 다르면 안 다툰다 — 깊이 장부의 열쇠가 `면|깊이` 였던 것과 같다", () => {
    const t = makeFaceTable(4, 2);
    claimDepth(t, 2, 0, 7, takeOwner(t)); // d2 를 통째로
    expect(depthClear(t, 2, 0, 0)).toBe(false);
    expect(depthClear(t, 3, 0, 7)).toBe(true); // d3 은 그대로 비어 있다
  });

  it("행 번호는 `머신 × 칸수 + 칸` — 옛 `mi * machine.h + t` 그대로", () => {
    const t = makeFaceTable(3, 4);
    expect(rowIndex(t, 0, 0)).toBe(0);
    expect(rowIndex(t, 1, 0)).toBe(3);
    expect(rowIndex(t, 3, 2)).toBe(11);
  });

  it("유체 칸은 머신마다 같은 자리에 찍힌다 — 파이프가 기둥을 세로로 지나므로", () => {
    const t = makeFaceTable(3, 3, [1]);
    for (let mi = 0; mi < 3; mi++) expect(freeSeatRows(t, mi)).toEqual([0, 2]);
  });
});
