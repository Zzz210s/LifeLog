/**
 * 浮层接线的共用夹具(仅测试引用):真注册表 + 真 provider + 真 usePalette,
 * 只把数据层(api)与视图回调换成桩。用于"打开 -> 搜 -> 接受"的端到端读数。
 */
import { act, createElement, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { vi } from 'vitest';
import { COMMANDS, withRuns } from '../../shared/commands';
import type { CommandRegistry } from '../../shared/commands';
import { defaultContext } from '../../shared/keys';
import { EMPTY_FILTER } from '../../shared/filter-conditions';
import type { FilterConditions } from '../../shared/filter-conditions';
import type { Note } from '../../shared/types';
import type { Context } from '../../shared/when';
import { Palette } from '../palette/Palette';
import { useAppPalette } from './use-app-palette';
import type { AppPalette } from './use-app-palette';
import type { PaletteController } from '../palette/use-palette';
import type { RowDecoration } from '../palette/PaletteRow';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

export interface AppPaletteHarness {
  controller: () => PaletteController;
  decorations: () => Readonly<Record<string, RowDecoration>>;
  registry: CommandRegistry;
  /** 命令 run 的调用记录(executeCommand 内部真的调 run) */
  runCalls: string[];
  toggleTag: ReturnType<typeof vi.fn>;
  clearFilters: ReturnType<typeof vi.fn>;
  errors: string[];
  setNotes: (rows: Note[]) => void;
  setLoading: (v: boolean) => void;
  setConditions: (c: FilterConditions) => void;
  open: (prefix?: string) => Promise<void>;
  type: (value: string) => Promise<void>;
  accept: (index: number, keepOpen?: boolean) => Promise<void>;
  /** 让在飞的候选取回落地 */
  flush: () => Promise<void>;
  unmount: () => void;
}

export interface AppPaletteHarnessOptions {
  notes?: Note[];
  conditions?: FilterConditions;
  loading?: boolean;
  context?: Partial<Context>;
}

export function mountAppPalette(options: AppPaletteHarnessOptions = {}): AppPaletteHarness {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root: Root = createRoot(host);
  const box: { p: AppPalette | null } = { p: null };
  const runCalls: string[] = [];
  const registry = withRuns(
    COMMANDS,
    Object.fromEntries(
      COMMANDS.all.map((c) => [
        c.id,
        () => {
          runCalls.push(c.id);
        },
      ]),
    ),
  );
  const toggleTag = vi.fn();
  const clearFilters = vi.fn();
  const errors: string[] = [];
  const ctl: { setNotes: (r: Note[]) => void; setLoading: (v: boolean) => void; setConditions: (c: FilterConditions) => void } = {
    setNotes: () => {},
    setLoading: () => {},
    setConditions: () => {},
  };

  act(() =>
    root.render(
      createElement(function Host(): ReactNode {
        const anchorRef = useRef<HTMLDivElement>(null);
        const [notes, setNotes] = useState(options.notes ?? []);
        const [loading, setLoading] = useState(options.loading ?? false);
        const [conditions, setConditions] = useState(options.conditions ?? EMPTY_FILTER);
        const ctx = { ...defaultContext(), ...options.context };
        ctl.setNotes = setNotes;
        ctl.setLoading = setLoading;
        ctl.setConditions = setConditions;
        box.p = useAppPalette({
          anchorRef,
          registry,
          getContext: () => ctx,
          notes,
          loadingNotes: loading,
          conditions,
          clearFilters,
          toggleTag,
          executeCommand: async (id) => {
            await registry.find(id)?.run();
          },
          setError: (_kind, message) => errors.push(message),
        });
        const p = box.p as AppPalette;
        return createElement(
          'div',
          { ref: anchorRef },
          createElement(Palette, { controller: p.controller, decorations: p.decorations }),
        );
      }),
    ),
  );

  const palette = (): AppPalette => box.p as AppPalette;
  // 必须限定在本夹具的 host 内:同一测试里可能同时挂多个浮层(取全局会把字打到别人的输入框)
  const input = (): HTMLInputElement => host.querySelector<HTMLInputElement>('[role="combobox"]')!;
  const settle = async (turns = 12): Promise<void> => {
    await act(async () => {
      for (let i = 0; i < turns; i++) await Promise.resolve();
    });
  };

  return {
    controller: () => palette().controller,
    decorations: () => palette().decorations,
    registry,
    runCalls,
    toggleTag,
    clearFilters,
    errors,
    setNotes: (rows) => act(() => ctl.setNotes(rows)),
    setLoading: (v) => act(() => ctl.setLoading(v)),
    setConditions: (c) => act(() => ctl.setConditions(c)),
    open: async (prefix = '') => {
      act(() => palette().controller.open(prefix));
      await settle();
    },
    type: async (value) => {
      const el = input();
      const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      act(() => {
        setValue?.call(el, value);
        el.dispatchEvent(new Event('input', { bubbles: true }));
      });
      await settle();
    },
    accept: async (index, keepOpen = false) => {
      act(() => palette().controller.accept(index, keepOpen));
      await settle();
    },
    flush: settle,
    unmount: () => {
      act(() => root.unmount());
      host.remove();
    },
  };
}
