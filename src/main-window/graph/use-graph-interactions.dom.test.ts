// @vitest-environment jsdom
/**
 * 指针交互 hook:命中 -> 悬停 + 气泡锚点、单击选中/点空白清选中、双击展开、右键开菜单;
 * 容器原点参与换算(容器不在视口原点时不能点偏),覆盖层上的事件不算画布交互。
 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GraphNode } from '../../shared/types';
import type { Point } from './radial';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { useGraphInteractions, type GraphInteractions } from './use-graph-interactions';

const nodes: GraphNode[] = [
  { id: 1, path: '甲', depth: 1, parent: null, notes: 4, selfCount: 0, sortOrder: 0 },
  { id: 2, path: '甲/一', depth: 2, parent: 1, notes: 1, selfCount: 1, sortOrder: 0 },
];
/** 半径 r(4) = 3 + 容差 4 -> 圆心 7px 内算命中 */
const points = new Map<number, Point>([[1, { x: 0, y: 0 }], [2, { x: 100, y: 0 }]]);
const cam = { k: 1, tx: 200, ty: 150 }; // 节点 1 落在 (200,150)、节点 2 落在 (300,150)

let api: GraphInteractions | null = null;
let root: Root;
let host: HTMLDivElement;
let origin = { x: 0, y: 0 };
const calls = { select: [] as (number | null)[], expand: [] as number[], menu: [] as number[][] };

function Harness(): null {
  api = useGraphInteractions({
    nodes,
    points,
    cam,
    origin: () => origin,
    onSelect: (id) => calls.select.push(id),
    onExpand: (id) => calls.expand.push(id),
    onMenu: (id, x, y) => calls.menu.push([id, x, y]),
  });
  return null;
}

const mount = async (): Promise<void> => {
  await act(async () => {
    root.render(createElement(Harness));
  });
};

const move = async (x: number, y: number, target?: EventTarget): Promise<void> => {
  await act(async () => {
    api?.onPointerMove({ clientX: x, clientY: y, target });
  });
};

const click = async (x: number, y: number, target?: EventTarget): Promise<void> => {
  await act(async () => {
    api?.onClick({ clientX: x, clientY: y, target });
  });
};

beforeEach(() => {
  origin = { x: 0, y: 0 };
  calls.select.length = 0;
  calls.expand.length = 0;
  calls.menu.length = 0;
  api = null;
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.restoreAllMocks();
});

describe('useGraphInteractions:悬停', () => {
  it('命中圆心 -> hovered 是该节点,气泡锚点是它的屏幕坐标;移到空白 -> 两者都清', async () => {
    await mount();
    await move(200, 150);
    expect(api!.hovered).toBe(1);
    expect(api!.tipAt).toEqual({ x: 200, y: 150 });
    await move(20, 20);
    expect(api!.hovered).toBe(null);
    expect(api!.tipAt).toBe(null);
  });

  it('气泡锚点钉在节点上:同一节点内移动不换对象,换节点才换', async () => {
    await mount();
    await move(200, 150);
    const first = api!.tipAt;
    await move(203, 152); // 仍在 1 的触及半径内:锚点是节点位置,坐标没变
    expect(api!.hovered).toBe(1);
    expect(api!.tipAt).toBe(first);
    await move(303, 150); // 换到节点 2:锚点必须换对象,否则气泡停在旧节点上
    expect(api!.hovered).toBe(2);
    expect(api!.tipAt).not.toBe(first);
    expect(api!.tipAt).toEqual({ x: 300, y: 150 });
  });

  it('抬指针(onPointerLeave)清掉悬停与气泡', async () => {
    await mount();
    await move(200, 150);
    await act(async () => {
      api?.onPointerLeave();
    });
    expect(api!.hovered).toBe(null);
    expect(api!.tipAt).toBe(null);
  });

  it('容器不在视口原点时按原点换算:client 坐标 - origin 才是画布坐标', async () => {
    origin = { x: 100, y: 50 };
    await mount();
    await move(300, 200); // client(300,200) -> 画布(200,150) = 节点 1 的屏幕位置
    expect(api!.hovered).toBe(1);
    expect(api!.tipAt).toEqual({ x: 300, y: 200 }); // 气泡要视口坐标,换回 client 一侧
  });
});

describe('useGraphInteractions:单击与双击', () => {
  it('单击命中 -> 选中该节点;单击空白 -> 清选中(null)', async () => {
    await mount();
    await click(300, 150);
    expect(calls.select).toEqual([2]);
    await click(30, 30);
    expect(calls.select).toEqual([2, null]);
  });

  it('双击命中 -> 展开该节点;双击空白不触发', async () => {
    await mount();
    await act(async () => {
      api?.onDoubleClick({ clientX: 200, clientY: 150 });
    });
    await act(async () => {
      api?.onDoubleClick({ clientX: 30, clientY: 30 });
    });
    expect(calls.expand).toEqual([1]);
  });
});

describe('useGraphInteractions:右键菜单', () => {
  it('命中:拦下浏览器菜单,菜单落点用 client 坐标', async () => {
    await mount();
    const preventDefault = vi.fn();
    await act(async () => {
      api?.onContextMenu({ clientX: 300, clientY: 150, preventDefault });
    });
    expect(preventDefault).toHaveBeenCalled();
    expect(calls.menu).toEqual([[2, 300, 150]]);
  });

  it('右键空白:不开菜单(浏览器菜单照样拦下)', async () => {
    await mount();
    const preventDefault = vi.fn();
    await act(async () => {
      api?.onContextMenu({ clientX: 30, clientY: 30, preventDefault });
    });
    expect(preventDefault).toHaveBeenCalled();
    expect(calls.menu).toEqual([]);
  });
});

describe('useGraphInteractions:覆盖层事件不算画布交互', () => {
  const overlayTarget = (): HTMLElement => {
    const wrap = document.createElement('div');
    wrap.setAttribute('data-graph-overlay', '');
    const button = document.createElement('button');
    wrap.appendChild(button);
    document.body.appendChild(wrap);
    return button; // 事件目标在覆盖层内部(靠 closest 判定)
  };

  it('在信息条上点击/双击/右键都不改选中与展开', async () => {
    await mount();
    const t = overlayTarget();
    await click(205, 152, t); // 坐标正落在节点 1 上,但事件来自覆盖层
    await act(async () => {
      api?.onDoubleClick({ clientX: 205, clientY: 152, target: t });
    });
    const preventDefault = vi.fn();
    await act(async () => {
      api?.onContextMenu({ clientX: 205, clientY: 152, target: t, preventDefault });
    });
    expect(calls.select).toEqual([]);
    expect(calls.expand).toEqual([]);
    expect(calls.menu).toEqual([]);
    expect(preventDefault).toHaveBeenCalled(); // 覆盖层上的右键仍不弹浏览器菜单
  });

  it('移到覆盖层上:清掉悬停与气泡(不拿覆盖层底下的节点当悬停)', async () => {
    await mount();
    await move(200, 150);
    await move(205, 152, overlayTarget());
    expect(api!.hovered).toBe(null);
    expect(api!.tipAt).toBe(null);
  });
});
