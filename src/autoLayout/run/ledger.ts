/**
 * **실행의 장부** — 납품 경로가 깔리기 **전에** 알아야 할 두 사실을 적는다.
 *
 * ```
 * fluidNetworksOf       다른 유체 관망이 먹은 칸 — 납품 파이프가 **피할** 곳
 * terminusCorridorsOf   모듈이 세운 지하벨트의 구간 — 종착의 사거리 · 지하 횡단의 [입구, 출구] — 남이 **이미 잡은** 구간
 * ```
 *
 * 게임데이터는 안 본다 — 유체 머신과 사거리는 [gamedata](../module/gamedata.ts) 가 옮겨 준 값을 받는다.
 *
 * > **내력.** `run/build/module.ts` 의 `runModulePipeline` 안(1b · 1c)에 있었다. 2026-09-14 옮겼다
 * > (계획 구조-2축 · 2 Step 2b). 본문은 옮기기만 했다.
 */

import { EntityType } from "../../types/layout";
import type { UndergroundCorridor } from "../shared/types";
import type { RecipeTreeNode } from "../tree/types/recipe";
import { collectPipeFlow, type PipeFlow, type PipeFlowMachine, type PipeFlowPipe } from "../shared/pipeFlow";
import type { PackResult } from "../tree/types/pack";
import { directionToVector } from "../shared/route";
import { corridorBetween } from "../shared/cells/path";

/**
 * **[파이프 합류 가드](../shared/pipeFlow.ts)의 지도** — 파이프는 **방향이 없어서** 직교로 닿기만
 * 하면 두 관망이 하나가 된다. 다른 유체끼리 이어지면 오염되고, 남의 머신
 * **유체 출력 상자**에 스치면 그 머신의 생산물이 내 관망으로 **조용히 샌다** — 화면상으론 멀쩡하고
 * 라우팅도 "성공"이라 보고한다. 그래서 파이프를 깔기 전에 금지 칸 지도를 만들어 둔다.
 * 유체마다 지도가 다르다 — **같은 유체는 닿아도 무해**하기 때문이다(처리량 무한).
 *
 * **유체는 모듈이 아니라 셀마다 다르다.** 예전엔 "이 배치의 파이프 셀 = 그 모듈의 유일
 * 유체" 로 태깅했는데, 모듈이 유체를 둘 다루는 순간 자기 파이프를 남의 유체로 오인해
 * 오염을 못 잡거나 자기 자신을 거절한다. 그래서 **방출기가 놓으면서 적어 둔**
 * [GeneratedModule.pipeCells] 를 읽는다.
 *
 * 유체가 없는 트리면 빈 Map 이다. 유체 순서는 **트리 순서**(`order`)다 — 뒤 단계가 이 Map 을 순회한다.
 */
export function fluidNetworksOf(
  pack: PackResult,
  order: readonly RecipeTreeNode[],
  fluidsOf: ReadonlyMap<RecipeTreeNode, string[]>,
  machines: PipeFlowMachine[],
): Map<string, PipeFlow> {
  const allFluids = new Set<string>();
  for (const node of order) for (const f of fluidsOf.get(node) ?? []) allFluids.add(f);
  const pipeFlowByFluid = new Map<string, PipeFlow>();
  if (allFluids.size > 0) {
    // 이미 놓인 파이프류 셀 — 모듈의 트렁크/ClusterPipe + 포트 무한파이프 + 지하파이프 **끝**
    // (fluidboxPipeCell·ClusterPipeTapCell — 끝 칸은 표면에 노출돼 접촉 합류가 생긴다.
    // 지하 통과 구간은 타일을 점유하지 않으므로 안 센다). 그 모듈의 유체를 나른다.
    const pipes: PipeFlowPipe[] = [];
    for (const pl of pack.placements) pipes.push(...pl.module.pipeCells);
    for (const fluid of allFluids)
      pipeFlowByFluid.set(fluid, collectPipeFlow({ fluidName: fluid, pipes, machines }));
  }
  return pipeFlowByFluid;
}

/**
 * 유체 납품 경로(pipe-to-pipe)가 **다른 유체**에 안 닿게 할 금지 칸 — 합류 가드가 낸 유체별
 * hard 지도를 그대로 넘긴다(같은 유체는 안 막아 공유 허용). 아이템 트리면 비어 있다.
 */
export function fluidBlockedOf(pipeFlowByFluid: ReadonlyMap<string, PipeFlow>): Map<string, ReadonlySet<string>> {
  const fluidBlocked = new Map<string, ReadonlySet<string>>();
  for (const [fluid, pf] of pipeFlowByFluid) fluidBlocked.set(fluid, pf.blockedTilesHard);
  return fluidBlocked;
}

/**
 * **모듈이 세운 지하벨트의 구간** — 지하벨트 장부에 올린다
 * ([resolveBeltTermini](../module/late.ts) 머리말 §사거리).
 *
 * 모듈 안에 지하벨트가 서는 자리는 둘이다 — **종착**(짝 없는 입구)과 **지하 횡단**(입구 · 출구 짝,
 * `docs/auto-layout/module/trunk-blocked.md` §4). 입구마다 흐름 방향 사거리 안에서 같은 이름의 지하를 찾는다:
 *
 * ```
 * 처음 만난 것이 같은 방향의 출구   지하 횡단 — [입구, 출구] 만 잡는다
 * 없거나 입구다                   종착 — 입구에서 사거리 끝까지 잡는다(그 안에 남의 출구가 서면 터널이 뚫린다)
 * ```
 *
 * 예전엔 *"모듈 셀 중 지하벨트 입구가 곧 종착"* 이었다(놓는 코드가 종착 하나뿐이었다). 지하 횡단이 들어오며 그 전제가
 * 깨졌다 — 그대로 두면 지하 횡단 입구마다 사거리 끝까지 **과잉 예약**된다.
 *
 * **셀에서 되읽는다**(모듈이 따로 실어 보내지 않는다): 위치·방향·이름은 회전·평행이동을 이미 거친 **절대 좌표**다.
 * 사거리만 게임데이터에서 붙이면 된다 — 구간을 모듈 안에서 만들면 그 변환을 따로 따라가야 한다.
 */
export function terminusCorridorsOf(
  pack: PackResult,
  distanceOf: (entityName: string) => number,
): UndergroundCorridor[] {
  const terminusCorridors: UndergroundCorridor[] = [];
  for (const pl of pack.placements) {
    /** 이 모듈의 지하벨트 칸 — 짝을 찾는다. */
    const under = new Map<string, (typeof pl.module.cells)[number]>();
    for (const c of pl.module.cells)
      if (c.cell.entityType === EntityType.UndergroundBelt) under.set(`${c.x},${c.y}`, c);
    for (const c of pl.module.cells) {
      if (c.cell.entityType !== EntityType.UndergroundBelt) continue;
      if (c.cell.undergroundType !== "input") continue;
      const entityName = c.cell.entityName;
      if (!entityName) continue;
      const dist = distanceOf(entityName);
      const v = directionToVector(c.cell.direction);
      if (dist <= 0 || (v.x === 0 && v.y === 0)) continue; // 사거리를 모르면 지어내지 않는다
      // 지하 횡단의 짝 — 흐름 방향 사거리 안에서 처음 만난 같은 이름의 지하가 같은 방향의 출구면 그것이다
      let reach = dist;
      for (let k = 1; k <= dist; k++) {
        const u = under.get(`${c.x + v.x * k},${c.y + v.y * k}`);
        if (!u || u.cell.entityName !== entityName) continue;
        if (u.cell.undergroundType === "output" && u.cell.direction === c.cell.direction) reach = k;
        break;
      }
      terminusCorridors.push(
        corridorBetween(
          { x: c.x, y: c.y },
          { x: c.x + v.x * reach, y: c.y + v.y * reach },
          "belt",
          entityName, // blockGroup = 그 티어 — 다른 티어와는 애초에 안 맺힌다
        ),
      );
    }
  }
  return terminusCorridors;
}
