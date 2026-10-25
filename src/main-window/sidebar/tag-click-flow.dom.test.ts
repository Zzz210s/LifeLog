// @vitest-environment jsdom
/**
 * T4 接线层的端到端证据(设计 §4 真值表 / §5.4 预览卡片 / §8 的 Esc 链 / §4.4 状态失效):
 * 从"点头部模式按钮 / 设置页那一行"到「条件对象 / 预览卡片 / 回执」三处读数,
 * 全部走真实 DOM 与真实的 `applyFilterPatch` 写路径(夹具与行的形状见 __fixtures__)。
 * 2026-10-16 两档化后,原 `select` 的格整段删除;`data-cursor` / `tag-cursor-bar` 反向断言仍留着,
 * 用来钉住"select 的任何痕迹都不该再出现"。
 * 2026-10-17:open 档单击 = 只看这一条;卡片入口整段改成双击 —— 双击侧的四个格
 * (开卡并切回流 / 真序列 / 再双击关闭 / 换一行只留一张)与容器行双击已拆到
 * `tag-click-preview.dom.test.ts`,本文件只留单击侧。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { itemPaths } from '../../shared/filter-conditions';
import type { MainView } from '../settings/settings-model';
import { mountClickFlow, type ClickFlow } from './__fixtures__/click-flow-harness';
import type { SidebarClickMode } from './click-mode';

const MODES: SidebarClickMode[] = ['filter', 'open'];

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
describe('两模式的无修饰键单击(§4.1 第 1 / 5 行)', () => {
  it('filter:单击写条件(含子级),不出卡片、无回执', () => {
    const h = mount('filter');
    h.clickRow('书籍');
    expect(itemPaths(h.probe.conditions, 'tag')).toEqual(['书籍']);
    expect(h.probe.conditions.groups[0].items[0]).toMatchObject({ includeChildren: true });
    expect(h.card()).toBeNull();
    expect(h.flash()).toBeNull();
  });

  it('open:单击 = 只看这一条(条件只剩它、含子级),不出卡片、给一句回执', () => {
    const h = mount('open', 'settings');
    h.clickRow('书籍');
    expect(itemPaths(h.probe.conditions, 'tag')).toEqual(['书籍']);
    expect(h.probe.conditions.groups[0].items[0]).toMatchObject({ includeChildren: true });
    expect(h.flash()).toContain('已只看 #书籍');
    expect(h.card()).toBeNull();
    expect(h.row('书籍')?.getAttribute('data-preview')).toBeNull();
  });

  it('open:单击把原有的其它标签条件清掉(等价 Shift+单击,不是追加)', () => {
    const h = mount('open');
    h.clickRow('书籍', { ctrlKey: true });
    h.clickRow('书籍/SQL', { ctrlKey: true });
    expect(itemPaths(h.probe.conditions, 'tag')).toEqual(['书籍', '书籍/SQL']);
    h.clickRow('书籍/SQL');
    expect(itemPaths(h.probe.conditions, 'tag')).toEqual(['书籍/SQL']);
    expect(h.card()).toBeNull();
  });
});

describe('已删除的 select:任何入口都不该留下痕迹', () => {
  it('两模式都没有光标条 / 行光标属性 / aria-current', () => {
    for (const mode of MODES) {
      const h = mount(mode);
      h.clickRow('书籍/SQL');
      h.clickRow('书籍', { ctrlKey: true });
      h.clickRow('书籍', { shiftKey: true });
      expect(h.cursorBar()).toBeNull();
      expect(h.row('书籍')?.getAttribute('data-cursor')).toBeNull();
      expect(h.row('书籍')?.getAttribute('aria-current')).toBeNull();
      expect(h.row('书籍/SQL')?.getAttribute('data-cursor')).toBeNull();
      expect(h.row('书籍/SQL')?.getAttribute('aria-current')).toBeNull();
    }
  });

  it('点列表空白两模式都不做事(条件与卡片都不动)', () => {
    const h = mount('open');
    h.dblclickRow('书籍');
    const writes = h.probe.writes.length;
    h.blankClick();
    expect(h.card()).not.toBeNull();
    expect(h.probe.writes.length).toBe(writes);
  });
});

describe('修饰键四格(§4.1 主表 8 格)', () => {
  it('filter:无 = 切换、Ctrl = 追加(幂等只回执)、Alt = 排除(可撤)、Shift = 连选(不改条件)', () => {
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

    // 2026-10-25 改口径:Shift+单击 = 进多选并连选,**不动筛选条件**(用户要求 Shift 直接生效)
    const before = JSON.stringify(itemPaths(h.probe.conditions, 'tag'));
    h.clickRow('书籍/SQL', { shiftKey: true });
    expect(JSON.stringify(itemPaths(h.probe.conditions, 'tag'))).toBe(before);
  });

  it('open:修饰键只写条件,不开卡片也不切视图(一次点击只做一件事)', () => {
    const h = mount('open', 'settings');
    h.clickRow('书籍', { ctrlKey: true });
    expect(itemPaths(h.probe.conditions, 'tag')).toEqual(['书籍']);
    expect(h.card()).toBeNull();
    expect(h.probe.view).toBe('settings');
    expect(h.flash()).toContain('已追加为同时满足');
  });

  it('open:无修饰键单击的回执说的是「已只看」;双击才出卡片', () => {
    const h = mount('open');
    h.clickRow('书籍/SQL');
    expect(h.flash()).toContain('已只看 #书籍/SQL');
    expect(h.card()).toBeNull();
    h.dblclickRow('书籍/SQL');
    expect(h.card()).not.toBeNull();
  });

  it('open:Alt 仍有回执;Shift 改走多选(2026-10-25:Shift 直接生效,不再"只看这条")', () => {
    const h = mount('open');
    h.clickRow('书籍', { altKey: true });
    expect(h.flash()).toContain('已排除 #书籍');
    const tagPaths = JSON.stringify(itemPaths(h.probe.conditions, 'tag'));
    const exclPaths = JSON.stringify(itemPaths(h.probe.conditions, 'excludeTag'));
    h.clickRow('书籍', { shiftKey: true });
    // Shift 只做选行:两侧条件都不动,也不开预览卡片
    expect(JSON.stringify(itemPaths(h.probe.conditions, 'tag'))).toBe(tagPaths);
    expect(JSON.stringify(itemPaths(h.probe.conditions, 'excludeTag'))).toBe(exclPaths);
    expect(h.card()).toBeNull();
  });

  it('多修饰键同时按下只出一个动作:Ctrl+Alt = 追加(优先级 Ctrl > Alt > Shift)', () => {
    const h = mount('filter');
    h.clickRow('书籍', { ctrlKey: true, altKey: true });
    expect(itemPaths(h.probe.conditions, 'tag')).toEqual(['书籍']);
    expect(itemPaths(h.probe.conditions, 'excludeTag')).toEqual([]);
  });
});

describe('容器行恒展开(§4.2 的 9 个格子同一结果)', () => {
  it('容器行恒展开:两模式单击都只收起子树,不写条件、不开卡片', () => {
    for (const mode of MODES) {
      const h = mount(mode);
      const writes = h.probe.writes.length;
      expect(h.row('容器/空')).not.toBeNull();
      h.clickRow('容器');
      expect(h.row('容器/空')).toBeNull(); // 收起
      expect(h.probe.writes.length).toBe(writes);
      expect(h.card()).toBeNull();
    }
  });

  it('计数 0 的空实体:两模式单击都不做事,只给一句「该实体还没有内容」', () => {
    for (const mode of MODES) {
      const h = mount(mode);
      const writes = h.probe.writes.length;
      h.clickRow('空实体');
      expect(h.probe.writes.length).toBe(writes);
      expect(h.flash()).toBe('该实体还没有内容');
      expect(h.card()).toBeNull();
    }
  });
});
