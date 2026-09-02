> 상태: **완료** (2026-09-03). 옛 `트렁크벨트-경로모델` 과 `간선-배정` 을 **합친 것**이다.
>
> 한 문장이 이뤄졌다 — **나머지 줄의 `g` 를 줄마다, 상한과 1 사이에서** 정한다
> (`planner/module/laneBudget.ts` 의 `planBundles`). 붓기 앞에서 수만으로 정해지고
> 되먹임이 없다. 딸려 나온 것: 지도 A(`planClusterPorts`·`insertingPlanner`) 삭제.
>
> **넘긴 것 셋은 계획서 §3.1** — 링크의 `g`(J13) · 포트막힘(사다리 2단) · ㉮ 포트 방향.
> 셋 다 `g` 가 아니라 **자리**의 물음이라 여기서 안 푼다.

# 부분-트렁크 — 공통 컨텍스트

**한 문장:** 한 벨트 줄이 맡는 머신 수 `g` 를 **줄마다, 상한과 1 사이에서** 정하게 한다.

## 왜 두 계획을 합쳤나

옛 둘은 **유사한 계획이 아니라 같은 것의 두 면**이었다:

```
트렁크벨트-경로모델   **모델** — 무엇이 옳은 기하인가
간선-배정             **구조** — 누가 언제 정하나
```

모델은 구조 없이 못 살고 구조는 모델 없이 못 산다. 그래서 하나를 깊이 파면 반드시 다른
하나를 건드리게 됐다. **진짜 원인은 모델이 계획서 안에 갇혀 있던 것**이다 — 참조하려면
그 계획서를 열어야 했다.

**그래서 갈라서 옮겼다:**

```
모델(사실)  →  docs/auto-layout/module/trunk-assignment.md
할 일(계획) →  이 폴더
```

## 착수 전 반드시 읽을 것

- **`docs/auto-layout/module/trunk-assignment.md`** — 배정 모델 본문.
  특히 **§0 구현 상태**(모델이 코드보다 앞서 있다) · §2 수요(`k`·`g`·`c`) · §3 배정 여섯 단계
- `docs/auto-layout/module/module-planning.md` §4.5(면 좌석표) · §4.6(포트 위치를 정하는 것 전부)
- `docs/auto-layout/link/machine-link.md` — 링크 쪽 기하 · *무엇을 재나*
- 코드: `planner/module/laneBudget.ts`(`planBundles` — **`g` 를 정하는 곳**) ·
  `module/link.ts`(`createLinks` 붓기 · `externalLineGroups` · `bundleCap`) ·
  `planner/module/linkPlanner.ts`(`tryLinkFace` — **아직 앉혀 보는** 면·레인. ⑤-3 의 대상) ·
  `planner/module/planModulePorts.ts`(셋을 엮는 곳)

> **`clusterPortPlanner.ts` 는 없다** — 2026-09-02 에 지도 A 와 함께 지워지고, 남은 낱말·산술이
> `ioLine.ts` · `allocateArms.ts` 로 갈렸다. `supply` 도 없다.

## 이 계획이 **하지 않는** 것

- **fan-out**(한 머신에 벨트 여럿) — `allocateFlows` 가 줄 나기 전에 정한다
- **되먹임** — 이미 0이다(`gen` 1회). 새로 만들지만 않으면 된다
- **채널·납품 경로 알고리즘**
- ~~`insertingPlanner` 통합~~ — 통합이 아니라 **삭제**로 끝났다(2026-09-02 `22bf95e`)

## 실측을 전제로 하지 않는다

단계마다 다는 *불변*은 **기전**이다 — 코드를 읽어 확인되는 것. 실측은 **개념으로 못 가르는
것이 남았을 때의 최후 수단**이다.

## 공통 전제 (썩는지 감시할 것)

| 전제 | 확인 방법 | 확인일 |
|---|---|---|
| 아이템 줄의 방출 갈래는 **하나**다(트렁크·기계별이 같은 배정·같은 방출기) | `clusterModule.ts` *"아이템 줄 방출 — 갈래가 없다"* | 2026-08-30 ✔ |
| `g` 를 정하는 곳은 `planBundles` **하나**다(붓기 앞에서, 줄마다) | `laneBudget.ts` · `planModulePorts.ts` 의 유일한 호출 | 2026-09-02 ✔ |
| `per`(머신 하나의 수요)는 `g`·`d` 와 무관하다 | `edgeFlows` 의 `childProduction`/`parentDemand` | 2026-08-30 ✔ |
| 되먹임 0 · `generateModule` 호출 자리 하나 | `modulePacking.ts` 를 센다 | 2026-08-30 ✔ |
| 기준선 = 타입 0 · **52파일 615테스트 · 기존 실패 2건**(trunkPipe 유체 면) | `npx tsc -p tsconfig.app.json --noEmit` · `npx vitest run` | 2026-09-02 ✔ |

> **테스트 수가 줄어든 것은 회귀가 아니다** — 641 → 607 은 지도 A 삭제가 그 판정만 잠그던
> 테스트 848줄(`clusterPortPlanner.test.ts` · `insertingPlanner.test.ts`)을 함께 지운 결과다.
> 살릴 의도는 옮겼고(`22bf95e` 본문), 그 사이 `laneBudget.test.ts` 7개가 새로 들어왔다.
