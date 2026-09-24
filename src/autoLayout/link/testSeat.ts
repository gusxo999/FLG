/**
 * **모듈 하나짜리 시험에 좌석을 앉혀 주는 곳** (시험 전용 — `.test.ts` 가 아니라 수집 대상이 아니다).
 *
 * ## 왜 있나
 * `generateModule` 은 링크의 자리를 **정하지 않는다** — 좌석 단계(`tree/build.seatTree`)가 링크를 양끝 모듈에
 * 함께 앉히고 굳힌 값(`ModuleInput.seatedFaces`)을 넘긴다. 모듈 하나만 만드는 시험에는 그 단계가 없으므로
 * 여기서 대신 앉힌다.
 *
 * **제품 경로를 그대로 탄다** — 좌석 창구를 열고 [seatLinkEdge] 로 앉힌 뒤 닫는다. 예전에는 모듈이 혼자 링크를
 * 앉히는 갈래(모듈 축)가 따로 있어 시험이 **제품이 안 타는 길**을 인증했다(2026-09-24 지웠다).
 *
 * 상대 모듈은 **대역**이다 — 무엇을 물어도 자리가 있다고 답하는 창구. 그래서 이 모듈 쪽 자리만 시험된다.
 * 링크 쪽 규칙(원자성 · 쪼갬 · 합류)을 시험하려면 창구 둘을 직접 연다(`module/policy/port.linkFaces.test.ts`).
 *
 * `link/` 에 있는 이유: 링크를 앉히는 일(`link/policy/seat`)을 부른다. `module/` 은 `link/` 를 못 부른다.
 */
import type { Link } from "../module/types/line";
import type { ModuleInput } from "../module/types/module";
import type { FaceSeating, SeatReceipt } from "../module/types/seat";
import { openFaceSeating } from "../module/policy/seat";
import { seatLinkEdge } from "./policy/seat";

/** **무엇이든 받는 창구** — 상대 모듈의 대역. 선호 면에 언제나 자리가 있다. */
function partnerStub(): FaceSeating {
  let n = 0;
  const receipt = (face: "W" | "E"): SeatReceipt => ({ id: n++, face, clusterBeltDepth: 2 });
  return {
    rowsPerMachine: 1,
    ask: (_line, side) => ({
      offer: { face: side === "from" ? "W" : "E", clusterBeltDepth: 2, reach: 1, arms: new Map(), slotIndex: new Map() },
      why: [],
    }),
    take: (offer) => receipt(offer.face === "W" ? "W" : "E"),
    takeShared: () => receipt("E"),
    close: () => {
      throw new Error("대역 창구는 닫지 않는다");
    },
  };
}

/**
 * 링크를 **제품 경로로** 앉히고 굳힌 좌석을 붙인 입력을 돌려준다. 링크가 없으면 입력 그대로다.
 *
 * 쪼개기는 끈다(제품 기본값과 같다). 합류 쌍이 있으면 줄 순서가 바뀔 수 있다 — 좌석 단계와 똑같이 돌려받은
 * 순서(`groups`)를 링크 목록으로 쓴다.
 */
export function seatedAlone(input: ModuleInput): ModuleInput {
  const outs: Link[] = input.outputLinks ?? [];
  const ins: Link[] = input.inputLinks ?? [];
  if (outs.length === 0 && ins.length === 0) return input;
  const desk = openFaceSeating(input, Math.max(1, input.count));
  const out = seatLinkEdge(desk, partnerStub(), outs, { split: false });
  const inn = seatLinkEdge(partnerStub(), desk, ins, { split: false });
  const seatedFaces = desk.close({
    out: { seats: out.fromSeats, why: out.fromWhy },
    in: { seats: inn.toSeats, why: inn.toWhy },
  });
  return {
    ...input,
    outputLinks: input.outputLinks && out.groups,
    inputLinks: input.inputLinks && inn.groups,
    seatedFaces,
  };
}
