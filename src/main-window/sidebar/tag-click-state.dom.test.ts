// @vitest-environment jsdom
/**
 * T4 接线层的"退出与清理"证据(设计 §4.3 第 20/21/22 行、§4.4、§5.3-5.4、§8):
 * Esc / 点空白 / 切模式 / 切视图 / 路径失效五种收场,以及光标条与预览卡片自己的两个按钮。
 * 单击行为本身的读数(三模式 × 修饰键 × 容器行)在 tag-cursor-flow.dom.test.ts。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { itemPaths } from '../../shared/filter-conditions';
import type { MainView } from '../settings/settings-model';
import { mountClickFlow, ROWS, type ClickFlow } from './__fixtures__/click-flow-harness';
import type { SidebarClickMode } from './click-mode';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let flow: ClickFlow | null = null;

const mount = (mode: SidebarClickMode, view: MainView = 'stream'): ClickFlow => {
  flow?.unmount();
  flow = mountClickFlow({ mode, view });
  return flow;
};

beforeEach(() => {
  flow = null;
});

afterEach(() => {
  flow?.unmount();
});

describe('状态退出与清理(§4.3 第 20/21/22 行、§4.4、§8)', () => {
  it('Esc:光标模式清光标、卡片模式关卡片(条件一字不动)', () => {
    const cursor = mount('select');
    cursor.clickRow('书籍');
    expect(cursor.cursorBar()).not.toBeNull();
    const writes = cursor.probe.writes.length;
    cursor.esc();
    expect(cursor.cursorBar()).toBeNull();
    expect(cursor.probe.writes.length).toBe(writes);

    const card = mount('open');
    card.clickRow('书籍');
    expect(card.card()).not.toBeNull();
    card.esc();
    expect(card.card()).toBeNull();
  });

  it('Esc 优先级:浮层开着时 Esc 只关浮层,卡片不动(捕获阶段 stopPropagation)', () => {
    const h = mount('open');
    h.clickRow('书籍');
    h.escWithOverlay();
    expect(h.card()).not.toBeNull();
  });

  it('点侧栏列表空白:select 清光标,filter / open 什么都不做', () => {
    const h = mount('select');
    h.clickRow('书籍');
    h.blankClick();
    expect(h.cursorBar()).toBeNull();
    const card = mount('open');
    card.clickRow('书籍');
    const writes = card.probe.writes.length;
    card.blankClick();
    expect(card.card()).not.toBeNull();
    expect(card.probe.writes.length).toBe(writes);
  });

  it('切模式:清光标 + 关卡片 + 一句回执;头部按钮与设置页那一行是同一份状态', () => {
    const h = mount('select');
    h.clickRow('书籍');
    expect(h.cursorBar()).not.toBeNull();
    h.clickHeader(); // 选中 -> 筛选(轮转 filter -> open -> select -> filter)
    expect(h.mode()).toBe('filter');
    expect(h.cursorBar()).toBeNull();
    expect(h.flash()).toContain('已切到「筛选」');
    h.clickHeader();
    h.clickHeader();
    h.clickHeader();
    expect(h.mode()).toBe('filter'); // 三次点击回到原档

    h.clickSettings('打开'); // 设置页那一行:与头部按钮同一份状态
    expect(h.mode()).toBe('open');
    expect(h.card()).toBeNull();
    h.clickRow('书籍'); // 切完之后单击行为确实跟着变了
    expect(h.card()).not.toBeNull();
  });

  it('切视图不清状态(设计 R5:切走再回来,光标与卡片还在)', () => {
    const h = mount('select');
    h.clickRow('书籍');
    h.setView('settings');
    expect(h.cursorBar()).not.toBeNull();
    expect(h.row('书籍')?.getAttribute('data-cursor')).toBe('true');
    h.setView('stream');
    expect(h.cursorBar()).not.toBeNull();
  });

  it('路径从 tagRows 里消失(标签被删 / 改名):光标与卡片被清掉', () => {
    const h = mount('select');
    h.clickRow('书籍');
    h.setRows(ROWS.filter((r) => r.path !== '书籍'));
    expect(h.cursorBar()).toBeNull();
    expect(h.row('书籍')?.getAttribute('data-cursor')).toBeNull();
    const card = mount('open');
    card.clickRow('书籍');
    card.setRows(ROWS.filter((r) => r.path !== '书籍'));
    expect(card.card()).toBeNull();
  });
});

describe('光标条与预览卡片自己的两个按钮(§5.3 / §5.4)', () => {
  it('卡片「只看这条」写 only 条件并关卡片;「关闭」只关卡片', () => {
    const h = mount('open');
    h.clickRow('书籍');
    const writes = h.probe.writes.length;
    h.press('关闭');
    expect(h.card()).toBeNull();
    expect(h.probe.writes.length).toBe(writes);

    h.clickRow('书籍/SQL');
    h.press('只看这条');
    expect(h.card()).toBeNull();
    expect(itemPaths(h.probe.conditions, 'tag')).toEqual(['书籍/SQL']);
    expect(h.flash()).toContain('已只看 #书籍/SQL');
  });

  it('光标条「只看这条实体」写 only 条件且保留光标;「清除选中」清光标', () => {
    const h = mount('select');
    h.clickRow('书籍');
    h.press('只看这条实体');
    expect(itemPaths(h.probe.conditions, 'tag')).toEqual(['书籍']);
    expect(h.cursorBar()).not.toBeNull();
    h.press('清除选中');
    expect(h.cursorBar()).toBeNull();
  });

  it('拖拽进行中不渲染光标条(§4.3 第 23 行:位置让给「移到根级」)', () => {
    const h = mount('select');
    h.clickRow('书籍');
    expect(h.cursorBar()).not.toBeNull();
    h.dragRow('书籍/SQL'); // 拖拽态由 useTagDrag 持有,起手即点亮
    expect(h.cursorBar()).toBeNull();
  });
});
