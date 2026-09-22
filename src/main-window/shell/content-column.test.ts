// @vitest-environment node
/**
 * 视觉刷新 V4「内容列自适应」的组件证据(jsdom 里没有 Tailwind 计算值,故查类名 + 令牌源):
 * 有侧栏 -> max-w-3xl(768);侧栏隐藏 -> max-w-5xl(1024)。宽度档只取既有的 sidebar.visible,不新造状态。
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { contentColumnClass } from './content-column';

describe('V4 内容列宽度档', () => {
  it('有侧栏 768 / 无侧栏 1024', () => {
    expect(contentColumnClass(true)).toBe('max-w-3xl');
    expect(contentColumnClass(false)).toBe('max-w-5xl');
  });

  it('App 用 sidebar.visible 取宽度档,且不覆盖 min-w 保护与焦点环', () => {
    const app = readFileSync('src/main-window/App.tsx', 'utf8');
    expect(app).toContain('${contentColumnClass(sidebar.visible)}');
    for (const token of ['mx-auto', 'flex-1', 'min-w-[420px]', 'focus-visible:ring-1']) {
      expect(app, token).toContain(token);
    }
    // 旧写法必须消失:两串 max-w-* 同时出现时,谁生效取决于 Tailwind 规则顺序,读代码看不出来
    expect(app).not.toContain('min-w-[420px] max-w-3xl');
  });

  it('theme.css 没有重定义 container 刻度,max-w-3xl/5xl 仍是 Tailwind 默认的 768/1024', () => {
    const css = readFileSync('src/shared/theme.css', 'utf8');
    expect(css).not.toMatch(/--container-(3xl|5xl)/);
  });

  it('可见性只有一个真源:App 把同一个 sidebar.visible 喂给侧栏与宽度档', () => {
    const app = readFileSync('src/main-window/App.tsx', 'utf8');
    expect(app).toContain('sidebarVisible={sidebar.visible}');
    expect(app).toContain('contentColumnClass(sidebar.visible)');
    // 不允许在 App 里另存一份可见性(第二真源)
    expect(app).not.toMatch(/useState\([^)]*[Vv]isible/);
  });
});
