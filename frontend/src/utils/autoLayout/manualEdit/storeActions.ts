/**
 * store 수동 편집 분기 — **원본 보존** (비활성).
 *
 * `layoutStore` 의 드래그 재라우팅 코드를 **삭제 시점 그대로** 옮겨 둔 것이다.
 * 손대지 않았다 — 인자 하나 바꾸지 않았고 들여쓰기도 원본 그대로다.
 *
 * ## 읽는 법
 * **이 파일은 컴파일되지 않는다.** `tsconfig`·`vitest` 에서 제외돼 있고, 바깥 지역변수
 * (`grid`·`workGrid`·`newCells`·`set`·`get` …)를 그대로 참조한다. 되살릴 코드가 아니라
 * **"무엇을 했는가"의 증거**다. 재구현 시 의도는 [README.md](./README.md) 에서 읽고,
 * 세부 규칙(스냅·rollback·좌표 변환)이 궁금할 때만 여기를 본다.
 *
 * ## 원본 위치
 *  - `moveAssemblerGroup` 본체  ← layoutStore.ts 534–803
 *  - `moveEntityById` 재라우팅 분기 ← layoutStore.ts 921–1091
 */

// ─────────────────────────────────────────────────────────────────────────────
// moveAssemblerGroup — 조립기 그룹(부모+후손)을 (dx,dy) 이동 + 경계 라우팅 재시도
// (원본: layoutStore.ts 534–803, 세션이 없으면 536행에서 즉시 false 였다)
// ─────────────────────────────────────────────────────────────────────────────
    moveAssemblerGroup: (containerId, dx, dy) => {
      const { grid, viewport, tileSize, routingEditSession, externalAreaBbox, autoLayoutCanvasBbox, gridOriginX, gridOriginY } = get();
      if (!routingEditSession) return false;
      if (dx === 0 && dy === 0) return false;

      // 1. BFS: group = containerId + all descendant machines
      const groupIds = new Set<string>([containerId]);
      const queue: string[] = [containerId];
      while (queue.length > 0) {
        const curr = queue.shift()!;
        for (const child of (routingEditSession.machineChildren[curr] ?? [])) {
          if (!groupIds.has(child)) { groupIds.add(child); queue.push(child); }
        }
      }

      // 2. 음수 좌표 진입 여부 사전 검사 (그룹 셀 기준)
      let sx = 0, sy = 0;
      for (let i = 0; i < grid.cells.length; i++) {
        const cell = grid.cells[i];
        if (cell.entityId && groupIds.has(cell.entityId)) {
          const rx = (i % grid.width) + dx;
          const ry = Math.floor(i / grid.width) + dy;
          if (rx < 0) sx = Math.max(sx, -rx);
          if (ry < 0) sy = Math.max(sy, -ry);
        }
      }

      // ─── A-plan: liveArea 있고 grid shift 불필요 — Area 모델 위임 (chest 드래그와 대칭) ───
      if (routingEditSession.liveArea && sx === 0 && sy === 0) {
        const coox = routingEditSession.containerOriginOffset?.x ?? 0;
        const cooy = routingEditSession.containerOriginOffset?.y ?? 0;

        const internalA = cloneArea(routingEditSession.liveArea.internal);
        const externalA = cloneArea(routingEditSession.liveArea.external);
        const areaRoutings = routingEditSession.liveArea.routings.map(cloneRouting);

        // 그리드 셀 클리어용 — 이동 전 시점에 그룹과 연결된 라우팅 id (old)
        const oldAffectedRoutingIds = new Set<string>();
        for (const r of routingEditSession.routings) {
          const fi = groupIds.has(r.fromContainerId);
          const ti = groupIds.has(r.toContainerId);
          if (fi || ti) oldAffectedRoutingIds.add(r.id);
        }

        const result = dragAssemblerGroup(
          containerId, dx, dy,
          routingEditSession.machineChildren,
          internalA, externalA, areaRoutings,
          routingEditSession.routeOptions,
        );

        if (!result.ok) {
          const msg =
            result.reason === 'collision' ? '이동 위치가 다른 셀과 충돌합니다' :
            result.reason === 'no-path' ? '라우팅 경로를 찾을 수 없어 이동이 취소되었습니다' :
            '연결 대상이 사라져 이동을 취소했습니다';
          useToastStore.getState().show(msg, 'warning');
          return false;
        }

        get().pushHistory('moveAssemblerGroup');
        const liveCells = [...grid.cells];

        // 옛 그룹 머신 셀 + 옛 영향분 라우팅 셀 제거
        for (let i = 0; i < liveCells.length; i++) {
          const c = liveCells[i];
          if (c.entityId && (groupIds.has(c.entityId) || oldAffectedRoutingIds.has(c.entityId))) {
            liveCells[i] = createEmptyCell();
          }
        }

        // 새 그룹 머신 셀 배치 (internal.placed 에서 entityId ∈ groupIds, layout → grid)
        for (const p of internalA.placed) {
          if (p.cell.entityId && groupIds.has(p.cell.entityId)) {
            const gx = p.x + coox, gy = p.y + cooy;
            const idx = cellIndex(grid, gx, gy);
            if (idx >= 0 && idx < liveCells.length) liveCells[idx] = p.cell;
          }
        }

        // 새 라우팅 셀 (rerouted boundary + shifted internal-of-group)
        const finalAffectedRoutingIds = new Set<string>([
          ...result.rerouted.map(r => r.id),
          ...result.shiftedInternalRoutingIds,
        ]);
        for (const r of areaRoutings) {
          if (!finalAffectedRoutingIds.has(r.id)) continue;
          for (const { x, y, cell } of r.placed) {
            const gx = x + coox, gy = y + cooy;
            const idx = cellIndex(grid, gx, gy);
            if (idx >= 0 && idx < liveCells.length) liveCells[idx] = cell;
          }
        }

        // session.containers: 그룹의 새 origin 을 Area 에서 가져온다
        const updatedSessionContainers: Container[] = routingEditSession.containers.map(c => {
          if (!groupIds.has(c.id)) return c;
          const upd = internalA.containers.find(ic => ic.id === c.id)
            ?? externalA.containers.find(ec => ec.id === c.id);
          return upd ? { ...upd, origin: { ...upd.origin }, size: { ...upd.size } } : c;
        });

        // session.routings: areaRoutings 에서 재구성 (rerouted 라우팅 id 변경 가능)
        const updatedSessionRoutings: RoutingSessionRouting[] = areaRoutings.map(r => ({
          id: r.id,
          portKind: r.from.kind,
          fromContainerId: r.from.containerId,
          toContainerId: r.to.containerId,
        }));

        set({
          grid: { ...grid, cells: liveCells },
          routingEditSession: {
            ...routingEditSession,
            containers: updatedSessionContainers,
            routings: updatedSessionRoutings,
            liveArea: { internal: internalA, external: externalA, routings: areaRoutings },
          },
        });
        return true;
      }

      // ─── B-plan: liveArea 없거나 음수 시프트 필요 — 기존 grid 기반 경로 ───
      if (AUTO_LAYOUT_COORD_DUMP) {
        console.log('[autoLayout debug] moveAssemblerGroup — fallback path\n' + JSON.stringify({
          containerId,
          groupIds: [...groupIds],
          delta: { dx, dy },
          reason: routingEditSession.liveArea ? 'grid-shift-needed' : 'no-live-area',
          shift: { sx, sy },
        }, null, 2));
      }

      // 2. Classify routings: internal (both in group) vs boundary (one in group)
      const internalRoutingIds = new Set<string>();
      const boundaryRoutings: RoutingSessionRouting[] = [];
      for (const r of routingEditSession.routings) {
        const fi = groupIds.has(r.fromContainerId);
        const ti = groupIds.has(r.toContainerId);
        if (fi && ti) internalRoutingIds.add(r.id);
        else if (fi || ti) boundaryRoutings.push(r);
      }

      const workGrid = sx > 0 || sy > 0 ? shiftGridCells(grid, sx, sy) : grid;
      const workViewport = sx > 0 || sy > 0 ? shiftViewport(viewport, sx, sy, tileSize) : viewport;

      // 3. Collect cells to move/clear (from workGrid)
      const machineCellEntries: Array<{ x: number; y: number; cell: GridCell }> = [];
      const internalRoutingCellEntries: Array<{ x: number; y: number; cell: GridCell }> = [];
      const boundaryRoutingIdSet = new Set(boundaryRoutings.map(r => r.id));
      const clearIndices = new Set<number>();

      for (let i = 0; i < workGrid.cells.length; i++) {
        const cell = workGrid.cells[i];
        if (!cell.entityId) continue;
        const x = i % workGrid.width;
        const y = Math.floor(i / workGrid.width);
        if (groupIds.has(cell.entityId)) {
          machineCellEntries.push({ x, y, cell });
          clearIndices.add(i);
        } else if (internalRoutingIds.has(cell.entityId)) {
          internalRoutingCellEntries.push({ x, y, cell });
          clearIndices.add(i);
        } else if (boundaryRoutingIdSet.has(cell.entityId)) {
          clearIndices.add(i);
        }
      }

      // 4. Bounds check (right/bottom only — left/top already ensured by shift)
      for (const { x, y } of machineCellEntries) {
        const nx = x + dx, ny = y + dy;
        if (nx >= workGrid.width || ny >= workGrid.height) {
          useToastStore.getState().show('이동 위치가 그리드 범위를 벗어납니다', 'warning');
          return false;
        }
      }

      // 5. Collision check for new machine positions (skip cells that will be cleared)
      const clearKeySet = new Set<string>();
      for (const i of clearIndices) {
        clearKeySet.add(`${i % workGrid.width},${Math.floor(i / workGrid.width)}`);
      }
      for (const { x, y } of machineCellEntries) {
        const nx = x + dx, ny = y + dy;
        if (!clearKeySet.has(`${nx},${ny}`)) {
          const existingCell = getCell(workGrid, nx, ny);
          if (existingCell?.entityId) {
            useToastStore.getState().show('이동 위치가 다른 셀과 충돌합니다', 'warning');
            return false;
          }
        }
      }

      get().pushHistory('moveAssemblerGroup');
      const newCells = [...workGrid.cells];

      // 6. Clear old positions
      for (const idx of clearIndices) newCells[idx] = createEmptyCell();

      // 7. Place machines at shifted positions
      for (const { x, y, cell } of machineCellEntries) {
        newCells[cellIndex(workGrid, x + dx, y + dy)] = cell;
      }

      // 8. Shift internal routing cells (skip out-of-bounds)
      for (const { x, y, cell } of internalRoutingCellEntries) {
        const nx = x + dx, ny = y + dy;
        if (nx >= 0 && ny >= 0 && nx < workGrid.width && ny < workGrid.height) {
          newCells[cellIndex(workGrid, nx, ny)] = cell;
        }
      }

      // 9. Update container origins (group: +sx+dx/dy, non-group: +sx/sy for grid shift)
      const updatedContainers: Container[] = routingEditSession.containers.map(c =>
        groupIds.has(c.id)
          ? { ...c, origin: { x: c.origin.x + sx + dx, y: c.origin.y + sy + dy } }
          : (sx > 0 || sy > 0 ? { ...c, origin: { x: c.origin.x + sx, y: c.origin.y + sy } } : c)
      );

      // 10. Build occupancy Area from newCells for re-routing
      const rerouteArea: Area = {
        kind: 'internal',
        containers: updatedContainers,
        placed: [],
        undergroundCorridors: [],
      };
      for (let i = 0; i < newCells.length; i++) {
        if (newCells[i].entityId !== null) {
          rerouteArea.placed.push({ x: i % workGrid.width, y: Math.floor(i / workGrid.width), cell: newCells[i] });
        }
      }

      // 11. Re-route boundary routings
      // container.origin은 layout 좌표계이므로 라우팅 시 그리드 좌표로 보정한다.
      const coox = routingEditSession.containerOriginOffset?.x ?? 0;
      const cooy = routingEditSession.containerOriginOffset?.y ?? 0;
      const toGridOrigin = (c: Container): Container =>
        coox === 0 && cooy === 0 ? c : { ...c, origin: { x: c.origin.x + coox, y: c.origin.y + cooy } };

      const updatedRoutings = routingEditSession.routings.map(r => ({ ...r }));
      for (const r of boundaryRoutings) {
        const fromC = updatedContainers.find(c => c.id === r.fromContainerId);
        const toC = updatedContainers.find(c => c.id === r.toContainerId);
        if (!fromC || !toC) continue;
        const attempt = routeWithFallback(toGridOrigin(fromC), toGridOrigin(toC), r.portKind, rerouteArea, routingEditSession.routeOptions);
        if (attempt.ok) {
          commitRouting(attempt.routing, rerouteArea);
          for (const { x, y, cell } of attempt.routing.placed) {
            if (x >= 0 && y >= 0 && x < workGrid.width && y < workGrid.height) {
              newCells[cellIndex(workGrid, x, y)] = cell;
            }
          }
          const rIdx = updatedRoutings.findIndex(ur => ur.id === r.id);
          if (rIdx >= 0) updatedRoutings[rIdx] = { ...updatedRoutings[rIdx], id: attempt.routing.id };
        }
      }

      set({
        grid: { ...workGrid, cells: newCells },
        viewport: workViewport,
        externalAreaBbox: shiftBbox(externalAreaBbox, sx, sy),
        autoLayoutCanvasBbox: shiftBbox(autoLayoutCanvasBbox, sx, sy),
        ...(sx > 0 || sy > 0 ? {
          gridOriginX: gridOriginX - sx,
          gridOriginY: gridOriginY - sy,
        } : {}),
        routingEditSession: { ...routingEditSession, containers: updatedContainers, routings: updatedRoutings },
      });
      return true;
    },

// ─────────────────────────────────────────────────────────────────────────────
// moveEntityById — 무한상자/파이프 드래그 시 연결 라우팅 재시도
// (원본: layoutStore.ts 921–1091. 이 블록 바깥은 세션과 무관한 단순 이동이라 store 에 남았다)
// ─────────────────────────────────────────────────────────────────────────────
      if (routingEditSession && connectedRoutings.length > 0) {
        const coox = routingEditSession.containerOriginOffset?.x ?? 0;
        const cooy = routingEditSession.containerOriginOffset?.y ?? 0;
        const toGridOrigin = (c: Container): Container =>
          coox === 0 && cooy === 0 ? c : { ...c, origin: { x: c.origin.x + coox, y: c.origin.y + cooy } };

        // A-plan: liveArea 가 있으면 chest/pipe 드래그를 dragExternalContainer 에 위임.
        // dragExternalContainer 는 *레이아웃 좌표* 에서 동작하므로 그리드 음수(좌/상 드롭)
        // 와 무관하다. 결과 셀이 음수 그리드 좌표를 가지면 그만큼 전체 그리드를 시프트한다.
        // (이전엔 sx===0&&sy===0 일 때만 A-plan 을 쓰고 좌/상 드롭은 레거시 B-plan 으로
        //  빠졌으나, 그러면 스냅·pickBest 가 안 걸려 라우팅 품질이 방향마다 달랐다.)
        if (
          routingEditSession.liveArea &&
          (entityType === EntityType.InfinityChest || entityType === EntityType.InfinityPipe)
        ) {
          // 매 드래그마다 liveArea 를 deep-clone 해서 dragExternalContainer 에 전달.
          // dragExternalContainer 는 전달받은 객체를 직접 mutate 하므로,
          // 실패(롤백) 포함 어떤 경우에도 원본 liveArea 가 오염되지 않는다.
          const internal = cloneArea(routingEditSession.liveArea.internal);
          const external = cloneArea(routingEditSession.liveArea.external);
          const areaRoutings = routingEditSession.liveArea.routings.map(cloneRouting);
          const newLayoutOrigin = { x: toX - coox, y: toY - cooy };

          // 영향받는 라우팅 ID 수집 (그리드 지울 셀 파악용)
          const affectedRoutingIds = new Set(
            areaRoutings
              .filter(r => r.from.containerId === entityId || r.to.containerId === entityId)
              .map(r => r.id),
          );

          const dragResult = dragExternalContainer(
            entityId, newLayoutOrigin, internal, external, areaRoutings, routingEditSession.routeOptions,
          );
          if (!dragResult.ok) {
            console.warn('[autoLayout] reroute failed (A-plan, move rejected)', { entityId, reason: dragResult.reason, failedRouting: dragResult.failedRouting });
            useToastStore.getState().show(t('toasts.routingRerouteFailed'), 'warning');
            return false;
          }

          // 새로 깔릴 셀(chest + rerouted 라우팅)의 그리드 좌표 → 음수면 시프트량 산정.
          let minGx = 0, minGy = 0;
          const noteCell = (gx: number, gy: number) => {
            if (gx < minGx) minGx = gx;
            if (gy < minGy) minGy = gy;
          };
          for (const p of external.placed) {
            if (p.cell.entityId === entityId) noteCell(p.x + coox, p.y + cooy);
          }
          for (const routing of dragResult.rerouted) {
            for (const { x, y } of routing.placed) noteCell(x + coox, y + cooy);
          }
          const asx = Math.max(0, -minGx), asy = Math.max(0, -minGy);

          get().pushHistory('moveEntityById');
          const baseGrid = asx > 0 || asy > 0 ? shiftGridCells(grid, asx, asy) : grid;
          const liveCells = [...baseGrid.cells];

          // 기존 chest 셀 + 기존 routing 셀 제거 (id 기준 — 시프트 후에도 id 유지)
          for (let i = 0; i < liveCells.length; i++) {
            const c = liveCells[i];
            if (c.entityId === entityId || (c.entityId && affectedRoutingIds.has(c.entityId))) {
              liveCells[i] = createEmptyCell();
            }
          }

          // 새 chest 셀 배치 (external.placed 기준, layout → grid, 시프트 적용)
          for (const p of external.placed) {
            if (p.cell.entityId !== entityId) continue;
            const idx = cellIndex(baseGrid, p.x + coox + asx, p.y + cooy + asy);
            if (idx >= 0 && idx < liveCells.length) liveCells[idx] = p.cell;
          }

          // 새 routing 셀 배치 (layout → grid, 시프트 적용)
          for (const routing of dragResult.rerouted) {
            for (const { x, y, cell } of routing.placed) {
              const idx = cellIndex(baseGrid, x + coox + asx, y + cooy + asy);
              if (idx >= 0 && idx < liveCells.length) liveCells[idx] = cell;
            }
          }

          // session.containers: clone 된 chest 객체의 새 origin 을 사용
          const clonedChest = external.containers.find(c => c.id === entityId);
          const updatedSessionContainers = routingEditSession.containers.map(c =>
            c.id === entityId ? (clonedChest ? { ...clonedChest } : { ...c }) : c,
          );
          // session.routings: areaRoutings에서 재구성 (라우팅 ID가 변경될 수 있음)
          const updatedSessionRoutings: RoutingSessionRouting[] = areaRoutings.map(r => ({
            id: r.id,
            portKind: r.from.kind,
            fromContainerId: r.from.containerId,
            toContainerId: r.to.containerId,
          }));

          set({
            grid: { ...baseGrid, cells: liveCells },
            routingEditSession: {
              ...routingEditSession,
              containers: updatedSessionContainers,
              routings: updatedSessionRoutings,
              // 시프트만큼 offset 갱신 → 이후 드래그의 layout↔grid 변환이 정확해진다.
              containerOriginOffset: { x: coox + asx, y: cooy + asy },
              liveArea: { internal, external, routings: areaRoutings },
            },
            ...(asx > 0 || asy > 0 ? {
              viewport: shiftViewport(viewport, asx, asy, tileSize),
              externalAreaBbox: shiftBbox(externalAreaBbox, asx, asy),
              autoLayoutCanvasBbox: shiftBbox(autoLayoutCanvasBbox, asx, asy),
              gridOriginX: gridOriginX - asx,
              gridOriginY: gridOriginY - asy,
            } : {}),
          });
          return true;
        }

        // Fallback: liveArea 없거나 그리드 shift 있을 때
        // (Step 1 fix: 좌표계 불일치 수정 — toGridOrigin 보정 추가)
        const updatedContainers = routingEditSession.containers.map(c =>
          c.id === entityId
            ? { ...c, origin: { x: wToX - coox, y: wToY - cooy } }  // layout-space로 저장
            : (sx > 0 || sy > 0 ? { ...c, origin: { x: c.origin.x + sx, y: c.origin.y + sy } } : c)
        );

        const rerouteArea: Area = {
          kind: 'internal',
          containers: updatedContainers,
          placed: [],
          undergroundCorridors: [],
        };
        for (let i = 0; i < newCells.length; i++) {
          if (newCells[i].entityId !== null) {
            rerouteArea.placed.push({ x: i % workGrid.width, y: Math.floor(i / workGrid.width), cell: newCells[i] });
          }
        }

        const updatedRoutings = routingEditSession.routings.map(r => ({ ...r }));
        const failedRoutings: { id: string; reason: string }[] = [];
        for (const r of connectedRoutings) {
          const fromC = updatedContainers.find(c => c.id === r.fromContainerId);
          const toC = updatedContainers.find(c => c.id === r.toContainerId);
          if (!fromC || !toC) {
            failedRoutings.push({ id: r.id, reason: 'container-not-found' });
            continue;
          }
          const attempt = routeWithFallback(toGridOrigin(fromC), toGridOrigin(toC), r.portKind, rerouteArea, routingEditSession.routeOptions);
          if (attempt.ok) {
            commitRouting(attempt.routing, rerouteArea);
            for (const { x, y, cell } of attempt.routing.placed) {
              if (x >= 0 && y >= 0 && x < workGrid.width && y < workGrid.height) {
                newCells[cellIndex(workGrid, x, y)] = cell;
              }
            }
            const rIdx = updatedRoutings.findIndex(ur => ur.id === r.id);
            if (rIdx >= 0) updatedRoutings[rIdx] = { ...updatedRoutings[rIdx], id: attempt.routing.id };
          } else {
            failedRoutings.push({ id: r.id, reason: attempt.reason });
          }
        }

        if (failedRoutings.length > 0) {
          console.warn('[autoLayout] reroute failed (fallback)', { entityId, failed: failedRoutings });
          useToastStore.getState().show(t('toasts.routingRerouteFailed'), 'warning');
        }

        get().pushHistory('moveEntityById');
        set({
          grid: { ...workGrid, cells: newCells },
          routingEditSession: { ...routingEditSession, containers: updatedContainers, routings: updatedRoutings },
          ...shiftExtra,
        });
        return true;
      }
