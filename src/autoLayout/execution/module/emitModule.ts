/**
 * 모듈 안쪽 방출 — **배치 실행**. 계획대로 셀을 놓는다.
 *
 * `clusterModule.generateModule`(계획·오케스트레이션)에서 **셀을 만드는 부분만** 떼어냈다.
 * 여기 있는 네 함수는 자리를 *고르지 않는다* — 이미 정해진 배정(면·깊이·좌석)을 받아
 * belt·인서터·상자·파이프를 격자에 **놓기만** 한다.
 *
 * | 함수 | 무엇을 놓나 |
 * |---|---|
 * | `emitOutputLinks` | 출력 fan-out — 탭 인서터 + 수집 belt + 포트 상자 |
 * | `emitInputLinks`  | 입력 fan-in — 공급 belt + 탭 인서터 |
 * | `emitTapInserting`| 트렁크 belt 한 줄 + 머신마다 탭 인서터 |
 * | `emitTrunkPipe`   | 유체 트렁크 파이프 + 지하 점프 |
 *
 * **공통 규약:** 인자 객체로 받은 누적기(`occupancy`·`cells`·`chests`·`inputPorts`·
 * `outputPorts`·`unroutedLines`)를 **in-place 로 채운다.** 모듈 스코프 상태는 없다.
 *
 * `clusterModule` 과의 관계: 이쪽이 저쪽 타입을 **`import type` 으로만** 본다
 * (런타임 간선은 `clusterModule → emitModule` 한 방향뿐 — 순환 아님).
 */

import type { IoLine, PlannedLine, PortSide } from "../../planner/module/clusterPortPlanner";
import type { MachineLinkGroup } from "../../module/machineLinkGroup";
import type { Container, PlacedCell, PortFace, PortPair } from "../../containerModel";
import { cellKey, faceCell, faceVector, vectorToDirection } from "../../util/helper";
import { EntityType } from "../../../types/layout";
import {
  makeBeltCell,
  makeContainerCell,
  makeInserterCell,
  makePipeCell,
  makeUndergroundPipeCell,
} from "../../util/cellBuilder";
// 타입 전용 — 런타임 간선이 아니므로 clusterModule 과 순환이 되지 않는다.
import type {
  ModuleInput,
  ModulePort,
  TrunkContext,
} from "../../module/clusterModule";
import type { LinkSeats } from "../../planner/module/linkPlanner";
// trunkEndKey 는 계획 산출물(트렁크 종착 키)이라 clusterModule 소유 — 런타임 import.
import { trunkEndKey } from "../../module/clusterModule";
// 유체 줄 조회는 순수 모듈(`module/fluidPorts`)에 있다 — clusterModule 로 가면 런타임 순환이 된다.
import { fluidLineOf } from "../../module/fluidPorts";
import type { PipeFlowPipe } from "../../util/pipeFlow";
import { inserterForReach } from "../../buildSpec";


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
 * **링크 포트의 끝을 놓는다** — belt 를 깐 뒤 `[포트 인서터][상자]` 를 세우고 [ModulePort]
 * 를 push 한다. [emitOutputLinks]·[emitInputLinks] 공통. belt 셀은 caller 가 이미 만들어
 * 넘긴다(`beltCells`). 좌석 탭 인서터도 caller 가 이 함수 **전에** 놓는다(cells 순서 보존).
 *
 * role 로 갈리는 것: 포트 인서터의 **집는 쪽**(출력은 belt→상자 = −pfv, 입력은 상자→belt =
 * pfv), 포트가 서는 **변**(meta.side: 출력 W · 입력 E), `endPreference` 조회 키.
 */
/**
 * **좌석 팔은 레인 깊이와 짝이다** — 좌석은 언제나 d1 이므로 벨트가 d`laneDepth` 면 팔이
 * `laneDepth-1` 칸을 던져야 한다. 상수를 쓰면 깊은 레인에 앉은 줄이 벨트에 못 닿아 **그 자리가
 * 조용히 굶는다**(2026-08-16 — 레인 장부가 d3 를 쓰기 시작하면서 실제 위험이 됐다).
 *
 * 포트 인서터는 이 짝이 아니다: 벨트 바로 바깥 칸(d`laneDepth+1`)에 서서 벨트를 집으므로
 * **언제나 reach 1** 이다 — 그쪽은 `input.inserterEntityName` 을 그대로 쓴다.
 */
function seatInserterName(input: ModuleInput, laneDepth: number): string {
  return inserterForReach(input.inserters, laneDepth - 1)?.entityName ?? input.inserterEntityName;
}

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
  tapAnchor: { x: number; y: number };
  laneDepth: number;
  inserterEntityName: string;
  lineEnds: ModuleInput["lineEnds"];
  cells: PlacedCell[];
  chests: Container[];
  occupancy: Set<string>;
  ports: ModulePort[];
}): void {
  const pickup = o.role === "output" ? { x: -o.pfv.x, y: -o.pfv.y } : o.pfv;
  o.cells.push(
    ...o.beltCells,
    makeInserterCell(o.seatCell, pickup, o.inserterEntityName, o.portPair),
    makeContainerCell(o.chest, o.chestAt),
  );
  for (const c of o.beltCells) o.occupancy.add(cellKey(c.x, c.y));
  o.occupancy.add(cellKey(o.seatCell.x, o.seatCell.y));
  o.occupancy.add(cellKey(o.chestAt.x, o.chestAt.y));
  o.chests.push(o.chest);
  o.ports.push({
    line: o.line, anchor: { ...o.chestAt }, tapAnchor: o.tapAnchor, face: o.portFace,
    moduleWayOuts: [], chest: o.chest, cells: o.beltCells, linkId: o.linkId,
    meta: {
      // **어느 변에 섰나** — 반출·채널 장부의 단일 출처([[ns-face-relief]] 결정 5).
      // `portFace` 와 같은 값이어야 한다: gap 그룹은 서/동쪽 변으로 나가고, W/E 면 그룹은
      // 자기 면으로 나간다. 역할(출력=W·입력=E)로 찍던 옛 값은 그 둘이 늘 일치할 때만 맞았다.
      item: o.line.name, side: o.portFace, laneDepth: o.laneDepth,
      inserter: o.laneDepth === 2 ? "normal" : "long",
      amount: o.line.amount, endPreference: o.lineEnds?.get(`${o.role}:${o.line.name}`),
    },
  });
}


/**
 * 링크 그룹 하나가 앉을 **면** — 좌표가 생기기 **전에** 팔 수만으로 정한다.
 *
 * 순서가 이렇게 뒤집힌 이유: N/S 면(=gap)에 앉는 그룹은 gap 안에 가로 벨트 한 줄을 놓고,
 * **gap 폭 = 그 gap 을 지나는 가로 벨트 수**다. 폭이 머신 좌표를 정하므로, 좌표를 알기 전에
 * 면부터 정해야 한다(폭은 우리가 고르는 값이 아니라 배정의 부산물).
 */
export function emitOutputLinks(args: {
  groups: MachineLinkGroup[];
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
}): void {
  const { groups, machines, input, prefix, occupancy, cells, chests, outputPorts, unroutedLines } = args;
  const ext = {
    x0: Math.min(...machines.map((m) => m.origin.x)),
    y0: Math.min(...machines.map((m) => m.origin.y)),
    x1: Math.max(...machines.map((m) => m.origin.x + m.size.w - 1)),
    y1: Math.max(...machines.map((m) => m.origin.y + m.size.h - 1)),
  };
  let seq = 0;

  groups.forEach((group, gi) => {
    const line = args.lineOf.get(group.item);
    if (!line) return;
    const plan = args.seats[gi];
    if (!plan) {
      unroutedLines.push(line); // 두 면 다 찼다(거대 출력) → 정직 폴백(N/S gap 은 후속)
      return;
    }
    const face = plan.face;
    const isGap = face === "N" || face === "S";
    const fv = faceVector(face);
    // **좌석은 머신 여럿에 걸칠 수 있다**(입력과 같은 구조). v1 링크 그룹은 자식 머신 하나뿐
    // 이라 항상 길이 1이지만, 외부 줄(모든 머신이 내는 최종 산출)은 전 머신에 걸친다 —
    // [emitTapInserting] 을 [[ParallelBelt]] 로 대체하려면 이 형태여야 한다(규칙 2).
    const seats = [...plan.slots]
      .sort((a, b) => a[0] - b[0])
      .map(([mi, rows]) => ({ m: machines[mi], rows }))
      .filter((s) => s.m);
    if (seats.length === 0) return;
    const m0 = seats[0].m;
    const allRows = seats.flatMap((s) => s.rows).sort((a, b) => a - b);
    // depth 는 gap 이면 **그 머신의 면**에서 잰다 — 가운데 머신의 N/S 는 클러스터 끝면이
    // 아니다. W/E 면은 기둥이라 모든 머신의 x 가 같아 전체 ext 와 결과가 같다.
    const mExt = isGap
      ? { x0: m0.origin.x, y0: m0.origin.y, x1: m0.origin.x + m0.size.w - 1, y1: m0.origin.y + m0.size.h - 1 }
      : ext;

    // 출구는 **벨트가 앉은 면을 따른다.** W/E 면 좌석이면 세로 벨트가 그 면 바깥을 보고,
    // N/S(gap) 좌석이면 가로 벨트가 gap 을 따라 서쪽 변까지 와서 90° 꺾인다 — **그 꺾이는
    // 칸이 곧 평범한 W 포트**다(모서리 포트). 그래서 채널 장부가 새 모양을 배울 필요가 없다.
    //
    // 예전엔 **언제나 W** 였다. 링크 출력은 선호 면이 W 고 넘치면 gap 으로만 가서 그게 늘
    // 맞았기 때문이다. 원료·완제품 줄까지 이 배분기를 타면 출력이 E 에 앉을 수 있고, 그때
    // W 를 고집하면 포트 인서터가 **머신 쪽으로** 자라 좌석 줄과 부딪힌다.
    // **관통이면 포트가 기둥 끝**([LinkFacePlan.portEnd]) — 상자가 기둥 밖이라 그 면의 깊은
    // 레인이 상자를 가두지 못한다. 구간이면 오늘처럼 옆이다.
    const portFace: PortFace = plan.portEnd ?? (isGap ? "W" : face);
    const pfv = faceVector(portFace);
    // 벨트 깊이는 **계획이 정해 들고 온 값**이다 — gap 폭을 유도한 바로 그 값이라
    // 여기서 다른 수를 쓰면 벨트가 gap 밖으로 넘친다([gapRowsFromPlans]).
    const laneDepth = plan.laneDepth;
    const exitDepth = plan.exitDepth ?? laneDepth;
    // 흐름은 **포트 쪽 끝**을 향한다 — 옆 포트/N 끝이면 위(t 작은 쪽), S 끝이면 아래.
    const toSouth = plan.portEnd === "S";
    const topT = toSouth ? allRows[allRows.length - 1] : allRows[0];
    const belt0 = faceCell(mExt, face, laneDepth, topT); // 벨트 줄의 **포트 쪽** 끝 칸
    // 트렁크 끝(= 납품 경로 계약의 trunkStart) — W 면이면 belt 줄의 맨 위, N/S 면이면 **반출 줄의**
    // 맨 서쪽(자기 줄로 내려온 뒤 서쪽 변에 닿는 칸).
    const trunkStart = isGap
      ? { x: m0.origin.x, y: faceCell(mExt, face, exitDepth, topT).y }
      : belt0;
    const chestId = `${prefix}-output-${line.name}-${seq++}`;
    const { chest, portPair, seatCell, chestAt } = makeLinkPortChest({
      role: "output", trunkEnd: trunkStart, portFace, pfv, line, machineId: m0.id, chestId,
    });

    // 흐름은 언제나 **트렁크 끝(t 가 작은 쪽)을 향한다** — W/E 면은 위로, N/S 면은 서쪽으로.
    const beltDirV = isGap ? { x: -1, y: 0 } : { x: 0, y: toSouth ? 1 : -1 };
    // **끝 칸은 면을 따라 계속 흐르지 않고 포트 쪽으로 꺾는다.** 안 꺾으면 이 그룹의 물건이
    // 면을 따라 더 흘러 **이웃 그룹의 벨트로 넘어간다**(머신 사이 gap 이 0 이면 두 벨트가 실제로
    // 맞닿는다). 품목이 같아 오염은 안 나지만 장부가 통째로 거짓이 된다 — 이쪽 부모는 굶고
    // 저쪽 부모는 넘친다. 셀 겹침(occupancy)만 봐서는 못 잡는 종류다(2026-07-22 수정).
    // 꺾은 칸의 다음 칸은 이 그룹의 포트 인서터라 언제나 비어 있다(다른 그룹의 행과 안 겹친다).
    const beltCells: PlacedCell[] = [];
    let blocked = false;
    const push = (at: { x: number; y: number }, v: { x: number; y: number }): void => {
      if (occupancy.has(cellKey(at.x, at.y))) { blocked = true; return; }
      beltCells.push(makeBeltCell(at, vectorToDirection(v.x, v.y), input.beltEntityName, portPair)); // 티어는 후속
    };
    // ① **수집** — 자기 좌석 **구간**(첫 좌석 행 ~ 마지막 좌석 행)을 빠짐없이 덮는다.
    //
    // **목록이 아니라 범위다.** 예전엔 `allRows`(좌석이 있는 행들)를 돌았는데, 좌석이 한 머신
    // 안에 몰려 있을 땐 그게 곧 범위라 우연히 맞았다. 관통 그룹이 열리면서(계획서 §19-①)
    // 좌석이 머신 여럿에 걸치자 **사이 행이 빠져 벨트가 끊겼다** — 머신 4대면 네 칸이 3칸씩
    // 떨어져 놓이고, 포트에 닿는 첫 칸 말고는 **어디에도 안 이어진다**(2026-08-17 실측:
    // concrete 출력이 y5·y8·y11·y14 네 칸으로 흩어져 머신 셋의 산출이 갇혔다).
    //
    // 벨트는 연속이라야 물건이 흐른다(계획서 §3 조건 ⑤). [emitInputLinks] ③ 은 처음부터
    // `topT..botT` 범위로 돌고 있었다 — **두 방출기는 거울인데 이 한 줄에서 깨져 있었다.**
    // 범위는 **포트 방향과 무관**하다 — 좌석 전체를 덮는다. 포트 쪽 끝(`topT`)에서만 꺾는다.
    const loT = Math.min(...allRows);
    const hiT = Math.max(...allRows);
    for (let t = loT; t <= hiT; t++) {
      if (blocked) break;
      // 끝 칸: 자기 줄로 내려가야 하면 **더 깊은 줄 쪽**(fv)으로, 아니면 포트 쪽(pfv)으로.
      const turn = exitDepth > laneDepth ? fv : pfv;
      push(faceCell(mExt, face, laneDepth, t), t === topT ? turn : beltDirV);
    }
    // ② **자기 줄로 내려가기** — 막힌 면이라 벨트가 깊이로 갈린다([[ParallelBelt]]). 내려가는
    // 건 **벨트가 벨트를 먹이는** 것이라 팔 길이와 무관하다(팔은 수집 줄 d`laneDepth` 까지만).
    for (let d = laneDepth + 1; d <= exitDepth && !blocked; d++) {
      push(faceCell(mExt, face, d, topT), d === exitDepth ? pfv : fv); // 반출 줄에 닿으면 서쪽으로
    }
    // ③ **반출** — 반출 줄을 따라 서쪽 변까지. 먼저 앉은 그룹들의 줄보다 **깊고**, 그들의
    // 열보다 **동쪽에서** 출발하므로 남의 줄을 밟지 않는다.
    if (exitDepth > laneDepth)
      for (let t = topT - 1; t >= m0.origin.x && !blocked; t--) push(faceCell(mExt, face, exitDepth, t), pfv);
    if (blocked || occupancy.has(cellKey(seatCell.x, seatCell.y)) || occupancy.has(cellKey(chestAt.x, chestAt.y))) {
      unroutedLines.push(line); // 안전망(구성상 발생 안 함)
      return;
    }

    // 탭 픽업 = 좌석 면의 안쪽(−fv, 머신에서 집어 belt 로). 팔 종류는 [seatInserterName].
    const seatArm = seatInserterName(input, laneDepth);
    const inward = { x: -fv.x, y: -fv.y };
    for (const s of seats) {
      for (const t of s.rows) {
        const seat = faceCell(mExt, face, 1, t);
        const pair: PortPair = {
          producer: { containerId: s.m.id, cell: { ...seat }, face, kind: "item" },
          consumer: { containerId: chestId, cell: { ...seat }, face, kind: "item" },
        };
        cells.push(makeInserterCell(seat, inward, seatArm, pair));
        occupancy.add(cellKey(seat.x, seat.y));
      }
    }
    // 포트 끝은 공통 방출기가 놓는다(belt 에서 집어 chest 로).
    // tapAnchor = machine-side 끝점이므로 **포트가 선 변 쪽 머신 가장자리**다(E 면이면 동쪽 끝).
    // **tapAnchor = 트렁크 끝** — 납품/반출 라우팅의 machine-side 끝점이고, 포트 계약이
    // `anchor − 2·faceVector` 를 요구한다([modulePacking] ⑥B).
    //
    // gap(N/S) 그룹은 벨트가 가로로 달려 **변에서 꺾이므로** 그 꺾이는 칸(= 머신 가장자리)이
    // 끝점이다. W/E 그룹은 벨트가 세로라 끝점이 **벨트 칸 자체**(d`laneDepth`)다 — 예전엔 둘 다
    // 머신 가장자리를 썼는데, 그러면 W/E 포트의 끝점이 머신 발자국 **안**으로 들어가 반출
    // 재배치가 통째로 실패한다(2026-08-17 실측 — skip 3). 옛 탭 경로가 이 줄들을 맡던 동안엔
    // 안 드러났다.
    pushLinkPortEnd({
      role: "output", seatCell, chestAt, chest, portPair, portFace, pfv, beltCells,
      line, linkId: group.id,
      tapAnchor: isGap
        ? { x: portFace === "E" ? m0.origin.x + m0.size.w - 1 : m0.origin.x, y: trunkStart.y }
        : { ...trunkStart },
      laneDepth, inserterEntityName: input.inserterEntityName, lineEnds: input.lineEnds,
      cells, chests, occupancy, ports: outputPorts,
    });
  });
}

/**
 * **입력 fan-in 방출** — [emitOutputLinks] 의 거울. 링크마다 부모 머신(toMachine) 하나의
 * 연속 좌석 k개에 입력 탭을 앉히고, 세로 belt 를 깔아 **E변(자식 쪽)으로** 포트 하나를 낸다.
 * 자식 출력 포트와 **링크 순서로 1:1** 짝지어지도록 링크 순서대로 낸다.
 *
 * 기하(E면, 머신 origin (mx,my), base, k): 탭=faceCell d1 (mx+w, ...) 벨트에서 집어 머신에
 * 넣음; belt=d2 세로(아래로 흐름 — 포트에서 받아 탭에 분배); 포트 인서터=d3, chest=d4(동).
 */
export function emitInputLinks(args: {
  groups: MachineLinkGroup[];
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
}): void {
  const { groups, machines, input, prefix, occupancy, cells, chests, inputPorts, unroutedLines } = args;
  const ext = {
    x0: Math.min(...machines.map((m) => m.origin.x)),
    y0: Math.min(...machines.map((m) => m.origin.y)),
    x1: Math.max(...machines.map((m) => m.origin.x + m.size.w - 1)),
    y1: Math.max(...machines.map((m) => m.origin.y + m.size.h - 1)),
  };
  let seq = 0;

  groups.forEach((group, gi) => {
    const line = args.lineOf.get(group.item);
    if (!line) return;
    const plan = args.seats[gi];
    if (!plan) { unroutedLines.push(line); return; } // 두 면 다 찼다 → 정직 폴백
    const face = plan.face;
    const isGap = face === "N" || face === "S";

    // 좌석은 [allocateLinkFaces]+[placeLinkSeats] 가 이미 정했다 — 여기선 깔기만 한다.
    const seats = [...plan.slots]
      .sort((a, b) => a[0] - b[0])
      .map(([mi, rows]) => ({ m: machines[mi], rows }));
    const m0 = seats[0].m;
    // gap 좌석이면 depth 를 **그 머신의 면**에서 잰다(가운데 머신의 N/S 는 클러스터 끝면이 아니다).
    const geomExt = isGap
      ? { x0: m0.origin.x, y0: m0.origin.y, x1: m0.origin.x + m0.size.w - 1, y1: m0.origin.y + m0.size.h - 1 }
      : ext;
    const allRows = seats.flatMap((s) => s.rows);
    // **관통이면 포트가 기둥 끝**([LinkFacePlan.portEnd] — 출력과 같은 규칙). S 끝이면
    // 포트가 아래에 서고 공급이 위로 흐른다.
    const toSouth = plan.portEnd === "S";
    const topT = toSouth ? Math.max(...allRows) : Math.min(...allRows);
    // gap 벨트는 머신 **동쪽 끝까지** 뻗어야 포트가 클러스터 밖에 선다. 자기 줄로 내려가는 그룹은
    // 그 구간을 **반출 줄**에서 달리고 자기 열에서 올라오므로, 여기선 자기 좌석 끝까지만.
    const exitDepth = plan.exitDepth ?? plan.laneDepth;
    const ownEast = Math.max(...allRows);
    const botT = isGap
      ? (exitDepth > plan.laneDepth ? ownEast : m0.origin.x + m0.size.w - 1)
      : toSouth ? Math.min(...allRows) : ownEast;

    // 입구는 **벨트가 앉은 면을 따른다**([emitOutputLinks] 와 같은 규약). gap 좌석이면 가로
    // 벨트가 동쪽 변에서 90° 꺾여 들어온다 — 그 꺾이는 칸이 곧 평범한 E 포트(모서리 포트)다.
    // 링크 입력은 선호 면이 E 라 예전의 하드코딩과 값이 같고, W 로 밀려나는 것은 원료 줄뿐이다.
    const portFace: PortFace = plan.portEnd ?? (isGap ? "E" : face);
    const pfv = faceVector(portFace);

    // 좌석(d1)이 막히면 폴백. 레인은 막히면 다음 후보로.
    const seatCells = allRows.map((t) => faceCell(geomExt, face, 1, t));
    if (seatCells.some((c) => occupancy.has(cellKey(c.x, c.y)))) { unroutedLines.push(line); return; }
    /**
     * 트렁크 끝(포트가 붙는 칸) — E 면이면 belt 줄의 맨 위, gap 이면 **반출 줄의** 맨 동쪽
     * (자기 줄로 내려가든 아니든 포트는 언제나 클러스터 동쪽 변에 선다).
     */
    const trunkEndOf = (d: number): { x: number; y: number } => {
      const b = faceCell(geomExt, face, d, topT);
      return isGap ? { x: m0.origin.x + m0.size.w - 1, y: faceCell(geomExt, face, exitDepth, topT).y } : b;
    };
    // 레인(depth)은 배정이 정해 들고 온 값이다 — 여기선 탐색하지 않는다. v1 은 링크 하나가
    // 곧 벨트 하나라 관통 벨트가 없고, 벨트가 자기 구간만 덮으므로 다툴 depth 자체가 없다.
    const lane = { d: plan.laneDepth, inserter: seatInserterName(input, plan.laneDepth) };
    const fv = faceVector(face);
    // 흐름은 포트(트렁크 끝)에서 **멀어지는** 쪽 — E 면은 아래로, gap 이면 서쪽으로.
    const beltDirV = isGap ? { x: -1, y: 0 } : { x: 0, y: toSouth ? -1 : 1 };
    const inward = { x: -fv.x, y: -fv.y };

    // 벨트 경로를 **먼저 전부 계산하고**, 다 놓을 수 있을 때만 놓는다. 반만 놓인 벨트는
    // 포트에서 물건이 사라지는 것과 같아서, 한 칸이라도 막히면 통째로 물러난다.
    const path: { at: { x: number; y: number }; v: { x: number; y: number } }[] = [];
    // ① **반출** — 포트(동쪽 변)에서 자기 열까지 반출 줄로 달려온다([emitOutputLinks] 의 거울,
    // 흐름만 반대다). 내려갈 필요 없는 첫 그룹은 이 구간이 없다(수집이 곧 동쪽 변까지).
    if (isGap && exitDepth > lane.d)
      for (let t = m0.origin.x + m0.size.w - 1; t > ownEast; t--)
        path.push({ at: faceCell(geomExt, face, exitDepth, t), v: beltDirV });
    // ② **자기 줄에서 올라오기** — 자기 열에서 수집 줄까지 **올라온다**(머신 쪽). 벨트→벨트라 팔 길이 무관.
    for (let d = exitDepth; d > lane.d; d--)
      path.push({ at: faceCell(geomExt, face, d, ownEast), v: inward });
    // ③ **수집** — 자기 좌석 구간을 덮으며 탭에 나눠 준다. 먼 쪽 끝 칸은 면을 따라 더 흐르면
    // **이웃 그룹의 벨트로 넘어가므로** 머신 쪽으로 꺾어 멈춘다 — 그 칸은 이 그룹 자신의
    // 좌석(인서터)이라 언제나 안전하다.
    // 범위는 포트 방향과 무관하다 — 좌석 전체를 덮고, **먼 쪽 끝**에서만 머신 쪽으로 꺾는다.
    for (let t = Math.min(topT, botT); t <= Math.max(topT, botT); t++) {
      const far = isGap ? t === topT : t === botT;
      path.push({ at: faceCell(geomExt, face, lane.d, t), v: far ? inward : beltDirV });
    }

    const te = trunkEndOf(lane.d);
    const span = [
      ...path.map((c) => c.at),
      { x: te.x + pfv.x, y: te.y + pfv.y },
      { x: te.x + 2 * pfv.x, y: te.y + 2 * pfv.y }, // 포트 인서터·상자
    ];
    if (span.some((c) => occupancy.has(cellKey(c.x, c.y)))) {
      unroutedLines.push(line); // 안전망(구성상 발생 안 함 — 좌석 장부가 이미 막았어야 한다)
      return;
    }

    // ── 배치 확정 ──
    const beltTop = trunkEndOf(lane.d);
    const chestId = `${prefix}-input-${line.name}-${seq++}`;
    const { chest, portPair, seatCell, chestAt } = makeLinkPortChest({
      role: "input", trunkEnd: beltTop, portFace, pfv, line, machineId: m0.id, chestId,
    });

    const beltCells: PlacedCell[] = path.map((c) =>
      makeBeltCell(c.at, vectorToDirection(c.v.x, c.v.y), input.beltEntityName, portPair), // 티어는 후속
    );
    for (const c of beltCells) occupancy.add(cellKey(c.x, c.y));
    for (const s of seats) {
      for (const t of s.rows) {
        const seat = faceCell(geomExt, face, 1, t);
        const pair: PortPair = {
          producer: { containerId: chestId, cell: { ...seat }, face, kind: "item" },
          consumer: { containerId: s.m.id, cell: { ...seat }, face, kind: "item" },
        };
        cells.push(makeInserterCell(seat, fv, lane.inserter, pair)); // 픽업 = 바깥(트렁크) → 머신에 놓음
        occupancy.add(cellKey(seat.x, seat.y));
      }
    }
    // 포트 끝은 공통 방출기가 놓는다(상자에서 집어 belt 로).
    // tapAnchor = machine-side 끝점이므로 **포트가 선 변 쪽 머신 가장자리**다(W 면이면 서쪽 끝).
    pushLinkPortEnd({
      role: "input", seatCell, chestAt, chest, portPair, portFace, pfv, beltCells,
      line, linkId: group.id,
      tapAnchor: isGap
        ? { x: portFace === "W" ? m0.origin.x : m0.origin.x + m0.size.w - 1, y: beltTop.y }
        : { ...beltTop },
      laneDepth: lane.d, inserterEntityName: input.inserterEntityName, lineEnds: input.lineEnds,
      cells, chests, occupancy, ports: inputPorts,
    });
  });
}

/**
 * **탭 인서팅 방출** — 품목 줄마다 belt 한 줄을 머신 기둥 전체에 직선으로 깔고, 머신마다
 * 탭 인서터를 하나씩 붙인다. 포트는 **벨트 끝 하나뿐**이라 모듈 경계 포트가 품목당 1개가 된다.
 *
 * ## 기하 (W 면 · 3×3 머신 2대 · 가까운 레인 d=2)
 * ```
 *        x=-2 -1  0  1  2       d = 머신 면에서 바깥 칸 수
 *  y=-2    C   .  .  .  .       C = 포트 상자(anchor)  ← belt 열 위, 기둥 밖 2칸
 *  y=-1    I   .  .  .  .       I = 포트 인서터(seat)
 *  y= 0    B   i  M  M  M       B = 트렁크 belt (d=2)
 *  y= 1    B   .  M  M  M       i = 탭 인서터 (d=1)
 *  y= 2    B   .  M  M  M
 *  y= 3    B   i  M  M  M
 *  y= 4    B   .  M  M  M
 *  y= 5    B   .  M  M  M
 * ```
 *
 * ## 왜 이 배치인가 — [deliveryRoute] 의 포트 계약을 코드 수정 없이 만족시킨다
 * `deliveryRoute.portGeometry` 는 포트 기하를 **anchor 와 face 만으로** 유도한다:
 * `chest = anchor` · `seat = anchor − faceVec` · `trunkStart = anchor − 2·faceVec`.
 * 그래서 트렁크 끝에서 바깥으로 `[인서터][상자]` 를 일직선으로 세우고 `face` 를 **그 나가는
 * 방향**(N/S)으로 주면 납품 경로가 그대로 붙는다. 납품 경로가 상자를 떼고 그 자리에 belt 를 깔면 —
 * 출력 인서터가 그 belt 에 놓고, 입력 인서터가 그 belt 에서 집는다(양끝 인서터는 보존됨).
 *
 * `meta.side`(W/E)는 유지된다 — 채널 장부·반출 계획이 보는 건 **어느 변**이냐이고,
 * `face`(N/S)는 **어느 쪽으로 나가느냐**다. 둘은 다르다(모듈 머리말 "변 vs face" 참고).
 *
 * ## 왜 [untapped](../../../../../docs/용어사전.md) 가 생길 수 없나
 * belt 가 기둥 **전체를 직선으로** 지나므로 모든 머신의 그 면 행이 belt 와 맞닿는다.
 * 옛 트렁크(씨앗에서 그리디로 성장)처럼 "둘러싸여 못 닿는 머신"이 **구성상** 없다.
 */
/**
 * **트렁크 파이프 방출** — [emitTapInserting](탭 인서팅)과 나란한 유체판(용어사전 정의).
 * 유체 줄마다 파이프 한 줄을 머신 기둥 전체에 직선으로 깔아 모든 머신의 유체 입구 칸에
 * 직접 닿게 한다. **인서터가 없다** — 유체는 인서터로 못 옮긴다. 포트는 무한**파이프**로
 * 끝난다. 기하 계약([deliveryRoute] anchor/seat/trunkStart)과 stagger 기준은 [emitTapInserting]
 * 과 같은 [TrunkContext] 를 보므로 서로 어긋나지 않는다.
 *
 * 점프 모드([pipeJumpToClusterPipe])면 좌석 줄(d=1)의 유체 상자 칸만 먹고, 벨트들을 지하로
 * 넘어 바깥 [ClusterPipe] 로 합류한다 — 그래야 그 면의 나머지 좌석이 아이템 줄에 돌아간다.
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
  /** [emitTapInserting] 과 chestId 순번을 이어 쓰기 위한 공유 카운터. */
  seqRef: { n: number };
  /**
   * **이 줄들이 깐 파이프 셀이 어느 유체냐** — [GeneratedModule.pipeCells] 로 나간다.
   * 모듈이 유체를 여럿 다루면 모듈 단위로는 답할 수 없어서, 방출한 쪽이 직접 채운다.
   */
  pipeCells: PipeFlowPipe[];
}): void {
  const { plan, machines, input, prefix, occupancy, cells, chests, ctx } = args;
  const ext = ctx.ext;

  for (const planned of plan.lines) {
    if (planned.line.kind !== "pipe") continue; // 아이템은 [emitTapInserting] 이 처리한다.
    const line = planned.line;
    const face = planned.side as PortFace;
    const fv = faceVector(face); // 바깥 방향 — 점프 지하파이프의 방향 계산에만 쓰인다.
    const d = ctx.emitDepthOf(planned); // 파이프=1 또는 ClusterPipe 깊이.

    const vertical = face === "W" || face === "E";
    const t0 = vertical ? ext.y0 : ext.x0;
    const t1 = vertical ? ext.y1 : ext.x1;
    const atMin = (input.lineEnds?.get(`${line.role}:${line.name}`) ?? "min") === "min";
    const exitFace: PortFace = vertical ? (atMin ? "N" : "S") : atMin ? "W" : "E";
    const ev = faceVector(exitFace);

    // stagger — [emitTapInserting] 과 같은 기준([TrunkContext.maxDepthAtEnd]).
    const stagger = (ctx.maxDepthAtEnd.get(trunkEndKey(planned, input.lineEnds)) ?? d) - d;
    const tBeltEnd = atMin ? t0 - stagger : t1 + stagger;

    const beltEnd = faceCell(ext, face, d, tBeltEnd);
    const seat = { x: beltEnd.x + ev.x, y: beltEnd.y + ev.y };
    const chestAt = { x: beltEnd.x + 2 * ev.x, y: beltEnd.y + 2 * ev.y };

    const chestId = `${prefix}-${line.role}-${line.name}-${args.seqRef.n++}`;
    const chest: Container = {
      id: chestId,
      kind: "infinity-pipe",
      entityName: "infinity-pipe",
      origin: { ...chestAt },
      size: { w: 1, h: 1 },
      content: line.name,
      role: line.role,
    };
    chests.push(chest);

    // 파이프는 흐름 방향이 없다 — 압력이 알아서 흐른다.
    const beltPair: PortPair = {
      producer: {
        containerId: line.role === "input" ? chestId : machines[0].id,
        cell: { ...beltEnd }, face, kind: { fluid: line.name },
      },
      consumer: {
        containerId: line.role === "input" ? machines[0].id : chestId,
        cell: { ...beltEnd }, face, kind: { fluid: line.name },
      },
    };

    // ── 트렁크 파이프 한 줄 — depth 1 이면 이 직선이 모든 머신의 유체 입구 칸을 지나간다
    // (trunk-pipe §1) — 그래서 인서터도, 탭도, 분기도 필요 없다.
    //
    // **한 칸이라도 막히면 줄 전체가 실패다.** 예전엔 그 칸만 `continue` 로 건너뛰었는데
    // (주석은 "구성상 발생 안 함"), 파이프는 **끊기면 아래쪽이 통째로 죽는다** — 건너뛴 칸
    // 너머의 머신들은 유체를 못 받으면서 겹침도 미배치도 아니라 **화면상 멀쩡해 보인다.**
    // gap 벨트의 포트 끝이 좌석 줄에 앉는 배치에서 실제로 났다(2026-08-05). 근치는
    // [buildTrunkContext] 의 점프 조건 ④이고, 여기는 그게 놓친 것을 **삼키지 않는** 그물이다.
    const beltCells: PlacedCell[] = [];
    const lo = Math.min(t0, tBeltEnd);
    const hi = Math.max(t1, tBeltEnd);
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

    // ── 포트 끝 — [파이프][무한파이프] 일직선. 인서터가 없다. ──
    const portCells: PlacedCell[] = [
      makeContainerCell(chest, chestAt),
      makePipeCell(seat, input.fluidTrunk!.pipeEntityName, beltPair),
    ];

    // ── [pipeJumpToClusterPipe] — 머신마다 유체 상자 칸에서 지하로 벨트들을 넘어 ClusterPipe 로 ──
    //
    //   머신 | d1 fluidboxPipeCell | d2..dN 벨트(지하로 통과) | dN+1 ClusterPipeTapCell | dN+2 ClusterPipe
    //
    // 각 머신은 **자기 유체 상자 행**에서만 점프한다 — 행이 서로 달라 corridor 끼리 안 부딪힌다.
    // 지하파이프 direction = **지상 입구가 향하는 방향**(표면 연결 측, containerRouting 컨벤션):
    //  - fluidboxPipeCell: 표면이 머신 유체 상자를 향한다(−fv). 터널은 +fv 로 진행.
    //  - ClusterPipeTapCell: 표면이 바깥 ClusterPipe 를 향한다(+fv).
    const jumpCells: PlacedCell[] = [];
    if (ctx.pipeJumpMode(face as PortSide)) {
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
    }

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
        laneDepth: d,
        // 파이프는 인서터가 없어 undefined.
        inserter:
          planned.reach === undefined ? undefined : planned.reach >= 2 ? "long" : "normal",
        amount: line.amount,
        endPreference: input.lineEnds?.get(`${line.role}:${line.name}`),
      },
    };
    if (line.role === "output") args.outputPorts.push(port);
    else args.inputPorts.push(port);
  }
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
// 바뀐 점(팔 여러 개가 상자 여러 개 → 벨트 하나 + 포트 하나)은 `clusterModule.test.ts`
// "팔 여러 개가 한 포트로 모인다" 가 지킨다.
// ─────────────────────────────────────────────────────────────────────────────
