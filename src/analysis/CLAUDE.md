# analysis/ — 그리드를 읽어 성질을 낸다

방출이 끝난 **그리드**(`LayoutGrid`)만 보고 답한다. 자동 배치 결과든 손으로 놓은 것이든 같다 —
배치기의 계획(`autoLayout/`)을 믿지 않고 **그리드를 다시 읽는 것**이 이 폴더의 존재 이유다.
계획기의 셈을 계획기가 검사하면 같은 가정이 같은 답을 낸다.

| 무엇 | 어디 | 읽을 문서 |
|---|---|---|
| **흐름 · 가동률** — 정상상태로 풀어 머신마다 가동률 | `flow/` | [flow-model](../../docs/analysis/flow-model.md) — **탐침을 한 번으로 줄이자는 생각이 들면 §3 을 먼저** · 알려진 결함(*"가동률 검사 결함 #N"*)은 §7 |
| 파이프 관망 색(렌더러) | `pipeNetwork.ts` | — |
| 벨트 망 색(렌더러) — 물건이 넘어가는 벨트 · 지하벨트 · 분배기를 한 망으로(인서터는 제외) | `beltNetwork.ts` | 칸 잇기는 `flow/graph` 의 것을 빌린다 |

**그리드를 쓰지 않는다.** 입력은 `Readonly<LayoutGrid>` 이고 결과는 새 객체다.

**autoLayout 은 저울과 어댑터만 빌린다** — `shared/arith/belt` · `shared/arith/inserter`(계획기와 같은 처리량)
와 `module/gamedata.resolveFluidConnection`(유체 상자의 면을 읽는 규칙 — 두 벌이면 한쪽만 고쳐진다).
그 밖을 부르기 시작하면 검사가 계획을 믿게 된다.

**화면·콘솔은 `UI/store/flowStore.currentFlow()` 로 읽는다** — 입력 셋(그리드 · 게임데이터 · 인서터 보정)을
모으는 자리가 하나여야 같은 그리드에 두 답이 안 나온다. 화면 쪽 문서는
[flow-inspection](../../docs/UI/flow-inspection.md).
