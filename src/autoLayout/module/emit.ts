/**
 * 모듈 안쪽 방출 — **배치 실행**. 계획대로 셀을 놓는다.
 *
 * `clusterModule.generateModule`(조율)이 부른다. 여기 있는 함수는 자리를 *고르지 않는다* — 이미 정해진
 * 배정(면·깊이·좌석)을 받아 belt·인서터·상자·파이프를 격자에 **놓기만** 한다.
 *
 * | 함수 | 무엇을 놓나 |
 * |---|---|
 * | `emitOutputLinks` | 싣는 쪽 — 좌석 팔 + 수집 belt + 포트(인서터 · 상자). 링크 줄 · 나머지 줄 공통 |
 * | `emitInputLinks`  | 집는 쪽 — 공급 belt + 좌석 팔 + 포트 |
 * | `emitTrunkPipe`   | 유체 트렁크 파이프 + 지하 점프 |
 *
 * **틀과 길은 여기 없다** — 배정에 머신 좌표를 입혀 칸 순서를 내는 일은 도형이라 [module/shape] 에 있다.
 * 여기 남은 일은 셋이다: 칸이 비었나 묻고(안전망), 셀을 만들고, 누적기에 적는다.
 *
 * **공통 규약:** 인자 객체로 받은 누적기(`occupancy`·`cells`·`chests`·`inputPorts`·
 * `outputPorts`·`unroutedLines`)를 **in-place 로 채운다.** 모듈 스코프 상태는 없다.
 *
 * `clusterModule` 과의 관계: 이쪽은 **저쪽을 import 하지 않는다**. 둘이 함께 읽는 타입은
 * `module/types/`, 함께 부르는 셈(`trunkEndKey`·`flowEnd`)은 `module/arith` 에 있다 — 그래서
 * 런타임 간선은 `clusterModule → emitModule` 한 방향뿐이다.
 */

import type { IoLine, Link, PlannedLine, PortSide } from "./types/line";
import type {
  BeltTerminus, ModuleInput, ModulePort, TrunkContext,
} from "./types/module";
import type { LinkSeats } from "./types/seat";
import { groupRate } from "./arith/link";
import type { Container, PlacedCell, PortFace, PortPair } from "../shared/types";
import { cellKey, faceCell, vectorToDirection } from "../shared/grid";
import { EntityType } from "../../types/layout";
import {
  makeBeltCell,
  makeContainerCell,
  makeInserterCell,
  makePipeCell,
  makeUndergroundPipeCell,
} from "../shared/cells/builder";
// 유체 줄 조회는 순수 모듈(`module/fluidPorts`)에 있다 — clusterModule 로 가면 런타임 순환이 된다.
import { fluidLineOf } from "./arith/trunk";
import type { PipeFlowPipe } from "../shared/pipeFlow";
import { inserterForReach } from "../shared/gamedata/spec";
// 아래 두 안전망이 *"구성상 발생 안 함"* 이라 적고 있다 — 발동을 세는 것이 그 주장의 검증이다
// (`docs/auto-layout/module/module-planning.md §4.5` — 포트 칸). 관측만 한다: 계산·분기·반환값은 안 바뀐다.
import { recordFaceDepthStats, recordLaneMerge } from "../../debug/runStats";
// **틀과 길** — 배정이 청구할 때 부른 도형(`linkShape`)을 모듈 좌표에 얹는 곳이다(work-kinds §7 D1).
import {
  inputRouteOf, linkFrameOf, machineExtent, outputRouteOf, pipeFrameOf, seatCellsOf, seatsOf, tapAnchorOf,
  type LinkFrame, type PipeFrame,
} from "./shape/body";


/**
 * **링크 포트의 상자·짝** — 트렁크 끝(포트가 붙는 belt 칸)에서 `[belt끝][인서터][상자]` 의
 * 상자 자리(anchor)와 그 짝([PortPair])을 낸다. [emitOutputLinks]·[emitInputLinks] 공통.
 *
 * belt 셀들이 이 `portPair` 를 참조하므로 **belt 를 깔기 전에** 불러야 한다. 방출 방식이
 * 출력/입력에서 뒤집히는 축은 **흐름 방향** 하나뿐이다: 출력은 머신→상자(collect), 입력은
 * 상자→머신(supply). 그래서 producer/consumer 만 role 로 갈린다.
 */
function makeLinkPortChest(o: {
  role: "input" | "output";
  trunkEnd: { x: number; y: number };
  portFace: PortFace;
  pfv: { x: number; y: number };
  line: IoLine;
  machineId: string;
  chestId: string;
}): { chest: Container; portPair: PortPair; seatCell: { x: number; y: number }; chestAt: { x: number; y: number } } {
  const seatCell = { x: o.trunkEnd.x + o.pfv.x, y: o.trunkEnd.y + o.pfv.y }; // 포트 인서터
  const chestAt = { x: o.trunkEnd.x + 2 * o.pfv.x, y: o.trunkEnd.y + 2 * o.pfv.y }; // 포트 상자(anchor)
  const chest: Container = {
    id: o.chestId, kind: "infinity-chest", entityName: "infinity-chest",
    origin: { ...chestAt }, size: { w: 1, h: 1 }, content: o.line.name, role: o.role,
  };
  const port = (id: string) => ({ containerId: id, cell: { ...o.trunkEnd }, face: o.portFace, kind: "item" as const });
  const portPair: PortPair =
    o.role === "output"
      ? { producer: port(o.machineId), consumer: port(o.chestId) } // 머신 → 상자
      : { producer: port(o.chestId), consumer: port(o.machineId) }; // 상자 → 머신
  return { chest, portPair, seatCell, chestAt };
}

/**
 * **좌석 팔은 깊이와 짝이다** — 좌석은 언제나 d1 이므로 벨트가 d`clusterBeltDepth` 면 팔이
 * `clusterBeltDepth-1` 칸을 던져야 한다. 상수를 쓰면 깊은 줄에 앉은 줄이 벨트에 못 닿아 **그 자리가
 * 조용히 굶는다**(2026-08-16 — 깊이 장부가 d3 를 쓰기 시작하면서 실제 위험이 됐다).
 *
 * 포트 인서터는 이 짝이 아니다: 벨트 바로 바깥 칸(d`clusterBeltDepth+1`)에 서서 벨트를 집으므로
 * **언제나 reach 1** 이다 — 그쪽은 `input.inserterEntityName` 을 그대로 쓴다.
 */
function seatInserterName(input: ModuleInput, reach: number): string {
  return inserterForReach(input.inserters, reach)?.entityName ?? input.inserterEntityName;
}

/**
 * **링크 포트의 끝을 놓는다** — belt 를 깐 뒤 `[포트 인서터][상자]` 를 세우고 [ModulePort]
 * 를 push 한다. [emitOutputLinks]·[emitInputLinks] 공통. belt 셀은 caller 가 이미 만들어
 * 넘긴다(`beltCells`). 좌석 탭 인서터도 caller 가 이 함수 **전에** 놓는다(cells 순서 보존).
 *
 * role 로 갈리는 것: 포트 인서터의 **집는 쪽**(출력은 belt→상자 = −pfv, 입력은 상자→belt =
 * pfv), 포트가 서는 **변**(meta.side: 출력 W · 입력 E), `endPreference` 조회 키.
 */
function pushLinkPortEnd(o: {
  role: "input" | "output";
  seatCell: { x: number; y: number };
  chestAt: { x: number; y: number };
  chest: Container;
  portPair: PortPair;
  portFace: PortFace;
  pfv: { x: number; y: number };
  beltCells: PlacedCell[];
  line: IoLine;
  linkId?: string;
  /** 이 포트가 나르는 초당 개수 · 그 줄이 고른 벨트 티어 — 둘 다 그룹에서 온다. */
  rate?: number;
  beltEntityName?: string;
  tapAnchor: { x: number; y: number };
  clusterBeltDepth: number;
  /** 좌석 팔의 reach — `meta.inserter` 를 여기서 유도한다(깊이에서 되유도하지 않는다). */
  reach: number;
  inserterEntityName: string;
  lineEnds: ModuleInput["lineEnds"];
  cells: PlacedCell[];
  chests: Container[];
  occupancy: Set<string>;
  ports: ModulePort[];
  /**
   * **이 모듈이 깐 벨트 칸이 무슨 품목을 나르나** — `cellKey` → 품목([GeneratedModule] 이
   * 파이프에 대해 `pipeCells` 로 하는 것과 같은 자리다. 셀에는 품목이 안 실려 있어서,
   * **놓는 쪽이 적어 두지 않으면 아무도 되찾을 수 없다.**)
   *
   * 소비처는 하나다 — [resolveBeltTermini] 가 *"끝 칸이 저쪽을 보면 남의 품목과 합류하나"*
   * 를 여기서 묻는다. 모든 모듈 벨트가 이 함수를 지나므로 기록도 여기 한 곳이다.
   */
  beltItems: Map<string, string>;
  /**
   * **레인 공유 — 무엇을 다시 놓지 않나.** 둘은 따로 온다:
   * ```
   * reuseBelt   벨트 셀이 첫 줄의 것이다        집는 쪽(입력) — 벨트가 **하나**다
   * reusePort   포트 인서터·상자가 첫 줄의 것이다  양쪽 다 — 포트는 언제나 하나다
   * ```
   * **싣는 쪽(출력)은 벨트가 둘**이라 `reuseBelt` 를 안 쓴다 — 자기 벨트는 자기가 놓고,
   * 출구에서 합류해 포트만 나눠 쓴다.
   */
  reuseBelt?: boolean;
  reusePort?: boolean;
  /** 이 줄이 남과 나눠 쓰는 물리 벨트의 신원([Link.sharedLineId]) — 채널이 합류를 안다. */
  sharedLineId?: string;
}): void {
  const pickup = o.role === "output" ? { x: -o.pfv.x, y: -o.pfv.y } : o.pfv;
  // **`reuse` = 이미 놓인 물리 벨트에 논리 포트만 하나 더 얹는다**(레인 공유).
  //
  // 셀·상자·점유를 다시 만들지 않는다 — 물리적으로는 벨트도 포트 인서터도 상자도 **하나**다.
  // 그런데 [ModulePort] 는 **줄마다** 있어야 한다: 납품 짝짓기가 `linkId`·품목으로 조회하고
  // (`pairDeliveryPorts`), 상자 id 로 *"이 포트는 이미 짝지었다"* 를 센다(`usedIn`).
  // **그래서 상자 객체는 줄마다 자기 것(자기 id)이되, `chests` 에 들어가는 것은 하나다** —
  // 같은 객체를 공유하면 먼저 짝지은 줄이 그 id 를 `usedIn` 에 넣어 **나머지가 영영 짝을
  // 못 찾는다.**
  if (!o.reuseBelt) {
    o.cells.push(...o.beltCells);
    for (const c of o.beltCells) {
      o.occupancy.add(cellKey(c.x, c.y));
      o.beltItems.set(cellKey(c.x, c.y), o.line.name);
    }
  }
  if (!o.reusePort) {
    o.cells.push(
      makeInserterCell(o.seatCell, pickup, o.inserterEntityName, o.portPair),
      makeContainerCell(o.chest, o.chestAt),
    );
    o.occupancy.add(cellKey(o.seatCell.x, o.seatCell.y));
    o.occupancy.add(cellKey(o.chestAt.x, o.chestAt.y));
    o.chests.push(o.chest);
  }
  o.ports.push({
    line: o.line, anchor: { ...o.chestAt }, tapAnchor: o.tapAnchor, face: o.portFace,
    moduleWayOuts: [], chest: o.chest, cells: o.beltCells, linkId: o.linkId,
    rate: o.rate, beltEntityName: o.beltEntityName, sharedLineId: o.sharedLineId,
    meta: {
      // **어느 변에 섰나** — 반출·채널 장부의 단일 출처([[ns-face-relief]] 결정 5).
      // `portFace` 와 같은 값이어야 한다: gap 그룹은 서/동쪽 변으로 나가고, W/E 면 그룹은
      // 자기 면으로 나간다. 역할(출력=W·입력=E)로 찍던 옛 값은 그 둘이 늘 일치할 때만 맞았다.
      item: o.line.name, side: o.portFace, clusterBeltDepth: o.clusterBeltDepth,
      // **계획이 지목한 팔에서 유도한다** — 예전엔 `clusterBeltDepth === 2 ? "normal" : "long"` 이라
      // §16 이 경고한 `if (depth === 3)` 그 자체였다(깊이를 입력으로 두면 생긴다).
      inserter: o.reach <= 1 ? "normal" : "long",
      amount: o.line.amount, endPreference: o.lineEnds?.get(`${o.role}:${o.line.name}`),
    },
  });
}

/**
 * **출구 합류** — 먼저 나온 줄(`sharedLineId` → 그 줄의 합류 칸·포트).
 *
 * 싣는 쪽은 벨트가 **둘**이라야 두 레인이 다 찬다(팔이 각자 먼 레인에 떨군다). 그 둘을
 * **기둥 끝 바깥 한 행**에서 마주 보게 해 합친다 — 자리가 규칙적이라 좌표로 계산된다
 * (`docs/factorio/belt-lane-semantics.md` ③ · `tempPlanDocs/벨트-레인/` ㉡-3):
 *
 * **갈린 두 줄은 같은 깊이에 위/아래로 쌓인다** — 구간이 안 겹쳐 한 깊이를 나눠 쓰기
 * 때문이다. 그래서 도형이 이렇게 된다(포트가 위쪽 끝, `d` = 둘의 공통 깊이):
 *
 * ```
 *  행 tL-1                [ 포트 ]                      ← 인서터·상자는 d+1 열에서 나간다
 *  행 tL      L(d) →깊게→ [ M(d+1) ] ←얕게← (d+2)       M = 합류 칸, 포트 쪽으로 나간다
 *  …          L 수집(d)                     (d+2) ↑     F 가 d+2 를 따라 올라온다
 *  행 tF      F(d) →깊게→ (d+1) →깊게→      (d+2) ↑
 *  …          F 수집(d)
 * ```
 *
 * **왜 꺾어야 하나** — 합류 칸은 **뒤 유입이 없어야** 한다(⑤: 뒤에서 온 쪽이 두 레인을
 * 선점하고 옆 쪽을 굶긴다). 옆 포트는 벨트 끝 칸이 곧 포트라 꺾을 자리가 없어서, 배정이
 * 합류 쌍에는 **기둥 끝 포트를 강제한다**(`tryLinkFace` 의 `forceEnd`). 그러면 벨트가
 * 깊은 쪽으로 한 번 꺾고 **그 꺾인 칸(M)** 이 합류 칸이 된다 — `M` 의 뒤(`d+1`, 행 tL+1)는
 * 비어 있다.
 *
 * **`d+2` 는 팔이 안 닿는 열이라 아무도 안 쓴다**(깊이 = 1 + reach). 배정이 그 구간을
 * 미리 청구한다(`commitLinkFace` 의 `merged`).
 *
 * **왜 모듈 안인가** — 두 줄 구간이 한 줄로 합쳐지는 순간이 **빠를수록** 공간을 아낀다
 * (2026-09-04 사장님). 채널은 통로일 뿐이고, 합류는 여기서 끝나야 포트·트랙·납품이 전부
 * 하나가 된다.
 */
export interface SharedExit {
  trunkStart: { x: number; y: number };
  portPair: PortPair; seatCell: { x: number; y: number };
  chestAt: { x: number; y: number }; chest: Container;
  /** 이끄는 줄의 **포트 쪽 끝 행** — 따르는 줄이 여기까지 비켜 올라온다. */
  topT: number;
}

/**
 * **레인 공유** — 이미 깔린 물리 벨트(`sharedLineId` → 첫 줄이 놓은 것).
 *
 * 집는 쪽은 벨트가 **하나**다(합류한 벨트가 벽의 한 칸으로 들어온다). 둘째 줄은 자기
 * **좌석 팔만** 놓고 벨트·포트 인서터·상자는 첫 줄의 것을 그대로 쓴다.
 * 배정이 이미 같은 면·같은 깊이를 줬으므로([seatOnSharedBelt]) 여기서 기하를 다시 안 고른다.
 */
export interface SharedBelt {
  beltCells: PlacedCell[];
  portPair: PortPair;
  beltTop: { x: number; y: number };
}

/**
 * **좌석 팔** — 좌석(d1) 행마다 인서터 하나. 출력 · 입력 공통.
 *
 * 역할이 뒤집는 것은 둘뿐이다 — **집는 쪽**(싣는 쪽은 머신에서 집어 벨트로 = 안쪽, 집는 쪽은 벨트에서 집어
 * 머신으로 = 바깥)과 짝의 생산자/소비자. 팔 종류는 [seatInserterName] 이 깊이에서 정한다.
 */
function placeSeatArms(
  role: "output" | "input",
  frame: LinkFrame,
  chestId: string,
  arm: string,
  cells: PlacedCell[],
  occupancy: Set<string>,
): void {
  const { face, ext } = frame;
  const pickup = role === "output" ? frame.inward : frame.fv;
  for (const s of frame.seats) {
    for (const t of s.rows) {
      const seat = faceCell(ext, face, 1, t);
      const machineSide = { containerId: s.m.id, cell: { ...seat }, face, kind: "item" as const };
      const chestSide = { containerId: chestId, cell: { ...seat }, face, kind: "item" as const };
      const pair: PortPair = role === "output"
        ? { producer: machineSide, consumer: chestSide }
        : { producer: chestSide, consumer: machineSide };
      cells.push(makeInserterCell(seat, pickup, arm, pair));
      occupancy.add(cellKey(seat.x, seat.y));
    }
  }
}

/**
 * **싣는 쪽 방출** — 그룹마다 좌석 팔 · 수집 벨트 · 포트(인서터 + 상자)를 놓는다. 자리는 배정이 이미 정했다
 * ([LinkSeats] — 면 · 깊이 · 좌석 · 끝 · 합류 역할). 그룹 하나가 놓이는 순서:
 *
 * ```
 * ⓐ 판정 받기  배정이 없으면 못 앉은 줄(계획의 답)     ⓔ 포트   상자 · 짝(따르면 첫 줄의 물리 자리)
 * ⓑ 틀         면 · 좌석 · 포트 면 · 흐름 끝          ⓕ 검사   길 · 포트 칸이 비었나(안전망)
 * ⓒ 짝         이끄나 · 따르나                        ⓖ 찍기   벨트 → 좌석 팔 → 포트 끝
 * ⓓ 길         칸 순서와 방향([outputRouteOf])         ⓗ 장부   합류 칸 등록
 * ```
 *
 * **포트(ⓔ)가 검사(ⓕ)보다 앞이다** — 집는 쪽과 반대다. 상자 id 에 순번이 들어가 막힌 그룹도 번호를 먹는다.
 */
export function emitOutputLinks(args: {
  groups: Link[];
  seats: (LinkSeats | undefined)[];
  lineOf: Map<string, IoLine>;
  machines: Container[];
  input: ModuleInput;
  prefix: string;
  occupancy: Set<string>;
  cells: PlacedCell[];
  chests: Container[];
  outputPorts: ModulePort[];
  unroutedLines: IoLine[];
  /** 깐 벨트의 품목 장부 — [pushLinkPortEnd] 가 채운다. */
  beltItems: Map<string, string>;
}): void {
  const { groups, machines, input, prefix, occupancy, cells, chests, outputPorts, unroutedLines, beltItems } = args;
  /** 합류 칸 — 먼저 나온 줄이 적고 따르는 줄이 읽는다([SharedExit]). */
  const sharedExit = new Map<string, SharedExit>();
  const ext = machineExtent(machines);
  let seq = 0;

  groups.forEach((group, gi) => {
    // ⓐ 판정 받기 — 배정이 없으면 두 면이 다 찬 줄이다(계획의 답을 적는다)
    const line = args.lineOf.get(group.item);
    if (!line) return;
    const plan = args.seats[gi];
    if (!plan) {
      unroutedLines.push(line); // 두 면 다 찼다(거대 출력) → 정직 폴백(N/S gap 은 후속)
      return;
    }
    // ⓑ 틀 — 면 · 좌석 · 포트 면 · 깊이 · 흐름 끝. 배정과 머신 좌표만 읽는다
    const seats = seatsOf(plan, machines);
    if (seats.length === 0) return;
    const frame = linkFrameOf("output", plan, seats, ext);
    const { m0, portFace, pfv, clusterBeltDepth, topT } = frame;
    // ⓒ 짝 — 출구 합류. 짝의 **둘째** 줄이면 첫 줄이 만든 합류 칸·포트를 그대로 쓴다. 첫 줄이면 합류 칸을
    // 새로 만든다. 기하가 안 서면(gap · 끝 없음 · 반출 줄로 내려감) 합류하지 않는다 —
    // 그런 짝은 배정이 이미 풀었으므로 정상 경로에선 여기 오지 않는다.
    // **역할은 배정이 정한다**(2026-09-12 F2). 예전엔 여기서 신원(`sharedLineId`)과 기하
    // (면·깊이·끝)를 **다시 판정**했는데, 배정이 짝을 푼 뒤에도 신원이 남아 둘이 갈렸다.
    const canMerge = plan.mergeRole === "lead";
    // **자기도 합류 도형을 세울 수 있을 때만 첫 줄을 따른다**(2026-09-04).
    //
    // 예전엔 `sharedExit` 에 신원만 있으면 따랐다. 그런데 따르는 줄이 **끝을 못 받았거나
    // gap 으로 밀렸으면** 포트 면이 W/E 라 아래 순회가 **열을 걸으면서 행을 목표로 삼는다**
    // — 영영 안 끝난다(실측: 힙 소진으로 워커 사망, 사유도 스택도 안 남았다).
    const followed = plan.mergeRole === "follow" && group.sharedLineId !== undefined
      ? sharedExit.get(group.sharedLineId)
      : undefined;
    // ⓓ 길 — 칸 순서와 방향. W/E 는 계획이 청구한 그 도형을 좌표에 얹고, gap 은 수집 → 내려가기 → 반출
    const route = outputRouteOf(frame, plan);
    // ⓔ 포트
    const trunkStart = followed ? followed.trunkStart : route.trunkStart;
    const chestId = `${prefix}-output-${line.name}-${seq++}`;
    const made = makeLinkPortChest({
      role: "output", trunkEnd: trunkStart, portFace, pfv, line, machineId: m0.id, chestId,
    });
    // 물리 자리(벨트 끝·인서터·상자)는 첫 줄의 것을 그대로 쓰되 **상자 객체는 자기 것**이다
    // (`usedIn` 이 상자 id 로 짝짓기를 세므로 — [pushLinkPortEnd] 의 `reuse` 주석).
    const { portPair, seatCell, chestAt } = followed ?? made;
    const chest = made.chest;
    // ⓕ 검사 — 길 · 포트 칸이 비었나. 발동하면 그 "구성상"이 틀린 것이다(오늘 gap 포트에서 발동한다 — work-kinds §7 D8)
    const blocked = route.path.some((c) => occupancy.has(cellKey(c.at.x, c.at.y)));
    if (blocked || (!followed && (occupancy.has(cellKey(seatCell.x, seatCell.y)) || occupancy.has(cellKey(chestAt.x, chestAt.y))))) {
      recordFaceDepthStats({ netTrips: 1 }); // ← 발동하면 그 "구성상"이 틀린 것이다
      unroutedLines.push(line); // 안전망(구성상 발생 안 함)
      return;
    }

    // ⓖ 찍기
    // **티어는 그룹이 든다**(2026-08-23) — 실으려는 양을 정한 곳([determineBeltCount])과
    // 깔 벨트를 고르는 곳이 갈리면 용량이 거짓이 된다. 모르면 기본 벨트로 떨어진다.
    const beltCells: PlacedCell[] = route.path.map((c) =>
      makeBeltCell(c.at, vectorToDirection(c.v.x, c.v.y), group.beltEntityName ?? input.beltEntityName, portPair),
    );
    // 탭 픽업 = 좌석 면의 안쪽(−fv, 머신에서 집어 belt 로). 팔 종류는 [seatInserterName].
    placeSeatArms("output", frame, chestId, seatInserterName(input, plan.reach), cells, occupancy);
    // 포트 끝은 공통 방출기가 놓는다(belt 에서 집어 chest 로). 끝점은 도형이 든다([tapAnchorOf]).
    pushLinkPortEnd({
      role: "output", seatCell, chestAt, chest, portPair, portFace, pfv, beltCells,
      line, linkId: group.id, rate: groupRate(group), beltEntityName: group.beltEntityName,
      tapAnchor: tapAnchorOf("output", frame, trunkStart),
      clusterBeltDepth, reach: plan.reach, inserterEntityName: input.inserterEntityName, lineEnds: input.lineEnds,
      cells, chests, occupancy, ports: outputPorts, beltItems,
      // 벨트는 **자기 것**이라 늘 놓는다(싣는 쪽은 벨트가 둘이다). 포트만 나눠 쓴다.
      reusePort: followed !== undefined, sharedLineId: group.sharedLineId,
    });
    // ⓗ 장부
    if (canMerge && !followed && group.sharedLineId !== undefined) {
      sharedExit.set(group.sharedLineId, { trunkStart, portPair, seatCell, chestAt, chest, topT });
    }
    // **여기까지 와야 물리 벨트를 하나 아낀 것이다** — 자격(`짝`)도 배정도 통과했는데
    // 방출에서 칸이 막혀 되돌아가는 일이 있다. 계측은 **마지막 관문**에서 센다.
    if (followed) recordLaneMerge();
  });
}

/**
 * **입력 fan-in 방출** — [emitOutputLinks] 의 거울. 링크마다 부모 머신(toMachine) 하나의
 * 연속 좌석 k개에 입력 탭을 앉히고, 세로 belt 를 깔아 **E변(자식 쪽)으로** 포트 하나를 낸다.
 * 자식 출력 포트와 **링크 순서로 1:1** 짝지어지도록 링크 순서대로 낸다.
 *
 * 기하(E면, 머신 origin (mx,my), base, k): 탭=faceCell d1 (mx+w, ...) 벨트에서 집어 머신에
 * 넣음; belt=d2 세로(아래로 흐름 — 포트에서 받아 탭에 분배); 포트 인서터=d3, chest=d4(동).
 *
 * 그룹 하나가 놓이는 순서는 [emitOutputLinks] 와 같고 둘이 다르다 — **좌석 막힘**을 먼저 보고, **검사가 포트보다 앞**이다.
 */
export function emitInputLinks(args: {
  groups: Link[];
  seats: (LinkSeats | undefined)[];
  lineOf: Map<string, IoLine>;
  machines: Container[];
  input: ModuleInput;
  prefix: string;
  occupancy: Set<string>;
  cells: PlacedCell[];
  chests: Container[];
  inputPorts: ModulePort[];
  unroutedLines: IoLine[];
  /** 깐 벨트의 품목 장부 — [pushLinkPortEnd] 가 채운다. */
  beltItems: Map<string, string>;
  /** **흐름의 끝 칸** — 여기선 등록만 한다([resolveBeltTermini] 가 방향을 정한다). */
  termini: BeltTerminus[];
}): void {
  const { groups, machines, input, prefix, occupancy, cells, chests, inputPorts, unroutedLines, beltItems, termini } = args;
  /** 레인 공유 — 첫 줄이 놓은 물리 벨트([SharedBelt]). */
  const sharedBelts = new Map<string, SharedBelt>();
  const ext = machineExtent(machines);
  let seq = 0;

  groups.forEach((group, gi) => {
    // ⓐ 판정 받기
    const line = args.lineOf.get(group.item);
    if (!line) return;
    const plan = args.seats[gi];
    if (!plan) { unroutedLines.push(line); return; } // 두 면 다 찼다 → 정직 폴백
    // ⓑ 틀
    const frame = linkFrameOf("input", plan, seatsOf(plan, machines), ext);
    const { m0, portFace, pfv, clusterBeltDepth } = frame;
    // ⓒ 좌석 — 좌석(d1)이 막히면 폴백한다 — **깊이는 고를 것이 없다**(배정이 들고 온 값이다).
    if (seatCellsOf(frame).some((c) => occupancy.has(cellKey(c.x, c.y)))) { unroutedLines.push(line); return; }
    // ⓓ 짝 — **얹힐지는 배정이 정한다**([LinkFacePlan.sharesBelt] · 2026-09-12 F2). 예전엔 신원만
    // 보고 먼저 나온 벨트에 무조건 얹었는데, 배정이 짝을 풀어 **자기 벨트를 청구한 줄**까지
    // 얹혀 버렸다 — 청구한 칸은 유령 예약이 되고 그 줄의 팔은 벨트 없는 칸에 섰다.
    const reuse = plan.sharesBelt && group.sharedLineId !== undefined
      ? sharedBelts.get(group.sharedLineId)
      : undefined;
    // ⓔ 길 — 포트에서 받아 좌석 구간에 나눠 준다. 먼 끝 칸의 최종 방향은 늦은 결정이 정한다
    const route = inputRouteOf(frame, plan);
    // ⓕ 검사
    const te = route.trunkEnd;
    const span = [
      ...route.path.map((c) => c.at),
      { x: te.x + pfv.x, y: te.y + pfv.y },
      { x: te.x + 2 * pfv.x, y: te.y + 2 * pfv.y }, // 포트 인서터·상자
    ];
    // **짝의 둘째 줄은 이 검사를 건너뛴다** — 그 칸들은 첫 줄이 놓은 **자기 벨트**다.
    // 여기서 막는 것은 *"남이 이미 쓰는 칸"* 인데, 공유는 정의상 같은 줄이 쓰는 것이다.
    if (!reuse && span.some((c) => occupancy.has(cellKey(c.x, c.y)))) {
      recordFaceDepthStats({ netTrips: 1 }); // ← 발동하면 그 "구성상"이 틀린 것이다
      unroutedLines.push(line); // 안전망(구성상 발생 안 함 — 좌석 장부가 이미 막았어야 한다)
      return;
    }

    // ⓖ 포트 — **포트 자리도 첫 줄의 것이다** — 둘째 줄은 자기 좌석 행이 달라 `topT` 가 다르게 나오는데,
    // 물리 벨트가 하나이므로 그 끝도 하나여야 한다. 여기서 다시 재면 논리 포트 둘이 **서로 다른
    // 칸**에 서서, 합류한 벨트가 그중 하나만 먹인다.
    // **포트가 붙는 칸은 도형의 시작이다** — 집는 쪽은 포트에서 받아 흘려보낸다.
    const beltTop = reuse?.beltTop ?? route.beltTop;
    const chestId = `${prefix}-input-${line.name}-${seq++}`;
    const { chest, portPair, seatCell, chestAt } = makeLinkPortChest({
      role: "input", trunkEnd: beltTop, portFace, pfv, line, machineId: m0.id, chestId,
    });

    // ⓗ 찍기
    // 공유면 벨트 셀도 첫 줄의 것이다 — 다시 만들면 같은 칸에 두 번 놓인다.
    const beltCells: PlacedCell[] = reuse
      ? reuse.beltCells
      : route.path.map((c) =>
          // 티어는 그룹이 든다 — [emitOutputLinks] 와 같은 규약(2026-08-23).
          makeBeltCell(c.at, vectorToDirection(c.v.x, c.v.y), group.beltEntityName ?? input.beltEntityName, portPair),
        );
    // **끝 칸은 물리 벨트당 하나다** — 짝의 둘째 줄(`reuse`)은 첫 줄이 이미 등록했다.
    // 두 번 등록하면 같은 칸을 두 번 판정하고, 종착이면 **지하 입구를 두 번 세운다.**
    if (!reuse && route.farIdx >= 0)
      termini.push({
        cell: beltCells[route.farIdx], item: line.name, flow: route.flow, inward: frame.inward, pair: portPair,
      });
    placeSeatArms("input", frame, chestId, seatInserterName(input, plan.reach), cells, occupancy);
    // 포트 끝은 공통 방출기가 놓는다(상자에서 집어 belt 로).
    pushLinkPortEnd({
      role: "input", seatCell, chestAt, chest, portPair, portFace, pfv, beltCells,
      line, linkId: group.id, rate: groupRate(group), beltEntityName: group.beltEntityName,
      tapAnchor: tapAnchorOf("input", frame, beltTop),
      clusterBeltDepth, reach: plan.reach, inserterEntityName: input.inserterEntityName, lineEnds: input.lineEnds,
      cells, chests, occupancy, ports: inputPorts, beltItems,
      reuseBelt: reuse !== undefined, reusePort: reuse !== undefined,
      sharedLineId: group.sharedLineId,
    });
    // ⓘ 장부
    if (group.sharedLineId !== undefined && !reuse) {
      sharedBelts.set(group.sharedLineId, { beltCells, portPair, beltTop });
    }
  });
}

/**
 * **트렁크 파이프 방출** — 유체 줄마다 파이프 한 줄을 머신 기둥 전체에 직선으로 깔아 모든 머신의 유체 입구
 * 칸에 직접 닿게 한다. **인서터가 없다** — 유체는 인서터로 못 옮긴다. 포트는 무한**파이프**로 끝난다.
 * 포트 모양은 링크 포트와 같은 계약(`deliveryRoute` 머리말 — chest = anchor · seat = anchor − faceVec ·
 * trunkStart = anchor − 2·faceVec)을 따르고, 엇갈림 기준은 [TrunkContext.maxDepthAtEnd] 다.
 *
 * 점프 모드([pipeJumpToClusterPipe])면 좌석 줄(d=1)의 유체 상자 칸만 먹고, 벨트들을 지하로
 * 넘어 바깥 [ClusterPipe] 로 합류한다 — 그래야 그 면의 나머지 좌석이 아이템 줄에 돌아간다.
 *
 * 줄 하나가 놓이는 순서: ⓑ 틀([pipeFrameOf]) → ⓒ 상자 · 짝([makePipePortChest]) → ⓓ 기둥(끊기면 상자를 물린다) →
 * ⓔ 포트 · 점프([pipeJumpCells]) → ⓕ 적기 → ⓖ 포트 기록([pipePortOf]).
 */
export function emitTrunkPipe(args: {
  plan: { ok: true; lines: PlannedLine[] };
  machines: Container[];
  input: ModuleInput;
  prefix: string;
  occupancy: Set<string>;
  cells: PlacedCell[];
  chests: Container[];
  inputPorts: ModulePort[];
  outputPorts: ModulePort[];
  unroutedLines: IoLine[];
  ctx: TrunkContext;
  /** chestId 순번 — 모듈 하나에서 이어 쓴다. 끊긴 줄도 번호를 먹는다. */
  seqRef: { n: number };
  /**
   * **이 줄들이 깐 파이프 셀이 어느 유체냐** — [GeneratedModule.pipeCells] 로 나간다.
   * 모듈이 유체를 여럿 다루면 모듈 단위로는 답할 수 없어서, 방출한 쪽이 직접 채운다.
   */
  pipeCells: PipeFlowPipe[];
}): void {
  const { plan, machines, input, prefix, occupancy, cells, chests, ctx } = args;

  for (const planned of plan.lines) {
    if (planned.line.kind !== "pipe") continue; // 계획은 유체 줄만 넘긴다 — 거르기는 그물이다.
    const line = planned.line;
    // ⓑ 틀 — 면 · 방출 깊이(점프면 ClusterPipe) · 나가는 끝 · 엇갈림 · 기둥 범위 · 포트 두 칸
    const frame = pipeFrameOf(planned, ctx, input.lineEnds);
    const { face, d, ext, beltEnd, seat, chestAt, lo, hi } = frame;
    // ⓒ 상자 · 짝 — 끊기면 물린다. 번호는 끊긴 줄도 먹는다
    const chestId = `${prefix}-${line.role}-${line.name}-${args.seqRef.n++}`;
    const { chest, beltPair } = makePipePortChest({ line, chestId, chestAt, beltEnd, face, machineId: machines[0].id });
    chests.push(chest);
    // ⓓ 기둥 — 트렁크 파이프 한 줄. depth 1 이면 이 직선이 모든 머신의 유체 입구 칸을 지나간다
    // (trunk-pipe §1) — 그래서 인서터도, 탭도, 분기도 필요 없다.
    //
    // **한 칸이라도 막히면 줄 전체가 실패다.** 예전엔 그 칸만 `continue` 로 건너뛰었는데
    // (주석은 "구성상 발생 안 함"), 파이프는 **끊기면 아래쪽이 통째로 죽는다** — 건너뛴 칸
    // 너머의 머신들은 유체를 못 받으면서 겹침도 미배치도 아니라 **화면상 멀쩡해 보인다.**
    // gap 벨트의 포트 끝이 좌석 줄에 앉는 배치에서 실제로 났다(2026-08-05). 근치는
    // [buildTrunkContext] 의 점프 조건 ④이고, 여기는 그게 놓친 것을 **삼키지 않는** 그물이다.
    const beltCells: PlacedCell[] = [];
    let severed = false;
    for (let t = lo; t <= hi; t++) {
      const at = faceCell(ext, face, d, t);
      if (occupancy.has(cellKey(at.x, at.y))) { severed = true; break; }
      beltCells.push(makePipeCell(at, input.fluidTrunk!.pipeEntityName, beltPair));
    }
    if (severed) {
      args.unroutedLines.push(line);
      chests.pop(); // 방금 넣은 포트 상자를 물린다 — 안 놓을 줄의 상자를 남기면 안 된다.
      continue;
    }

    // ⓔ 포트 · 점프 — 포트 끝은 [파이프][무한파이프] 일직선. 인서터가 없다.
    const portCells: PlacedCell[] = [
      makeContainerCell(chest, chestAt),
      makePipeCell(seat, input.fluidTrunk!.pipeEntityName, beltPair),
    ];

    const jumpCells: PlacedCell[] = ctx.pipeJumpMode(face as PortSide)
      ? pipeJumpCells(frame, line, machines, input, occupancy, beltPair)
      : [];

    // ⓕ 적기
    for (const c of [...beltCells, ...portCells, ...jumpCells]) {
      cells.push(c);
      occupancy.add(cellKey(c.x, c.y));
      // 이 칸이 나르는 유체를 **놓는 자리에서** 기록한다 — 나중에 모듈 단위로 되짚으면
      // 유체가 여럿일 때 답이 없다([GeneratedModule.pipeCells]).
      //
      // 지하파이프는 **방향까지** 싣는다. 표면에서 `direction` 한 면으로만 이어지므로,
      // 가드가 그 사실을 알아야 같은 면에 유체 두 줄이 설 수 있다(trunk-pipe §5.2). 여기서 안 실으면
      // 가드는 지상 파이프로 보고 네 이웃을 다 막아 **자기 배치를 자기가 거절한다.**
      args.pipeCells.push(
        c.cell.entityType === EntityType.PipeUnderground
          ? { x: c.x, y: c.y, fluid: line.name, connectDir: c.cell.direction }
          : { x: c.x, y: c.y, fluid: line.name },
      );
    }

    // ⓖ 포트 기록
    const port = pipePortOf(planned, frame, chest, beltCells, input.lineEnds);
    if (line.role === "output") args.outputPorts.push(port);
    else args.inputPorts.push(port);
  }
}

/**
 * **유체 포트의 상자 · 짝** — 무한파이프 상자와 기둥 끝 칸의 짝. [makeLinkPortChest] 의 유체 판이다.
 * 파이프는 흐름 방향이 없다 — 압력이 알아서 흐른다. 그래도 짝의 생산자/소비자는 역할이 정한다.
 */
function makePipePortChest(o: {
  line: IoLine;
  chestId: string;
  chestAt: { x: number; y: number };
  beltEnd: { x: number; y: number };
  face: PortFace;
  machineId: string;
}): { chest: Container; beltPair: PortPair } {
  const { line, chestId, chestAt, beltEnd, face } = o;
  const chest: Container = {
    id: chestId,
    kind: "infinity-pipe",
    entityName: "infinity-pipe",
    origin: { ...chestAt },
    size: { w: 1, h: 1 },
    content: line.name,
    role: line.role,
  };
  const beltPair: PortPair = {
    producer: {
      containerId: line.role === "input" ? chestId : o.machineId,
      cell: { ...beltEnd }, face, kind: { fluid: line.name },
    },
    consumer: {
      containerId: line.role === "input" ? o.machineId : chestId,
      cell: { ...beltEnd }, face, kind: { fluid: line.name },
    },
  };
  return { chest, beltPair };
}

/**
 * **점프 칸** — [pipeJumpToClusterPipe] 모드에서 머신마다 유체 상자 칸 · 탭 칸에 지하파이프 한 쌍.
 *
 *   머신 | d1 fluidboxPipeCell | d2..dN 벨트(지하로 통과) | dN+1 ClusterPipeTapCell | dN+2 ClusterPipe
 *
 * 각 머신은 **자기 유체 상자 행**에서만 점프한다 — 행이 서로 달라 corridor 끼리 안 부딪힌다.
 * 지하파이프 direction = **지상 입구가 향하는 방향**(표면 연결 측, containerRouting 컨벤션):
 *  - fluidboxPipeCell: 표면이 머신 유체 상자를 향한다(−fv). 터널은 +fv 로 진행.
 *  - ClusterPipeTapCell: 표면이 바깥 ClusterPipe 를 향한다(+fv).
 */
function pipeJumpCells(
  frame: PipeFrame,
  line: IoLine,
  machines: Container[],
  input: ModuleInput,
  occupancy: Set<string>,
  beltPair: PortPair,
): PlacedCell[] {
  const { face, fv, d, vertical, ext } = frame;
  const jumpCells: PlacedCell[] = [];
  // **이 줄의** 유체 상자 행과 깊이를 쓴다 — 같은 면의 다른 유체 줄은 자기 행·자기 깊이다.
  const fbOffset = fluidLineOf(input.fluidTrunk, line)?.fluidboxOffset ?? 0;
  const tapDepth = d - 1; // d = 이 줄의 ClusterPipe 깊이(점프 모드).
  for (const m of machines) {
    const row = (vertical ? m.origin.y : m.origin.x) + fbOffset;
    const boxCell = faceCell(ext, face, 1, row);
    const tapCell = faceCell(ext, face, tapDepth, row);
    if (occupancy.has(cellKey(boxCell.x, boxCell.y)) || occupancy.has(cellKey(tapCell.x, tapCell.y))) {
      continue; // 안전망(구성상 발생 안 함 — 좌석 remap 이 유체 상자 행을 비워 둔다).
    }
    jumpCells.push(
      makeUndergroundPipeCell(
        boxCell,
        vectorToDirection(-fv.x, -fv.y),
        input.fluidTrunk!.undergroundPipeEntityName!,
        beltPair,
      ),
      makeUndergroundPipeCell(
        tapCell,
        vectorToDirection(fv.x, fv.y),
        input.fluidTrunk!.undergroundPipeEntityName!,
        beltPair,
      ),
    );
  }
  return jumpCells;
}

/** **유체 포트 기록** — 무한파이프에서 끝나는 포트. 파이프는 인서터가 없어 `meta.inserter` 가 비기도 한다. */
function pipePortOf(
  planned: PlannedLine,
  frame: PipeFrame,
  chest: Container,
  beltCells: PlacedCell[],
  lineEnds: ModuleInput["lineEnds"],
): ModulePort {
  const line = planned.line;
  const { d, beltEnd, chestAt, exitFace } = frame;
  const port: ModulePort = {
    line,
    anchor: { ...chestAt },
    tapAnchor: { ...beltEnd },
    face: exitFace,
    moduleWayOuts: [],
    chest,
    cells: beltCells,
    meta: {
      item: line.name,
      side: planned.side,
      clusterBeltDepth: d,
      // 파이프는 인서터가 없어 undefined.
      inserter:
        planned.reach === undefined ? undefined : planned.reach >= 2 ? "long" : "normal",
      amount: line.amount,
    endPreference: lineEnds?.get(`${line.role}:${line.name}`),
    },
  };
  return port;
}

// ─────────────────────────────────────────────────────────────────────────────
// 삭제 기록 (2026-08-05) — `emitDirectInserting` · `rimCell`
//
// 1:1 다이렉트 인서팅의 전용 방출기였다: 머신 둘레 칸마다 `[상자][인서터][머신]` 을 세워
// **포트마다 상자 하나**를 냈다. 공급 모델 통합으로 그 줄들도 `emitOutputLinks`/
// `emitInputLinks` 를 타면서 호출자가 0이 됐다.
//
// 왜 남겨 두지 않았나 — 두 방출기가 같은 면에 각자의 슬롯 셈으로 자리를 잡으면 좌석 장부가
// 갈린다. 그리고 남아 있으면 다음 세션이 **둘 중 어느 것이 사실인지** 알 수 없다.
// 바뀐 점(팔 여러 개가 상자 여러 개 → 벨트 하나 + 포트 하나)은 `module/build.test.ts`
// "팔 여러 개가 한 포트로 모인다" 가 지킨다.
// ─────────────────────────────────────────────────────────────────────────────
