// @vitest-environment jsdom
/**
 * 指针交互 hook:命中 -> 悬停 + 气泡锚点、单击选中/点空白清选中、双击展开(空白则回信息流)、右键开菜单;
 * 容器原点参与换算(容器不在视口原点时不能点偏),覆盖层上的事件不算画布交互。
 * 夹具与事件发送在 interactions-test-kit.ts(坐标算式只留一份)。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { screenOf } from './graph-camera';
import { radiusOf } from './graph-draw-plan';
import { OVERFLOW_GAP } from './graph-notes';
import { CAM, NODES, POINTS, makeInteractions, type InteractionsHarness } from './interactions-test-kit';
import type { OverflowHit } from './use-graph-interactions';

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

describe('useGraphInteractions:展开层的 +N', () => {
  /** 与 use-expanded-notes 同一口径的扇形间距(改了口径这里就红) */
  const FAN_GAP = 14;
  /** 节点在画布上的屏幕位置(与夹具同一套算式,不抄第二份) */
  const at = (id: number): { x: number; y: number } => screenOf(POINTS.get(id)!, CAM);
  /** `+N` 的落点:环外偏下(与 noteFan 同一口径 —— 扇形半径 = 标签半径 + 间距,再加 OVERFLOW_GAP) */
  const overflowOf = (id: number): OverflowHit => {
    const c = at(id);
    const notes = NODES.find((n) => n.id === id)!.notes;
    return { id, x: c.x, y: c.y + radiusOf(notes) + FAN_GAP + OVERFLOW_GAP };
  };

  it('单击落在 +N 上 -> 带着该标签回信息流,不再选中它上面那个节点', async () => {
    const o = overflowOf(3); // 大标签(notes 1040):`+N` 在它环外偏下
    h.setOverflow(o);
    await h.mount();
    await h.click(o.x, o.y);
    expect(h.calls.overflow).toEqual([3]);
    expect(h.calls.select).toEqual([]); // 顺手选中会先把信息条顶出来,再把用户送去信息流
  });

  it('小标签(点触及半径 < `+N` 命中半径)展开后,点圆心命中的是节点而不是 +N', async () => {
    const o = overflowOf(4); // 节点 4:notes 25 -> 点半径 3.75、触及半径 7.75
    h.setOverflow(o);
    await h.mount();
    const c = at(4);
    await h.click(c.x, c.y);
    expect(h.calls.overflow).toEqual([]); // `+N` 若与点同心,这一下会被它吞掉(2026-10-01 修)
    expect(h.calls.select).toEqual([4]);
    await h.click(o.x, o.y);
    expect(h.calls.overflow).toEqual([4]); // 点 `+N` 才是回信息流
  });

  it('+N 半径之外仍是普通节点点击(大标签点的外圈还能选中);没给 +N 时行为不变', async () => {
    h.setOverflow(overflowOf(3));
    await h.mount();
    await h.click(at(3).x + 13, at(3).y); // 离圆心 13:在 `+N` 半径(10)之外、标签点触及半径(~14.6)之内
    expect(h.calls.overflow).toEqual([]);
    expect(h.calls.select).toEqual([3]);
    await h.click(at(3).x, at(3).y); // 圆心:仍是标签点(同心时这一下会被 `+N` 吞掉)
    expect(h.calls.select).toEqual([3, 3]);
    expect(h.calls.overflow).toEqual([]);
  });

  it('悬停 / 双击收起 / 右键菜单都不看 +N(看了就会把「再双击收起」吞掉)', async () => {
    h.setOverflow(overflowOf(3));
    await h.mount();
    await h.move(200, 400);
    expect(h.api().hovered).toBe(3);
    await h.doubleClick(200, 400);
    expect(h.calls.expand).toEqual([3]);
    await h.contextMenu(200, 400);
    expect(h.calls.menu).toEqual([[3, 200, 400]]);
    expect(h.calls.overflow).toEqual([]);
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
