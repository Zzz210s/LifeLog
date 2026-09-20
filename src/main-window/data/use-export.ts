import { useCallback, useEffect, useState } from 'react';
import { save } from '@tauri-apps/plugin-dialog';
import { api } from '../../shared/api';
import type { ErrorKind } from '../shell/ErrorBar';

/**
 * 整库导出:保存对话框选路径 -> export_notes 写 xlsx;取消对话框静默返回。
 * 独立成 hook:导出与会话查询状态无关,且 App 已接近 200 行上限。
 */
export function useNotesExport(
  setError: (kind: ErrorKind, message: string) => void,
  clearError: (kind: ErrorKind) => void
) {
  const [exporting, setExporting] = useState(false);
  const [exported, setExported] = useState(false);

  // 已导出提示 2 秒后消失
  useEffect(() => {
    if (!exported) return;
    const id = window.setTimeout(() => setExported(false), 2000);
    return () => window.clearTimeout(id);
  }, [exported]);

  const onExport = useCallback(async () => {
    if (exporting) return;
    setExporting(true);
    try {
      // 对话框也纳入 try:被强制关闭 / IPC 异常时不能产生未兜底 rejection
      const path = await save({
        defaultPath: '笔记导出.xlsx',
        filters: [{ name: 'Excel 工作簿', extensions: ['xlsx'] }],
      });
      if (!path) return; // 用户取消:静默返回,finally 复位 exporting
      await api.exportNotes(path);
      setExported(true);
      clearError('action');
    } catch (e) {
      setError('action', '导出失败: ' + String(e));
    } finally {
      setExporting(false);
    }
  }, [exporting, clearError, setError]);

  return { exporting, exported, onExport };
}
