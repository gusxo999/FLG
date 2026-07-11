/**
 * modulePerimeterPass — 합성 후처리(조각 6-C). 모듈 트리를 전부 배치한 뒤, **살아남은
 * 외부상자**(raw 입력 + 루트 출력)를 각자의 *로컬* 모듈 ring 에서 **조립된 블루프린트의
 * 전역 perimeter** 로 옮긴다.
 *
 * ## 왜 필요한가
 * [clusterModule.generateModule] 은 클러스터를 "루트인 척" 생성하므로, 각 모듈의 외부
 * 포트 무한상자는 그 *모듈 자신의* perimeter ring 위에 앉는다. [modulePacking.packModuleTree]
 * 가 모듈들을 depth 열로 타일링하면 이 로컬 ring 들이 **전체 배치의 내부**로 들어가,
 * 외부상자가 블루프린트 곳곳(내부 채널)에 흩어진다. 합성 결과의 외부 물류 접점은 **전역
 * 외곽**에 있어야 하므로 살아남은 상자를 거기로 재배치한다.
 *
 * ## 방식 — 예약 lane 안 결정적 belt (블랙박스 모델)
 * 모듈은 블랙박스다. 경계에 포트(anchor·face) 하나를 노출하고, 내부 **트렁크**(port.cells)
 * 가 그 anchor 에서 N 머신으로 분배한다. 즉 외곽 상자를 트렁크의 끝점(anchor)에만 이으면
 * 되고, 어느 머신인지는 무관하다. [perimeterLanePlanner](./perimeterLanePlanner) 가 ⑥A 에서
 * 상자별로 **어느 외곽 변(exitEdge)·어느 gap(host)** 으로 나갈지 배정하고 그 lane 폭을
 * 채널에 예약했다. 여기(⑥C)선 그 배정대로 belt 를 **탐색 없이** 깐다 — lane 이 비어 있음이
 * 보장되므로:
 *   - **margin/self host**: anchor 에서 face 방향 **직선**으로 전역 외곽 변까지.
 *   - **channel host**(W/E 변 내부 열): face 방향으로 채널에 **가로 jog** → 채널 안에서
 *     가까운 N/S 변으로 **세로 주행**(ㄱ자). 채널의 빈 세로선(트랙)을 스캔해 고른다.
 * 상자를 그 변에 옮기고, anchor→seat 를 잇는 lane belt + feeder 를 추가한다. 내부 트렁크는
 * 그대로 둔다(belt-to-belt 로 연속).
 *
 * ## 안전(회귀 0) — skip-on-failure
 * lane 이 (예상외로) 막혔거나 배정이 미지원 케이스(N/S 변이 형제에 막혀 채널로 우회하는
 * 드문 경우)면 **그 상자만 건너뛴다** — 로컬 ring 에 원래 트렁크째 남아 물류는 정상(외곽
 * 대신 내부에 남을 뿐). 트리 전체를 폴백시키지 않아 모듈 경로가 유지된다(회귀 0). 절대
 * 가짜 물류(끊긴 belt·겹친 상자)를 만들지 않는다. 더 복잡한 결정적 경로가 실패했을 때의
 * 최후·직관 fallback 은 옛 경로의 `routeWithFallback` 로 남겨둔다(디버깅 용이).
 *
 * 순수 — Area·store 의존 0. pack 의 module 그래프를 제자리(in-place) 변형한다(갓 생성된
 * 데이터라 공유/영속 객체 아님). 단위 테스트로 검증.
 */

import type { ModulePort } from "../module/clusterModule";
import type { Container, PlacedCell, PortPair } from "../containerModel";
import { cellKey, faceVector, vectorToDirection } from "../util/helper";
import { makeBeltCell, makeInserterCell, makeContainerCell } from "../util/cellBuilder";
import { moduleExtent, type PackResult } from "./modulePacking";
import type { LaneAssignment } from "./perimeterLanePlanner";
import { routePortToPerimeter, type Rect } from "./perimeterRouter";
import { AUTO_LAYOUT_COORD_DUMP } from "../debugFlags";

export interface PerimeterPassConfig {
  beltEntityName: string;
  inserterEntityName: string;
}

/** 상자 하나의 이사 결과 — moduleWizard 가 Area/routing 에 반영한다. */
export interface ChestRelocation {
  /** 이사한 상자 id. */
  chestId: string;
  /** 새 위치(= seat = chest 셀 좌표). external.containers·routing 끝점이 쓴다. */
  origin: { x: number; y: number };
  /** 이 상자를 위해 깐 belt(라우팅 belt-following placed 에 트렁크 spine 뒤로 붙는다). */
  belts: PlacedCell[];
}

export interface PerimeterPassResult {
  ok: boolean;
  /** 전역 외곽으로 옮긴 상자 수. */
  relocated: number;
  /** 재배치 못해 *로컬 ring 에 그대로 둔* 상자 수(미지원 배정·lane 막힘). */
  skipped: number;
  /** 마지막 skip 사유(진단용). */
  reason?: string;
  /**
   * 떼어낼 옛 셀 좌표("x,y") — 이사한 상자의 옛 ghost(@anchor)·feeder(@anchor−fv).
   * moduleWizard 가 mod.cells 순회에서 이 좌표를 건너뛴다(모듈 그래프는 안 건드림).
   */
  droppedCellKeys: Set<string>;
  /** 새로 놓을 셀(belt + feeder + 이사한 chest 셀). moduleWizard 가 Area 로 분류한다. */
  addedCells: PlacedCell[];
  /** 상자별 이사 결과(origin·belts). */
  relocations: ChestRelocation[];
}

/**
 * 순서 있는 path 셀(트렁크쪽 → seat)을 belt+feeder+chest 로 깐다.
 * - belts: index 0..n-2, 흐름 방향으로 direction. input=트렁크쪽(0)으로, output=seat(n)로.
 * - feeder: index n-1 (belt↔chest 사이 인서터).
 * - chest: index n (= seat).
 * @param trunkNeighbor path[0] 안쪽으로 붙은 트렁크 헤드 셀(방향 계산용, input belt[0]가 향할 곳).
 */
function layPath(
  path: { x: number; y: number }[],
  trunkNeighbor: { x: number; y: number },
  isInput: boolean,
  chest: Container,
  config: PerimeterPassConfig,
): { belts: PlacedCell[]; feeder: PlacedCell; chestCell: PlacedCell } {
  const pair = pairFor(chest.id);
  const n = path.length - 1; // seat index
  const belts: PlacedCell[] = [];
  const dirTo = (from: { x: number; y: number }, to: { x: number; y: number }) =>
    vectorToDirection(Math.sign(to.x - from.x), Math.sign(to.y - from.y));

  for (let i = 0; i <= n - 2; i++) {
    const cell = path[i];
    // 흐름상 "다음" 셀: input=트렁크쪽(i-1, i==0이면 트렁크 헤드), output=seat쪽(i+1).
    const next = isInput ? (i === 0 ? trunkNeighbor : path[i - 1]) : path[i + 1];
    belts.push(makeBeltCell(cell, dirTo(cell, next), config.beltEntityName, pair));
  }
  // feeder 픽업: input=상자(seat)에서 집어 belt 로, output=belt 에서 집어 상자로.
  const feederCell = path[n - 1];
  const beltNeighbor = path[n - 2];
  const chestPos = path[n];
  const pickupTarget = isInput ? chestPos : beltNeighbor;
  const pickup = { x: Math.sign(pickupTarget.x - feederCell.x), y: Math.sign(pickupTarget.y - feederCell.y) };
  const feeder = makeInserterCell(feederCell, pickup, config.inserterEntityName, pair);

  // makeContainerCell 은 위치에 chestPos 만 쓴다(chest.origin 미참조) — 순수: chest 객체를
  // 건드리지 않고 새 좌표는 반환값(chestCell 위치 = relocation.origin)으로 넘긴다.
  const chestCell = makeContainerCell(chest, chestPos);
  return { belts, feeder, chestCell };
}

/** makeBeltCell/makeInserterCell 의 entityId 생성용 최소 PortPair. */
function pairFor(chestId: string): PortPair {
  const port = (id: string) =>
    ({ containerId: id, cell: { x: 0, y: 0 }, face: "N" as const, kind: "item" as const });
  return { producer: port(chestId), consumer: port(`${chestId}#perimeter`) };
}

/** 전 모듈 footprint + placed 셀 + 홉 belt 의 점유 집합. */
function buildOccupancy(pack: PackResult, hopCells: PlacedCell[]): Set<string> {
  const occ = new Set<string>();
  for (const pl of pack.placements) {
    for (const m of pl.module.machines)
      for (let dx = 0; dx < m.size.w; dx++)
        for (let dy = 0; dy < m.size.h; dy++)
          occ.add(cellKey(m.origin.x + dx, m.origin.y + dy));
    for (const c of pl.module.cells) occ.add(cellKey(c.x, c.y));
  }
  for (const c of hopCells) occ.add(cellKey(c.x, c.y));
  return occ;
}

/** 모든 모듈의 union extent(마진 제외 = 전역 외곽 변 기준). */
function unionBounds(pack: PackResult): { minX: number; minY: number; maxX: number; maxY: number } {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const pl of pack.placements) {
    const e = moduleExtent(pl.module);
    minX = Math.min(minX, e.x); minY = Math.min(minY, e.y);
    maxX = Math.max(maxX, e.x + e.w - 1); maxY = Math.max(maxY, e.y + e.h - 1);
  }
  return { minX, minY, maxX, maxY };
}

/** 전역 union 을 한 줄 바깥으로 확장한 perimeter 사각형(seat 이 앉는 변). */
function perimeterOf(u: { minX: number; minY: number; maxX: number; maxY: number }): Rect {
  return { minX: u.minX - 1, minY: u.minY - 1, maxX: u.maxX + 1, maxY: u.maxY + 1 };
}

/**
 * 살아남은 외부상자(stripped 아님)를 ⑥A lanePlan 배정대로 전역 perimeter 로 재배치할
 * **계획을 산정**한다. moduleHop 과 같은 규약: 모듈 그래프(mod.cells·port·chest)를 **건드리지
 * 않고**, 무엇을 떼고(droppedCellKeys) 무엇을 놓고(addedCells) 상자가 어디로 가는지
 * (relocations)를 **설명으로 반환**한다 — 적용은 호출자(moduleWizard)가 Area 를 지을 때 한다.
 * 실패한 상자만 skip(로컬 ring 유지) — 항상 ok:true.
 */
export function relocateChestsToPerimeter(
  pack: PackResult,
  strippedChestIds: Set<string>,
  hopCells: PlacedCell[],
  config: PerimeterPassConfig,
): PerimeterPassResult {
  const occ = buildOccupancy(pack, hopCells);
  const u = unionBounds(pack);
  const perimeter = perimeterOf(u);
  const asgById = new Map<string, LaneAssignment>();
  for (const a of pack.lanePlan.assignments) asgById.set(a.id, a);

  const droppedCellKeys = new Set<string>();
  const addedCells: PlacedCell[] = [];
  const relocations: ChestRelocation[] = [];
  let relocated = 0;
  let skipped = 0;
  let lastReason: string | undefined;
  const fail = (id: string, why: string) => {
    skipped += 1;
    lastReason = `${why} (chest ${id})`;
    if (AUTO_LAYOUT_COORD_DUMP) console.log("[perimeterPass] SKIP", id, why);
  };

  // 결정적: 상자 id 순.
  const ports: ModulePort[] = [];
  for (const pl of pack.placements)
    for (const port of [...pl.module.inputPorts, ...pl.module.outputPorts])
      if (!strippedChestIds.has(port.chest.id)) ports.push(port);
  ports.sort((a, b) => a.chest.id.localeCompare(b.chest.id));

  for (const port of ports) {
    const asg = asgById.get(port.chest.id);
    if (!asg) { fail(port.chest.id, "no lane assignment"); continue; }
    if (AUTO_LAYOUT_COORD_DUMP)
      console.log("[perimeterPass] TRY", port.chest.id, JSON.stringify({
        anchor: port.anchor, face: port.face,
        exitEdge: asg.exitEdge, host: asg.host, perimeter,
      }));

    const fv = faceVector(port.face);
    const anchor = { x: port.anchor.x, y: port.anchor.y };
    // 안쪽 방향(트렁크쪽) = −fv. 트렁크 헤드(tapAnchor) = anchor − 2·fv, 그 사이 셀 = anchor − fv.
    const trunkNeighbor = { x: anchor.x - 2 * fv.x, y: anchor.y - 2 * fv.y };
    // p0 = anchor−fv(옛 feeder 자리, 트렁크에 붙음). anchor(옛 chest 자리)와 함께 비워 belt 로 재사용.
    const p0 = { x: anchor.x - fv.x, y: anchor.y - fv.y };

    // 순수 라우터로 anchor→perimeter 경로 산정(lanePlan 배정을 hint 로 재현).
    let res = routePortToPerimeter({
      anchor,
      face: port.face,
      perimeter,
      obstacles: occ,
      hint: { exitEdge: asg.exitEdge, host: asg.host, laneX: asg.laneX },
    });
    // 예약 배정이 막힌 경우(예: 코너 어깨 상자 face=N/S 의 채널 우회가 자기 트렁크를
    // 관통 — planPerimeterLanes 는 좌표 확정 전이라 이를 못 봄) occ 를 실제로 보는 auto
    // 탐색으로 폴백한다. auto 는 face 변 직진을 먼저 시도하므로 대개 뚫린 face 로 나간다.
    // 홉의 dijkstra 최후폴백과 대칭 — skip 을 재배치로만 바꾸고(occ 검사라 겹침 0) 기존
    // 재배치는 건드리지 않는다. 그래도 막히면 skip(로컬 ring 유지, 회귀 0).
    if (!res.ok) {
      res = routePortToPerimeter({ anchor, face: port.face, perimeter, obstacles: occ });
    }
    if (!res.ok) { fail(port.chest.id, res.reason); continue; }

    // layPath 입력 = [p0, anchor, ...외곽경로]. p0/anchor 는 비운 자리(검사 제외됨).
    const path = [p0, anchor, ...res.path];

    const isInput = port.line.role === "input";
    const { belts, feeder, chestCell } = layPath(path, trunkNeighbor, isInput, port.chest, config);

    // ── 설명 축적(모듈 그래프 미변형) ──
    // 옛 chest ghost(@anchor)·feeder(@anchor−fv) 는 떼어낼 좌표로, 새 belt/feeder/chest 셀은
    // 놓을 셀로, 상자 새 위치·belt 는 relocation 으로 반환한다. occ 는 로컬로만 갱신해
    // 뒤 상자가 앞 상자의 belt 를 피하게 한다(결정성).
    droppedCellKeys.add(cellKey(anchor.x, anchor.y));
    droppedCellKeys.add(cellKey(p0.x, p0.y));
    addedCells.push(...belts, feeder, chestCell);
    for (const b of belts) occ.add(cellKey(b.x, b.y));
    occ.add(cellKey(feeder.x, feeder.y));
    occ.add(cellKey(chestCell.x, chestCell.y));

    relocations.push({
      chestId: port.chest.id,
      origin: { x: chestCell.x, y: chestCell.y },
      belts,
    });
    relocated += 1;
  }

  return { ok: true, relocated, skipped, reason: lastReason, droppedCellKeys, addedCells, relocations };
}
