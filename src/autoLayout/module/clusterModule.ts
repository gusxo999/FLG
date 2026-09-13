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

import { trunkEndKey } from "./arith";
import type { IoLine, PlannedLine, PortSide } from "./types/line";
import type {
  BeltMerge, BeltTerminus, GeneratedModule, ModuleInput, ModulePort, TrunkContext,
} from "./types/module";
import type { LinkFacePlan, LinkSeats } from "./types/seat";
import { fluidLineOf, fluidLinesOnSide } from "./fluidPorts";
import { layoutCluster } from "./clusterLayout";
// 계획 — 자리 배정 전부. 좌표 이전 단계라 머신을 놓기 전에 돈다(planner/module/ 소관).
import { planModulePorts } from "../planner/module/planModulePorts";
// 반출 계획의 입력 — 모듈이 자기 몸통에 대해 답한다(계층 위반 V1 해소, planner/perimeter 소관).
import { fillModuleWayOuts } from "../planner/perimeter/wayOuts";
import type { Container, PlacedCell, PortFace } from "../containerModel";
import { cellKey, enumeratePerimeterCells } from "../util/helper";
import type { PipeFlowPipe } from "../util/pipeFlow";
// 방출 — 계획이 끝난 배정을 셀로 놓는다(배치 실행 계층).
import {
  emitOutputLinks,
  emitInputLinks,
  emitTrunkPipe,
} from "../execution/module/emitModule";
// 흐름의 끝 칸 — 방출기가 등록하고, 벨트가 다 깔린 뒤 여기서 방향이 정해진다.
import { resolveBeltTermini } from "../execution/module/beltTerminus";

/**
 * 모듈 머신 사이 세로 gap = 0(밀착). 모듈은 **간단 레시피**(W/E 두 면만으로 모든 I/O 를
 * 처리 — demand ≤ 용량이 구조적으로 보장)만 다루므로 N/S 면을 안 쓴다. 트렁크는 W/E 변을
 * 따라 세로로 흐르고 인서터 좌석도 각 머신 면(3칸) 안에 들어가, 머신 사이 공백은 트렁크
 * belt 길이만 늘릴 뿐 아무 기능이 없다 → 밀착. (N/S spill 이 있는 옛 라이브 경로는 ROW_GAP=3
 * 유지.) 복잡 레시피(2D)가 도입되면 그 경로가 자기 gap 을 따로 정한다.
 */
const MODULE_ROW_GAP = 0;

/**
 * 한 클러스터를 자족 모듈로 생성. 입력 line 은 supply 트렁크, 출력 line 은 collect
 * 트렁크로 자기 ring 까지 깐다. 각 트렁크의 종착 ring 셀 = 그 line 의 포트 anchor.
 *
 * 결정적: 배정([tryLinkFace])이 줄마다 자리(면 W/E·깊이·좌석)를 먼저
 * 못박고, 각 트렁크를 그 슬롯에만 가둔다(faceConstraints). 누적 occupancy 로 같은 면
 * 두 깊이의 seat 행이 겹치지 않게 한다. 슬롯은 columnTapCapacity 로 보장돼 미탭 불가.
 */
export function generateModule(input: ModuleInput): GeneratedModule {
  const prefix = input.idPrefix ?? "mod";
  const count = Math.max(1, input.count);
  const outLinks = input.outputLinks ?? [];
  const inLinks = input.inputLinks ?? [];

  // ── 계획 — **머신을 놓기 전에 전부 끝난다** ───────────────────────────────
  // 자리를 정하는 일은 여기 한 번뿐이다([planModulePorts]). 좌표가 없어야 이 순서가 성립한다:
  // gap 으로 넘어간 링크는 gap 안에 가로 벨트를 놓고, **gap 폭 = 그 gap 을 지나는 가로 벨트
  // 수**인데, 그 폭이 다시 머신 좌표를 정하기 때문이다(닭과 달걀을 푸는 지점).
  //
  // 아래는 전부 **방출**이다 — 계획이 못박은 자리에 놓기만 하고, 탐색이 없다.
  const plan = planModulePorts(input, count, input.linkFaceStage);

  const layout = layoutCluster(
    { w: input.machine.w, h: input.machine.h, count },
    plan.rowGaps.some((g) => g > 0) ? plan.rowGaps : MODULE_ROW_GAP,
  );

  const machines: Container[] = layout.positions.map((pos, i) => ({
    id: `${prefix}-m${i}`,
    kind: "machine",
    entityName: input.machine.entityName,
    origin: { x: pos.dx, y: pos.dy },
    size: { w: input.machine.w, h: input.machine.h },
    // 유체 레시피면 머신을 돌려 유체 입구가 트렁크 파이프 쪽(W/E)을 보게 한다. 아이템
    // 전용이면 0 — 인서터는 어느 면에나 붙으므로 돌릴 이유가 없다(trunk-pipe §3).
    direction: input.fluidTrunk?.direction,
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
  // 파이프 셀의 유체 — 방출기가 놓는 자리에서 채운다([GeneratedModule.pipeCells]).
  const pipeCells: PipeFlowPipe[] = [];
  /**
   * **벨트 칸 → 품목** · **흐름의 끝 칸들** — [resolveBeltTermini] 의 재료.
   *
   * 끝 칸의 방향은 이웃을 봐야 정해지고, 이웃은 이 모듈의 벨트가 **다 깔린 뒤**에야 안다.
   * 그래서 방출기는 등록만 하고 결정은 아래 [finishBeltTermini] 가 한 번에 한다.
   */
  const beltItems = new Map<string, string>();
  const beltTermini: BeltTerminus[] = [];
  const beltMerges: BeltMerge[] = [];
  const finishBeltTermini = (): void =>
    resolveBeltTermini({
      termini: beltTermini, beltItems, undergroundBelts: input.undergroundBelts, merges: beltMerges,
    });
  const inputPorts: ModulePort[] = [];
  const outputPorts: ModulePort[] = [];
  const unroutedLines: IoLine[] = [];


  // ── 링크 방출 — 먼저 ───────────────────────────────────────────────────────
  // 링크 줄은 계획에서 이미 자기 좌석·면·순번을 받았고([ModulePortPlan.linkFaces]), 여기서
  // 자기 벨트·포트를 스스로 놓는다. 먼저 놓아야 occupancy 가 채워져, 아래 나머지 줄 방출이
  // 그 자리를 피한다.
  //
  // **나머지 줄의 판정([ModulePortPlan.rest])은 여기 관여하지 않는다.** 예전엔 그 판정이
  // `!plan.ok` 라는 이름으로 링크 방출보다 앞에 있어, 무관한 판정이 이미 성공한 링크 예약을
  // 통째로 삼켰다(2026-07-21). 이름이 `rest` 로 갈라진 지금은 그 착각이 생길 자리가 없다.
  const outSeats = placeLinkSeats(machines, plan.linkFaces.out);
  const inSeats = placeLinkSeats(machines, plan.linkFaces.in);
  const lineOf = new Map(input.lines.map((l) => [`${l.role}:${l.name}`, l]));
  if (outLinks.length > 0) {
    const m = new Map(outLinks.map((g) => [g.item, lineOf.get(`output:${g.item}`)!]));
    emitOutputLinks({ groups: outLinks, seats: outSeats, lineOf: m, machines, input, prefix, occupancy, cells, chests, outputPorts, unroutedLines, beltItems });
  }
  if (inLinks.length > 0) {
    const m = new Map(inLinks.map((g) => [g.item, lineOf.get(`input:${g.item}`)!]));
    emitInputLinks({ groups: inLinks, seats: inSeats, lineOf: m, machines, input, prefix, occupancy, cells, chests, inputPorts, unroutedLines, beltItems, termini: beltTermini });
  }

  // 나머지 줄이 못 앉았으면 그 줄들만 unrouted 로 낸다 — **못 앉은 줄이 계획에 적혀 있어서**
  // 여기서 다시 고를 필요가 없다([ModulePortPlan.rest.unplaced]). 링크 줄은 위에서 이미
  // 성패가 갈렸으므로 그 목록에 없다.
  // **부을 수 없던 줄은 여기서 사유가 된다** — 줄이 하나도 안 난 나머지 줄들
  // ([ModulePortPlan.unpourableLines]). 모듈을 물리지는 않는다: 그 줄 하나만 못 깐 것이라
  // 나머지는 그대로 깔리고, 못 깐 줄은 `unroutedLines` 로 위층에 올라간다.
  unroutedLines.push(...plan.unpourableLines);

  if (!plan.rest.ok) {
    unroutedLines.push(...plan.rest.unplaced);
    finishBeltTermini(); // 나머지 줄이 없어도 링크 줄의 끝 칸은 마무리해야 한다
    const bodyColumns = fillModuleWayOuts(machines, cells, [...inputPorts, ...outputPorts]);
    return { machines, chests, cells, ring, inputPorts, outputPorts, bbox, bodyColumns, unroutedLines, pipeCells, beltMerges, depthShortages: plan.depthShortages, unpourableFix: plan.unpourableFix };
  }

  // ── 방출 ────────────────────────────────────────────────────────────────────
  // [insertingPlanner] 의 판정에 따라 갈라진다:
  //
  //  - **탭 인서팅**(트렁크): 면을 belt 한 줄이 훑고 머신들이 그 줄을 인서터로 나눠 집는다.
  //    포트 = 벨트 끝 하나 → 모듈 경계 포트가 **품목당 1개**로 준다.
  //  - **다이렉트 인서팅**(1:1): 머신마다 자기 상자+인서터. 포트 = 머신 × 품목.
  //
  // 어느 쪽이든 **탐색이 없다** — 자리는 planner 가 이미 못박았고 방출기는 깔기만 한다.
  // 나머지 줄(유체·링크 없는 줄)만 — 링크 줄은 위에서 이미 놓았고 plan 에도 없다.
  // [탭 인서팅]([emitTapInserting])과 [트렁크 파이프]([emitTrunkPipe])는 용어사전이 이미
  // "나란한 유체판"으로 갈라놓은 두 개념이다 — 둘 다 같은 [buildTrunkContext](기둥 extent·
  // stagger 기준)를 보고, 같은 seqRef 로 chestId 순번을 이어 쓰되, 서로의 줄을 건드리지
  // 않는다(item ↔ pipe 는 line.kind 로 배타적).
  // 아이템 plan(planner)과 유체 배정(pipePlanned, generateModule 이 직접 조립)을 합쳐 트렁크
  // 기하를 **함께** 본다 — stagger 와 pipeJumpMode 는 아이템·유체를 한 번에 훑어야 어긋나지
  // 않는다([buildTrunkContext]). 유체 PlannedLine 은 옛 planner 가 찍던 것과 값이 같아
  // (side=fluidTrunk.side·depth=1) 기하·수치 불변이다.
  const trunkPlan = { ok: true as const, lines: [...plan.rest.lines, ...plan.pipePlanned] };
  const ctx = buildTrunkContext(
    trunkPlan, machines, input, plan.isJumpableToClusterPipe, plan.gapExitSides, plan.linkFaceDepths,
  );
  const seqRef = { n: 0 };

  // ── **아이템 줄 방출 — 갈래가 없다** (2026-08-16, 계획서 §19-④) ────────────────
  //
  // 예전엔 `mode === "tap"` 가지가 `emitTapInserting` 이라는 **두 번째 트렁크 기하**를 갖고
  // 있었다. 같은 일을 하는 코드가 둘이면 한쪽만 고쳐도 조용히 어긋난다(R3) — 실제로 옆 포트·
  // 좌석 구간·전달 칸·끝 칸 꺾기가 이쪽에만 있었고 저쪽은 축 방향 포트에 기둥 전체 벨트였다.
  //
  // [tryLinkFace] 의 `arms.size !== 1` 문턱이 풀린 지금(§19-①) **묶은 그룹이 그대로 앉는다.**
  // 그래서 트렁크와 기계별 포트가 같은 배정([LinkFacePlan])·같은 방출기를 탄다 —
  // 둘은 `g = N` 과 `g = 1` 이라는 **같은 축의 두 끝**일 뿐이다(§16).
  const rest = plan.restLinks!; // [planModulePorts] 가 언제나 낸다(모드 무관).
  const restOutSeats = placeLinkSeats(machines, rest.out.plans);
  const restInSeats = placeLinkSeats(machines, rest.in.plans);
  const restLineOf = new Map(input.lines.map((l) => [l.name, l]));
  emitOutputLinks({ groups: rest.out.groups, seats: restOutSeats, lineOf: restLineOf, machines, input, prefix, occupancy, cells, chests, outputPorts, unroutedLines, beltItems });
  emitInputLinks({ groups: rest.in.groups, seats: restInSeats, lineOf: restLineOf, machines, input, prefix, occupancy, cells, chests, inputPorts, unroutedLines, beltItems, termini: beltTermini });

  // ── [트렁크 파이프] — **아이템 공급 방식 밖에서 한 번** ─────────────────────────
  // 파이프 기하는 아이템을 어떻게 나르는지와 무관하다: 면은 머신 `fluid_boxes` 가 강제하고,
  // 파이프는 팔이 없어 그 칸에 직접 닿아야 하므로 탭이든 1:1 이든 같은 줄을 같은 깊이로 지난다.
  // 예전엔 이 호출이 tap 가지 **안에** 있었다 — 그래서 아이템이 1:1 로 물러나는 순간 유체가
  // 조용히 사라졌고, 그 조용한 실패를 막으려고 [planModulePorts] 가 유체 모듈을 통째로
  // 거절해야 했다(`fluidNeedsTap`). 방출을 갈래 밖으로 꺼내면 그 거절의 근거가 없어진다.
  //
  // **그 관문(`fluidNeedsTap`)은 이제 없다** — [planModulePorts] 가 근거와 함께 지웠고,
  // 남은 유체 실패는 "배정을 못 받은 유체 줄이 있다"(`fluidUnplaceable`) 하나뿐이다.
  // 그래서 **1:1 가지에서도 여기 도달한다.** 도달해도 기하는 같다는 것이 위 문단의 요지이고,
  // 그 사실은 방출기 단위 테스트가 지킨다.
  emitTrunkPipe({
    plan: trunkPlan, machines, input, prefix, occupancy,
    cells, chests, inputPorts, outputPorts, unroutedLines,
    ctx, seqRef, pipeCells,
  });

  // **끝 칸의 방향은 여기서 정해진다** — 이 모듈의 벨트가 전부 깔린 지금이 처음으로
  // *"끝 칸의 이웃이 남의 품목이냐"* 를 물을 수 있는 자리다([resolveBeltTermini]).
  finishBeltTermini();

  // 전 포트 emit 완료 → 모듈 몸통이 확정됐으니 각 포트의 moduleWayOuts 와 **열 요약**을
  // 함께 채운다(같은 몸통에 대한 두 답이라 한 번에 낸다).
  const bodyColumns = fillModuleWayOuts(machines, cells, [...inputPorts, ...outputPorts]);

  return {
    machines,
    chests,
    cells,
    ring,
    inputPorts,
    outputPorts,
    bbox,
    bodyColumns,
    unroutedLines,
    pipeCells,
    beltMerges,
    depthShortages: plan.depthShortages,
    unpourableFix: plan.unpourableFix,
  };
}
/**
 * 면 배정에 **좌표를 입힌다** — 머신이 놓인 뒤에 부른다. 하는 일은 덧셈뿐이다.
 *
 * "면에서 몇 번째 칸" 은 배정의 일이라 [commitLinkFace] 가 이미 끝냈고
 * ([LinkFacePlan.slotIndex] — 채우는 방향까지 거기서 정해진다), 여기서는 그 순번에
 * 머신 원점을 더해 `t` 로 바꾼다. `t` 의 뜻은 [faceCell] 과 같다:
 * W/E 면이면 y(행), N/S 면이면 x(열).
 *
 * **이 함수가 장부를 안 쓴다는 것이 요점이다.** 예전엔 여기서 빈 장부(`placeLedger`)를
 * 새로 만들어 배정이 이미 센 누적을 처음부터 다시 셌다 — 같은 사실을 두 주체가 두 번
 * 계산하면 언젠가 어긋난다.
 */
function placeLinkSeats(
  machines: Container[],
  plans: (LinkFacePlan | undefined)[],
): (LinkSeats | undefined)[] {
  return plans.map((plan) => {
    if (!plan) return undefined;
    const isGap = plan.face === "N" || plan.face === "S";
    const slots = new Map<number, number[]>();
    for (const [mi, idx] of plan.slotIndex) {
      const m = machines[mi];
      if (!m) return undefined;
      const origin = isGap ? m.origin.x : m.origin.y;
      slots.set(mi, idx.map((i) => origin + i));
    }
    return { ...plan, slots };
  });
}

/**
 * [TrunkContext] 를 만든다 — 좌표 배치 전, `plan.lines` 전체(아이템+유체)를 한 번 훑어야
 * 나오는 값들이라 [emitTapInserting]/[emitTrunkPipe] 가 갈리기 **전**에 한 번만 계산한다.
 *
 * ── [pipeJumpToClusterPipe] 모드 — 유체 줄이 좌석 줄 대신 바깥 [ClusterPipe] 로 ──
 * 점프 가능 판정(isJumpableToClusterPipe)이 참이어도, 그 면에 **벨트가 하나도 안 앉았으면**
 * 넘을 것이 없다 → 옛 스파인(d=1)이 그대로 최선이라 점프하지 않는다(폭 낭비 0).
 *
 * ClusterPipe 깊이 = 그 면 벨트 최대 깊이 + 2:
 *   +1 = [ClusterPipeTapCell] — 지하파이프는 **지하 방향으로만** 합류하고 옆(수직)으론
 *        못 이어서, 탭이 ClusterPipe 줄 위에 앉으면 세로 연속이 끊긴다 → 1칸 안쪽.
 *   +2 = ClusterPipe 본체(일반 파이프 세로줄).
 * (나중에: 벨트를 지하벨트로 접으면 탭·ClusterPipe 를 더 안쪽으로 당길 수 있다 — 최적화 보류.)
 */
function buildTrunkContext(
  plan: { ok: true; lines: PlannedLine[] },
  machines: Container[],
  input: ModuleInput,
  isJumpableToClusterPipe: (side: PortSide) => boolean,
  gapExitSides: ReadonlySet<PortFace>,
  linkFaceDepths: Partial<Record<PortFace, number>>,
): TrunkContext {
  const ext = {
    x0: Math.min(...machines.map((m) => m.origin.x)),
    y0: Math.min(...machines.map((m) => m.origin.y)),
    x1: Math.max(...machines.map((m) => m.origin.x + m.size.w - 1)),
    y1: Math.max(...machines.map((m) => m.origin.y + m.size.h - 1)),
  };

  // ── 면별 값 — trunk-pipe §5.1 공식 한 곳 ────────────────────────────────────────────────
  //   base = max(그 면 벨트 최대 깊이, 1) · D_r = base + 2 + 2r · 탭 = D_r − 1
  // `n=1, beltMax>0` 을 넣으면 `beltMax + 2` — **현행과 같은 수**다(회귀 0).
  // **탭 벨트와 링크 벨트를 함께 센다.** `plan.lines` 는 탭 계획뿐이라, 링크·다이렉트가 앉은
  // 면에서는 이것만 보면 0 을 답한다 — 그러면 ClusterPipe 가 링크 포트 끝(d`clusterBeltDepth+2`)
  // **위로** 지나가고, 파이프가 끊겨도 겹침도 미배치도 아니라 아무도 못 알아챈다.
  // 오늘은 [tryLinkFace] 가 유체 면을 통째로 거절하므로 유체 면의 링크 깊이는 언제나 없고,
  // 따라서 이 항은 **아직 아무 배치도 바꾸지 않는다** — 유체 면을 여는 다음 단계의 안전망이다.
  const beltMaxOn = (side: PortSide): number =>
    Math.max(
      plan.lines.reduce((a, p) => (p.line.kind === "belt" && p.side === side ? Math.max(a, p.clusterBeltDepth) : a), 0),
      linkFaceDepths[side] ?? 0,
    );
  const baseOn = (side: PortSide): number => Math.max(beltMaxOn(side), 1);

  // 점프 게이트 — 좌석 줄(d1)을 통째로 먹는 옛 스파인이 **무언가를 밟을 때** 점프한다:
  //  ① 넘을 벨트가 있다(옛 조건).
  //  ② 유체가 둘 이상 — 스파인이 둘째 유체의 상자 칸을 막는다(trunk-pipe §5.1).
  //  ③ **이 레시피가 안 쓰는 유체 상자 칸이 그 면에 있다**(2026-08-05 추가). 화학공장은 입력
  //     상자가 E 면에 둘인데 battery 는 하나만 쓴다 — 스파인이 안 쓰는 칸까지 지나 거기 붙고,
  //     합류 가드가 hard 위반으로 모듈을 거절한다. 넘을 벨트가 없어도 **비켜 가야 한다.**
  //     (실측 전에는 아이템이 늘 그 면에 있어 ①이 우연히 가려 주고 있었다.)
  //  ④ **gap 벨트가 이 면으로 빠져나간다**(2026-08-05 추가 — [gapExitSidesFromPlans]).
  //     ①이 못 보는 자리다: gap 벨트는 `plan.lines` 가 아니라 링크 배정에서 나오므로
  //     `beltMaxOn` 이 0 을 답한다. 그 벨트의 포트 끝(인서터 d1 · 상자 d2)이 gap 행에서
  //     좌석 줄을 먹고, 스파인은 거기서 **끊긴다** — 아래쪽 머신이 유체를 못 받는데 겹침도
  //     미배치도 아니라 아무도 모른다. 점프하면 파이프가 d3 으로 물러나 d1·d2 를 비운다.
  const unusedBoxRowsOn = (side: PortSide): number =>
    (input.fluidTrunk?.unusedFluidboxRows?.[side] ?? []).length;
  const pipeJumpMode = (side: PortSide): boolean =>
    isJumpableToClusterPipe(side) &&
    (beltMaxOn(side) > 0 ||
      fluidLinesOnSide(input.fluidTrunk, side).length >= 2 ||
      unusedBoxRowsOn(side) > 0 ||
      gapExitSides.has(side));
  const clusterPipeDepth = (side: PortSide, rank: number): number => baseOn(side) + 2 + 2 * rank;

  const emitDepthOf = (p: PlannedLine): number => {
    if (p.line.kind !== "pipe") return p.clusterBeltDepth;
    const side = p.side as PortSide;
    if (!pipeJumpMode(side)) return p.clusterBeltDepth; // 옛 스파인 — d1 로 기둥 전체.
    return clusterPipeDepth(side, fluidLineOf(input.fluidTrunk, p.line)?.rank ?? 0);
  };

  const maxDepthAtEnd = new Map<string, number>();
  for (const p of plan.lines) {
    const k = trunkEndKey(p, input.lineEnds);
    maxDepthAtEnd.set(k, Math.max(maxDepthAtEnd.get(k) ?? 0, emitDepthOf(p)));
  }

  return { ext, pipeJumpMode, clusterPipeDepth, emitDepthOf, maxDepthAtEnd };
}
