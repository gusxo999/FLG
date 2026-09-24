# shared/ — 관심사가 없는 것

**여기 있는 것은 위를 모른다.** `module` · `link` · `channel` · `perimeter` · `tree` · `run` 중
어느 것도 import 하지 않는 것이 이 폴더의 정의다. 도구로 강제하지 않는다(2026-09-23 — 검사는
[code-folders](../../../docs/auto-layout/common/code-folders.md) 의 `rg` ③).

```
types.ts    Container · Port · PlacedCell · Area                    issue.ts   LayoutIssue
grid.ts     격자 위의 셈 — 아무것도 놓지 않는다          frames.ts  레이아웃 좌표 → 그리드 좌표의 문
arith/      벨트 · 인서터 처리량                        cells/     찍기 — builder · path · place
gamedata/   어댑터 — BuildSpec                          flags.ts   디버그 플래그
route.ts ⚠  탐색                                        pipeFlow.ts ⚠ 파이프 합류 가드
```

## ⚠ 알고 둔 자리 둘 — 고치기 전에 읽는다

**`route.ts` 는 종류가 안 갈린다.** `dijkstraWithJumps` 는 장부(occupancy)를 읽어 정책(비용)으로
도형(경로)을 고른다 — 셋이 한 함수라야 성립한다. 가르지 않고 **표시만** 한 자리다
([work-kinds §6](../../../docs/auto-layout/common/work-kinds.md)). 저장소에 남은 유일한 탐색이고,
런타임 소비처는 납품 사다리의 탐색 칸(`link/policy/delivery.routeOneDelivery`) 하나뿐이다.

**`pipeFlow.ts` 는 이 폴더의 유일한 위반이다.** `module/gamedata.fluidPortSlots` 를 런타임으로
부른다. 고치는 길은 이미 적혀 있다 — 그 함수는 prototype 해석(**어댑터**)이라 `shared/gamedata/`
소속이고, `module/gamedata.ts` 를 어댑터와 정책으로 가르면 이 줄은 `shared → shared` 가 된다
([code-folders](../../../docs/auto-layout/common/code-folders.md) §자리를 정한 근거). **`pipeFlow` 를 `module/` 로 옮겨서 푸는 것이 아니다** — 유체 가드를 보는 곳이
모듈 · 납품 · 반출 셋이다.

## 찍기가 왜 여기 있나

`cells/` 의 셋(`builder` · `path` · `place`)은 **생성자 라이브러리**다 — 만들 뿐 **자리를 고르지
않는다.** 부르는 쪽이 이미 정해진 좌표를 넘긴다. 여기서 *"어디에 놓을까"* 를 묻기 시작하면
그 코드는 관심사 폴더의 `policy` 로 가야 한다.
