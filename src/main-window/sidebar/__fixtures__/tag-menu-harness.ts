// @vitest-environment jsdom
/**
 * 标签菜单 DOM 用例的共享夹具(架构精简 C2,2026-10-27)。
 *
 * 六个 `tag-menu-*.dom.test.ts` 原来各自写一遍:act 环境开关、`host`/`root` 建挂、
 * 卸载清理、`flush`、`at()` 计数器、菜单项查找 —— 同一份 setup 抄了六遍,改一处要改六处。
 * 这里收成一份,**不改变任何一个用例的断言**。
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { TagCount } from '../../../shared/types';

// React 18 的 act 环境开关:必须在渲染前设好,且整个 jsdom 文件共用一次
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** 建一个挂在 body 上的渲染宿主;返回的 `unmount` 负责卸载并移除节点 */
export function mountHost(): { host: HTMLDivElement; root: Root; unmount: () => void } {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  return {
    host,
    root,
    unmount: () => {
      act(() => root.unmount());
      host.remove();
    },
  };
}

/** 等一拍(挂起 promise / effect 落地) */
export async function flush(): Promise<void> {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}

/** `TagCount` 工厂:用例里只关心 id 与路径,其余取零值 */
export function at(id: number, path: string): TagCount {
  return { id, path, depth: path.split('/').length - 1, sort_order: id, self_count: 0, subtree_count: 0 };
}

/** 按可见文字找菜单项(菜单项与普通按钮都算) */
export function itemOf(host: HTMLElement, text: string): HTMLElement {
  return [...host.querySelectorAll<HTMLElement>('[role="menuitem"], button')].find(
    (b) => b.textContent?.trim() === text
  ) as HTMLElement;
}

/** 列出所有菜单项文字(用于"恰好五档"这类断言) */
export function menuItemsOf(host: HTMLElement): string[] {
  return [...host.querySelectorAll('[role^="menuitem"]')].map((b) => b.textContent?.trim() ?? '');
}
