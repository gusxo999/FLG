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

import { planClusterPorts, type IoLine } from "./clusterPortPlanner";
import { layoutCluster } from "./clusterLayout";
import type { Container, ModulePortMeta, PlacedCell, PortFace } from "../containerModel";
import { cellKey, enumeratePerimeterCells, faceVector } from "../util/helper";
import { makeContainerCell } from "../util/cellBuilder";
import { emitTrunk, type TrunkMode } from "./trunkEmit";
import { computeTrunkPath, type MachineLike, type TrunkPath } from "./trunkPath";

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

  const machineLikes: MachineLike[] = machines.map((m) => ({
    id: m.id,
    origin: { ...m.origin },
    size: { ...m.size },
  }));

  // 누적 occupancy — 머신 footprint 는 computeTrunkPath 가 자동 추가하므로, 여기엔
  // 앞선 line 이 깐 트렁크/인서터/상자 셀만 모은다(다음 line 이 피해 가도록).
  const occupancy = new Set<string>();
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
  const plan = planClusterPorts({
    lines: beltLines,
    caps: { hasNormal: true, hasLong: !!input.longInserter },
    outputSide: "W", // 좌우 계층형: 부모=좌=W. 출력을 W 에 먼저 확정((B) 정책).
    throughput: input.throughput, // depth=운반량 매칭(미지정이면 등장순서).
    nsFaces: input.nsExposure, // 노출 끝면 — external 입력의 W-spill 완화(E→N/S→W).
  });
  if (!plan.ok) {
    for (const l of beltLines) unroutedLines.push(l);
    return { machines, chests, cells, ring, inputPorts, outputPorts, bbox, unroutedLines };
  }

  let seq = 0;
  for (const planned of plan.lines) {
    const line = planned.line;
    // 이 줄의 모든 머신을 배정된 면·reach 로 못박는다 — 트렁크가 그 슬롯에만 안착.
    const reach = planned.inserter === "long" ? (input.longInserter?.reach ?? 2) : 1;
    const faceConstraints = new Map(
      machineLikes.map((m) => [m.id, { face: planned.side as PortFace, reach }] as const),
    );

    const result = computeTrunkPath({
      machines: machineLikes,
      occupancy,
      chestCandidates: ring,
      config: { longReach: input.longInserter?.reach },
      faceConstraints,
      endPreference: input.lineEnds?.get(`${line.role}:${line.name}`),
    });
    if (!result.ok || result.path.untapped.length > 0) {
      unroutedLines.push(line); // 슬롯 보장에도 실패하면 위임(진단 신호).
      continue;
    }

    const path = result.path;
    const chestId = `${prefix}-${line.role}-${line.name}-${seq++}`;
    const mode: TrunkMode = line.role === "input" ? "supply" : "collect";
    const emission = emitTrunk(path, {
      chestId,
      beltEntityName: input.beltEntityName,
      inserterEntityName: input.inserterEntityName,
      longInserterEntityName:
        input.longInserter?.entityName ?? input.inserterEntityName,
      mode,
    });

    const chest: Container = {
      id: chestId,
      kind: "infinity-chest",
      entityName: "infinity-chest",
      origin: { ...path.chestCell },
      size: { w: 1, h: 1 },
      content: line.name,
      role: line.role,
    };
    chests.push(chest);

    const lineCells: PlacedCell[] = [
      makeContainerCell(chest, path.chestCell),
      ...emission.beltCells,
      ...(emission.feeder ? [emission.feeder] : []),
      ...emission.taps.map((t) => t.inserter),
    ];
    for (const c of lineCells) {
      cells.push(c);
      occupancy.add(cellKey(c.x, c.y));
    }

    const face = outwardFace(path);
    const fv = faceVector(face);
    const port: ModulePort = {
      line,
      anchor: { ...path.chestCell },
      // machine-side = anchor 에서 안쪽(−face) 2칸. chest→inserter→belt 순서의 첫 belt.
      tapAnchor: { x: path.chestCell.x - 2 * fv.x, y: path.chestCell.y - 2 * fv.y },
      face,
      chest,
      cells: [...emission.beltCells], // 트렁크 belt spine — Routing.placed 로 belt-following.
      meta: {
        item: line.name,
        side: planned.side,
        laneDepth: planned.depth,
        inserter: planned.inserter,
        amount: line.amount,
        endPreference: input.lineEnds?.get(`${line.role}:${line.name}`),
        trunkScore: path.selectionDebug,
      },
    };
    if (line.role === "output") outputPorts.push(port);
    else inputPorts.push(port);
  }

  return {
    machines,
    chests,
    cells,
    ring,
    inputPorts,
    outputPorts,
    bbox,
    unroutedLines,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 헬퍼
// ─────────────────────────────────────────────────────────────────────────────

/** 트렁크 종착 셀(ring)에서 바깥을 향하는 면(= 클러스터 반대 방향). */
function outwardFace(path: TrunkPath): PortFace {
  const start = path.trunkCells[0];
  if (!start) return "N";
  // inward = chestCell → trunkStart (클러스터 향). 바깥 = 그 반대.
  const out = {
    x: -Math.sign(start.x - path.chestCell.x),
    y: -Math.sign(start.y - path.chestCell.y),
  };
  const faces: PortFace[] = ["N", "E", "S", "W"];
  for (const f of faces) {
    const v = faceVector(f);
    if (v.x === out.x && v.y === out.y) return f;
  }
  return "N";
}
