/**
 * **모듈 안쪽 계획의 정책** — 모듈 축(한 모듈의 줄)과 간선 축(한 링크의 양끝)에서 **고른다.**
 *
 * ```
 * 모듈 축   seatModuleLinks   링크 — 양쪽 선호 면 먼저, 넘침은 그 뒤
 *           seatRestLines     나머지 줄 — 깊이 예산이 g 를 정하고 자식-공급을 먼저 앉힌다
 *           unpourableOf      줄이 하나도 안 난 줄과 고칠 위저드 단계
 *           restOutcomeOf     유체가 못 앉으면 나머지 줄이 통째로 물러난다
 * 간선 축   seatLinkEdge      한 링크를 양끝에 함께 — 합류 쌍 먼저 · 막히면 그 자리에서 쪼갠다
 * ```
 *
 * 한 면 안의 선택(끝 · 깊이 순서)은 [linkPlanner] 가, 자리를 묻고 적는 일은 [ledger] 가 한다.
 * **부르는 순서는 뼈대([planModulePorts]) 하나가 쥔다** — 좌석표는 먼저 앉은 것이 이기므로 그 순서가 곧 답이다.
 *
 * > **내력.** `planModulePorts.ts` 한 파일에 조율 · 장부와 섞여 있다가 2026-09-14 여기로 왔다
 * > (계획 구조-2축 · 2 Step 3b).
 */

import type { IoLine, Link } from "../../module/types/line";
import type { ModuleInput } from "../../module/types/module";
import type {
  DepthShortage, FaceAllocation, LinkFaceContext, LinkFacePlan, LinkFaceStage,
} from "../../module/types/seat";
import { externalLineGroups, readLinkRole, resolveSpanBlock, splitLinkAtRows } from "../../module/link";
import { recordLaneUnshare } from "../../../debug/runStats";
import { inserterForReach } from "../../buildSpec";
import { determineBeltCount } from "../../beltThroughput";
import { AUTO_LAYOUT_LINK_OPPOSITE_FACE } from "../../debugFlags";
import type { PortFace } from "../../containerModel";
import { planBundles } from "./depthBudget";
import { allocateLinkFaces, tryLinkFace, spillLinkFacesToGap } from "./linkPlanner";
import { commitLinkFace, seatOnSharedBelt } from "./ledger";
import { clusterBeltDepthsOf } from "./arith";

/** 나머지 줄의 좌석 — [ModulePortPlan.restLinks] 의 모양. 그룹은 여기서 만든 것이라 함께 들고 나간다. */
export interface RestSeating {
  out: { groups: Link[]; plans: (LinkFacePlan | undefined)[]; shortages: DepthShortage[][] };
  in: { groups: Link[]; plans: (LinkFacePlan | undefined)[]; shortages: DepthShortage[][] };
}

/**
 * **② 링크 좌석(모듈 축)** — 이 모듈의 링크를 직접 앉힌다.
 *
 * 이 단계는 팔 **수**만 본다(좌표 없음). gap 으로 넘어간 그룹은 gap 안에 가로 벨트를 놓고,
 * **gap 폭 = 그 gap 을 지나는 가로 벨트 수**다 — 그 폭이 다시 머신 좌표를 정하므로
 * 좌표보다 면이 먼저다.
 */
export function seatModuleLinks(
  faceCtx: LinkFaceContext,
  outLinks: Link[],
  inLinks: Link[],
): { out: FaceAllocation; in: FaceAllocation } {
  const outFaces = allocateLinkFaces(faceCtx, outLinks, "from", "W");
  const inFaces = allocateLinkFaces(faceCtx, inLinks, "to", "E");
  // 넘침은 나중 — 양쪽의 선호 면 수요가 먼저 자리를 잡은 뒤에 남은 gap 을 다툰다.
  // **선호 면을 다시 넣는 이유**: 그 면이 유체 면이면 위에서 비켜 갔다([tryLinkFace] 의
  // `allowPipeFace`). 넘침 단계는 유체 면을 허용하므로 여기서 한 번 더 기회를 준다 —
  // 유체 면에 앉으면 그 면이 넓어지지만 gap 으로 가면 기둥이 벌어진다. **유체 면이 먼저다.**
  // (반대 옆면은 여전히 안 쓴다 — 벨트가 채널 반대쪽에서 출발해 되돌아올 길이 없다.)
  spillLinkFacesToGap(faceCtx, outLinks, "from", outFaces, ["W", "S", "N"]);
  spillLinkFacesToGap(faceCtx, inLinks, "to", inFaces, ["E", "S", "N"]);
  return { out: outFaces, in: inFaces };
}

/**
 * **④ 나머지 줄 좌석** — ①이 남긴 예산 안에서, **링크와 같은 배분기로**.
 *
 * 탭이 안 되면 예전엔 `insertingPlanner` 가 자기 rim 모델로 자리를 잡았다. 그 모델은 W/E
 * 두 면만 봤고, 그래서 두 면이 차면 **거기서 끝**이었다. 같은 일을 하는 링크 배분기는
 * 이미 위/아래(gap)로 넘길 줄 아는데(가로 벨트 + gap 벌리기), 원료 줄이 *"이 벨트는 전
 * 머신 담당"* 이라고 적혀 나와 [tryLinkFace] 의 문턱(`arms.size !== 1`)에 걸렸을 뿐이다.
 *
 * **머신마다 하나씩 쪼개면 그대로 통과한다** — 그리고 쪼갠 그룹이 곧 "기계별 포트" 다.
 * 두 개념이 아니라 같은 것의 두 이름이라, 여기서 하나로 만난다.
 *
 * 면 순서: 선호 면 → **반대 면** → gap. gap 은 모듈을 세로로 벌리므로([gapRowsFromPlans])
 * 반대 면에 빈 행이 있는데 넘기면 순수한 손해다. 이 순서라서 *"오늘 W/E 에 앉는 것은
 * 그대로 W/E 에 앉는다"* 가 지켜진다.
 * **탭도 이 경로를 탄다**(2026-08-16 — 계획서 §19-④). 예전엔 `mode === "direct"` 일 때만
 * 만들었고, 탭은 `emitTapInserting` 이라는 **두 번째 트렁크 기하**를 따로 갖고 있었다.
 * [tryLinkFace] 의 `arms.size !== 1` 문턱이 풀린 지금(§19-①) 묶은 그룹이 그대로 앉으므로
 * 갈래를 둘 이유가 없다 — 트렁크 기하를 아는 코드가 **한 곳**이 된다(R3).
 *
 * 모드가 남기는 것은 **쪼개기 여부** 하나뿐이다: 탭이면 묶은 그룹(벨트 하나가 전 머신),
 * 다이렉트면 머신마다 하나. 그 둘은 `g = N` 과 `g = 1` 이라는 **같은 축의 두 끝**이다(§16).
 *
 * **어느 줄이 `g = 1` 로 내려가야 하나** — [planBundles] 가 **깊이 예산**으로 정한다
 * (`docs/auto-layout/module/trunk-assignment.md` §4.2). 기본값은 *"공짜일 때만 관통"* 이다.
 *
 * ```
 * 면 f:   (g>1 줄 수)  +  (g=1 줄이 있으면 1)   ≤   R_f
 * ```
 *
 * **예전엔 이 답을 `supply`(= `planClusterPorts`)가 냈다.** 그쪽은 지도가 달라서
 * (면 단위 슬롯 풀, 머신 축 없음) *"이 모듈은 다이렉트"* 라는 **모듈 단위 라벨**밖에 못
 * 냈고, 2026-08-31 에 줄 단위(`overflowed`)로 폈지만 여전히 **깊이를 안 셌다** —
 * 관통이 깊이를 통째로 먹는다는 것을 모른다. 그래서 한 줄이 관통을 사면 나머지가
 * 자리를 잃는 일이 조용히 났다(2026-09-01 실측: battery 에서 copper-plate 가 못 앉았다).
 *
 * 이제 **같은 지도**(`FaceTable`·[clusterBeltDepthsOf])가 낸 수로 정한다. `supply` 는 2026-09-02 에
 * 지도 A 와 함께 삭제됐다 — `g` 를 정하는 곳은 [planBundles] **하나**다.
 */
export function seatRestLines(
  st: LinkFaceStage,
  input: Pick<ModuleInput, "machine" | "inserters" | "nsExposure" | "supplyCapacity" | "belts">,
  count: number,
  restLines: IoLine[],
): RestSeating {
  const { ctx: faceCtx } = st;
  const outFaces = st.out;
  const inFaces = st.in;
  const restByPriority = [
    ...restLines.filter((l) => l.role === "output"),
    ...restLines.filter((l) => l.role === "input" && !l.external),
    ...restLines.filter((l) => l.role === "input" && l.external),
  ];
  const bundleByKey = planBundles({
    lines: restByPriority,
    count,
    lineRates: input.supplyCapacity?.lineRates,
    belts: input.belts,
    depthsOf: (face) => clusterBeltDepthsOf(faceCtx, face).length,
    // **①이 먼저 먹은 깊이** — 링크는 자기 기하를 스스로 갖고 이미 앉았다. 좌석을
    // `seatRowsUsed` 로 넘기는 것과 같은 이유로, 깊이도 넘겨야 예산이 참이 된다.
    taken: (face) => {
      let spanning = 0;
      let direct = false;
      for (const p of [...outFaces.plans, ...inFaces.plans]) {
        if (!p || p.face !== face) continue;
        if (p.arms.size > 1) spanning++;
        else direct = true;
      }
      return { spanning, direct };
    },
  });

  // **줄마다 따로 붓는다** — 묶음 크기가 줄마다 다르기 때문이다.
  const groups = restLines.flatMap((line) =>
    externalLineGroups([line], count, input.supplyCapacity ?? {}, input.inserters, undefined, {
      // **넘친 줄만 `g = 1` 로 내린다** — 계산이 이미 *어느 줄이* 자리를 못 찾았는지 안다.
      //
      // 예전엔 `perMachine: supply.mode !== "tap"` 이라 **한 줄이 안 되면 그 모듈의
      // 모든 줄**이 `g = 1` 로 떨어졌다. 계산은 옳았고 **산출의 낟알이 틀렸다** —
      // `planClusterPorts` 가 `overflowed` 로 줄 이름을 들고 있는데 모듈 라벨 하나로
      // 접혀 나왔다. (그 파일은 2026-09-02 에 지워졌다 — 여기 남은 것은 *왜 낟알이
      // 줄 단위여야 하는가* 의 근거다.)
      //
      // `g = 1` 이 처방인 이유: 그 줄은 **gap(N/S)으로 가야** 하고, 오늘 gap 은
      // `machinesOn !== 1` 이라 한 대짜리 그룹만 받는다([tryLinkFace]).
      // 넘치지 않은 줄은 처리량이 준 `g` 를 그대로 쓴다 — **부분 트렁크가 살아 있다.**
      bundle: bundleByKey.get(`${line.role}:${line.name}`),
      belts: input.belts,
      // **좌석 상한의 재료** — 이걸 안 주면 바깥 줄이 좌석을 안 보고 묶여, 팔이 면에
      // 안 들어가는 줄이 나서 배정에서 통째로 떨어진다(2026-08-23 실측: 40/s 원료 줄이
      // 팔 9개짜리 한 줄로 나 3칸 면에 못 앉았다).
      machineFaceCells: input.machine.h,
    }));
  const lineOfKey = new Map(restLines.map((l) => [`${l.role}:${l.name}`, l]));
  const isExternal = (g: Link): boolean =>
    lineOfKey.get(`${readLinkRole(g)}:${g.item}`)?.external ?? false;
  const out = groups.filter((g) => readLinkRole(g) === "output");
  // **입력 처리 순서: 자식-공급(내부 간선) 먼저, external(원료) 나중.**
  // 넘칠 때 **누가 반대 면으로 밀려나느냐**가 갈리기 때문이다. 자식-공급 입력이 W(부모
  // 반대편)로 밀려나면 그 줄의 납품 경로가 모듈을 **빙 돌아야** 하고, 실제로 길이 막힌다
  // (2026-08-05 실측: 통합 직후 이 순서를 빠뜨려 x 입력이 W 로 밀렸고 납품 1건이 실패했다).
  // external 입력은 납품 경로가 없다 — perimeter 로 나가면 그만이라 어느 면이든 안전하다.
  // 그래서 밀려날 자격이 있는 건 external 쪽이다(제약 센 것에 좋은 자리를 먼저).
  const inFed = groups.filter((g) => readLinkRole(g) === "input" && !isExternal(g));
  const inRaw = groups.filter((g) => readLinkRole(g) === "input" && isExternal(g));
  const outPlans = allocateLinkFaces(faceCtx, out, "from", "W");
  const fedPlans = allocateLinkFaces(faceCtx, inFed, "to", "E");
  const rawPlans = allocateLinkFaces(faceCtx, inRaw, "to", "E");
  // 넘치면 **반대 면 → gap** 순. 옛 rim 배분기가 쓰던 순서 그대로이고(출력 W→E,
  // 입력 E→W), gap 만 **새 마지막 수단**으로 붙였다 — 그래서 오늘 W/E 에 앉던 줄은
  // 그대로 W/E 에 앉고, 예전 같으면 자리가 없어 실패하던 것만 gap 으로 간다.
  // (반대 면이 나쁜 자리인 것은 맞지만 그 완화는 **순서**가 한다: 위에서 자식-공급을
  //  먼저 앉혀 밀려나는 쪽이 원료가 되게 했다. 금지하면 gap 이 아무 때나 벌어진다.)
  // 순서: **반대 면 → 선호 면 재시도(유체 허용) → gap.** 반대 면은 공짜지만 유체 면은
  // 앉는 순간 파이프가 물러나 폭을 먹고([tryLinkFace]), gap 은 기둥을 벌린다.
  // 선호 면이 유체가 아니면 재시도는 그냥 한 번 더 실패할 뿐이라 해가 없다.
  spillLinkFacesToGap(faceCtx, out, "from", outPlans, ["E", "W", "S", "N"]);
  spillLinkFacesToGap(faceCtx, inFed, "to", fedPlans, ["W", "E", "S", "N"]);
  // **원료 입력만 노출 끝면을 먼저 본다**([[ns-face-relief]] — `E → N/S → W`).
  // W 는 부모 쪽이라 납품 경로와 자리를 다투는데, `nsExposure` 면은 클러스터 **밖**이라
  // 공짜다. 그 완화가 옛 `insertingPlanner.nsFaces` 에만 있어서 아이템 방출이 링크
  // 경로로 합쳐질 때 함께 사라질 뻔했다(2026-08-17).
  spillLinkFacesToGap(faceCtx, inRaw, "to", rawPlans, [
    ...(input.nsExposure ?? []), "W", "E", "S", "N",
  ]);
  return {
    out: { groups: out, plans: outPlans.plans, shortages: outPlans.shortages },
    in: {
      groups: [...inFed, ...inRaw],
      plans: [...fedPlans.plans, ...rawPlans.plans],
      shortages: [...fedPlans.shortages, ...rawPlans.shortages],
    },
  };
}

/**
 * **⑤ 부을 수 없는 줄과 그 처방** — 실제로 줄이 난 나머지 줄들 집합에 없는 나머지 줄이
 * [ModulePortPlan.unpourableLines] 다.
 */
export function unpourableOf(
  input: Pick<ModuleInput, "inserters" | "supplyCapacity" | "belts">,
  restLines: IoLine[],
  restLinks: RestSeating,
): { lines: IoLine[]; fix: Map<string, "belt" | "inserter"> } {
  const pouredKeys = new Set(
    [...restLinks.out.groups, ...restLinks.in.groups].map((g) => `${readLinkRole(g)}:${g.item}`),
  );
  const unpourable = restLines.filter(
    (l) => l.kind === "belt" && !pouredKeys.has(`${l.role}:${l.name}`),
  );
  // **처방은 여기서 난다** — [ModulePortPlan.unpourableFix]. 붓기가 빈 손으로 돌아오는 원인
  // 셋을 같은 입력으로 되짚는다(`externalLineGroups` 의 `pour` 와 **같은 세 물음**이다).
  const unpourableFix = new Map<string, "belt" | "inserter">();
  for (const l of unpourable) {
    const key = `${l.role}:${l.name}`;
    const rate = input.supplyCapacity?.lineRates?.get(key);
    if (rate === undefined) continue; // 수량 미상 — 위저드 단계로 못 보낸다
    if (!inserterForReach(input.inserters, 1)) {
      unpourableFix.set(key, "inserter");
      continue;
    }
    if (determineBeltCount(rate, [...(input.belts ?? [])]).length === 0)
      unpourableFix.set(key, "belt");
  }
  return { lines: unpourable, fix: unpourableFix };
}

/**
 * **나머지 줄의 성패** — [ModulePortPlan.rest].
 *
 * 유체 줄이 자리를 못 잡으면 나머지 줄이 통째로 실패한다 — 반만 놓으면 유체를 못 받는
 * 머신이 **조용히 굶는다**. 예전엔 여기 `supply.mode === "direct"` 도 함께 있었다: 파이프
 * 방출이 tap 가지 안에만 있어서 1:1 로 물러나면 유체가 사라졌기 때문이다. 방출을 갈래 밖으로
 * 꺼낸 지금([generateModule]) 그 근거가 없다 — 파이프는 두 방식에서 똑같이 깔린다.
 *
 * (나)로 갔으면 [ClusterBelt] 가 하나도 없다 — 줄들은 `restLinks` 가 들고 있고, 못 앉은
 * 그룹의 실패는 링크와 똑같이 **자기 방출에서** 갈린다(그래서 `unplaced` 가 아니다).
 * 유체가 못 앉으면 **유체 줄까지** 함께 낸다 — `restLines` 는 파이프를 빼고 걸러진 목록이라
 * 그것만 내면 정작 실패한 유체가 사유에서 사라진다(2026-08-16 회귀).
 */
export function restOutcomeOf(
  input: Pick<ModuleInput, "lines">,
  linkedKeys: ReadonlySet<string>,
  pipe: { cannotPlace: boolean },
): { ok: true } | { ok: false; unplaced: IoLine[] } {
  return pipe.cannotPlace
    ? { ok: false, unplaced: input.lines.filter((l) => !linkedKeys.has(`${l.role}:${l.name}`)) }
    : { ok: true };
}

/**
 * **합류 쌍을 골라 이끄는 줄과 포트 끝을 정한다** — 앉히기 **전에**, 수만으로.
 *
 * ## 이끄는 줄 = **짧은 구간**
 * 합류 칸은 이끄는 줄의 포트 쪽 끝에 서고, 따르는 줄이 **거기까지 비켜 올라온다.**
 * 그 비켜 가는 길이가 곧 **이끄는 줄의 길이**다 — 그러니 짧은 쪽이 이끌어야 한다.
 * (실측 예: 8대·3대 기둥에서 긴 쪽이 이끌면 10칸, 짧은 쪽이 이끌면 **4칸**.)
 * *"합류는 빠를수록 좋다"* 를 코드로 옮긴 것이 이 한 줄이다 — 두 줄이 나란히 달리는
 * 구간이 짧을수록 자리를 덜 먹는다.
 *
 * ## 포트 끝 = **이끄는 줄이 있는 쪽**
 * 이끄는 줄이 기둥 **아래쪽**(머신 index 가 큰 쪽)이면 S, 아니면 N.
 *
 * 짝이 둘이 아닌 신원은 아예 안 담는다 — 쪼개져 하나만 남았거나 이미 풀린 것이다.
 */
function pairsOf(groups: readonly Link[]): Map<string, { lead: Link; follow: Link; end: "N" | "S" }> {
  const by = new Map<string, Link[]>();
  for (const g of groups) {
    if (g.sharedLineId === undefined) continue;
    (by.get(g.sharedLineId) ?? by.set(g.sharedLineId, []).get(g.sharedLineId)!).push(g);
  }
  const out = new Map<string, { lead: Link; follow: Link; end: "N" | "S" }>();
  for (const [id, gs] of by) {
    if (gs.length !== 2) continue;
    const size = (g: Link) => g.from.size;
    const [lead, follow] = size(gs[0]) <= size(gs[1]) ? [gs[0], gs[1]] : [gs[1], gs[0]];
    const lo = (g: Link) => Math.min(...g.from.keys());
    out.set(id, { lead, follow, end: lo(lead) > lo(follow) ? "S" : "N" });
  }
  return out;
}

/**
 * **간선 하나를 양끝에 함께 앉힌다** — 루프 축이 모듈이 아니라 간선이다
 *
 * `Link` 는 **두 모듈에 걸친 객체**다 — `from` 은 자식의 머신, `to` 는 부모의 머신.
 * 그런데 옛 모듈 축에서는 자식이 `from` 만, 부모가 `to` 만, **서로 모르게** 읽었다.
 * 그래서 셋이 불가능했고(쪼갬·끝 맞추기·순서), 코드는 그 셋을 **밖에서 우회**하며
 * 되먹임 둘을 지고 있었다.
 *
 * 여기서 얻는 것이 둘이다:
 *
 * ```
 * ① 원자성  양끝이 다 되면 확정 · 한쪽이라도 안 되면 둘 다 미배정   ← 반쪽 배정이 없다
 * ② 국소성  쪼갤 만하면 **그 자리에서** 쪼개고 토막을 이어서 앉힌다  ← 밖에서 고쳐 다시 안 만든다
 * ```
 *
 * ①이 없던 시절의 증상이 `PackResult.linkMismatches` 의 *"child emitted, parent didn't"* 이고,
 * ②가 없던 시절의 대가가 **되먹임 B**(`linkCache` 를 밖에서 고치고 트리를 통째로 재생성)다.
 *
 * @param toOffsetGroups 이 간선의 그룹들. **반환값의 `groups` 가 최종본**이다(쪼개졌으면 토막).
 */
export function seatLinkEdge(
  fromSeat: LinkFaceStage,
  toSeat: LinkFaceStage,
  toOffsetGroups: readonly Link[],
  opts: { split: boolean },
): EdgeSeatResult {
  const groups: Link[] = [];
  const fromPlans: (LinkFacePlan | undefined)[] = [];
  const toPlans: (LinkFacePlan | undefined)[] = [];
  const fromWhy: DepthShortage[][] = [];
  const toWhy: DepthShortage[][] = [];
  let splits = 0;

  // **쪼갬 예산** — 못은 깊이 수만큼에서 멈추므로(`machine-link.md`) 유한하지만,
  // 예산 없이 두면 잘못된 판정 하나가 무한 루프가 된다. 그룹당 넷이면 넉넉하다.
  let budget = toOffsetGroups.length * 4;

  // ── 배정 순서 — **제약이 센 것부터**(스도쿠 원칙) ──────────────────────────────
  //
  // `planLinkFaces` ⓪ 이 유체 면에 쓰는 그 원칙이다. 순위는 **대안이 있느냐**로 갈린다:
  //
  // ```
  // ① 유체 면    머신이 정한다. 협상 불가                    (여기 오기 전에 끝났다)
  // ② 합류 쌍    기둥 끝 + 비켜 가는 열. **대안이 없다**      ← 이 정렬이 넣는 자리
  // ③ 관통 줄    끝을 원한다. 못 받으면 **옆 포트로 저하 가능**
  // ④ 구간 줄    옆 포트. 깊이·행이 자유로워 가장 헐겁다
  // ```
  //
  // **이 순서면 「양보하나 포기하나」를 따로 판단할 필요가 없다.** 합류가 먼저 앉고, 그래도
  // 자리가 없으면 그건 모듈에 **진짜로** 자리가 없는 것이라 정직하게 포기하면 된다 —
  // 남이 뺏은 것이 아니다. (2026-09-04 사장님과 정한 기준.)
  const mergePairs = pairsOf(toOffsetGroups);
  const queue: Link[] = [
    ...[...mergePairs.values()].flatMap((p) => [p.lead, p.follow]),
    ...toOffsetGroups.filter((g) => !(g.sharedLineId && mergePairs.has(g.sharedLineId))),
  ];

  const keep = (g: Link, fp?: LinkFacePlan, tp?: LinkFacePlan, fw: DepthShortage[] = [], tw: DepthShortage[] = []) => {
    groups.push(g); fromPlans.push(fp); toPlans.push(tp); fromWhy.push(fw); toWhy.push(tw);
  };

  /**
   * **레인 공유 — 양끝이 서로 다르게 다뤄진다.**
   *
   * ```
   * 싣는 쪽(from)   벨트 **둘**  — 팔이 각자 먼 레인에 떨궈야 두 레인이 찬다.
   *                 다만 **같은 끝 · 인접 깊이**라야 기둥 끝 바깥 한 행에서 만난다
   * 집는 쪽(to)     벨트 **하나** — 합류한 벨트가 벽의 한 칸으로 들어온다
   * ```
   *
   * 그래서 장부도 둘이다: `sharedFrom` 은 *"둘째 줄이 나란히 앉을 자리"* 를 재고,
   * `sharedTo` 는 *"둘째 줄이 얹힐 벨트"* 를 든다.
   */
  const sharedTo = new Map<string, LinkFacePlan>();
  const sharedFrom = new Map<string, LinkFacePlan>();

  while (queue.length > 0) {
    const g = queue.shift()!;
    const fw: DepthShortage[] = [];
    const tw: DepthShortage[] = [];
    // **놓기 전에 둘 다 물어본다** — `tryLinkFace` 는 장부를 안 건드린다(원자성의 전제다).
    // 합류 쌍은 **양쪽 줄 다** 기둥 끝 포트로 앉힌다(따르는 줄은 포트를 안 갖지만, 같은 끝·
    // 같은 `topT` 규약을 써야 방출이 합류 칸을 계산할 수 있다).
    const pair = g.sharedLineId !== undefined ? mergePairs.get(g.sharedLineId) : undefined;
    const inPair = pair !== undefined;
    // **이끄는 줄이 이미 앉았으면 그 면·깊이를 물려받는다** — 배정 순서가 쌍을 붙여 놓았으므로
    // 따르는 줄 차례엔 반드시 있다(없으면 이끄는 줄이 도형을 못 세운 것이라 짝도 아니다).
    const fromPartner = g.sharedLineId !== undefined ? sharedFrom.get(g.sharedLineId) : undefined;
    let candFrom = tryLinkFace(
      fromSeat.ctx, g, "from", "W", false, fw, inPair, pair?.end, fromPartner?.clusterBeltDepth,
    );

    // **싣는 쪽 — 짝의 둘째 줄은 첫 줄과 같은 끝을 써야 한다.**
    //
    // 출구 합류는 기둥 끝 **바깥 한 행**에서 일어난다(`emitOutputLinks`). 두 줄이 서로 다른
    // 끝으로 나가면 그 행에서 만날 수가 없다. 그런데 기둥 끝 장부(`ctx.ends`)는 기본적으로
    // **반대 끝**을 준다(먼저 앉은 줄이 N 을 잡으면 다음은 S) — 그래서 여기서 덮어쓴다.
    //
    // 깊이가 **인접**하지 않거나 면이 다르면 그 도형이 안 선다 → **짝을 푼다.**
    // (배정 단계라 아직 풀 수 있다 — 납품이 하나로 접히는 것은 이 뒤다.)
    let merged: Record<string, never> | undefined;
    if (candFrom && fromPartner) {
      // **같은 면 · 같은 깊이 · 끝이 있다.** 구간 줄 둘은 구간이 안 겹쳐 **한 깊이를 나눠
      // 쓴다** — 그래서 같은 열에 위/아래로 쌓이고, 따르는 줄이 그 열 밖(깊이 +2)으로
      // 비켜 이끄는 줄의 합류 칸까지 올라온다.
      const ok =
        candFrom.face === fromPartner.face
        && fromPartner.portEnd !== undefined
        && candFrom.portEnd !== undefined // 끝을 아예 못 받으면(양쪽 다 찼다) 기하가 없다
        && candFrom.clusterBeltDepth === fromPartner.clusterBeltDepth;
      if (ok) {
        // **같은 끝으로 나가야 한 행에서 만난다** — 끝 장부는 기본적으로 반대 끝을 준다.
        candFrom = { ...candFrom, portEnd: fromPartner.portEnd };
        merged = {};
      } else {
        g.sharedLineId = undefined;
        recordLaneUnshare("shape");
      }
    }

    /**
     * **이 줄이 지금도 짝의 이끄는 쪽인가** — 커밋 **직전에** 다시 묻는다.
     *
     * `inPair` 는 큐를 세울 때의 사실이라 그 뒤 짝이 풀렸어도(`g.sharedLineId = undefined`)
     * 참으로 남는다. 그 값으로 `mergeLead` 를 주면 **합칠 상대가 없는데 합류 도형을 청구**
     * 하고, 방출은 신원이 지워졌으니 평범한 도형을 놓아 둘이 갈린다(2026-09-12 F2 와 같은 뿌리).
     *
     * 기하가 안 서는 경우도 여기서 걸러 낸다 — 끝을 못 받았거나 gap 면이면 합류 칸이 설 자리가
     * 없다. 그래야 방출이 [LinkFacePlan.mergeRole] 하나만 보고 따를 수 있다.
     */
    const leadNow = (): boolean =>
      g.sharedLineId !== undefined && mergePairs.has(g.sharedLineId)
      && candFrom !== undefined && candFrom.portEnd !== undefined
      && candFrom.face !== "N" && candFrom.face !== "S";

    // **집는 쪽 — 짝의 둘째 줄은 자리를 안 고른다.** 첫 줄이 잡은 벨트에 좌석만 얹는다.
    const partner = g.sharedLineId !== undefined ? sharedTo.get(g.sharedLineId) : undefined;
    if (candFrom && partner) {
      const onShared = seatOnSharedBelt(toSeat.ctx, g, "to", partner);
      if (onShared) {
        keep(g, commitLinkFace(fromSeat.ctx, candFrom, "from", { merged, mergeLead: !merged && leadNow() }), onShared);
        continue;
      }
      // 좌석이 모자라다 — **짝을 푼다.** 반쪽만 공유된 상태를 남기지 않는다.
      g.sharedLineId = undefined;
      recordLaneUnshare("seats");
    }

    const candTo = tryLinkFace(toSeat.ctx, g, "to", "E", false, tw);
    if (candFrom && candTo) {
      const toPlan = commitLinkFace(toSeat.ctx, candTo, "to");
      const fromPlan = commitLinkFace(fromSeat.ctx, candFrom, "from", { merged, mergeLead: !merged && leadNow() });
      if (g.sharedLineId !== undefined && !sharedTo.has(g.sharedLineId)) {
        sharedTo.set(g.sharedLineId, toPlan); // 첫 줄 — 다음 줄이 이 벨트에 얹힌다
        sharedFrom.set(g.sharedLineId, fromPlan); // 〃 — 다음 줄이 이 옆에 나란히 앉는다
      }
      keep(g, fromPlan, toPlan);
      continue;
    }

    // **구간막힘이면 그 자리에서 쪼갠다**(Step 3). 막힌 쪽에서 자른다 — 자름의 경계는
    // 그 쪽 모듈의 행이므로 `rowsPerMachine` 도 그 쪽 것이다.
    if (opts.split && budget > 0) {
      const cut = !candTo
        ? { side: "to" as const, rows: cutRows(tw), h: toSeat.ctx.machine.h }
        : { side: "from" as const, rows: cutRows(fw), h: fromSeat.ctx.machine.h };
      if (cut.rows.length > 0) {
        const parts = splitLinkAtRows(g, cut.side, cut.rows, cut.h);
        if (parts.length > 1) {
          budget -= parts.length;
          splits += parts.length - 1;
          queue.unshift(...parts); // 토막을 **앞에** 넣어 이어서 앉힌다 — 되돌리기가 없다
          continue;
        }
      }
    }

    // 넘침 — 선호 면이 빈손이면 다른 면을, 역시 **양끝 함께**.
    const spilled = spillPair(fromSeat, toSeat, g);
    if (spilled) { keep(g, spilled.from, spilled.to); continue; }
    keep(g, undefined, undefined, fw, tw); // 정직하게 자리 없음
  }
  return { groups, fromPlans, toPlans, fromWhy, toWhy, splits };
}

/** 후보들 중 **쪼개면 실제로 앉는** 첫 경계. 없으면 빈 배열([resolveSpanBlock]). */
function cutRows(why: readonly DepthShortage[]): number[] {
  for (const r of why) {
    if (!r.blockedRows?.length || !r.seatRows?.length) continue;
    const worth = resolveSpanBlock(r.seatRows, r.blockedRows);
    if (worth.length > 0) return worth;
  }
  return [];
}

/**
 * 넘침 — 선호 면이 안 되면 다른 면을 본다. 면 순서는 옛 축과 같다
 * (출력 `["W","S","N"]` · 입력 `["E","S","N"]`) — 선호 면이 다시 들어 있는 것은 그 면이
 * 유체 면이면 1단계가 비켜 갔기 때문이다(`allowPipeFace`).
 */
function spillPair(
  fromSeat: LinkFaceStage,
  toSeat: LinkFaceStage,
  g: Link,
): { from: LinkFacePlan; to: LinkFacePlan } | undefined {
  // **반대 옆면은 gap 앞에 온다** — gap 은 기둥을 벌려 모듈을 키우지만(`gapRowsFromPlans`)
  // 반대 면은 안 키운다. 그 순서는 자매 경로가 자기 줄에 이미 쓰는 것과 같다
  // ([seatRestLines]: `["E","W","S","N"]` · `["W","E","S","N"]`).
  //
  // **끄면 오늘 동작 그대로다** — 기전: `false` 면 배열이 옛 상수와 글자 그대로 같아,
  // 반대 면을 후보로 **한 번도 안 물어본다**([tryLinkFace] 호출 자체가 안 생긴다).
  //
  // 이 분기가 **켜졌는데 납품이 깨지면** `tempPlanDocs/부분-링크/judgements.md` **J14** 를
  // 본다 — 그 대가를 재는 것이 이 플래그의 존재 이유다(2026-08-05 실측: 자매 경로에서
  // W 로 밀린 자식-공급 입력의 납품 1건이 실패했다).
  const both = AUTO_LAYOUT_LINK_OPPOSITE_FACE;
  const OUT: readonly PortFace[] = both ? ["W", "E", "S", "N"] : ["W", "S", "N"];
  const IN: readonly PortFace[] = both ? ["E", "W", "S", "N"] : ["E", "S", "N"];
  for (const ff of OUT) {
    const candFrom = tryLinkFace(fromSeat.ctx, g, "from", ff, true);
    if (!candFrom) continue;
    for (const tf of IN) {
      const candTo = tryLinkFace(toSeat.ctx, g, "to", tf, true);
      if (!candTo) continue;
      return {
        from: commitLinkFace(fromSeat.ctx, candFrom, "from"),
        to: commitLinkFace(toSeat.ctx, candTo, "to"),
      };
    }
  }
  return undefined;
}

/** [seatLinkEdge] 의 산출 — **`groups` 가 그 간선의 최종본**이다(쪼개졌으면 토막). */
export interface EdgeSeatResult {
  groups: Link[];
  fromPlans: (LinkFacePlan | undefined)[];
  toPlans: (LinkFacePlan | undefined)[];
  fromWhy: DepthShortage[][];
  toWhy: DepthShortage[][];
  /** 쪼갠 횟수(진단). */
  splits: number;
}
