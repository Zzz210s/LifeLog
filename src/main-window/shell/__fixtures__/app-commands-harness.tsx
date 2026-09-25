/**
 * 命令面板副作用的共用夹具(仅测试引用;文件名不含 .test,不被收集)。
 * 暴露可变的状态桩:run 里通过 `latest` ref 现读,所以测试可以中途改 `visible` / `activeIndex`
 * 再跑同一条命令,验证读的是最新状态而不是闭包旧值。
 */
import { act, createElement } from 'react';
import type { ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { vi } from 'vitest';
import type { ThemeMode } from '../../../shared/theme-mode';
import { useAppCommands } from '../use-app-commands';
import type { AppCommands, CommandStatus } from '../use-app-commands';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

export interface AppCommandsHarness {
  commands: () => AppCommands;
  status: () => CommandStatus | null;
  /** 每次渲染记录到的状态文本(按变化追加):用于断言"进行中状态"真的渲染过 */
  statusLog: string[];
  tabs: { count: number; activeIndex: number; activate: ReturnType<typeof vi.fn> };
  sidebar: { visible: boolean; setVisible: ReturnType<typeof vi.fn> };
  theme: { mode: ThemeMode; setMode: ReturnType<typeof vi.fn> };
  setView: ReturnType<typeof vi.fn>;
  onPatch: ReturnType<typeof vi.fn>;
  exportAll: ReturnType<typeof vi.fn>;
  setError: ReturnType<typeof vi.fn>;
  unmount: () => void;
}

/** 可覆写的初始状态(函数桩一律用夹具自己的 vi.fn,不外部注入) */
export interface HarnessOverrides {
  tabs?: { count?: number; activeIndex?: number };
  sidebar?: { visible?: boolean };
  theme?: { mode?: ThemeMode };
}

export function mountAppCommands(over: HarnessOverrides = {}): AppCommandsHarness {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root: Root = createRoot(host);
  const box: { c: AppCommands | null } = { c: null };
  const tabs = { count: 3, activeIndex: 1, activate: vi.fn(), ...over.tabs };
  const sidebar = { visible: true, setVisible: vi.fn(), ...over.sidebar };
  const theme = { mode: 'system' as ThemeMode, setMode: vi.fn(), ...over.theme };
  const setView = vi.fn();
  const onPatch = vi.fn();
  const exportAll = vi.fn(async () => {});
  const setError = vi.fn();
  const statusLog: string[] = [];

  act(() =>
    root.render(
      createElement(function Host(): ReactNode {
        box.c = useAppCommands({ tabs, sidebar, theme, setView, onPatch, exportAll, setError });
        const text = box.c.status?.text ?? '';
        if (text !== '' && statusLog[statusLog.length - 1] !== text) statusLog.push(text);
        return null;
      }),
    ),
  );

  return {
    commands: () => box.c as AppCommands,
    status: () => (box.c as AppCommands).status,
    statusLog,
    tabs,
    sidebar,
    theme,
    setView,
    onPatch,
    exportAll,
    setError,
    unmount: () => {
      act(() => root.unmount());
      host.remove();
    },
  };
}

/** 跑一条命令并等它落定(含 flush 的 await 与 setState) */
export async function runCommand(h: AppCommandsHarness, id: string): Promise<void> {
  await act(async () => {
    await h.commands().execute(id);
  });
}

/** 直接调 run(不经 execute 的 flush),用于验证每条 run 自己的副作用 */
export async function callRun(h: AppCommandsHarness, id: string): Promise<void> {
  const cmd = h.commands().registry.find(id);
  if (cmd === undefined) throw new Error(`命令不存在:${id}`);
  await act(async () => {
    await cmd.run();
  });
}
