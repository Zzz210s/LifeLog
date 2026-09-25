// @vitest-environment jsdom
/**
 * 导出反馈的"真复位"(计划 Task 6 点名的读数):useNotesExport 的 exported 2 秒后自己消失。
 * 此前只有 ExportNotice 的 props 渲染用例,没有任何读数钉住"到点复位"这条状态迁移。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import type { ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { useNotesExport } from './use-export';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { save, exportNotes } = vi.hoisted(() => ({
  save: vi.fn(async (_options: unknown): Promise<string | null> => 'C:/tmp/笔记导出.xlsx'),
  exportNotes: vi.fn(async (_path: string) => {}),
}));
vi.mock('@tauri-apps/plugin-dialog', () => ({ save }));
vi.mock('../../shared/api', () => ({ api: { exportNotes } }));

let root: Root | null = null;
let host: HTMLDivElement;
/** 渲染出的 hook 句柄(每次渲染刷新:与生产一样拿最新一份 onExport) */
let handle: { onExport: () => Promise<void> };

function Harness(): ReactNode {
  // 错误出口在本用例里不参与断言,只给能接受两个参数的函数
  const st = useNotesExport(() => {}, () => {});
  handle = { onExport: st.onExport };
  return createElement('div', { 'data-testid': 'state' }, `${st.exporting}|${st.exported}`);
}

/** 读「正在导出|已导出」两态(与生产 TopBar 的 props 同源) */
const state = (): string => host.querySelector('[data-testid="state"]')!.textContent ?? '';

/** 让在途 microtask(setState 提交 + effect)全部落地 */
const settle = async (): Promise<void> => {
  await act(async () => {
    for (let i = 0; i < 6; i++) await Promise.resolve();
  });
};

beforeEach(() => {
  vi.useFakeTimers();
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  act(() => root!.render(createElement(Harness)));
});
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  host.remove();
  document.body.innerHTML = '';
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe('整库导出的反馈复位(useNotesExport)', () => {
  it('导出中 -> 成功 -> 前进 2 秒自动复位', async () => {
    expect(state()).toBe('false|false');

    // 卡在保存对话框:解除前必须停在「正在导出」
    let release: (path: string) => void = () => {};
    save.mockReturnValueOnce(new Promise<string | null>((res) => { release = res; }));
    let started: Promise<void>;
    await act(async () => { started = handle.onExport(); });
    expect(state()).toBe('true|false');

    await act(async () => {
      release('C:/tmp/笔记导出.xlsx');
      await started!;
    });
    expect(state()).toBe('false|true');

    await act(async () => { vi.advanceTimersByTime(2000); });
    expect(state()).toBe('false|false'); // 到点真复位,不留常驻「已导出」
  });

  it('取消保存对话框:不写导出、也不留「正在导出」', async () => {
    save.mockResolvedValueOnce(null);
    await act(async () => { await handle.onExport(); });
    await settle();
    expect(state()).toBe('false|false');
    expect(exportNotes).not.toHaveBeenCalled();
  });
});
