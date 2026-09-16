/**
 * **간선의 셈** — 생성된 두 모듈의 포트를 짝짓는다. 대안이 없다.
 *
 * 짝은 `linkId` 로 **조회**하고(추측이 아니라 조회 — [pairDeliveryPorts]), 신원 없는 포트는 교환 가능이라
 * 위치-zip 이 정답이다. 그래서 정책이 아니라 셈이다(work-kinds §2 *"대안이 있었나"*).
 *
 * > **내력.** `modulePacking.packModuleTree` 의 `2) 납품 짝짓기` 블록이었다(2026-09-14 계획 구조-2축 · 2 Step 3c-2).
 * > 구조-2축 §3 이 처음엔 `link/policy` 에 적었다가 착수 전 재측정에서 셈으로 고쳤다.
 */

import type { GeneratedModule, ModulePort } from "../../module/types/module";
import { moduleExtent } from "../../module/moduleTransform";
import { deliveryKey, pairDeliveryPorts } from "./edgeLinks";
import type { NodeSpec, RowChannelEntry } from "../../tree/types/pack";
import type { TreeIndex } from "../../tree/arith/pack";

/**
 * 납품 경로 씨앗 — 기하 예약(통로 단계)의 납품 경로 입력. eligible = 자식 출력이 W변·부모 입력이 E변
 * (= 둘 사이 채널을 정면으로 가로지르는 계단꼴 모델의 전제). 아니면(스필 등) 폭만 예약.
 */
export interface DeliverySeed {
  depth: number;
  key: string;
  startY: number;
  endY: number;
  /** 절대 행을 나중에 계산할 재료 — 모듈 신원과 **모듈-로컬** 행. */
  fromId: string;
  toId: string;
  fromAnchorY: number;
  toAnchorY: number;
  eligible: boolean;
  /** 유체 이름(파이프 납품 경로). undefined = 아이템. 장부의 인접 규칙·배정 우선순위 입력. */
  fluid?: string;
  /** 자식 쪽 끝의 행 채널 접근(있으면). */
  fromRowChannel?: RowChannelEntry;
  /** 부모 쪽 끝의 행 채널 접근(있으면). */
  toRowChannel?: RowChannelEntry;
}

/**
 * **행 채널을 지나야 하는 경로 끝들** — 포트가 기둥 끝(N/S)이라 세로 채널 벽을 직접 못 마주 보는 것.
 *
 * (E) 결정에 따라 이 경로는 **자기 깊이 열 안에서만** 가로로 달린다 — 세로 채널을
 * 가로지르지 않으므로 교차로가 없다.
 *
 * 지금은 **세기만** 한다. 이 수가 0이면 행 채널이 이 트리에 필요 없다는 뜻이고,
 * 0이 아니면 Step 3(트랙 배정 + 두 패스)이 실제로 값을 낸다.
 */
export interface RowChannelNeed {
  id: string;
  nodeId: string;
  depth: number;
  /** **나중에 채운다** — 절대 행은 세로 좌표가 선 뒤에 온다(6단계). 진단용이다. */
  portY: number;
  /** 포트의 **모듈-로컬** 행. `portY` 를 나중에 계산하는 재료다. */
  anchorY: number;
  face: ModulePort["face"];
  /**
   * 이 끝이 행 채널에서 달릴 **가로 구간**(모듈-로컬 x). 상자에서 그 열의 **서쪽 변**까지다 —
   * 세로 채널이 서쪽에 있으므로((E) 자기 깊이 안에서만 달린다).
   *
   * 같은 깊이의 모듈은 전부 `colX[depth]` 에 **왼쪽 정렬**되므로, 로컬 x 로 비교해도
   * 절대 x 로 비교한 것과 겹침 판정이 같다. `colX` 는 이 단계보다 뒤에 정해진다.
   */
  x1: number;
  x2: number;
}

/** [pairDeliveries] 의 답 — **좌표가 없다.** 절대 행은 세로 자리 단계가 채운다. */
export interface DeliveryPairing {
  deliverySeeds: DeliverySeed[];
  /** 짝지은 상자 id — 통로(트랙 예약)와 결과(납품 경로 생성)가 공유한다. 세 곳이 따로 판단해 어긋나는 일이 없게. */
  pairedChestIds: Set<string>;
  /** [pairDeliveryPorts] 가 신원 있는 포트끼리 짝을 못 찾았을 때 쌓는 사유 — 정상 경로가 아니다. */
  linkMismatches: string[];
  rowChannelNeeds: RowChannelNeed[];
  /** [자식 id] → 짝지은 (출력상자 id, 입력상자 id, linkId) 쌍들. 7)이 absById 로 재구성한다. */
  deliveryPairs: Map<string, { item: string; outId: string; inId: string; linkId?: string }[]>;
}

/**
 * **④ 짝 — 좌표 없이.** 누가 누구에게 · 짝 못 지은 상자 · 행 채널을 지날 끝 · 납품 씨앗(모듈-로컬).
 *
 *    예전엔 이 루프가 `topY` 뒤에 있어 절대 행을 그 자리에서 계산했다. 그러면 행 채널 수요가
 *    좌표보다 뒤가 되고, 행 채널 높이가 배치를 못 민다. 여기서는 **재료만** 담고 절대 행은
 *    6단계로 미룬다 — 짝짓기 자체는 좌표를 하나도 안 본다(`rowChannelPlanner` 머리말).
 *
 * 짝짓기는 생성된 모듈에서 한 번만 하고(결정적), 짝지은 상자 id 를 통로(트랙 예약)와 결과(납품 경로 생성)가 공유한다.
 */
export function pairDeliveries(
  specs: readonly NodeSpec[],
  tree: Pick<TreeIndex, "byId">,
  oriented: ReadonlyMap<string, { module: GeneratedModule }>,
  productOf: ReadonlyMap<string, string | undefined>,
): DeliveryPairing {
  const { byId } = tree;
  const deliverySeeds: DeliverySeed[] = [];
  const pairedChestIds = new Set<string>();
  /** 이미 납품을 낸 물리 벨트 신원(레인 공유) — 같은 벨트에 두 번 납품을 내지 않는다. */
  const mergeDoneFor = new Set<string>();
  const usedParentIn = new Map<string, Set<string>>();
  /** [pairDeliveryPorts] 가 신원 있는 포트끼리 짝을 못 찾았을 때 쌓는 사유 — 정상 경로가 아니다. */
  const linkMismatches: string[] = [];
  const rowChannelNeeds: RowChannelNeed[] = [];
  const deliveryPairs = new Map<string, { item: string; outId: string; inId: string; linkId?: string }[]>();
  for (const s of specs) {
    if (!s.parentId) continue;
    const product = productOf.get(s.id);
    if (!product) continue;
    const used = usedParentIn.get(s.parentId) ?? usedParentIn.set(s.parentId, new Set()).get(s.parentId)!;
    const pairs = pairDeliveryPorts(oriented.get(s.id)!.module, oriented.get(s.parentId)!.module, product, used, linkMismatches);
    deliveryPairs.set(
      s.id,
      pairs.map((p) => ({ item: product, outId: p.out.chest.id, inId: p.inp.chest.id, linkId: p.out.linkId })),
    );
    pairs.forEach(({ out, inp }, i) => {
      pairedChestIds.add(out.chest.id);
      pairedChestIds.add(inp.chest.id);
      // **행 채널을 지나야 하는 끝** — 포트가 기둥 끝(N/S)이면 상자가 기둥 밖에 있어
      // 세로 채널 벽을 **직접 못 마주 본다**. 자기 깊이 열 안에서 가로로 달려 벽까지 가야
      // 하고, 그 가로 구간이 **행 채널의 트랙**이다((E) — 세로 채널을 안 가로지른다).
      //
      // 여기서는 **세기만** 한다(Step 3 준비). 실제 배정은 통로가 서고 나서다.
      for (const [who, port] of [["out", out], ["in", inp]] as const) {
        if (port.face !== "N" && port.face !== "S") continue;
        const ownerId = who === "out" ? s.id : s.parentId!;
        const ownerExt = moduleExtent(oriented.get(ownerId)!.module);
        rowChannelNeeds.push({
          id: `${deliveryKey({ fromId: s.id, toId: s.parentId!, item: product, seq: i, linkId: out.linkId })}:${who}`,
          nodeId: ownerId,
          depth: who === "out" ? s.depth : s.depth - 1,
          portY: 0, // ← 6단계가 채운다
          anchorY: port.anchor.y,
          face: port.face,
          x1: 0, // 열의 서쪽 변
          x2: port.anchor.x - ownerExt.x, // 상자의 로컬 x
        });
      }
      // **행 채널을 지나는 끝은 진입 행이 곧 출발/도착 행이다.** 세로 채널은 그 행이 포트의
      // 것인지 행 채널 트랙의 것인지 안 가린다(Step 0 확인) — 그래서 여기서 바꿔 넘기면 끝이다.
      // **행 채널 접근은 아직 모른다** — 배정(5a-2)이 이 루프보다 뒤다. 여기선 포트 행으로 두고,
      // 배정이 끝난 뒤 그 자리에서 `startY`/`endY` 와 `fromRowChannel`/`toRowChannel` 를 덮어쓴다.
      const dkey = deliveryKey({ fromId: s.id, toId: s.parentId!, item: product, seq: i, linkId: out.linkId });
      // **레인 합류 — 납품은 하나뿐이다.**
      //
      // 두 줄은 **모듈 출구에서 이미 한 벨트로 합쳐졌고**(`emitOutputLinks` 의 합류 칸),
      // 부모도 한 벨트로 받는다(`seatOnSharedBelt`). 양끝이 각각 **한 칸**이므로 그 사이를
      // 잇는 물리 경로도 하나다 — 뒤에 온 줄은 납품을 **안 만든다**.
      //
      // 채널이 두 경로를 만나게 하던 옛 안(`mergeTail`)은 이것으로 대체됐다: 합류를 자리가
      // 규칙적인 **출구**에서 계산하면 채널이 그 사실을 아예 몰라도 된다.
      if (inp.sharedLineId !== undefined) {
        if (mergeDoneFor.has(inp.sharedLineId)) return;
        mergeDoneFor.add(inp.sharedLineId);
      }
      deliverySeeds.push({
        depth: s.depth,
        key: dkey,
        // **나중에 채운다** — 6단계가 `fromAnchorY`/`toAnchorY` 에서 계산한다.
        startY: 0,
        endY: 0,
        fromId: s.id,
        toId: s.parentId!,
        fromAnchorY: out.anchor.y,
        toAnchorY: inp.anchor.y,
        // **적격 = 두 끝이 채널 벽에 닿을 수 있나.**
        //
        // 예전엔 *"포트가 벽을 마주 본다"*(`side === W`/`E`)로만 봤다. 그게 계단꼴 모델의
        // 전제였다(docs/layout-models §2③). 이제 **기둥 끝 포트도 행 채널을 지나 벽에 닿으므로**
        // 그 경우를 적격에 넣는다 — 조건이 넓어진 게 아니라 **닿는 길이 하나 늘었다.**
        // (2026-08-17 에 조건만 넓히고 도형을 안 늘렸다가 모듈 관통 경로가 나왔다.)
        eligible:
          (out.meta.side === "W" || out.face === "N" || out.face === "S")
          && (inp.meta.side === "E" || inp.face === "N" || inp.face === "S")
          && byId.get(s.parentId!)!.depth === s.depth - 1,
        // 유체 납품 경로는 **항상** 적격이다 — moduleWizard 가 출력 유체를 W, 입력 유체를 E 면에
        // 오도록 회전을 강제하고(wantFace) 못 맞추면 트리째 reject 하기 때문이다. 즉 위
        // eligible 조건과 유체의 존재 조건이 같다(docs/…fluid-delivery-reservation.md §1.1).
        fluid: out.line.kind === "pipe" ? product : undefined,
      });
    });
  }
  return { deliverySeeds, pairedChestIds, linkMismatches, rowChannelNeeds, deliveryPairs };
}
