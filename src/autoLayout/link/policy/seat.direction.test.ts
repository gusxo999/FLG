/**
 * **흘러야 하는 끝이 정해진 줄이 그 끝으로는 못 앉으면 — 방향을 내려놓고 앉는다**(`seatUnit`).
 *
 * 그 끝(`Link.requiredEnd`)은 두 줄을 쓰는 머신을 맨 끝에 세우려는 것이다. 못 지키면 그 머신이 한 줄에서 앞에 서지만,
 * 못 앉아 배치가 통째로 실패하는 것보다는 낫다 — 방향 없이 앉으면 방향을 붙이기 전과 같은 배치다.
 *
 * 창구(`FaceSeating`)를 가짜로 세워 그 갈래만 잰다 — 창구가 무엇을 답하느냐에 따라 링크 쪽이 무엇을 하느냐가 이 파일의 물음이다.
 */
import { describe, expect, it } from "vitest";
import { seatLinkEdge } from "./seat";
import type { Link } from "../../module/types/line";
import type { FaceSeating, SeatOffer, SeatReceipt } from "../../module/types/seat";

const line = (requiredEnd?: Link["requiredEnd"]): Link => ({
  item: "x",
  carries: [{ from: 0, to: 0, rate: 5 }, { from: 1, to: 0, rate: 5 }],
  from: new Map([[0, 1], [1, 1]]),
  to: new Map([[0, 1]]),
  requiredEnd,
  inwardPort: requiredEnd ? { from: true } : undefined,
});

/** 가짜 창구 — `accepts` 가 참인 줄에만 자리를 낸다. 받은 줄을 적어 둔다. */
function desk(accepts: (g: Link) => boolean): FaceSeating & { taken: number } {
  const d = {
    rowsPerMachine: 3,
    taken: 0,
    ask: (g: Link) => ({
      offer: accepts(g) ? ({ face: "W", clusterBeltDepth: 2, exitEnd: g.requiredEnd?.from } as unknown as SeatOffer) : undefined,
      why: [],
    }),
    take: (offer: SeatOffer): SeatReceipt => {
      d.taken += 1;
      return { id: d.taken, face: offer.face, clusterBeltDepth: offer.clusterBeltDepth, exitEnd: offer.exitEnd };
    },
    takeShared: () => undefined,
    canShare: () => false,
    close: () => { throw new Error("이 시험은 창구를 닫지 않는다"); },
  };
  return d as unknown as FaceSeating & { taken: number };
}

describe("seatUnit — 방향이 정해진 줄", () => {
  it("그 끝으로 양끝이 다 앉으면 방향을 지킨다", () => {
    const g = line({ from: "S" });
    const from = desk(() => true);
    const to = desk(() => true);
    const r = seatLinkEdge(from, to, [g], { split: false });
    expect(g.requiredEnd).toEqual({ from: "S" });
    expect(r.fromSeats[0]?.exitEnd).toBe("S");
    expect(r.toSeats[0]).toBeDefined();
  });

  it("싣는 쪽이 그 끝으로는 자리가 없으면 — 방향을 내려놓고 오늘 규칙으로 앉는다", () => {
    const g = line({ from: "S" });
    // 방향이 붙은 줄에는 자리를 안 낸다 — 방향이 없으면 낸다.
    const from = desk((l) => l.requiredEnd === undefined);
    const to = desk(() => true);
    const r = seatLinkEdge(from, to, [g], { split: false });
    expect(g.requiredEnd).toBeUndefined();
    expect(g.inwardPort).toBeUndefined();
    expect(r.fromSeats[0]).toBeDefined();
    expect(r.toSeats[0]).toBeDefined();
  });

  it("집는 쪽이 못 앉아도 내려놓는다 — 양끝이 같은 줄을 본다", () => {
    const g = line({ from: "S" });
    const from = desk(() => true);
    const to = desk((l) => l.requiredEnd === undefined);
    const r = seatLinkEdge(from, to, [g], { split: false });
    expect(g.requiredEnd).toBeUndefined();
    expect(r.fromSeats[0]).toBeDefined();
    expect(r.toSeats[0]).toBeDefined();
  });

  it("방향이 없는 줄은 미리 묻지 않는다(대조군) — 창구가 받는 횟수가 한 번씩이다", () => {
    const g = line();
    const from = desk(() => true);
    const to = desk(() => true);
    seatLinkEdge(from, to, [g], { split: false });
    expect(from.taken).toBe(1);
    expect(to.taken).toBe(1);
  });
});
