// @vitest-environment jsdom
/**
 * T4 接线层的"退出与清理"证据(设计 §4.3 第 20/22 行、§4.4、§5.4、§8):
 * Esc / 切模式 / 切视图 / 路径失效四种收场,以及预览卡片自己的两个按钮。
 * 单击行为本身的读数(两模式 × 修饰键 × 容器行)在 tag-click-flow.dom.test.ts。
 * 2026-10-16 两档化:原点空白的"清光标"一例并入 tag-click-flow 的反向断言。
 * 2026-10-17:卡片入口是双击 —— 本文件里"先开一张卡"的样板一律用 `dblclickRow`。
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

describe('状态退出与清理(§4.3 第 20/22 行、§4.4、§8)', () => {
  it('Esc:双击开卡后按 Esc 关卡片(条件一字不动)', () => {
    const card = mount('open');
    card.dblclickRow('书籍');
    expect(card.card()).not.toBeNull();
    const writes = card.probe.writes.length;
    card.esc();
    expect(card.card()).toBeNull();
    expect(card.probe.writes.length).toBe(writes);
  });

  it('Esc 优先级:浮层开着时 Esc 只关浮层,卡片不动(捕获阶段 stopPropagation)', () => {
    const h = mount('open');
    h.dblclickRow('书籍');
    h.escWithOverlay();
    expect(h.card()).not.toBeNull();
  });

  it('切模式:关卡片 + 一句回执;头部按钮与设置页那一行是同一份状态', () => {
    const h = mount('open');
    h.dblclickRow('书籍');
    expect(h.card()).not.toBeNull();
    h.clickHeader(); // 打开 -> 筛选(两档互切)
    expect(h.mode()).toBe('filter');
    expect(h.card()).toBeNull();
    expect(h.flash()).toContain('已切到「筛选」');
    h.clickHeader();
    expect(h.mode()).toBe('open'); // 再点一下回到原档

    h.clickSettings('筛选'); // 设置页那一行:与头部按钮同一份状态
    expect(h.mode()).toBe('filter');
    h.clickSettings('打开');
    expect(h.mode()).toBe('open');
    h.dblclickRow('书籍'); // 切完之后双击行为确实跟看模式变了(卡片入口)
    expect(h.card()).not.toBeNull();
  });

  it('切视图不清状态(设计 R5:切走再回来,卡片还在)', () => {
    const h = mount('open');
    h.dblclickRow('书籍');
    h.setView('settings');
    expect(h.card()).not.toBeNull();
    expect(h.row('书籍')?.getAttribute('data-preview')).toBe('true');
    h.setView('stream');
    expect(h.card()).not.toBeNull();
  });

  it('路径从 tagRows 里消失(标签被删 / 改名):卡片被清掉', () => {
    const card = mount('open');
    card.dblclickRow('书籍');
    card.setRows(ROWS.filter((r) => r.path !== '书籍'));
    expect(card.card()).toBeNull();
    expect(card.row('书籍')?.getAttribute('data-preview')).toBeNull();
  });
});

describe('预览卡片自己的两个按钮(§5.4)', () => {
  it('卡片「只看这条」写 only 条件并关卡片;「关闭」只关卡片', () => {
    const h = mount('open');
    h.dblclickRow('书籍');
    const writes = h.probe.writes.length;
    h.press('关闭');
    expect(h.card()).toBeNull();
    expect(h.probe.writes.length).toBe(writes);

    h.dblclickRow('书籍/SQL');
    h.press('只看这条');
    expect(h.card()).toBeNull();
    expect(itemPaths(h.probe.conditions, 'tag')).toEqual(['书籍/SQL']);
    expect(h.flash()).toContain('已只看 #书籍/SQL');
  });
});
