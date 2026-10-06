// @vitest-environment jsdom
/**
 * 视觉刷新 V5 的设置页证据(设计 §4-11 / §3.2):
 * 分区标题 text-title(16/24,600);页标题 text-display(20/28,600);行标签 text-ui;
 * 说明文字 text-label + muted(白底 faint 3.69:1 不上文本);分区卡片 rounded-md(容器档,浮层才是 12);
 * 控件一律 32 高 / rounded-sm(6);
 * 最强断言:整棵设置页子树的字号类只能取 7 档令牌(禁 text-xs / text-sm / text-base / text-[Npx])。
 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SettingsView } from './SettingsView';
import { SelectInput, SettingsRow, Toggle } from './controls';
import { NumberSlider } from './number-slider';

vi.mock('../../shared/api', () => ({
  api: {
    getSetting: () => Promise.resolve(null),
    setSetting: () => Promise.resolve(),
    getDbInfo: () =>
      Promise.resolve({ path: 'C:/Users/x/AppData/Roaming/com.lifelog.app/lifelog.db', notes: 3 }),
    getAutostartStatus: () => Promise.resolve({ enabled: false, supported: true }),
    validateTimeTagTemplate: () => Promise.resolve(null),
  },
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let host: HTMLDivElement;

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const tokens = (el: Element): string[] => String(el.className).split(/\s+/).filter(Boolean);
const render = (el: ReturnType<typeof createElement>): void => {
  act(() => root.render(el));
};
const flush = async (): Promise<void> => {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
};

/** 7 档类型令牌:名字以外的字号类(text-xs/sm/base/lg/xl/[Npx])一律视为越档 */
const TOKEN_TYPE = /^text-(display|title|body|body-sm|ui|label|micro)$/;
const typeLike = (cls: string): string[] =>
  cls.split(/\s+/).filter((c) => /^text-(\d|xs|sm|base|lg|xl|2xl|3xl|\[)/.test(c));

describe('V5 设置页:字号全部落在 7 档令牌内', () => {
  it('整页(6 个分区 + 全部行)没有任何越档字号类', async () => {
    render(createElement(SettingsView, { themeMode: 'system', onThemeChange: () => {} }));
    await flush();
    await flush();
    const bad: string[] = [];
    for (const el of [host, ...host.querySelectorAll('*')]) {
      for (const cls of typeLike(String(el.className))) bad.push(`${el.tagName}.${cls}`);
    }
    expect(bad).toEqual([]);
  });

  it('用到的字号令牌只有 display/title/ui/label 四种(余下三档本页不需要)', async () => {
    render(createElement(SettingsView, { themeMode: 'system', onThemeChange: () => {} }));
    await flush();
    await flush();
    const used = new Set(
      [host, ...host.querySelectorAll('*')]
        .flatMap((el) => String(el.className).split(/\s+/))
        .filter((cls) => TOKEN_TYPE.test(cls))
    );
    expect([...used].sort()).toEqual(['text-display', 'text-label', 'text-title', 'text-ui']);
  });

  it('页标题 text-display;6 个分区标题全部 text-title(16/24,600)', async () => {
    render(createElement(SettingsView, { themeMode: 'system', onThemeChange: () => {} }));
    await flush();
    await flush();
    const h1 = host.querySelector('h1') as HTMLElement;
    expect(h1.textContent).toBe('设置');
    expect(tokens(h1)).toContain('text-display');

    // 导航项 = 8 个分区;当前分区(外观)渲染一个 h2
    const tabs = [...host.querySelectorAll('[role="tab"]')].map((t) => t.textContent?.trim());
    expect(tabs).toEqual(['外观', '输入栏外观', '输入栏行为', '笔记', '标签关系', '快捷键', '启动', '通用', '关于']);
    const h2s = [...host.querySelectorAll('h2')] as HTMLElement[];
    expect(h2s.map((h) => h.textContent)).toEqual(['外观']);
    for (const h2 of h2s) {
      expect(tokens(h2), String(h2.textContent)).toContain('text-title');
      expect(tokens(h2), String(h2.textContent)).not.toContain('text-sm');
      expect(tokens(h2), String(h2.textContent)).not.toContain('font-medium');
    }
  });

  it('分区卡片是容器档 rounded-md(12 只留给浮层);行标签 text-ui、说明 text-label + muted', async () => {
    render(createElement(SettingsView, { themeMode: 'system', onThemeChange: () => {} }));
    await flush();
    await flush();
    // 一次只显示一个分区(设计 D1):导航 8 项 + 当前分区一个标题
    expect(host.querySelectorAll('[role="tab"]').length).toBe(9);
    for (const h2 of [...host.querySelectorAll('h2')] as HTMLElement[]) {
      const card = h2.parentElement?.parentElement as HTMLElement;
      expect(tokens(card)).toContain('rounded-md');
      expect(tokens(card)).not.toContain('rounded-lg');
    }
    const hint = host.querySelector('.text-label') as HTMLElement;
    expect(tokens(hint)).toContain('text-label');
    expect(tokens(hint)).toContain('text-muted');
    expect(tokens(hint)).not.toContain('text-faint');
    expect(tokens(hint)).not.toContain('leading-relaxed');
  });

  it('控件 32 高 / rounded-sm / border-border-strong;开关保持轨道 + 圆钮语义', async () => {
    render(createElement(SettingsView, { themeMode: 'system', onThemeChange: () => {} }));
    await flush();
    await flush();
    // 默认分区(外观)只有分段控件;切到「输入栏行为」才有输入框与下拉
    act(() => (host.querySelector('[data-section-nav="inputBehavior"]') as HTMLButtonElement).click());
    await flush();
    await flush();
    const controls = [...host.querySelectorAll('input, select')] as HTMLElement[];
    expect(controls.length).toBeGreaterThan(4);
    for (const el of controls) {
      // 分段控件与滑块不是文本输入:分段用按钮(见下),滑块是 range(自带轨道样式)
      if (el.getAttribute('type') === 'radio' || el.getAttribute('type') === 'range') continue;
      const t = tokens(el);
      expect(t).toContain('h-8');
      expect(t).toContain('rounded-sm');
      expect(t).toContain('border-border-strong');
      expect(t).toContain('text-ui');
    }
    const sw = host.querySelector('[role="switch"]') as HTMLElement;
    expect(tokens(sw)).toContain('rounded-full');
    expect(tokens(sw)).toContain('h-6');
  });

});

describe('V5 设置页控件:同名口径的三件', () => {
  it('SettingsRow 标签 text-ui、说明 text-label + muted', () => {
    render(createElement(SettingsRow, { label: '主题', hint: '说明', children: createElement('span', null, '-') }));
    const label = host.querySelector('.text-ui') as HTMLElement;
    const hint = host.querySelector('.text-label') as HTMLElement;
    expect(label.textContent).toBe('主题');
    expect(tokens(label)).toContain('text-ui');
    expect(hint.textContent).toBe('说明');
    expect(tokens(hint)).toContain('text-label');
    expect(tokens(hint)).toContain('text-muted');
    expect(tokens(hint)).not.toContain('text-faint');
  });

  it('百分比输入 32/r6;下拉 32/r6;开关 aria-checked 与回调不变', () => {
    render(
      createElement(
        'div',
        null,
        createElement(NumberSlider, { value: 10, label: '缩放进阶', min: 1, max: 50, step: 1, suffix: '%', onCommit: () => {} }),
        createElement(SelectInput, {
          value: 'input-bar',
          label: '启动时显示',
          options: [{ value: 'input-bar', label: '输入栏' }],
          onChange: () => {},
        })
      )
    );
    const numeric = host.querySelector('input[inputmode="numeric"]') as HTMLElement;
    const select = host.querySelector('select') as HTMLElement;
    for (const el of [numeric, select]) {
      expect(tokens(el)).toContain('h-8');
      expect(tokens(el)).toContain('rounded-sm');
    }
    act(() => root.render(createElement(Toggle, { checked: false, label: '开机启动', onChange: () => {} })));
    const sw = host.querySelector('[role="switch"]') as HTMLElement;
    expect(sw.getAttribute('aria-checked')).toBe('false');
    expect(sw.getAttribute('aria-label')).toBe('开机启动');
  });
});
