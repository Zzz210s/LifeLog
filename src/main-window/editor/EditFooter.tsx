import type { ReactNode } from 'react';
import { tagCountHint, tagCountLabel } from './edit-tag-count';

export interface EditFooterProps {
  /** 实时标签数(`parse_note_source` 防抖结果;失败时回退已保存值) */
  tagCount: number;
  /** 保存/校验失败的中文原因(空串 = 无),就地显示,不静默 */
  error: string;
}

/** 编辑面板页脚:标签数 + Ctrl+Enter 提示 + 就地错误(自 `EditPanel` 抽出以守 200 行红线) */
export function EditFooter(p: EditFooterProps): ReactNode {
  const hint = tagCountHint(p.tagCount);
  return (
    <div className="mt-2 flex items-center gap-3">
      <span className="text-xs text-muted" data-testid="edit-tag-count">
        {tagCountLabel(p.tagCount)}
        {hint !== null && <span className="ml-2 text-faint">{hint}</span>}
      </span>
      <span className="text-xs text-faint" data-testid="edit-save-hint">
        Ctrl+Enter 保存
      </span>
      {p.error !== '' && <span className="text-xs text-danger">{p.error}</span>}
    </div>
  );
}
