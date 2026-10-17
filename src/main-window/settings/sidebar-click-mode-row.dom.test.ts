// @vitest-environment jsdom
/**
 * 设置页「单击实体行的行为」一行(设计 2026-10-16 §6):Segmented 两档 筛选/打开,
 * 值与写入走与侧栏头部同一份状态(组件本身只透传)。`EntityTreeRows` 把它与「显示关系」并排。
 * 2026-10-16 按用户要求由三档减为两档。
 * 2026-10-17 用户要求:打开档单击 = 只看这一条(不再是预览),hint 一并改口径并在此钉住。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { SidebarClickModeRow } from './SidebarClickModeRow';
import { EntityTreeRows } from './EntityTreeRows';
import type { SidebarClickMode } from '../sidebar/click-mode';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;
let modeCalls: SidebarClickMode[];
let relationCalls: boolean[];

beforeEach(() => {
  modeCalls = [];
  relationCalls = [];
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const renderRow = async (value: SidebarClickMode = 'filter'): Promise<void> => {
  await act(async () =>
    root.render(
      createElement(SidebarClickModeRow, {
        value,
        onChange: (m: SidebarClickMode) => modeCalls.push(m),
      })
    )
  );
};

const buttons = (): HTMLButtonElement[] => [...host.querySelectorAll('button')] as HTMLButtonElement[];

describe('设置页:单击实体行的行为', () => {
  it('Segmented 两档文案为 筛选/打开,label 为「单击实体行的行为」', async () => {
    await renderRow();
    expect(host.textContent).toContain('单击实体行的行为');
    const group = host.querySelector('[role="group"]');
    expect(group).not.toBeNull();
    expect(group!.getAttribute('aria-label')).toBe('单击实体行的行为');
    expect(buttons().map((b) => b.textContent)).toEqual(['筛选', '打开']);
  });

  it('选中项带 aria-pressed=true,其余为 false', async () => {
    await renderRow('open');
    expect(buttons().map((b) => b.getAttribute('aria-pressed'))).toEqual(['false', 'true']);
  });

  it('hint 说清两档的单次点击语义:筛选 = 加入/移出、打开 = 只看这一条,预览卡片在双击', async () => {
    await renderRow();
    const hint = (host.textContent ?? '').replace(/\s+/g, '');
    expect(hint).toContain('筛选档=加入/移出筛选');
    expect(hint).toContain('打开档=只看这一条');
    expect(hint).toContain('双击在打开档=预览卡片');
  });

  it('点击一档回调一次;左右方向键切换并回调', async () => {
    await renderRow('filter');
    await act(async () => buttons()[1].click());
    expect(modeCalls).toEqual(['open']);
    await act(async () =>
      host
        .querySelector('[role="group"]')!
        .dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
    );
    expect(modeCalls).toEqual(['open', 'open']); // filter + 右 = open
    await renderRow('open');
    await act(async () =>
      host
        .querySelector('[role="group"]')!
        .dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }))
    );
    expect(modeCalls).toEqual(['open', 'open', 'filter']); // open + 左 = filter
  });

  it('组合行:EntityTreeRows 同时渲染「显示关系」与「单击行为」两行', async () => {
    await act(async () =>
      root.render(
        createElement(EntityTreeRows, {
          showRelations: true,
          onShowRelationsChange: (v: boolean) => relationCalls.push(v),
          clickMode: 'open',
          onChangeClickMode: (m: SidebarClickMode) => modeCalls.push(m),
        })
      )
    );
    expect(host.querySelector('[data-testid="tag-tree-relations-toggle"]')).not.toBeNull();
    expect(host.querySelector('[role="group"]')!.getAttribute('aria-label')).toBe('单击实体行的行为');
    expect(buttons().map((b) => b.textContent)).toEqual(['', '筛选', '打开']);
    await act(async () => buttons()[1].click());
    expect(modeCalls).toEqual(['filter']);
  });
});
