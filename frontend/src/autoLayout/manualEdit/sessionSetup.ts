/**
 * 세션 준비 — **원본 보존** (비활성).
 *
 * `AutoLayoutContainerPanel` 이 배치 결과(CandidateLeaf)를 그리드에 적용한 뒤,
 * 드래그 재라우팅용 `RoutingEditSession` 을 만들던 코드다. 삭제 시점 그대로 옮겼다.
 *
 * **컴파일되지 않는다** — `props`·컴포넌트 지역 스코프를 그대로 참조한다.
 * 재구현 시 "무엇을 준비했는가"의 증거로만 읽는다. 의도는 [README.md](../../../../docs/README.md).
 *
 * 원본 위치: AutoLayoutContainerPanel.tsx 196–240(buildSessionFromLeaf) · 343–357(오프셋 산정)
 */

// ─────────────────────────────────────────────────────────────────────────────
// buildSessionFromLeaf — CandidateLeaf → RoutingEditSession
// (컨테이너 목록·라우팅 요약·머신 부모/자식 관계·RouteOptions 를 한 덩어리로)
// ─────────────────────────────────────────────────────────────────────────────
  function buildSessionFromLeaf(
    leaf: CandidateLeaf,
    containerOriginOffset: { x: number; y: number },
  ): RoutingEditSession {
    const allContainers = [...leaf.internal.containers, ...leaf.external.containers];
    const machineIdSet = new Set(leaf.internal.containers.filter(c => c.kind === 'machine').map(c => c.id));

    const machineParent: Record<string, string | null> = {};
    const machineChildren: Record<string, string[]> = {};
    for (const c of leaf.internal.containers) {
      if (c.kind === 'machine') { machineParent[c.id] = null; machineChildren[c.id] = []; }
    }

    const routings: RoutingSessionRouting[] = leaf.routings.map(r => ({
      id: r.id,
      portKind: r.from.kind,
      fromContainerId: r.from.containerId,
      toContainerId: r.to.containerId,
    }));

    for (const r of leaf.routings) {
      const fi = r.from.containerId, ti = r.to.containerId;
      if (machineIdSet.has(fi) && machineIdSet.has(ti)) {
        machineParent[fi] = ti;
        if (!machineChildren[ti].includes(fi)) machineChildren[ti].push(fi);
      }
    }

    const input: ContainerWizardInput = {
      targetRecipe: props.targetRecipe,
      countMode:
        props.countMode === 'manual' ? { perTarget: props.perTarget } : 'min',
      externalIngredients: props.externalIngredients,
      recipeOverrides: props.recipeOverrides,
      selectedMachines: Array.from(props.selectedMachines),
      selectedInserters: Array.from(props.selectedInserters),
      selectedBelts: Array.from(props.selectedBelts),
      selectedUndergroundPipes: Array.from(props.selectedUndergroundPipes),
      selectedUndergroundBelts: Array.from(props.selectedUndergroundBelts),
      inserterOverrides,
      externalPortsDefault: 'top-left',
    };

    return { containers: allContainers, routings, machineParent, machineChildren, routeOptions: buildRoutingOptions(input), containerOriginOffset };
  }

// ─────────────────────────────────────────────────────────────────────────────
// containerOriginOffset — layout 좌표 → 그리드 좌표 오프셋
//
// 라우팅 선(liveArea 원본 좌표 + offset)이 그리드 벨트 위에 **정확히 겹치게** 하는 값.
// unifyAreas 가 placed 셀에 실제로 적용한 offset 과 동일해야 한다.
// (원본: handleApplyCandidate 안, applyPlacedCells 직전)
// ─────────────────────────────────────────────────────────────────────────────
    // container.origin (layout space) → 그리드 좌표 오프셋.
    // unifyAreas 가 placed 셀(=그리드 입력)에 실제로 적용한 offset 과 **동일** 해야
    // 라우팅 선(liveArea 원본 좌표 + offset)이 그리드 벨트 위에 정확히 겹친다.
    // (과거엔 machineBbox 기준 internalBbox 로 계산해, 머신 왼쪽/위로 셀이 튀어나온
    //  모듈 경로에서 fullPlacedBbox 기준 정규화와 어긋나 선이 옆으로 밀렸다.)
    // applyPlacedCells 가 음수 정규화 셀을 sx/sy 만큼 추가 시프트하므로 그 분도 포함한다.
    let minCellX = 0, minCellY = 0;
    for (const { x, y } of cells) {
      if (x < minCellX) minCellX = x;
      if (y < minCellY) minCellY = y;
    }
    const containerOriginOffset = {
      x: offset.x + Math.max(0, -minCellX),
      y: offset.y + Math.max(0, -minCellY),
    };
