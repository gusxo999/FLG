// 형태-전수.md §10.2 의 판 — 팔 길이 1 · 품목 6 · 틈 없이 · 모든 줄이 세 대씩 지난다.
// 앱(npm run dev → localhost:5173)의 브라우저 콘솔에 통째로 붙여 넣는다. 그리드를 비우고 판을 놓은 뒤 가동률을 찍는다.
// 커스텀 머신 fl-plant · 레시피 fl-thing 을 넣는다(입력 다섯 · 출력 하나 · 0.5회/s).
// 2026-10-15 결과: 6대 · 100% 6 · 미달 0 · 끊김 없음.
(async () => {
  flg.custom.add({
    machines: [{ name: 'fl-plant', size: 3, craftingSpeed: 1, craftingCategories: ['custom-fl'], moduleSlots: 0, fluidBoxes: [] }],
    recipes: [{
      name: 'fl-thing', category: 'custom-fl', energyRequired: 2,
      ingredients: ['iron-plate', 'copper-plate', 'iron-gear-wheel', 'copper-cable', 'stone'].map((name) => ({ name, amount: 1, type: 'item' })),
      products: [{ name: 'fl-thing', amount: 1, type: 'item' }],
    }],
  });
  const ls = (await import('/src/UI/store/layoutStore.ts')).useLayoutStore;
  flg.grid.clear();
  let n = 0; const id = () => 'fl' + (n++);
  const placed = [];
  const one = (x, y, entityType, entityName, direction, extra = {}) =>
    placed.push({ x, y, cell: { entityId: id(), entityName, entityType, direction, tileOffset: { x: 0, y: 0 }, isOrigin: true, ...extra } });
  const X0 = 20, Y0 = 10; // 머신 기둥 x 20..22 · 머신 m 은 y 10+3m .. 12+3m. 서쪽 면: 인서터 x19 · 벨트 x18. 동쪽 면: 인서터 x23 · 벨트 x24
  for (let m = 0; m < 6; m++) {
    const eid = id();
    for (let dy = 0; dy < 3; dy++) for (let dx = 0; dx < 3; dx++)
      placed.push({ x: X0 + dx, y: Y0 + 3 * m + dy, cell: { entityId: eid, entityName: 'fl-plant', entityType: 'Assembler', direction: 0, tileOffset: { x: dx, y: dy }, isOrigin: dx === 0 && dy === 0, recipe: 'fl-thing' } });
  }
  // 방향: 0 북 · 4 동 · 8 남 · 12 서. 지하벨트 종류: Y 노랑 · R 빨강 · E 파랑(파랑은 짝 없는 입구 — 줄 끝을 막는다)
  const B = (d) => ['Belt', 'transport-belt', d];
  const U = (name, d, t) => ['UndergroundBelt', name, d, t];
  const Y = 'underground-belt', R = 'fast-underground-belt', E = 'express-underground-belt';
  // 서쪽 면 — A(입력 iron-plate · copper-plate, 레인마다 하나) 와 B(출력) 가 거리 2 를 번갈아 쓴다. 열쇠 = 행(머신 1 의 첫 행이 0)
  const W = { '-2': U(R, 0, 'output'), '-1': B(8), 0: B(8), 1: U(Y, 8, 'input'), 2: U(R, 0, 'input'), 3: U(R, 0, 'output'), 4: U(Y, 8, 'output'), 5: B(8), 6: B(8), 7: U(E, 8, 'input'), 8: U(R, 0, 'input'), 9: U(R, 8, 'input'), 10: U(E, 0, 'input'), 11: B(0), 12: B(0), 13: U(Y, 0, 'output'), 14: U(R, 8, 'output'), 15: U(R, 8, 'input'), 16: U(Y, 0, 'input'), 17: B(0), 18: B(0), 19: U(R, 8, 'output') };
  // 동쪽 면 — C(입력 iron-gear-wheel · copper-cable) 는 A 와 같은 칸, D(입력 stone) 는 B 와 같은 칸이되 가운데(행 8 · 9)에서 옆으로 들어와 양쪽 끝으로 흐른다
  const Ef = { '-3': B(0), '-2': U(R, 0, 'output'), '-1': B(8), 0: B(8), 1: U(Y, 8, 'input'), 2: U(R, 0, 'input'), 3: U(R, 0, 'output'), 4: U(Y, 8, 'output'), 5: B(8), 6: B(8), 7: U(E, 8, 'input'), 8: U(R, 0, 'input'), 9: U(R, 8, 'input'), 10: U(E, 0, 'input'), 11: B(0), 12: B(0), 13: U(Y, 0, 'output'), 14: U(R, 8, 'output'), 15: U(R, 8, 'input'), 16: U(Y, 0, 'input'), 17: B(0), 18: B(0), 19: U(R, 8, 'output'), 20: B(8) };
  const put = (x, r, [t, nm, d, ut]) => one(x, Y0 + Number(r), t, nm, d, ut ? { undergroundType: ut } : {});
  for (const r in W) put(X0 - 2, r, W[r]);
  for (const r in Ef) put(X0 + 4, r, Ef[r]);
  const outRows = new Set([2, 3, 8, 9, 14, 15]);
  for (let r = 0; r < 18; r++) {
    one(X0 - 1, Y0 + r, 'Inserter', 'inserter', outRows.has(r) ? 4 : 12); // 인서터 방향 = 집는 쪽
    one(X0 + 3, Y0 + r, 'Inserter', 'inserter', 4);
  }
  const supply = (item) => ({ infinitySettings: { remove_unfiltered_items: false, filters: [{ index: 1, name: item, count: 50, mode: 'at-least' }] } });
  const sink = { infinitySettings: { remove_unfiltered_items: true, filters: [] } };
  const chest = (x, y, extra) => one(x, y, 'InfinityChest', 'infinity-chest', 0, extra);
  // 서쪽 위 — B 는 위로 나가 상자에 버린다(인서터 셋 — 하나로는 세 대의 출력을 못 받는다). A 는 옆에서 들어온다(양쪽 인서터가 서로 다른 레인에 싣는다)
  one(18, 7, 'Belt', 'transport-belt', 0); one(18, 6, 'Belt', 'transport-belt', 0);
  one(18, 5, 'Inserter', 'inserter', 8); chest(18, 4, sink);
  one(17, 6, 'Inserter', 'inserter', 4); chest(16, 6, sink);
  one(19, 6, 'Inserter', 'inserter', 12); chest(20, 6, sink);
  one(19, 7, 'Inserter', 'inserter', 12); chest(20, 7, sink);
  for (const x of [15, 16, 17]) one(x, 9, 'Belt', 'transport-belt', 4);
  one(15, 8, 'Inserter', 'inserter', 0); chest(15, 7, supply('iron-plate'));
  one(16, 10, 'Inserter', 'inserter', 8); chest(16, 11, supply('copper-plate'));
  // 서쪽 아래
  one(18, 30, 'Belt', 'transport-belt', 8); one(18, 31, 'Belt', 'transport-belt', 8);
  one(18, 32, 'Inserter', 'inserter', 0); chest(18, 33, sink);
  one(17, 31, 'Inserter', 'inserter', 4); chest(16, 31, sink);
  one(19, 31, 'Inserter', 'inserter', 12); chest(20, 31, sink);
  one(19, 30, 'Inserter', 'inserter', 12); chest(20, 30, sink);
  for (const x of [15, 16, 17]) one(x, 28, 'Belt', 'transport-belt', 4);
  one(15, 29, 'Inserter', 'inserter', 8); chest(15, 30, supply('iron-plate'));
  one(16, 27, 'Inserter', 'inserter', 0); chest(16, 26, supply('copper-plate'));
  // 동쪽 — C 는 위 · 아래 끝에서 옆으로 들어온다
  for (const x of [25, 26, 27]) { one(x, 9, 'Belt', 'transport-belt', 12); one(x, 28, 'Belt', 'transport-belt', 12); }
  one(27, 8, 'Inserter', 'inserter', 0); chest(27, 7, supply('iron-gear-wheel'));
  one(26, 10, 'Inserter', 'inserter', 8); chest(26, 11, supply('copper-cable'));
  one(27, 29, 'Inserter', 'inserter', 8); chest(27, 30, supply('iron-gear-wheel'));
  one(26, 27, 'Inserter', 'inserter', 0); chest(26, 26, supply('copper-cable'));
  // 동쪽 — D 는 행 8 · 9 의 지하 입구에 옆에서 붙는다. 입구는 덮개 반대쪽 반에 닿는 레인 하나만 받는다 —
  // 북향 입구(행 8)는 남쪽 레인, 남향 입구(행 9)는 북쪽 레인. 그래서 공급 인서터를 각각 북쪽 · 남쪽에 세운다(먼 레인에 놓는다)
  for (const x of [25, 26]) { one(x, 18, 'Belt', 'transport-belt', 12); one(x, 19, 'Belt', 'transport-belt', 12); }
  one(26, 17, 'Inserter', 'inserter', 0); chest(26, 16, supply('stone'));
  one(26, 20, 'Inserter', 'inserter', 8); chest(26, 21, supply('stone'));
  ls.getState().applyPlacedCells(placed);
  flg.flow.machines();
  flg.flow.breaks();
})();
