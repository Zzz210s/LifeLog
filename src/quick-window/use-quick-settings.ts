import { useCallback, useEffect, useState } from 'react';
import { api } from '../shared/api';
import { lockStateFrom, type LockState } from '../shared/quick-lock';
import { loadQuickSettings, QUICK_DEFAULTS, type QuickSettings } from '../shared/quick-settings';

/**
 * 快捷窗统一设置入口(替代原 use-quick-lock):
 * 挂载时读一次,窗口每次重新获得焦点时重载(reload 可重复调用,设置页改动的锁定/步长即时生效);
 * 读失败向上报错而不是静默给默认值。
 */
export function useQuickSettings() {
  const [settings, setSettings] = useState<QuickSettings>(QUICK_DEFAULTS);
  const [error, setError] = useState('');

  const reload = useCallback(async () => {
    try {
      setSettings(await loadQuickSettings());
      setError('');
    } catch (e) {
      setError(`读取设置失败: ${String(e)}`);
    }
  }, []);

  useEffect(() => {
    void reload();
    const onFocus = () => void reload();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [reload]);

  const lock: LockState = lockStateFrom(settings);

  // 锁图标:三键一次事务写库,写成功后本地才翻转(失败时调用方保持锁定态并提示)
  const unlock = useCallback(async () => {
    await api.setQuickLocks(false, false, false);
    setSettings((s) => ({ ...s, lockMove: false, lockClose: false, lockContent: false }));
  }, []);

  return { settings, lock, error, setError, reload, unlock };
}
