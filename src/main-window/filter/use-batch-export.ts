/**
 * 「导出选中」(spec 2026-10-17 §4.4):保存对话框 -> `export_points_of` 写 xlsx;
 * 取消对话框静默返回。与整库导出共用默认文件名与 2 秒回执复位口径。
 * 回执文案交回浮条(与加/去标签/删除同一条通道),本 hook 只报「发生了什么」。
 */
import { useCallback, useEffect, useState } from 'react';
import { save } from '@tauri-apps/plugin-dialog';
import { api } from '../../shared/api';
import { EXPORT_DEFAULT_PATH } from '../data/use-export';

export interface BatchExportApi {
  exporting: boolean;
  exported: boolean;
  /** 返回给浮条的回执文案;null = 用户取消(什么都不显示) */
  exportSelected: (ids: number[]) => Promise<string | null>;
}

export function useBatchExport(): BatchExportApi {
  const [exporting, setExporting] = useState(false);
  const [exported, setExported] = useState(false);

  useEffect(() => {
    if (!exported) return;
    const id = window.setTimeout(() => setExported(false), 2000);
    return () => window.clearTimeout(id);
  }, [exported]);

  const exportSelected = useCallback(
    async (ids: number[]): Promise<string | null> => {
      if (exporting) return null;
      if (ids.length === 0) return '没有选中任何条目';
      setExporting(true);
      try {
        const path = await save({
          defaultPath: EXPORT_DEFAULT_PATH,
          filters: [{ name: 'Excel 工作簿', extensions: ['xlsx'] }],
        });
        if (!path) return null; // 用户取消:静默
        await api.exportPointsOf(path, ids);
        setExported(true);
        return `已导出 ${ids.length} 条`;
      } catch (e) {
        return '导出失败：' + String(e);
      } finally {
        setExporting(false);
      }
    },
    [exporting]
  );

  return { exporting, exported, exportSelected };
}
