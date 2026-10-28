// 형태-전수.md §10.3 의 판 — 긴팔 인서터만 · 품목 12(입력 11 · 출력 1) · 틈 없이 · 모든 줄이 여러 대를 지난다.
// 한 행에 긴팔 둘을 겹쳐 세운다(§2-나) — 거리 1 의 긴팔은 거리 3 의 벨트를, 거리 2 의 긴팔은 거리 4 의 벨트를 집는다.
// 면마다 세로줄 둘(거리 3 · 4), 세로줄마다 벨트 둘이 번갈아 땅속으로(§5-다) — 레인 둘짜리 벨트 하나 + 레인 하나짜리 벨트 하나.
// 앱(npm run dev → localhost:5173) 콘솔에 붙여 넣는다. 그리드를 비우고 판을 놓고 가동률을 찍는다.
// 커스텀 레시피 fl12-thing 을 넣는다(입력 열하나 · 출력 하나 · 0.5회/s). 머신 fl-plant 는 판-긴팔없음-품목6.js 와 같다.
// 2026-10-15 결과: 6대 · 100% 6 · 미달 0 · 끊김 없음.
(async () => {
  const ITEMS = ['iron-plate', 'copper-plate', 'iron-gear-wheel', 'copper-cable', 'stone', 'coal', 'steel-plate', 'plastic-bar', 'electronic-circuit', 'sulfur', 'stone-brick'];
  flg.custom.add({
    machines: [{ name: 'fl-plant', size: 3, craftingSpeed: 1, craftingCategories: ['custom-fl'], moduleSlots: 0, fluidBoxes: [] }],
    recipes: [{
      name: 'fl12-thing', category: 'custom-fl', energyRequired: 2,
      ingredients: ITEMS.map((name) => ({ name, amount: 1, type: 'item' })),
      products: [{ name: 'fl12-thing', amount: 1, type: 'item' }],
    }],
  });
  const [a1, a2, c1, c2, d1, e1, e2, f1, g1, g2, h1] = ITEMS;
  const ls = (await import('/src/UI/store/layoutStore.ts')).useLayoutStore;
  flg.grid.clear();
  let n = 0; const id = () => 'f12_' + (n++);
  const placed = [];
  const one = (x, y, entityType, entityName, direction, extra = {}) =>
    placed.push({ x, y, cell: { entityId: id(), entityName, entityType, direction, tileOffset: { x: 0, y: 0 }, isOrigin: true, ...extra } });
  const belt = (x, y, d) => one(x, y, 'Belt', 'transport-belt', d);
  const ins = (x, y, d) => one(x, y, 'Inserter', 'inserter', d);
  const supply = (item) => ({ infinitySettings: { remove_unfiltered_items: false, filters: [{ index: 1, name: item, count: 50, mode: 'at-least' }] } });
  const SINK = { infinitySettings: { remove_unfiltered_items: true, filters: [] } };
  const chest = (x, y, extra) => one(x, y, 'InfinityChest', 'infinity-chest', 0, extra);
  const src = (ix, iy, d, cx, cy, item) => { ins(ix, iy, d); chest(cx, cy, supply(item)); };
  const snk = (ix, iy, d, cx, cy) => { ins(ix, iy, d); chest(cx, cy, SINK); };

  const X0 = 20, Y0 = 10; // 머신 x 20..22 · 머신 m 은 y 10+3m .. 12+3m
  for (let m = 0; m < 6; m++) {
    const eid = id();
    for (let dy = 0; dy < 3; dy++) for (let dx = 0; dx < 3; dx++)
      placed.push({ x: X0 + dx, y: Y0 + 3 * m + dy, cell: { entityId: eid, entityName: 'fl-plant', entityType: 'Assembler', direction: 0, tileOffset: { x: dx, y: dy }, isOrigin: dx === 0 && dy === 0, recipe: 'fl12-thing' } });
  }
  // 세로줄 무늬 — 열쇠 = 행(머신 1 의 첫 행이 0). 방향 0 북 · 4 동 · 8 남 · 12 서
  const Bt = (d) => ['Belt', 'transport-belt', d];
  const U = (name, d, t) => ['UndergroundBelt', name, d, t];
  const Y = 'underground-belt', R = 'fast-underground-belt', E = 'express-underground-belt';
  // 레인 둘짜리 입력 — 위 · 아래 끝에서 옆으로 들어와 가운데로 흐르고, 짝 없는 파랑 입구에서 멈춘다. 머신마다 땅 위 두 칸
  const TWO = { '-1': Bt(8), 0: Bt(8), 1: U(Y, 8, 'input'), 4: U(Y, 8, 'output'), 5: Bt(8), 6: Bt(8), 7: U(E, 8, 'input'), 10: U(E, 0, 'input'), 11: Bt(0), 12: Bt(0), 13: U(Y, 0, 'output'), 16: U(Y, 0, 'input'), 17: Bt(0), 18: Bt(0) };
  // 출력 — 가운데서 시작해 위 · 아래 끝으로 나간다. 머신마다 땅 위 한 칸
  const OUT = { '-2': U(R, 0, 'output'), 2: U(R, 0, 'input'), 3: U(R, 0, 'output'), 8: U(R, 0, 'input'), 9: U(R, 8, 'input'), 14: U(R, 8, 'output'), 15: U(R, 8, 'input'), 19: U(R, 8, 'output') };
  // 레인 하나짜리 입력 — 가운데(행 8 · 9)에서 바깥 옆으로 들어와 위 · 아래 끝으로 흐른다
  const SIDE = { '-3': Bt(0), '-2': U(R, 0, 'output'), 2: U(R, 0, 'input'), 3: U(R, 0, 'output'), 8: U(R, 0, 'input'), 9: U(R, 8, 'input'), 14: U(R, 8, 'output'), 15: U(R, 8, 'input'), 19: U(R, 8, 'output'), 20: Bt(8) };
  // 레인 하나짜리 입력 — 위 끝에서 들어와 여섯 대를 다 지나고 짝 없는 파랑 입구에서 멈춘다
  const FULL = { '-3': U(R, 8, 'input'), 2: U(R, 8, 'output'), 3: U(R, 8, 'input'), 8: U(R, 8, 'output'), 9: U(R, 8, 'input'), 14: U(R, 8, 'output'), 15: U(E, 8, 'input') };
  const col = (x, pat) => { for (const r in pat) { const [t, nm, d, ut] = pat[r]; one(x, Y0 + Number(r), t, nm, d, ut ? { undergroundType: ut } : {}); } };
  // 서쪽 면: 긴팔 x19(거리 1 → 거리 3 = x17 을 집는다) · x18(거리 2 → 거리 4 = x16). 동쪽 면: x23(→ x25) · x24(→ x26)
  col(17, TWO); col(17, OUT);   // A(a1 · a2) + B(출력)
  col(16, TWO); col(16, SIDE);  // C(c1 · c2) + D(d1)
  col(25, TWO); col(25, FULL);  // E(e1 · e2) + F(f1)
  col(26, TWO); col(26, SIDE);  // G(g1 · g2) + H(h1)
  const outRows = new Set([2, 3, 8, 9, 14, 15]);
  for (let r = 0; r < 18; r++) {
    const y = Y0 + r;
    one(19, y, 'LongInserter', 'long-handed-inserter', outRows.has(r) ? 4 : 12); // 인서터 방향 = 집는 쪽
    one(18, y, 'LongInserter', 'long-handed-inserter', 12);
    one(23, y, 'LongInserter', 'long-handed-inserter', 4);
    one(24, y, 'LongInserter', 'long-handed-inserter', 4);
  }
  // 레인 둘을 싣는 머리 칸 — 양옆에서 들어오는 두 벨트가 각자 자기 쪽 레인에 실린다
  const head2 = (hx, hy, hd, left, right) => {
    // left/right: [벨트 x, 벨트 y, 벨트 방향, 인서터 x, 인서터 y, 인서터 방향, 상자 x, 상자 y, 품목]
    belt(hx, hy, hd);
    for (const [bx, by, bd, ix, iy, id_, cx, cy, item] of [left, right]) { belt(bx, by, bd); src(ix, iy, id_, cx, cy, item); }
  };
  // ── 서쪽 위
  // A: 머리 (18,2) → x18 을 내려와 (18,9) 에서 서쪽으로 꺾고 (17,9) 에서 남쪽으로 꺾는다
  head2(18, 2, 8, [17, 2, 4, 16, 2, 12, 15, 2, a1], [19, 2, 12, 20, 2, 4, 21, 2, a2]);
  for (let y = 3; y <= 8; y++) belt(18, y, 8);
  belt(18, 9, 12);
  // B: (17,8) 출구 → 북으로 → (17,4) 에서 서쪽으로 → (13,4) 에서 버린다
  for (const y of [7, 6, 5]) belt(17, y, 0);
  for (const x of [17, 16, 15, 14, 13]) belt(x, 4, 12);
  snk(13, 3, 8, 13, 2); snk(13, 5, 0, 13, 6); snk(12, 4, 4, 11, 4);
  // C: 머리 (12,9) → 동쪽으로 → (16,9) 에서 남쪽으로 꺾는다
  head2(12, 9, 4, [12, 8, 8, 11, 8, 12, 10, 8, c1], [12, 10, 0, 11, 10, 12, 10, 10, c2]);
  for (const x of [13, 14, 15]) belt(x, 9, 4);
  // D: 행 8 · 9 의 지하 입구에 바깥 옆에서 붙인다(입구는 덮개 반대쪽 반에 닿는 레인 하나만 받는다)
  for (const x of [15, 14]) { belt(x, 18, 4); belt(x, 19, 4); }
  src(14, 17, 0, 14, 16, d1);  // 북향 입구 ← 남쪽 레인
  src(14, 20, 8, 14, 21, d1);  // 남향 입구 ← 북쪽 레인
  // ── 서쪽 아래
  head2(18, 35, 0, [17, 35, 4, 16, 35, 12, 15, 35, a1], [19, 35, 12, 20, 35, 4, 21, 35, a2]);
  for (let y = 29; y <= 34; y++) belt(18, y, 0);
  belt(18, 28, 12);
  for (const y of [30, 31, 32]) belt(17, y, 8);
  for (const x of [17, 16, 15, 14, 13]) belt(x, 33, 12);
  snk(13, 32, 8, 13, 31); snk(13, 34, 0, 13, 35); snk(12, 33, 4, 11, 33);
  head2(12, 28, 4, [12, 27, 8, 11, 27, 12, 10, 27, c1], [12, 29, 0, 11, 29, 12, 10, 29, c2]);
  for (const x of [13, 14, 15]) belt(x, 28, 4);
  // ── 동쪽 위
  // E: 머리 (24,1) → x24 를 내려와 (24,9) 에서 동쪽으로 꺾고 (25,9) 에서 남쪽으로 꺾는다
  head2(24, 1, 8, [23, 1, 4, 22, 1, 12, 21, 1, e1], [25, 1, 12, 26, 1, 4, 27, 1, e2]);
  for (let y = 2; y <= 8; y++) belt(24, y, 8);
  belt(24, 9, 4);
  // F: (25,5) 에 싣고 (25,7) 에서 땅속으로
  belt(25, 5, 8); belt(25, 6, 8); src(26, 5, 4, 27, 5, f1);
  // G: 머리 (30,9) → 서쪽으로 → (26,9) 에서 남쪽으로 꺾는다
  head2(30, 9, 12, [30, 8, 8, 31, 8, 4, 32, 8, g1], [30, 10, 0, 31, 10, 4, 32, 10, g2]);
  for (const x of [29, 28, 27]) belt(x, 9, 12);
  // H: 행 8 · 9 에 바깥 옆에서
  for (const x of [27, 28]) { belt(x, 18, 12); belt(x, 19, 12); }
  src(28, 17, 0, 28, 16, h1);
  src(28, 20, 8, 28, 21, h1);
  // ── 동쪽 아래
  head2(24, 36, 0, [23, 36, 4, 22, 36, 12, 21, 36, e1], [25, 36, 12, 26, 36, 4, 27, 36, e2]);
  for (let y = 29; y <= 35; y++) belt(24, y, 0);
  belt(24, 28, 4);
  head2(30, 28, 12, [30, 27, 8, 31, 27, 4, 32, 27, g1], [30, 29, 0, 31, 29, 4, 32, 29, g2]);
  for (const x of [29, 28, 27]) belt(x, 28, 12);

  const seen = new Map(); const dups = [];
  for (const p of placed) { const k = p.x + ',' + p.y; if (seen.has(k)) dups.push(k); seen.set(k, p); }
  if (dups.length) { console.log('겹친 칸', dups.join(' ')); return; }
  ls.getState().applyPlacedCells(placed);
  flg.flow.machines();
  flg.flow.breaks();
})();
