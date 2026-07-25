/**
 * 파이프라인 계측기 — 같은 레시피 트리를 **같은 자로** 재서, 공급 방식을 바꿨을 때
 * 무엇이 좋아지고 무엇이 나빠지는지 숫자로 남긴다.
 *
 * 왜 이게 먼저인가([trunk-redesign](../../../../docs/auto-layout-wizard.trunk-redesign.md) §10.4-3):
 * 지난 대규모 리팩터가 "코드가 틀려서"가 아니라 **좋아졌다는 근거가 없어서** 전량 롤백됐다.
 * 그래서 새 트렁크로 갈아타기 전에 **현행 1:1 수치를 먼저 박제**하고, 갈아탄 뒤 같은 자로
 * 재서 이겼는지 본다. 이 파일은 판단하지 않는다 — **재기만 한다**(게이트 아님).
 *
 * 재는 대상은 사용자가 정한 우선순위 순서다:
 *   ① 물류가 성립하는가 — `hopFailures` · `exportSkips` (0 이어야 한다)
 *   ② 얼마나 비싼가   — `area` · `channelWidths` · `beltCells` · `hops`
 */
import { packModuleTree, type NodeSpec, type PackConfig, type PackResult } from "./modulePacking";
import { routeModuleHops, type HopConfig } from "./moduleHop";
import { rePathToPerimeter } from "./modulePerimeterPass";
import { moduleExtent } from "./modulePacking";
import { cellKey } from "../util/helper";
import { EntityType } from "../../../types/layout";
import type { PlacedCell } from "../containerModel";

/** 한 판의 계측값. 전부 정수 — 결정적이라 스냅샷으로 비교할 수 있다. */
export interface PipelineMetrics {
  /** ① 물류 성립 — 0 이 아니면 나머지 숫자는 의미가 없다(못 만든 배치가 더 작은 건 당연하다). */
  hopFailures: number;
  exportSkips: number;

  /** ② 비용 */
  bboxW: number;
  bboxH: number;
  /** 넓이 = bboxW × bboxH. 정사각형 선호(O1)와 무관한 순수 면적. */
  area: number;
  /** depth 사이 채널의 폭(왼쪽부터). 트렁크의 핵심 이득이 여기서 나와야 한다. */
  channelWidths: number[];

  /** 셀 셈 — 최종 그리드 기준(모듈 셀 − 떼어낸 것 + 홉 + 반출). */
  beltCells: number;
  undergroundCells: number;
  inserters: number;
  chests: number;

  /** 구조 — 모듈 경계를 건너는 것들. 트렁크는 이걸 O(머신×품목) → O(품목) 으로 줄여야 한다. */
  ports: number;
  hops: number;
  /** 홉 중 지하 점프를 쓴 것(= 지상에서 못 푼 교차의 수). */
  hopsWithUnderground: number;
  /** 짝을 못 찾아 외부 공급/흡수로 남은 포트(반출 대상). */
  rawPorts: number;

  /**
   * [insertingPlanner] 가 **트렁크로 합칠 수 있다고 판정한** 모듈 수 / 전체 모듈 수.
   * ③(트렁크 방출기) 도착 전까지 판정은 보고만 되고 실제 방출은 다이렉트다 — 그러니
   * 이 값은 "트렁크가 들어오면 몇 모듈이 실제로 합쳐지나"의 **예고**다.
   */
  tapEligibleModules: number;
  modules: number;
}

/** 파이프라인 한 판을 돌리고 잰다. moduleWizard 와 **같은 순서**로 합성한다. */
export function measurePipeline(
  specs: NodeSpec[],
  config: PackConfig,
  hopConfig: HopConfig,
): PipelineMetrics {
  const pack = packModuleTree(specs, config);
  const hop = routeModuleHops(pack, hopConfig);
  const perim = rePathToPerimeter(pack, hop.strippedChestIds, hop.cells, {
    beltEntityName: hopConfig.beltEntityName,
    inserterEntityName: config.inserterEntityName,
  });

  // 최종 그리드 = 모듈 셀 − (홉·반출이 떼어낸 것) + 홉 + 반출. moduleWizard 와 동형.
  const dropped = new Set([...hop.strippedCellKeys, ...perim.droppedCellKeys]);
  const grid = new Map<string, PlacedCell>();
  for (const pl of pack.placements)
    for (const c of pl.module.cells) {
      const k = cellKey(c.x, c.y);
      if (!dropped.has(k)) grid.set(k, c);
    }
  for (const c of [...hop.cells, ...perim.addedCells]) grid.set(cellKey(c.x, c.y), c);

  let beltCells = 0;
  let undergroundCells = 0;
  let inserters = 0;
  let chests = 0;
  for (const c of grid.values()) {
    switch (c.cell.entityType) {
      case EntityType.Belt: beltCells += 1; break;
      case EntityType.UndergroundBelt: undergroundCells += 1; break;
      case EntityType.Inserter: inserters += 1; break;
      case EntityType.InfinityChest: chests += 1; break;
      default: break;
    }
  }

  const ports = pack.placements.reduce(
    (n, pl) => n + pl.module.inputPorts.length + pl.module.outputPorts.length,
    0,
  );

  return {
    hopFailures: hop.failures,
    exportSkips: perim.skipped,
    bboxW: pack.bbox.w,
    bboxH: pack.bbox.h,
    area: pack.bbox.w * pack.bbox.h,
    channelWidths: channelWidths(pack),
    beltCells,
    undergroundCells,
    inserters,
    chests,
    ports,
    hops: pack.hops.length,
    hopsWithUnderground: hop.routes.filter((r) => r.ok && r.corridors.length > 0).length,
    rawPorts: pack.rawPorts.length,
    tapEligibleModules: pack.placements.filter((p) => p.module.supply?.mode === "tap").length,
    modules: pack.placements.length,
  };
}

/**
 * depth 열 사이의 빈 띠 = 채널. 열의 x 범위는 그 depth 모듈들의 extent 합집합이고,
 * 채널 폭 = 다음 열 시작 − 이번 열 끝 − 1.
 */
function channelWidths(pack: PackResult): number[] {
  const band = new Map<number, { x0: number; x1: number }>();
  for (const pl of pack.placements) {
    const e = moduleExtent(pl.module);
    const cur = band.get(depthOf(pack, pl.id));
    const x0 = e.x;
    const x1 = e.x + e.w - 1;
    if (!cur) band.set(depthOf(pack, pl.id), { x0, x1 });
    else band.set(depthOf(pack, pl.id), { x0: Math.min(cur.x0, x0), x1: Math.max(cur.x1, x1) });
  }
  const depths = [...band.keys()].sort((a, b) => a - b);
  const out: number[] = [];
  for (let i = 1; i < depths.length; i++) {
    const prev = band.get(depths[i - 1])!;
    const cur = band.get(depths[i])!;
    out.push(Math.max(0, cur.x0 - prev.x1 - 1));
  }
  return out;
}

/** placement 는 depth 를 안 들고 있다 — x 순서로 열을 세는 대신 origin.x 로 그룹을 만든다. */
function depthOf(pack: PackResult, id: string): number {
  const xs = [...new Set(pack.placements.map((p) => p.origin.x))].sort((a, b) => a - b);
  const p = pack.placements.find((q) => q.id === id)!;
  return xs.indexOf(p.origin.x);
}

/** 사람이 읽을 표 한 줄. 계측기 출력은 항상 이 순서로 — 눈으로 diff 하기 위함. */
export function formatMetrics(tag: string, m: PipelineMetrics): string {
  const ok = m.hopFailures === 0 && m.exportSkips === 0 ? "OK " : "FAIL";
  return [
    tag.padEnd(8),
    ok,
    `area ${String(m.area).padStart(5)} (${m.bboxW}×${m.bboxH})`,
    `ch [${m.channelWidths.join(",")}]`,
    `belt ${String(m.beltCells).padStart(3)}`,
    `ug ${String(m.undergroundCells).padStart(2)}`,
    `ins ${String(m.inserters).padStart(3)}`,
    `chest ${String(m.chests).padStart(3)}`,
    `port ${String(m.ports).padStart(3)}`,
    `hop ${String(m.hops).padStart(2)}(ug ${m.hopsWithUnderground})`,
    `raw ${String(m.rawPorts).padStart(3)}`,
    `tap ${m.tapEligibleModules}/${m.modules}`,
    `fail ${m.hopFailures}/${m.exportSkips}`,
  ].join("  ");
}
