// @vitest-environment jsdom
/**
 * 设置页导航与分区(2026-10-04 重构 D1/D5/D8):
 *   左导航 8 项、点击切换分区、当前项 aria-current、分区底部「恢复本分区默认」、
 *   页顶「全部恢复默认」。从 v5-settings-style.dom.test.ts 拆出(那份顶到 200 行红线)。
 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SettingsView } from './SettingsView';
import { SettingsRow } from './controls';

vi.mock('../../shared/api', () => ({
  api: {
    getSetting: () => Promise.resolve(null),
    setSetting: () => Promise.resolve(),
    getDbInfo: () => Promise.resolve({ path: 'C:/tmp/lifelog.db', notes: 3 }),
  },
}));
vi.mock('@tauri-apps/plugin-dialog', () => ({ confirm: () => Promise.resolve(false) }));
vi.mock('@tauri-apps/plugin-opener', () => ({ revealItemInDir: () => Promise.resolve() }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement;

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root?.unmount());
  host.remove();
});

const flush = async (): Promise<void> => {
  await act(async () => { await Promise.resolve(); });
};

const nav = (id: string): HTMLButtonElement => {
  const el = host.querySelector(`[data-section-nav="${id}"]`);
  if (!el) throw new Error('未找到导航项 ' + id);
  return el as HTMLButtonElement;
};

describe('设置页导航', () => {
  it('导航 8 项;当前项 aria-current=true 且只有它可 Tab 进入', async () => {
    await act(async () => { root?.render(createElement(SettingsView, { themeMode: 'system', onThemeChange: () => {} })); });
    await flush();
    const tabs = [...host.querySelectorAll('[role="tab"]')] as HTMLButtonElement[];
    expect(tabs.length).toBe(8);
    expect(tabs.filter((t) => t.getAttribute('aria-current') === 'true').map((t) => t.textContent?.trim())).toEqual(['外观']);
    expect(tabs.filter((t) => t.tabIndex === 0).length).toBe(1);
  });

  it('点导航切分区:标题与内容跟着换', async () => {
    await act(async () => { root?.render(createElement(SettingsView, { themeMode: 'system', onThemeChange: () => {} })); });
    await flush();
    expect(host.querySelector('h2')?.textContent).toBe('外观');
    await act(async () => { nav('about').click(); });
    await flush();
    expect(host.querySelector('h2')?.textContent).toBe('关于');
    expect(host.querySelector('[data-section="about"]')).not.toBeNull();
  });

  it('方向键可切换分区(键盘可达)', async () => {
    await act(async () => { root?.render(createElement(SettingsView, { themeMode: 'system', onThemeChange: () => {} })); });
    await flush();
    await act(async () => {
      host.querySelector('[role="tablist"]')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    });
    await flush();
    expect(host.querySelector('h2')?.textContent).toBe('输入栏外观');
  });

  it('主题分段控件点击即回调(设计 D4)', async () => {
    const onThemeChange = vi.fn();
    await act(async () => { root?.render(createElement(SettingsView, { themeMode: 'system', onThemeChange })); });
    await flush();
    const themeButtons = [...host.querySelectorAll('[role="group"][aria-label="主题"] button')] as HTMLButtonElement[];
    expect(themeButtons.map((b) => b.textContent?.trim())).toEqual(['跟随系统', '亮色', '暗色']);
    await act(async () => { themeButtons[2].click(); });
    expect(onThemeChange).toHaveBeenCalledWith('dark');
  });

  it('分区底部有「恢复本分区默认」;页顶有「全部恢复默认」', async () => {
    await act(async () => { root?.render(createElement(SettingsView, { themeMode: 'system', onThemeChange: () => {} })); });
    await flush();
    await act(async () => { nav('inputBehavior').click(); });
    await flush();
    const texts = [...host.querySelectorAll('button')].map((b) => b.textContent?.trim());
    expect(texts).toContain('恢复本分区默认');
    expect(texts).toContain('全部恢复默认');
  });

  it('行容器:标签在左、控件在右', async () => {
    await act(async () => {
      root?.render(createElement(SettingsRow, { label: '主题', hint: '说明', children: createElement('span', null, 'x') }));
    });
    const row = host.querySelector('div > div') as HTMLElement;
    expect(row.className).toContain('justify-between');
  });
});

describe('每个分区的恢复默认', () => {
  it('笔记/快捷键/启动 三个分区也各有一个恢复按钮(设计 D5)', async () => {
    for (const id of ['notes', 'hotkey', 'startup', 'appearance', 'inputAppearance', 'inputBehavior']) {
      await act(async () => { root?.render(createElement(SettingsView, { themeMode: 'system', onThemeChange: () => {} })); });
      await flush();
      await act(async () => { nav(id).click(); });
      await flush();
      await flush();
      const labels = [...host.querySelectorAll('button')].map((b) => b.textContent?.trim());
      // 外观分区的按钮文案带补充说明,故只断言前缀
      expect(labels.some((t) => (t || '').startsWith('恢复')), id).toBe(true);
    }
  });
});
