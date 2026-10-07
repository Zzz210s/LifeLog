/**
 * 导出反馈:导出进行中 / 成功后落在顶栏上的状态文字。
 *
 * 它原先与顶栏 `⋯` 溢出菜单同在一个文件(TopBarMenu.tsx)。2026-10-07 按盘点报告删掉了 `⋯`
 * (条目各回视图内工具条或命令面板),只留这块纯展示的 `role="status"`。
 */
import type { ReactNode } from 'react';

export function ExportNotice(p: { exporting: boolean; exported: boolean }): ReactNode {
  if (!p.exporting && !p.exported) return null;
  return (
    <span role="status" className={p.exporting ? 'text-ui text-muted' : 'text-ui text-success'}>
      {p.exporting ? '正在导出…' : '已导出'}
    </span>
  );
}
