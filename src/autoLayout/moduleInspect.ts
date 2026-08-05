/**
 * moduleInspect — 적용된 레이아웃에서 "모듈"(자족 클러스터) 단위 정보를 유도하는 단일 출처.
 *
 * 모듈 식별 키 = 머신 id 에서 `-m{index}` 접미사를 뗀 나머지. 모듈 파이프라인이
 * 머신 id 를 `${moduleId}-m${j}` 로 생성하므로(clusterModule.generateModule) 접미사
 * 제거가 곧 클러스터 단위다.
 *
 * pixi-renderer(테두리·포트 강조·연결선 렌더)와 ModuleInfoPanel(React 정보 창),
 * RoutingConnectionModal 이 함께 쓴다.
 *
 * ## 운반체는 인자로 받는다 — store 를 안 본다 (2026-08-04)
 *
 * 예전엔 `useLayoutStore.getState().routingEditSession` 을 직접 읽었다. 그런데 그 세션을
 * **만드는 코드가 사라져**(manualEdit 격리, Phase 5) `setRoutingEditSession` 의 호출자가
 * 0 이 됐고, 세션이 영구히 `null` 이라 이 파일의 모든 산출물이 **빈 배열**이었다. 그 결과
 * 모듈 테두리·이름표·포트 강조·연결선이 프로덕션에서 **한 번도 그려지지 않았고**,
 * 이름표 클릭이 유일한 입구인 `ModuleInfoPanel` 은 **열릴 방법이 없었다.**
 *
 * 이제 운반체를 [ModuleSource] 로 받는다. 실행 결과(`CandidateLeaf` + `unifyAreas` 의
 * offset)가 세션이 나르던 것을 그대로 갖고 있어서, 원천만 갈아 끼우면 위가 전부 살아난다.
 * 이 파일은 store 의존이 0 인 순수 함수 모음이 됐다.
 */

import type {
  Container,
  ModulePortMeta,
  PortKind,
  Routing,
} from "./containerModel";
import type { LayoutIssue, LayoutSnapshot } from "./layoutIssue";

/**
 * 오버레이가 그릴 대상 — **표시에 필요한 것만**.
 *
 * 옛 `RoutingEditSession` 은 여기에 더해 드래그용(`machineChildren`·`routeOptions`·
 * mutate 되는 `liveArea`)을 날랐다. 그쪽은 manualEdit 격리 구역이라 되살리지 않는다.
 */
export interface ModuleSource {
  /** 머신 + 외부 상자/파이프. 좌표는 레이아웃 좌표계. */
  containers: readonly Container[];
  /** 이 배치의 라우팅 전부(`placed` 셀 경로 포함). */
  routings: readonly Routing[];
  /** 레이아웃 좌표 → 그리드 좌표. `unifyAreas(...).offset` 이 단일 진실. */
  offset: { x: number; y: number };
}

/**
 * 라우팅 요약 — 끝점 **식별자**만 필요한 곳(연결선 색·I/O 역할·정보 모달)이 쓴다.
 * 전체 [Routing] 에서 기계적으로 유도되므로 별도 자료를 들고 다니지 않는다.
 */
export interface RoutingSummary {
  id: string;
  portKind: PortKind;
  fromContainerId: string;
  toContainerId: string;
}

export function summarizeRoutings(routings: readonly Routing[]): RoutingSummary[] {
  return routings.map((r) => ({
    id: r.id,
    portKind: r.from.kind,
    fromContainerId: r.from.containerId,
    toContainerId: r.to.containerId,
  }));
}

export interface ModulePortCell {
  x: number;
  y: number;
  role: "input" | "output";
  /** 반대 끝점(상자 anchor 또는 상대 모듈 포트) — 그리드 좌표. */
  peer: { x: number; y: number };
  /** 반대 끝점 컨테이너 id(상자 id 또는 상대 머신 id). */
  peerId: string;
  /** 산출 근거(planner 슬롯 + 트렁크 seed 점수). 모듈 파이프라인 외 경로는 없음. */
  meta?: ModulePortMeta;
}

export interface ModuleInfo {
  /** 모듈 식별 키(머신 id 접두사). */
  key: string;
  /** 레시피 이름(머신 recipeName). 없으면 null. */
  recipe: string | null;
  /** 머신 prototype 이름(동일 모듈 내 균일 가정). */
  machineEntityName: string | null;
  /** 머신 대수. */
  machineCount: number;
  /**
   * 모듈 영역의 외접 사각형 — 그리드 좌표(칸 단위).
   * 머신 footprint ∪ 포트 셀의 합집합. 포트(tapAnchor/링 anchor)는 머신 옆
   * 레인·링 위에 있으므로 머신 bbox 만으로는 포트가 테두리 밖으로 나간다 —
   * 합집합이 곧 "포트를 포함하는 모듈 경계". (모듈 상자는 ⑥C 재배치로 외곽까지
   * 이동할 수 있어 의도적으로 제외 — 포함하면 테두리가 레이아웃 외곽까지 부푼다.)
   */
  bbox: { x: number; y: number; w: number; h: number };
  /** 포트 셀(그리드 좌표) — 라우팅이 머신에 닿는 지점. 소비=input, 생산=output. */
  ports: ModulePortCell[];
}

/**
 * 메모 — 같은 운반체면 같은 결과. 순수 함수이므로 참조 투명성이 유지된다.
 *
 * 필요한 이유: 이 함수는 렌더마다, 그리고 **마우스가 움직일 때마다**(`moduleAtCell`
 * 히트테스트) 불린다. 컨테이너 × 라우팅을 매번 훑으면 큰 배치에서 이동이 무거워진다.
 * 운반체는 [overlaySource] 가 배치당 하나로 고정해 준다.
 */
let memoKey: ModuleSource | null = null;
let memoVal: ModuleInfo[] = [];

/**
 * 배치에서 모듈별 경계·포트·머신 정보를 계산한다. 운반체가 없으면(아직 안 돌렸거나
 * 실패했으면) 빈 배열.
 */
export function collectModules(src: ModuleSource | null): ModuleInfo[] {
  if (!src) return [];
  if (src === memoKey) return memoVal;

  const coox = src.offset.x;
  const cooy = src.offset.y;

  const byKey = new Map<string, ModuleInfo>();
  const machineKey = new Map<string, string>();

  const expandBbox = (m: ModuleInfo, gx: number, gy: number, w: number, h: number) => {
    const x1 = Math.min(m.bbox.x, gx);
    const y1 = Math.min(m.bbox.y, gy);
    const x2 = Math.max(m.bbox.x + m.bbox.w, gx + w);
    const y2 = Math.max(m.bbox.y + m.bbox.h, gy + h);
    m.bbox = { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
  };

  for (const c of src.containers) {
    if (c.kind !== "machine") continue;
    const key = c.id.replace(/-m\d+$/, "");
    machineKey.set(c.id, key);

    const gx = c.origin.x + coox;
    const gy = c.origin.y + cooy;
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, {
        key,
        recipe: c.recipeName ?? null,
        machineEntityName: c.entityName,
        machineCount: 1,
        bbox: { x: gx, y: gy, w: c.size.w, h: c.size.h },
        ports: [],
      });
    } else {
      existing.machineCount++;
      expandBbox(existing, gx, gy, c.size.w, c.size.h);
    }
  }

  // 포트 셀: 라우팅의 머신 쪽 끝점. 머신이 소비자(to)면 입력, 생산자(from)면 출력.
  // 포트는 레인/링 위 셀이므로 bbox 도 함께 확장 — 포트는 항상 테두리 안(구성적 보장).
  const addPort = (
    key: string,
    cell: { x: number; y: number },
    role: "input" | "output",
    peer: { x: number; y: number },
    peerId: string,
    meta?: ModulePortMeta,
  ) => {
    const m = byKey.get(key);
    if (!m) return;
    const gx = cell.x + coox;
    const gy = cell.y + cooy;
    m.ports.push({ x: gx, y: gy, role, peer: { x: peer.x + coox, y: peer.y + cooy }, peerId, meta });
    expandBbox(m, gx, gy, 1, 1);
  };
  for (const r of src.routings) {
    const toKey = machineKey.get(r.to.containerId);
    if (toKey) addPort(toKey, r.to.cell, "input", r.from.cell, r.from.containerId, r.toPortMeta);
    const fromKey = machineKey.get(r.from.containerId);
    if (fromKey) addPort(fromKey, r.from.cell, "output", r.to.cell, r.to.containerId, r.fromPortMeta);
  }

  memoKey = src;
  memoVal = [...byKey.values()];
  return memoVal;
}

/**
 * 오버레이가 그리는 모듈 하나 — **성공과 실패가 같은 모양**이다.
 *
 * 성공이면 [collectModules] 가 낸 `ModuleInfo` 에 상태만 얹고, 실패면 `LayoutSnapshot`
 * 에서 같은 모양으로 만든다. 렌더러·히트테스트가 **목록 하나만** 보게 하려는 것 —
 * 실패 전용 렌더 경로를 따로 두면 그게 곧 "두 번째 렌더러"가 된다.
 */
export interface OverlayModule extends ModuleInfo {
  status: "ok" | "problem";
  issues: LayoutIssue[];
}

/** 오버레이가 그리는 연결 하나 — 성공 배치의 라우팅과 실패 스냅샷의 납품 경로 공용. */
export interface OverlayLine {
  id: string;
  ok: boolean;
  /** 그리드 좌표. 실패 스냅샷은 양끝만 알아 직선이 된다. */
  from: { x: number; y: number };
  to: { x: number; y: number };
  item?: string;
}

/** issue 를 대상별로 나눈다 — 모듈 사각형 색·패널 섹션이 이걸 본다. */
function issuesForModule(id: string, issues: readonly LayoutIssue[]): LayoutIssue[] {
  return issues.filter((i) => i.target?.moduleId === id);
}

/**
 * **실패 스냅샷 → 오버레이 모듈.** 포트는 없다(라우팅까지 못 갔으므로) — `ports: []`.
 * 좌표는 스냅샷이 절대(레이아웃) 좌표라 offset 을 더해 그리드 좌표로 옮긴다.
 */
export function overlayFromSnapshot(
  snapshot: LayoutSnapshot,
  issues: readonly LayoutIssue[],
  offset: { x: number; y: number },
): { modules: OverlayModule[]; lines: OverlayLine[] } {
  const modules = snapshot.modules.map((m) => ({
    key: m.id,
    recipe: m.recipeName ?? null,
    machineEntityName: m.entityName,
    machineCount: m.machineCount,
    bbox: { x: m.bbox.x + offset.x, y: m.bbox.y + offset.y, w: m.bbox.w, h: m.bbox.h },
    ports: [],
    status: m.status,
    issues: issuesForModule(m.id, issues),
  }));
  const lines = snapshot.deliveries.map((d) => ({
    id: d.key,
    ok: d.ok,
    from: { x: d.from.x + offset.x, y: d.from.y + offset.y },
    to: { x: d.to.x + offset.x, y: d.to.y + offset.y },
    item: d.item,
  }));
  return { modules, lines };
}

/** 성공 배치 → 오버레이 모듈. 경고가 있으면 그 모듈만 `problem` 이 아니라 그대로 `ok` 다. */
export function overlayFromLayout(
  modules: readonly ModuleInfo[],
  issues: readonly LayoutIssue[],
): OverlayModule[] {
  return modules.map((m) => {
    const own = issuesForModule(m.key, issues);
    return {
      ...m,
      status: own.some((i) => i.severity === "error") ? ("problem" as const) : ("ok" as const),
      issues: own,
    };
  });
}

/** 그리드 셀 (gx,gy) 을 bbox 로 포함하는 모듈 반환(없으면 null). */
export function moduleAtCell<T extends ModuleInfo>(
  gx: number,
  gy: number,
  modules: readonly T[],
): T | null {
  for (const m of modules) {
    if (gx >= m.bbox.x && gx < m.bbox.x + m.bbox.w && gy >= m.bbox.y && gy < m.bbox.y + m.bbox.h) return m;
  }
  return null;
}
