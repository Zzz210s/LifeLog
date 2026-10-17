// @vitest-environment jsdom
/**
 * 图标去重守卫(2026-10-16):用户报「侧栏的关系图标跟主页的关系图图标重了」。
 * 同一个含义不共用同一个形状 —— 本用例把顶栏(侧栏开关 + 视图导航三项)与侧栏头部三颗图标
 * 全部渲染出来,按 `aria-label` 收 `svg` 的形状签名(path / circle / line 全算),两两比较,
 * 任意两颗都不能同形。新增图标撞车时这里先红,不用等人肉看图。
 * 「同形」判据 = `svg.innerHTML` 逐字节相同(描边 / 圆角等属性也在内)。
 * 2026-10-17:侧栏头部的「显示关系」「点击行为」两颗图标已删(改由设置页那两行承担),
 * 头部只剩搜索 / 树-扁平 / 筛选三颗,原「关系图标撞关系图」的那条断言随之退场。
 */
import { act, createElement } from 'react';
import type { ReactElement } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it } from 'vitest';
import { TagsHeader } from '../sidebar/TagsHeader';
import { TopBar } from './TopBar';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const noop = (): void => {};

/** 渲染一份组件,按 `aria-label` 收它里面每颗图标按钮的 svg 形状签名 */
function iconsOf(el: ReactElement): Record<string, string> {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => root.render(el));
  const out: Record<string, string> = {};
  for (const b of host.querySelectorAll('button')) {
    const svg = b.querySelector('svg');
    if (svg === null) continue;
    out[b.getAttribute('aria-label') ?? '(无 aria-label)'] = svg.innerHTML;
  }
  act(() => root.unmount());
  host.remove();
  return out;
}

const topBar = (): Record<string, string> =>
  iconsOf(
    createElement(TopBar, {
      view: 'stream',
      sidebarVisible: true,
      exporting: false,
      exported: false,
      onToggleSidebar: noop,
      onOpenSettings: noop,
      onOpenGraph: noop,
      onBack: noop,
    })
  );

const sidebarHeader = (): Record<string, string> =>
  iconsOf(
    createElement(TagsHeader, {
      flash: null,
      mode: 'tree',
      onModeChange: noop,
      onFilterTags: noop,
      searchOpen: false,
      query: '',
      ime: { onChange: noop, onCompositionEnd: noop },
      onToggleSearch: noop,
      onCloseSearch: noop,
    })
  );

describe('图标去重:顶栏与侧栏头部不能同形', () => {
  it('顶栏 4 颗与侧栏头部 3 颗两两不同形', () => {
    const groups: Array<[string, Record<string, string>]> = [
      ['顶栏', topBar()],
      ['侧栏头部', sidebarHeader()],
    ];
    const all: Array<[string, string]> = [];
    for (const [group, icons] of groups) {
      expect(Object.keys(icons).length).toBeGreaterThan(0);
      for (const [label, shape] of Object.entries(icons)) all.push([`${group}/${label}`, shape]);
    }
    const dupes: string[] = [];
    for (let i = 0; i < all.length; i += 1) {
      for (let j = i + 1; j < all.length; j += 1) {
        // 同一个按钮在不同档位重复渲染是同一颗,不算撞车(按名字判)
        if (all[i][0].split('/').slice(1).join('/') === all[j][0].split('/').slice(1).join('/')) continue;
        if (all[i][1] === all[j][1]) dupes.push(`${all[i][0]} == ${all[j][0]}`);
      }
    }
    expect(dupes).toEqual([]);
  });
});
