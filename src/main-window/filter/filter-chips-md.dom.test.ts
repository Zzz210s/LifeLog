// @vitest-environment jsdom
/**
 * 标签名行内 md(T1)在筛选 chip / 中文摘要上的接线证据:
 * 这两处是**字符串位**,一律走 tagLabelPlain —— `地点/[郴](chēn)州市` -> `地点/郴州市`,
 * 不能把 `[郴](chēn)` 原样摆进 chip 文案或摘要。
 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EMPTY_FILTER } from '../../shared/filter-conditions';
import { FilterChips } from './FilterChips';
import { chipsOf, summaryOf, summaryTitleOf } from './filter-chips';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const RAW = '地点/[郴](chēn)州市';
const PLAIN = '地点/郴州市';
const WITH_TAG = { ...EMPTY_FILTER, tags: [{ path: RAW, includeChildren: false }] };

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

describe('T1 筛选 chip / 摘要:纯文本口径', () => {
  it('chip label 与摘要、摘要 title 都用去掉语法后的路径', () => {
    const [chip] = chipsOf(WITH_TAG);
    expect(chip.label).toBe(`#${PLAIN}`);
    expect(summaryOf(WITH_TAG)).toBe(`标签 ${PLAIN}+携带`);
    expect(summaryTitleOf(WITH_TAG)).toBe(`标签 ${PLAIN}+携带`);
  });

  it('排除侧的 chip 与摘要同样走纯文本', () => {
    const c = { ...EMPTY_FILTER, excludeTags: [{ path: RAW, includeChildren: true }] };
    expect(chipsOf(c)[0].label).toBe(`排除 ⊢ #${PLAIN}`);
    expect(summaryOf(c)).toBe(`排除 ${PLAIN}+携带`);
  });

  it('渲染出的 chip 里没有 md 语法残渣', () => {
    act(() => root.render(createElement(FilterChips, { chips: chipsOf(WITH_TAG), onRemove: () => {} })));
    const chip = host.querySelector('[aria-label="已生效的筛选条件"] > span') as HTMLElement;
    expect(chip.textContent).toContain(`#${PLAIN}`);
    expect(chip.textContent).not.toContain('[郴]');
  });
});
