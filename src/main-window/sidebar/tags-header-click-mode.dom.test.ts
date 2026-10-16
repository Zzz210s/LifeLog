// @vitest-environment jsdom
/**
 * 头部第 5 个图标按钮:单击行为的模式按钮(设计 2026-10-16 §5.2)。
 * 契约:data-testid="click-mode-button" / data-click-mode=当前模式 / aria-label 前缀「点击行为：」/
 * title 说清「现在是什么 + 点一下变成什么」;三态不是开关,故不设 aria-pressed。
 * 组件不持状态:回调参数恒为 `nextClickMode(当前模式)`,轮转顺序 filter -> open -> select -> filter。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { TagsHeader } from './TagsHeader';
import {
  CLICK_MODE_LABELS,
  CLICK_MODE_ORDER,
  nextClickMode,
  type SidebarClickMode,
} from './click-mode';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;
let clickCalls: SidebarClickMode[];

beforeEach(() => {
  clickCalls = [];
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const render = async (clickMode: SidebarClickMode): Promise<void> => {
  await act(async () =>
    root.render(
      createElement(TagsHeader, {
        flash: null,
        mode: 'tree',
        onModeChange: () => {},
        onFilterTags: () => {},
        showRelations: true,
        onToggleRelations: () => {},
        clickMode,
        onChangeClickMode: (m: SidebarClickMode) => clickCalls.push(m),
        searchOpen: false,
        query: '',
        ime: { onChange: () => {}, onCompositionEnd: () => {} },
        onToggleSearch: () => {},
        onCloseSearch: () => {},
      })
    )
  );
};

const modeBtn = (): HTMLButtonElement =>
  host.querySelector('[data-testid="click-mode-button"]') as HTMLButtonElement;

const buttons = (): HTMLButtonElement[] => [...host.querySelectorAll('button')] as HTMLButtonElement[];

describe('侧栏头部:单击行为模式按钮', () => {
  it('三模式各自:data-click-mode / aria-label / title / 图标齐全,且不设 aria-pressed', async () => {
    for (const m of CLICK_MODE_ORDER) {
      await render(m);
      const b = modeBtn();
      expect(b).not.toBeNull();
      expect(b.getAttribute('data-click-mode')).toBe(m);
      expect(b.getAttribute('aria-label')).toBe('点击行为：' + CLICK_MODE_LABELS[m]);
      const next = nextClickMode(m);
      const title = b.getAttribute('title') ?? '';
      expect(title.startsWith('点击行为：' + CLICK_MODE_LABELS[m])).toBe(true);
      expect(title).toContain('点一下切到「' + CLICK_MODE_LABELS[next] + '」');
      // 三态不是开关:aria-pressed 绝不出现(行的 aria-pressed 仍只表示「筛选包含侧」)
      expect(b.hasAttribute('aria-pressed')).toBe(false);
      expect(String(b.className)).toContain('h-7');
      expect(b.querySelector('svg path')).not.toBeNull();
      expect(b.textContent).toBe('');
    }
  });

  it('filter 模式:title 逐字说明当前与下一档(设计 §5.2 原样)', async () => {
    await render('filter');
    expect(modeBtn().getAttribute('title')).toBe('点击行为：筛选（单击 = 加入/移出筛选）。点一下切到「打开」');
  });

  it('点击回调一次,回调参数 = nextClickMode(当前模式);组件不自持状态', async () => {
    await render('filter');
    await act(async () => modeBtn().click());
    expect(clickCalls).toEqual(['open']);
    // 不重渲染仍是 filter(状态在上层):再点一次还是 'open'
    await act(async () => modeBtn().click());
    expect(clickCalls).toEqual(['open', 'open']);
  });

  it('轮转:filter -> open -> select -> filter(按回执重渲染后的三次点击序列)', async () => {
    let m: SidebarClickMode = 'filter';
    for (let i = 0; i < 3; i += 1) {
      await render(m);
      await act(async () => modeBtn().click());
      m = nextClickMode(m);
    }
    expect(clickCalls).toEqual(['open', 'select', 'filter']);
  });

  it('三模式的图标 path 互不相同', async () => {
    const paths: string[] = [];
    for (const m of CLICK_MODE_ORDER) {
      await render(m);
      paths.push(modeBtn().querySelector('svg path')!.getAttribute('d') ?? '');
    }
    expect(new Set(paths).size).toBe(3);
  });

  it('模式按钮排在「显示关系」之后、「筛选标签」之前(第五个)', async () => {
    await render('filter');
    const all = buttons();
    expect(all).toHaveLength(5);
    expect(all[2].getAttribute('aria-label')).toBe('实体树里显示关系');
    expect(all[3].getAttribute('data-testid')).toBe('click-mode-button');
    expect(all[4].getAttribute('aria-label')).toBe('筛选标签');
  });
});
