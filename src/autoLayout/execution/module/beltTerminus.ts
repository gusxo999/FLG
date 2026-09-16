/**
 * beltTerminus — **벨트 흐름의 끝 칸은 어디를 보나.**
 *
 * 단일 출처: [docs/auto-layout/module/belt-terminus.md](../../../../docs/auto-layout/module/belt-terminus.md).
 * 게임 규칙(합류·레인·지하)은 `docs/factorio/belt-lane-semantics.md`.
 *
 * 벨트는 방향이 있어서 **끝이 없다** — 마지막 칸도 반드시 한 이웃으로 토해낸다. 그 이웃이
 * 남의 품목 벨트면 두 흐름이 하나가 된다(타일을 안 나눠 써도 합쳐진다 — 이 저장소가
 * `collectBeltFlow` 에서 이미 적어 둔 성질). 셀 겹침(occupancy)만 봐서는 **안 잡힌다.**
 *
 * ## 왜 방출기가 못 정하나 — 순서
 *
 * 끝 칸의 이웃이 비었는지는 **그 모듈의 벨트가 다 깔린 뒤에야** 알 수 있다. 방출은 링크
 * 출력 → 링크 입력 → 나머지 출력 → 나머지 입력 순인데, 깊이는 그 순서와 무관하다
 * (`d3` 줄이 먼저 깔리고 `d2` 줄이 나중에 그 옆을 지날 수 있다). 그래서 방출기는 끝 칸을
 * **기본값(머신 쪽)으로 놓고 여기 등록만** 하고, 결정은 [resolveBeltTermini] 가 전부 깔린
 * 뒤에 한 번에 한다. 결정은 벨트 칸을 **더 만들지 않으므로** 끝 칸끼리도 순서에 안 흔들린다.
 *
 * ## 규칙 (2026-09-06 사용자 확정)
 *
 * ```
 * 끝 칸이 어느 방향을 보는지는 중요하지 않다. 다만
 *   ① 다른 품목의 벨트와 합류해선 안 된다        (같은 품목은 무해 — 오염이 아니다)
 *   ② 들어온 흐름의 **역방향**이면 안 된다        (역방향이면 그 칸에 물건이 못 들어온다)
 * 세 방향이 전부 ① 에 걸리면 그 칸을 **지하벨트 입구**로 바꾼다 —
 * 짝(출구)이 없으면 터널이 안 뚫려 **완전한 종착**이 된다.
 * 지하벨트를 하나도 안 골랐으면 **흐름 그대로 두고 경고한다**(줄은 안 물린다).
 * ```
 *
 * 후보가 셋인 이유가 ② 다: 네 방향에서 역방향 하나를 뺀 것이고, 남은 셋은
 * `{ 머신 쪽 · 바깥 쪽 · 흐름 그대로 }` 다.
 *
 * **순서는 「빈 칸 → 같은 품목 → 종착」이다.** 같은 품목이라 합류가 허용된다고 해서 그것을
 * *고를* 이유는 없다 — 오염은 아니어도 **장부는 거짓이 된다**(내 줄의 물건이 남의 줄로
 * 간다. `emitOutputLinks` 의 끝 칸 주석이 같은 것을 말한다).
 *
 * ## 왜 이 문제가 이제 생겼나 — 긴팔
 *
 * 옛 주석은 *"끝 칸은 머신 쪽으로 꺾는다. 그 칸은 이 그룹 자신의 좌석이라 언제나 안전하다"*
 * 라고 적고 있었다. **`d2` 에서만 참이다** — 좌석은 `d1` 이므로 벨트가 `d2` 면 머신 쪽이
 * 곧 자기 좌석이다. 긴팔(reach 2)이 열려 벨트가 `d3` 에 앉으면 머신 쪽은 `d2` 이고,
 * 거기엔 **다른 줄의 벨트가 지나갈 수 있다**(면 장부는 자기 깊이만 청구한다 — `faceTable`).
 * 2026-09-06 실측: `y`(d3) 의 끝 칸이 `x`(d2) 의 벨트로 흘러들었다.
 *
 * ## 못 피하면 **합류한 채로 남긴다 — 대신 화면에 뜬다**
 *
 * 지하벨트를 하나도 안 골랐으면 세울 종착이 없다. 그때는 **흐름 그대로**(들어온 방향)
 * 두고 [BeltMerge] 로 올린다 — [run/policy](../../planner/run/policy.ts) 가 그것을
 * `belt-terminus-merge` **경고**로 빚어 그 칸을 화면에 찍는다.
 *
 * **줄을 포기하지 않는 이유:** 이 실패는 그 칸 하나의 문제이고 처방이 한 단계 뒤로
 * 돌아가는 것뿐이다(벨트 단계에서 지하벨트를 하나 고른다). 배치를 통째로 물리면 사용자는
 * *"무엇을 고르면 되는지"* 를 보기도 전에 결과를 잃는다. **삼키는 것이 아니다** —
 * 경고와 좌표가 같이 나가고, `flg.report()` 의 `벨트끝` 줄이 수를 센다.
 *
 * ## 지하 종착의 사거리는 **장부에 오른다**
 *
 * 짝 없는 입구도 사거리 안에 남의 출구가 서면 **그 순간 터널이 뚫린다.** 그래서 그 구간을
 * 지하벨트 장부(`UndergroundCorridor`)에 올려야 한다. 여기서 만들지 않고
 * [run/ledger](../../planner/run/ledger.ts) 가 **놓인 셀에서 되읽는다** — 사거리는
 * 게임데이터(`max_underground_distance`)에 있고, 모듈은 회전·평행이동을 거쳐 절대 좌표가
 * 되므로 구간을 여기서 만들면 그 변환을 따라가야 한다. 셀에서 되읽으면 위치·방향·이름이
 * 이미 변환된 뒤라 **되읽기가 곧 정답**이다(추정이 아니다 — 모듈 안에 지하벨트를 놓는
 * 코드는 여기뿐이다).
 */

import type { SpecUndergroundBelt } from "../../shared/gamedata/spec";
import { cellKey, vectorToDirection } from "../../shared/grid";
import { makeUndergroundBeltCell } from "../../shared/cells/builder";
import { recordBeltTerminus } from "../../../debug/runStats";
import type { BeltMerge, BeltTerminus } from "../../module/types/module";

/**
 * **가장 느린 지하벨트** — 종착은 아무것도 나르지 않으므로 빠른 티어를 태울 이유가 없다.
 *
 * 목록의 정렬을 믿지 않는다([inserterForReach] 와 같은 이유) — 거르지 않은 목록을 받았을 때
 * 조용히 비싼 답을 내면, 그 선택이 **어디서 정해졌는지** 를 아무도 못 찾는다.
 */
export function slowestUnderground(
  belts: ReadonlyArray<SpecUndergroundBelt> | undefined,
): SpecUndergroundBelt | undefined {
  let best: SpecUndergroundBelt | undefined;
  for (const b of belts ?? []) {
    if (b.maxDistance <= 0) continue; // 사거리를 모르면 장부에 적을 값이 없다
    if (!best || b.throughput < best.throughput) best = b;
  }
  return best;
}

/**
 * 등록된 끝 칸들을 **한 번에** 마무리한다(모듈의 벨트가 전부 깔린 뒤에 부른다).
 *
 * 못 피한 칸은 `merges` 로 나간다 — **삼키지 않되 줄을 물리지도 않는다**(위 머리말 §못 피하면).
 */
export function resolveBeltTermini(o: {
  termini: readonly BeltTerminus[];
  /** 이 모듈이 깐 **모든** 벨트류 칸 → 그 칸이 나르는 품목(`cellKey` → 품목). */
  beltItems: ReadonlyMap<string, string>;
  undergroundBelts?: ReadonlyArray<SpecUndergroundBelt>;
  /** 못 피한 끝 칸이 여기 쌓인다(호출자가 [GeneratedModule] 로 실어 올린다). */
  merges: BeltMerge[];
}): void {
  const terminusBelt = slowestUnderground(o.undergroundBelts);
  for (const t of o.termini) {
    // 후보 셋 = 네 방향 − 역방향. 순서가 곧 선호다(오늘의 기본값이 맨 앞 → 회귀 0).
    const candidates = [t.inward, { x: -t.inward.x, y: -t.inward.y }, t.flow];
    const itemAt = (v: { x: number; y: number }): string | undefined =>
      o.beltItems.get(cellKey(t.cell.x + v.x, t.cell.y + v.y));
    // ① 벨트가 아예 없는 방향 → ② 같은 품목(합류해도 오염은 아니다).
    const pick =
      candidates.find((v) => itemAt(v) === undefined) ??
      candidates.find((v) => itemAt(v) === t.item);
    if (pick) {
      const dir = vectorToDirection(pick.x, pick.y);
      recordBeltTerminus(dir === t.cell.cell.direction ? "kept" : "turned");
      t.cell.cell.direction = dir;
      continue;
    }
    if (!terminusBelt) {
      // **흐름 그대로 두고 경고한다** — 세울 종착이 없다. 방향을 흐름으로 못박는 이유는
      // 그것이 *"이전 흐름과 같은"* 값이라 그 칸에 물건이 들어오긴 하기 때문이다(규칙 ②).
      recordBeltTerminus("merged");
      t.cell.cell.direction = vectorToDirection(t.flow.x, t.flow.y);
      o.merges.push({
        x: t.cell.x, y: t.cell.y, item: t.item,
        into: itemAt(t.flow) ?? t.item,
      });
      continue;
    }
    recordBeltTerminus("underground");
    // 입구는 **뒤에서** 받는다 — 흐름 방향을 그대로 보게 해야 앞 칸이 등을 밀어 넣는다.
    const built = makeUndergroundBeltCell(
      { x: t.cell.x, y: t.cell.y },
      vectorToDirection(t.flow.x, t.flow.y),
      "input",
      terminusBelt.entityName,
      t.pair,
    );
    // 제자리 교체 — 위 [BeltTerminus.cell] 주석의 이유로 **객체 신원을 지킨다.**
    Object.assign(t.cell.cell, built.cell);
  }
}
