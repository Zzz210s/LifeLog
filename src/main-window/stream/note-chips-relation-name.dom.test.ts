// @vitest-environment jsdom
/**
 * T4 显示口径:chip 文字仍是**完整路径**,悬停 title 是**关系名**
 * (无名字回落纯文本路径),点击仍回传**原始路径**。
 * 名字只影响悬停文案,不进折叠 / 祖先去重 / 寻址(设计 §5.3)。
 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { noteTag } from '../../shared/__fixtures__/note-tag';
import type { NoteTag } from '../../shared/types';
import { NoteChips } from './NoteChips';

/** 让元素看起来"被 CSS 截断"(jsdom 里 scrollWidth/clientWidth 恒 0):随后触发 React 的 onMouseEnter */
function markTruncated(el: HTMLElement): void {
  Object.defineProperty(el, 'scrollWidth', { value: 999, configurable: true });
  Object.defineProperty(el, 'clientWidth', { value: 100, configurable: true });
}

/** 悬停只在被截断时挂 title(见 truncate-title),故先伪装截断再派发 mouseover */
function hover(chip: HTMLElement): void {
  markTruncated(chip);
  chip.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
}

// React 要求显式声明「这是 act 环境」,否则 act() 会打印告警
declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;
let clicked: string[];

beforeEach(() => {
  clicked = [];
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

async function render(tags: NoteTag[]): Promise<HTMLElement[]> {
  await act(async () => {
    root.render(
      createElement(NoteChips, { tags, activeTags: [], onTagClick: (t: string) => clicked.push(t) })
    );
  });
  return [...host.querySelectorAll('button[aria-pressed]')] as HTMLElement[];
}

describe('T4 笔记 chip:文字=路径,悬停=关系名', () => {
  it('hover_shows_relation_name_when_present', async () => {
    const [chip] = await render([noteTag('地点/日本', '国籍')]);
    expect(chip.textContent).toBe('#地点/日本');
    hover(chip);
    expect(chip.getAttribute('title')).toBe('国籍');
  });

  it('hover_falls_back_to_plain_path_without_name', async () => {
    const [chip] = await render([noteTag('工作/会议')]);
    expect(chip.textContent).toBe('#工作/会议');
    hover(chip);
    expect(chip.getAttribute('title')).toBe('工作/会议');
  });

  it('hover_falls_back_to_plain_text_when_path_has_md', async () => {
    const [chip] = await render([noteTag('地点/[郴](chēn)州市')]);
    expect(chip.textContent).toBe('#地点/郴州市');
    hover(chip);
    expect(chip.getAttribute('title')).toBe('地点/郴州市');
  });

  it('click_still_returns_raw_path', async () => {
    const [chip] = await render([noteTag('地点/[郴](chēn)州市', '祖籍')]);
    await act(async () => chip.click());
    expect(clicked).toEqual(['地点/[郴](chēn)州市']);
  });
});
