// @vitest-environment jsdom
/**
 * 设置页「维护」小节(任务书 2026-10-17 档 1 第 ③ 条):把三条原本只有命令面板能做的事
 * 补到界面。这里用假 IPC(确认框 + 三个注入回调)钉住:
 *   ① 小节标题与三行都在,命令面板的三条命令**不删**(入口增加,不是搬家);
 *   ② 重建索引:先确认,回执带条数与耗时;取消确认则不执行;
 *   ③ 导出整库:调用既有导出并显示默认文件名;导出中按钮禁用且改文案;
 *   ④ 专注模式:开关显示当前状态,点击交给上层(与命令面板同一份状态)。
 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { confirm } = vi.hoisted(() => ({ confirm: vi.fn(async (_msg: string, _opts?: unknown) => true) }));
vi.mock('@tauri-apps/plugin-dialog', () => ({ confirm }));

import { MaintenanceSection } from './MaintenanceSection';
import type { MaintenanceProps } from './MaintenanceSection';
import { EXPORT_DEFAULT_PATH } from '../data/use-export';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let host: HTMLDivElement;

beforeEach(() => {
  confirm.mockResolvedValue(true);
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.clearAllMocks();
});

const render = async (over: MaintenanceProps = {}): Promise<MaintenanceProps> => {
  const props: MaintenanceProps = {
    reindex: vi.fn(async () => ({ rows: 42, ms: 311 })),
    exportAll: vi.fn(async () => {}),
    exporting: false,
    focus: { on: false, toggle: vi.fn() },
    ...over,
  };
  await act(async () => root.render(createElement(MaintenanceSection, props)));
  return props;
};

const byTestId = (id: string): HTMLElement | null => host.querySelector(`[data-testid="${id}"]`);

describe('设置页「维护」小节:三行都在', () => {
  it('标题为「维护」,三行分别是搜索索引 / 导出整库 / 专注模式', async () => {
    await render();
    expect(host.querySelector('h2')?.textContent).toBe('维护');
    const text = host.textContent ?? '';
    expect(text).toContain('搜索索引');
    expect(text).toContain('导出整库');
    expect(text).toContain('专注模式');
    expect(text).toContain('重建索引与导出会写磁盘');
  });

  it('三项都是可点的控件(不是只读说明)', async () => {
    await render();
    expect(byTestId('maintenance-reindex')?.tagName).toBe('BUTTON');
    expect(byTestId('maintenance-export')?.tagName).toBe('BUTTON');
    expect(byTestId('maintenance-focus-toggle')?.getAttribute('role')).toBe('switch');
  });
});

describe('重建搜索索引:确认 + 条数与耗时回执', () => {
  it('确认后执行一次,回执写清 N 条与耗时', async () => {
    const p = await render();
    await act(async () => byTestId('maintenance-reindex')!.click());
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(String(confirm.mock.calls[0][0])).toContain('FTS');
    expect(p.reindex).toHaveBeenCalledTimes(1);
    const receipt = byTestId('maintenance-receipt');
    expect(receipt?.textContent).toBe('搜索索引已重建(42 条,耗时 311 ms)');
    expect(String(receipt?.className)).toContain('text-success');
  });

  it('取消确认:不执行、不回执', async () => {
    confirm.mockResolvedValueOnce(false);
    const p = await render();
    await act(async () => byTestId('maintenance-reindex')!.click());
    expect(p.reindex).not.toHaveBeenCalled();
    expect(byTestId('maintenance-receipt')).toBeNull();
  });

  it('执行中按钮禁用并改文案;失败落红色回执(不静默)', async () => {
    let fail!: (e: Error) => void;
    const reindex = vi.fn(
      () => new Promise<{ rows: number; ms: number }>((_ok, no) => (fail = no)),
    );
    await render({ reindex });
    act(() => byTestId('maintenance-reindex')!.click());
    await act(async () => {
      await Promise.resolve();
    });
    expect(byTestId('maintenance-reindex')!.textContent).toBe('正在重建…');
    expect((byTestId('maintenance-reindex') as HTMLButtonElement).disabled).toBe(true);
    await act(async () => {
      fail(new Error('库锁住了'));
      await Promise.resolve();
    });
    const receipt = byTestId('maintenance-receipt');
    expect(receipt?.textContent).toContain('重建失败');
    expect(receipt?.textContent).toContain('库锁住了');
    expect(String(receipt?.className)).toContain('text-danger');
    expect((byTestId('maintenance-reindex') as HTMLButtonElement).disabled).toBe(false);
  });
});

describe('导出整库:复用既有导出命令', () => {
  it('点击调用一次;说明里给出默认文件名', async () => {
    const p = await render();
    expect(host.textContent).toContain(EXPORT_DEFAULT_PATH);
    await act(async () => byTestId('maintenance-export')!.click());
    expect(p.exportAll).toHaveBeenCalledTimes(1);
  });

  it('导出中按钮禁用并显示「正在导出…」', async () => {
    await render({ exporting: true });
    const btn = byTestId('maintenance-export') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    expect(btn.textContent).toBe('正在导出…');
  });
});

describe('专注模式:开关型,显示当前状态', () => {
  it('当前开/关读进开关与说明;点击把切换交给上层', async () => {
    const off = await render();
    const toggle = byTestId('maintenance-focus-toggle')!;
    expect(toggle.getAttribute('aria-checked')).toBe('false');
    expect(host.textContent).toContain('当前:关');
    await act(async () => toggle.click());
    expect(off.focus!.toggle).toHaveBeenCalledTimes(1);

    const on = await render({ focus: { on: true, toggle: vi.fn() } });
    expect(byTestId('maintenance-focus-toggle')!.getAttribute('aria-checked')).toBe('true');
    expect(host.textContent).toContain('当前:开');
    expect(on.focus!.on).toBe(true);
  });
});
