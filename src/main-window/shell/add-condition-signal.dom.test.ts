// @vitest-environment jsdom
/**
 * 「添加条件」命令的一次性信号 -> 受控菜单开关(Task 2,评审交接项 ②)。
 * 命令只把 `addConditionOpen` 置真一次,消费方(菜单)必须**消费即复位**:
 * 不复位的话,同一次信号会在后来的重渲染/重挂载里把菜单反复弹开(评审原话「菜单恒弹」)。
 * 这里用真 `useAppCommands`(不是桩)驱动,信号来源与生产一致。
 */
import { act, createElement, useState } from 'react';
import type { ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAppCommands } from './use-app-commands';
import type { AppCommands } from './use-app-commands';
import { useAddConditionMenu } from './use-add-condition-menu';

vi.mock('../../shared/api', () => ({
  api: { rebuildSearchIndex: vi.fn(async () => 1), quitApp: vi.fn(async () => {}) },
}));
vi.mock('@tauri-apps/plugin-dialog', () => ({ confirm: vi.fn(async () => true) }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

interface Probe {
  commands: AppCommands;
  open: boolean;
  setOpen: (open: boolean) => void;
  /** 一次与信号无关的重渲染(模拟信息流加载/导出状态变化) */
  bump: () => void;
}

let root: Root;
let host: HTMLDivElement;
let box: { p: Probe | null };
/** 每次渲染都会换一个 Probe 快照,断言必须取最新的那个 */
const probe = (): Probe => box.p as Probe;

function mount(): void {
  act(() =>
    root.render(
      createElement(function Harness(): ReactNode {
        const commands = useAppCommands({
          sidebar: { visible: true, setVisible: vi.fn() },
          theme: { mode: 'system', setMode: vi.fn() },
          setView: vi.fn(),
          onPatch: vi.fn(),
          exportAll: vi.fn(async () => {}),
          setError: vi.fn(),
        });
        const [, setN] = useState(0);
        const { open, setOpen } = useAddConditionMenu(commands);
        box.p = { commands, open, setOpen, bump: () => setN((n) => n + 1) };
        return null;
      })
    )
  );
}

const execute = async (id: string): Promise<void> => {
  await act(async () => {
    await probe().commands.execute(id);
  });
};

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  box = { p: null };
  mount();
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  document.body.innerHTML = '';
});

describe('添加条件信号:消费即复位', () => {
  it('初始信号为假,菜单关着', () => {
    expect(probe().commands.addConditionOpen).toBe(false);
    expect(probe().open).toBe(false);
  });

  it('执行 filter.addCondition:菜单打开,且信号当次就复位', async () => {
    await execute('filter.addCondition');
    expect(probe().open).toBe(true);
    expect(probe().commands.addConditionOpen).toBe(false); // 复位(不复位就恒弹)
  });

  it('关掉菜单后,一次无关重渲染不会再弹(信号没有残留)', async () => {
    await execute('filter.addCondition');
    act(() => probe().setOpen(false));
    expect(probe().open).toBe(false);
    act(() => probe().bump());
    expect(probe().open).toBe(false);
  });

  it('再次执行命令仍能打开(信号的上升沿不被上次消费吃掉)', async () => {
    await execute('filter.addCondition');
    act(() => probe().setOpen(false));
    await execute('filter.addCondition');
    expect(probe().open).toBe(true);
    expect(probe().commands.addConditionOpen).toBe(false);
  });
});
