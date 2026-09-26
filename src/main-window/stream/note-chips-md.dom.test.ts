// @vitest-environment jsdom
/**
 * 标签名行内 md(T1)在笔记 chip 上的接线证据:chip 文案是**完整路径的预览态**
 * (`地点/[郴](chēn)州市` -> `#地点/郴州市`),悬浮 title 是去掉语法的纯文本,
 * 而点击回传 / aria 之外的寻址仍是**原始路径**。
 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { NoteChips } from './NoteChips';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const RAW = '地点/[郴](chēn)州市';
const PLAIN = '地点/郴州市';

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

async function render(tags: string[]): Promise<HTMLElement[]> {
  await act(async () => {
    root.render(
      createElement(NoteChips, { tags, activeTags: [], onTagClick: (t: string) => clicked.push(t) })
    );
  });
  return [...host.querySelectorAll('button[aria-pressed]')] as HTMLElement[];
}

describe('T1 笔记 chip:完整路径的预览态 + 悬浮备注', () => {
  it('chip 显示 #地点/郴州市,悬浮 title 是纯文本,「郴」上挂 title=chēn', async () => {
    const [chip] = await render([RAW]);
    expect(chip.textContent).toBe(`#${PLAIN}`);
    expect(chip.getAttribute('title')).toBe(PLAIN);
    expect(chip.querySelector('span[title="chēn"]')?.textContent).toBe('郴');
    expect(chip.querySelector('a')).toBeNull();
  });

  it('点击 chip 回传原始路径(语法不参与寻址)', async () => {
    const [chip] = await render([RAW]);
    await act(async () => chip.click());
    expect(clicked).toEqual([RAW]);
  });

  it('普通路径 chip 逐字不变', async () => {
    const [chip] = await render(['工作/会议']);
    expect(chip.textContent).toBe('#工作/会议');
    expect(chip.querySelector('span')).toBeNull();
  });
});
