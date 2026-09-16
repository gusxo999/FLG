/**
 * clusterModule — 한 레시피 노드의 N대 머신을 **부모-무시 자족 모듈**로 생성한다. **순서만 쥐는 뼈대다.**
 *
 * 단일 출처: 본 설계안(모듈 출력 경계 / 클러스터 모듈화).
 *
 * ## 사슬 — 단계마다 새로 아는 것
 *
 * ```
 * ① 계획      자리 전부(좌표 없음) — 면 · 깊이 · 좌석 · gap 폭     planner/module/planModulePorts
 * ② 몸통      머신 좌표 · 틀 · ring                               module/shape.layoutModule
 * ③ 장부      점유(머신 발자국) · 방출 누적기                      openModuleSheet(여기)
 * ④ 링크 줄    링크 좌석의 좌표 → 링크 셀                         layLinkLines(여기) · module/shape.placeLinkSeats
 * ⑤ 판정 받기  못 부은 줄 · 나머지 줄 실패 — 계획에 적혀 있다        뼈대
 * ⑥ 나머지 줄  나머지 좌석의 좌표 → 셀                            layRestLines(여기)
 * ⑦ 유체 줄    트렁크 틀(점프 여부 · ClusterPipe 깊이) → 기둥 셀    layFluidLines(여기) · module/policy.buildTrunkContext
 * ⑧ 마무리    끝 칸 방향(늦은 결정) · wayOuts · 열 요약            finishModule(여기)
 * ```
 *
 * ④ → ⑥ → ⑦ 은 **점유가 쌓이는 순서**다 — ④가 쓴 칸을 ⑥이 피하고, ⑥이 쓴 칸에 ⑦의 기둥이 끊긴다.
 * 셀을 만드는 일은 전부 `execution/module/emitModule` 에 있다.
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
 * > **내력.** 2026-09-14 까지 `generateModule` 은 176줄 함수 하나였다 — 몸통 · 좌석 좌표는 도형(`module/shape`),
 * > 트렁크 틀은 정책(`module/policy`)으로 갔다(계획 구조-2축 · 2 Step 4c). 옛 머리말의 *"v1 범위: 아이템 belt 만(유체
 * > line 은 unrouted 로 위임)"* 은 유체 기둥이 들어온 뒤로 사실이 아니어서 지웠다.
 */

import type { IoLine } from "./types/line";
import type { BeltMerge, BeltTerminus, GeneratedModule, ModuleInput, ModulePort } from "./types/module";
import { layoutModule, placeLinkSeats, type ModuleBody } from "./shape";
import { buildTrunkContext } from "./policy";
// 계획 — 자리 배정 전부. 좌표 이전 단계라 머신을 놓기 전에 돈다(planner/module/ 소관).
import { planModulePorts } from "../planner/module/planModulePorts";
import type { ModulePortPlan } from "../planner/module/planModulePorts";
// 반출 계획의 입력 — 모듈이 자기 몸통에 대해 답한다(계층 위반 V1 해소, planner/perimeter 소관).
import { fillModuleWayOuts } from "../planner/perimeter/wayOuts";
import type { Container, PlacedCell } from "../shared/types";
import { cellKey } from "../shared/grid";
import type { PipeFlowPipe } from "../shared/pipeFlow";
// 방출 — 계획이 끝난 배정을 셀로 놓는다(배치 실행 계층).
import {
  emitOutputLinks,
  emitInputLinks,
  emitTrunkPipe,
} from "../execution/module/emitModule";
// 흐름의 끝 칸 — 방출기가 등록하고, 벨트가 다 깔린 뒤 여기서 방향이 정해진다.
import { resolveBeltTermini } from "../execution/module/beltTerminus";

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
  // ① 계획 — **머신을 놓기 전에 전부 끝난다.**
  // 자리를 정하는 일은 여기 한 번뿐이다([planModulePorts]). 좌표가 없어야 이 순서가 성립한다:
  // gap 으로 넘어간 링크는 gap 안에 가로 벨트를 놓고, **gap 폭 = 그 gap 을 지나는 가로 벨트
  // 수**인데, 그 폭이 다시 머신 좌표를 정하기 때문이다(닭과 달걀을 푸는 지점).
  const plan = planModulePorts(input, count, input.linkFaceStage);
  // ② 몸통 — 머신 좌표 · 틀 · ring. gap 폭은 계획이 준 값이다
  const body = layoutModule(input, count, plan.rowGaps, prefix);
  // ③ 장부 — 점유는 머신 발자국에서 시작하고, 방출기가 차례로 채운다
  const sheet = openModuleSheet(body.machines);
  // ④ 링크 줄 — 먼저 놓아야 나머지 줄이 그 자리를 피한다
  layLinkLines(input, body, sheet, plan, prefix);
  // ⑤ 판정 받기 —
  // 나머지 줄이 못 앉았으면 그 줄들만 unrouted 로 낸다 — **못 앉은 줄이 계획에 적혀 있어서**
  // 여기서 다시 고를 필요가 없다([ModulePortPlan.rest.unplaced]). 링크 줄은 위에서 이미
  // 성패가 갈렸으므로 그 목록에 없다.
  // **부을 수 없던 줄은 여기서 사유가 된다** — 줄이 하나도 안 난 나머지 줄들
  // ([ModulePortPlan.unpourableLines]). 모듈을 물리지는 않는다: 그 줄 하나만 못 깐 것이라
  // 나머지는 그대로 깔리고, 못 깐 줄은 `unroutedLines` 로 위층에 올라간다.
  sheet.unroutedLines.push(...plan.unpourableLines);
  if (!plan.rest.ok) {
    sheet.unroutedLines.push(...plan.rest.unplaced);
    return finishModule(input, body, sheet, plan); // 나머지 줄이 없어도 링크 줄의 끝 칸은 마무리해야 한다
  }
  // ⑥ 나머지 줄 — 링크와 같은 배정 · 같은 방출기(g = N 과 g = 1 은 같은 축의 두 끝)
  layRestLines(input, body, sheet, plan, prefix);
  // ⑦ 유체 줄 — 아이템을 어떻게 나르든 같은 기둥. 점프 여부는 트렁크 틀이 정한다
  layFluidLines(input, body, sheet, plan, prefix);
  // ⑧ 마무리 — 끝 칸 방향(벨트가 다 깔린 지금이 처음 물을 수 있는 자리) → 몸통이 답한다
  return finishModule(input, body, sheet, plan);
}

/**
 * **방출 누적기** — ③ 에서 열고, 방출기 셋이 차례로 채우고, ⑧ 이 [GeneratedModule] 로 묶는다.
 *
 * 필드 이름이 방출기 인자 이름과 같아 **펼쳐 넘긴다**(`...sheet`). 객체는 하나씩이다 — 같은 배열이 방출기 셋과
 * 반환값에 흘러간다.
 */
interface ModuleSheet {
  /**
   * 점유 셀 — 머신 footprint + 이미 놓은 상자·인서터. 1:1 은 슬롯이 겹치지 않아
   * 충돌이 구조적으로 없지만, 안전망으로 유지한다.
   */
  occupancy: Set<string>;
  cells: PlacedCell[];
  chests: Container[];
  /** 파이프 셀의 유체 — 방출기가 놓는 자리에서 채운다([GeneratedModule.pipeCells]). */
  pipeCells: PipeFlowPipe[];
  /**
   * **벨트 칸 → 품목** · **흐름의 끝 칸들** — [resolveBeltTermini] 의 재료.
   *
   * 끝 칸의 방향은 이웃을 봐야 정해지고, 이웃은 이 모듈의 벨트가 **다 깔린 뒤**에야 안다.
   * 그래서 방출기는 등록만 하고 결정은 아래 [finishBeltTermini] 가 한 번에 한다.
   */
  beltItems: Map<string, string>;
  termini: BeltTerminus[];
  beltMerges: BeltMerge[];
  inputPorts: ModulePort[];
  outputPorts: ModulePort[];
  unroutedLines: IoLine[];
}

/** **③ 장부를 연다** — 점유는 머신 발자국에서 시작한다. */
function openModuleSheet(machines: Container[]): ModuleSheet {
  const occupancy = new Set<string>();
  for (const m of machines)
    for (let dx = 0; dx < m.size.w; dx++)
      for (let dy = 0; dy < m.size.h; dy++) occupancy.add(cellKey(m.origin.x + dx, m.origin.y + dy));
  return {
    occupancy, cells: [], chests: [], pipeCells: [], beltItems: new Map(), termini: [], beltMerges: [],
    inputPorts: [], outputPorts: [], unroutedLines: [],
  };
}

/**
 * **④ 링크 줄 — 먼저.**
 *
 * 링크 줄은 계획에서 이미 자기 좌석·면·순번을 받았고([ModulePortPlan.linkFaces]), 여기서
 * 자기 벨트·포트를 스스로 놓는다. 먼저 놓아야 occupancy 가 채워져, 아래 나머지 줄 방출이
 * 그 자리를 피한다.
 *
 * **나머지 줄의 판정([ModulePortPlan.rest])은 여기 관여하지 않는다.** 예전엔 그 판정이
 * `!plan.ok` 라는 이름으로 링크 방출보다 앞에 있어, 무관한 판정이 이미 성공한 링크 예약을
 * 통째로 삼켰다(2026-07-21). 이름이 `rest` 로 갈라진 지금은 그 착각이 생길 자리가 없다.
 */
function layLinkLines(input: ModuleInput, body: ModuleBody, sheet: ModuleSheet, plan: ModulePortPlan, prefix: string): void {
  const { machines } = body;
  const outLinks = input.outputLinks ?? [];
  const inLinks = input.inputLinks ?? [];
  const outSeats = placeLinkSeats(machines, plan.linkFaces.out);
  const inSeats = placeLinkSeats(machines, plan.linkFaces.in);
  const lineOf = new Map(input.lines.map((l) => [`${l.role}:${l.name}`, l]));
  if (outLinks.length > 0) {
    const m = new Map(outLinks.map((g) => [g.item, lineOf.get(`output:${g.item}`)!]));
    emitOutputLinks({ groups: outLinks, seats: outSeats, lineOf: m, machines, input, prefix, ...sheet });
  }
  if (inLinks.length > 0) {
    const m = new Map(inLinks.map((g) => [g.item, lineOf.get(`input:${g.item}`)!]));
    emitInputLinks({ groups: inLinks, seats: inSeats, lineOf: m, machines, input, prefix, ...sheet });
  }
}

/**
 * **⑥ 나머지 줄 — 갈래가 없다** (2026-08-16, 계획서 §19-④)
 *
 * 예전엔 `mode === "tap"` 가지가 `emitTapInserting` 이라는 **두 번째 트렁크 기하**를 갖고
 * 있었다. 같은 일을 하는 코드가 둘이면 한쪽만 고쳐도 조용히 어긋난다(R3) — 실제로 옆 포트·
 * 좌석 구간·전달 칸·끝 칸 꺾기가 이쪽에만 있었고 저쪽은 축 방향 포트에 기둥 전체 벨트였다.
 *
 * [tryLinkFace] 의 `arms.size !== 1` 문턱이 풀린 지금(§19-①) **묶은 그룹이 그대로 앉는다.**
 * 그래서 트렁크와 기계별 포트가 같은 배정([LinkFacePlan])·같은 방출기를 탄다 —
 * 둘은 `g = N` 과 `g = 1` 이라는 **같은 축의 두 끝**일 뿐이다(§16).
 */
function layRestLines(input: ModuleInput, body: ModuleBody, sheet: ModuleSheet, plan: ModulePortPlan, prefix: string): void {
  const { machines } = body;
  const rest = plan.restLinks!; // [planModulePorts] 가 언제나 낸다(모드 무관).
  const restOutSeats = placeLinkSeats(machines, rest.out.plans);
  const restInSeats = placeLinkSeats(machines, rest.in.plans);
  const restLineOf = new Map(input.lines.map((l) => [l.name, l]));
  emitOutputLinks({ groups: rest.out.groups, seats: restOutSeats, lineOf: restLineOf, machines, input, prefix, ...sheet });
  emitInputLinks({ groups: rest.in.groups, seats: restInSeats, lineOf: restLineOf, machines, input, prefix, ...sheet });
}

/**
 * **⑦ 유체 줄 — [트렁크 파이프] 는 아이템 공급 방식 밖에서 한 번**
 *
 * 파이프 기하는 아이템을 어떻게 나르는지와 무관하다: 면은 머신 `fluid_boxes` 가 강제하고,
 * 파이프는 팔이 없어 그 칸에 직접 닿아야 하므로 탭이든 1:1 이든 같은 줄을 같은 깊이로 지난다.
 * 예전엔 이 호출이 tap 가지 **안에** 있었다 — 그래서 아이템이 1:1 로 물러나는 순간 유체가
 * 조용히 사라졌고, 그 조용한 실패를 막으려고 [planModulePorts] 가 유체 모듈을 통째로
 * 거절해야 했다(`fluidNeedsTap`). 방출을 갈래 밖으로 꺼내면 그 거절의 근거가 없어진다.
 *
 * **그 관문(`fluidNeedsTap`)은 이제 없다** — [planModulePorts] 가 근거와 함께 지웠고,
 * 남은 유체 실패는 "배정을 못 받은 유체 줄이 있다"(`fluidUnplaceable`) 하나뿐이다.
 * 그래서 **1:1 가지에서도 여기 도달한다.** 도달해도 기하는 같다는 것이 위 문단의 요지이고,
 * 그 사실은 방출기 단위 테스트가 지킨다.
 *
 * 트렁크 틀([buildTrunkContext])은 유체 줄 전체를 한 번 훑어 점프 여부 · ClusterPipe 깊이 · 엇갈림 기준을 낸다 —
 * 링크가 먹은 깊이([ModulePortPlan.linkFaceDepths])를 함께 본다. 틀은 계획 · 머신 · 입력만 읽으므로 나머지 줄을
 * 놓은 뒤에 지어도 같다.
 */
function layFluidLines(input: ModuleInput, body: ModuleBody, sheet: ModuleSheet, plan: ModulePortPlan, prefix: string): void {
  const trunkPlan = { ok: true as const, lines: [...plan.pipePlanned] };
  const ctx = buildTrunkContext(
    trunkPlan, body.machines, input, plan.isJumpableToClusterPipe, plan.gapExitSides, plan.linkFaceDepths,
  );
  emitTrunkPipe({ plan: trunkPlan, machines: body.machines, input, prefix, ctx, seqRef: { n: 0 }, ...sheet });
}

/**
 * **⑧ 마무리** — 나머지 줄이 통째로 물러난 조기 반환도 여기로 온다.
 *
 * **끝 칸의 방향은 여기서 정해진다** — 이 모듈의 벨트가 전부 깔린 지금이 처음으로
 * *"끝 칸의 이웃이 남의 품목이냐"* 를 물을 수 있는 자리다([resolveBeltTermini]).
 *
 * 전 포트 emit 완료 → 모듈 몸통이 확정됐으니 각 포트의 moduleWayOuts 와 **열 요약**을
 * 함께 채운다(같은 몸통에 대한 두 답이라 한 번에 낸다).
 */
function finishModule(input: ModuleInput, body: ModuleBody, sheet: ModuleSheet, plan: ModulePortPlan): GeneratedModule {
  resolveBeltTermini({
    termini: sheet.termini, beltItems: sheet.beltItems, undergroundBelts: input.undergroundBelts, merges: sheet.beltMerges,
  });
  const bodyColumns = fillModuleWayOuts(body.machines, sheet.cells, [...sheet.inputPorts, ...sheet.outputPorts]);
  return {
    machines: body.machines,
    chests: sheet.chests,
    cells: sheet.cells,
    ring: body.ring,
    inputPorts: sheet.inputPorts,
    outputPorts: sheet.outputPorts,
    bbox: body.bbox,
    bodyColumns,
    unroutedLines: sheet.unroutedLines,
    pipeCells: sheet.pipeCells,
    beltMerges: sheet.beltMerges,
    depthShortages: plan.depthShortages,
    unpourableFix: plan.unpourableFix,
  };
}
