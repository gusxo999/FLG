# module/ — 한 모듈 안쪽

**판정 한 줄: 이 폴더의 코드는 형제 모듈을 모른다.** 부모도 자식도 안 본다 —
모듈은 자기 ring 위에 입·출력 포트를 갖는 **불투명 블록**이고, 모듈끼리 잇는 일은
`planner/` 소관이다.

## 타입은 `types/` 에, 셈은 `arith.ts` 에

계획(`planner/module`)·조율(`clusterModule`)·방출(`execution/module`)이 **함께 읽는** 타입은
`types/` 세 파일에 산다 — 가르는 기준은 읽는 사람의 질문이다.

```
types/line.ts     무엇을 나르나      IoLine · PlannedLine · SupplyCapacity · Link
types/seat.ts     어디에 앉나        LinkFacePlan · LinkSeats · DepthShortage · LinkFaceStage
types/module.ts   무엇을 받고 내나   ModuleInput · GeneratedModule · ModulePort · TrunkContext · BeltTerminus
arith.ts          셈                 trunkEndKey · flowEnd
```

**함수의 서명에만 쓰이는 타입은 옮기지 않는다**(`ModulePortPlan`·`EdgeSeatResult`·`LadderRung` 은
`planner/module` 제자리). 여러 층이 함께 읽을 때만 여기로 온다. 여기 두는 이유는 하나다 —
타입이 계획 계층에 있으면 방출기가 그걸 가지러 **위로** 올라가고, 값까지 얹혀 있으면 순환이 된다
(2026-09-13 전까지 `emitModule → clusterModule` 이 `trunkEndKey` 하나 때문에 런타임 간선이었다).

**남은 상향 간선은 알고 둔 것이다:** `types/seat.ts → planner/module/faceTable`(타입 — 좌석표는
장부째 옮긴다) · `clusterModule → planner/module/planModulePorts`(계획을 부른다) · `clusterModule → execution/module`
(방출을 부른다 — 둘 다 조율자가 이 폴더에 있어서다) · `clusterModule` · `moduleTransform → planner/perimeter/wayOuts`
(모듈이 자기 몸통에 대해 답하는 함수가 반출 쪽에 있다 — work-kinds §1).
조율자를 `planner/module/` 로 옮기지 않은 이유(2026-09-14): 옮겨서 얻는 것이 경로 문자열뿐이고, 폴더 이관이
계층 축을 없애면 이 간선들은 폴더 안 간선이 된다. 대신 **조율자가 조율만** 하게 했다 — 도형은 `shape`, 트렁크 틀은 `policy`.

## 자리 배정은 여기서 안 한다

`generateModule` 은 계획 함수를 **하나만** 부른다. 뼈대는 순서만 쥔다:

```
① planner/module/planModulePorts(input, count)   ← 좌표 없는 계획 전부 (순서만 쥐는 뼈대)
     고르기 = policy · linkPlanner   묻고 적기 = ledger   세기 = arith
        ↓
② shape.layoutModule(plan.rowGaps)              ← 머신 좌표가 여기서 생긴다
③ openModuleSheet                               ← 점유 = 머신 발자국
④ layLinkLines   shape.placeLinkSeats(덧셈뿐) → emitOutputLinks · emitInputLinks
⑤ 판정 받기      못 부은 줄 · 나머지 줄 실패(조기 반환)
⑥ layRestLines   같은 방출기
⑦ layFluidLines  policy.buildTrunkContext → emitTrunkPipe
⑧ finishModule   끝 칸 방향(늦은 결정) · wayOuts
```

**파일 = 종류**: `shape`(머신 좌표 위의 도형 — 방출기도 틀과 길을 여기서 받는다) · `policy`(트렁크 틀) ·
`linkShape`(순번 축의 도형 — 계획과 방출이 함께 부른다) · `clusterModule`(조율).

**이 순서는 바꿀 수 없다.** gap 으로 넘어간 링크는 gap 안에 가로 벨트를 놓고,
*gap 폭 = 그 gap 을 지나는 가로 벨트 수*인데, 그 폭이 다시 머신 좌표를 정한다.
그래서 **면 배정이 좌표보다 먼저**다(닭과 달걀을 푸는 지점).

## 링크를 어디까지 아나 — 경계가 좁다

| 아는 것 | 모르는 것 |
|---|---|
| `Link.from`/`to` = **로컬 머신 index → 팔 수** | 형제 모듈의 대수·좌표·모양 |
| `group.id`(`linkId`) — **불투명 토큰**. 복사만 하고 파싱하지 않는다 | 그 토큰이 어느 부모를 가리키는지 |

`linkId` 를 만드는 곳은 `planner/modulePacking.makeLinkId` **한 곳뿐**이고,
여기서는 `ModulePort.linkId` 로 그대로 흘려보낸다. **파싱하는 코드가 0 인 것이
모듈-링크 분리의 실질**이다 — 파싱하는 순간 모듈이 형제를 알게 된다.

## 이 폴더는 셀을 만들지 않는다

`makeContainerCell`·`makeInserterCell` 을 부르는 코드가 **0 이다**. 방출은 전부
`execution/module/emitModule` 소관이다.

**방출기는 이제 링크·원료를 안 가린다**(2026-08-05 공급 모델 통합): 탭이 깨지면 그 줄들도
머신마다 쪼개져 `emitOutputLinks`/`emitInputLinks` 를 탄다. 전용 방출기였던
`emitDirectInserting` 은 호출자가 0이 되어 삭제됐다. → `docs/auto-layout/link/machine-link.md`
여기서 셀을 만들고 싶어지면 계층이 새는 것이다.

## 읽을 문서

`docs/auto-layout/module/` 이 이 폴더의 거울이다 — [trunk-redesign](../../../docs/auto-layout/module/trunk-redesign.md)
(탭 인서팅) · [trunk-pipe](../../../docs/auto-layout/module/trunk-pipe.md)(유체) ·
[ns-face-relief](../../../docs/auto-layout/module/ns-face-relief.md)(N/S 면 슬롯).

## 게임데이터를 안 본다

`module/` 은 순수하다 — store 를 안 본다(검사: `rg "UI/store" src/autoLayout/module -g '*.ts' -g '!*.test.ts'` → 0). 게임데이터 **타입**은
`src/types/gameData.ts` 에서 온다. 유체 면·머신 회전처럼 prototype 이 정하는 값은
**호출자가 계산해 `ModuleInput.fluidTrunk` 로 넘긴다**(계산은 `fluidPorts.chooseFluidTrunkPlan` — 회전 하나 + 유체 줄 N개).
