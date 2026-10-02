// 亮暗判定:主题落在 <html> 的 class 上(见 shared/theme-mode),输入栏读它决定用哪份颜色。
// 不用 matchMedia(documentElement 的 .dark 才是真源,系统态也已由 useThemeMode 落成 class)。
// @vitest-environment jsdom
import { act, createElement } from 'react';
import type { ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { isDarkClass, useIsDark } from './use-is-dark';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;
let seen: boolean | null = null;

function Probe(): ReactNode {
  seen = useIsDark();
  return createElement('span', null, String(seen));
}

const settle = (): Promise<void> =>
  act(async () => {
    for (let i = 0; i < 3; i++) await Promise.resolve();
  });

beforeEach(() => {
  document.documentElement.className = '';
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  seen = null;
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  document.documentElement.className = '';
});

describe('isDarkClass', () => {
  it('按空格切分后精确命中 dark', () => {
    expect(isDarkClass('dark')).toBe(true);
    expect(isDarkClass('dark text-ui')).toBe(true);
    expect(isDarkClass('text-ui dark')).toBe(true);
    expect(isDarkClass('')).toBe(false);
    expect(isDarkClass('darken')).toBe(false);
  });
});

describe('useIsDark', () => {
  it('挂载时读 <html> 已落的 class', async () => {
    document.documentElement.classList.add('dark');
    await act(async () => {
      root.render(createElement(Probe));
    });
    expect(seen).toBe(true);
  });

  it('class 变化后重读(MutationObserver)', async () => {
    await act(async () => {
      root.render(createElement(Probe));
    });
    expect(seen).toBe(false);
    await act(async () => {
      document.documentElement.classList.add('dark');
      await Promise.resolve();
    });
    await settle();
    expect(seen).toBe(true);
    await act(async () => {
      document.documentElement.classList.remove('dark');
      await Promise.resolve();
    });
    await settle();
    expect(seen).toBe(false);
  });
});
