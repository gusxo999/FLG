/**
 * clusterModule — 한 레시피 노드의 N대 머신을 **부모-무시 자족 모듈**로 생성한다.
 *
 * 단일 출처: 본 설계안(모듈 출력 경계 / 클러스터 모듈화).
 *
 * ## 왜 "루트처럼"
 * 자식 클러스터를 만들 때 부모를 전혀 보지 않고, 클러스터 자신을 루트로 간주한다 —
 * 입력은 전부 외부 소스(무한상자), 출력은 자기 perimeter ring 으로 수집. 그 결과
 * 모듈은 **자기 ring 위에 입·출력 포트**를 갖는 불투명 블록이 된다. 부모 연결은
 * 합성 단계가 포트끼리 잇는다(별도 단계).
 *
 * ## 헤어핀이 구조적으로 불가능한 이유
 * 깨졌던 [clusterTrunkMerge] 는 트렁크 종착을 **부모 머신**(레이아웃 반대편 끝)으로
 * 잡아, visitOrder 가 반대 끝까지 올라갔다 되돌아오는 U자를 만들었다. 본 모듈은
 * 종착 후보를 **클러스터 자신의 ring**(enumeratePerimeterCells, 자기 bbox)으로 둔다
 * — 이는 검증된 [externalMergePass] 의 전역 ring 패턴을 한 클러스터로 좁힌 것이며,
 * 트렁크가 레이아웃을 가로지르지 않고 자기 변에서 끝난다. 새 라우팅 로직 0.
 *
 * v1 범위: 아이템 belt 만(유체 line 은 unrouted 로 위임). 직접 탭(untapped 0) 실패
 * line 도 unrouted. 배선 전이라 레이아웃 회귀 0 — 단위 테스트로만 검증.
 */

import {
  planClusterPorts,
  planClusterSupply,
  type IoLine,
  type PlannedSide,
  type SupplyCapacity,
  type SupplyDecision,
} from "./clusterPortPlanner";
import { layoutCluster } from "./clusterLayout";
import type { Container, ModulePortMeta, PlacedCell, PortFace, PortPair } from "../containerModel";
import { cellKey, enumeratePerimeterCells, faceVector } from "../util/helper";
import { makeContainerCell, makeInserterCell } from "../util/cellBuilder";

/**
 * 모듈 머신 사이 세로 gap = 0(밀착). 모듈은 **간단 레시피**(W/E 두 면만으로 모든 I/O 를
 * 처리 — demand ≤ 용량이 구조적으로 보장)만 다루므로 N/S 면을 안 쓴다. 트렁크는 W/E 변을
 * 따라 세로로 흐르고 인서터 좌석도 각 머신 면(3칸) 안에 들어가, 머신 사이 공백은 트렁크
 * belt 길이만 늘릴 뿐 아무 기능이 없다 → 밀착. (N/S spill 이 있는 옛 라이브 경로는 ROW_GAP=3
 * 유지.) 복잡 레시피(2D)가 도입되면 그 경로가 자기 gap 을 따로 정한다.
 */
const MODULE_ROW_GAP = 0;

/** 한 모듈 포트 — ring 위 한 점에서 모듈이 외부와 만난다(입력 또는 출력). */
export interface ModulePort {
  /** 이 포트가 운반하는 I/O 줄(품목 + 역할). */
  line: IoLine;
  /** ring 셀 = 모듈 경계 anchor(= 무한상자가 앉는 자리). */
  anchor: { x: number; y: number };
  /**
   * machine-side 탭 셀 = anchor 에서 2칸 안쪽(= 첫 트렁크 belt 셀). anchor 는 chest 가
   * 앉는 ring 자리라, Routing 의 machine 끝점으로 anchor 를 쓰면 chest 끝점과 겹쳐
   * from==to 가 된다. tapAnchor 를 machine 끝점으로 써서 선이 chest↔machine 으로
   * 제대로 이어지게 한다. anchor−2·faceVector(face) 로 결정적·불변(드래그 반전 시
   * chest-side face 는 chest↔tapAnchor 벡터에서 유도). */
  tapAnchor: { x: number; y: number };
  /** 바깥 방향 면(클러스터 → ring). 합성 시 부모 쪽으로 회전 정렬할 기준. */
  face: PortFace;
  /**
   * **moduleWayOuts** — 이 포트의 반출 벨트가 **모듈 자기 몸통**(머신 + 자기/형제 포트의
   * 트렁크·인서터·상자 셀)에 막히지 않고 밖으로 빠져나갈 수 있는 방향들.
   *
   * anchor 에서 각 방향으로 직선을 쏴, 모듈 자기 extent 를 벗어날 때까지 자기 셀에
   * 한 번도 안 막히면 그 방향이 들어간다. 모듈이 **자기 자신에 대해** 답하므로
   * (모듈 = 블랙박스), planner 는 모듈 내부를 들여다보지 않고 이 목록만 본다.
   *
   * 왜 필요한가: 반출 경로 예약([perimeterLanePlanner])이 `meta.side` 만 보고 배정하면
   * 코너 어깨 상자처럼 **그 방향이 형제 트렁크에 막힌** 경우를 못 보고 **못 쓰는 경로를
   * 예약**한다(채널 폭만 낭비되고 방출은 탐색 폴백에 떠넘겨짐). wayOuts 를 주면 예약이
   * 애초에 **뚫린 방향만** 고르므로 "탐색 없이 항상 방출 가능"이라는 예약 철학이 지켜진다.
   *
   * 좌표 무관: 모듈-로컬로 계산해도 방향은 평행이동에 불변이라 절대좌표에서도 그대로 유효.
   */
  moduleWayOuts: PortFace[];
  /** anchor 에 놓인 무한상자(루트 가정의 외부 소스/싱크). 합성 시 벨트 홉으로 교체. */
  chest: Container;
  /** 이 포트의 트렁크 belt 셀(spine). Routing.placed 로 써서 선이 벨트를 따라가게 한다. */
  cells: PlacedCell[];
  /** 산출 근거(planner 슬롯 + 트렁크 seed 점수) — 표시·진단 전용, 좌표 없음. */
  meta: ModulePortMeta;
}

export interface GeneratedModule {
  /** 배치된 머신들(모듈-로컬 좌표). */
  machines: Container[];
  /** 포트 무한상자들(입력 source + 출력 sink). */
  chests: Container[];
  /** 트렁크 belt + 인서터 + 상자 ghost 셀(모듈-로컬 좌표). */
  cells: PlacedCell[];
  /** 클러스터 자기 perimeter ring 셀(종착 후보). */
  ring: { x: number; y: number }[];
  /** 입력 포트들(외부 소스 → 머신). */
  inputPorts: ModulePort[];
  /** 출력 포트들(머신 → 외부 싱크). v1 간단 레시피는 보통 1개. */
  outputPorts: ModulePort[];
  /** 머신 bbox(ring 기준). 모듈-로컬에서 항상 {x:0,y:0,...}. */
  bbox: { x: number; y: number; w: number; h: number };
  /**
   * 이 모듈의 공급 방식 판정([planClusterSupply]) — "tap"(트렁크로 합칠 수 있다) 또는
   * "direct"(1:1 로 남는다) + 거절 사유. **방출기(③) 도착 전까지 판정은 보고만 되고
   * 실제 방출은 늘 다이렉트다** — 계측기가 "몇 모듈이 트렁크가 될 수 있나"를 세는 데 쓴다.
   */
  supply?: SupplyDecision;
  /** 직접 탭/라우팅에 실패한 line(유체·미탭) — 진단용. */
  unroutedLines: IoLine[];
}

export interface ModuleInput {
  /** 머신 prototype + footprint. */
  machine: { entityName: string; w: number; h: number };
  /** 머신 대수(≥ 1). */
  count: number;
  /** 레시피 I/O 줄(입력=ingredients, 출력=products). 등장 순서 보존. */
  lines: IoLine[];
  /** 일반 인서터(reach 1) prototype — 늘 존재 가정. */
  inserterEntityName: string;
  beltEntityName: string;
  /** 긴팔(reach≥2) — 있으면 면당 2레인(용량 4). 없으면 면당 1레인(용량 2). */
  longInserter?: { entityName: string; reach: number };
  /** 인서터별 실제 throughput(items/sec) — depth=운반량 매칭의 슬롯 용량. 미지정=등장순서. */
  throughput?: { normal: number; long: number };
  /** entity id 접두사(결정적). 기본 "mod". */
  idPrefix?: string;
  /**
   * 줄별 포트 끝(DOF-B) 선호 — 키 `${role}:${name}`, 값 "min"(축 작은 끝=위) / "max"
   * (아래). 합성 단계(packModuleTree)가 tidy-tree Y 로 부모↔자식 포트를 마주 보게
   * 정렬할 때 채운다. 미지정 줄은 기존 동작(끝 무선호).
   */
  lineEnds?: Map<string, "min" | "max">;
  /**
   * 노출된 끝면(N/S, 선호 순서) — count=1 완화. external 입력이 W-spill 전에 이 면의
   * 레인을 쓴다(planner E→N/S→W). 노출 판정(열의 끝 + 전역 마진 방향)은 packModuleTree
   * 가 DFS 열-내 순서에서 유도한다. 미지정=기존 동작(W/E 만).
   */
  nsExposure?: ("N" | "S")[];
  /**
   * 트렁크(탭 인서팅) 용량 — 있으면 [planClusterSupply] 의 용량 관문이 켜진다.
   * 미지정이면 레인 관문만 본다(없는 숫자를 지어내지 않는다).
   */
  supplyCapacity?: SupplyCapacity;
}

/**
 * 한 클러스터를 자족 모듈로 생성. 입력 line 은 supply 트렁크, 출력 line 은 collect
 * 트렁크로 자기 ring 까지 깐다. 각 트렁크의 종착 ring 셀 = 그 line 의 포트 anchor.
 *
 * 결정적: [clusterPortPlanner] 가 줄마다 슬롯(면 W/E·레인 near/far·인서터)을 먼저
 * 못박고, 각 트렁크를 그 슬롯에만 가둔다(faceConstraints). 누적 occupancy 로 같은 면
 * 두 레인의 seat 행이 겹치지 않게 한다. 슬롯은 columnTapCapacity 로 보장돼 미탭 불가.
 */
export function generateModule(input: ModuleInput): GeneratedModule {
  const prefix = input.idPrefix ?? "mod";
  const layout = layoutCluster(
    {
      w: input.machine.w,
      h: input.machine.h,
      count: Math.max(1, input.count),
    },
    MODULE_ROW_GAP,
  );

  const machines: Container[] = layout.positions.map((pos, i) => ({
    id: `${prefix}-m${i}`,
    kind: "machine",
    entityName: input.machine.entityName,
    origin: { x: pos.dx, y: pos.dy },
    size: { w: input.machine.w, h: input.machine.h },
  }));

  const bbox = { x: 0, y: 0, w: layout.size.w, h: layout.size.h };
  const ring = enumeratePerimeterCells(bbox);

  // 점유 셀 — 머신 footprint + 이미 놓은 상자·인서터. 1:1 은 슬롯이 겹치지 않아
  // 충돌이 구조적으로 없지만, 안전망으로 유지한다.
  const occupancy = new Set<string>();
  for (const m of machines)
    for (let dx = 0; dx < m.size.w; dx++)
      for (let dy = 0; dy < m.size.h; dy++) occupancy.add(cellKey(m.origin.x + dx, m.origin.y + dy));
  const cells: PlacedCell[] = [];
  const chests: Container[] = [];
  const inputPorts: ModulePort[] = [];
  const outputPorts: ModulePort[] = [];
  const unroutedLines: IoLine[] = [];

  // 유체(pipe) 줄은 v1 미지원 — 직접 위임(planner 도 pipe 면 complex 반환).
  const beltLines = input.lines.filter((l) => l.kind === "belt");
  for (const l of input.lines) if (l.kind !== "belt") unroutedLines.push(l);

  // 안내원(planner): 보장된 columnTapCapacity 슬롯을 줄마다 1:1 못박는다
  // (natural-divergence 대체). 각 줄 → {면 W/E, 레인 near/far, 인서터}. 결과 순서가
  // 곧 처리 순서(입력 먼저·near 면부터). complex(과용량·무인서터)면 전부 위임.
  // 공급 방식 판정(docs/auto-layout-wizard.trunk-redesign.md §10) — 트렁크로 합칠 수
  // 있으면 "tap", 안 되면 "direct"(1:1). 거절은 **항상 안전**하다: 1:1 은 구성으로 성립한다.
  //
  // slotsPerFace = 다이렉트 인서팅의 면 용량(그 면의 둘레 칸 수). 이 수는 아래 방출 루프의
  // `lateral`(슬롯 상한)과 **같아야** 한다 — 어긋나면 planner 가 없는 자리를 배정하거나
  // (미탭) 있는 자리를 안 쓴다(스필). 탭 인서팅(면당 2)을 1:1 에 쓰면 3×3 머신의 셋째
  // 입력이 자리가 남는데도 출력면(W)으로 넘친다. (용어: docs/용어사전.md §D)
  const plannerInput = {
    lines: beltLines,
    caps: { hasNormal: true, hasLong: !!input.longInserter },
    outputSide: "W" as const, // 좌우 계층형: 부모=좌=W. 출력을 W 에 먼저 확정((B) 정책).
    throughput: input.throughput, // depth=운반량 매칭(미지정이면 등장순서).
    nsFaces: input.nsExposure, // 노출 끝면 — external 입력의 W-spill 완화(E→N/S→W).
    slotsPerFace: { WE: input.machine.h, NS: input.machine.w },
  };
  const supply: SupplyDecision = planClusterSupply(
    plannerInput,
    machines.length,
    input.supplyCapacity,
  );

  // ③(트렁크 방출기)이 아직 없다 — 판정이 "tap" 이어도 **지금 깔 줄은 다이렉트다.**
  // 판정은 결과에 실어 보고만 한다(계측기가 "몇 모듈이 트렁크가 될 수 있나"를 센다).
  // ③이 들어오면 이 세 줄이 `supply.mode` 로 갈라진다.
  const plan = supply.mode === "direct" ? supply.plan : planClusterPorts(plannerInput);
  if (!plan.ok) {
    for (const l of beltLines) unroutedLines.push(l);
    return { machines, chests, cells, ring, inputPorts, outputPorts, bbox, unroutedLines, supply };
  }

  // ── 1:1 방출 ────────────────────────────────────────────────────────────────
  // 트렁크(여러 머신이 벨트 한 줄을 나눠 탭)는 **비활성**이다. 머신 하나하나가 품목마다
  // 자기 상자·자기 인서터를 갖는다(docs/auto-layout-wizard.trunk-redesign.md).
  //
  // 한 (머신, 품목) = 두 칸뿐이다:
  //     [상자] [인서터] [머신 …]      (W 면 예: x=-2, x=-1, x=0..2)
  // 같은 면의 줄들은 **서로 다른 행**(슬롯)을 쓰므로 절대 부딪히지 않는다 — 자리 잡기가
  // 곧 성공이고, 탐색이 없고, 실패 케이스가 존재하지 않는다. 상자 바깥쪽은 늘 비어 있어
  // **모든 포트의 바깥 탈출로가 구성으로 보장**된다(우선순위 ②).
  //
  // 트렁크는 나중에 **이 1:1 경로들을 합치는 최적화**로 되돌아온다 — 그때 이 방출기는
  // 병합기의 입력이 되므로 버려지지 않는다. 그래서 일부러 멍청하게 유지한다.
  const slotOnFace = new Map<PlannedSide, number>(); // 면별로 소비한 행/열 슬롯 수
  let seq = 0;
  for (const planned of plan.lines) {
    const line = planned.line;
    const face = planned.side as PortFace;
    const fv = faceVector(face);
    const lateral = face === "W" || face === "E" ? input.machine.h : input.machine.w;
    const slot = slotOnFace.get(planned.side) ?? 0;
    if (slot >= lateral) {
      unroutedLines.push(line); // 이 면에 남은 행이 없다 — 형태(2D)가 필요하다는 신호.
      continue;
    }
    slotOnFace.set(planned.side, slot + 1);

    for (const m of machines) {
      // 인서터가 앉는 머신 둘레 칸(rim) — 면 위에서 slot 번째.
      const seat = rimCell(m, face, slot);
      const chestAt = { x: seat.x + fv.x, y: seat.y + fv.y };
      if (occupancy.has(cellKey(seat.x, seat.y)) || occupancy.has(cellKey(chestAt.x, chestAt.y))) {
        continue; // 기둥 중간 머신의 N/S 면 등 — 슬롯 모델상 안 생기지만 안전망.
      }

      const chestId = `${prefix}-${line.role}-${line.name}-${seq++}`;
      const chest: Container = {
        id: chestId,
        kind: "infinity-chest",
        entityName: "infinity-chest",
        origin: { ...chestAt },
        size: { w: 1, h: 1 },
        content: line.name,
        role: line.role,
      };
      chests.push(chest);

      // 인서터 방향 = **집는 쪽**(cellBuilder 규약). 입력이면 상자(바깥)에서 집어 머신에
      // 넣고, 출력이면 머신(안쪽)에서 집어 상자에 놓는다.
      const pickup = line.role === "input" ? fv : { x: -fv.x, y: -fv.y };
      const pair: PortPair = {
        producer: { containerId: line.role === "input" ? chestId : m.id, cell: { ...seat }, face, kind: "item" },
        consumer: { containerId: line.role === "input" ? m.id : chestId, cell: { ...seat }, face, kind: "item" },
      };
      const lineCells: PlacedCell[] = [
        makeContainerCell(chest, chestAt),
        makeInserterCell(seat, pickup, input.inserterEntityName, pair),
      ];
      for (const c of lineCells) {
        cells.push(c);
        occupancy.add(cellKey(c.x, c.y));
      }

      const port: ModulePort = {
        line,
        anchor: { ...chestAt },
        // machine-side 끝점 = anchor 에서 안쪽 2칸 = 머신 가장자리 칸. Routing 선이
        // chest↔machine 으로 이어지게 한다(from==to 방지). 벨트가 없어도 규약은 같다.
        tapAnchor: { x: chestAt.x - 2 * fv.x, y: chestAt.y - 2 * fv.y },
        face,
        // 전 포트 emit 후 한꺼번에 채운다(아래 fillModuleWayOuts).
        moduleWayOuts: [],
        chest,
        cells: [], // 모듈 안에 벨트가 없다 — 트렁크 spine 부재.
        meta: {
          item: line.name,
          side: planned.side,
          laneDepth: 2, // 상자는 머신 면에서 늘 2칸(인서터 1 + 상자 1).
          inserter: "normal", // 1:1 은 reach 1 로 충분 — 긴팔 불필요.
          amount: line.amount,
          endPreference: input.lineEnds?.get(`${line.role}:${line.name}`),
        },
      };
      if (line.role === "output") outputPorts.push(port);
      else inputPorts.push(port);
    }
  }

  // 전 포트 emit 완료 → 모듈 몸통이 확정됐으니 각 포트의 moduleWayOuts 를 채운다.
  fillModuleWayOuts(machines, cells, [...inputPorts, ...outputPorts]);

  return {
    machines,
    chests,
    cells,
    ring,
    inputPorts,
    outputPorts,
    bbox,
    unroutedLines,
    supply,
  };
}

/**
 * 각 포트의 [ModulePort.moduleWayOuts] 를 채운다 — 모듈이 **자기 몸통**을 근거로
 * "이 포트가 어느 쪽으로 나갈 수 있나"에 답하는 자리.
 *
 * 몸통 = 머신 footprint + 모든 placed 셀(트렁크·인서터·상자 ghost). 상자 ghost 와 그
 * 인서터도 장애물로 센다 — 재배치 때 그 두 칸은 belt 로 다시 깔리므로(modulePerimeterPass
 * 가 path=[feeder, anchor, …] 로 재사용) **여전히 점유 상태**이기 때문이다.
 *
 * 판정: anchor 바로 다음 칸부터 그 방향으로 걸어가며, 몸통 extent 안에 있는 동안 한 칸도
 * 막히지 않고 extent 를 벗어나면 그 방향은 "나갈 수 있다". extent 밖 = 모듈 바깥(채널·마진)
 * 이라 여기선 관심 없다(그쪽은 채널 장부가 따로 예약한다).
 */
function fillModuleWayOuts(
  machines: Container[],
  cells: PlacedCell[],
  ports: ModulePort[],
): void {
  const occ = new Set<string>();
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const mark = (x: number, y: number) => {
    occ.add(cellKey(x, y));
    minX = Math.min(minX, x); minY = Math.min(minY, y);
    maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
  };
  for (const m of machines)
    for (let dx = 0; dx < m.size.w; dx++)
      for (let dy = 0; dy < m.size.h; dy++) mark(m.origin.x + dx, m.origin.y + dy);
  for (const c of cells) mark(c.x, c.y);

  const FACES: PortFace[] = ["N", "E", "S", "W"];
  for (const port of ports) {
    const wayOuts: PortFace[] = [];
    for (const face of FACES) {
      const fv = faceVector(face);
      let x = port.anchor.x + fv.x;
      let y = port.anchor.y + fv.y;
      let clear = true;
      // 몸통 extent 안에 있는 동안만 검사 — 벗어나면 탈출 성공.
      while (x >= minX && x <= maxX && y >= minY && y <= maxY) {
        if (occ.has(cellKey(x, y))) { clear = false; break; }
        x += fv.x;
        y += fv.y;
      }
      if (clear) wayOuts.push(face);
    }
    port.moduleWayOuts = wayOuts;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 헬퍼
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 머신 둘레(rim) 칸 하나 — `face` 면 위에서 `slot` 번째. 인서터가 여기 앉는다.
 * W/E 면은 행이 `h` 개, N/S 면은 열이 `w` 개 → 그게 그 면의 1:1 슬롯 수다.
 */
function rimCell(m: Container, face: PortFace, slot: number): { x: number; y: number } {
  const { x, y } = m.origin;
  const { w, h } = m.size;
  switch (face) {
    case "W": return { x: x - 1, y: y + slot };
    case "E": return { x: x + w, y: y + slot };
    case "N": return { x: x + slot, y: y - 1 };
    case "S": return { x: x + slot, y: y + h };
  }
}
