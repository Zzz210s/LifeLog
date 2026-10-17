// @vitest-environment jsdom
/**
 * T4 接线层的**预览卡片入口**证据(2026-10-17 用户要求):`open` 档的单击改成「只看这一条」之后,
 * 卡片只剩**双击**这一个入口。本文件钉住双击的四件事(开卡并切回流、真序列的净效果、
 * 再双击关闭、切到另一行只留一张)与「容器行双击不出卡」。
 * 单击侧的读数在 `tag-click-flow.dom.test.ts`,退出与清理(Esc / 切模式 / 切视图 / 路径失效)
 * 在 `tag-click-state.dom.test.ts`;拆文件是为各自守住 200 行红线。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { itemPaths } from '../../shared/filter-conditions';
import type { MainView } from '../settings/settings-model';
import { mountClickFlow, type ClickFlow } from './__fixtures__/click-flow-harness';
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

describe('双击 = 预览卡片(open 档;单击已经是「只看这一条」)', () => {
  it('双击出卡片并切回信息流(卡片在流里,不切看不见),dblclick 自己不写条件', () => {
    const h = mount('open', 'settings');
    const before = [...h.probe.writes];
    h.dblclickRow('书籍');
    expect(h.probe.view).toBe('stream');
    expect(h.card()?.getAttribute('aria-label')).toBe('实体预览：书籍');
    expect(h.row('书籍')?.getAttribute('data-preview')).toBe('true');
    expect(h.row('书籍')?.getAttribute('aria-expanded')).toBe('true');
    expect(h.row('书籍')?.getAttribute('aria-controls')).toBe('tag-preview-card');
    expect(h.probe.writes).toEqual(before);
  });

  it('真浏览器的双击序列(click + click + dblclick):条件落到只看这条、卡片同时开着(两次单击幂等)', () => {
    const h = mount('open');
    h.doubleClickRow('书籍');
    expect(itemPaths(h.probe.conditions, 'tag')).toEqual(['书籍']);
    expect(h.card()?.getAttribute('aria-label')).toBe('实体预览：书籍');
  });

  it('再双击同一行 = 关卡片', () => {
    const h = mount('open');
    h.dblclickRow('书籍');
    h.dblclickRow('书籍');
    expect(h.card()).toBeNull();
  });

  it('双击另一行:卡片切到新实体,同时只有一张', () => {
    const h = mount('open');
    h.dblclickRow('书籍');
    h.dblclickRow('书籍/SQL');
    expect(h.cards()).toHaveLength(1);
    expect(h.card()?.getAttribute('aria-label')).toBe('实体预览：书籍/SQL');
    expect(h.row('书籍')?.getAttribute('data-preview')).toBeNull();
  });

  it('filter 档双击不开卡片:卡片入口与模式同源', () => {
    const h = mount('filter');
    h.dblclickRow('书籍');
    expect(h.card()).toBeNull();
    expect(h.row('书籍')?.getAttribute('data-preview')).toBeNull();
  });
});

describe('容器行双击:不可选行没有卡片可看,只切换子树', () => {
  it('open 档双击容器行:收起子树、不写条件、不出卡片', () => {
    const h = mount('open');
    const writes = h.probe.writes.length;
    expect(h.row('容器/空')).not.toBeNull();
    h.dblclickRow('容器');
    expect(h.row('容器/空')).toBeNull();
    expect(h.probe.writes.length).toBe(writes);
    expect(h.card()).toBeNull();
  });
});
