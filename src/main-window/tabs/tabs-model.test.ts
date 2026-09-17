import { describe, expect, it } from 'vitest';
import { EMPTY_FILTER, filterKey } from '../../shared/filter-conditions';
import type { FilterConditions } from '../../shared/filter-conditions';
import {
  TABS_KEY,
  activateTab,
  activeConditions,
  addTab,
  closeTab,
  defaultTabs,
  findTab,
  moveTab,
  parseTabsState,
  patchActive,
  renameTab,
  serializeTabsState,
  tabLabel,
  toggleActiveTag,
} from './tabs-model';

const cond = (patch: Partial<FilterConditions>): FilterConditions => ({ ...EMPTY_FILTER, ...patch });
const todo = cond({ tags: [{ path: '待办', includeChildren: true }] });
const untagged = cond({ tagPresence: 'none' });

describe('tabs-model 默认值与退化', () => {
  it('settings 键与 Rust 侧约定一致', () => {
    expect(TABS_KEY).toBe('tabs_state');
  });

  it('键缺失 / 空串 / 坏 JSON / 缺 tabs / 空数组一律退化为单个「全部」页', () => {
    const want = defaultTabs();
    for (const raw of [null, '', '   ', '{不是 json', '[]', '"字符串"', '{}', '{"tabs":{}}', '{"tabs":[]}']) {
      const parsed = parseTabsState(raw);
      expect(parsed.tabs).toHaveLength(1);
      expect(parsed.activeIndex).toBe(0);
      expect(parsed.tabs[0]).toEqual(want.tabs[0]);
      expect(filterKey(parsed.tabs[0].conditions)).toBe(filterKey(EMPTY_FILTER));
    }
  });

  it('条目非对象被丢弃;条件缺失/非法按 EMPTY_FILTER 归一;标题非字符串按空串(自动标题)', () => {
    const raw = JSON.stringify({
      tabs: [
        null,
        { title: 42, conditions: { sort: 'sideways' } },
        { title: '我的页', conditions: todo },
      ],
      activeIndex: 1,
    });
    const parsed = parseTabsState(raw);
    expect(parsed.tabs).toHaveLength(2);
    expect(parsed.tabs[0].title).toBe('');
    expect(filterKey(parsed.tabs[0].conditions)).toBe(filterKey(EMPTY_FILTER));
    expect(parsed.activeIndex).toBe(1);
    expect(tabLabel(parsed.tabs[1])).toBe('我的页');
  });

  it('activeIndex 越界/非整数一律回落 0', () => {
    const raw = JSON.stringify({ tabs: [{ title: '', conditions: null }, { title: 'b', conditions: null }] });
    expect(parseTabsState(JSON.stringify({ ...JSON.parse(raw), activeIndex: 5 })).activeIndex).toBe(0);
    expect(parseTabsState(JSON.stringify({ ...JSON.parse(raw), activeIndex: -1 })).activeIndex).toBe(0);
    expect(parseTabsState(JSON.stringify({ ...JSON.parse(raw), activeIndex: 1.5 })).activeIndex).toBe(0);
    expect(parseTabsState(JSON.stringify({ ...JSON.parse(raw), activeIndex: 1 })).activeIndex).toBe(1);
  });

  it('序列化只写约定字段,且可原样解析回来(重启恢复的写入形状)', () => {
    const state = { tabs: [{ title: '页一', conditions: todo }, { title: '', conditions: untagged }], activeIndex: 1 };
    const raw = serializeTabsState(state);
    expect(JSON.parse(raw)).toEqual({
      tabs: [
        { title: '页一', conditions: todo },
        { title: '', conditions: untagged },
      ],
      activeIndex: 1,
    });
    expect(parseTabsState(raw)).toEqual(state);
  });
});

describe('tabs-model 增删切重排改名', () => {
  it('追加一页并切到新页;条件先归一', () => {
    const s = addTab(defaultTabs(), { ...EMPTY_FILTER, sort: 'sideways' as FilterConditions['sort'] });
    expect(s.tabs).toHaveLength(2);
    expect(s.activeIndex).toBe(1);
    expect(s.tabs[1].conditions.sort).toBe('newest');
  });

  it('findTab 按条件值判定(同条件不重复开页)', () => {
    const s = addTab(defaultTabs(), todo);
    expect(findTab(s, todo)).toBe(1);
    expect(findTab(s, untagged)).toBe(-1);
    expect(findTab(defaultTabs(), EMPTY_FILTER)).toBe(0);
  });

  it('关闭最后一页时留一个「全部」新页;关闭当前页选中紧邻的下一页', () => {
    const one = defaultTabs();
    expect(closeTab(one, 0)).toEqual(defaultTabs());

    const three = addTab(addTab(one, todo), untagged); // activeIndex 2
    const closedActive = closeTab(activateTab(three, 1), 1);
    expect(closedActive.tabs.map((t) => tabLabel(t))).toEqual(['全部', '无标签']);
    expect(closedActive.activeIndex).toBe(1);

    const closedOther = closeTab(three, 0);
    expect(closedOther.tabs.map((t) => tabLabel(t))).toEqual(['#待办 · 最新在前', '无标签']);
    expect(closedOther.activeIndex).toBe(1);

    expect(closeTab(three, 9)).toBe(three);
  });

  it('重排:顺序按拖拽结果,活动页跟着自己走', () => {
    const s = addTab(addTab(defaultTabs(), todo), untagged); // [全部, 待办, 无标签] active 2
    const moved = moveTab(s, 0, 2);
    expect(moved.tabs.map((t) => tabLabel(t))).toEqual([
      '#待办 · 最新在前',
      '无标签',
      '全部',
    ]);
    expect(moved.activeIndex).toBe(1);
    const bad = moveTab(s, 0, 9);
    expect(bad).toBe(s);
    expect(moveTab(s, 1, 1)).toBe(s);
  });

  it('改名:trim 后落库,空标题回退自动标题', () => {
    const s = addTab(defaultTabs(), todo);
    const named = renameTab(s, 1, '  我的待办  ');
    expect(named.tabs[1].title).toBe('我的待办');
    expect(tabLabel(named.tabs[1])).toBe('我的待办');
    const cleared = renameTab(named, 1, '   ');
    expect(cleared.tabs[1].title).toBe('');
    expect(tabLabel(cleared.tabs[1])).toBe('#待办 · 最新在前');
    expect(renameTab(s, 5, 'x')).toBe(s);
  });

  it('切换越界不动;patch 只改当前页;toggleTag 增删当前页标签', () => {
    const s = addTab(defaultTabs(), todo);
    expect(activateTab(s, 5)).toBe(s);
    expect(activeConditions(activateTab(s, 0)).keyword).toBeNull();

    const patched = patchActive(activateTab(s, 1), { keyword: '减肥' });
    expect(patched.tabs[0].conditions.keyword).toBeNull();
    expect(patched.tabs[1].conditions.keyword).toBe('减肥');
    expect(patched.activeIndex).toBe(1);

    const on = toggleActiveTag(activateTab(s, 0), '健康');
    expect(on.tabs[0].conditions.tags).toEqual([{ path: '健康', includeChildren: true }]);
    expect(on.tabs[1].conditions.tags).toEqual(todo.tags);
    const off = toggleActiveTag(on, '健康');
    expect(off.tabs[0].conditions.tags).toEqual([]);
  });
});
