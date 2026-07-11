import { describe, it, expect } from "vitest";
import { cellKey } from "../util/helper";
import {
  routePortToPerimeter,
  type Pt,
  type Rect,
} from "./perimeterRouter";
import { segment } from "../util/helper";

/** obstacle Set 헬퍼 — 사각형(inclusive) footprint 채우기. */
function fillRect(occ: Set<string>, r: Rect): void {
  for (let x = r.minX; x <= r.maxX; x++)
    for (let y = r.minY; y <= r.maxY; y++) occ.add(cellKey(x, y));
}

const key = (p: Pt) => cellKey(p.x, p.y);

describe("perimeterRouter — segment", () => {
  it("start 제외, end 포함, 축정렬 확장", () => {
    expect(segment({ x: 0, y: 0 }, { x: 0, y: 3 })).toEqual([
      { x: 0, y: 1 }, { x: 0, y: 2 }, { x: 0, y: 3 },
    ]);
    expect(segment({ x: 2, y: 5 }, { x: 2, y: 5 })).toEqual([]);
  });
});

describe("perimeterRouter — hint 모드(production 재현)", () => {
  const perimeter: Rect = { minX: -1, minY: -1, maxX: 11, maxY: 11 };

  it("self/margin → 직선. N 면 위로 곧장 seat.", () => {
    const r = routePortToPerimeter({
      anchor: { x: 5, y: 3 },
      face: "N",
      perimeter,
      obstacles: new Set(),
      hint: { exitEdge: "N", host: { kind: "self" } },
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.exitEdge).toBe("N");
    expect(r.seat).toEqual({ x: 5, y: -1 }); // perimeter.minY
    // 경로는 anchor 바로 위부터 seat 까지 수직.
    expect(r.path[0]).toEqual({ x: 5, y: 2 });
    expect(r.path.at(-1)).toEqual({ x: 5, y: -1 });
  });

  it("직선이 막히면 ok:false (skip 사유).", () => {
    const occ = new Set<string>();
    occ.add(cellKey(5, 1)); // 위쪽 경로 한 칸 막음
    const r = routePortToPerimeter({
      anchor: { x: 5, y: 3 },
      face: "N",
      perimeter,
      obstacles: occ,
      hint: { exitEdge: "N", host: { kind: "self" } },
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toMatch(/straight blocked/);
  });

  it("channel host → face(E) 방향 가로 jog 후 세로(ㄱ자).", () => {
    // anchor 바로 위(N)를 막아 직선 불가하게, E 쪽 한 칸(x=6) 은 열어둠.
    const occ = new Set<string>();
    for (let y = -1; y <= 3; y++) occ.add(cellKey(5, y - 0)); // x=5 세로 전부 막음(anchor 제외 위)
    occ.delete(cellKey(5, 3)); // anchor 자리는 검사 안 함
    const r = routePortToPerimeter({
      anchor: { x: 5, y: 3 },
      face: "E",
      perimeter,
      obstacles: occ,
      hint: { exitEdge: "N", host: { kind: "channel", depth: 1 } },
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.exitEdge).toBe("N");
    expect(r.seat.y).toBe(-1);
    expect(r.seat.x).toBeGreaterThan(5); // E 방향으로 jog 한 lane
    // 경로 전부 비어 있어야.
    for (const c of r.path) expect(occ.has(key(c))).toBe(false);
  });

  it("channel + face 세로(N) + laneX 없음 → 진입 방향 불명이라 거부.", () => {
    const r = routePortToPerimeter({
      anchor: { x: 5, y: 3 },
      face: "N",
      perimeter,
      obstacles: new Set(),
      hint: { exitEdge: "N", host: { kind: "channel", depth: 1 } },
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toMatch(/without laneX/);
  });

  it("channel + face 세로(N) + laneX 있음 → 코너 어깨 상자도 예약 트랙 재생.", () => {
    // face 가 N(fv.x=0)이라 옛 코드는 무조건 거부했으나, laneX 가 확정돼 있으면 가로
    // 진입 방향(laneX−anchor.x)이 정해지므로 elbow 를 그대로 재생한다.
    const r = routePortToPerimeter({
      anchor: { x: 5, y: 3 },
      face: "N",
      perimeter,
      obstacles: new Set(),
      hint: { exitEdge: "N", host: { kind: "channel", depth: 1 }, laneX: 8 },
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.exitEdge).toBe("N");
    expect(r.seat).toEqual({ x: 8, y: -1 }); // laneX=8, N 변(perimeter.minY)
    expect(r.path[0]).toEqual({ x: 6, y: 3 }); // 가로 진입 시작
    expect(r.path.at(-1)).toEqual({ x: 8, y: -1 }); // 세로 주행 끝(N 변)
  });
});

describe("perimeterRouter — auto 모드(DevTool 탐색)", () => {
  const perimeter: Rect = { minX: 0, minY: 0, maxX: 20, maxY: 20 };

  it("장애물 없으면 face 변으로 직선.", () => {
    const r = routePortToPerimeter({
      anchor: { x: 10, y: 8 },
      face: "S",
      perimeter,
      obstacles: new Set(),
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.exitEdge).toBe("S");
    expect(r.seat).toEqual({ x: 10, y: 20 });
  });

  it("face 변 직선이 형제 박스에 막히면 L 우회로 도달(⑥C+ 일반화).", () => {
    // 블랙박스 A: 포트 소유(위 테두리 y=8, anchor=(10,8), face=N).
    // 위쪽에 형제 박스가 x=10 열을 막음 → 직선 N 불가. 옆으로 우회해야.
    const occ = new Set<string>();
    fillRect(occ, { minX: 6, minY: 2, maxX: 12, maxY: 6 }); // 형제(anchor 위 가로로 막음)
    const r = routePortToPerimeter({
      anchor: { x: 10, y: 8 },
      face: "N",
      perimeter,
      obstacles: occ,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // 어느 변으로든 도달, 경로는 전부 빈 셀.
    for (const c of r.path) expect(occ.has(key(c))).toBe(false);
    // seat 는 perimeter 한 변 위.
    const onEdge =
      r.seat.x === 0 || r.seat.x === 20 || r.seat.y === 0 || r.seat.y === 20;
    expect(onEdge).toBe(true);
  });

  it("완전히 둘러싸이면 ok:false.", () => {
    // anchor 를 사방으로 1칸씩 막아 어떤 경로도 불가.
    const occ = new Set<string>();
    fillRect(occ, { minX: 4, minY: 4, maxX: 16, maxY: 16 });
    occ.delete(cellKey(10, 10)); // anchor 자리만 비움
    const r = routePortToPerimeter({
      anchor: { x: 10, y: 10 },
      face: "N",
      perimeter,
      obstacles: occ,
      maxJog: 4,
    });
    expect(r.ok).toBe(false);
  });

  it("결정적: 같은 입력 → 같은 출력.", () => {
    const occ = new Set<string>();
    fillRect(occ, { minX: 6, minY: 2, maxX: 12, maxY: 6 });
    const req = {
      anchor: { x: 10, y: 8 },
      face: "N" as const,
      perimeter,
      obstacles: occ,
    };
    const a = routePortToPerimeter(req);
    const b = routePortToPerimeter(req);
    expect(a).toEqual(b);
  });
});
