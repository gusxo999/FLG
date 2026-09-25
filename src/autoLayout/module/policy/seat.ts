/**
 * **모듈 안쪽 계획의 정책** — 한 모듈의 면에서 **고른다.**
 *
 * ```
 * 좌석 창구  openFaceSeating   링크 쪽이 묻고 받는 곳 — 면 · 깊이 · 끝은 여기서 고른다
 * 나머지 줄  seatRestLines     깊이 예산이 g 를 정하고 자식-공급을 먼저 앉힌다
 *            unpourableOf      줄이 하나도 안 난 줄과 고칠 위저드 단계
 *            restOutcomeOf     유체가 못 앉으면 나머지 줄이 통째로 물러난다
 * ```
 *
 * 한 링크를 양끝에 함께 앉히는 일(합류 · 쪼갬 · 원자성)은 `link/policy/seat` 에 있다 — 양끝의 결정이다.
 * 모듈이 **혼자** 링크를 앉히는 길(옛 `seatModuleLinks` — 모듈 축)은 없다. 링크의 자리는 양끝이 함께 정한다
 * (2026-09-24 — 제품이 안 타는 갈래라 지웠다).
 *
 * 한 면 안의 선택(끝 · 깊이 순서)은 [linkPlanner] 가, 자리를 묻고 적는 일은 [ledger] 가 한다.
 * **부르는 순서는 뼈대([planModulePorts]) 하나가 쥔다** — 좌석표는 먼저 앉은 것이 이기므로 그 순서가 곧 답이다.
 *
 * > **내력.** `module/policy/port.ts` 한 파일에 조율 · 장부와 섞여 있다가 2026-09-14 여기로 왔다
 * > (계획 구조-2축 · 2 Step 3b).
 */

import type { IoLine, Link } from "../types/line";
import type { ModuleInput } from "../types/module";
import type {
  DepthShortage, FaceSeating, LinkFacePlan, ModuleFaces, SeatReceipt,
} from "../types/seat";
import { externalLineGroups, readLinkRole } from "../arith/link";
import { inserterForReach } from "../../shared/gamedata/spec";
import { determineBeltCount } from "../../shared/arith/belt";
import { AUTO_LAYOUT_LINK_OPPOSITE_FACE } from "../../shared/flags";
import type { PortFace } from "../../shared/types";
import { planBundles } from "../arith/depth";
import { allocateLinkFaces, seatOnSharedBelt, tryLinkFace, spillLinkFacesToGap } from "./link";
import { commitLinkFace, openLinkFaceContext } from "../ledger/seat";
import { clusterBeltDepthsOf, fluidFacesOf } from "../arith/face";

// ─────────────────────────────────────────────────────────────────────────────
// 좌석 창구 — 링크 쪽에 내주는 계약의 구현
// ─────────────────────────────────────────────────────────────────────────────

/** 링크의 선호 면 — 부모가 서쪽이라 출력은 W, 입력은 E. */
const LINK_NEAR: Record<"from" | "to", PortFace> = { from: "W", to: "E" };

/**
 * **링크의 넘침 순서** — 선호 면이 안 되면 다른 면을 본다. 선호 면이 다시 들어 있는 것은 그 면이 유체 면이면
 * near 가 비켜 갔기 때문이다(`allowPipeFace`).
 *
 * **반대 옆면은 gap 앞에 온다** — gap 은 기둥을 벌려 모듈을 키우지만(`gapRowsFromPlans`) 반대 면은 안 키운다.
 * **끄면 오늘 동작 그대로다** — `false` 면 반대 면을 후보로 한 번도 안 물어본다.
 *
 * 이 분기가 **켜졌는데 납품이 깨지면** `tempPlanDocs/부분-링크/judgements.md` **J14** 를 본다 — 그 대가를 재는 것이
 * 이 플래그의 존재 이유다(2026-08-05 실측: 자매 경로에서 W 로 밀린 자식-공급 입력의 납품 1건이 실패했다).
 *
 * > 나머지 줄의 넘침([seatRestLines])은 **반대 면을 선호 면 재시도보다 먼저** 본다. 이 목록은 그 반대다 —
 * > 한 결정(넘침 순서)이 두 곳에 산다. 합치는 일은 그 순서를 **정하는** 일이라 J14 의 몫이다.
 */
function linkFarFaces(side: "from" | "to"): readonly PortFace[] {
  const both = AUTO_LAYOUT_LINK_OPPOSITE_FACE;
  if (side === "from") return both ? ["W", "E", "S", "N"] : ["W", "S", "N"];
  return both ? ["E", "W", "S", "N"] : ["E", "S", "N"];
}

/**
 * **좌석 창구를 연다** — 모듈 하나의 면. 좌석 단계(`tree/build.seatTree`)가 모듈마다 하나 연다.
 *
 * 장부(좌석표 · 기둥 끝 · 기둥 밖 칸)는 **이 안에만** 있다. 링크 쪽은 묻고(`ask`) 받고(`take`) 닫을 뿐이다.
 * 면 · 깊이 · 끝 · 인서터 행은 여기서 고른다 — 한 링크의 양끝은 서로의 자리를 안 보기 때문이다
 * (`docs/auto-layout/module/module-planning.md` §4.6).
 */
export function openFaceSeating(
  input: Pick<ModuleInput, "machine" | "lines" | "inserters" | "fluidTrunk" | "undergroundBelts">,
  count: number,
): FaceSeating {
  // ⓪ 유체 면 — 머신이 강제한다. 표는 면을 처음 볼 때 유체 칸을 찍어 차린다
  const fluid = fluidFacesOf(input);
  const ctx = openLinkFaceContext(input, count, fluid.pipeFaceRows);
  /** 받은 자리 — 영수증 번호 → 계획. 링크 쪽은 번호만 쥔다. */
  const plans: LinkFacePlan[] = [];
  let closed = false;
  const live = (): void => {
    if (closed) throw new Error("좌석 창구가 닫혔다 — 닫은 뒤에는 묻지도 받지도 못한다");
  };
  const receipt = (p: LinkFacePlan): SeatReceipt => {
    plans.push(p);
    return { id: plans.length - 1, face: p.face, clusterBeltDepth: p.clusterBeltDepth, portEnd: p.portEnd, exitEnd: p.exitEnd };
  };
  return {
    rowsPerMachine: ctx.machine.h,
    ask(line, side, reach, need) {
      live();
      if (reach === "near") {
        const why: DepthShortage[] = [];
        const offer = tryLinkFace(
          ctx, line, side, LINK_NEAR[side], false, why, need?.forceEnd, need?.preferEnd, need?.preferDepth, need?.mergeRole,
        );
        return { offer, why };
      }
      // 먼 자리의 사유는 **gap 출구의 거절**만 모은다(지하벨트 없음 · 기둥 끝 포트 칸) — 옆면 후보의 사유는 선호 면(near)의
      // 것이 이름표를 맡는다(사다리는 원래 앉고 싶던 면의 못으로 자른다). gap 은 거절 말고는 사유를 안 남긴다.
      const why: DepthShortage[] = [];
      for (const face of linkFarFaces(side)) {
        const offer = tryLinkFace(ctx, line, side, face, true, face === "N" || face === "S" ? why : undefined);
        if (offer) return { offer, why: [] };
      }
      return { why };
    },
    take(offer, side, o) {
      live();
      return receipt(commitLinkFace(ctx, offer, side, o));
    },
    takeShared(line, side, lead) {
      live();
      const p = seatOnSharedBelt(ctx, line, side, plans[lead.id]);
      return p && receipt(p);
    },
    close(order) {
      live();
      closed = true;
      const planOf = (r: SeatReceipt | undefined): LinkFacePlan | undefined => (r ? plans[r.id] : undefined);
      return {
        out: order.out.seats.map(planOf),
        in: order.in.seats.map(planOf),
        outWhy: order.out.why,
        inWhy: order.in.why,
        // 복사하지 않는다 — 창구가 닫혀 더는 아무도 안 쓴다. 다시 여는 쪽이 복사한다([reopenLinkFaceContext]).
        ledger: { tables: ctx.tables, ends: ctx.ends, outside: ctx.outside },
        fluid,
      };
    },
  };
}

/** 나머지 줄의 좌석 — [ModulePortPlan.restLinks] 의 모양. 그룹은 여기서 만든 것이라 함께 들고 나간다. */
export interface RestSeating {
  out: { groups: Link[]; plans: (LinkFacePlan | undefined)[]; shortages: DepthShortage[][] };
  in: { groups: Link[]; plans: (LinkFacePlan | undefined)[]; shortages: DepthShortage[][] };
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
  st: ModuleFaces,
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
