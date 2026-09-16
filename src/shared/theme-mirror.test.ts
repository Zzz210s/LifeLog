// @vitest-environment jsdom
// 主题镜像的首帧逻辑与两个 HTML 内联脚本的一致性(镜像只做首帧优化,真源仍是设置表)。
import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it } from 'vitest';
import { mirrorDark, readThemeMirror, THEME_MIRROR_KEY, writeThemeMirror } from './theme-mode';

beforeEach(() => {
  localStorage.clear();
});

describe('mirrorDark', () => {
  it('镜像值决定首帧是否暗色', () => {
    expect(mirrorDark('dark', false)).toBe(true); // 显式暗色压过系统亮色
    expect(mirrorDark('light', true)).toBe(false); // 显式亮色压过系统暗色
    expect(mirrorDark('system', true)).toBe(true);
    expect(mirrorDark('system', false)).toBe(false);
    expect(mirrorDark(null, true)).toBe(true); // 首次运行:按系统
    expect(mirrorDark(undefined, false)).toBe(false);
    expect(mirrorDark('bogus', false)).toBe(false); // 非法值:按系统
    expect(mirrorDark('bogus', true)).toBe(true);
  });
});

describe('HTML 内联脚本', () => {
  it('两个 HTML 的内联脚本与 TS 逻辑同键同名', () => {
    for (const file of ['index.html', 'input.html']) {
      const html = readFileSync(file, 'utf8');
      expect(html).toContain(THEME_MIRROR_KEY);
      expect(html).toContain("classList.add('dark')");
      expect(html).toContain('prefers-color-scheme: dark');
      // 必须在内联脚本里(不是 module 脚本),且出现在 module 脚本之前
      expect(html.indexOf("classList.add('dark')")).toBeLessThan(html.indexOf('type="module"'));
    }
  });

  it('两个 HTML 的内联脚本内容一致', () => {
    const pick = (file: string) => {
      const html = readFileSync(file, 'utf8');
      return html.slice(html.indexOf('<script>'), html.indexOf('</script>') + 9);
    };
    expect(pick('index.html')).toBe(pick('input.html'));
  });
});

describe('readThemeMirror', () => {
  it('读回写入的镜像;缺失时 null(与内联脚本同一判定入口)', () => {
    expect(readThemeMirror()).toBeNull();
    writeThemeMirror('dark');
    expect(readThemeMirror()).toBe('dark');
  });

  it('storage 不可用时返回 null', () => {
    const original = Storage.prototype.getItem;
    Storage.prototype.getItem = () => {
      throw new Error('denied');
    };
    try {
      expect(readThemeMirror()).toBeNull();
    } finally {
      Storage.prototype.getItem = original;
    }
  });
});

describe('writeThemeMirror', () => {
  it('写镜像把三态存进 localStorage', () => {
    writeThemeMirror('dark');
    expect(localStorage.getItem(THEME_MIRROR_KEY)).toBe('dark');
    writeThemeMirror('light');
    expect(localStorage.getItem(THEME_MIRROR_KEY)).toBe('light');
    writeThemeMirror('system');
    expect(localStorage.getItem(THEME_MIRROR_KEY)).toBe('system');
  });

  it('localStorage 抛异常时静默(不阻断主题应用)', () => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = () => {
      throw new Error('quota');
    };
    try {
      expect(() => writeThemeMirror('dark')).not.toThrow();
    } finally {
      Storage.prototype.setItem = original;
    }
  });
});
