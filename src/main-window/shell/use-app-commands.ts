/**
 * 命令面板的副作用接线(设计 §3.7 的 12 条;T3 审查 Important 1 的门禁入口)。
 *
 * - `withRuns(COMMANDS, runs)` 在构造期校验「12 条都有 run」,缺一条即抛中文错误(测试期就红),
 *   不会退化成 `notWired` 的静默占位。
 * - 所有 run 统一:**先 flush 编辑态再执行**(`execute` 里做),失败走主窗错误条,绝不静默。
 * - runs 与 registry 的身份必须永久稳定(`latest` ref 取最新状态):否则每次 render 都会重建注册表,
 *   下游 provider 的「取候选」effect 会跟着无限重跑。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { confirm } from '@tauri-apps/plugin-dialog';
import { COMMANDS, withRuns } from '../../shared/commands';
import type { CommandRegistry, CommandRuns } from '../../shared/commands';
import type { FilterConditions } from '../../shared/filter-conditions';
import { api } from '../../shared/api';
import type { ThemeMode } from '../../shared/theme-mode';
import { flushEditing } from '../editor/edit-flush';
import type { ErrorKind } from './ErrorBar';
import type { MainView } from '../settings/settings-model';
import { focusWhenPresent } from './focus-when-present';

/** 主窗唯一输入框(统一输入框):命令「新建笔记」把焦点交给它 */
export const UNIFIED_INPUT_SELECTOR = '[data-testid="unified-input"]';
/** 设置页的全局快捷键录制器(T7 会加应用内两行,选择器不变) */
export const HOTKEY_RECORDER_SELECTOR = 'button[aria-label="录制快捷键"]';

/** 状态条(主窗右下,设计 D10):running 常驻到结束,done 2.5s 后自动消失 */
export interface CommandStatus {
  kind: 'running' | 'done';
  text: string;
}

export interface AppCommandsOptions {
  sidebar: { visible: boolean; setVisible: (visible: boolean) => void };
  theme: { mode: ThemeMode; setMode: (mode: ThemeMode) => void };
  setView: (view: MainView) => void;
  /** 条件对象的局部更新(排序命令写回当前筛选条件;真源在 useFilterState) */
  onPatch: (value: Partial<FilterConditions>) => void;
  /** 整库导出(既有 useNotesExport.onExport;失败已在它内部落错误条) */
  exportAll: () => Promise<void>;
  setError: (kind: ErrorKind, message: string) => void;
}

export interface AppCommands {
  registry: CommandRegistry;
  status: CommandStatus | null;
  /**
   * 「添加条件」命令的上抛信号:为真表示条件栏/顶栏菜单应打开菜单。
   * 消费方(Task 2 的条件栏)打开后调 consumeAddCondition 复位,避免下次重复弹出。
   */
  addConditionOpen: boolean;
  consumeAddCondition: () => void;
  /** 执行一条命令:先 flush 编辑态,再 run;失败落错误条 */
  execute: (id: string) => Promise<void>;
}

/** 主题三态循环:亮 -> 暗 -> 跟随系统 -> 亮(设计 §3.7) */
export function nextThemeMode(mode: ThemeMode): ThemeMode {
  if (mode === 'light') return 'dark';
  if (mode === 'dark') return 'system';
  return 'light';
}

export function useAppCommands(options: AppCommandsOptions): AppCommands {
  const latest = useRef(options);
  latest.current = options;
  const [status, setStatus] = useState<CommandStatus | null>(null);
  const [addConditionOpen, setAddConditionOpen] = useState(false);
  const focusSnapshot = useRef<boolean | null>(null);

  const runs = useMemo((): CommandRuns => {
    return {
      'note.new': () => focusWhenPresent(UNIFIED_INPUT_SELECTOR),
      'settings.open': () => latest.current.setView('settings'),
      'theme.cycle': () => {
        const { theme } = latest.current;
        theme.setMode(nextThemeMode(theme.mode));
      },
      'sidebar.toggle': () => {
        const { sidebar } = latest.current;
        sidebar.setVisible(!sidebar.visible);
      },
      'focus.mode': () => {
        // 首次进入:快照侧栏可见性后隐藏;再次执行 = 退出并还原
        const { sidebar } = latest.current;
        if (focusSnapshot.current === null) {
          focusSnapshot.current = sidebar.visible;
          sidebar.setVisible(false);
          return;
        }
        sidebar.setVisible(focusSnapshot.current);
        focusSnapshot.current = null;
      },
      'sort.newest': () => latest.current.onPatch({ sort: 'newest' }),
      'sort.oldest': () => latest.current.onPatch({ sort: 'oldest' }),
      // 状态上抛给条件栏/顶栏菜单(Task 2 消费;本任务只发信号)
      'filter.addCondition': () => setAddConditionOpen(true),
      'export.all': async () => {
        setStatus({ kind: 'running', text: '正在导出整库…' });
        try {
          await latest.current.exportAll(); // 成功/取消/失败都在它内部落定,这里只管进行中状态
        } finally {
          setStatus(null);
        }
      },
      'search.reindex': async () => {
        setStatus({ kind: 'running', text: '正在重建搜索索引…' });
        try {
          const rows = await api.rebuildSearchIndex();
          setStatus({ kind: 'done', text: `搜索索引已重建(${rows} 条)` });
        } catch (e) {
          setStatus(null);
          latest.current.setError('action', '重建搜索索引失败: ' + String(e));
        }
      },
      'hotkey.edit': () => {
        latest.current.setView('settings');
        focusWhenPresent(HOTKEY_RECORDER_SELECTOR);
      },
      'app.quit': async () => {
        const ok = await confirm('退出后输入栏与托盘都会关闭。确定退出吗?', {
          title: '退出拾枝',
          kind: 'warning',
        });
        if (ok) await api.quitApp();
      },
    };
  }, []);

  // 构造期门禁:漏接一条就抛(中文错误里列出全部缺失 id)
  const registry = useMemo(() => withRuns(COMMANDS, runs), [runs]);

  useEffect(() => {
    if (status?.kind !== 'done') return;
    const id = window.setTimeout(() => setStatus(null), 2500);
    return () => window.clearTimeout(id);
  }, [status]);

  const execute = useCallback(
    async (id: string): Promise<void> => {
      const cmd = registry.find(id);
      if (cmd === undefined) {
        latest.current.setError('action', `未知命令:${id}`);
        return;
      }
      // 纪律 5:执行前先 flush 编辑态(复用「点区块外即保存」那条通道)
      const flushed = await flushEditing();
      if (!flushed.ok) {
        latest.current.setError('action', `命令未执行:${flushed.message ?? '编辑内容未能保存'}`);
        return;
      }
      try {
        await cmd.run();
      } catch (e) {
        latest.current.setError('action', `命令「${cmd.title}」执行失败: ${String(e)}`);
      }
    },
    [registry],
  );

  return { registry, status, addConditionOpen, consumeAddCondition: () => setAddConditionOpen(false), execute };
}
