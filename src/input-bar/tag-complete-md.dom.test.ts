// @vitest-environment jsdom
/**
 * 标签名行内 md(T1)在 `#` 补全候选上的接线证据:
 * 打分器给的高亮下标基于**原始路径**,而显示位是去掉语法的纯文本 —— 下标必须重新定位,
 * 定位不到就退化为「不细分高亮」,不能标错位、更不能崩。
 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { CompleteItem } from '../shared/types';
import { TagCompleteList } from './TagCompleteList';
import type { CompleteRow } from './tag-complete';
import { completeMatch } from './tag-complete';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const RAW = '地点/[郴](chēn)州市';
const PLAIN = '地点/郴州市';

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

function render(items: CompleteRow[]): HTMLElement {
  act(() => {
    root.render(createElement(TagCompleteList, { items, activeIndex: 0, onPick: () => undefined }));
  });
  return host.querySelector('[data-testid="tag-suggest"]') as HTMLElement;
}

describe('T1 # 补全:高亮下标重定位', () => {
  it('按原始路径打分后,高亮落到纯文本里的同一段(郴),可见文本是完整纯文本', () => {
    const items = completeMatch([{ path: RAW, kind: 'tag' }] as CompleteItem[], '郴');
    expect(items).toHaveLength(1);
    const box = render(items);
    const row = box.querySelector('button') as HTMLElement;
    expect(row.textContent).toBe(PLAIN);
    expect(row.getAttribute('title')).toBe(PLAIN);
    const marks = [...row.querySelectorAll('mark')];
    expect(marks.map((m) => m.textContent)).toEqual(['郴']);
    expect(row.querySelector('a')).toBeNull();
  });

  it('命中段跨过被去掉的语法符号(定位不到)时退化为无高亮,仍正常显示', () => {
    const box = render([
      { path: RAW, kind: 'tag', ranges: [{ start: 0, end: 4 }], pinned: false },
    ]);
    const row = box.querySelector('button') as HTMLElement;
    expect(row.textContent).toBe(PLAIN);
    expect(row.querySelectorAll('mark')).toHaveLength(0);
  });

  it('无 md 语法的路径行为不变(原样透传高亮段)', () => {
    const items = completeMatch([{ path: '工作/会议', kind: 'tag' }] as CompleteItem[], '会');
    const row = render(items).querySelector('button') as HTMLElement;
    expect(row.textContent).toBe('工作/会议');
    expect(row.querySelector('mark')?.textContent).toBe('会');
  });
});
