/**
 * **연결 관심사의 도형** — 납품 경로의 칸: 탐색 경계 · 뗄 칸 · 좌석 이음 · 계획 체인(채널 장부의 지시를 칸으로) · 연속성.
 *
 * **품목을 모른다** — 벨트와 파이프가 같은 체인을 받는다([buildPlannedChain]). 갈리는 곳은 찍기(`link/emit`) 하나다.
 * **장부를 모른다** — 체인이 막혔나는 장부(`link/ledger`)가 묻는다. 포트의 경계 기하는 모듈이 답한다(`module/shape`).
 *
 * ## 체인의 방향
 * 출력(collect)은 trunk 흐름이 chest 쪽(바깥)을 향하고, 입력(supply)은 chest→trunk(안쪽)을
 * 향한다. 그래서 새 belt 체인은 `seat_from → chest_from → …경로… → chest_to → seat_to` 로
 * 흐른다(각 셀 방향 = 다음 셀 향함).
 *
 * > **내력.** `link/build.ts` 에서 왔다(2026-09-15 계획 구조-2축 · 2 Step 5c). 연속성 검사가 [isContinuous] 와
 * > [buildPlannedChain] 꼬리에 글자까지 같은 식으로 두 벌이던 것을 한 벌로 줄였다.
 */

import type { DijkstraResult } from "../shared/route";
import { portGeometry, seatIsBeltFeeder } from "../module/shape/body";
import { cellKey, segment } from "../shared/grid";
import type { DeliveryDirective, DeliverySpec, PackResult } from "../tree/types/pack";

/** 탐색 경계 — 칸 범위(양 끝 포함). */
export type Bounds = { x0: number; y0: number; x1: number; y1: number };

/** **ⓐ 탐색 경계** — 전체 배치 bbox. */
export function searchBoundsOf(bbox: PackResult["bbox"]): Bounds {
  // 탐색 경계 — 전체 배치 bbox(반출 마진 포함). 납품 경로는 배치 안에서 끝나므로 밖으로 나갈
  // 이유가 없고, 안 가두면 막힌 폴백이 무한 격자를 훑다 터진다.
  return {
    x0: bbox.x, y0: bbox.y,
    x1: bbox.x + bbox.w - 1, y1: bbox.y + bbox.h - 1,
  };
}

/** p 가 축정렬 구간 a→b 위에 있나(양끝 포함). */
function onSegment(
  a: { x: number; y: number },
  b: { x: number; y: number },
  p: { x: number; y: number },
): boolean {
  if (a.x === b.x && p.x === a.x) return (p.y - a.y) * (p.y - b.y) <= 0;
  if (a.y === b.y && p.y === a.y) return (p.x - a.x) * (p.x - b.x) <= 0;
  return false;
}

/**
 * 한 납품 경로가 떼는 셀 좌표 — 양끝 chest(ghost) + **좌석이 belt→belt 피더인 끝의 인서터.**
 *
 * 포트 모양에 따라 좌석의 운명이 갈린다([seatIsBeltFeeder]): 링크/트렁크 포트의 좌석은
 * 상자가 belt 로 바뀌는 순간 belt→belt 가 되어 처리량만 깎으므로 떼고 그 자리도 belt 로
 * 메운다([finishChain] 이 체인을 좌석까지 늘린다). 1:1 다이렉트 인서팅의 좌석은 머신에
 * 재료를 넣는 유일한 물건이라 **남긴다** — 떼면 머신이 굶는다.
 *
 * 두 끝은 **따로** 판정한다. 한 모듈은 링크 벨트, 상대는 1:1 인 납품 경로가 실제로 생긴다.
 */
export function stripKeys(delivery: DeliverySpec): string[] {
  const g0 = portGeometry(delivery.from);
  const g1 = portGeometry(delivery.to);
  const keys = [cellKey(g0.chest.x, g0.chest.y), cellKey(g1.chest.x, g1.chest.y)];
  if (seatIsBeltFeeder(delivery.from)) keys.push(cellKey(g0.seat.x, g0.seat.y));
  if (seatIsBeltFeeder(delivery.to)) keys.push(cellKey(g1.seat.x, g1.seat.y));
  return keys;
}

/**
 * **좌석 이음** — 체인(chest_from..chest_to)을 **좌석이 벨트 피더인 끝만** 좌석까지 늘린다. dijkstra 결과와 기하 예약의
 * 결정적 체인이 같은 이음을 탄다(`link/emit.finishChain`).
 */
export function chainWithSeats(delivery: DeliverySpec, result: DijkstraResult): DijkstraResult {
  // 체인의 몸통은 chest_from … chest_to. 양 끝은 **그 끝의 좌석이 무엇이냐**에 따라 갈린다
  // ([stripKeys]·[seatIsBeltFeeder] 와 같은 판정을 써야 한다 — 여기서 어긋나면 뗀 자리가
  // 빈 칸으로 남아 물건이 사라진다):
  //  - belt→belt 피더 좌석(링크/트렁크 포트) = 인서터를 뗐으니 그 자리를 belt 로 메워
  //    납품 경로 벨트가 트렁크로 곧장 흐르게 한다. seat↔chest 는 인접 1칸이라 edge 는 'surface'.
  //  - 1:1 다이렉트 인서팅 좌석 = 인서터가 그대로 남아 있으므로 덮지 않는다. 출력 인서터가
  //    chest_from 자리 belt 에 놓고, 입력 인서터가 chest_to 자리 belt 에서 집어 넣는다.
  const headSeat = seatIsBeltFeeder(delivery.from) ? portGeometry(delivery.from).seat : null;
  const tailSeat = seatIsBeltFeeder(delivery.to) ? portGeometry(delivery.to).seat : null;
  const ext: DijkstraResult =
    headSeat || tailSeat
      ? {
          ...result,
          cells: [
            ...(headSeat ? [headSeat] : []),
            ...result.cells,
            ...(tailSeat ? [tailSeat] : []),
          ],
          edges: [
            ...(headSeat ? (["surface"] as DijkstraResult["edges"]) : []),
            ...result.edges,
            ...(tailSeat ? (["surface"] as DijkstraResult["edges"]) : []),
          ],
        }
      : result;
  return ext;
}

/**
 * INVARIANT: 체인은 텔레포트하지 않는다 — surface edge 는 인접 1칸, jump edge 는 축 정렬 +
 * 거리 k 여야 한다. emit 함수들은 edge 를 신뢰하므로, 어긋난 결과를 *조용히 내보내지 말고*
 * 납품 경로 실패로 처리해야 한다(가짜 물류 방지). 벨트·파이프 방출이 이 판정을 공유한다.
 */
export function isContinuous(r: DijkstraResult): boolean {
  for (let i = 0; i + 1 < r.cells.length; i++) {
    const dx = r.cells[i + 1].x - r.cells[i].x;
    const dy = r.cells[i + 1].y - r.cells[i].y;
    const edge = r.edges[i];
    const okStep =
      edge === "surface"
        ? Math.abs(dx) + Math.abs(dy) === 1
        : dx === edge.dx * edge.k && dy === edge.dy * edge.k;
    if (!okStep) return false;
  }
  return true;
}

/**
 * 기하 예약의 방출 지시 → 결정적 체인(chest_from..chest_to, 탐색 없음).
 * 계단꼴 = 가로 진입·세로 주행·가로 진출, 열 갈아타기 = 중간 트랙 변경 1회,
 * 지하 횡단 = 계단꼴 + 남의 셀 밑을 건너는 점프 여러 개.
 * 축 정렬이 깨진 지시(예: straight 인데 행이 다름)는 null — 호출자가 dijkstra 폴백.
 */
export function buildPlannedChain(delivery: DeliverySpec, g: DeliveryDirective): DijkstraResult | null {
  const s0 = portGeometry(delivery.from).chest;
  const e0 = portGeometry(delivery.to).chest;
  // **행 채널 진입** — 포트가 기둥 끝이면 상자에서 행 채널의 트랙 행까지 **세로로** 먼저 간다.
  // 그러고 나면 남은 일은 계단꼴 그대로다 — 세로 채널은 그 행이 어디서 왔는지 안 묻는다
  // (2026-08-18 Step 0). 도착 쪽도 거울이다.
  const s = g.fromRowChannel ? { x: s0.x, y: g.fromRowChannel.row } : s0;
  const e = g.toRowChannel ? { x: e0.x, y: g.toRowChannel.row } : e0;
  const cells: { x: number; y: number }[] = [{ ...s0 }];
  const edges: DijkstraResult["edges"][number][] = [];
  const push = (to: { x: number; y: number }) => {
    const cur = cells[cells.length - 1];
    for (const c of segment(cur, to)) {
      cells.push(c);
      edges.push("surface");
    }
  };

  // 자식 상자 → 행 채널 트랙 행(세로). 행 채널을 안 쓰면 0칸이다.
  if (g.fromRowChannel) push(s);

  switch (g.kind) {
    case "straight":
      if (s.y !== e.y) return null;
      push(e);
      break;
    case "staircase":
      push({ x: g.trackX, y: s.y });
      push({ x: g.trackX, y: e.y });
      push(e);
      break;
    case "wrapAround":
      // **ㄱ자** — 자기 행을 따라 가로로 간 뒤 목표 열에서 세로로. 상자는 면 위에 있어
      // 자기 **열**은 늘 붐비고(같은 면의 다른 포트들) 자기 **행**은 대개 비어 있다.
      push({ x: e.x, y: s.y });
      push(e);
      break;
    case "columnSwitch":
      push({ x: g.startTrackX, y: s.y });
      push({ x: g.startTrackX, y: g.switchY });
      push({ x: g.endTrackX, y: g.switchY });
      push({ x: g.endTrackX, y: e.y });
      push(e);
      break;
    case "undergroundCrossing": {
      // 계단꼴의 세 꼭짓점을 순서대로 걷되, 점프 입구를 만나면 지상 대신 지하로 건넌다.
      // 장부가 낸 점프는 계단꼴 위에 순서대로 놓여 있으므로(같은 셀 순서열에서 뽑았다)
      // 여기서 재정렬하지 않는다 — 어긋나면 아래 연속성 검증이 잡아 폴백시킨다.
      const corners = [
        { x: g.trackX, y: s.y },
        { x: g.trackX, y: e.y },
        { ...e },
      ];
      const jumps = [...g.jumps];
      const walkTo = (target: { x: number; y: number }) => {
        for (;;) {
          const cur = cells[cells.length - 1];
          const j = jumps[0];
          // 이 구간(cur→target) 위에서 지하 입구를 만나나?
          //
          // **점프가 이 구간과 같은 방향으로 뻗어야만 이 구간의 것이다**(2026-07-22 수정).
          // [onSegment] 는 끝점을 포함하므로, 계단 **모서리에서 시작하는 점프**는 그 앞
          // 구간(수직)에서도 "구간 위"로 잡힌다. 그걸 먹으면 점프가 우리를 모서리 **너머로**
          // 데려가고, 코드는 여전히 원래 목표(모서리)로 걸어가려 해서 **왔던 길을 되돌아
          // 간다** — 같은 칸을 세 번 지나며 지상 점유로 붙잡는다. 그 가짜 점유가 다른 납품 경로의
          // 정당한 트랙과 부딪히고, 상호 검사가 **둘 다** 폴백시킨다(관측: 납품 경로 5개 중 2개).
          // 방향이 같은지만 보면 그 구간의 점프인지 아닌지가 갈린다.
          const sameDir =
            j !== undefined &&
            Math.sign(target.x - cur.x) === Math.sign(j.to.x - j.from.x) &&
            Math.sign(target.y - cur.y) === Math.sign(j.to.y - j.from.y);
          if (j && sameDir && onSegment(cur, target, j.from)) {
            push(j.from);
            cells.push({ ...j.to });
            const dx = Math.sign(j.to.x - j.from.x);
            const dy = Math.sign(j.to.y - j.from.y);
            edges.push({ dx, dy, k: Math.abs(j.to.x - j.from.x) + Math.abs(j.to.y - j.from.y) });
            jumps.shift();
            continue; // 같은 구간에 점프가 또 있을 수 있다
          }
          push(target);
          return;
        }
      };
      for (const c of corners) walkTo(c);
      if (jumps.length > 0) return null; // 다 못 쓴 점프 = 계단꼴 위에 없던 지시 → 폐기
      break;
    }
  }
  // 행 채널 트랙 행 → 부모 상자(세로). 행 채널을 안 쓰면 0칸이다.
  if (g.toRowChannel) push(e0);


  // segment() 는 축 정렬 입력만 안전 — 연속성 검증에 실패한 지시는 폐기(폴백).
  const chain = { cells, edges, cost: cells.length };
  return isContinuous(chain) ? chain : null;
}
