/**
 * `place <놓기 파일> --as <이름>` — 손으로 만든 배치를 작업 폴더에 둔다.
 *
 * 놓기 파일은 **엔티티 단위**다(머신은 위 왼쪽 한 번). 칸으로 펼치는 일은 `layoutLink/codec.cellsOfPlacements`.
 *
 * ```json
 * {
 *   "title": "모든 머신에 줄 셋",
 *   "prototypes": "kit.json",                     // 또는 { "entities": [...], "recipes": [...] } — 파일 경로는 이 파일 기준
 *   "entities": [], "recipes": [],                // 여기 적은 것이 prototypes 의 같은 이름을 이긴다
 *   "inserterOverrides": { "inserter": { "throughput": 100 } },
 *   "place": [ { "x": 4, "y": 4, "name": "fl-plant", "recipe": "fl4-thing" },
 *              { "x": 2, "y": 4, "name": "inserter", "dir": "W" },
 *              { "x": 3, "y": 3, "name": "underground-belt", "dir": "S", "ug": "input" },
 *              { "x": 0, "y": 4, "name": "infinity-chest", "supply": ["iron-plate"] } ],
 *   "labels": [ { "x": 3, "y": 4, "text": "b1" } ]
 * }
 * ```
 *
 * 인서터의 `dir` 은 **집는 쪽**이다(앱 · 게임 규약 — 메모리 `inserter_direction_convention`).
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import {
  cellsOfPlacements, gridFromPayload, payloadFromGrid, prototypesOf,
  type LayoutLinkPayload, type Placement,
} from '../../src/layoutLink/codec';
import type { Entity, Module, Recipe } from '../../src/types/gameData';
import { EXIT, head, parseArgs, PROGRAM, Refusal, writeLayout } from '../io';

interface Prototypes { entities?: Entity[]; recipes?: Recipe[]; modules?: Module[] }

interface PlaceFile extends Prototypes {
  title?: string;
  prototypes?: string | Prototypes;
  inserterOverrides?: LayoutLinkPayload['inserterOverrides'];
  interiorBbox?: LayoutLinkPayload['interiorBbox'];
  place?: Placement[];
  labels?: LayoutLinkPayload['labels'];
}

const readJson = <T>(path: string, what: string): T => {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as T;
  } catch (e) {
    throw new Refusal(`${what} '${path}' 를 못 읽었다 — ${(e as Error).message}`);
  }
};

export function place(args: string[]): number {
  const { positional, options } = parseArgs(args);
  const file = positional[0];
  const name = options.get('as');
  if (!file || !name) throw new Refusal(`쓰는 법: ${PROGRAM} place <놓기 파일> --as <이름>`);
  const path = resolve(file);
  const input = readJson<PlaceFile>(path, '놓기 파일');
  if (!Array.isArray(input.place) || input.place.length === 0) throw new Refusal(`놓기 파일에 "place" 목록이 없다`);

  // 프로토타입 — 파일(또는 그 자리의 객체) 다음에 이 파일의 것. 같은 이름이면 나중 것이 이긴다.
  const base: Prototypes = typeof input.prototypes === 'string'
    ? readJson<Prototypes>(resolve(dirname(path), input.prototypes), '프로토타입 파일')
    : input.prototypes ?? {};
  const merged: LayoutLinkPayload = {
    v: 1,
    entities: [...(base.entities ?? []), ...(input.entities ?? [])],
    recipes: [...(base.recipes ?? []), ...(input.recipes ?? [])],
    modules: [...(base.modules ?? []), ...(input.modules ?? [])],
    cells: [],
  };
  const lookup = prototypesOf(merged);

  const { cells, problems } = cellsOfPlacements(input.place, lookup.entityMap);
  input.place.forEach((pl, i) => {
    if (pl.recipe && !lookup.recipeMap.has(pl.recipe)) problems.push(`${i}번 (${pl.x},${pl.y}) 레시피 ${pl.recipe} — 프로토타입이 없다`);
  });
  if (problems.length > 0) throw new Refusal(`놓을 수 없는 것 ${problems.length}개\n  ${problems.join('\n  ')}`);

  let grid;
  try {
    grid = gridFromPayload({ ...merged, cells });
  } catch (e) {
    throw new Refusal(`칸이 맞지 않는다 — ${(e as Error).message}`);
  }
  const { payload } = payloadFromGrid(grid, lookup, {
    title: input.title,
    inserterOverrides: input.inserterOverrides,
    interiorBbox: input.interiorBbox,
    labels: input.labels,
  });
  const saved = writeLayout(name, `place ${file}`, payload);

  console.log(head('place', `${file} → ${name}`, `엔티티 ${input.place.length} · 칸 ${payload.cells.length} · ${grid.width - 1}×${grid.height - 1}`));
  console.log(`  저장 ${saved}`);
  console.log(`  다음: ${PROGRAM} flow ${name} · ${PROGRAM} link ${name}`);
  return EXIT.ok;
}
