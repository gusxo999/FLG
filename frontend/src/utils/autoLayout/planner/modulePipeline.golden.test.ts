/**
 * modulePipeline.golden — 모듈 파이프라인(pack → hops → perimeter) 골든 스냅샷.
 *
 * 라이브 실측(2026-07-07, advanced-circuit 트리)과 동형의 spec 으로 전체 체인을 돌려
 * **현재 동작을 그대로 고정**한다. 목적: planner 면 확장(A)·홉 지하벨트(C)·lane 선예약(B)
 * 작업이 무엇을 바꾸는지 diff 로 드러내기 — 스냅샷 변경은 버그가 아니라 **의도된 설계
 * 변경의 증거**여야 하며, PR 에서 그렇게 리뷰한다.
 *
 * 트리(전부 count=1 — "간단×단일" 칸):
 *   n0 advanced-circuit ← n1 kr-electronic-components, n2 electronic-circuit
 *   n1 입력 plastic-bar·kr-silicon·kr-glass(전부 raw) — 입력 3개라 kr-glass 가 W 로 spill.
 *
 * 알려진 현재 상태(고정 대상, 2026-07-09 채널 기하 예약 승격 후):
 *   - skipped 0 / relocated 7 — 옛 skip 2건(kr-glass "no free lane track", n0 출력
 *     "straight blocked to W")이 해소됨. 원인이던 "먼저 깔린 홉이 채널 요지를 관통"이
 *     통합 장부(channelGeometryPlanner)의 트랙 배정 + 반출 예약 셀 차단으로 사라졌다.
 *     docs/auto-layout-wizard.channel-geometry-reservation.md 참조.
 */
import { describe, it, expect } from "vitest";
import { packModuleTree, type NodeSpec, type PackConfig } from "./modulePacking";
import { routeModuleHops } from "./moduleHop";
import { relocateChestsToPerimeter } from "./modulePerimeterPass";
import type { IoLine } from "../module/clusterPortPlanner";

const inL = (name: string, amount: number): IoLine => ({ name, kind: "belt", role: "input", amount });
const outL = (name: string, amount: number): IoLine => ({ name, kind: "belt", role: "output", amount });
const M = { entityName: "assembling-machine-3", w: 3, h: 3 };

const config: PackConfig = {
  inserterEntityName: "inserter",
  beltEntityName: "transport-belt",
  longInserter: { entityName: "long-handed-inserter", reach: 2 },
  reservePerimeterLanes: true,
  // 채널 기하 예약(통합 장부) — 2026-07-09 승격. 스냅샷 갱신은 의도된 설계 변경:
  // kr-glass 는 ns-face-relief 로 self-N, 옛 "straight blocked" skip 은 반출 예약으로 해소.
  channelGeometry: true,
};

// 라이브 실측과 같은 순서(ingredients 순 = chest id seq 순).
const specs: NodeSpec[] = [
  {
    id: "n0-advanced-circuit", depth: 0, machine: M, count: 1,
    lines: [
      inL("copper-cable", 4),
      inL("electronic-circuit", 2),
      inL("kr-electronic-components", 2),
      outL("advanced-circuit", 1),
    ],
  },
  {
    id: "n1-kr-electronic-components", depth: 1, parentId: "n0-advanced-circuit", machine: M, count: 1,
    lines: [inL("plastic-bar", 4), inL("kr-silicon", 2), inL("kr-glass", 2), outL("kr-electronic-components", 4)],
  },
  {
    id: "n2-electronic-circuit", depth: 1, parentId: "n0-advanced-circuit", machine: M, count: 1,
    lines: [inL("copper-cable", 3), inL("stone-tablet", 1), outL("electronic-circuit", 2)],
  },
];

/** 전체 체인 실행 → 관찰 가능한 결과 요약(결정적 직렬화). */
function runGolden() {
  const pack = packModuleTree(specs, config);
  const hop = routeModuleHops(pack, { beltEntityName: "transport-belt" });
  const res = relocateChestsToPerimeter(pack, hop.strippedChestIds, hop.cells, {
    beltEntityName: "transport-belt",
    inserterEntityName: "inserter",
  });

  // relocateChestsToPerimeter 는 순수(pack 미변형) — 이사한 상자의 최종 위치는 반환
  // relocations 에서 읽는다(옛 코드가 port.anchor 로 뮤테이션하던 값과 동일).
  const relocOrigin = new Map(res.relocations.map((r) => [r.chestId, r.origin]));
  const ports = pack.placements
    .flatMap((pl) => [...pl.module.inputPorts, ...pl.module.outputPorts])
    .map((p) => ({
      chest: p.chest.id,
      stripped: hop.strippedChestIds.has(p.chest.id),
      face: p.face,
      anchor: relocOrigin.get(p.chest.id) ?? p.anchor,
      slot: `${p.meta.side}${p.meta.laneDepth}/${p.meta.inserter}`,
    }))
    .sort((a, b) => a.chest.localeCompare(b.chest));

  return {
    hopFailures: hop.failures,
    relocated: res.relocated,
    skipped: res.skipped,
    reason: res.reason ?? null,
    ports,
  };
}

describe("modulePipeline golden (advanced-circuit 실측 동형)", () => {
  it("결정적", () => {
    expect(JSON.stringify(runGolden())).toEqual(JSON.stringify(runGolden()));
  });

  it("골든 스냅샷 — 현재 동작 고정", () => {
    expect(runGolden()).toMatchInlineSnapshot(`
      {
        "hopFailures": 0,
        "ports": [
          {
            "anchor": {
              "x": 14,
              "y": -1,
            },
            "chest": "n0-advanced-circuit-input-copper-cable-0",
            "face": "E",
            "slot": "E2/normal",
            "stripped": false,
          },
          {
            "anchor": {
              "x": 12,
              "y": 7,
            },
            "chest": "n0-advanced-circuit-input-electronic-circuit-1",
            "face": "E",
            "slot": "E3/long",
            "stripped": true,
          },
          {
            "anchor": {
              "x": 0,
              "y": 7,
            },
            "chest": "n0-advanced-circuit-input-kr-electronic-components-2",
            "face": "W",
            "slot": "W3/long",
            "stripped": true,
          },
          {
            "anchor": {
              "x": -1,
              "y": 6,
            },
            "chest": "n0-advanced-circuit-output-advanced-circuit-3",
            "face": "W",
            "slot": "W2/normal",
            "stripped": false,
          },
          {
            "anchor": {
              "x": 19,
              "y": -1,
            },
            "chest": "n1-kr-electronic-components-input-kr-glass-2",
            "face": "W",
            "slot": "N2/normal",
            "stripped": false,
          },
          {
            "anchor": {
              "x": 30,
              "y": 4,
            },
            "chest": "n1-kr-electronic-components-input-kr-silicon-1",
            "face": "E",
            "slot": "E3/long",
            "stripped": false,
          },
          {
            "anchor": {
              "x": 30,
              "y": 3,
            },
            "chest": "n1-kr-electronic-components-input-plastic-bar-0",
            "face": "E",
            "slot": "E2/normal",
            "stripped": false,
          },
          {
            "anchor": {
              "x": 17,
              "y": 4,
            },
            "chest": "n1-kr-electronic-components-output-kr-electronic-components-3",
            "face": "W",
            "slot": "W2/normal",
            "stripped": true,
          },
          {
            "anchor": {
              "x": 30,
              "y": 9,
            },
            "chest": "n2-electronic-circuit-input-copper-cable-0",
            "face": "E",
            "slot": "E2/normal",
            "stripped": false,
          },
          {
            "anchor": {
              "x": 30,
              "y": 10,
            },
            "chest": "n2-electronic-circuit-input-stone-tablet-1",
            "face": "E",
            "slot": "E3/long",
            "stripped": false,
          },
          {
            "anchor": {
              "x": 17,
              "y": 10,
            },
            "chest": "n2-electronic-circuit-output-electronic-circuit-2",
            "face": "W",
            "slot": "W2/normal",
            "stripped": true,
          },
        ],
        "reason": null,
        "relocated": 7,
        "skipped": 0,
      }
    `);
  });
});
