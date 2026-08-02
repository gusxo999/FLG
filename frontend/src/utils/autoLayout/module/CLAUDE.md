# module/ — 한 모듈 안쪽

**판정 한 줄: 이 폴더의 코드는 형제 모듈을 모른다.** 부모도 자식도 안 본다 —
모듈은 자기 ring 위에 입·출력 포트를 갖는 **불투명 블록**이고, 모듈끼리 잇는 일은
`planner/` 소관이다.

## 자리 배정은 여기서 안 한다

`generateModule` 은 계획 함수를 **하나만** 부른다:

```
planner/module/planModulePorts(input, count)   ← 좌표 없는 계획 전부
  ① 링크 면 배정  ② 유체 줄 조립  ③ 나머지 줄 배정  ④ gap 폭
        ↓
layoutCluster(plan.rowGaps) → 머신 좌표 생성
placeLinkSeats(machines, plan.linkFaces)       ← 덧셈뿐
emit*(...)                                      ← execution/module/emitModule
```

**이 순서는 바꿀 수 없다.** gap 으로 넘어간 링크는 gap 안에 가로 벨트를 놓고,
*gap 폭 = 그 gap 을 지나는 가로 벨트 수*인데, 그 폭이 다시 머신 좌표를 정한다.
그래서 **면 배정이 좌표보다 먼저**다(닭과 달걀을 푸는 지점).

## 링크를 어디까지 아나 — 경계가 좁다

| 아는 것 | 모르는 것 |
|---|---|
| `MachineLinkGroup.from`/`to` = **로컬 머신 index → 팔 수** | 형제 모듈의 대수·좌표·모양 |
| `group.id`(`linkId`) — **불투명 토큰**. 복사만 하고 파싱하지 않는다 | 그 토큰이 어느 부모를 가리키는지 |

`linkId` 를 만드는 곳은 `planner/modulePacking.linkGroupId` **한 곳뿐**이고,
여기서는 `ModulePort.linkId` 로 그대로 흘려보낸다. **파싱하는 코드가 0 인 것이
모듈-링크 분리의 실질**이다 — 파싱하는 순간 모듈이 형제를 알게 된다.

## 아직 어긋난 것 두 개

| 파일 | 문제 |
|---|---|
| `clusterPortPlanner.ts` (796줄) | **계획인데 여기 있다** — `PlacedCell` 0개. `planner/module/` 이 맞다 |
| `clusterModule.ts` 다이렉트 인서팅 방출 (~120줄) | **셀을 만든다** — `module/` 에서 셀을 만드는 유일한 곳. `execution/module/` 이 맞다 |

자세한 것은 [docs/code-folders.md](../../../../../docs/code-folders.md) 의
"아직 두 축과 어긋나 있는 것".

## 게임데이터를 안 본다

`module/` 은 순수하다 — store 를 안 본다. 유체 면·머신 회전처럼 prototype 이 정하는 값은
**호출자가 계산해 `ModuleInput.fluidTrunk` 로 넘긴다**(계산은 `fluidPorts.chooseMachineDirection`).
