/**
 * customData — 커스텀 머신을 **텍스트로 본다.**
 *
 * [faceTable](module/ledger/face.ts) 과 같은 장르다. 화면을 못 보는 쪽이 *"유체 상자가 어느 면 어느
 * 행에 앉았나"* 를 확인할 수 있는 유일한 통로이고, 그 확인 없이는 커스텀 머신이 맞게
 * 만들어졌는지 **알 방법이 없다** — 배치를 돌려 거절 사유를 보는 것이 유일한 신호가 된다.
 *
 * 판정은 여기서 다시 하지 않는다. [fitFluidLines](../factorio/customRecipeValidate.ts) 가
 * 내는 답을 그리기만 한다 — *"검사는 통과인데 그림은 다르다"* 가 생길 자리를 없앤다.
 */

import {
  CUSTOM_FACES,
  roleOrdinals,
  type CustomDataSpec,
  type CustomFace,
  type CustomMachineSpec,
  type CustomRecipeSpec,
} from '../factorio/customRecipe';
import {
  fitFluidLines,
  validateCustomData,
  type CustomDataIssue,
  type ValidateContext,
} from '../factorio/customRecipeValidate';

/** 유체 상자 하나의 짧은 이름 — 역할별 서수라서 레시피의 `fluidbox_index` 와 같은 번호다. */
function boxLabels(machine: CustomMachineSpec): string[] {
  const ins = roleOrdinals(machine.fluidBoxes, 'input');
  const outs = roleOrdinals(machine.fluidBoxes, 'output');
  return machine.fluidBoxes.map((fb, i) =>
    fb.role === 'input' ? `i${ins.get(i)}`
      : fb.role === 'output' ? `o${outs.get(i)}`
        : `io${ins.get(i)}/${outs.get(i)}`,
  );
}

/** 면·행 → 그 칸에 앉은 상자의 라벨. 같은 칸에 둘이면 마지막이 남는다(검증이 이미 막는다). */
function labelAt(machine: CustomMachineSpec, labels: string[]): Map<string, string> {
  const out = new Map<string, string>();
  machine.fluidBoxes.forEach((fb, i) => out.set(`${fb.face}${fb.offset}`, labels[i]));
  return out;
}

/**
 * 머신의 발자국과 유체 상자를 그린다. **회전 0 기준**이다 — 파이프라인이 고르는 각도는
 * 아래 적합 절에 따로 적는다.
 */
export function renderCustomMachine(
  machine: CustomMachineSpec,
  recipes: readonly CustomRecipeSpec[] = [],
): string {
  const n = machine.size;
  const labels = boxLabels(machine);
  const at = labelAt(machine, labels);
  const W = Math.max(3, ...labels.map((l) => l.length));
  const pad = (s: string) => s.padStart(W).slice(0, Math.max(W, s.length));
  const cell = (f: CustomFace, k: number) => pad(at.get(`${f}${k}`) ?? '·');

  const cols = Array.from({ length: n }, (_, k) => k);
  const gut = ' '.repeat(W + 3); // 왼쪽 여백(W 면 라벨 + 'W │')

  const lines: string[] = [];
  lines.push(
    `${machine.name} ${n}×${n}  ·  속도 ${machine.craftingSpeed}  ·  카테고리 ${machine.craftingCategories.join(', ')}`,
  );
  lines.push('');
  lines.push(`${gut}  ${cols.map((k) => cell('N', k)).join(' ')}    N 면`);
  lines.push(`${gut}┌${'─'.repeat(n * (W + 1) + 1)}┐`);
  for (let r = 0; r < n; r++) {
    const body = cols.map(() => pad('·')).join(' ');
    lines.push(`${pad(at.get(`W${r}`) ?? '·')} W │ ${body} │ E ${at.get(`E${r}`) ?? '·'}   ${r}행`);
  }
  lines.push(`${gut}└${'─'.repeat(n * (W + 1) + 1)}┘`);
  lines.push(`${gut}  ${cols.map((k) => cell('S', k)).join(' ')}    S 면`);
  lines.push(`${gut}  ${cols.map((k) => pad(String(k))).join(' ')}    열`);

  if (machine.fluidBoxes.length === 0) {
    lines.push('', '유체 상자 없음 — 아이템만 쓰는 머신이다.');
  }

  for (const recipe of recipes) {
    lines.push('', ...renderFit(machine, recipe));
  }
  return lines.join('\n');
}

const DEG: Record<number, string> = { 0: '0°', 4: '90°', 8: '180°', 12: '270°' };

/** 한 (머신, 레시피) 짝의 적합 — 고른 회전과 줄별 자리, 또는 못 앉는 사유. */
export function renderFit(machine: CustomMachineSpec, recipe: CustomRecipeSpec): string[] {
  const fit = fitFluidLines(machine, recipe);
  const head = `레시피 ${recipe.name} — ${machine.name} 에서`;
  if (!fit.ok) {
    return [
      `${head}: ✗ ${fit.kind}`,
      `  ${fit.detail}`,
      fit.kind === 'fluid-no-rotation'
        ? '  파이프라인은 입력이 E · 출력이 W 로 오는 회전을 찾는다 — 두 면이 마주봐야 한다.'
        : '  못박은 상자 번호를 지우면(미지정) 그 역할의 상자 전부에 들어갈 수 있다.',
    ];
  }
  if (fit.lines.length === 0) return [`${head}: 유체 줄 없음 — 회전 제약이 없다.`];

  const rows = fit.lines.map(
    (l) =>
      `  ${l.name} (${l.role}) → ${l.side} 면 ${l.fluidboxOffset}행 · 프로토타입 상자 #${l.boxIndex + 1} · 순번 ${l.rank}`,
  );
  const unused = CUSTOM_FACES.flatMap((f) =>
    (fit.unused[f] ?? []).map((row) => `${f}${row}`),
  );
  return [
    `${head}: ✓ 회전 ${fit.direction} (${DEG[fit.direction] ?? '?'})`,
    ...rows,
    unused.length > 0
      ? `  안 쓰는 유체 상자 칸: ${unused.join(' · ')}  (트렁크가 이 행을 스치면 합류 가드가 거절한다)`
      : '  안 쓰는 유체 상자 칸: 없음',
  ];
}

/** 검증 결과를 사람이 읽을 블록으로. 거절이 없으면 한 줄. */
export function renderIssues(issues: readonly CustomDataIssue[]): string {
  if (issues.length === 0) return '문제 없음.';
  return issues
    .map((i) => `${i.severity === 'reject' ? '✗' : '⚠'} [${i.kind}] ${i.where}\n    ${i.detail}\n    → ${i.fix}`)
    .join('\n');
}

/** 한 벌 전체 요약 — `flg.custom.list()` 가 쓴다. */
export function renderSummary(spec: CustomDataSpec, ctx: ValidateContext): string {
  if (spec.machines.length === 0 && spec.recipes.length === 0) {
    return '커스텀 없음 — flg.custom.template(3) 로 뼈대를 받는다.';
  }
  const lines: string[] = [];
  lines.push(`머신 ${spec.machines.length}개 · 레시피 ${spec.recipes.length}개`);
  for (const m of spec.machines) {
    const boxes = m.fluidBoxes.map((fb, i) => `${boxLabels(m)[i]}@${fb.face}${fb.offset}`).join(' ');
    lines.push(`  [머신] ${m.name}  ${m.size}×${m.size}  속도 ${m.craftingSpeed}  ${boxes || '(유체 상자 없음)'}`);
  }
  for (const r of spec.recipes) {
    const io = `${r.ingredients.map((s) => `${s.amount}×${s.name}`).join('+') || '—'} → ${r.products.map((s) => `${s.amount}×${s.name}`).join('+') || '—'}`;
    lines.push(`  [레시피] ${r.name}  (${r.category}, ${r.energyRequired}s)  ${io}`);
  }
  const issues = validateCustomData(spec, ctx);
  if (issues.length > 0) lines.push('', renderIssues(issues));
  return lines.join('\n');
}

/**
 * 채워 넣을 뼈대. **AI 가 형식을 안 틀리게 하는 것이 목적**이라 값이 아니라 **모양**이
 * 요점이다.
 *
 * 그래서 두 가지를 일부러 지킨다:
 *  - 입력 유체 상자와 출력 유체 상자가 **마주보는 면**에 있다 — 아니면 어떤 회전에도 안 앉는다.
 *  - 레시피가 그 상자를 **둘 다 쓴다.** 안 쓰는 상자를 남기면 트렁크 파이프가 그 행을 스쳐
 *    합류 가드에 걸릴 수 있고, 뼈대가 그런 모양을 가르치면 안 된다.
 */
export function customTemplate(size = 3): CustomDataSpec {
  return {
    machines: [
      {
        name: 'my-plant',
        size,
        craftingSpeed: 1,
        craftingCategories: ['custom-my-thing'],
        moduleSlots: 0,
        fluidBoxes: [
          { role: 'input', face: 'W', offset: 0 },
          { role: 'output', face: 'E', offset: size - 1 },
        ],
      },
    ],
    recipes: [
      {
        name: 'my-thing',
        category: 'custom-my-thing',
        energyRequired: 1,
        ingredients: [
          { name: 'iron-plate', amount: 2, type: 'item' },
          { name: 'water', amount: 50, type: 'fluid' },
        ],
        products: [
          { name: 'my-thing', amount: 1, type: 'item' },
          { name: 'steam', amount: 50, type: 'fluid' },
        ],
      },
    ],
  };
}
