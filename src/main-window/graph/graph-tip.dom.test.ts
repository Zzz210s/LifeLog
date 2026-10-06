// @vitest-environment jsdom
/**
 * 画布气泡(G2 Task 4;2026-10-06 卡片简化):悬停某标签节点时给**简化版档案卡片** ——
 * 标题是标签**末段名**(不带路径、不带计数),之后每条关系一行(左属性名 muted、右值);
 * **没有关系的标签不出卡片**(2b);计数只在侧栏行内保留,信息条/侧栏仍各自显示计数。
 *
 * 只做展示:命中检测在 `GraphView`,气泡不吃指针(`TipBubble` 是 `pointer-events-none`);
 * 位置由调用方给屏幕坐标 —— 画布坐标要过相机换算,组件里算不了。
 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { GraphNode } from '../../shared/types';
import { GraphTip } from './GraphTip';
import { TipBubble } from '../shell/TipBubble';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const node: GraphNode = {
  id: 7,
  path: '时间/日期/2026',
  depth: 3,
  parent: 3,
  notes: 120,
  selfCount: 9,
  sortOrder: 2,
};
const relations = [
  { name: '中国大陆', remark: '国籍' },
  { name: '日本', remark: '出生地' },
];

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
  document.body.innerHTML = '';
});

const render = async (el: React.ReactElement): Promise<void> => {
  await act(async () => {
    root.render(el);
  });
};

const tip = (): HTMLElement | null => host.querySelector('[data-testid="hover-tip"]');

describe('GraphTip:悬停卡片', () => {
  it('没有节点:什么都不渲染', async () => {
    await render(createElement(GraphTip, { node: null, relations, x: 10, y: 20 }));
    expect(tip()).toBeNull();
    expect(host.textContent).toBe('');
  });

  it('没有关系的标签不出卡片(2b)', async () => {
    await render(createElement(GraphTip, { node, relations: [], x: 10, y: 20 }));
    expect(tip()).toBeNull();
    expect(host.textContent).toBe('');
  });

  it('标题是末段名:不带路径前缀、不带计数行', async () => {
    await render(createElement(GraphTip, { node, relations, x: 10, y: 20 }));
    expect(tip()?.textContent).toContain('2026');
    expect(tip()?.textContent).not.toContain('时间/日期/2026');
    expect(tip()?.textContent).not.toContain('本级');
    expect(tip()?.textContent).not.toContain('含子级');
  });

  it('每条关系一行两列:左列属性名、右列值(行内 md 已剥)', async () => {
    await render(createElement(GraphTip, { node, relations: [{ name: '[日本](日出之国)', remark: '**国籍**' }], x: 10, y: 20 }));
    const labels = [...(tip()?.querySelectorAll('[data-tip-row-label]') ?? [])].map((el) => el.textContent);
    const values = [...(tip()?.querySelectorAll('[data-tip-row-value]') ?? [])].map((el) => el.textContent);
    expect(labels).toEqual(['国籍']);
    expect(values).toEqual(['日本']);
  });

  it('复用悬浮气泡的外观(同一 testid,不吃指针)', async () => {
    await render(createElement(GraphTip, { node, relations, x: 10, y: 20 }));
    const el = tip();
    expect(el?.className).toContain('pointer-events-none');
    expect(el?.className).toContain('fixed');
  });

  it('坐标按屏幕口径:默认贴锚点下方,above 贴上方', async () => {
    await render(createElement(GraphTip, { node, relations, x: 30, y: 40 }));
    expect(tip()?.style.left).toBe('30px');
    expect(tip()?.style.top).toBe('46px');
    const inner = window.innerHeight;
    await render(createElement(TipBubble, { text: 'x', x: 30, y: 40, above: true }));
    expect(tip()?.style.bottom).toBe(`${inner - 40 + 6}px`);
    expect(tip()?.style.top).toBe('');
  });
});
