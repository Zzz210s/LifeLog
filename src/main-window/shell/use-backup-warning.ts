/**
 * 启动期「迁移前自动备份失败」提示(自 App 抽出,纯搬移):
 * 挂载时向 Rust 取一次(取值即清空,只提示一次),有值就走既有错误条显示。
 * 非 Tauri 环境(浏览器冒烟)或取值失败一律静默,不影响主界面。
 */
import { useEffect } from 'react';
import { api } from '../../shared/api';
import type { ErrorKind } from './ErrorBar';
import { backupWarningText } from './backup-notice';

export function useBackupWarning(setError: (kind: ErrorKind, message: string) => void): void {
  useEffect(() => {
    void api
      .takeBackupWarning()
      .then((w) => {
        if (w) setError('action', backupWarningText(w));
      })
      .catch(() => {});
  }, [setError]);
}
