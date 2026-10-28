/**
 * factoriolayoutgen — 터미널에서 배치를 다루는 프로그램. 시작 파일은 저장소 루트의 `factoriolayoutgen.mjs`.
 *
 * **지금은 AI 와 형태를 토론하는 데 필요한 만큼만 있다**(2026-10-18 사용자). 손으로 만든 배치를 두고(`place`),
 * 재고(`flow`), 사람에게 링크로 보이고 · 사람이 손본 링크를 받는다(`link`). 정해 둔 나머지 명령(gamedata · custom ·
 * make · report · side · check · compare · lines)은 이름만 정해져 있다 — `tempPlanDocs/CLI-앱/CLAUDE.md` 결정 기록.
 */

import { flow } from './commands/flow';
import { link } from './commands/link';
import { place } from './commands/place';
import { EXIT, head, listLayouts, PROGRAM, Refusal } from './io';

const NOT_YET = ['gamedata', 'custom', 'make', 'report', 'side', 'check', 'compare', 'lines'];

const HELP = `${PROGRAM} — 배치를 터미널에서 다룬다(지금은 형태 토론에 필요한 만큼)

  place <놓기 파일> --as <이름>     손으로 만든 배치를 둔다(엔티티 단위 · 쓰는 프로토타입을 함께 준다)
  flow <이름> [machines]            머신마다 가동률 — 앱 캔버스의 테두리와 같은 답
  flow <이름> at <x> <y>            칸 하나 — 레인별 흐름 · 인서터
  flow <이름> breaks                끊김 — 닿지 않은 팔 · 마주 본 벨트
  link <이름> --open                사람에게 보인다 — 이 컴퓨터의 브라우저에 바로 연다(앱은 npm run dev 의 localhost:5173)
  link <이름> --copy                링크를 클립보드에 넣는다(사람이 주소창에 붙여 넣는다)
  link <이름> [--app <앱 주소>]     링크를 찍는다 — 옮겨 적으면 틀리므로 위 둘을 먼저 쓴다
  link --clipboard --as <이름>      사람이 화면에서 손보고 「링크 복사」 한 것을 클립보드에서 받는다
  link <링크> --as <이름>           링크 글을 직접 준다
  list                              작업 폴더의 배치
  help                              이 글

  종료 코드  0 해냈다 · 1 거절(까닭과 다음 명령) · 2 가동률 미달 · 3 예기치 않은 예외
  작업 폴더  <저장소>/.${PROGRAM}/layouts/<이름>.json`;

function list(): number {
  const all = listLayouts();
  console.log(head('list', '', `배치 ${all.length}`));
  for (const l of all) {
    console.log(`  ${l.name.padEnd(24)} 칸 ${String(l.payload.cells.length).padStart(5)}  ${l.savedAt.slice(0, 16)}  ${l.from}`
      + (l.payload.title ? `  — ${l.payload.title}` : ''));
  }
  return EXIT.ok;
}

function run(argv: string[]): number {
  const [command, ...args] = argv;
  switch (command) {
    case 'place': return place(args);
    case 'flow': return flow(args);
    case 'link': return link(args);
    case 'list': return list();
    case undefined:
    case 'help':
    case '--help':
      console.log(HELP);
      return EXIT.ok;
    default:
      if (NOT_YET.includes(command)) {
        throw new Refusal(`'${command}' 는 이름만 정해져 있고 아직 없다 — 지금 있는 것: place · flow · link · list`);
      }
      throw new Refusal(`'${command}' 를 모른다 — ${PROGRAM} help`);
  }
}

try {
  process.exitCode = run(process.argv.slice(2));
} catch (e) {
  if (e instanceof Refusal) {
    console.log(head(process.argv[2] ?? '', process.argv.slice(3).join(' '), `거절 — ${e.message}`));
    process.exitCode = EXIT.refused;
  } else {
    console.error(e instanceof Error ? e.stack ?? e.message : String(e));
    process.exitCode = EXIT.crash;
  }
}
