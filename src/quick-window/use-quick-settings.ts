import { useCallback, useEffect, useState } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { api } from '../shared/api';
import { lockStateFrom, type LockState } from '../shared/quick-lock';
import { loadQuickSettings, QUICK_DEFAULTS, type QuickSettings } from '../shared/quick-settings';

/** 读设置失败时的兜底:按「全部锁定」处理(宁可不可编辑,也不能库里锁定而界面可编辑) */
const LOCKED_FALLBACK: QuickSettings = {
  ...QUICK_DEFAULTS,
  lockMove: true,
  lockClose: true,
  lockContent: true,
};

/**
 * 快捷窗统一设置入口(替代原 use-quick-lock):
 * 挂载时读一次,窗口每次获得焦点时重载 —— 与 use-auto-height 统一用 onFocusChanged,
 * 保证热键唤起时锁定态等设置真的重载(原 DOM focus 事件拿不到 tauri://focus)。
 * 读失败按锁定处理并提示,不静默停在默认值。
 */
export function useQuickSettings() {
  const [settings, setSettings] = useState<QuickSettings>(QUICK_DEFAULTS);
  const [error, setError] = useState('');

  const reload = useCallback(async () => {
    try {
      setSettings(await loadQuickSettings());
      setError('');
    } catch (e) {
      setSettings(LOCKED_FALLBACK);
      setError(`读取设置失败,已按锁定处理: ${String(e)}`);
    }
  }, []);

  useEffect(() => {
    void reload();
    const win = getCurrentWindow();
    let alive = true;
    let unlisten: (() => void) | null = null;
    void win
      .onFocusChanged(({ payload: focused }) => {
        // 只处理「获得焦点」:失焦也重载会把节流窗口内(未落库)的透明度等视图状态
        // 按库里的旧值覆盖回去,窗口常驻时用户会看到透明度自己弹回
        if (alive && focused) void reload();
      })
      .then((off) => {
        if (alive) unlisten = off;
        else off();
      })
      .catch(() => {});
    return () => {
      alive = false;
      if (unlisten) unlisten();
    };
  }, [reload]);

  const lock: LockState = lockStateFrom(settings);

  // 锁图标:三键一次事务写库,写成功后本地才翻转(失败时调用方保持锁定态并提示)
  const unlock = useCallback(async () => {
    await api.setQuickLocks(false, false, false);
    setSettings((s) => ({ ...s, lockMove: false, lockClose: false, lockContent: false }));
  }, []);

  return { settings, lock, error, setError, reload, unlock };
}
