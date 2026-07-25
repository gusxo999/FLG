# Phase 3: 옛 경로 유체 처리 삭제 — 분석 및 안전 계획

**날짜:** 2026-07-25  
**대상:** containerRouting.routeFluid 및 관련 옛 경로 코드

## P3-1: containerRouting.routeFluid 사용처 조사 ✓ 완료

### 사용 범위

`routeFluid` 는 **옛 경로 전용**입니다.

**호출 체인:**
```
routeFluid (containerRouting.ts:481)
  ↑
  called by: routeWithFallback (containerRouting.ts:57, 루트 라우팅)
  ↑
  called by:
    - layeredWizard.ts:531 (S-LAYER 채널 라우팅)
    - areaUnification.ts:378, 676, 940 (드래그 재라우팅)
    - ringGateway.test.ts:93, 117 (테스트)
```

### 의존성 그래프

```
containerRouting.routeFluid
  └─ containerRouting.routeWithFallback
     ├─ layeredWizard.ts (S-LAYER 경로 — 삭제 대상)
     ├─ areaUnification.ts (사용자 드래그 재라우팅 — 유지 필요)
     └─ ringGateway.test.ts (테스트 — 유지)
```

### 핵심 발견

**routeFluid 는 안전하게 삭제할 수 없습니다.** 이유:

1. **areaUnification.ts**: 사용자가 화면에서 드래그로 연결을 재라우팅할 때 호출
   - 이 경로는 계속 활발히 사용됨
   - 유체 재라우팅을 지원해야 함

2. **ringGateway.test.ts**: 기존 테스트
   - 테스트도 계속 필요

### 결론

**P3 전략 수정 필요:**

- ✅ routeWithFallback 은 옛 경로에서도 신 경로에서도 사용됨
- ❌ routeFluid 를 단순히 삭제할 수 없음 (드래그 재라우팅이 의존)
- ❌ layeredWizard 를 삭제해도 routeFluid 는 유지해야 함

### 다음 단계 수정

**원래 계획:**
```
P3-3: 옛 유체·관련 코드 삭제
  → containerRouting.routeFluid + 헬퍼 삭제
```

**수정된 계획:**
```
P3-3: 옛 경로 전용 코드만 삭제
  → layeredWizard.ts 내 S-LAYER 본체 삭제
  → containerRouting.routeFluid 는 유지 (areaUnification 필요)
  → areaUnification.ts 유지 (사용자 드래그 재라우팅 필요)
```

## 영향도 평가

### 안전하게 삭제 가능한 것 (P3-3)

1. **layeredWizard.ts 단계 2b-10** (약 400줄)
   - tidy-tree 배치, left-edge 채널, 1:1 라우팅
   - 옛 경로 전용

2. **optionalroutineUtils** (옛 경로 헬퍼들)
   - `assignTracksLeftEdge`, `channelWidthFromTracks`
   - `wrapExternalsWithMerge`, `gatherExternalsToPoints`
   - `tryMergeClusterOutput`, `tryMergeClusterOutputBus`
   - 옛 경로 전용

3. **containerRouting.ts 내 옛 경로 유체 처리**
   - S-LAYER 관련 코드는 제거 가능
   - `routeFluid` 자체는 유지

### 유지해야 하는 것

1. **containerRouting.routeFluid** (areaUnification 의존)
2. **areaUnification.ts** (사용자 드래그 재라우팅)
3. **ringGateway.test.ts** (기존 테스트)
4. **routeWithFallback** (일반 라우팅 기본 함수)

## Phase 3 재계획

| Phase | 항목 | 상태 | 삭제 여부 |
|---|---|---|---|
| P3-1 | routeFluid 사용처 조사 | ✓ 완료 | ❌ 유지 |
| P3-2 | fallback 스텁을 더미로 전환 | → 수행 예정 | — |
| P3-3 | 옛 경로 본체 삭제 | → 수행 예정 | ✓ 삭제 |
| P3-4 | 독점 함수 정리 | → 수행 예정 | ✓ 삭제 |

## 테스트 검증 계획

Phase 3 진행 중 다음을 모니터링:
- `tsc --noEmit`: 에러 0 유지
- `vitest run`: 510 테스트 모두 통과
- ringGateway.test.ts: 특히 확인 (routeWithFallback 호출)
- areaUnification 관련 테스트: 드래그 재라우팅 정상 작동

## 코드 삭제 안전성 등급

| 파일 | 삭제 항목 | 난이도 | 테스트 커버 |
|---|---|---|---|
| layeredWizard.ts | 단계 2b-10 (400줄) | **높음** | 낮음 (옛 경로는 테스트 적음) |
| channelPlanner.ts | assignTracksLeftEdge, channelWidthFromTracks | **중간** | 있음 (channelPlanner.test.ts) |
| externalMergePass.ts | wrapExternalsWithMerge 함수 모음 | **중간** | 있음 |
| clusterTrunkMerge.ts | tryMergeClusterOutput 함수 모음 | **중간** | 있음 |
| containerRouting.ts | routeFluid 는 유지, 옛 경로 주석 제거 | **낮음** | 높음 (routeWithFallback 테스트 많음) |

---

**결론:** Phase 3 은 layeredWizard 본체 삭제가 핵심. routeFluid 는 유지 필요.
