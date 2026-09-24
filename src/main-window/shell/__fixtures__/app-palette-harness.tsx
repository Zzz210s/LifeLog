/**
 * 候选接线的共用夹具(**仅测试引用**,故自 `src/` 移到 `__fixtures__/`):真注册表 + 真 provider +
 * 真 usePalette,只把数据层(api)与错误出口换成桩。用于"输入前缀 -> 取候选 -> 装饰"的端到端读数。
 *
 * 驱动走**生产那条路**:输入经 `controller.setQuery`(前缀解析在 usePalette 里)进 provider,
 * 与统一输入框的常驻驱动同构 —— 浮层外壳连同它的 `open()`/`accept()` 已删(2026-09-24 计划 2/3 Task 5),
 * 夹具不再替一条不存在于生产的通道作证。
 */
import { act, createElement, useState } from 'react';
import type { ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { CommandRegistry } from '../../../shared/commands';
import { COMMANDS, withRuns } from '../../../shared/commands';
import { defaultContext } from '../../../shared/keys';
import type { Context } from '../../../shared/when';
import { useAppPalette } from '../use-app-palette';
import type { AppPalette } from '../use-app-palette';
import type { PaletteController } from '../../palette/use-palette';
import type { RowDecoration } from '../../palette/PaletteRow';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

export interface AppPaletteHarness {
  controller: () => PaletteController;
  decorations: () => Readonly<Record<string, RowDecoration>>;
  registry: CommandRegistry;
  /** 命令 provider 取候选的次数(m2 读数:标签版本变化不该让非 `#` 前缀重跑) */
  commandItemRuns: () => number;
  errors: string[];
  /** 模拟主窗 loadTags 成功:标签数据版本 +1(标签候选池据此作废) */
  setTagsVersion: (v: number) => void;
  /** 往输入壳里打字(经 controller.setQuery 走真前缀解析) */
  type: (value: string) => Promise<void>;
  /** 让在飞的候选取回落地 */
  flush: () => Promise<void>;
  unmount: () => void;
}

export interface AppPaletteHarnessOptions {
  context?: Partial<Context>;
  tagsVersion?: number;
}

/** 最小候选输入壳:受控值取 controller.query,输入经 controller.setQuery 走真前缀解析 */
function Probe({ controller }: { controller: PaletteController }): ReactNode {
  return createElement('input', {
    role: 'combobox',
    value: controller.query,
    onChange: (e) => controller.setQuery(e.target.value),
  });
}

export function mountAppPalette(options: AppPaletteHarnessOptions = {}): AppPaletteHarness {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root: Root = createRoot(host);
  const box: { p: AppPalette | null } = { p: null };
  // 包一层计数:命令 provider 每次取候选都会调 list(ctx);装饰走 all,不计入
  let commandItemRuns = 0;
  const runs = withRuns(
    COMMANDS,
    Object.fromEntries(COMMANDS.all.map((c) => [c.id, () => {}])),
  );
  const registry: CommandRegistry = {
    all: runs.all,
    list: (ctx) => {
      commandItemRuns += 1;
      return runs.list(ctx);
    },
    find: (id) => runs.find(id),
  };
  const errors: string[] = [];
  const ctl: { setTagsVersion: (v: number) => void } = { setTagsVersion: () => {} };

  act(() =>
    root.render(
      createElement(function Host(): ReactNode {
        const [tagsVersion, setTagsVersion] = useState(options.tagsVersion ?? 0);
        const ctx = { ...defaultContext(), ...options.context };
        ctl.setTagsVersion = setTagsVersion;
        box.p = useAppPalette({
          registry,
          getContext: () => ctx,
          tagsVersion,
          setError: (_kind, message) => errors.push(message),
        });
        const p = box.p as AppPalette;
        return createElement('div', null, createElement(Probe, { controller: p.controller }));
      }),
    ),
  );

  const palette = (): AppPalette => box.p as AppPalette;
  // 必须限定在本夹具的 host 内:同一测试里可能同时挂多个探针(取全局会把字打到别人的输入框)
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
    commandItemRuns: () => commandItemRuns,
    errors,
    setTagsVersion: (v) => act(() => ctl.setTagsVersion(v)),
    type: async (value) => {
      const el = input();
      const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      act(() => {
        setValue?.call(el, value);
        el.dispatchEvent(new Event('input', { bubbles: true }));
      });
      await settle();
    },
    flush: settle,
    unmount: () => {
      act(() => root.unmount());
      host.remove();
    },
  };
}
