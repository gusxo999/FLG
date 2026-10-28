/**
 * `link <이름> [--open | --copy] [--app <앱 주소>]` — 배치 → 링크.
 * `link <링크> --as <이름>` · `link --clipboard --as <이름>` — 링크 → 배치(사람이 화면에서 손본 배치를 받는다).
 *
 * 링크는 배치와 쓰인 프로토타입을 담는다(`layoutLink/codec`). 앱 주소 기본값은 개발 서버(`npm run dev`).
 *
 * **링크를 손으로 옮기지 않는 길이 기본이다**(`cli/system.ts`). 사람이 「링크 복사」 하면 `--clipboard` 로 읽고,
 * 사람에게 보일 때는 `--open`(이 컴퓨터의 브라우저에 바로) 이나 `--copy`(클립보드에) 로 넘긴다.
 */

import { decodeLayoutLink, gridFromPayload, layoutLinkUrl } from '../../src/layoutLink/codec';
import { EXIT, head, parseArgs, PROGRAM, readLayout, Refusal, writeLayout } from '../io';
import { openInBrowser, readClipboard, writeClipboard } from '../system';

const DEFAULT_APP = 'http://localhost:5173/';

export function link(args: string[]): number {
  const { positional, options } = parseArgs(args, ['clipboard', 'open', 'copy']);
  const fromClipboard = options.has('clipboard');
  const target = fromClipboard ? readClipboard() : positional[0];
  if (!target) {
    throw new Refusal(`쓰는 법: ${PROGRAM} link <이름> [--open | --copy] · ${PROGRAM} link --clipboard --as <이름> · ${PROGRAM} link <링크> --as <이름>`);
  }

  const as = options.get('as');
  if (as) {
    let payload;
    try {
      payload = decodeLayoutLink(target);
      gridFromPayload(payload);
    } catch (e) {
      throw new Refusal(`${fromClipboard ? '클립보드의 글이 ' : ''}${(e as Error).message}`);
    }
    const saved = writeLayout(as, fromClipboard ? 'link --clipboard' : 'link', payload);
    console.log(head('link', `${fromClipboard ? '클립보드' : '링크'} → ${as}`, `칸 ${payload.cells.length} · 프로토타입 ${payload.entities.length} · 글 ${payload.labels?.length ?? 0}`
      + (payload.title ? ` · ${payload.title}` : '')));
    console.log(`  저장 ${saved}`);
    console.log(`  다음: ${PROGRAM} flow ${as}`);
    return EXIT.ok;
  }
  if (fromClipboard) throw new Refusal(`클립보드에서 읽을 때는 --as <이름> 으로 받을 이름을 준다`);

  const stored = readLayout(target);
  const url = layoutLinkUrl(options.get('app') ?? DEFAULT_APP, stored.payload);
  if (options.has('open')) {
    openInBrowser(url);
    console.log(head('link', `${target}, open`, `브라우저에 열었다 · ${url.length}자 · 칸 ${stored.payload.cells.length}`));
  } else if (options.has('copy')) {
    writeClipboard(url);
    console.log(head('link', `${target}, copy`, `클립보드에 넣었다 · ${url.length}자 · 칸 ${stored.payload.cells.length}`));
  } else {
    console.log(head('link', target, `${url.length}자 · 칸 ${stored.payload.cells.length}`));
    console.log(url);
  }
  return EXIT.ok;
}
