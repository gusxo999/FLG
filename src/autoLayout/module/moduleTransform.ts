/**
 * moduleTransform — 한 모듈(GeneratedModule)을 강체(rigid block)로 회전/반사한다.
 *
 * 단일 출처: 본 설계안(클러스터 모듈화 — 합성 단계 정렬).
 *
 * 모듈은 부모-무시로 생성되므로([clusterModule.generateModule]) 출력 포트 면이 부모
 * 반대편에 설 수 있다. 합성 단계는 본 변환으로 모듈을 통째로 돌려 포트를 부모 쪽으로
 * 맞춘다. 정사각 대칭군 D4(회전 4 × 반사 0/1 = 8가지)를 **단일 2×2 정수행렬 M** 으로
 * 처리한다 — 셀 좌표·belt/인서터 방향·포트 면·머신 footprint 가 *모두 같은 M* 으로
 * 함께 돌아가므로 belt 흐름·인서터 픽업·머신 자리가 어긋나지 않는 유효 배치를 유지한다.
 *
 * 좌표계: 화면 좌표(y 아래로 증가). 시계방향 90° = rot(x,y)=(−y,x). 반사=세로축 거울
 * mirror(x,y)=(−x,y). M = reflect ? mirror∘rot^k : rot^k.
 *
 * 순수 함수 — gameDataStore·Area 의존 없음. 결과는 머신 bbox 좌상단을 다시 (0,0)으로
 * 정규화해 generateModule 과 **같은 규약의 드롭-인 모듈**로 돌려준다(ring/cells 의
 * 음수 상대좌표는 그대로 유지).
 */

import { EntityType } from "../../types/layout";
import type { Direction } from "../../types/layout";
import type { GeneratedModule, ModulePort } from "./clusterModule";
import type { Container, PlacedCell, PortFace } from "../containerModel";
import type { PipeFlowPipe } from "../util/pipeFlow";
import { faceVector, vectorToDirection } from "../util/helper";

export type Rotation = 0 | 90 | 180 | 270;

/** 모듈 방위 — 회전(시계방향) + 선택적 세로축 반사. 8가지(D4). */
export interface Orientation {
  rotation: Rotation;
  /** 세로축 거울(x→−x). 회전 *후* 적용. */
  reflect?: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// 행렬 적용 — 벡터/타일/방향/면
// ─────────────────────────────────────────────────────────────────────────────

/** 단위/일반 벡터에 회전^k(시계 90°) 후 반사 적용. (정수·반정수 보존.) */
function mvec(v: { x: number; y: number }, o: Orientation): { x: number; y: number } {
  let { x, y } = v;
  const k = (o.rotation / 90) % 4;
  for (let i = 0; i < k; i++) {
    const nx = -y;
    const ny = x;
    x = nx;
    y = ny;
  }
  if (o.reflect) x = -x;
  return { x, y };
}

/** 1×1 타일 인덱스 변환 — 타일 중심에 M 적용 후 −0.5(round 로 fp 흡수). */
function tileXf(x: number, y: number, o: Orientation): { x: number; y: number } {
  const m = mvec({ x: x + 0.5, y: y + 0.5 }, o);
  return { x: Math.round(m.x - 0.5), y: Math.round(m.y - 0.5) };
}

/** belt/인서터 방향(카디널) 변환. */
function dirXf(dir: Direction, o: Orientation): Direction {
  const m = mvec(vecFromDir(dir), o);
  return vectorToDirection(Math.round(m.x), Math.round(m.y));
}

/** 포트 면 변환. */
function faceXf(face: PortFace, o: Orientation): PortFace {
  const m = mvec(faceVector(face), o);
  return faceFromVec(Math.round(m.x), Math.round(m.y));
}

/** 머신/상자 footprint 변환 — 양 끝 모서리 타일을 변환해 새 origin·크기 산출. */
function footprintXf(
  origin: { x: number; y: number },
  size: { w: number; h: number },
  o: Orientation,
): { origin: { x: number; y: number }; size: { w: number; h: number } } {
  const t1 = tileXf(origin.x, origin.y, o);
  const t2 = tileXf(origin.x + size.w - 1, origin.y + size.h - 1, o);
  return {
    origin: { x: Math.min(t1.x, t2.x), y: Math.min(t1.y, t2.y) },
    size: { w: Math.abs(t1.x - t2.x) + 1, h: Math.abs(t1.y - t2.y) + 1 },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 진입점
// ─────────────────────────────────────────────────────────────────────────────

/** 방향을 가진 엔티티 종류(이들만 dir 을 회전; 상자 등은 dir 유지). */
const DIRECTIONAL = new Set<EntityType>([
  EntityType.Belt,
  EntityType.Inserter,
  EntityType.UndergroundBelt,
]);

/**
 * 모듈을 회전/반사. 머신 bbox 좌상단을 (0,0)으로 재정규화한 새 모듈을 반환한다.
 * entityId 는 보존(고유성만 필요; 합성 단계가 재-id) — 좌표 접미사는 stale 해질 수 있음.
 *
 * **호출자가 0 이다**(2026-08-05 확인) — `packModuleTree` 는 모든 모듈에 `IDENTITY` 를 준다.
 * 그래도 총 변환으로 유지한다: 방위 정렬을 되살리는 날 여기가 조용히 틀려 있으면 안 된다.
 */
export function transformModule(mod: GeneratedModule, o: Orientation): GeneratedModule {
  // 1) 재정규화량 — 회전 후 머신 bbox 좌상단이 (0,0) 이 되게. 좌표를 두 번 만들지 않도록
  //    footprint 만 먼저 돌려 min 을 구한다.
  let minX = Infinity, minY = Infinity;
  for (const m of mod.machines) {
    const fp = footprintXf(m.origin, m.size, o);
    minX = Math.min(minX, fp.origin.x);
    minY = Math.min(minY, fp.origin.y);
  }
  const dx = -minX, dy = -minY;

  // 2) 이 함수의 **유일한 좌표 변환** — 회전/반사 + 재정규화를 한 번에. 아래는 전부 이것만 쓴다.
  const pt = (p: { x: number; y: number }): { x: number; y: number } => {
    const t = tileXf(p.x, p.y, o);
    return { x: t.x + dx, y: t.y + dy };
  };
  const ctn = (c: Container): Container => {
    const fp = footprintXf(c.origin, c.size, o);
    return { ...c, origin: { x: fp.origin.x + dx, y: fp.origin.y + dy }, size: fp.size };
  };
  const cel = (p: PlacedCell): PlacedCell => {
    const t = pt(p);
    const cell = DIRECTIONAL.has(p.cell.entityType)
      ? { ...p.cell, direction: dirXf(p.cell.direction, o) }
      : { ...p.cell };
    return { x: t.x, y: t.y, cell };
  };

  const machines = mod.machines.map(ctn);
  const chestById = new Map<string, Container>();
  const chests = mod.chests.map((c) => { const s = ctn(c); chestById.set(s.id, s); return s; });

  // **스프레드를 쓰지 않는다 — 좌표 필드를 전부 명시한다.**
  // 예전엔 `...port` 로 폈다. 그러면 좌표와 무관한 필드(`meta`·`linkId`)는 지켜지지만
  // **좌표 필드를 빠뜨려도 타입이 통과한다** — 사라지는 대신 **낡은 값으로 살아남기**
  // 때문이다. 실제로 `tapAnchor`·`cells`·`moduleWayOuts`(면이라 회전해야 한다) 셋이
  // 안 돌아가고 있었다(2026-08-05). 명시하면 필드가 늘 때 **누락 필드 타입 에러**가 난다.
  const port = (p: ModulePort): ModulePort => ({
    line: p.line,
    anchor: pt(p.anchor),
    tapAnchor: pt(p.tapAnchor),
    face: faceXf(p.face, o),
    moduleWayOuts: p.moduleWayOuts.map((f) => faceXf(f, o)),
    chest: chestById.get(p.chest.id) ?? ctn(p.chest),
    cells: p.cells.map(cel),
    meta: p.meta,
    linkId: p.linkId,
  });

  // 3) 새 머신 bbox (정규화 후 min=0).
  let w = 0, h = 0;
  for (const m of machines) {
    w = Math.max(w, m.origin.x + m.size.w);
    h = Math.max(h, m.origin.y + m.size.h);
  }

  return {
    machines,
    chests,
    cells: mod.cells.map(cel),
    ring: mod.ring.map(pt),
    inputPorts: mod.inputPorts.map(port),
    outputPorts: mod.outputPorts.map(port),
    bbox: { x: 0, y: 0, w, h },
    supply: mod.supply,
    unroutedLines: mod.unroutedLines,
    // 지하파이프의 `connectDir` 은 **면**이므로 같이 돌아야 한다. 안 돌리면 합류 가드가
    // 엉뚱한 면 하나만 막고 나머지 셋을 뚫어 준다.
    pipeCells: mod.pipeCells.map((c): PipeFlowPipe => {
      const t = pt(c);
      return c.connectDir === undefined
        ? { x: t.x, y: t.y, fluid: c.fluid }
        : { x: t.x, y: t.y, fluid: c.fluid, connectDir: dirXf(c.connectDir, o) };
    }),
  };
}

/**
 * `from` 면을 `to` 면으로 보내는 회전(반사 없음). 합성 단계가 출력 포트를 부모
 * 방향으로 맞출 때 사용. (네 면 중 하나로 항상 도달 가능.)
 */
export function rotationToFace(from: PortFace, to: PortFace): Rotation {
  const target = faceVector(to);
  for (const rotation of [0, 90, 180, 270] as Rotation[]) {
    const m = mvec(faceVector(from), { rotation });
    if (m.x === target.x && m.y === target.y) return rotation;
  }
  return 0; // 도달 불가(발생 안 함) — 방어.
}

// ─────────────────────────────────────────────────────────────────────────────
// 카디널 ↔ 벡터
// ─────────────────────────────────────────────────────────────────────────────

function vecFromDir(dir: Direction): { x: number; y: number } {
  switch (((dir % 16) + 16) % 16) {
    case 0: return { x: 0, y: -1 };
    case 4: return { x: 1, y: 0 };
    case 8: return { x: 0, y: 1 };
    case 12: return { x: -1, y: 0 };
    default: return { x: 0, y: -1 }; // 비카디널(발생 안 함) — 방어.
  }
}

function faceFromVec(x: number, y: number): PortFace {
  const faces: PortFace[] = ["N", "E", "S", "W"];
  for (const f of faces) {
    const v = faceVector(f);
    if (v.x === x && v.y === y) return f;
  }
  return "N";
}

// ─────────────────────────────────────────────────────────────────────────────
// 평행이동·범위 — 회전과 같은 **강체 기하**다(무엇을 놓을지 고르지 않는다).
// 배열을 정하는 `planner/modulePacking` 에 있었으나, 하는 일은 모듈 하나를 통째로
// 다루는 것이라 여기가 맞다(2026-08-02 이관).
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 모듈이 차지하는 실제 범위 = 머신 footprint ∪ 모든 placed 셀(튀어나온 포트 상자 포함).
 *
 * `pipeCells` 를 안 보는 것은 **의도대로다** — 그 배열은 `cells` 의 파이프류 셀에 유체
 * 이름을 덧붙인 사본이라([emitTrunkPipe] 가 같은 자리에서 둘 다 채운다) 범위에 이미 들어 있다.
 * 여기에 더하면 같은 칸을 두 번 세는 것뿐이다.
 */
export function moduleExtent(mod: GeneratedModule): { x: number; y: number; w: number; h: number } {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const mk = (x: number, y: number) => {
    minX = Math.min(minX, x); minY = Math.min(minY, y);
    maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
  };
  for (const m of mod.machines) {
    mk(m.origin.x, m.origin.y);
    mk(m.origin.x + m.size.w - 1, m.origin.y + m.size.h - 1);
  }
  for (const c of mod.cells) mk(c.x, c.y);
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

/**
 * 모듈 하나를 통째로 평행이동한다 — **모듈-로컬(F0) → 레이아웃(F1) 경계를 넘는 유일한 문**.
 *
 * **스프레드를 쓰지 않는다 — 전 필드를 명시한다.** 예전엔 `...mod` / `...p` 로 폈다.
 * 그 스프레드는 *"필드를 하나씩 적어 재구성하면 좌표와 무관한 필드가 조용히 사라진다"* 는
 * 사고(2026-07-24 `beltMerges`·`supply`)를 막으려던 것인데, **좌표 필드에는 정반대로**
 * 작동한다: 빠뜨려도 사라지지 않고 **낡은 좌표로 살아남는다.** 타입도 테스트도 통과한다.
 *
 * 실제로 `pipeCells` 가 그렇게 F0 에 남아, 모든 모듈의 파이프 셀이 원점 근처로 겹쳐 쌓였다.
 * 합류 가드가 남남 모듈의 다른 유체 파이프를 같은 칸에서 보고 **서로를 hard 위반으로
 * 거절**해 배치가 통째로 실패했다(2026-08-05 `battery` 트리).
 *
 * 명시하면 `GeneratedModule` 에 필드가 늘 때 **누락 필드 타입 에러**가 난다 — 잃는 쪽은
 * 타입이 잡아 주지만, 잊는 쪽은 아무도 안 잡아 준다.
 */
export function shiftModule(mod: GeneratedModule, dx: number, dy: number): GeneratedModule {
  const pt = (p: { x: number; y: number }) => ({ x: p.x + dx, y: p.y + dy });
  const ctn = (c: Container): Container => ({ ...c, origin: pt(c.origin) });
  const cel = (c: PlacedCell): PlacedCell => ({ x: c.x + dx, y: c.y + dy, cell: c.cell });
  const chestById = new Map<string, Container>();
  const chests = mod.chests.map((c) => { const s = ctn(c); chestById.set(s.id, s); return s; });
  const port = (p: ModulePort): ModulePort => ({
    line: p.line,
    anchor: pt(p.anchor),
    tapAnchor: pt(p.tapAnchor),
    // 면·역할은 평행이동에 불변이다(방향은 안 바뀐다).
    face: p.face,
    moduleWayOuts: p.moduleWayOuts,
    chest: chestById.get(p.chest.id) ?? ctn(p.chest),
    cells: p.cells.map(cel),
    meta: p.meta,
    linkId: p.linkId,
  });
  return {
    machines: mod.machines.map(ctn),
    chests,
    cells: mod.cells.map(cel),
    ring: mod.ring.map(pt),
    inputPorts: mod.inputPorts.map(port),
    outputPorts: mod.outputPorts.map(port),
    bbox: { x: mod.bbox.x + dx, y: mod.bbox.y + dy, w: mod.bbox.w, h: mod.bbox.h },
    supply: mod.supply,
    unroutedLines: mod.unroutedLines,
    // `connectDir` 은 면이라 평행이동에 불변 — 좌표만 옮긴다.
    pipeCells: mod.pipeCells.map((c): PipeFlowPipe => ({ ...c, x: c.x + dx, y: c.y + dy })),
  };
}
