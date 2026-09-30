// @vitest-environment jsdom
/**
 * 指针交互 hook:命中 -> 悬停 + 气泡锚点、单击选中/点空白清选中、双击展开(空白则回信息流)、右键开菜单;
 * 容器原点参与换算(容器不在视口原点时不能点偏),覆盖层上的事件不算画布交互。
 * 夹具与事件发送在 interactions-test-kit.ts(坐标算式只留一份)。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makeInteractions, type InteractionsHarness } from './interactions-test-kit';

let h: InteractionsHarness;

beforeEach(() => {
  h = makeInteractions();
});

afterEach(() => h.cleanup());

describe('useGraphInteractions:悬停', () => {
  it('命中圆心 -> hovered 是该节点,气泡锚点是它的屏幕坐标;移到空白 -> 两者都清', async () => {
    await h.mount();
    await h.move(200, 150);
    expect(h.api().hovered).toBe(1);
    expect(h.api().tipAt).toEqual({ x: 200, y: 150 });
    await h.move(20, 20);
    expect(h.api().hovered).toBe(null);
    expect(h.api().tipAt).toBe(null);
  });

  it('气泡锚点钉在节点上:同一节点内移动不换对象,换节点才换', async () => {
    await h.mount();
    await h.move(200, 150);
    const first = h.api().tipAt;
    await h.move(203, 152); // 仍在 1 的触及半径内:锚点是节点位置,坐标没变
    expect(h.api().hovered).toBe(1);
    expect(h.api().tipAt).toBe(first);
    await h.move(303, 150); // 换到节点 2:锚点必须换对象,否则气泡停在旧节点上
    expect(h.api().hovered).toBe(2);
    expect(h.api().tipAt).not.toBe(first);
    expect(h.api().tipAt).toEqual({ x: 300, y: 150 });
  });

  it('抬指针(onPointerLeave)清掉悬停与气泡', async () => {
    await h.mount();
    await h.move(200, 150);
    await h.leave();
    expect(h.api().hovered).toBe(null);
    expect(h.api().tipAt).toBe(null);
  });

  it('容器不在视口原点时按原点换算:client 坐标 - origin 才是画布坐标', async () => {
    h.setOrigin({ x: 100, y: 50 });
    await h.mount();
    await h.move(300, 200); // client(300,200) -> 画布(200,150) = 节点 1 的屏幕位置
    expect(h.api().hovered).toBe(1);
    expect(h.api().tipAt).toEqual({ x: 300, y: 200 }); // 气泡要视口坐标,换回 client 一侧
  });
});

describe('useGraphInteractions:单击与双击', () => {
  it('单击命中 -> 选中该节点;单击空白 -> 清选中(null)', async () => {
    await h.mount();
    await h.click(300, 150);
    expect(h.calls.select).toEqual([2]);
    await h.click(30, 30);
    expect(h.calls.select).toEqual([2, null]);
  });

  it('双击命中 -> 展开该节点;双击空白 -> 回信息流(设计 §5)', async () => {
    await h.mount();
    await h.doubleClick(200, 150);
    expect(h.calls.expand).toEqual([1]);
    expect(h.calls.exit).toBe(0); // 命中节点是展开,不是退出
    await h.doubleClick(30, 30);
    expect(h.calls.expand).toEqual([1]);
    expect(h.calls.exit).toBe(1);
  });
});

describe('useGraphInteractions:右键菜单', () => {
  it('命中:拦下浏览器菜单,菜单落点用 client 坐标', async () => {
    await h.mount();
    const preventDefault = await h.contextMenu(300, 150);
    expect(preventDefault).toHaveBeenCalled();
    expect(h.calls.menu).toEqual([[2, 300, 150]]);
  });

  it('右键空白:不开菜单(浏览器菜单照样拦下)', async () => {
    await h.mount();
    const preventDefault = await h.contextMenu(30, 30);
    expect(preventDefault).toHaveBeenCalled();
    expect(h.calls.menu).toEqual([]);
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

  it('在信息条上点击/双击/右键都不改选中、展开与退出', async () => {
    await h.mount();
    const t = overlayTarget();
    await h.click(205, 152, t); // 坐标正落在节点 1 上,但事件来自覆盖层
    await h.doubleClick(205, 152, t);
    const preventDefault = await h.contextMenu(205, 152, t);
    expect(h.calls.select).toEqual([]);
    expect(h.calls.expand).toEqual([]);
    expect(h.calls.menu).toEqual([]);
    expect(h.calls.exit).toBe(0); // 覆盖层上的双击也不当"双击空白"退出
    expect(preventDefault).toHaveBeenCalled(); // 覆盖层上的右键仍不弹浏览器菜单
  });

  it('移到覆盖层上:清掉悬停与气泡(不拿覆盖层底下的节点当悬停)', async () => {
    await h.mount();
    await h.move(200, 150);
    await h.move(205, 152, overlayTarget());
    expect(h.api().hovered).toBe(null);
    expect(h.api().tipAt).toBe(null);
  });
});
