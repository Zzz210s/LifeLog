import { useCallback, useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { api } from '../shared/api';
import { emptyLock, lockStateFrom, type LockState } from '../shared/quick-lock';

// 三档锁定与双击动作的设置键。Task 3 的 quick-settings 落地后由 loadQuickSettings 统一接管;
// 本任务只读这几个键,持久化走 set_setting(api.ts 未暴露写接口,故直接 invoke 自定义命令)。
const LOCK_KEYS = ['quick_lock_move', 'quick_lock_close', 'quick_lock_content'];

export type DoubleClickAction = 'hide' | 'none';

export function useQuickLock() {
  const [lock, setLock] = useState<LockState>(emptyLock);
  const [doubleClickAction, setDoubleClickAction] = useState<DoubleClickAction>('hide');

  useEffect(() => {
    void Promise.all([
      ...LOCK_KEYS.map((key) => api.getSetting(key)),
      api.getSetting('quick_double_click_action'),
    ])
      .then(([move, close, content, action]) => {
        setLock(
          lockStateFrom({
            lockMove: move === 'true',
            lockClose: close === 'true',
            lockContent: content === 'true',
          }),
        );
        setDoubleClickAction(action === 'none' ? 'none' : 'hide');
      })
      .catch(() => {});
  }, []);

  // 锁图标:三档一并写回 false 并持久化
  const unlock = useCallback(() => {
    setLock(emptyLock());
    void Promise.all(LOCK_KEYS.map((key) => invoke('set_setting', { key, value: 'false' }))).catch(
      () => {},
    );
  }, []);

  return { lock, doubleClickAction, unlock };
}
