/**
 * **테스트 픽스처에 저울을 달아 주는 곳** (테스트 전용 — `.test.ts` 가 아니라 수집 대상이 아니다).
 *
 * ## 왜 있나
 * 2026-08-24 까지 모듈 테스트 픽스처 다수가 *"이름은 있는데 저울이 없는"* 입력이었다 —
 * 벨트 이름만 있고 운반량이 없거나, 인서터 `throughput: 0`, 줄에 `lineRates` 없음. 그래도
 * 통과한 이유는 `makeLink` 폴백이 **팔 1개짜리 가짜 줄**을 지어내 구멍을 덮었기 때문이다.
 * 폴백을 지우자 그 픽스처들이 한꺼번에 무너졌는데, 무너진 건 검사의 **의도**가 아니라
 * **입력**이었다.
 *
 * 그래서 저울을 한 곳에서 단다. 사장님 규칙: **"벨트가 존재할 때 운반량도 같이 존재해야
 * 정상"** — 이름과 저울은 함께 온다.
 *
 * ## 고른 수의 근거
 * - 팔 하나 `0.83/s` — 바닐라 일반 인서터.
 * - 벨트 한 줄 `15/s` — 바닐라 노랑 벨트.
 * - 머신 한 대 몫 `0.25/s` — 팔 하나 안에 들어가고(줄마다 인서터 1개), 웬만한 머신 수를
 *   곱해도 벨트 한 줄 안에 든다(줄 수가 1로 고정). 그래야 기하 검사가 **줄 수에 안 흔들린다.**
 */
import type { ModuleInput } from "./types/module";

/** 머신 한 대가 한 줄에서 주고받는 초당 개수 — 팔 하나(0.83/s) 안에 든다. */
export const PER_MACHINE = 0.25;
/** 바닐라 일반 인서터. */
export const ARM_THROUGHPUT = 0.83;
/** 바닐라 노랑 벨트. */
export const BELT_THROUGHPUT = 15;

/**
 * 픽스처에 벨트 티어·팔 처리량·줄 rate 를 채운다. **이미 있는 값은 안 건드린다** — 검사가
 * 일부러 준 수치(고수요·저용량)를 덮으면 그 검사가 뜻을 잃는다.
 *
 * 줄을 더하거나 갈아끼운 픽스처는 `supplyCapacity: undefined` 를 함께 넘겨 **다시 달게**
 * 한다 — 안 그러면 새 줄만 저울이 없어 안 깔린다.
 */
export const scaled = (input: ModuleInput): ModuleInput => ({
  ...input,
  inserters: input.inserters?.map((i) => ({ ...i, throughput: i.throughput || ARM_THROUGHPUT })),
  belts: input.belts ?? [{ entityName: input.beltEntityName, throughput: BELT_THROUGHPUT }],
  supplyCapacity: input.supplyCapacity ?? {
    beltCapacity: BELT_THROUGHPUT,
    lineRates: new Map(
      input.lines.map((l) => [`${l.role}:${l.name}`, PER_MACHINE * Math.max(1, input.count)]),
    ),
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// 트리 픽스처 — `packModuleTree` 를 쓰는 검사들
// ─────────────────────────────────────────────────────────────────────────────

/**
 * `PackConfig` 에 저울을 채운다 — 팔 처리량과 벨트 티어. `ModuleInput` 쪽 [scaled] 의 거울.
 */
export const scaledPack = <T extends {
  inserterEntityName: string;
  beltEntityName: string;
  inserters: { entityName: string; reach: number; throughput: number }[];
  belts?: { entityName: string; throughput: number }[];
}>(config: T): T => ({
  ...config,
  inserters: config.inserters.map((i) => ({ ...i, throughput: i.throughput || ARM_THROUGHPUT })),
  belts: config.belts ?? [{ entityName: config.beltEntityName, throughput: BELT_THROUGHPUT }],
});

/**
 * 노드마다 `supplyCapacity.lineRates` 를 채운다 — **간선 양끝이 같은 수**가 되도록.
 *
 * 자식의 산출 rate 와 부모의 수요 rate 가 어긋나면 부모 머신 일부에 그 줄이 안 닿아
 * *"머신마다 인서터 하나"* 류의 불변이 깨진다(2026-08-24 실측). 그래서 간선 줄은 **부모의
 * 수요**(`PER_MACHINE × 부모 대수`)를 양끝이 함께 본다. 나머지(원료·완제품)는 자기 대수다.
 *
 * 자식 쪽 머신 한 대의 몫은 `PER_MACHINE × 부모수 / 자식수` 라, 대수 비가 3배를 넘지 않는
 * 픽스처에서 팔 하나(0.83/s) 안에 든다.
 */
export const scaledSpecs = <T extends {
  id: string;
  parentId?: string;
  count: number;
  lines: { name: string; kind: string; role: "input" | "output" }[];
  supplyCapacity?: { beltCapacity?: number; lineRates?: Map<string, number> };
}>(specs: T[]): T[] => {
  const byId = new Map(specs.map((s) => [s.id, s]));
  /** 품목 → 그 품목을 자식이 대는 간선의 rate(= 부모의 수요). */
  const edgeRate = new Map<string, number>();
  for (const s of specs) {
    const parent = s.parentId ? byId.get(s.parentId) : undefined;
    if (!parent) continue;
    for (const l of s.lines) {
      if (l.role === "output") edgeRate.set(l.name, PER_MACHINE * Math.max(1, parent.count));
    }
  }
  return specs.map((s) => ({
    ...s,
    supplyCapacity: s.supplyCapacity ?? {
      beltCapacity: BELT_THROUGHPUT,
      lineRates: new Map(
        s.lines.map((l) => [
          `${l.role}:${l.name}`,
          edgeRate.get(l.name) ?? PER_MACHINE * Math.max(1, s.count),
        ]),
      ),
    },
  }));
};
