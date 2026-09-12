/**
 * shapeProbe — **관측 전용.** 계획이 장부에 **청구한 칸**과 방출이 **실제로 쓰는 칸**을 대조한다.
 * 이 파일을 지워도 배치는 한 칸도 안 바뀐다.
 *
 * ## 왜 있나
 *
 * 링크 하나가 면에 앉으면 그 배정이 먹는 칸(좌석 · 벨트 · 포트)을 **두 곳이 각자 계산한다** —
 * 계획은 `linkPlanner`(`beltRowSpan` → `portCells` → `splitByTable`)에서, 방출은
 * `emitModule`(`path`/`span`)에서. 둘을 붙들고 있는 것은 `portCells` 주석의 줄 번호뿐이다.
 * → `docs/auto-layout/common/work-kinds.md` §7 **D1**
 *
 * 도형을 한 곳으로 합치기 **전에**, 둘이 오늘 같은 답을 내는지 먼저 잰다. 0 이면 합쳐도
 * 배치가 안 바뀌는 것이 측정으로 보장되고, 0 이 아니면 **무엇이 어떻게 다른지**가 곧
 * 다음 판단의 재료다. → `tempPlanDocs/구조-2축/1-도형-단일출처/`
 *
 * 같은 방법을 이 저장소가 이미 쓰고 있다 — `endsDisagree`·`endsCoarse` 가 옛 판정과 새
 * 판정을 나란히 돌려 대조한다.
 *
 * ## 무엇을 대조에서 빼나 — **gap 면 하나뿐**
 *
 * gap(N/S)은 계획이 벨트 칸을 아예 안 적는다 — 겹침을 행이 아니라 **반출 깊이**로 풀기
 * 때문이다(`commitLinkFace` 의 `span` 이 `undefined`). 자원의 모양이 달라 대조가 성립하지
 * 않으므로 세되 따로 센다.
 *
 * **레인 합류는 뺐다가 다시 넣었다.** 첫 줄이 벨트·포트를 잡고 둘째 줄은 좌석만 잡는데,
 * 방출도 정확히 그렇게 나눠 쓰므로 **대조가 성립한다**(방출 쪽에서 재사용하는 포트를 안
 * 세는 것이 조건이다 — `emitOutputLinks` 의 `if (!followed)`). 7건이 빠지면 신호의 3할이
 * 사라진다.
 */

import type { PortFace } from "../containerModel";
import { recordShapeDiff } from "../../debug/runStats";

/** 면 위 한 칸 — `[깊이, t]`. `t` 의 뜻은 [faceCell] 과 같다(W/E=행, N/S=열). */
export type FaceCell = readonly [number, number];

/** 진단용 전체 덤프 — 계측 단계에서만 켠다(`FLG_SHAPE_DUMP=1`). 브라우저에선 언제나 꺼진다. */
const DUMP = typeof process !== "undefined" && process.env?.FLG_SHAPE_DUMP === "1";

const key = ([d, t]: FaceCell): string => `d${d}:${t}`;

/**
 * 방출기가 만지는 칸을 모으는 **자국판** — 좌표를 `(깊이, t)` 로 되읽는다([faceCell] 의 역).
 *
 * 방출은 절대 좌표로 일하고 계획은 면 좌표로 청구한다. 되읽기가 **추측이 아닌 이유**는
 * 방출이 쓰는 좌표가 전부 `faceCell(ext, face, d, t)` 에서 나오기 때문이다 — 같은 `ext` 로
 * 되돌리면 원래 `(d, t)` 가 그대로 나온다.
 */
export function shapeTrace(
  face: PortFace,
  ext: { x0: number; y0: number; x1: number; y1: number },
): { used: FaceCell[]; noteCell: (c: { x: number; y: number }) => void } {
  const used: FaceCell[] = [];
  return {
    used,
    noteCell: (c) => {
      used.push(
        face === "W" ? [ext.x0 - c.x, c.y]
          : face === "E" ? [c.x - ext.x1, c.y]
            : face === "N" ? [ext.y0 - c.y, c.x]
              : [c.y - ext.y1, c.x],
      );
    },
  };
}

/**
 * 링크 하나를 대조한다 — 방출기가 셀을 다 놓은 **뒤에** 부른다.
 *
 * `used` 는 방출기가 **놓으려 한** 칸이다(막혀서 못 놓은 칸도 포함). 도형이 같은지를 묻는
 * 것이지 성공했는지를 묻는 것이 아니기 때문이다.
 */
export function probeLinkShape(o: {
  face: PortFace;
  /** 계획이 청구한 칸([LinkSeats.claimT]). 없으면 대조할 것이 없다. */
  claim: readonly FaceCell[] | undefined;
  /** 방출이 쓴 칸. */
  used: readonly FaceCell[];
  /** 진단 문장에 실을 이름 — 링크 신원이 없으면 품목. */
  who: string;
}): void {
  if (!o.claim) return;
  if (o.face === "N" || o.face === "S") return void recordShapeDiff({ skip: "gap" });

  if (DUMP) console.log(`      [전수] ${o.who} ${o.face} 계획[${o.claim.map(key).join(" ")}] 방출[${[...new Set(o.used.map(key))].join(" ")}]`);
  const planned = new Set(o.claim.map(key));
  const emitted = new Set(o.used.map(key));
  const onlyPlan = [...planned].filter((k) => !emitted.has(k));
  const onlyEmit = [...emitted].filter((k) => !planned.has(k));
  recordShapeDiff({
    onlyPlan: onlyPlan.length,
    onlyEmit: onlyEmit.length,
    // **방출만 쓴 칸이 위험한 쪽이다** — 장부에 없는 자리에 놓았다는 뜻이라 남과 부딪힌다.
    sample: onlyPlan.length + onlyEmit.length === 0
      ? undefined
      : `${o.who} ${o.face}`
        + (onlyEmit.length > 0 ? ` · **방출만 ${onlyEmit.slice(0, 4).join(" ")}**` : "")
        + (onlyPlan.length > 0 ? ` · 계획만 ${onlyPlan.slice(0, 4).join(" ")}` : "")
        + (DUMP ? `\n      계획 [${[...planned].join(" ")}]\n      방출 [${[...emitted].join(" ")}]` : ""),
  });
}
