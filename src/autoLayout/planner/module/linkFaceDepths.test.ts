/**
 * `linkFaceDepths` — 링크·다이렉트가 옆면에서 먹는 **가장 깊은 칸**.
 *
 * 이 값은 [ClusterPipe] 가 얼마나 물러나야 하는지를 정한다(`buildTrunkContext.beltMaxOn`).
 * 틀리면 파이프가 링크 포트 끝 **위로** 지나가고, 끊겨도 겹침도 미배치도 아니라 아무도
 * 못 알아챈다 — 그래서 산술을 여기서 직접 못 박는다.
 *
 * → tempPlanDocs/케이스B-링크배분기-계획/ (1단계)
 */
import { describe, it, expect } from "vitest";
import { linkFaceDepths, type LinkFacePlan } from "./linkPlanner";
import type { PortFace } from "../../containerModel";

const plan = (face: PortFace, laneDepth: number, exitDepth?: number): LinkFacePlan => ({
  face,
  laneDepth,
  exitDepth,
  gap: face === "N" || face === "S" ? 0 : undefined,
  arms: new Map([[0, 1]]),
  slotIndex: new Map([[0, [0]]]),
});

describe("linkFaceDepths — 링크가 옆면에서 먹는 가장 깊은 칸", () => {
  it("벨트가 아니라 **포트 끝**까지 센다 — laneDepth + 2", () => {
    // 벨트 d2 · 포트 인서터 d3 · 포트 상자 d4 ([makeLinkPortChest]).
    expect(linkFaceDepths([[plan("W", 2)]])).toEqual({ W: 4 });
  });

  it("면마다 따로, 같은 면은 가장 깊은 것 하나", () => {
    expect(linkFaceDepths([[plan("W", 2), plan("E", 2)], [plan("W", 3)]])).toEqual({ W: 5, E: 4 });
  });

  it("**gap(N/S) 스필은 안 센다** — 그 포트 끝은 옆면 d1·d2 라 ClusterPipe(최소 d3)와 안 다툰다", () => {
    // 그 면이 좌석 줄을 먹는다는 사실은 [gapExitSidesFromPlans] 가 따로 전한다(점프 조건 ④).
    expect(linkFaceDepths([[plan("S", 2, 3), plan("N", 2)]])).toEqual({});
  });

  it("못 앉은 그룹(undefined)은 건너뛴다", () => {
    expect(linkFaceDepths([[undefined, plan("E", 2), undefined]])).toEqual({ E: 4 });
  });

  it("링크가 하나도 없으면 빈 객체 — 호출부가 `?? 0` 으로 읽는다", () => {
    expect(linkFaceDepths([[], [undefined]])).toEqual({});
  });
});
