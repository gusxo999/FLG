# planner/ — 배치 계획

**여기 있는 것은 아무것도 놓지 않는다.** `PlacedCell` 을 만들면 `execution/` 이다.

## `planner` 는 "모듈 사이"가 아니다

옛 `docs/code-folders.md` 가 그렇게 정의했으나 **사실이 아니다**(2026-08-02 정정).
`planner` 는 **상위 조율 주체**이고, `module`·`link`·`channel`·`perimeter` 가 그 안의
관심사다. **모듈 *사이*만 조율하는 역할은 `link/` 가 맡는다.**

이유는 예약 철학이다 — *"큰 그림을 보는 주체 **하나**가 자리를 먼저 잡고, 뒤 단계는
탐색 없이 놓기만 한다."* 주체가 둘로 갈리면 *"무관한 판정이 이미 끝난 예약을 삼키는"*
버그가 난다(2026-07-21 실측).

## 하위 폴더 = 관심사

| 폴더 | 판정 | 내용 |
|---|---|---|
| `module/` | **형제 모듈을 모른다** | `planModulePorts`(모듈 안쪽 계획 단일 진입점) · `linkPlanner` |
| `link/` | 두 모듈의 **식별자**를 안다 | `allocateMachineLinks` — 어느 기계 쌍을 몇 벨트로 |
| `perimeter/` | **전역 외곽**을 안다 | `wayOuts` |
| (평면) | 조율·통로 | `moduleWizard`(진입점) · `modulePacking` · `channel*` · `perimeter*Planner` · `moduleHop` |

## 새 파일을 여기 둘지 판정

1. `PlacedCell` 을 만드나? → 만들면 `execution/`
2. 형제 모듈을 아나? → 모르면 `module/`, 알면 `link/`
3. 여러 연결이 공유하는 자원인가? → `channel`
4. 전역 외곽을 아나? → `perimeter/`

## 실패는 삼키지 않는다

자리가 없으면 **만들어 내지 말고** 정직하게 실패시킨다. 실패 사유는
`moduleWizard.RejectReason` 이 단일 출처이고, 그 문구가 UI 실패 라벨로 그대로 나간다.

## 아직 어긋난 것

`module/clusterPortPlanner.ts`(796줄)는 계획인데 `module/` 에 있다 —
여기 두 파일이 **역방향으로** 그것을 import 한다. 자세한 것은
[docs/code-folders.md](../../../../../docs/code-folders.md) 의 "아직 두 축과 어긋나 있는 것".
