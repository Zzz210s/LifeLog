import { useCallback, useEffect, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { api } from '../shared/api';
import { lockStateFrom, type LockState } from '../shared/quick-lock';
import {
  loadQuickSettings,
  QUICK_DEFAULTS,
  QUICK_SETTINGS_CHANGED_EVENT,
  type QuickSettings,
} from '../shared/quick-settings';

/** 读设置失败时的兜底:按「全部锁定」处理(宁可不可编辑,也不能库里锁定而界面可编辑) */
const LOCKED_FALLBACK: QuickSettings = {
  ...QUICK_DEFAULTS,
  lockMove: true,
  lockClose: true,
  lockContent: true,
};

/**
 * 快捷窗统一设置入口(替代原 use-quick-lock):
 * 挂载时读一次;窗口每次获得焦点时重载;主窗设置页写库成功后会广播
 * quick-settings-changed,收到即重载 —— 因此「窗口置顶」等改动在快捷窗常驻可见时也立即生效,
 * 不必等下一次唤起(事件只是加速通道,丢失时仍由焦点重载兜底)。
 * 与 use-auto-height 统一用 onFocusChanged,保证热键唤起时锁定态等设置真的重载
 * (原 DOM focus 事件拿不到 tauri://focus)。
 * 重载后主动应用置顶:Rust 只在 show() 里读 quick_always_on_top(见 windowing/quick.rs),
 * 常驻可见时改设置不会经过 show(),必须由页面自己落到窗口上(权限见 capabilities/default.json)。
 * 读失败按锁定处理并提示,不静默停在默认值。
 */
export function useQuickSettings() {
  const [settings, setSettings] = useState<QuickSettings>(QUICK_DEFAULTS);
  const [error, setError] = useState('');

  const reload = useCallback(async () => {
    let next: QuickSettings;
    try {
      next = await loadQuickSettings();
    } catch (e) {
      setSettings(LOCKED_FALLBACK);
      setError(`读取设置失败,已按锁定处理: ${String(e)}`);
      return;
    }
    setSettings(next);
    setError('');
    try {
      await getCurrentWindow().setAlwaysOnTop(next.alwaysOnTop);
    } catch (e) {
      setError(`应用置顶失败: ${String(e)}`);
    }
  }, []);

  useEffect(() => {
    void reload();
    const win = getCurrentWindow();
    let alive = true;
    const offs: (() => void)[] = [];
    const keep = (un: () => void) => {
      if (alive) offs.push(un);
      else un();
    };
    void win
      .onFocusChanged(({ payload: focused }) => {
        // 只处理「获得焦点」:失焦也重载会把节流窗口内(未落库)的透明度等视图状态
        // 按库里的旧值覆盖回去,窗口常驻时用户会看到透明度自己弹回
        if (alive && focused) void reload();
      })
      .then(keep)
      .catch(() => {});
    void listen(QUICK_SETTINGS_CHANGED_EVENT, () => {
      void reload();
    })
      .then(keep)
      .catch(() => {}); // 订阅失败不阻断:焦点重载仍在
    return () => {
      alive = false;
      offs.forEach((off) => off());
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
