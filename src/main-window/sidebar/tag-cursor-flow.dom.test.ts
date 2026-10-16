// @vitest-environment jsdom
/**
 * T4 接线层的端到端证据(设计 §4 真值表 / §5.3-5.4 的两个组件 / §8 的 Esc 链 / §4.4 状态失效):
 * 从"点头部模式按钮 / 设置页那一行"到「条件对象 / 光标条 / 预览卡片 / 回执」四处读数,
 * 全部走真实 DOM 与真实的 `applyFilterPatch` 写路径(夹具与四个行的形状见 __fixtures__)。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { itemPaths } from '../../shared/filter-conditions';
import type { MainView } from '../settings/settings-model';
import { mountClickFlow, type ClickFlow } from './__fixtures__/click-flow-harness';
import type { SidebarClickMode } from './click-mode';

const MODES: SidebarClickMode[] = ['filter', 'open', 'select'];

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let flow: ClickFlow | null = null;

const mount = (mode: SidebarClickMode, view: MainView = 'stream'): ClickFlow => {
  flow?.unmount();
  flow = mountClickFlow({ mode, view });
  return flow;
};

/** 当前夹具(用例里已 mount 过,断言期不会是 null) */

beforeEach(() => {
  flow = null;
});

afterEach(() => {
  flow?.unmount();
});
describe('三模式的无修饰键单击(§4.1 第 1 / 5 / 9 行)', () => {
  it('filter:单击写条件(含子级),不出光标条、不出卡片、无回执', () => {
    const h = mount('filter');
    h.clickRow('书籍');
    expect(itemPaths(h.probe.conditions, 'tag')).toEqual(['书籍']);
    expect(h.probe.conditions.groups[0].items[0]).toMatchObject({ includeChildren: true });
    expect(h.cursorBar()).toBeNull();
    expect(h.card()).toBeNull();
    expect(h.flash()).toBeNull();
  });

  it('select:单击只移光标(竖条 + aria-current + 光标条),条件原文一字不变', () => {
    const h = mount('select');
    const before = [...h.probe.writes];
    h.clickRow('书籍/SQL');
    expect(h.cursorBar()?.textContent).toContain('书籍/SQL');
    expect(h.cursorBar()?.textContent).toContain('本级 1 / 含子级 2');
    expect(h.row('书籍/SQL')?.getAttribute('data-cursor')).toBe('true');
    expect(h.row('书籍/SQL')?.getAttribute('aria-current')).toBe('true');
    expect(h.probe.writes).toEqual(before);
    expect(h.row('书籍/SQL')?.getAttribute('aria-pressed')).toBe('false'); // 光标不写它(§5.8)
    expect(h.card()).toBeNull();
  });

  it('open:单击出卡片并切回信息流(卡片在流里,不切看不见),条件原文不变', () => {
    const h = mount('open', 'settings');
    const before = [...h.probe.writes];
    h.clickRow('书籍');
    expect(h.probe.view).toBe('stream');
    expect(h.card()?.getAttribute('aria-label')).toBe('实体预览：书籍');
    expect(h.row('书籍')?.getAttribute('data-preview')).toBe('true');
    expect(h.row('书籍')?.getAttribute('aria-expanded')).toBe('true');
    expect(h.row('书籍')?.getAttribute('aria-controls')).toBe('tag-preview-card');
    expect(h.probe.writes).toEqual(before);
    expect(h.cursorBar()).toBeNull();
  });

  it('再点同一行 = 切换:select 清光标、open 关卡片', () => {
    const cursor = mount('select');
    cursor.clickRow('书籍');
    cursor.clickRow('书籍');
    expect(cursor.cursorBar()).toBeNull();
    expect(cursor.row('书籍')?.getAttribute('data-cursor')).toBeNull();
    const card = mount('open');
    card.clickRow('书籍');
    card.clickRow('书籍');
    expect(card.card()).toBeNull();
  });

  it('open 模式点另一行:卡片切到新实体,同时只有一张', () => {
    const h = mount('open');
    h.clickRow('书籍');
    h.clickRow('书籍/SQL');
    expect(h.cards()).toHaveLength(1);
    expect(h.card()?.getAttribute('aria-label')).toBe('实体预览：书籍/SQL');
    expect(h.row('书籍')?.getAttribute('data-preview')).toBeNull();
  });
});

describe('修饰键四格(§4.1 主表 12 格)', () => {
  it('filter:无 = 切换、Ctrl = 追加(幂等只回执)、Alt = 排除(可撤)、Shift = 只看这条', () => {
    const h = mount('filter');
    h.clickRow('书籍');
    expect(itemPaths(h.probe.conditions, 'tag')).toEqual(['书籍']);
    h.clickRow('书籍/SQL', { ctrlKey: true });
    expect(itemPaths(h.probe.conditions, 'tag')).toEqual(['书籍', '书籍/SQL']);

    const writes = h.probe.writes.length;
    h.clickRow('书籍/SQL', { ctrlKey: true });
    expect(h.probe.writes.length).toBe(writes); // 幂等:不再写库
    expect(h.flash()).toContain('已在筛选中');

    h.clickRow('书籍', { altKey: true });
    expect(itemPaths(h.probe.conditions, 'excludeTag')).toEqual(['书籍']);
    h.clickRow('书籍', { altKey: true });
    expect(itemPaths(h.probe.conditions, 'excludeTag')).toEqual([]);

    h.clickRow('书籍/SQL', { shiftKey: true });
    expect(itemPaths(h.probe.conditions, 'tag')).toEqual(['书籍/SQL']);
    expect(h.flash()).toContain('已只看 #书籍/SQL');
  });

  it('select:修饰键仍写条件,并把光标移到该行(一律有回执)', () => {
    const h = mount('select');
    h.clickRow('书籍', { ctrlKey: true });
    expect(itemPaths(h.probe.conditions, 'tag')).toEqual(['书籍']);
    expect(h.row('书籍')?.getAttribute('data-cursor')).toBe('true');
    expect(h.flash()).toContain('已追加为同时满足');
    h.clickRow('书籍/SQL', { altKey: true });
    expect(h.flash()).toContain('已排除 #书籍/SQL');
    h.clickRow('书籍/SQL', { shiftKey: true });
    expect(h.flash()).toContain('已只看 #书籍/SQL');
    expect(h.row('书籍/SQL')?.getAttribute('data-cursor')).toBe('true');
  });

  it('open:修饰键只写条件,不开卡片也不切视图(一次点击只做一件事)', () => {
    const h = mount('open', 'settings');
    h.clickRow('书籍', { ctrlKey: true });
    expect(itemPaths(h.probe.conditions, 'tag')).toEqual(['书籍']);
    expect(h.card()).toBeNull();
    expect(h.probe.view).toBe('settings');
    expect(h.flash()).toContain('已追加为同时满足');
  });

  it('多修饰键同时按下只出一个动作:Ctrl+Alt = 追加(优先级 Ctrl > Alt > Shift)', () => {
    const h = mount('filter');
    h.clickRow('书籍', { ctrlKey: true, altKey: true });
    expect(itemPaths(h.probe.conditions, 'tag')).toEqual(['书籍']);
    expect(itemPaths(h.probe.conditions, 'excludeTag')).toEqual([]);
  });
});

describe('容器行恒展开(§4.2 的 13 个格子同一结果)', () => {
  it('有子级的容器:三模式单击都只收起子树,不写条件、不出光标、不开卡片', () => {
    for (const mode of MODES) {
      const h = mount(mode);
      const writes = h.probe.writes.length;
      expect(h.row('容器/空')).not.toBeNull();
      h.clickRow('容器');
      expect(h.row('容器/空')).toBeNull(); // 收起
      expect(h.probe.writes.length).toBe(writes);
      expect(h.cursorBar()).toBeNull();
      expect(h.card()).toBeNull();
    }
  });

  it('计数 0 的空实体:三模式单击都不做事,只给一句「该实体还没有内容」', () => {
    for (const mode of MODES) {
      const h = mount(mode);
      const writes = h.probe.writes.length;
      h.clickRow('空实体');
      expect(h.probe.writes.length).toBe(writes);
      expect(h.flash()).toBe('该实体还没有内容');
      expect(h.cursorBar()).toBeNull();
      expect(h.card()).toBeNull();
    }
  });
});
