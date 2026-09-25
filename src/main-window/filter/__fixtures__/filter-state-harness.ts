// @vitest-environment jsdom
/**
 * `useFilterState` 的测试装配(正常路径与错误分支两份主题共用,单文件守 200 行红线)。
 *
 * 数据层(mock IPC)由各用例文件自己 `vi.mock('../../shared/api')` 提供 ——
 * `vi.mock` 必须写在用例文件里:助手的静态 import 先于助手模块体执行,写在这里会太晚。
 * 这里只给"挂载 + 微任务/定时器推进 + 屏幕读数"这些与断言无关的样板。
 */
import { act, createElement } from 'react';
import type { ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { vi } from 'vitest';
import type { FilterConditions } from '../../../shared/filter-conditions';
import { useFilterState } from '../use-filter-state';
import type { FilterStateApi } from '../use-filter-state';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

export interface MountedState {
  /** hook 句柄(每次渲染刷新,断言必须取最新一份) */
  api: () => FilterStateApi;
  mount: () => void;
  unmount: () => void;
  /** 让在途 microtask(setState 提交 + effect)全部落地 */
  settle: () => Promise<void>;
  advance: (ms: number) => Promise<void>;
  /** 屏幕上正在生效的条件(与生产里查询/侧栏选中态同源) */
  shown: () => FilterConditions;
}

export function mountFilterState(): MountedState {
  const host = document.createElement('div');
  document.body.append(host);
  const root: Root = createRoot(host);
  let current: FilterStateApi | null = null;
  let mounted = false;

  function Harness(): ReactNode {
    current = useFilterState();
    return createElement('div', { 'data-testid': 'cond' }, JSON.stringify(current.conditions));
  }

  return {
    api: () => current as FilterStateApi,
    mount: () => {
      mounted = true;
      act(() => root.render(createElement(Harness)));
    },
    unmount: () => {
      if (!mounted) return;
      mounted = false;
      act(() => root.unmount());
      host.remove();
    },
    settle: async () => {
      await act(async () => {
        for (let i = 0; i < 8; i++) await Promise.resolve();
      });
    },
    advance: async (ms: number) => {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(ms);
      });
    },
    shown: () =>
      JSON.parse(host.querySelector('[data-testid="cond"]')!.textContent ?? 'null') as FilterConditions,
  };
}
