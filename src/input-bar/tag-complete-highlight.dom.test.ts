/**
 * 输入栏 `#` 补全候选列表的渲染测试(T8):`<mark>` 高亮段一律来自打分器,UI 不另写 matcher。
 * 断言真实 DOM 上的 mark 元素数量与文本,而不是组件内部字段。
 */
// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { CompleteItem } from '../shared/types';
import { TagCompleteList, pathPieces } from './TagCompleteList';
import { completeMatch } from './tag-complete';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const tag = (path: string): CompleteItem => ({ path, kind: 'tag' });
const alias = (path: string): CompleteItem => ({ path, kind: 'alias' });

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

/** 渲染候选列表(候选经真 `completeMatch` 投影,高亮段即打分器产物) */
async function renderList(
  candidates: CompleteItem[],
  token: string,
  pinned: string[] = []
): Promise<HTMLElement> {
  const items = completeMatch(candidates, token, { pinned });
  await act(async () => {
    root.render(createElement(TagCompleteList, { items, activeIndex: 0, onPick: () => undefined }));
  });
  const box = host.querySelector('[data-testid="tag-suggest"]');
  if (box === null) throw new Error('候选列表没渲染');
  return box as HTMLElement;
}

describe('pathPieces:命中段整段渲染(段数 == 打分器给的段数)', () => {
  it('跨父/末级边界的命中不切开:书籍/技 -> 1 段 + 加粗末级残段', () => {
    expect(pathPieces('书籍/技术', [{ start: 0, end: 4 }])).toEqual([
      { text: '书籍/技', hit: true, bold: false },
      { text: '术', hit: false, bold: true },
    ]);
  });

  it('无高亮段(空词元/别名项)时就是父段弱化 + 末级加粗', () => {
    expect(pathPieces('工作/项目A', [])).toEqual([
      { text: '工作/', hit: false, bold: false },
      { text: '项目A', hit: false, bold: true },
    ]);
    expect(pathPieces('工作', [])).toEqual([{ text: '工作', hit: false, bold: true }]);
  });

  it('离散命中按段渲染,段间文字原样保留;越界段被夹紧', () => {
    expect(pathPieces('工作/项目A', [{ start: 3, end: 4 }, { start: 5, end: 6 }])).toEqual([
      { text: '工作/', hit: false, bold: false },
      { text: '项', hit: true, bold: true },
      { text: '目', hit: false, bold: true },
      { text: 'A', hit: true, bold: true },
    ]);
    expect(pathPieces('甲', [{ start: 0, end: 99 }])).toEqual([{ text: '甲', hit: true, bold: true }]);
  });
});

describe('TagCompleteList:高亮段来自打分器', () => {
  it('离散命中逐字成段:项A -> 2 个 <mark>,段数 == 命中字符数', async () => {
    const box = await renderList([tag('工作/项目A')], '项A');
    const marks = [...box.querySelectorAll('mark')];
    expect(marks.map((m) => m.textContent)).toEqual(['项', 'A']);
    expect(marks).toHaveLength(2); // 命中 2 个字符且离散 -> 2 段
  });

  it('连续命中合成一段:项目 -> 1 个 <mark> 覆盖 2 个字符', async () => {
    const box = await renderList([tag('工作/项目A')], '项目');
    const marks = [...box.querySelectorAll('mark')];
    expect(marks.map((m) => m.textContent)).toEqual(['项目']);
    expect(marks[0].className).toContain('bg-accent-soft');
  });

  it('父段/末级分两段渲染时命中段跟着切,不标错位置', async () => {
    const box = await renderList([tag('工作/项目A')], '作项');
    const marks = [...box.querySelectorAll('mark')];
    expect(marks.map((m) => m.textContent)).toEqual(['作', '项']);
    expect(box.textContent).toBe('工作/项目A'); // 未命中部分原样保留
  });

  it('跨父/末级边界的连续命中仍是 1 个 <mark>(段数 == 打分器段数)', async () => {
    const box = await renderList([tag('书籍/技术')], '书籍/技');
    const marks = [...box.querySelectorAll('mark')];
    expect(marks.map((m) => m.textContent)).toEqual(['书籍/技']);
    expect(box.textContent).toBe('书籍/技术');
  });

  it('空词元与别名项无高亮段;固定项带 data-pinned', async () => {
    const empty = await renderList([tag('工作/项目A')], '');
    expect(empty.querySelectorAll('mark')).toHaveLength(0);
    const aliased = await renderList([alias('工作/项目A')], '项A');
    expect(aliased.querySelectorAll('mark')).toHaveLength(0);
    const pinnedBox = await renderList([tag('甲')], '', ['甲']);
    expect(pinnedBox.querySelectorAll('mark')).toHaveLength(0);
    expect(pinnedBox.querySelector('[data-pinned="true"]')).not.toBeNull();
  });
});
