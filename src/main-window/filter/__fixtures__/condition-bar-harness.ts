// @vitest-environment jsdom
/**
 * `ConditionBar` 的 DOM 用例装配(“只剩 chips”与“受控菜单”两份主题共用,守 200 行红线)。
 * 数据层 mock(`api.carriedTagPaths` / `api.conditionHitCounts`)由用例文件自己 `vi.mock` 提供 ——
 * `vi.mock` 必须写在用例文件里:助手模块体执行得更晚,写在这里就太迟。
 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { EMPTY_FILTER } from '../../../shared/filter-conditions';
import type { FilterConditions } from '../../../shared/filter-conditions';
import { ConditionBar } from '../ConditionBar';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** 六种 chip 各一个:关键词 / 标签 / 排除标签 / 有无标签 / 表达式 / 排序 */
export const FULL_BAR_COND: FilterConditions = {
  ...EMPTY_FILTER,
  keyword: '电影',
  tags: [{ path: '工作', includeChildren: true }],
  excludeTags: [{ path: '临时', includeChildren: false }],
  tagPresence: 'none',
  expr: '#工作 AND NOT #临时',
  sort: 'oldest',
  sorts: [{ kind: 'time', dir: 'asc', enabled: true }],
};

export const tokensOf = (el: Element): string[] =>
  String(el.className).split(/\s+/).filter(Boolean);

/** 按钮的可见文本 + aria-label(入口按这两个维度判定,不只看纯文本) */
export const buttonTextOf = (b: HTMLButtonElement): string =>
  `${b.textContent ?? ''} ${b.getAttribute('aria-label') ?? ''}`;

export interface MountedBar {
  render: (c?: FilterConditions, addConditionOpen?: boolean) => Promise<void>;
  unmount: () => void;
  /** 本用例已回传的补丁(顺序即调用顺序) */
  patches: () => Array<Partial<FilterConditions>>;
  /** 菜单受控开关的历次回传 */
  opens: () => boolean[];
  host: () => HTMLDivElement;
  bar: () => HTMLElement;
  chips: () => HTMLElement[];
  menu: () => HTMLElement | null;
  buttons: () => HTMLButtonElement[];
}

export function mountConditionBar(): MountedBar {
  let patches: Array<Partial<FilterConditions>> = [];
  let opens: boolean[] = [];
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root: Root = createRoot(host);

  const render = async (conditions: FilterConditions = EMPTY_FILTER, addConditionOpen = false) => {
    await act(async () => {
      root.render(
        createElement(ConditionBar, {
          conditions,
          onPatch: (v: Partial<FilterConditions>) => patches.push(v),
          addConditionOpen,
          onAddConditionOpenChange: (open: boolean) => opens.push(open),
        })
      );
    });
  };

  return {
    render,
    unmount: () => {
      act(() => root.unmount());
      host.remove();
    },
    patches: () => patches,
    opens: () => opens,
    host: () => host,
    bar: () => host.firstElementChild as HTMLElement,
    chips: () =>
      [...host.querySelectorAll('[aria-label="已生效的筛选条件"] > span')] as HTMLElement[],
    menu: () => host.querySelector('[role="menu"]'),
    buttons: () => [...host.querySelectorAll('button')] as HTMLButtonElement[],
  };
}
