// @vitest-environment jsdom
/**
 * 应用内快捷键录制行的组件证据:录制 -> 提交原始组合、清除、恢复默认、
 * 冲突(与系统级/彼此)时给中文提示且**不保存**、非法组合就地提示(不发命令)、
 * 显示走中文键名(hotkey-display)。
 * 一律派发真实 keydown(React 挂在 root 上),直调 handler 挡不住回归。
 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppHotkeyRow } from './AppHotkeyRow';

const h = vi.hoisted(() => ({
  calls: [] as Array<{ kind: string; accelerator: string }>,
  fail: null as string | null,
}));

vi.mock('../../shared/api', () => ({
  api: {
    setAppHotkey: (kind: string, accelerator: string) => {
      h.calls.push({ kind, accelerator });
      return h.fail === null ? Promise.resolve(accelerator) : Promise.reject(h.fail);
    },
  },
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let host: HTMLDivElement;
let saved: string[];

beforeEach(() => {
  h.calls.length = 0;
  h.fail = null;
  saved = [];
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const flush = async (): Promise<void> => {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
};

/** 渲染一行(默认 kind=quickOpen,库值可指定) */
const render = (stored: string | null = null): void => {
  act(() =>
    root.render(
      createElement(AppHotkeyRow, {
        kind: 'quickOpen',
        label: '快速打开笔记',
        hint: '应用内快捷键:主窗按一下打开笔记浮层,输入关键词即搜',
        ariaLabel: '录制快捷键:快速打开笔记',
        stored,
        onSaved: (value: string) => saved.push(value),
      })
    )
  );
};

/** 录制按钮是行内第一个按钮(捕获态会改 aria-label,故不能按名字查) */
const recorder = (): HTMLButtonElement => host.querySelectorAll('button')[0] as HTMLButtonElement;
const errorText = (): string => host.querySelector('.text-danger')?.textContent ?? '';
const button = (text: string): HTMLButtonElement =>
  [...host.querySelectorAll('button')].find((b) => b.textContent?.trim() === text) as HTMLButtonElement;

/** 真实 keydown:捕获态按钮上派发(录制器读 ctrlKey/code 等) */
const press = (init: KeyboardEventInit): void => {
  act(() => {
    recorder().dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }));
  });
};

describe('显示:中文键名与默认值', () => {
  it('库值缺失时显示默认键的中文键名(Ctrl + P)', () => {
    render(null);
    expect(recorder().textContent).toBe('Ctrl + P');
    expect(button('清除').disabled).toBe(true); // 未自定义 -> 没什么可清除
    expect(button('恢复默认').disabled).toBe(true);
  });

  it('命名键走 hotkey-display 的中文文案(space -> 空格)', () => {
    render('ctrl+space');
    expect(recorder().textContent).toBe('Ctrl + 空格');
    expect(button('清除').disabled).toBe(false);
  });
});

describe('录制', () => {
  it('按下 Ctrl+Alt+K:提交原始组合,回传 Rust 的规范化值', async () => {
    render(null);
    act(() => recorder().click());
    expect(recorder().getAttribute('aria-label')).toBe('请按下快捷键');
    press({ key: 'k', code: 'KeyK', ctrlKey: true, altKey: true });
    await flush();
    expect(h.calls).toEqual([{ kind: 'quickOpen', accelerator: 'ctrl+alt+k' }]);
    expect(saved).toEqual(['ctrl+alt+k']);
    expect(errorText()).toBe('');
    expect(recorder().getAttribute('aria-label')).toBe('录制快捷键:快速打开笔记');
  });

  it('只按修饰键是中途态:不提交、不报错', () => {
    render(null);
    act(() => recorder().click());
    press({ key: 'Control', code: 'ControlLeft', ctrlKey: true });
    expect(h.calls).toEqual([]);
    expect(errorText()).toBe('');
  });

  it('非法组合就地中文提示且不发命令(旧键不受影响)', () => {
    render(null);
    act(() => recorder().click());
    press({ key: 'k', code: 'KeyK' }); // 单个普通键
    expect(errorText()).toContain('F1-F24');
    expect(h.calls).toEqual([]);
  });
});

describe('冲突:中文提示且拒绝保存(旧值保留)', () => {
  it('与系统级全局热键冲突', async () => {
    h.fail = 'ctrl+shift+q 已被系统级全局快捷键占用(输入栏唤起键),请换一个组合';
    render(null);
    act(() => recorder().click());
    press({ key: 'q', code: 'KeyQ', ctrlKey: true, shiftKey: true });
    await flush();
    expect(errorText()).toBe(h.fail);
    expect(saved).toEqual([]); // 没保存
    press({ key: 'Escape' }); // 取消录制后回到旧值
    expect(recorder().textContent).toBe('Ctrl + P');
  });

  it('与另一个应用内快捷键冲突', async () => {
    h.fail = 'ctrl+p 已被「命令面板」占用,请换一个组合';
    render('ctrl+alt+k');
    act(() => recorder().click());
    press({ key: 'p', code: 'KeyP', ctrlKey: true });
    await flush();
    expect(errorText()).toContain('命令面板');
    expect(saved).toEqual([]);
    press({ key: 'Escape' });
    expect(recorder().textContent).toBe('Ctrl + Alt + K'); // 旧值(库里那条)没被改掉
  });

  it('未知键名:TS 预检放行,由 Rust 给中文原因(不静默死键)', async () => {
    h.fail = '无法识别的按键:intlbackslash';
    render(null);
    act(() => recorder().click());
    press({ key: '\\', code: 'IntlBackslash', ctrlKey: true });
    await flush();
    expect(errorText()).toContain('无法识别的按键');
    expect(h.calls).toEqual([{ kind: 'quickOpen', accelerator: 'ctrl+intlbackslash' }]);
  });
});

describe('清除与恢复默认', () => {
  it('清除写空串并回传(分区回传后界面回退默认键)', async () => {
    render('ctrl+space');
    act(() => button('清除').click());
    await flush();
    expect(h.calls).toEqual([{ kind: 'quickOpen', accelerator: '' }]);
    expect(saved).toEqual(['']);
    render(''); // 模拟分区拿到新值后的重渲染
    expect(recorder().textContent).toBe('Ctrl + P');
    expect(button('清除').disabled).toBe(true);
  });

  it('恢复默认写回默认键值', async () => {
    render('ctrl+space');
    act(() => button('恢复默认').click());
    await flush();
    expect(h.calls).toEqual([{ kind: 'quickOpen', accelerator: 'ctrl+p' }]);
    expect(saved).toEqual(['ctrl+p']);
  });
});
