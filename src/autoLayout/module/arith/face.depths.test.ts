/**
 * `linkFaceDepths` — 링크·다이렉트가 옆면에서 먹는 **가장 깊은 칸**.
 *
 * 이 값은 [ClusterPipe] 가 얼마나 물러나야 하는지를 정한다(`buildTrunkContext.beltMaxOn`).
 * 틀리면 파이프가 링크 포트 끝 **위로** 지나가고, 끊겨도 겹침도 미배치도 아니라 아무도
 * 못 알아챈다 — 그래서 산술을 여기서 직접 못 박는다.
 *
 * → 유체 면 회수 (2026-08-09) · git log --grep="유체 면에 앉는다"
 */
import { describe, it, expect } from "vitest";
import { linkFaceDepths } from "./face";
import type { LinkFacePlan } from "../types/seat";
import type { PortFace } from "../../shared/types";

const plan = (face: PortFace, clusterBeltDepth: number, exitDepth?: number): LinkFacePlan => ({
  face,
  clusterBeltDepth,
  reach: clusterBeltDepth - 1,
  exitDepth,
  gap: face === "N" || face === "S" ? 0 : undefined,
  arms: new Map([[0, 1]]),
  slotIndex: new Map([[0, [0]]]),
});

describe("linkFaceDepths — 링크가 옆면에서 먹는 가장 깊은 칸", () => {
  it("벨트가 아니라 **포트 끝**까지 센다 — clusterBeltDepth + 2", () => {
    // 벨트 d2 · 포트 인서터 d3 · 포트 상자 d4 ([makeLinkPortChest]).
    expect(linkFaceDepths([[plan("W", 2)]])).toEqual({ W: 4 });
  });

  it("면마다 따로, 같은 면은 가장 깊은 것 하나", () => {
    expect(linkFaceDepths([[plan("W", 2), plan("E", 2)], [plan("W", 3)]])).toEqual({ W: 5, E: 4 });
  });

  it("**gap(N/S) 스필은 안 센다** — 그 포트 끝은 옆면 d1·d2 라 ClusterPipe(최소 d3)와 안 다툰다", () => {
    // 그 면이 좌석 줄을 먹는다는 사실은 [gapExitSidesFromPlans] 가 따로 전한다(점프 조건 ④).
    expect(linkFaceDepths([[plan("S", 2, 3), plan("N", 2)]])).toEqual({});
    expect(linkFaceDepths([[plan("S", 2, 3)]], { W: [[plan("S", 2, 3)]] })).toEqual({});
  });

  it("**지하 횡단하는 gap 출구는 센다** — 포트 상자가 출구 옆면 d`exitDive + 3` 까지 나간다(`trunk-blocked.md` §4.2)", () => {
    // 옆면 d4(합류의 비켜 가는 열)를 건너면 상자는 d7 — 그 면 줄들의 포트 끝(d4)보다 깊다
    const dived = { ...plan("S", 2), exitDive: 4 };
    expect(linkFaceDepths([[plan("W", 2), dived]], { W: [[dived]] })).toEqual({ W: 7 });
    expect(linkFaceDepths([[dived]], { E: [[dived]] })).toEqual({ E: 7 }); // 집는 쪽이면 E
  });

  it("못 앉은 그룹(undefined)은 건너뛴다", () => {
    expect(linkFaceDepths([[undefined, plan("E", 2), undefined]])).toEqual({ E: 4 });
  });

  it("링크가 하나도 없으면 빈 객체 — 호출부가 `?? 0` 으로 읽는다", () => {
    expect(linkFaceDepths([[], [undefined]])).toEqual({});
  });
});
